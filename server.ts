import { authorizeEngineRequest, EngineAccessError } from './src/server/engineAccess';
import { createMediaRouter } from "./src/server/mediaConfig";
import { TournamentRuntime, hostedTournamentRepository, createTournamentRuntimeRouter } from "./src/server/tournamentRuntime";
import { PersistentEngine } from "./src/server/nativeEngine";
import { replayForAnalysis } from "./src/lib/analysisReplay";
import { classifyMove, type PositionEval } from "./src/lib/analysis";
import express from "express";
import path from "path";
import fs from "fs";
import { WebSocketServer } from "ws";
import { generateLegalMoves, applyMove, createInitialBoard, checkGameEnd, boardToScanFen, scanFenToBoard, moveToNotationString, convertMoveStr, convertSq, isKing, verifyPuzzleLine, hubMoveStringToNigerian, ngSqToRc } from "./src/gameLogic";
import type { Board, Move } from "./src/gameLogic";
import { debitMultipleWallets, creditWallet, getOrCreateWallet, debitWallet, settleMatchPot, HOUSE_WALLET_USERNAME } from "./coinsService";
import { requirePermission, writeAuditLog, ADMIN_PERMISSIONS, getAdminByUid, type AdminPermission } from "./adminService";
import compression from "compression";
import { randomBytes, randomUUID } from "node:crypto";
import { mountProductionStatic } from "./src/server/staticAssets";
import { createRateLimiter, securityHeaders } from "./src/server/securityMiddleware";
import { installBodyParsing } from "./src/server/bodyParsing";
import { getSupabaseAdmin, verifyAccessToken } from "./supabaseAdmin";
import { canReadGameRecord, requestAccessToken } from "./src/server/httpAuth";
import { createAccountAuthRouter } from "./src/server/accountAuth";
import { createTournamentInviteRouter } from "./src/server/tournamentInvites";
import { Client as PgClient } from "pg";
import {
  initGameRecordsManager,
  getNextGameCode,
  flushGameRecords,
  recordGameStart,
  recordGameEnd,
  linkRematch,
  getGameRecordByCode,
  getRecentGameRecords,
  getSeriesById,
} from "./src/server/gameRecordsManager";
import { attachOnlinePlay } from "./src/server/onlinePlay";
import { parseEngineMoveRequest } from "./src/server/engineRequest";
import { accountForUsername, insertNotification, sendTournamentReminders } from "./src/server/notifications";
import { deliverPendingPushes, safePushEndpoint, validateSubscription, vapidSettings } from "./src/server/webPush";

// Privileged features require server-side Supabase credentials and verified
// UID permission grants. Missing credentials fail closed in the auth layer.
const KENTRO_ADMIN_ENABLED = true;
const KENTRO_COINS_ENABLED = true;

const engine = new PersistentEngine();

// ── Server-side move validation helpers ─────────────────────────────────────
// The WS "make-move" handler used to trust whatever board/turn a client sent, with
// no check that the move was legal. Any client (modified, buggy, or malicious) could
// push an arbitrary board straight to the opponent. This replays the move against the
// server's own last-known board using the same legal-move generator the client uses,
// and only accepts it if it actually matches a legal move.
function movesMatch(a: Move, b: Move): boolean {
  if (a.from !== b.from || a.to !== b.to) return false;
  const capsA = Array.isArray(a.caps) ? a.caps : [];
  const capsB = Array.isArray(b.caps) ? b.caps : [];
  if (capsA.length !== capsB.length) return false;
  const sortedA = [...capsA].sort((x, y) => x - y);
  const sortedB = [...capsB].sort((x, y) => x - y);
  return sortedA.every((v, i) => v === sortedB[i]);
}

// --- Kentro Coins: admin-configurable pricing ---
// Cached briefly (30s) so every room creation/join doesn't hit the database --
// admins changing prices will take effect within that window, not instantly.
interface CoinSettings {
  matchEntryFee: { blitz: number; rapid: number; classical: number };
  crownCrownSurcharge: number; // added on top of the time-based entry fee -- Crown Crown is already documented elsewhere in this codebase as a premium mode, this is what makes that real instead of just descriptive text
  tournamentEntryFeeDefault: number;
  aiUnlockCostPerLevel: number;
  aiUnlockAllCost: number;
  coinPackages: { id: string; coins: number; priceNaira: number }[];
  // Percentage of the total pot taken as rake on a decisive (non-draw) match
  // result, before the remainder is credited to the winner. 0.10 = 10%.
  // Never applied to draws -- see settleMatchPot in coinsService.ts.
  matchRakePercent: number;
  // Same idea, applied once to a tournament's whole accumulated prize pool
  // when an admin confirms the winner and pay_tournament_prize() runs.
  tournamentRakePercent: number;
  // How many Naira a withdrawn coin is worth, per 100 coins. Deliberately
  // lower than the buy rate (coinPackages above work out to ~10/coin) --
  // that buy/withdraw spread is its own revenue stream, independent of the
  // rake.
  withdrawalRatePerHundredCoins: number;
  // Withdrawal eligibility gate -- see requireWithdrawalEligible() below.
  withdrawalMinCoins: number;
  withdrawalMinGamesPlayed: number;
  withdrawalMinAccountAgeDays: number;
}

const DEFAULT_COIN_SETTINGS: CoinSettings = {
  matchEntryFee: { blitz: 5, rapid: 10, classical: 15 },
  crownCrownSurcharge: 10,
  tournamentEntryFeeDefault: 20,
  aiUnlockCostPerLevel: 50,
  aiUnlockAllCost: 30,
  coinPackages: [
    { id: "starter", coins: 100, priceNaira: 1000 },
    { id: "plus", coins: 200, priceNaira: 2000 },
    { id: "value", coins: 500, priceNaira: 5000 },
    { id: "pro", coins: 1000, priceNaira: 10000 },
  ],
  matchRakePercent: 0.10,
  tournamentRakePercent: 0.20,
  withdrawalRatePerHundredCoins: 950,
  withdrawalMinCoins: 500,
  withdrawalMinGamesPlayed: 20,
  withdrawalMinAccountAgeDays: 7,
};

let coinSettingsCache: { value: CoinSettings; fetchedAt: number } | null = null;

async function getCoinSettings(): Promise<CoinSettings> {
  if (!KENTRO_COINS_ENABLED) return DEFAULT_COIN_SETTINGS;
  if (coinSettingsCache && Date.now() - coinSettingsCache.fetchedAt < 30000) {
    return coinSettingsCache.value;
  }
  try {
    const { data, error } = await getSupabaseAdmin().from("app_config").select("data").eq("id", "coinSettings").maybeSingle();
    if (error) throw error;
    const value: CoinSettings = data ? { ...DEFAULT_COIN_SETTINGS, ...(data.data as any) } : DEFAULT_COIN_SETTINGS;
    coinSettingsCache = { value, fetchedAt: Date.now() };
    return value;
  } catch (err) {
    console.error("Failed to load coin settings, using defaults:", err);
    // Negative-cache the fallback for ~10s: during a database hiccup, ONE
    // join pays the timeout and everyone else gets instant defaults --
    // instead of every join/accept in the outage window serializing its
    // own multi-second failed fetch.
    coinSettingsCache = { value: DEFAULT_COIN_SETTINGS, fetchedAt: Date.now() - 20000 };
    return DEFAULT_COIN_SETTINGS;
  }
}

function matchEntryFeeFor(gameTime: number, settings: CoinSettings, specialRule?: string): number {
  const base = gameTime >= 15 ? settings.matchEntryFee.classical : gameTime >= 8 ? settings.matchEntryFee.rapid : settings.matchEntryFee.blitz;
  return specialRule === "crown-crown" ? base + settings.crownCrownSurcharge : base;
}

// Mirrors MIN_MATCH_WAGER/MAX_MATCH_WAGER/MATCH_WAGER_STEP in src/App.tsx.
// Re-validated here independently -- the client's slider already constrains
// this, but a client is never trusted for anything that moves real coins.
const MIN_MATCH_WAGER = 10;
const MAX_MATCH_WAGER = 1000;
const MATCH_WAGER_STEP = 10;

// Clamps an incoming wagerAmount to a safe, valid value, or returns null if
// the room was created without one (older client, or the field was omitted)
// so the caller can fall back to matchEntryFeeFor()'s time-based default.
function sanitizeWagerAmount(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  // Explicit zero = the host chose a FREE match. Without this early return
  // the MIN clamp below silently turned "free" into the minimum wager --
  // charging players coins the host never asked for.
  if (raw === 0) return 0;
  const stepped = Math.round(raw / MATCH_WAGER_STEP) * MATCH_WAGER_STEP;
  return Math.min(MAX_MATCH_WAGER, Math.max(MIN_MATCH_WAGER, stepped));
}

// Match series lengths a host may pick ("Best of 5" option in Create Game).
// Mirrors ALLOWED_BEST_OF in src/lib/constants.ts; re-validated here because
// series length decides when the wager pot pays out.
const ALLOWED_BEST_OF = [1, 3, 5];
function sanitizeBestOf(raw: unknown): number {
  return typeof raw === "number" && ALLOWED_BEST_OF.includes(raw) ? raw : 1;
}

// The actual per-player entry fee for a room: the host's chosen wager if the
// room has one, otherwise 0 for free matches. Used by both
// join-room and the game starting logic so players are never blocked by coin balances for standard games.
function resolveEntryFee(room: { gameTime: number; specialRule: string; wagerAmount?: number }, settings: CoinSettings): number {
  if (typeof room.wagerAmount === "number" && room.wagerAmount > 0) {
    return room.wagerAmount;
  }
  return 0;
}

// Withdrawal eligibility -- all four have to hold:
//   - the wallet actually has at least this many coins
//   - the request is at least the configured minimum (withdrawalMinCoins)
//   - the account has played at least withdrawalMinGamesPlayed real games
//     against another person (Multiplayer/Tournament) -- AI games don't
//     count, so this can't be satisfied by grinding the computer
//   - the account is older than withdrawalMinAccountAgeDays, from
//     profiles.createdAt (falls back to "not eligible" rather than
//     "eligible" if that row is somehow missing, since the honest answer
//     when account age can't be determined is "can't confirm this," not
//     "assume it's fine")
async function checkWithdrawalEligibility(
  username: string,
  verifiedUid: string,
  requestedCoins: number,
  settings: CoinSettings
): Promise<{ eligible: boolean; reason?: string; balance: number }> {
  const uname = username.toLowerCase().trim();
  const db = getSupabaseAdmin();

  const { data: wallet, error: walletError } = await db.from("coin_wallets").select("balance").eq("username", uname).maybeSingle();
  if (walletError) throw walletError;
  const balance = (wallet?.balance as number) ?? 0;

  if (requestedCoins < settings.withdrawalMinCoins) {
    return { eligible: false, reason: `Minimum withdrawal is ${settings.withdrawalMinCoins} coins.`, balance };
  }
  if (requestedCoins > balance) {
    return { eligible: false, reason: `You only have ${balance} coins.`, balance };
  }

  const { data: profile, error: profileError } = await db.from("profiles").select("createdAt")
    .eq("usernameLower", uname).eq("ownerId", verifiedUid).maybeSingle();
  if (profileError) throw profileError;
  const accountCreatedAt = profile?.createdAt as number | undefined;
  const accountAgeDays = accountCreatedAt ? (Date.now() - accountCreatedAt) / (1000 * 60 * 60 * 24) : -1;
  if (accountAgeDays < settings.withdrawalMinAccountAgeDays) {
    return { eligible: false, reason: `Your account needs to be at least ${settings.withdrawalMinAccountAgeDays} days old to withdraw.`, balance };
  }

  const { count, error: gamesError } = await db
    .from("completed_games")
    .select("gameId", { count: "exact", head: true })
    .in("playMode", ["Multiplayer", "Tournament"])
    .contains("participantUserIds", [verifiedUid]);
  if (gamesError) throw gamesError;
  const realGamesPlayed = count ?? 0;
  if (realGamesPlayed < settings.withdrawalMinGamesPlayed) {
    return { eligible: false, reason: `Play at least ${settings.withdrawalMinGamesPlayed} real games first (AI games don't count) -- you're at ${realGamesPlayed}.`, balance };
  }

  return { eligible: true, balance };
}

// Position editor sandbox rooms let a client hand the server a whole board
// state up front (instead of one validated move at a time, like every other
// path), so it gets fully validated: only real square numbers (1-50), only
// real piece values, nothing else -- an invalid or missing board just means
// no custom board is used (falls back to the standard setup) rather than
// trusting anything the client sent.
function sanitizeCustomBoard(raw: unknown): Board | null {
  if (!raw || typeof raw !== "object") return null;
  const validPieces = new Set(["w", "W", "b", "B"]);
  const board: Board = {};
  let hasAnyPiece = false;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const sq = Number(key);
    if (!Number.isInteger(sq) || sq < 1 || sq > 50) continue;
    if (value === null) { board[sq] = null; continue; }
    if (typeof value === "string" && validPieces.has(value)) { board[sq] = value as any; hasAnyPiece = true; continue; }
    return null; // any invalid entry -- reject the whole thing rather than guess
  }
  return hasAnyPiece ? board : null;
}

function findLegalMatch(board: Board, turn: "W" | "B", claimed: Move): Move | null {
  const legal = generateLegalMoves(board, turn);
  return legal.find((m) => movesMatch(m, claimed)) || null;
}

// --- Auto-apply the signup-fix database trigger on every boot ---
//
// Fixes a real bug: signUpWithEmail (src/supabase.ts) writes the new
// profiles row immediately after supabase.auth.signUp() -- but with
// "Confirm email" enabled, Supabase deliberately withholds a session until
// the confirmation link is clicked, so that write happens unauthenticated
// and RLS correctly (silently) rejects it. Net effect: accounts get
// created and even get confirmed, but no profile row ever exists, so
// sign-in-by-username can never find them. The real fix is a database
// trigger that creates the profile the instant the auth.users row exists,
// regardless of session/confirmation state -- see the matching, more
// heavily-commented copy of this exact SQL in supabase/schema.sql (kept
// there for anyone who prefers to run it manually via the SQL Editor
// instead of setting SUPABASE_DB_URL below; both are equivalent and safe
// to have both applied).
//
// Deliberately scoped to ONLY this trigger + its one-time backfill, NOT
// the entire schema.sql -- that file has 26 CREATE POLICY statements with
// no DROP-IF-EXISTS guards in front of them, and Postgres's CREATE POLICY
// has no IF NOT EXISTS form, so blindly re-running the whole file on every
// boot would succeed once and then fail on every subsequent boot. Every
// statement below (CREATE OR REPLACE, DROP TRIGGER IF EXISTS, ON CONFLICT
// DO NOTHING) is genuinely idempotent, so this is safe to run every time
// the server starts, including on a database that's never seen it before
// or one that already has it applied.
const SIGNUP_FIX_MIGRATION_SQL = `
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles ("usernameLower", "username", "ownerId", "createdAt")
  values (
    lower(trim(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)))),
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    new.id,
    extract(epoch from now()) * 1000
  )
  on conflict ("usernameLower") do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

insert into public.profiles ("usernameLower", "username", "ownerId", "createdAt")
select
  lower(trim(coalesce(u.raw_user_meta_data ->> 'username', split_part(u.email, '@', 1)))),
  coalesce(u.raw_user_meta_data ->> 'username', split_part(u.email, '@', 1)),
  u.id,
  extract(epoch from u.created_at) * 1000
from auth.users u
where not exists (select 1 from public.profiles p where p."ownerId" = u.id)
on conflict ("usernameLower") do nothing;
`;

async function applySignupFixMigration() {
  // Hard opt-out: the owner manages all schema manually in the Supabase SQL
  // Editor (supabase/all_migrations_combined.sql), so the server should not
  // even think about the database at boot. Baked into the Dockerfile as
  // ENV SKIP_DB_MIGRATION=1 -- boot is instant and the log stays clean.
  if (process.env.SKIP_DB_MIGRATION !== "0") {
    console.log("[Migration] Skipped — schema changes require explicit SKIP_DB_MIGRATION=0 opt-in.");
    return;
  }
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.warn(
      "[Migration] SUPABASE_DB_URL not set -- skipping auto-migration. " +
      "Either set it (Supabase Dashboard -> Project Settings -> Database -> " +
      "Connection string -> URI, with the real database password filled in) " +
      "or run supabase/schema.sql manually in the SQL Editor instead -- " +
      "either path fixes the same thing."
    );
    return;
  }
  const client = new PgClient({ connectionString, ssl: { rejectUnauthorized: true } });
  try {
    await client.connect();
    await client.query(SIGNUP_FIX_MIGRATION_SQL);
    console.log("[Migration] Signup-fix trigger applied (or already present).");
  } catch (err) {
    console.error("[Migration] Failed to apply signup-fix trigger automatically:", err);
    const anyErr = err as any;
    if (anyErr?.code === "ENETUNREACH" && String(anyErr?.address || "").includes(":")) {
      console.error(
        "[Migration] DIAGNOSIS: your SUPABASE_DB_URL points at Supabase's DIRECT " +
        "database host (db.<project>.supabase.co) -- that host is IPv6-ONLY, and " +
        "this hosting environment (e.g. Hugging Face Spaces) has no IPv6 route, so " +
        "it can never connect. FIX: in the Supabase Dashboard click the Connect " +
        "button -> choose 'Session pooler' -> copy that URI (it looks like " +
        "postgresql://postgres.<project>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres) " +
        "and set THAT as SUPABASE_DB_URL -- the pooler host is IPv4-reachable and " +
        "auto-migration will work on every boot."
      );
    }
    console.error("[Migration] Fall back to running supabase/schema.sql manually in the Supabase SQL Editor.");
  } finally {
    await client.end().catch(() => {});
  }
}

async function startServer() {
  // Runs first, before anything that depends on profiles existing
  // correctly (e.g. the admin bootstrap right below) -- safe to call on
  // every boot, see the comment above SIGNUP_FIX_MIGRATION_SQL.
  await applySignupFixMigration();
  await initGameRecordsManager({ handleSignals: false });

  const app = express();
  const tournamentRuntime = new TournamentRuntime(hostedTournamentRepository, spec => onlinePlay.ensureTournamentRoom(spec), () => getNextGameCode(onlinePlay.rooms), path.join(process.env.KENTRO_DATA_DIR || path.join(process.cwd(), 'data'), 'tournament_outbox.json'));

  app.disable("x-powered-by");
  // The local Go edge may forward the real peer address. Direct remote peers
  // cannot choose their rate-limit bucket with an arbitrary forwarded header.
  app.set("trust proxy", process.env.TRUST_PROXY === "loopback" ? "loopback" : false);
  let shuttingDown = false;

  app.use(securityHeaders);

  // --- In-Memory Sliding Window Rate Limiter ---
  // Lightweight process readiness: no database calls or engine queue work.
  app.get("/api/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const ready = !shuttingDown && onlinePlay.storageHealthy() && tournamentRuntime.storageHealthy();
    res.status(ready ? 200 : 503).json({ ok: ready, component: "kentro-node" });
  });
  // Apply tiered rate limits across API route groups
  app.use("/api/engine", createRateLimiter({ windowMs: 60 * 1000, max: 120 }, "engine"));
  app.use("/api/coins", createRateLimiter({ windowMs: 60 * 1000, max: 60 }, "coins"));
  app.use("/api/admin", createRateLimiter({ windowMs: 60 * 1000, max: 100 }, "admin"));
  app.use("/api", createRateLimiter({ windowMs: 60 * 1000, max: 300 }, "api"));

  // Compress every compressible response (HTML/JS/CSS/JSON) -- on a mobile
  // connection this cuts first-load transfer of the app bundle dramatically.
  app.use(compression());
  const PORT = Number(process.env.PORT) || 3000;
  installBodyParsing(app, async req => !!await requirePermission(requestAccessToken(req.headers), "manage_puzzles"));
  app.use('/api/auth', createRateLimiter({ windowMs: 60_000, max: 12 }, 'account-auth'), createAccountAuthRouter());
  app.use('/api/tournaments', createRateLimiter({ windowMs: 60000, max: 30 }, 'tournament-runtime'), createTournamentRuntimeRouter(tournamentRuntime));
  app.use('/api/media', createRateLimiter({ windowMs: 60000, max: 12 }, 'media-configuration'), createMediaRouter());
  app.use('/api/tournaments', createRateLimiter({ windowMs: 60_000, max: 8 }, 'tournament-invite'), createTournamentInviteRouter());

  // Bootstrap only an explicitly configured Auth UID when no admin exists.
  // Username claims and profile edits must never bootstrap authority.
  if (process.env.SUPABASE_SECRET_KEY && process.env.BOOTSTRAP_ADMIN_UID) {
    try {
      const db = getSupabaseAdmin();
      const { data: existing, error: existingError } = await db.from("admins").select("username").limit(1);
      if (existingError) throw existingError;
      if (!existing || existing.length === 0) {
        const bootstrapUid = process.env.BOOTSTRAP_ADMIN_UID;
        const { data: profile, error: profileError } = await db.from("profiles").select("ownerId, usernameLower").eq("ownerId", bootstrapUid).maybeSingle();
        if (profileError) throw profileError;
        if (profile?.ownerId && profile.usernameLower) {
          const { error: bootstrapError } = await db.from("admins").upsert({
            username: profile.usernameLower,
            uid: bootstrapUid,
            permissions: [...ADMIN_PERMISSIONS],
            roleLabel: "Super Administrator",
            addedAt: Date.now(),
            addedBy: "bootstrap",
          });
          if (bootstrapError) throw bootstrapError;
          console.log("[Bootstrap] Registered the explicitly configured Auth user ID as the first admin.");
        } else {
          console.warn("[Bootstrap] BOOTSTRAP_ADMIN_UID has no canonical profile; administrator access was not granted.");
        }
      }
    } catch (err) {
      console.error("[Bootstrap] Failed to check/create first admin:", err);
    }
  }

  // Start the engine now instead of waiting for the first player to request a move.
  engine.warmUp();

  // --- Real-time Nigerian Draughts Ken Engine Endpoint ---
  app.post("/api/engine/move", async (req, res) => {
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    req.once("aborted", disconnected);
    res.once("close", disconnected);
    try {
      let options: ReturnType<typeof parseEngineMoveRequest>;
      try {
        options = parseEngineMoveRequest(req.body);
      } catch (err) {
        return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid engine request" });
      }
      options = await authorizeEngineRequest(req.body, requestAccessToken(req.headers), undefined, process.env.NODE_ENV !== "production" && !(process.env.SUPABASE_URL || process.env.SUPABASE_SECRET_KEY));
      if (controller.signal.aborted) return;
      const result = await engine.getMove(options.fen, options.thinkTimeSec, options.depth, true, options.usePst, options.supersedeKey, controller.signal);
      if (res.destroyed) return;
      res.json(result);
    } catch (err: any) {
      if (res.destroyed) return;
      if (err instanceof EngineAccessError) return res.status(err.status).json({ error: err.message });
      if (err?.message === "Superseded") {
        return res.status(499).json({ error: "Superseded by newer request" });
      }
      if (err?.message === "Engine queue busy") {
        res.setHeader("Retry-After", "1");
        return res.status(503).json({ error: "Engine is busy; please try again" });
      }
      console.error("Ken Engine API Error:", err?.message || err);
      res.status(500).json({ error: "Failed to evaluate board position" });
    } finally {
      req.off("aborted", disconnected);
      res.off("close", disconnected);
    }
  });

  app.get("/api/engine/health", async (_req, res) => {
    const isHealthy = await engine.ping();
    res.json({ ok: isHealthy, engine: "scan_nigerian" });
  });

  // VAPID key is public. Push keys/subscriptions are stored server-side only.
  app.get("/api/notifications/push-config", (_req,res) => res.json({ publicKey: vapidSettings()?.publicKey || null }));
  app.post("/api/notifications/push-subscribe", createRateLimiter({ windowMs:60_000,max:20 },"push-subscribe"), async (req,res) => {
    try {
      if (!vapidSettings()) return res.status(503).json({error:"Background push is not configured on this server."});
      const token = String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
      const uid = await verifyAccessToken(token);
      if (!uid) return res.status(401).json({error:"Sign in to enable notifications."});
      const subscription = validateSubscription(req.body?.subscription);
      if (!subscription) return res.status(400).json({error:"Invalid push subscription."});
      const allowed = ["challenge","friend","tournament","result","system"];
      const categories = Array.isArray(req.body?.categories) ? req.body.categories.filter((v:unknown) => typeof v === "string" && allowed.includes(v)).slice(0,5) : allowed;
      const {error} = await getSupabaseAdmin().from("kentro_push_subscriptions").upsert({endpoint:subscription.endpoint,recipient_id:uid,p256dh:subscription.keys.p256dh,auth:subscription.keys.auth,categories,last_seen_at:new Date().toISOString()},{onConflict:"endpoint"});
      if (error) throw error;
      res.json({ok:true});
    } catch (err) {console.error("[Push] subscribe",err);res.status(503).json({error:"Could not save push subscription."});}
  });
  app.post("/api/notifications/push-unsubscribe", createRateLimiter({ windowMs:60_000,max:20 },"push-unsubscribe"),async (req,res)=>{
    try {
      const uid = await verifyAccessToken(String(req.headers.authorization||"").replace(/^Bearer\s+/i,""));
      if (!uid) return res.status(401).json({error:"Sign in first."});
      const endpoint = req.body?.endpoint;
      if (!safePushEndpoint(endpoint)) return res.status(400).json({error:"Invalid endpoint."});
      const {error} = await getSupabaseAdmin().from("kentro_push_subscriptions").delete().eq("recipient_id",uid).eq("endpoint",endpoint);
      if (error) throw error;
      res.json({ok:true});
    } catch { res.status(503).json({error:"Unable to remove subscription."}); }
  });

  // Authenticated friend-to-friend online room challenge. Rate-limited, identity verified.
  let canChallengeFromRoom: (room: string, name: string) => boolean = () => false;
  app.post("/api/notifications/challenge", createRateLimiter({ windowMs: 60_000, max: 8 }, "friend-challenge"), async (req, res) => {
    try {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const uid = await verifyAccessToken(token);
      if (!uid) return res.status(401).json({ error: "Sign in to challenge a friend." });
      const roomId = String(req.body?.roomId || "").toUpperCase();
      const friend = String(req.body?.friendUsername || "").trim();
      if (!/^[A-Z0-9]{4,10}$/.test(roomId) || !/^[\w .-]{2,40}$/.test(friend)) return res.status(400).json({ error: "Enter a valid room and friend username." });
      const { data: profile } = await getSupabaseAdmin().from("profiles").select("username").eq("ownerId", uid).maybeSingle();
      const sender = profile?.username;
      if (!sender || !canChallengeFromRoom(roomId, sender)) return res.status(403).json({ error: "Host an open room before inviting a friend." });
      const targetId = await accountForUsername(friend);
      if (!targetId || targetId === uid) return res.status(404).json({ error: "That friend could not be found." });
      const { data: friendship } = await getSupabaseAdmin().from("friends").select("id")
        .eq("id", [sender.toLowerCase(), friend.toLowerCase()].sort().join("_")).eq("status", "accepted").maybeSingle();
      if (!friendship) return res.status(403).json({ error: "You can only challenge connected friends." });
      await insertNotification(targetId, "challenge", `${sender} challenged you!`, `Tap to join ${sender}'s draughts game.`, `/?room=${roomId}`, `challenge:${roomId}:${uid}`);
      res.json({ ok: true });
    } catch (err) { console.error("[Notifications] Challenge failed", err); res.status(503).json({ error: "Challenge delivery unavailable. Try copying the invite link." }); }
  });

  // --- Game Records, Results & Rematch System Endpoints ---
  app.get("/api/games/code/:gameCode", async (req, res) => {
    try {
      const { gameCode } = req.params;
      const game = await getGameRecordByCode(gameCode);
      const uid = game?.private ? await verifyAccessToken(requestAccessToken(req.headers)) : null;
      if (!game || !canReadGameRecord(game, uid)) {
        return res.status(404).json({ ok: false, error: "Game not found" });
      }
      res.json({ ok: true, game });
    } catch (err: any) {
      console.error("GET /api/games/code error:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  app.get("/api/games/recent", async (req, res) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
      const games = await getRecentGameRecords(limit);
      res.json({ ok: true, games });
    } catch (err: any) {
      console.error("GET /api/games/recent error:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  app.get("/api/games/series/:seriesId", async (req, res) => {
    try {
      const { seriesId } = req.params;
      const series = getSeriesById(seriesId);
      if (!series) return res.status(404).json({ ok: false, error: "Series not found" });
      const games = await Promise.all(series.games.map(summary => getGameRecordByCode(summary.gameCode)));
      const uid = games.some(game => game?.private) ? await verifyAccessToken(requestAccessToken(req.headers)) : null;
      if (games.some(game => !game || !canReadGameRecord(game, uid))) {
        return res.status(404).json({ ok: false, error: "Series not found" });
      }
      res.json({ ok: true, series });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  app.post("/api/games/next-code", (_req, res) => {
    try {
      const gameCode = getNextGameCode(rooms);
      res.json({ ok: true, gameCode });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: "Failed to generate game code" });
    }
  });

  app.post("/api/games/record", async (req, res) => {
    try {
      // Official records are produced by the authoritative game server.
      // This maintenance import route requires an explicit administrator.
      const admin = await requirePermission(requestAccessToken(req.headers), "view_games");
      if (!admin) return res.status(403).json({ ok: false, error: "Not authorized" });
      const data = req.body;
      if (!data || !/^\d{7,10}$/.test(String(data.gameCode || ""))) {
        return res.status(400).json({ ok: false, error: "Invalid gameCode" });
      }
      const saved = await recordGameEnd(data);
      res.json({ ok: true, game: saved });
    } catch (err: any) {
      console.error("POST /api/games/record error:", err);
      res.status(500).json({ ok: false, error: "Failed to record game" });
    }
  });

  let isLiveMultiplayerActive = () => false;

  // Review the actual starting position and reject invalid records before search.
  // An unavailable engine leaves the review pending rather than inventing scores.
  async function runServerSideGameAnalysis(game: any): Promise<Record<number, any> | null> {
    if (!game || !Array.isArray(game.moveHistory) || game.moveHistory.length === 0) return null;
    const metadata = game.moveEvaluations?.__kentroGameRecord || {};
    const startingPosition = game.startingPosition ?? metadata.startingPosition;
    const startingTurn = game.startingTurn ?? metadata.startingTurn ?? "W";
    const { boards, turns, moves } = replayForAnalysis(game.moveHistory, startingPosition, startingTurn);
    const posEvals: PositionEval[] = [];
    for (let index = 0; index < boards.length; index++) {
      const result = await engine.getMove(boardToScanFen(boards[index], turns[index]), 0.5, 30, false);
      if (!Number.isFinite(result.score)) throw new Error("Engine returned an invalid evaluation");
      const parsed = result.move ? hubMoveStringToNigerian(result.move) : null;
      posEvals.push({ score: result.score, bestMove: parsed });
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return Object.fromEntries(moves.map((move, index) => [index, {
      ...classifyMove(boards[index], turns[index], move, posEvals[index], posEvals[index + 1]), index,
    }]));
  }

  // API endpoint to trigger server-side deep analysis for any game ID immediately
  app.post("/api/engine/analyze-game", async (req, res) => {
    try {
      const { gameId } = req.body;
      if (!gameId || typeof gameId !== "string") {
        return res.status(400).json({ error: "gameId is required" });
      }

      const db = getSupabaseAdmin();
      const { data: game, error } = await db.from("completed_games").select("*").eq("gameId", gameId).maybeSingle();
      if (error || !game) {
        return res.status(404).json({ error: "Game not found" });
      }

      const uid = game.private ? await verifyAccessToken(requestAccessToken(req.headers)) : null;
      if (!canReadGameRecord(game, uid)) {
        return res.status(404).json({ error: "Game not found" });
      }

      const moveCount = Array.isArray(game.moveHistory) ? game.moveHistory.length : 0;
      if (game.moveEvaluations && Array.from({ length: moveCount }, (_, index) => index)
          .every(index => Object.prototype.hasOwnProperty.call(game.moveEvaluations, index))) {
        return res.json({ ok: true, alreadyAnalyzed: true, moveEvaluations: game.moveEvaluations });
      }

      const analysis = await runServerSideGameAnalysis(game);
      const moveEvaluations = analysis ? {
        ...analysis,
        ...(game.moveEvaluations?.__kentroGameRecord ? { __kentroGameRecord: game.moveEvaluations.__kentroGameRecord } : {}),
      } : null;
      if (moveEvaluations) {
        await db.from("completed_games").update({ moveEvaluations }).eq("gameId", gameId);
      }

      res.json({ ok: true, moveEvaluations });
    } catch (err) {
      console.error("Server-side game analysis error:", err);
      res.status(500).json({ error: "Failed to analyze game" });
    }
  });

  // Background loop: checks for un-analyzed completed_games only when server is idle
  let isAnalyzingBackground = false;
  setInterval(async () => {
    if (isAnalyzingBackground) return;
    // CRITICAL: Never steal CPU or starve event loop when live multiplayer is in progress
    if (isLiveMultiplayerActive()) return;
    isAnalyzingBackground = true;
    try {
      const db = getSupabaseAdmin();
      const { data: unanalyzedGames } = await db
        .from("completed_games")
        .select("*")
        .is("moveEvaluations", null)
        .order("timestamp", { ascending: false })
        .limit(1);

      if (unanalyzedGames && unanalyzedGames.length > 0 && !isLiveMultiplayerActive()) {
        const game = unanalyzedGames[0];
        if (game.moveHistory && game.moveHistory.length > 0) {
          console.log(`[Background Analysis] Idle worker analyzing game ${game.gameId} (${game.moveHistory.length} moves)...`);
          const evals = await runServerSideGameAnalysis(game);
          if (evals && !isLiveMultiplayerActive()) {
            await db.from("completed_games").update({ moveEvaluations: {
              ...evals,
              ...(game.moveEvaluations?.__kentroGameRecord ? { __kentroGameRecord: game.moveEvaluations.__kentroGameRecord } : {}),
            } }).eq("gameId", game.gameId);
            console.log(`[Background Analysis] Successfully analyzed game ${game.gameId}`);
          }
        }
      }
    } catch (err) {
      // background analysis error handled safely
    } finally {
      isAnalyzingBackground = false;
    }
  }, 60000);

  // ============================================================
  // KENTRO COINS
  // ============================================================

  // Read a wallet's balance + recent transactions. Requires the caller's own
  // verified access token to match the wallet's ownerId (or be an admin
  // with view_users) -- balances aren't public.
  app.get("/api/coins/wallet/:username", async (req, res) => {
    if (!KENTRO_COINS_ENABLED) { res.status(503).json({ error: "Kentro Coins are temporarily disabled." }); return; }
    try {
      const { username } = req.params;
      const cleanUname = username.toLowerCase().trim();
      const accessToken = requestAccessToken(req.headers);
      const uid = await verifyAccessToken(accessToken);
      if (!uid) return res.status(401).json({ error: "Not authenticated" });

      const db = getSupabaseAdmin();
      const { data: wallet } = await db.from("coin_wallets").select("balance, ownerId").eq("username", cleanUname).maybeSingle();
      const balance = (wallet?.balance as number) ?? 0;
      const ownerId = wallet?.ownerId ?? null;

      const { data: profileOwner, error: profileOwnerError } = await db.from("profiles")
        .select("ownerId").eq("usernameLower", cleanUname).maybeSingle();
      if (profileOwnerError) throw profileOwnerError;
      // RPC-created wallets may have a null ownerId; absence never grants access.
      if (profileOwner?.ownerId !== uid || (ownerId && ownerId !== uid)) {
        const admin = await getAdminByUid(uid);
        if (!admin || !admin.permissions.includes("view_users")) {
          return res.status(403).json({ error: "Not authorized to view this wallet" });
        }
      }

      const { data: txRows } = await db
        .from("coin_transactions")
        .select("*")
        .eq("username", cleanUname)
        .order("timestamp", { ascending: false })
        .limit(50);
      const transactions = (txRows ?? []).map((d) => ({ id: d.id, ...d }));

      // Full lifetime total, not just what's in the last-50 preview above --
      // a player's "how much have I bought" figure must be exact even after
      // they've made more than 50 transactions of other kinds (matches,
      // unlocks, etc.) that would otherwise push old purchases out of view.
      const { data: purchaseRows } = await db
        .from("coin_transactions")
        .select("amount")
        .eq("username", cleanUname)
        .eq("type", "purchase_credit");
      const lifetimeCoinsPurchased = (purchaseRows ?? []).reduce((sum, d) => sum + ((d.amount as number) || 0), 0);

      res.json({ balance, transactions, lifetimeCoinsPurchased });
    } catch (err) {
      console.error("Wallet fetch error:", err);
      res.status(500).json({ error: "Failed to load wallet" });
    }
  });

  // Spec: "Option 2 - Coin Unlock: Spend Kentro Coins to unlock any locked
  // AI level instantly" (or unlock all at once).
  app.post("/api/coins/unlock-ai-level", async (req, res) => {
    if (!KENTRO_COINS_ENABLED) { res.status(503).json({ error: "Kentro Coins are temporarily disabled." }); return; }
    try {
      const accessToken = requestAccessToken(req.headers);
      const uid = await verifyAccessToken(accessToken);
      if (!uid) return res.status(401).json({ error: "Not authenticated" });

      const { username, level } = req.body; // level: number (2-8) or "all"
      if (!username || (level !== "all" && (!Number.isInteger(level) || level < 2 || level > 8))) {
        return res.status(400).json({ error: "Invalid request" });
      }

      const db = getSupabaseAdmin();
      const cleanUname = String(username).toLowerCase().trim();
      const { data: profile } = await db.from("profiles").select("ownerId, maxUnlockedKenLevel").eq("usernameLower", cleanUname).maybeSingle();
      if (!profile || profile.ownerId !== uid) {
        return res.status(403).json({ error: "You can only unlock levels on your own profile" });
      }

      const settings = await getCoinSettings();
      const cost = level === "all" ? settings.aiUnlockAllCost : settings.aiUnlockCostPerLevel;

      const { data: result, error: unlockError } = await db.rpc("kentro_unlock_ai", {
        p_owner: uid, p_username: cleanUname, p_level: level === "all" ? 8 : level, p_cost: cost,
      });
      if (unlockError) throw unlockError;
      if (!result?.ok) return res.status(402).json({ error: "Not enough Kentro Coins", balance: result?.balance, cost });
      res.json(result);
    } catch (err) {
      console.error("AI unlock purchase error:", err);
      res.status(500).json({ error: "Failed to process unlock" });
    }
  });

  // Tournament entry fee. Called by the client right before registering for
  // a tournament (see TournamentDashboard.tsx) -- deducted server-side so it
  // can't be skipped by editing client state.
  // Tournament entry: registers the player AND deducts the entry fee as ONE
  // atomic operation via the tournament_entry() Postgres function (see
  // supabase/schema.sql). Previously these were two separate steps (this
  // endpoint only debited; the roster add happened in a later, separate
  // client-side update) which meant a payment could succeed with no
  // registration ever completing (if the follow-up write failed -- network
  // blip, tab closed), and let two players racing for the last open slot
  // both get charged and both get written past maxPlayers, since capacity
  // was only checked against the client's possibly-stale local tournament
  // data. Mirrors the pattern already used correctly by
  // /api/coins/unlock-ai-level (one atomic server operation, not two).
  app.post("/api/coins/tournament-entry", async (req, res) => {
    if (!KENTRO_COINS_ENABLED) { res.status(503).json({ error: "Kentro Coins are temporarily disabled." }); return; }
    try {
      const accessToken = requestAccessToken(req.headers);
      const uid = await verifyAccessToken(accessToken);
      if (!uid) return res.status(401).json({ error: "Not authenticated" });

      const { tournamentId, playerData } = req.body;
      if (typeof tournamentId !== 'string' || !tournamentId || tournamentId.length > 160) return res.status(400).json({ error: "Invalid request" });

      // Identity comes from the VERIFIED token, never the request body.
      // (Previously body.username was trusted after only checking that the
      // caller was logged in as *somebody* -- letting any signed-in user
      // register, and charge the entry fee to, any other player's wallet.)
      const { data: profileRow } = await getSupabaseAdmin()
        .from("profiles").select("username, usernameLower, elo").eq("ownerId", uid).maybeSingle();
      if (!profileRow?.usernameLower) return res.status(403).json({ error: "No profile for this account" });
      const username = profileRow.username;          // canonical case, for the roster
      const walletKey = profileRow.usernameLower;    // wallet rows are lowercase-keyed

      const settings = await getCoinSettings();
      // The fee is ALWAYS the server's own configured default -- never taken
      // from the request body. The old version accepted a client-supplied
      // `entryFee` and used it directly if positive, so a modified client
      // could pay almost nothing for a tournament regardless of its real cost.
      const fee = settings.tournamentEntryFeeDefault;

      const newPlayer = {
        username,
        rating: Number.isFinite(Number(profileRow.elo)) ? Number(profileRow.elo) : 1500,
        wins: 0,
        losses: 0,
        draws: 0,
        points: 0,
        streak: 0,
        country: typeof playerData?.country === "string" ? playerData.country : "NG",
        isHuman: true,
        team: typeof playerData?.team === "string" ? playerData.team.trim().slice(0, 40) : undefined,
      };

      const { data, error } = await getSupabaseAdmin().rpc("tournament_entry", {
        p_tournament_id: tournamentId,
        p_username: walletKey,
        p_entry_fee: fee,
        p_player: newPlayer,
        p_log_line: `${username} joined the tournament.`,
      });
      if (error) throw error;
      const result = data?.[0] as { ok: boolean; errorReason: string | null; balance: number | null; players: any[] | null } | undefined;
      if (!result) throw new Error("tournament_entry returned no result");

      if (!result.ok) {
        if (result.errorReason === "insufficient_funds") {
          return res.status(402).json({ error: "Not enough Kentro Coins", balance: result.balance, cost: fee });
        }
        if (result.errorReason === "full") return res.status(409).json({ error: "Tournament is full" });
        if (result.errorReason === "already_registered") return res.status(409).json({ error: "Already registered", players: result.players });
        if (result.errorReason === "not_open") return res.status(409).json({ error: "Registration is closed for this tournament" });
        if (result.errorReason === "not_allowed") return res.status(403).json({ error: "Redeem a valid invitation before joining this private tournament." });
        return res.status(404).json({ error: "Tournament not found" });
      }

      // Note: coin_transactions logging for this now happens inside the
      // tournament_entry() RPC itself (atomic with the debit), not here --
      // logging it again on this side would double it up.

      res.json({ ok: true, balance: result.balance, players: result.players });
    } catch (err) {
      console.error("Tournament entry error:", err);
      res.status(500).json({ error: "Failed to process tournament entry" });
    }
  });

  // Submits a withdrawal request: validates eligibility, escrows (debits)
  // the coins immediately so they can't also be spent/wagered while the
  // request is pending, and queues it for admin review. Approving later
  // just marks it paid (the money already left the wallet); rejecting
  // refunds the escrowed coins back.
  app.post("/api/coins/withdraw-request", async (req, res) => {
    if (!KENTRO_COINS_ENABLED) { res.status(503).json({ error: "Kentro Coins are temporarily disabled." }); return; }
    try {
      const accessToken = requestAccessToken(req.headers);
      const uid = await verifyAccessToken(accessToken);
      if (!uid) return res.status(401).json({ error: "Not authenticated" });

      const { coins, accountName, accountNumber, bankName } = req.body;
      // Identity from the VERIFIED token only. The old version trusted
      // body.username after merely confirming the caller was logged in as
      // *somebody* -- letting any player escrow-lock ANY other player's
      // entire balance into a withdrawal pointed at the attacker's own
      // bank account details. Same class of hole as the tournament-entry
      // one; same fix.
      const { data: wProfile } = await getSupabaseAdmin()
        .from("profiles").select("usernameLower").eq("ownerId", uid).maybeSingle();
      const uname = wProfile?.usernameLower || "";
      const requestedCoins = Number(coins);
      if (!uname || !Number.isSafeInteger(requestedCoins) || requestedCoins <= 0 || !accountName || !accountNumber) {
        return res.status(400).json({ error: "Invalid request" });
      }

      const settings = await getCoinSettings();
      const eligibility = await checkWithdrawalEligibility(uname, uid, requestedCoins, settings);
      if (!eligibility.eligible) {
        return res.status(400).json({ error: eligibility.reason || "Not eligible to withdraw", balance: eligibility.balance });
      }

      const nairaAmount = Math.floor((requestedCoins / 100) * settings.withdrawalRatePerHundredCoins);
      if (typeof accountName !== "string" || !accountName.trim() || accountName.trim().length > 120 ||
          typeof accountNumber !== "string" || !/^[0-9]{10}$/.test(accountNumber.trim())) {
        return res.status(400).json({ error: "A valid account name and 10-digit account number are required" });
      }
      // Escrow and request creation commit together; failed inserts cannot strand funds.
      const { data: result, error: requestError } = await getSupabaseAdmin().rpc("kentro_create_withdrawal", {
        p_owner: uid, p_username: uname, p_coins: requestedCoins, p_naira: nairaAmount,
        p_account_name: accountName.trim(), p_account_number: accountNumber.trim(),
        p_bank: typeof bankName === "string" ? bankName.trim().slice(0,120) : null,
      });
      if (requestError) throw requestError;
      if (!result?.ok) return res.status(400).json({ error: "Not enough Kentro Coins", balance: result?.balance });
      res.json(result);
    } catch (err) {
      console.error("withdraw-request error:", err);
      res.status(500).json({ error: "Failed to submit withdrawal request" });
    }
  });

  // Admin resolves a pending withdrawal: "paid" just records that the OPay
  // transfer was sent by hand (the coins already left the wallet at request
  // time); "rejected" refunds the escrowed coins back.
  app.post("/api/admin/resolve-withdrawal", async (req, res) => {
    if (!KENTRO_COINS_ENABLED) { res.status(503).json({ error: "Kentro Coins are temporarily disabled." }); return; }
    const accessToken = requestAccessToken(req.headers);
    const { requestId, approve } = req.body;
    const admin = await requirePermission(accessToken, "manage_payments");
    if (!admin) return res.status(403).json({ error: "Not authorized" });

    try {
      if (typeof approve !== "boolean" || typeof requestId !== "string") return res.status(400).json({ error: "Invalid request" });
      const { data: result, error } = await getSupabaseAdmin().rpc("kentro_resolve_withdrawal", {
        p_id: requestId, p_approve: approve, p_admin: admin.username,
      });
      if (error) throw error;
      if (!result?.ok) return res.status(result?.error === "not_found" ? 404 : 409).json({ error: result?.error || "Failed to resolve request" });
      await writeAuditLog({ adminUsername: admin.username, adminUid: admin.uid,
        action: approve ? "approve_withdrawal" : "reject_withdrawal", target: result.username,
        details: { requestId, coins: result.coins }, result: "success" });
      res.json({ ok: true });
    } catch (err) {
      console.error("resolve-withdrawal error:", err);
      res.status(500).json({ error: "Failed to resolve withdrawal" });
    }
  });

  app.get("/api/admin/pending-withdrawals", async (req, res) => {
    if (!KENTRO_COINS_ENABLED) { res.status(503).json({ error: "Kentro Coins are temporarily disabled." }); return; }
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_payments");
    if (!admin) return res.status(403).json({ error: "Not authorized" });
    const { data, error } = await getSupabaseAdmin().from("withdrawal_requests").select("*").eq("status", "pending").order("submittedAt", { ascending: false });
    if (error) return res.status(500).json({ error: "Failed to load pending withdrawals" });
    res.json({ requests: data ?? [] });
  });

  app.get("/api/coins/settings", async (_req, res) => {
    res.json({ ...(await getCoinSettings()), coinsEnabled: KENTRO_COINS_ENABLED });
  });

  // ============================================================
  // ADMIN
  // ============================================================

  // Tells the client whether the currently-signed-in Supabase user id is an
  // admin, and with which permissions -- this is how the hidden admin panel
  // decides whether to render anything at all.
  //
  // NOTE: every admin endpoint below now reads its caller's token from the
  // x-access-token header only. The old code read `req.body.idToken` /
  // `req.query.idToken` instead, which worked (apiClient.ts sent the same
  // token redundantly in the body/query AND the header) but meant a GET
  // request's token could land in server access logs / browser history via
  // the query string. Consolidated onto the header-only approach it already
  // used for the coins endpoints, since every line here already needed
  // touching for the Supabase swap anyway.
  app.post("/api/admin/whoami", async (req, res) => {
    if (!KENTRO_ADMIN_ENABLED) { res.status(503).json({ error: "Admin features are temporarily disabled." }); return; }
    try {
      const accessToken = requestAccessToken(req.headers);
      const uid = await verifyAccessToken(accessToken);
      if (!uid) return res.json({ isAdmin: false });
      const admin = await getAdminByUid(uid);
      if (!admin) return res.json({ isAdmin: false });
      res.json({ isAdmin: true, username: admin.username, permissions: admin.permissions, roleLabel: admin.roleLabel || null });
    } catch (err) {
      console.error("Admin whoami error:", err);
      res.json({ isAdmin: false });
    }
  });

  app.get("/api/admin/permissions-list", (_req, res) => {
    res.json({ permissions: ADMIN_PERMISSIONS });
  });

  // Add a new admin or change an existing admin's permissions. The target
  // is identified by the Supabase user id currently active in THEIR browser
  // (they must be present, on the admin's screen, so their live uid can be
  // captured -- see the admin panel UI) since usernames alone aren't a
  // secure identity in this app.
  app.post("/api/admin/set-admin", async (req, res) => {
    if (!KENTRO_ADMIN_ENABLED) { res.status(503).json({ error: "Admin features are temporarily disabled." }); return; }
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_admins");
    if (!admin) return res.status(403).json({ error: "Not authorized" });

    try {
      const { targetUsername, targetUid, permissions, roleLabel } = req.body;
      if (!targetUsername || !targetUid || !Array.isArray(permissions)) {
        return res.status(400).json({ error: "Invalid request" });
      }
      const validPerms = permissions.filter((p: string) => (ADMIN_PERMISSIONS as readonly string[]).includes(p));

      const db = getSupabaseAdmin();
      const { error } = await db.from("admins").upsert({
        username: targetUsername.toLowerCase().trim(),
        uid: targetUid,
        permissions: validPerms,
        roleLabel: roleLabel || null,
        addedAt: Date.now(),
        addedBy: admin.username,
      });
      if (error) throw error;

      await writeAuditLog({
        adminUsername: admin.username,
        adminUid: admin.uid,
        action: "set_admin_permissions",
        target: targetUsername,
        details: { permissions: validPerms },
        result: "success",
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("set-admin error:", err);
      res.status(500).json({ error: "Failed to update admin" });
    }
  });

  app.post("/api/admin/remove-admin", async (req, res) => {
    if (!KENTRO_ADMIN_ENABLED) { res.status(503).json({ error: "Admin features are temporarily disabled." }); return; }
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_admins");
    if (!admin) return res.status(403).json({ error: "Not authorized" });

    try {
      const { targetUsername } = req.body;
      if (!targetUsername) return res.status(400).json({ error: "Invalid request" });
      const { error } = await getSupabaseAdmin().from("admins").delete().eq("username", String(targetUsername).toLowerCase().trim());
      if (error) throw error;
      await writeAuditLog({
        adminUsername: admin.username,
        adminUid: admin.uid,
        action: "remove_admin",
        target: targetUsername,
        result: "success",
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("remove-admin error:", err);
      res.status(500).json({ error: "Failed to remove admin" });
    }
  });

  app.get("/api/admin/list-admins", async (req, res) => {
    if (!KENTRO_ADMIN_ENABLED) { res.status(503).json({ error: "Admin features are temporarily disabled." }); return; }
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_admins");
    if (!admin) return res.status(403).json({ error: "Not authorized" });
    const { data, error } = await getSupabaseAdmin().from("admins").select("*");
    if (error) return res.status(500).json({ error: "Failed to list admins" });
    res.json({ admins: data ?? [] });
  });

  // Full profile for one player, for the "tap a name -> see everything"
  // admin view. Bundles data that's spread across several RLS-scoped
  // tables (coin_wallets is owner-only, audit_logs has no client policies
  // at all) into one service-role call instead of making the panel piece
  // it together client-side. Gated on view_users -- the same permission
  // that already controls whether the Users tab is visible at all, so this
  // doesn't need its own separate permission tier.
  app.get("/api/admin/user-detail", async (req, res) => {
    if (!KENTRO_ADMIN_ENABLED) { res.status(503).json({ error: "Admin features are temporarily disabled." }); return; }
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "view_users");
    if (!admin) return res.status(403).json({ error: "Not authorized" });

    try {
      const uname = String(req.query.username || "").toLowerCase().trim();
      if (!uname) return res.status(400).json({ error: "Missing username" });

      const db = getSupabaseAdmin();

      const { data: profile } = await db.from("profiles").select("*").eq("usernameLower", uname).maybeSingle();
      if (!profile) return res.status(404).json({ error: "No user with that username" });

      const [{ data: wallet }, { data: games }, { data: modLog }] = await Promise.all([
        db.from("coin_wallets").select("balance").eq("username", uname).maybeSingle(),
        db.from("completed_games")
          .select("gameId, whitePlayer, blackPlayer, winner, playMode, timestamp")
          .or(`whitePlayer.eq.${profile.username},blackPlayer.eq.${profile.username}`)
          .order("timestamp", { ascending: false })
          .limit(15),
        db.from("audit_logs")
          .select("adminUsername, action, details, timestamp")
          .eq("target", profile.username)
          .like("action", "user_%")
          .order("timestamp", { ascending: false })
          .limit(10),
      ]);

      res.json({
        profile,
        coinBalance: wallet?.balance ?? 0,
        recentGames: games ?? [],
        moderationHistory: modLog ?? [],
      });
    } catch (err) {
      console.error("user-detail error:", err);
      res.status(500).json({ error: "Failed to load user detail" });
    }
  });

  // User management actions (suspend/ban/unban/edit username/reset rating).
  app.post("/api/admin/user-action", async (req, res) => {
    if (!KENTRO_ADMIN_ENABLED) { res.status(503).json({ error: "Admin features are temporarily disabled." }); return; }
    const accessToken = requestAccessToken(req.headers);
    const { action, targetUsername, newValue } = req.body;
    const permissionNeeded: AdminPermission =
      action === "ban" || action === "delete" ? "ban_users" :
      action === "suspend" || action === "unban" || action === "unsuspend" ? "suspend_users" :
      "edit_users";
    const admin = await requirePermission(accessToken, permissionNeeded);
    if (!admin) return res.status(403).json({ error: "Not authorized" });

    try {
      if (!targetUsername || typeof targetUsername !== "string") {
        return res.status(400).json({ error: "Invalid target" });
      }
      const db = getSupabaseAdmin();
      const uname = targetUsername.toLowerCase().trim();
      let details: Record<string, unknown> = {};
      const updateProfile = async (changes: Record<string, unknown>, revokeAccess = false) => {
        const { data: changed, error } = await db.from("profiles").update(changes)
          .eq("usernameLower", uname).select("ownerId").maybeSingle();
        if (error) throw error;
        if (!changed) throw new Error("Target profile not found");
        if (revokeAccess && changed.ownerId) onlinePlay.revokeUser(changed.ownerId);
      };

      switch (action) {
        case "ban":
          await updateProfile({ banned: true, bannedAt: Date.now(), bannedBy: admin.username }, true);
          break;
        case "unban":
          await updateProfile({ banned: false });
          break;
        case "suspend": {
          const until = typeof newValue === "number" ? newValue : Date.now() + 24 * 60 * 60 * 1000;
          if (!Number.isSafeInteger(until)) return res.status(400).json({ error: "Invalid suspension time" });
          await updateProfile({ suspendedUntil: until, suspendedBy: admin.username }, until > Date.now());
          details = { until };
          break;
        }
        case "unsuspend":
          await updateProfile({ suspendedUntil: null });
          break;
        case "edit_username":
          return res.status(400).json({ error: "Username changes require a row migration, not supported yet." });
        case "reset_rating":
          await updateProfile({ elo: 1500 });
          break;
        case "delete":
          // Wallet deletion cascades through the immutable financial ledger.
          // Account erasure needs a reviewed retention/settlement workflow.
          return res.status(409).json({ error: "Account deletion requires a reviewed retention and settlement workflow. Use suspension or ban for immediate access removal." });
        default:
          return res.status(400).json({ error: "Unknown action" });
      }

      await writeAuditLog({
        adminUsername: admin.username,
        adminUid: admin.uid,
        action: `user_${action}`,
        target: targetUsername,
        details,
        result: "success",
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("user-action error:", err);
      try { await writeAuditLog({
        adminUsername: admin.username,
        adminUid: admin.uid,
        action: `user_${action}`,
        target: targetUsername,
        result: "failure",
      }); } catch (auditError) { console.error("user-action failure audit error:", auditError); }
      res.status(500).json({ error: "Action failed" });
    }
  });

  // Approve or reject a pending purchase_requests row (bank-transfer
  // receipt) -- approving credits the corresponding coin package to the
  // buyer's wallet.
  app.post("/api/admin/resolve-purchase", async (req, res) => {
    if (!KENTRO_COINS_ENABLED) { res.status(503).json({ error: "Kentro Coins are temporarily disabled." }); return; }
    const accessToken = requestAccessToken(req.headers);
    const { requestId, approve } = req.body;
    const admin = await requirePermission(accessToken, "manage_payments");
    if (!admin) return res.status(403).json({ error: "Not authorized" });

    try {
      if (typeof approve !== "boolean" || typeof requestId !== "string") return res.status(400).json({ error: "Invalid request" });
      const db = getSupabaseAdmin();
      const { data: reqData, error: fetchError } = await db.from("purchase_requests").select("packageId").eq("id", requestId).maybeSingle();
      if (fetchError) throw fetchError;
      if (!reqData) return res.status(404).json({ error: "Request not found" });
      const settings = await getCoinSettings();
      const pkg = settings.coinPackages.find(p => p.id === reqData.packageId);
      if (approve && (!pkg || !Number.isSafeInteger(pkg.coins) || pkg.coins<=0)) {
        return res.status(400).json({ error: "Purchase package is unavailable; review this request before approval" });
      }
      // Claim, canonical-owner lookup and credit are one database transaction.
      const { data: result, error } = await db.rpc("kentro_resolve_purchase", {
        p_id: requestId, p_approve: approve, p_admin: admin.username, p_coins: pkg?.coins ?? 0,
      });
      if (error) throw error;
      if (!result?.ok) return res.status(result?.error === "not_found" ? 404 : 409).json({ error: result?.error || "Failed to resolve request" });
      await writeAuditLog({ adminUsername: admin.username, adminUid: admin.uid,
        action: approve ? "approve_purchase" : "reject_purchase", target: result.username,
        details: { requestId, coinsCredited: approve ? result.coins : 0 }, result: "success" });
      res.json({ ok: true });
    } catch (err) {
      console.error("resolve-purchase error:", err);
      res.status(500).json({ error: "Failed to resolve purchase" });
    }
  });

  // Manual coin credit/debit adjustment (tournament prizes, refunds, support fixes).
  // Pays out a completed tournament's accumulated prize pool (entry fees
  // collected, minus the configured rake) to a winner the admin confirms.
  // Deliberately admin-confirmed rather than auto-detected: tournament
  // formats here (Swiss, handicap, custom) are flexible enough that
  // reliably auto-computing "who actually won" isn't a safe bet with real
  // money on the line. The money movement itself (rake math, crediting,
  // marking paid) is fully atomic and can only ever happen once per
  // tournament -- see pay_tournament_prize() in supabase/schema.sql.
  app.post("/api/admin/pay-tournament-prize", async (req, res) => {
    if (!KENTRO_COINS_ENABLED) { res.status(503).json({ error: "Kentro Coins are temporarily disabled." }); return; }
    const accessToken = requestAccessToken(req.headers);
    const { tournamentId, winnerUsername } = req.body;
    const admin = await requirePermission(accessToken, "manage_tournaments");
    if (!admin) return res.status(403).json({ error: "Not authorized" });

    try {
      if (!tournamentId || !winnerUsername) return res.status(400).json({ error: "Invalid request" });

      const settings = await getCoinSettings();
      const { data: tournament, error: lookupError } = await getSupabaseAdmin().from('tournaments').select('engineState').eq('id', tournamentId).single();
      if (lookupError) throw lookupError;
      const canonical = Array.isArray(tournament?.engineState?.champions) && tournament.engineState.champions.length > 0;
      if (canonical && !tournament.engineState.champions.some((name: string) => name.toLowerCase() === String(winnerUsername).toLowerCase().trim())) return res.status(409).json({ error: 'Only the canonical tournament champions can receive the prize.' });
      const { data, error } = canonical
        ? await getSupabaseAdmin().rpc('kentro_pay_completed_tournament', { p_id: tournamentId, p_rake: settings.tournamentRakePercent })
        : await getSupabaseAdmin().rpc('pay_tournament_prize', { p_tournament_id: tournamentId, p_winner_username: String(winnerUsername).toLowerCase().trim(), p_rake_percent: settings.tournamentRakePercent });
      if (error) throw error;
      const result = (canonical ? data : data?.[0]) as { ok: boolean; errorReason: string | null; payout: number | null; rake: number | null } | undefined;
      if (!result) throw new Error("pay_tournament_prize returned no result");

      if (!result.ok) {
        if (result.errorReason === "already_paid") return res.status(409).json({ error: "This tournament's prize has already been paid out" });
        if (result.errorReason === "not_a_player") return res.status(409).json({ error: "That player is not on this tournament's roster" });
        if (result.errorReason === "no_paid_entry") return res.status(409).json({ error: "That player has no logged entry-fee payment for this tournament — a forged roster entry cannot be paid" });
        return res.status(404).json({ error: "Tournament not found" });
      }

      await writeAuditLog({
        adminUsername: admin.username, adminUid: admin.uid, action: "pay_tournament_prize",
        target: winnerUsername, details: { tournamentId, payout: result.payout, rake: result.rake }, result: "success",
      });

      res.json({ ok: true, payout: result.payout, rake: result.rake });
    } catch (err) {
      console.error("pay-tournament-prize error:", err);
      res.status(500).json({ error: "Failed to pay tournament prize" });
    }
  });

  // ------------------------------------------------------------------
  // Admin: tournament management (Admin Panel -> Tournaments tab).
  // Creation/deletion use the service-role key, so this works even if the
  // client-side RLS path is unavailable; every action is audit-logged.
  // ------------------------------------------------------------------

  app.get("/api/admin/tournaments", async (req, res) => {
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_tournaments");
    if (!admin) return res.status(403).json({ error: "Not authorized" });
    try {
      const { data, error } = await getSupabaseAdmin()
        .from("tournaments")
        .select('"id", "name", "type", "visibility", "inviteCode", "status", "maxPlayers", "timeControl", "prize", "prizePool", "prizePaid", "players", "createdAt"')
        .order("createdAt", { ascending: false })
        .limit(60);
      if (error) throw error;
      const list = (data ?? []).map((t: any) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        visibility: t.visibility,
        inviteCode: t.inviteCode,
        status: t.status,
        maxPlayers: t.maxPlayers,
        timeControl: t.timeControl,
        prize: t.prize,
        prizePool: Number(t.prizePool) || 0,
        prizePaid: !!t.prizePaid,
        playerCount: Array.isArray(t.players) ? t.players.length : 0,
        createdAt: t.createdAt,
      }));
      res.json({ tournaments: list });
    } catch (err) {
      console.error("admin tournaments list error:", err);
      res.status(500).json({ error: "Failed to load tournaments" });
    }
  });

  app.post("/api/admin/tournaments", async (req, res) => {
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_tournaments");
    if (!admin) return res.status(403).json({ error: "Not authorized" });

    try {
      const b = req.body ?? {};
      const name = String(b.name || "").trim().slice(0, 80);
      if (!name) return res.status(400).json({ error: "Tournament name is required" });

      const TYPES = ["Swiss System", "Knockout Bracket", "Round Robin", "Arena Blitz", "Swiss Tournament", "Arena Tournament", "Single Elimination", "Double Elimination", "Team Tournament", "League Tournament", "Knockout Cup", "Group Stage + Knockout", "King of the Hill", "Robin Hood Tournament (Handicap Tournament)", "Custom Tournament"];
      const type = TYPES.includes(b.type) ? b.type : "Swiss System";
      const visibility = b.visibility === "private" ? "private" : "public";
      const inviteCode = visibility === "private"
        ? randomBytes(12).toString('hex').toUpperCase()
        : "";
      const maxPlayers = Math.min(64, Math.max(2, Math.trunc(Number(b.maxPlayers) || 8)));
      const minPlayers = Math.min(maxPlayers, Math.max(2, Math.trunc(Number(b.minPlayers) || 2)));
      const TIME_CONTROLS = ["Blitz 5m", "Rapid 10m", "Classical 20m", "Untimed"];
      const timeControl = TIME_CONTROLS.includes(b.timeControl) ? b.timeControl : "Blitz 5m";
      const HANDICAPS = ["None", "Short One", "Short Two", "Short Three", "Crown Crown"];
      const handicap = HANDICAPS.includes(b.handicap) ? b.handicap : "None";
      const tieBreak = String(b.tieBreak || "Buchholz Score").slice(0, 40);
      const prize = String(b.prize || "Bragging rights + trophy 🏆").slice(0, 160);
      const spectatorPermission = b.spectatorPermission !== false;

      // Competitors are registered by the authoritative entry RPC. There is
      // no tournament AI scheduling worker, so do not invent an AI entrant.
      const players: any[] = [];

      const tourId = `tour_${randomUUID()}`;
      const newTour = {
        id: tourId,
        name,
        description: String(b.description || "Kentro Draughts official tournament.").slice(0, 400),
        type,
        visibility,
        inviteCode,
        maxPlayers,
        minPlayers,
        registrationDeadline: String(b.registrationDeadline || "Immediate").slice(0, 60),
        startTime: String(b.startTime || "Immediate").slice(0, 60),
        timeControl,
        handicap,
        tieBreak,
        prize,
        spectatorPermission,
        status: "registration",
        currentRound: 1,
        maxRounds: type.includes("Arena") ? 1 : 3,
        players,
        matches: [],
        chat: [{
          id: "welcome", sender: "Organizer",
          message: `Welcome to ${name}! Registration is open — match pairings start once the tournament goes active.`,
          timestamp: Date.now(), isAnnouncement: true,
        }],
        logs: [`Tournament created by admin ${admin.username}.`],
        createdAt: new Date().toISOString(),
      };

      const { error } = await getSupabaseAdmin().from("tournaments").insert(newTour);
      if (error) throw error;

      await writeAuditLog({
        adminUsername: admin.username, adminUid: admin.uid, action: "create_tournament",
        details: { tournamentId: tourId, name, type, visibility, maxPlayers, timeControl, handicap }, result: "success",
      });
      res.json({ ok: true, id: tourId, inviteCode, tournament: newTour });
    } catch (err) {
      console.error("admin create tournament error:", err);
      res.status(500).json({ error: "Failed to create tournament" });
    }
  });

  app.post("/api/admin/tournaments/delete", async (req, res) => {
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_tournaments");
    if (!admin) return res.status(403).json({ error: "Not authorized" });
    try {
      const tournamentId = String(req.body?.tournamentId || "");
      if (!tournamentId) return res.status(400).json({ error: "Missing tournamentId" });

      // Never silently delete a tournament that still holds an unpaid prize
      // pool -- entry fees would vanish. Refund first (refund-tournament),
      // then delete.
      const { data: tour, error: readErr } = await getSupabaseAdmin()
        .from("tournaments").select('"prizePool", "prizePaid", "name"').eq("id", tournamentId).maybeSingle();
      if (readErr) throw readErr;
      if (!tour) return res.status(404).json({ error: "Tournament not found" });
      if (Number(tour.prizePool) > 0 && !tour.prizePaid) {
        return res.status(409).json({ error: "This tournament still holds an unpaid prize pool — refund or pay it out first (Coins & Pricing → tournament pools)." });
      }

      const { error } = await getSupabaseAdmin().from("tournaments").delete().eq("id", tournamentId);
      if (error) throw error;
      await writeAuditLog({
        adminUsername: admin.username, adminUid: admin.uid, action: "delete_tournament",
        details: { tournamentId, name: tour.name }, result: "success",
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("admin delete tournament error:", err);
      res.status(500).json({ error: "Failed to delete tournament" });
    }
  });

  // Cancels a tournament financially: refunds every logged entry fee and
  // closes the pool (idempotent; a paid-out tournament can't be refunded).
  app.post("/api/admin/refund-tournament", async (req, res) => {
    if (!KENTRO_COINS_ENABLED) { res.status(503).json({ error: "Kentro Coins are temporarily disabled." }); return; }
    const accessToken = requestAccessToken(req.headers);
    const { tournamentId } = req.body;
    const admin = await requirePermission(accessToken, "manage_tournaments");
    if (!admin) return res.status(403).json({ error: "Not authorized" });
    try {
      if (!tournamentId) return res.status(400).json({ error: "Invalid request" });
      const { data, error } = await getSupabaseAdmin().rpc("refund_tournament_entries", { p_tournament_id: tournamentId });
      if (error) throw error;
      const result = data?.[0] as { ok: boolean; errorReason: string | null; refundedCount: number; refundedTotal: number } | undefined;
      if (!result) throw new Error("refund_tournament_entries returned no result");
      if (!result.ok) {
        if (result.errorReason === "already_settled") return res.status(409).json({ error: "This tournament was already paid out or refunded" });
        return res.status(404).json({ error: "Tournament not found" });
      }
      await writeAuditLog({
        adminUsername: admin.username, adminUid: admin.uid, action: "refund_tournament",
        target: tournamentId, details: { refundedCount: result.refundedCount, refundedTotal: result.refundedTotal }, result: "success",
      });
      res.json({ ok: true, refundedCount: result.refundedCount, refundedTotal: result.refundedTotal });
    } catch (err) {
      console.error("refund-tournament error:", err);
      res.status(500).json({ error: "Failed to refund tournament" });
    }
  });

  app.post("/api/admin/adjust-coins", async (req, res) => {
    if (!KENTRO_COINS_ENABLED) { res.status(503).json({ error: "Kentro Coins are temporarily disabled." }); return; }
    const accessToken = requestAccessToken(req.headers);
    const { targetUsername, amount, direction, reason } = req.body;
    const admin = await requirePermission(accessToken, "credit_coins");
    if (!admin) return res.status(403).json({ error: "Not authorized" });

    try {
      if (!targetUsername || typeof amount !== "number" || amount <= 0) {
        return res.status(400).json({ error: "Invalid request" });
      }
      let balance: number;
      if (direction === "credit") {
        balance = await creditWallet(targetUsername, amount, "admin_adjustment", reason);
      } else {
        const result = await debitWallet(targetUsername, amount, "admin_adjustment", reason);
        if (!result.ok) return res.status(402).json({ error: "User doesn't have enough coins for this debit" });
        balance = result.balance;
      }

      await writeAuditLog({
        adminUsername: admin.username, adminUid: admin.uid, action: `coins_${direction}`,
        target: targetUsername, details: { amount, reason }, result: "success",
      });

      res.json({ ok: true, balance });
    } catch (err) {
      console.error("adjust-coins error:", err);
      res.status(500).json({ error: "Failed to adjust coins" });
    }
  });

  // Update coin pricing (entry fees, AI unlock costs, purchasable packages).
  app.post("/api/admin/coin-settings", async (req, res) => {
    if (!KENTRO_COINS_ENABLED) { res.status(503).json({ error: "Kentro Coins are temporarily disabled." }); return; }
    const accessToken = requestAccessToken(req.headers);
    const { settings } = req.body;
    const admin = await requirePermission(accessToken, "manage_coin_settings");
    if (!admin) return res.status(403).json({ error: "Not authorized" });

    try {
      // Mirrors the old Firestore `{merge:true}` shallow-merge behavior --
      // only the keys present in `settings` are overwritten, the rest of
      // the stored jsonb blob is left as-is.
      const db = getSupabaseAdmin();
      const { data: existing } = await db.from("app_config").select("data").eq("id", "coinSettings").maybeSingle();
      const merged = { ...(existing?.data as any ?? {}), ...settings };
      // Safety clamps: rake is a percentage of the pot; cap at 50% so a
      // slipped decimal (e.g. typing 10 instead of 0.10) can never eat an
      // entire pot. The UI sends fractions (0.10 = 10%).
      if (typeof merged.matchRakePercent === "number") merged.matchRakePercent = Math.min(0.5, Math.max(0, merged.matchRakePercent));
      if (typeof merged.tournamentRakePercent === "number") merged.tournamentRakePercent = Math.min(0.5, Math.max(0, merged.tournamentRakePercent));
      const { error } = await db.from("app_config").upsert({ id: "coinSettings", data: merged });
      if (error) throw error;
      coinSettingsCache = null; // force reload on next read
      await writeAuditLog({
        adminUsername: admin.username, adminUid: admin.uid, action: "update_coin_settings",
        details: settings, result: "success",
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("coin-settings update error:", err);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  // Dashboard summary counts.
  app.get("/api/admin/dashboard", async (req, res) => {
    if (!KENTRO_ADMIN_ENABLED) { res.status(503).json({ error: "Admin features are temporarily disabled." }); return; }
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "view_analytics");
    if (!admin) return res.status(403).json({ error: "Not authorized" });

    try {
      const db = getSupabaseAdmin();
      const [usersCount, tournamentsCount, reportsCount, pendingPurchasesCount] = await Promise.all([
        db.from("profiles").select("*", { count: "exact", head: true }),
        (async () => { try { return await db.from("tournaments").select("*", { count: "exact", head: true }).eq("status", "active"); } catch { return { count: 0 } as any; } })(),
        (async () => { try { return await db.from("reports").select("*", { count: "exact", head: true }).eq("status", "open"); } catch { return { count: 0 } as any; } })(),
        db.from("purchase_requests").select("*", { count: "exact", head: true }).eq("status", "pending"),
      ]);
      res.json({
        totalUsers: usersCount.count ?? 0,
        activeTournaments: tournamentsCount.count ?? 0,
        openReports: reportsCount.count ?? 0,
        pendingPurchases: pendingPurchasesCount.count ?? 0,
        onlineNow: onlinePlayers.size,
      });
    } catch (err) {
      console.error("admin dashboard error:", err);
      res.status(500).json({ error: "Failed to load dashboard" });
    }
  });

  app.get("/api/admin/audit-log", async (req, res) => {
    if (!KENTRO_ADMIN_ENABLED) { res.status(503).json({ error: "Admin features are temporarily disabled." }); return; }
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "view_audit_log");
    if (!admin) return res.status(403).json({ error: "Not authorized" });
    const { data, error } = await getSupabaseAdmin().from("audit_logs").select("*").order("timestamp", { ascending: false }).limit(100);
    if (error) return res.status(500).json({ error: "Failed to load audit log" });
    res.json({ logs: data ?? [] });
  });

  app.get("/api/admin/pending-purchases", async (req, res) => {
    if (!KENTRO_COINS_ENABLED) { res.status(503).json({ error: "Kentro Coins are temporarily disabled." }); return; }
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_payments");
    if (!admin) return res.status(403).json({ error: "Not authorized" });
    const { data, error } = await getSupabaseAdmin().from("purchase_requests").select("*").eq("status", "pending").order("submittedAt", { ascending: false });
    if (error) return res.status(500).json({ error: "Failed to load pending purchases" });
    res.json({ requests: data ?? [] });
  });

  // ============================================================
  // PUZZLES -- admin-created traps + tactics mined from real games
  // ============================================================

  const SEED_PUZZLES = [
    {
      id: "seed-1",
      title: "Flank Double Sweep",
      difficulty: "Easy",
      theme: "Tactics",
      description: "White to play: execute a clean double capture to break through.",
      fen: "Weeeebeeeeeeeeeeeeeeeeeebeeeeeeeeebeeeeweeeeeeweeee",
      solution: [{ from: 37, to: 17, text: "37x17", caps: [32, 22], role: "solver" }],
      explanation: "White 37 captures through 32 and 22 to land on 17.",
      source: "admin",
      createdAt: "2026-08-01T00:00:00.000Z"
    },
    {
      id: "seed-2",
      title: "Center Triple Jump",
      difficulty: "Medium",
      theme: "Tactics",
      description: "White to play: sweep three center pieces in a single move.",
      fen: "Weeeebeeeeeeebeeeeeeeeebeeeeeeeeebeeeeweeeeeeeweeee",
      solution: [{ from: 38, to: 7, text: "38x7", caps: [33, 23, 13], role: "solver" }],
      explanation: "White 38 sweeps 33, 23, and 13 to land on 7.",
      source: "admin",
      createdAt: "2026-08-02T00:00:00.000Z"
    },
    {
      id: "seed-3",
      title: "Right Wing Cannon",
      difficulty: "Medium",
      theme: "Tactics",
      description: "White to play: blast through Black's right wing defense.",
      fen: "Weeeebeeeeebeeeeeeeeebeeeeeeeeebeeeeweeeeeeeeeweeee",
      solution: [{ from: 40, to: 9, text: "40x9", caps: [35, 25, 15], role: "solver" }],
      explanation: "White 40 captures 35, 25, and 15 to land on 9.",
      source: "admin",
      createdAt: "2026-08-03T00:00:00.000Z"
    },
    {
      id: "seed-4",
      title: "Diagonal Cross Cut",
      difficulty: "Medium",
      theme: "Tactics",
      description: "White to play: strike along the main diagonal.",
      fen: "Weeeebeeeeeeeeeeeeebeeeeeeeeebeeeeeeeeebeeeeweweeee",
      solution: [{ from: 42, to: 13, text: "42x13", caps: [37, 27, 17], role: "solver" }],
      explanation: "White 42 captures 37, 27, and 17 to land on 13.",
      source: "admin",
      createdAt: "2026-08-04T00:00:00.000Z"
    },
    {
      id: "seed-5",
      title: "Deep Territory Raid",
      difficulty: "Hard",
      theme: "Tactics",
      description: "White to play: four-piece quad capture deep into enemy territory.",
      fen: "Weeeebebeeeeeeeeebeeeeeeeeebeeeeeeeeebeeeeweeeweeee",
      solution: [{ from: 44, to: 4, text: "44x4", caps: [39, 29, 19, 9], role: "solver" }],
      explanation: "White 44 captures 39, 29, 19, and 9 to land on 4 for promotion.",
      source: "admin",
      createdAt: "2026-08-05T00:00:00.000Z"
    },
    {
      id: "seed-6",
      title: "Flying King Long Sweep",
      difficulty: "Hard",
      theme: "Flying King",
      description: "White Flying King on 50 to play: unleash long-range flying king power.",
      fen: "WeeeebeeeeeeeeeeeeebeeeeeeeebeeeeeeeebeeeeeeeeWeeee",
      solution: [{ from: 50, to: 12, text: "50x12", caps: [39, 28, 17], role: "solver" }],
      explanation: "White Flying King on 50 sweeps across the board to 12.",
      source: "admin",
      createdAt: "2026-08-06T00:00:00.000Z"
    },
    {
      id: "seed-7",
      title: "Corner King Sweep",
      difficulty: "Hard",
      theme: "Flying King",
      description: "White Flying King on 46 to play: dominate the corner diagonal.",
      fen: "WeeeebeeeeeeeeeeebeeeeeeeeeebeeeeeeeeeebeeeeeeeeeeW",
      solution: [{ from: 46, to: 15, text: "46x15", caps: [37, 28, 19], role: "solver" }],
      explanation: "White Flying King on 46 captures 37, 28, and 19 to land on 15.",
      source: "admin",
      createdAt: "2026-08-07T00:00:00.000Z"
    }
  ];

  // Nigerian move parsing for the engine's hub strings ("31-27",
  // "26x37", "26x37x28"): first number is from, last is to.
  const hubToPuzzleStep = (moveStr: string): { from: number; to: number; text: string } | null => {
    const nums = moveStr.split(/[x-]/).map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n));
    if (nums.length < 2) return null;
    return { from: nums[0], to: nums[nums.length - 1], text: moveStr.includes("x") ? nums.join("x") : `${nums[0]}-${nums[nums.length - 1]}` };
  };

  // Public: this week's puzzle set (newest first). Client handles the
  // 7-day rotation locally by keying solved-state to the ISO week.
  app.get("/api/puzzles", async (_req, res) => {
    try {
      const db = getSupabaseAdmin();
      const { data, error } = await db
        .from("puzzles")
        .select('id, title, difficulty, theme, description, fen, solution, explanation, source, "createdAt"')
        .order("createdAt", { ascending: false })
        .limit(60);
      if (error || !data || data.length === 0) {
        res.json({ puzzles: SEED_PUZZLES });
        return;
      }
      res.json({ puzzles: data });
    } catch (err) {
      console.error("puzzles list error:", err);
      res.json({ puzzles: SEED_PUZZLES });
    }
  });

  // Admin: save a hand-built trap position + its recorded solution.
  // DISABLED 2026-07-31, temporarily, at Kenny's request -- the Trap Creator
  // UI (src/components/admin/TrapCreator.tsx) has been pulled from the admin
  // panel pending a fix for the known multi-capture bug repro'd in
  // scripts/trap-repro.ts ("trap meant to capture three -> after capturing 1
  // it stops"). Disabling this route too so the write path can't be hit
  // directly even without the UI. Existing puzzles/traps already in the DB
  // are untouched and still fully playable via GET /api/puzzles above; only
  // *creating new* hand-built ones is off. To restore: delete this block and
  // put the real handler (preserved in git history) back.
  app.post("/api/admin/puzzles", async (req, res) => {
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_puzzles");
    if (!admin) return res.status(403).json({ error: "Not authorized" });

    try {
      const { title, difficulty, theme, description, fen, solution, explanation } = req.body ?? {};
      if (typeof fen !== "string" || !fen.trim()) return res.status(400).json({ error: "Missing position" });
      if (!Array.isArray(solution) || solution.length === 0) return res.status(400).json({ error: "Record at least one solution move" });
      
      const cleanSolution = solution
        .map((s: any) => ({
          from: Number(s?.from),
          to: Number(s?.to),
          text: String(s?.text ?? ""),
          caps: Array.isArray(s?.caps) ? s.caps.map((c: any) => Number(c)).filter((c: number) => Number.isFinite(c)) : [],
          role: (s?.role === "reply" ? "reply" : "solver") as "solver" | "reply",
        }))
        .filter((s: any) => Number.isFinite(s.from) && Number.isFinite(s.to));
      if (cleanSolution.length === 0) return res.status(400).json({ error: "Solution moves are malformed" });
      if (cleanSolution[0].role !== "solver") return res.status(400).json({ error: "The solution must start with the solver's move" });

      let startPos: { board: any; turn: "W" | "B" };
      try {
        startPos = scanFenToBoard(String(fen));
      } catch {
        return res.status(400).json({ error: "The position FEN is invalid" });
      }
      const lineReport = verifyPuzzleLine(startPos.board, startPos.turn, cleanSolution);
      if (!lineReport.ok) {
        return res.status(400).json({ error: `This line breaks the game rules: ${lineReport.error}` });
      }

      const db = getSupabaseAdmin();
      const { data, error } = await db.from("puzzles").insert({
        title: String(title || "Untitled Puzzle").slice(0, 120),
        difficulty: ["Easy", "Medium", "Hard"].includes(difficulty) ? difficulty : "Medium",
        theme: String(theme || "Tactics").slice(0, 60),
        description: String(description || "").slice(0, 400),
        fen: fen.trim(),
        solution: cleanSolution,
        explanation: String(explanation || "").slice(0, 600),
        source: "admin",
        createdBy: admin.username,
      }).select("id").single();
      if (error) throw error;

      await writeAuditLog({
        adminUsername: admin.username, adminUid: admin.uid, action: "create_puzzle",
        details: { puzzleId: data?.id, title }, result: "success",
      });
      res.json({ ok: true, id: data?.id });
    } catch (err: any) {
      console.error("create puzzle error:", err);
      res.status(500).json({ error: err?.message || "Failed to save puzzle" });
    }
  });

  // Admin: bulk delete puzzles (e.g. remove all bulk import / sql file puzzles or all puzzles)
  app.post("/api/admin/puzzles/bulk-delete", async (req, res) => {
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_puzzles");
    if (!admin) return res.status(403).json({ error: "Not authorized" });

    try {
      const db = getSupabaseAdmin();
      const { source } = req.body ?? {};
      
      let deletedCount = 0;
      if (source === "all") {
        const { error, count } = await db.from("puzzles").delete().neq("id", "00000000-0000-0000-0000-000000000000");
        if (error) throw error;
        deletedCount = count ?? 2604;
      } else {
        // Try deleting by source first
        const { error, count } = await db.from("puzzles").delete().in("source", ["bulk_import", "sql_file"]);
        if (error) throw error;
        deletedCount = count ?? 0;
        
        // Also if zero deleted, let's delete any puzzles that might have been direct-inserted via SQL execution without source field
        if (deletedCount === 0) {
          const { error: err2, count: count2 } = await db.from("puzzles").delete().is("source", null);
          deletedCount += count2 ?? 0;
        }
      }

      await writeAuditLog({
        adminUsername: admin.username,
        adminUid: admin.uid,
        action: "bulk_delete_puzzles",
        details: { source: source || "bulk_or_sql", deletedCount },
        result: "success",
      });

      res.json({ ok: true, deletedCount, message: `Successfully deleted ${deletedCount} puzzles!` });
    } catch (err: any) {
      console.error("bulk delete puzzles error:", err);
      res.status(500).json({ error: err?.message || "Failed to delete puzzles" });
    }
  });

  // Admin: bulk import puzzles (e.g. massive 2,604 puzzle datasets)
  app.post("/api/admin/puzzles/bulk", async (req, res) => {
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_puzzles");
    if (!admin) return res.status(403).json({ error: "Not authorized" });

    try {
      const { puzzles } = req.body ?? {};
      if (!Array.isArray(puzzles) || puzzles.length === 0) {
        return res.status(400).json({ error: "Missing puzzles array" });
      }

      const db = getSupabaseAdmin();
      let importedCount = 0;
      let errorsCount = 0;

      for (let i = 0; i < puzzles.length; i += 100) {
        const chunk = puzzles.slice(i, i + 100).map((p: any) => ({
          title: String(p.title || "Bulk Puzzle").slice(0, 120),
          difficulty: ["Easy", "Medium", "Hard"].includes(p.difficulty) ? p.difficulty : "Medium",
          theme: String(p.theme || "Tactics").slice(0, 60),
          description: String(p.description || "").slice(0, 400),
          fen: String(p.fen || "").trim(),
          solution: Array.isArray(p.solution) ? p.solution : [],
          explanation: String(p.explanation || "").slice(0, 600),
          source: "bulk_import",
          createdBy: admin.username,
        })).filter(p => p.fen && p.solution.length > 0);

        if (chunk.length > 0) {
          const { error } = await db.from("puzzles").insert(chunk);
          if (error) {
            console.error("Bulk insert chunk error:", error);
            errorsCount += chunk.length;
          } else {
            importedCount += chunk.length;
          }
        }
      }

      await writeAuditLog({
        adminUsername: admin.username,
        adminUid: admin.uid,
        action: "bulk_import_puzzles",
        details: { importedCount, errorsCount, totalReceived: puzzles.length },
        result: "success",
      });

      res.json({ ok: true, importedCount, errorsCount });
    } catch (err: any) {
      console.error("bulk puzzles error:", err);
      res.status(500).json({ error: err?.message || "Failed to bulk import puzzles" });
    }
  });

  // Admin: bulk import puzzles from uploaded SQL file text
  app.post("/api/admin/puzzles/sql-file", async (req, res) => {
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_puzzles");
    if (!admin) return res.status(403).json({ error: "Not authorized" });

    try {
      const { sqlText } = req.body ?? {};
      if (!sqlText || typeof sqlText !== "string") {
        return res.status(400).json({ error: "Missing sqlText content" });
      }

      let importedCount = 0;
      let errorsCount = 0;
      let puzzles: any[] = [];

      const trimmed = sqlText.trim();
      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmed);
          puzzles = Array.isArray(parsed) ? parsed : [parsed];
        } catch {}
      }

      if (puzzles.length === 0) {
        const parseTuple = (tupleStr: string) => {
          try {
            const vals: any[] = [];
            let current = "";
            let inQuotes = false;
            let quoteChar = "";
            let escape = false;

            for (let i = 0; i < tupleStr.length; i++) {
              const char = tupleStr[i];
              if (escape) {
                current += char;
                escape = false;
                continue;
              }
              if (char === "\\") {
                escape = true;
                continue;
              }
              if ((char === "'" || char === '"') && (!inQuotes || quoteChar === char)) {
                if (inQuotes) {
                  inQuotes = false;
                  quoteChar = "";
                } else {
                  inQuotes = true;
                  quoteChar = char;
                }
                continue;
              }
              if (char === "," && !inQuotes) {
                vals.push(current.trim());
                current = "";
              } else {
                current += char;
              }
            }
            vals.push(current.trim());

            if (vals.length >= 5) {
              const cleanVal = (v: string) => {
                if (!v) return "";
                if (v.toUpperCase() === "NULL") return "";
                if (v.endsWith("::jsonb") || v.endsWith("::TEXT")) {
                  v = v.replace(/::[a-zA-Z0-9b]+$/, "").trim();
                }
                if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
                  v = v.slice(1, -1);
                }
                return v;
              };

              let fen = "";
              let solution: any = [];
              let title = "SQL Imported Puzzle";
              let difficulty = "Medium";
              let theme = "Tactics";
              let description = "";
              let explanation = "";

              for (const v of vals) {
                const unq = cleanVal(v);
                if (unq.includes("/") && unq.length > 15) {
                  fen = unq;
                } else if (unq.startsWith("[") && unq.endsWith("]")) {
                  try { solution = JSON.parse(unq); } catch {}
                }
              }

              if (vals.length >= 6) {
                title = cleanVal(vals[1]) || title;
                difficulty = cleanVal(vals[2]) || difficulty;
                theme = cleanVal(vals[3]) || theme;
                description = cleanVal(vals[4]) || description;
                fen = cleanVal(vals[5]) || fen;
                if (vals[6]) {
                  try { solution = JSON.parse(cleanVal(vals[6])); } catch { solution = []; }
                }
                if (vals[7]) explanation = cleanVal(vals[7]);
              }

              if (fen && Array.isArray(solution) && solution.length > 0) {
                puzzles.push({
                  title: title.slice(0, 120),
                  difficulty: ["Easy", "Medium", "Hard"].includes(difficulty) ? difficulty : "Medium",
                  theme: theme.slice(0, 60),
                  description: description.slice(0, 400),
                  fen,
                  solution,
                  explanation: explanation.slice(0, 600),
                  source: "sql_file",
                  createdBy: admin.username,
                });
              }
            }
          } catch {}
        };

        const valuesIndexRegex = /VALUES\s*/gi;
        let vMatch;
        while ((vMatch = valuesIndexRegex.exec(sqlText)) !== null) {
          let pos = vMatch.index + vMatch[0].length;
          while (pos < sqlText.length && /\s/.test(sqlText[pos])) pos++;
          if (pos < sqlText.length && sqlText[pos] === '(') {
            let depth = 0;
            let inQuotes = false;
            let quoteChar = "";
            let escape = false;
            let currentTuple = "";

            for (let i = pos; i < sqlText.length; i++) {
              const char = sqlText[i];
              if (escape) {
                currentTuple += char;
                escape = false;
                continue;
              }
              if (char === "\\") {
                escape = true;
                currentTuple += char;
                continue;
              }
              if ((char === "'" || char === '"') && (!inQuotes || quoteChar === char)) {
                if (inQuotes) {
                  inQuotes = false;
                  quoteChar = "";
                } else {
                  inQuotes = true;
                  quoteChar = char;
                }
                currentTuple += char;
                continue;
              }
              if (!inQuotes) {
                if (char === '(') {
                  if (depth > 0) currentTuple += char;
                  depth++;
                  continue;
                }
                if (char === ')') {
                  depth--;
                  if (depth === 0) {
                    parseTuple(currentTuple);
                    currentTuple = "";
                    // Skip comma and whitespace
                    while (i + 1 < sqlText.length && (sqlText[i+1] === ',' || /\s/.test(sqlText[i+1]))) {
                      if (sqlText[i+1] === ',') {
                        i++;
                        break;
                      }
                      i++;
                    }
                    if (i + 1 < sqlText.length && sqlText[i+1] === ';') {
                      break;
                    }
                  } else {
                    currentTuple += char;
                  }
                  continue;
                }
              }
              if (depth > 0) {
                currentTuple += char;
              }
            }
          }
        }
      }

      if (puzzles.length === 0) {
        // A puzzle moderator may import puzzle data, never execute arbitrary SQL.
        return res.status(400).json({
          error: "Could not parse puzzle INSERT rows. Supply supported puzzle INSERT statements or a JSON array.",
        });
      }

      const db = getSupabaseAdmin();
      for (let i = 0; i < puzzles.length; i += 100) {
        const chunk = puzzles.slice(i, i + 100).filter(p => p.fen && Array.isArray(p.solution) && p.solution.length > 0);
        if (chunk.length > 0) {
          const { error } = await db.from("puzzles").insert(chunk);
          if (error) {
            console.error("SQL file insert chunk error:", error);
            errorsCount += chunk.length;
          } else {
            importedCount += chunk.length;
          }
        }
      }

      await writeAuditLog({
        adminUsername: admin.username,
        adminUid: admin.uid,
        action: "sql_file_import",
        details: { importedCount, errorsCount, totalParsed: puzzles.length },
        result: "success",
      });

      res.json({ ok: true, importedCount, errorsCount });
    } catch (err: any) {
      console.error("sql-file import error:", err);
      res.status(500).json({ error: err?.message || "Failed to import SQL file" });
    }
  });

  // Admin: mine tactics from the most recent completed game that hasn't
  // been mined yet -- the lidraughts approach in miniature. The full game
  // is replayed; every position is engine-evaluated; wherever one side's
  // move handed the other a decisive advantage (a blunder), the position
  // right after it becomes a puzzle whose solution is the engine's
  // winning line (1-2 forcing steps).
  app.post("/api/admin/puzzles/generate-from-games", async (req, res) => {
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_coin_settings");
    if (!admin) return res.status(403).json({ error: "Not authorized" });

    try {
      const db = getSupabaseAdmin();
      const skipIds = new Set<string>(Array.isArray(req.body?.skipGameIds) ? req.body.skipGameIds.filter((x: any) => typeof x === "string") : []);
      const { data: minedRows } = await db.from("puzzles").select('"sourceGameId"').eq("source", "game").not("sourceGameId", "is", null);
      const minedIds = new Set((minedRows ?? []).map((r: any) => r.sourceGameId));

      const { data: games, error: gamesError } = await db
        .from("completed_games")
        .select('"gameId", "whitePlayer", "blackPlayer", "moveHistory"')
        .order("timestamp", { ascending: false })
        .limit(25);
      if (gamesError) throw gamesError;

      const game = (games ?? []).find((g: any) => !minedIds.has(g.gameId) && !skipIds.has(g.gameId) && Array.isArray(g.moveHistory) && g.moveHistory.length >= 12 && g.moveHistory.length <= 90);
      if (!game) return res.json({ ok: true, created: 0, message: "No unmined recent games with a usable move count." });

      const history: Move[] = game.moveHistory as Move[];
      let pos: Board = createInitialBoard();
      const positions: Board[] = [pos];
      for (const mv of history) {
        pos = applyMove(pos, mv).board;
        positions.push(pos);
      }

      // One shallow engine pass over every position (relative-to-mover
      // scores, engine convention).
      const evals: { score: number; move: string | null }[] = [];
      for (let i = 0; i <= history.length; i++) {
        const mover: "W" | "B" = i % 2 === 0 ? "W" : "B";
        try {
          const r = await engine.getMove(boardToScanFen(positions[i], mover), 0.12);
          evals.push({ score: typeof r.score === "number" ? r.score : 0, move: typeof r.move === "string" ? r.move : null });
        } catch {
          evals.push({ score: 0, move: null });
        }
      }

      const created: any[] = [];
      for (let i = 4; i < history.length && created.length < 2; i++) {
        const before = evals[i].score;               // mover_i's view before their move
        const afterForNext = evals[i + 1].score;     // mover_{i+1}'s view after it
        const moverAfter = -afterForNext;
        const delta = before - moverAfter;
        if (delta < 180 || afterForNext < 200) continue; // need a real blunder AND a winning reply
        const bestStr = evals[i + 1].move;
        if (!bestStr) continue;
        const step1 = hubToPuzzleStep(bestStr);
        if (!step1) continue;

        const solverColor: "W" | "B" = (i + 1) % 2 === 0 ? "W" : "B";
        type PuzzleStep = { from: number; to: number; text: string; caps: number[]; role: "solver" | "reply" };
        const legalHere = generateLegalMoves(positions[i + 1], solverColor);
        const match1 = legalHere.find((m) => m.from === step1.from && m.to === step1.to);
        const solution: PuzzleStep[] = [{ ...step1, caps: match1 ? match1.caps : [], role: "solver" }];

        // Extend by one more solver move when the opponent's reply is
        // forced -- and STORE that forced reply as its own "reply" step,
        // so the client can actually play it out on the board (the old
        // solver-only format skipped it, leaving the board in a position
        // where the second solution move wasn't even legal).
        if (match1) {
          const afterBest = applyMove(positions[i + 1], match1).board;
          const oppColor: "W" | "B" = solverColor === "W" ? "B" : "W";
          const oppLegal = generateLegalMoves(afterBest, oppColor);
          if (oppLegal.length === 1) {
            const forcedReply = oppLegal[0];
            const afterForced = applyMove(afterBest, forcedReply).board;
            try {
              const r2 = await engine.getMove(boardToScanFen(afterForced, solverColor), 0.12);
              const step2 = typeof r2.move === "string" ? hubToPuzzleStep(r2.move) : null;
              if (step2 && typeof r2.score === "number" && r2.score >= 150) {
                const legalAfterForced = generateLegalMoves(afterForced, solverColor);
                const match2 = legalAfterForced.find((m) => m.from === step2.from && m.to === step2.to);
                if (match2) {
                  solution.push({
                    from: forcedReply.from,
                    to: forcedReply.to,
                    text: moveToNotationString(forcedReply),
                    caps: forcedReply.caps,
                    role: "reply",
                  });
                  solution.push({ ...step2, caps: match2.caps, role: "solver" });
                }
              }
            } catch {}
          }
        }

        const difficulty = delta >= 350 ? "Hard" : delta >= 250 ? "Medium" : "Easy";

        // Same full-rules verification the Trap Creator save uses -- a
        // mined line that doesn't replay legally (engine drift, promotion
        // edge cases) is silently skipped rather than published broken.
        const minedReport = verifyPuzzleLine(positions[i + 1], solverColor, solution);
        if (!minedReport.ok) { i += 1; continue; }

        created.push({
          title: `Tactic: ${game.whitePlayer} vs ${game.blackPlayer}`,
          difficulty,
          theme: "From a real game",
          description: `${solverColor === "W" ? "White" : "Black"} to play and win -- punish the last move.`,
          fen: boardToScanFen(positions[i + 1], solverColor),
          solution,
          explanation: `Mined automatically: the previous move lost roughly ${Math.round(delta)} centipieces.`,
          source: "game",
          sourceGameId: game.gameId,
          createdBy: admin.username,
        });
        i += 3; // don't harvest overlapping moments of the same collapse
      }

      if (created.length === 0) {
        // Mark the game as mined-with-nothing so the next click moves on,
        // via a zero-value tombstone row? No -- simpler: report it.
        return res.json({ ok: true, created: 0, gameId: game.gameId, message: `No clean tactics found in ${game.whitePlayer} vs ${game.blackPlayer}. Try again to scan the next game.`, skipGameId: game.gameId });
      }

      const { error: insertError } = await db.from("puzzles").insert(created);
      if (insertError) throw insertError;

      await writeAuditLog({
        adminUsername: admin.username, adminUid: admin.uid, action: "mine_puzzles",
        details: { gameId: game.gameId, created: created.length }, result: "success",
      });
      res.json({ ok: true, created: created.length, gameId: game.gameId, message: `Created ${created.length} puzzle(s) from ${game.whitePlayer} vs ${game.blackPlayer}.` });
    } catch (err) {
      console.error("generate puzzles error:", err);
      res.status(500).json({ error: "Failed to mine puzzles from games" });
    }
  });

    // ------------------------------------------------------------------
  // Admin: games database management (view / delete / wipe)
  // ------------------------------------------------------------------
  app.get("/api/admin/games", async (req, res) => {
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "view_games");
    if (!admin) return res.status(403).json({ error: "Not authorized" });
    try {
      const player = typeof req.query.player === "string" ? req.query.player.trim() : "";
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
      let q = getSupabaseAdmin()
        .from("completed_games")
        .select("gameId, whitePlayer, blackPlayer, winner, timestamp, playMode, moveHistoryStrings")
        .order("timestamp", { ascending: false })
        .limit(limit);
      if (player) {
        q = q.or(`whitePlayer.ilike.%${player}%,blackPlayer.ilike.%${player}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      const games = (data ?? []).map((g: any) => ({
        gameId: g.gameId,
        whitePlayer: g.whitePlayer,
        blackPlayer: g.blackPlayer,
        winner: g.winner,
        timestamp: g.timestamp,
        playMode: g.playMode,
        moveCount: Array.isArray(g.moveHistoryStrings) ? g.moveHistoryStrings.length : 0,
      }));
      res.json({ games });
    } catch (err) {
      console.error("admin games list error:", err);
      res.status(500).json({ error: "Failed to load games" });
    }
  });

  app.post("/api/admin/games/delete", async (req, res) => {
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_admins");
    if (!admin) return res.status(403).json({ error: "Not authorized" });
    const gameId = typeof req.body?.gameId === "string" ? req.body.gameId : "";
    if (!gameId) return res.status(400).json({ error: "gameId required" });
    try {
      const { error } = await getSupabaseAdmin().from("completed_games").delete().eq("gameId", gameId);
      if (error) throw error;
      await writeAuditLog({ adminUsername: admin.username, adminUid: admin.uid, action: "delete_game", target: gameId, result: "success" });
      res.json({ ok: true });
    } catch (err) {
      console.error("admin delete game error:", err);
      res.status(500).json({ error: "Failed to delete game" });
    }
  });

  // Wipes the ENTIRE games database. Deliberately awkward to call: the
  // client must echo the exact confirmation phrase, and the action is
  // audit-logged with the pre-wipe count.
  app.post("/api/admin/games/delete-all", async (req, res) => {
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_admins");
    if (!admin) return res.status(403).json({ error: "Not authorized" });
    if (req.body?.confirm !== "DELETE ALL GAMES") {
      return res.status(400).json({ error: 'Confirmation phrase mismatch: send { confirm: "DELETE ALL GAMES" }' });
    }
    try {
      const { count } = await getSupabaseAdmin()
        .from("completed_games")
        .select("gameId", { count: "exact", head: true });
      const { error } = await getSupabaseAdmin().from("completed_games").delete().neq("gameId", "");
      if (error) throw error;
      await writeAuditLog({
        adminUsername: admin.username, adminUid: admin.uid,
        action: "delete_all_games", target: `${count ?? "?"} games`, result: "success",
      });
      res.json({ ok: true, deleted: count ?? 0 });
    } catch (err) {
      console.error("admin delete-all games error:", err);
      res.status(500).json({ error: "Failed to delete games" });
    }
  });

  // ------------------------------------------------------------------
  // Admin: Ken 8 Self-Play Fast Batch Simulator Endpoint
  // ------------------------------------------------------------------
  app.post("/api/admin/simulate-ken8-batch", async (req, res) => {
    const admin = await requirePermission(requestAccessToken(req.headers), "view_games");
    if (!admin) return res.status(403).json({ error: "Not authorized" });
    try {
      const count = Math.min(25, Math.max(1, Number(req.body?.count) || 10));
      const logs: any[] = [];

      for (let c = 0; c < count; c++) {
        let board = createInitialBoard();
        let turn: "W" | "B" = "W";
        const moveStrings: string[] = [];
        const moveHistory: Move[] = [];
        let moveCount = 0;
        let maxMoves = 85;
        let lastScore = 0;

        while (moveCount < maxMoves) {
          moveCount++;
          const legalMoves = generateLegalMoves(board, turn);
          if (legalMoves.length === 0) break;

          try {
            const fen = boardToScanFen(board, turn);
            const engineRes = await engine.getMove(fen, 0.08, 8);
            if (engineRes && engineRes.move) {
              lastScore = engineRes.score || 0;
              const parsed = hubMoveStringToNigerian(engineRes.move);
              if (parsed) {
                moveStrings.push(moveToNotationString(parsed as Move));
                moveHistory.push(parsed as Move);
                board = applyMove(board, parsed as Move).board;
              } else {
                throw new Error("Engine returned unparseable move");
              }
            } else {
              throw new Error("Engine returned no move");
            }
          } catch (err) {
            console.error("Simulation engine error:", err);
            break;
          }

          const gameEnd = checkGameEnd(moveHistory);
          if (gameEnd.isOver) {
            const winner = gameEnd.isDraw ? "Draw" : gameEnd.winner === "W" ? "W" : "B";
            logs.push({
              id: `ken8_sim_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              timestamp: Date.now(),
              whitePlayer: "Ken Level 8 (Alpha)",
              blackPlayer: "Ken Level 8 (Beta)",
              moveCount,
              winner,
              openingFen: "W:W31-50:B1-20",
              moves: moveStrings,
              finalEvalScore: lastScore,
            });
            break;
          }

          turn = turn === "W" ? "B" : "W";
        }

        if (moveCount >= maxMoves) {
          logs.push({
            id: `ken8_sim_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            timestamp: Date.now(),
            whitePlayer: "Ken Level 8 (Alpha)",
            blackPlayer: "Ken Level 8 (Beta)",
            moveCount,
            winner: "Draw",
            openingFen: "W:W31-50:B1-20",
            moves: moveStrings,
            finalEvalScore: lastScore,
          });
        }
      }

      res.json({ ok: true, logs });
    } catch (err: any) {
      console.error("simulate-ken8-batch error:", err);
      res.status(500).json({ error: "Batch simulation failed" });
    }
  });

  // ------------------------------------------------------------------
  // Admin: platform revenue -- the house wallet where every rake lands
  // ------------------------------------------------------------------
  app.get("/api/admin/house-revenue", async (req, res) => {
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_coin_settings");
    if (!admin) return res.status(403).json({ error: "Not authorized" });
    try {
      const db = getSupabaseAdmin();
      const { data: wallet } = await db
        .from("coin_wallets").select("balance").eq("username", HOUSE_WALLET_USERNAME).maybeSingle();
      // All credits ever received by the house, grouped by source type.
      // (Reduced in JS -- at 5000 rows per read this covers years of rake;
      // if it ever overflows, the running wallet balance above is still
      // exact, only the per-type split becomes "recent history".)
      const { data: txs } = await db
        .from("coin_transactions")
        .select("type, amount, refId, timestamp")
        .eq("username", HOUSE_WALLET_USERNAME)
        .eq("direction", "credit")
        .order("timestamp", { ascending: false })
        .limit(5000);
      const totals: Record<string, number> = {};
      let rakeCount = 0;
      for (const t of txs ?? []) {
        totals[t.type] = (totals[t.type] || 0) + t.amount;
        if (t.type === "rake") rakeCount++;
      }
      res.json({
        houseWallet: HOUSE_WALLET_USERNAME,
        balance: wallet?.balance ?? 0,
        totals,
        rakeCount,
        recent: (txs ?? []).slice(0, 8),
      });
    } catch (err) {
      console.error("house-revenue error:", err);
      res.status(500).json({ error: "Failed to load revenue" });
    }
  });

  // ------------------------------------------------------------------
  // Site config: announcements + maintenance mode
  // ------------------------------------------------------------------

  // Public: the client reads this on load to show an announcement banner
  // or a maintenance notice. Deliberately unauthenticated and cheap.
  app.get("/api/site-config", async (_req, res) => {
    try {
      const { data } = await getSupabaseAdmin()
        .from("app_config").select("data").eq("id", "siteConfig").maybeSingle();
      const cfg = (data?.data as any) || {};
      res.json({
        announcement: cfg.announcement?.active ? {
          text: cfg.announcement.text || "",
          tone: cfg.announcement.tone || "info",
        } : null,
        maintenance: cfg.maintenance?.enabled ? {
          message: cfg.maintenance.message || "The app is under maintenance. Please check back shortly.",
        } : null,
      });
    } catch {
      // Never let a config read break the app -- just report nothing set.
      res.json({ announcement: null, maintenance: null });
    }
  });

  async function saveSiteConfig(patch: Record<string, unknown>) {
    const db = getSupabaseAdmin();
    const { data: existing } = await db.from("app_config").select("data").eq("id", "siteConfig").maybeSingle();
    const merged = { ...((existing?.data as any) ?? {}), ...patch };
    const { error } = await db.from("app_config").upsert({ id: "siteConfig", data: merged });
    if (error) throw error;
    return merged;
  }

  // Set or clear the site-wide announcement banner.
  app.post("/api/admin/announcement", async (req, res) => {
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_announcements");
    if (!admin) return res.status(403).json({ error: "Not authorized" });
    try {
      const active = !!req.body?.active;
      const text = String(req.body?.text ?? "").slice(0, 400);
      const tone = ["info", "warning", "success"].includes(req.body?.tone) ? req.body.tone : "info";
      if (active && !text.trim()) return res.status(400).json({ error: "Announcement text is required" });

      await saveSiteConfig({ announcement: { active, text, tone, updatedAt: Date.now(), by: admin.username } });
      await writeAuditLog({
        adminUsername: admin.username, adminUid: admin.uid,
        action: active ? "announcement_set" : "announcement_cleared",
        target: text.slice(0, 80), result: "success",
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("announcement error:", err);
      res.status(500).json({ error: "Failed to save announcement" });
    }
  });

  // Maintenance mode: shows a full-screen notice to players.
  app.post("/api/admin/maintenance", async (req, res) => {
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_admins");
    if (!admin) return res.status(403).json({ error: "Not authorized" });
    try {
      const enabled = !!req.body?.enabled;
      const message = String(req.body?.message ?? "").slice(0, 400);
      await saveSiteConfig({ maintenance: { enabled, message, updatedAt: Date.now(), by: admin.username } });
      await writeAuditLog({
        adminUsername: admin.username, adminUid: admin.uid,
        action: enabled ? "maintenance_on" : "maintenance_off",
        result: "success",
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("maintenance error:", err);
      res.status(500).json({ error: "Failed to update maintenance mode" });
    }
  });

  // ------------------------------------------------------------------
  // Chat moderation
  // ------------------------------------------------------------------
  app.get("/api/admin/chat", async (req, res) => {
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_reports");
    if (!admin) return res.status(403).json({ error: "Not authorized" });
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 80));
      const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
      let q = getSupabaseAdmin()
        .from("global_chat").select("id, text, sender, timestamp")
        .order("timestamp", { ascending: false }).limit(limit);
      if (search) q = q.or(`sender.ilike.%${search}%,text.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      res.json({ messages: data ?? [] });
    } catch (err) {
      console.error("admin chat list error:", err);
      res.status(500).json({ error: "Failed to load chat" });
    }
  });

  app.post("/api/admin/chat/delete", async (req, res) => {
    const accessToken = requestAccessToken(req.headers);
    const admin = await requirePermission(accessToken, "manage_reports");
    if (!admin) return res.status(403).json({ error: "Not authorized" });
    const id = String(req.body?.id ?? "");
    if (!id) return res.status(400).json({ error: "id required" });
    try {
      const { error } = await getSupabaseAdmin().from("global_chat").delete().eq("id", id);
      if (error) throw error;
      await writeAuditLog({
        adminUsername: admin.username, adminUid: admin.uid,
        action: "delete_chat_message", target: id, result: "success",
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("admin chat delete error:", err);
      res.status(500).json({ error: "Failed to delete message" });
    }
  });

  app.use("/api", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(404).json({ error: "API route not found" });
  });
  let closeDevelopmentServer: (() => Promise<void>) | undefined;
  if (process.env.NODE_ENV !== "production") {
    // Keep the large Vite dev server out of production's dependency graph.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    closeDevelopmentServer = () => vite.close();
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      try {
        const url = req.originalUrl;
        let template = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    mountProductionStatic(app, path.join(process.cwd(), 'dist'));
  }

  // Go edge can bind Node to loopback, keeping all game APIs private.
  const HOST = process.env.HOST || "0.0.0.0";
  const server = app.listen(PORT, HOST, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  // --- WebSocket Server implementation for real-time multiplayer rooms ---
  // Protocol v2 (docs/ONLINE_PLAY_PROTOCOL.md). All room/session/clock/call
  // logic lives in src/server/onlinePlay.ts; the coin + pricing helpers it
  // needs are injected from here so they stay shared with the HTTP API.
  const onlinePlay = attachOnlinePlay(server, {
    onGameCompleted: tournamentRuntime.record,
    coinsEnabled: KENTRO_COINS_ENABLED,
    getCoinSettings,
    resolveEntryFee,
    sanitizeWagerAmount,
    sanitizeBestOf,
    sanitizeCustomBoard,
    findLegalMatch,
  });
  const tournamentTimer = setInterval(() => { if (process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) void tournamentRuntime.reconcile().catch(error => console.error('[Tournament] Reconciliation pending', error)); }, 10000);
  tournamentTimer.unref();
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) void tournamentRuntime.reconcile().catch(error => console.error('[Tournament] Startup pending', error));
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Server] ${signal}: draining connections (up to 5 seconds)`);
    clearInterval(tournamentTimer);
    onlinePlay.shutdown();
    let httpClosed = false;
    let websocketClosed = false;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      void Promise.allSettled([engine.stop(), flushGameRecords(), tournamentRuntime.close()]).then(results => {
        let failed = false;
        for (const result of results) {
          if (result.status === 'rejected') {
            failed = true;
            console.error('[Server] Shutdown flush failed:', result.reason);
          }
        }
        process.exit(failed ? 1 : 0);
      });
    };
    const drained = () => { if (httpClosed && websocketClosed) finish(); };
    const deadline = setTimeout(() => {
      onlinePlay.wss.clients.forEach((client) => client.terminate());
      server.closeAllConnections();
      finish();
    }, 5000);
    deadline.unref();
    server.close(() => { httpClosed = true; drained(); });
    server.closeIdleConnections();
    onlinePlay.wss.close(() => { websocketClosed = true; drained(); });
    void closeDevelopmentServer?.().catch((err) => console.error('[Server] Vite close failed', err));
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  canChallengeFromRoom = (id, name) => {
    const room = onlinePlay.rooms.get(id) as any;
    return !!room && room.phase === "lobby" && String(room.creator).toLowerCase() === name.toLowerCase();
  };
  const reminderTimer = setInterval(() => void sendTournamentReminders().catch(e => console.error("[Notifications] reminders:", e)), 60_000);
  reminderTimer.unref?.();
  const pushTimer = setInterval(() => void deliverPendingPushes().catch(e=>console.error("[Push] Delivery error",e)), 30_000);
  pushTimer.unref?.();
  void deliverPendingPushes().catch(e=>console.error("[Push] startup delivery",e));
  void sendTournamentReminders().catch(e => console.error("[Notifications] initial reminders:", e));
  isLiveMultiplayerActive = () => {
    try {
      const stats = onlinePlay.stats();
      return stats.players > 0 || stats.rooms > 0;
    } catch {
      return false;
    }
  };
  // Kept for the admin dashboard's "onlineNow" counter (see /api/admin/dashboard).
  const onlinePlayers = { get size() { return onlinePlay.stats().players; } };
  // Kept for /api/games/next-code, which reserves codes that no live room uses.
  const rooms = onlinePlay.rooms;
  void onlinePlayers; void rooms;
}

startServer().catch((err) => {
  console.error("Server startup failed:", err);
  process.exit(1);
});
