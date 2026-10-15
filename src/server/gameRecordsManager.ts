import fs from "fs";
import path from "path";
import { KentroGameRecord, RematchSeriesData, SeriesGameSummary } from "../types/gameRecords";
import { uniqueCompletedMatches } from "../lib/completedMatches";
import { getSupabaseAdmin } from "../../supabaseAdmin";

const DATA_DIR = process.env.KENTRO_DATA_DIR || path.join(process.cwd(), "data");
const SEQ_FILE = path.join(DATA_DIR, "game_seq.json");
const RECORDS_FILE = path.join(DATA_DIR, "permanent_game_records.json");
const SERIES_FILE = path.join(DATA_DIR, "rematch_series.json");

// In-memory caches for high-performance WebSocket & API lookups. Both are
// bounded: the JSON files on disk only ever held the most recent slice
// anyway, and an unbounded Map on a 4 GB box is a slow leak.
const MAX_CACHED_RECORDS = 500;
const MAX_CACHED_SERIES = 200;
const PERSIST_DEBOUNCE_MS = 2000;

const recordsCache = new Map<string, KentroGameRecord>();
const seriesCache = new Map<string, RematchSeriesData>();
let currentSeqNumber = 1;
let isInitialized = false;

const supabaseConfigured = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
let warnedNoSupabase = false;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function currentPrefix(): string {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const m = String(d.getMonth() + 1);
  return `${yy}${m}`;
}

/** Highest sequence number among known codes with this month's prefix (0 if none). */
function maxSeqAmong(codes: Iterable<string>, prefix: string): number {
  let max = 0;
  for (const raw of codes) {
    const gid = String(raw || "");
    if (!gid.startsWith(prefix) || !/^\d{7,10}$/.test(gid)) continue;
    const seq = parseInt(gid.slice(prefix.length), 10);
    if (!isNaN(seq) && seq > max) max = seq;
  }
  return max;
}

// ---------------------------------------------------------------------------
// Debounced, asynchronous persistence (D16). Every mutation just flips a
// dirty flag; a single timer writes whatever is dirty at most every 2 s,
// via temp-file + rename so a crash mid-write never truncates a file. On
// process exit the same data is flushed synchronously.
// ---------------------------------------------------------------------------
const dirty = { seq: false, records: false, series: false };
let persistTimer: NodeJS.Timeout | null = null;
let persistInFlight: Promise<void> | null = null;
let persistEpoch = 0;
let writeId = 0;

function seqPayload() {
  return JSON.stringify({ currentSeq: currentSeqNumber }, null, 2);
}
function recordsPayload() {
  return JSON.stringify(Array.from(recordsCache.values()).slice(-MAX_CACHED_RECORDS), null, 2);
}
function seriesPayload() {
  return JSON.stringify(Array.from(seriesCache.values()).slice(-MAX_CACHED_SERIES), null, 2);
}

async function writeAtomic(file: string, contents: string, epoch: number): Promise<void> {
  const tmp = `${file}.${process.pid}.${++writeId}.tmp`;
  await fs.promises.writeFile(tmp, contents, "utf-8");
  // The synchronous exit flush may run while writeFile is pending. Check
  // and rename in one synchronous step so an old snapshot cannot overwrite
  // the final snapshot after shutdown has started.
  if (epoch !== persistEpoch) {
    try { fs.unlinkSync(tmp); } catch {}
    return;
  }
  fs.renameSync(tmp, file);
}

function writeAtomicSync(file: string, contents: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents, "utf-8");
  fs.renameSync(tmp, file);
}

async function flushAsync(): Promise<void> {
  // Recheck after waiting: several callers may have awaited the same flush.
  while (persistInFlight) await persistInFlight;
  const run = (async () => {
    const jobs: Promise<void>[] = [];
    const epoch = persistEpoch;
    const enqueue = (kind: keyof typeof dirty, file: string, contents: string) => {
      dirty[kind] = false;
      jobs.push(writeAtomic(file, contents, epoch).catch((error) => {
        if (epoch !== persistEpoch) return;
        dirty[kind] = true;
        console.error(`[GameRecords] Failed to persist ${kind}:`, error);
      }));
    };
    try {
      ensureDataDir();
      if (dirty.seq) enqueue("seq", SEQ_FILE, seqPayload());
      if (dirty.records) enqueue("records", RECORDS_FILE, recordsPayload());
      if (dirty.series) enqueue("series", SERIES_FILE, seriesPayload());
    } catch (error) {
      console.error("[GameRecords] Failed to prepare persistence:", error);
    }
    // Each rejected job restores its own dirty flag. Still wait for all jobs
    // so the next flush cannot race an unfinished rename to the same file.
    await Promise.all(jobs);
  })();
  persistInFlight = run;
  try {
    await run;
  } finally {
    if (persistInFlight === run) persistInFlight = null;
    const retry = (Object.keys(dirty) as (keyof typeof dirty)[]).find((kind) => dirty[kind]);
    if (retry && !persistTimer) schedulePersist(retry);
  }
}

function schedulePersist(kind: keyof typeof dirty): void {
  dirty[kind] = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushAsync().catch((e) => console.error("[GameRecords] persist error:", e));
  }, PERSIST_DEBOUNCE_MS);
  // Never keep the process alive just for a pending write; the exit hook flushes.
  if (typeof (persistTimer as any).unref === "function") (persistTimer as any).unref();
}

/** Synchronous flush of anything still dirty -- used on process exit. */
export function flushGameRecordsSync(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    if (!dirty.seq && !dirty.records && !dirty.series && !persistInFlight) return;
    persistEpoch += 1;
    // In-flight writes have already cleared their dirty flags. Flush all
    // current caches; the epoch invalidates their older pending snapshots.
    if (persistInFlight) dirty.seq = dirty.records = dirty.series = true;
    ensureDataDir();
    if (dirty.seq) { writeAtomicSync(SEQ_FILE, seqPayload()); dirty.seq = false; }
    if (dirty.records) { writeAtomicSync(RECORDS_FILE, recordsPayload()); dirty.records = false; }
    if (dirty.series) { writeAtomicSync(SERIES_FILE, seriesPayload()); dirty.series = false; }
  } catch (e) {
    console.error("[GameRecords] Failed to flush on exit:", e);
  }
}

/** Wait for pending writes and persist current mutations before graceful shutdown. */
export async function flushGameRecords(): Promise<void> {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  await flushAsync();
  // Mutations can occur while a previous flush was awaited.
  if (dirty.seq || dirty.records || dirty.series) await flushAsync();
}

let exitHooksInstalled = false;
function installExitHooks(): void {
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;
  process.on("exit", () => flushGameRecordsSync());
  // Signals don't emit "exit" on their own; flush, then terminate with the
  // conventional 128+signal code so `pkill`/Ctrl-C behave as before.
  for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
    process.once(sig, () => {
      flushGameRecordsSync();
      process.exit(code);
    });
  }
}

function cacheRecord(rec: KentroGameRecord): void {
  if (recordsCache.has(rec.gameCode)) recordsCache.delete(rec.gameCode); // refresh insertion order
  recordsCache.set(rec.gameCode, rec);
  while (recordsCache.size > MAX_CACHED_RECORDS) {
    const oldest = recordsCache.keys().next().value;
    if (oldest === undefined) break;
    recordsCache.delete(oldest);
  }
}

function cacheSeries(series: RematchSeriesData): void {
  if (seriesCache.has(series.seriesId)) seriesCache.delete(series.seriesId);
  seriesCache.set(series.seriesId, series);
  while (seriesCache.size > MAX_CACHED_SERIES) {
    const oldest = seriesCache.keys().next().value;
    if (oldest === undefined) break;
    seriesCache.delete(oldest);
  }
}

export async function initGameRecordsManager() {
  if (isInitialized) return;
  ensureDataDir();
  installExitHooks();

  // Load records first: they are also the fallback source of truth for the
  // sequence counter if game_seq.json is missing or unreadable.
  try {
    if (fs.existsSync(RECORDS_FILE)) {
      const list: KentroGameRecord[] = JSON.parse(fs.readFileSync(RECORDS_FILE, "utf-8"));
      if (Array.isArray(list)) for (const rec of list) if (rec && rec.gameCode) cacheRecord(rec);
    }
  } catch (e) {
    console.error("[GameRecords] Error loading records:", e);
  }

  try {
    if (fs.existsSync(SERIES_FILE)) {
      const list: RematchSeriesData[] = JSON.parse(fs.readFileSync(SERIES_FILE, "utf-8"));
      if (Array.isArray(list)) for (const s of list) if (s && s.seriesId) cacheSeries(s);
    }
  } catch (e) {
    console.error("[GameRecords] Error loading series:", e);
  }

  // Sequence: file -> local records -> Supabase (best effort) -> 1. Whatever
  // the source, never go below the highest code we already know about for
  // this month, so a lost/stale seq file can't make us reissue a code.
  let seqFromFile: number | null = null;
  try {
    if (fs.existsSync(SEQ_FILE)) {
      const data = JSON.parse(fs.readFileSync(SEQ_FILE, "utf-8"));
      if (typeof data?.currentSeq === "number" && Number.isFinite(data.currentSeq) && data.currentSeq >= 1) {
        seqFromFile = Math.floor(data.currentSeq);
      }
    }
  } catch (e) {
    console.error("[GameRecords] Error reading sequence file:", e);
  }

  const prefix = currentPrefix();
  let floor = maxSeqAmong(recordsCache.keys(), prefix) + 1;
  if (seqFromFile === null && supabaseConfigured()) {
    try {
      const db = getSupabaseAdmin();
      const { data: rows } = await db
        .from("completed_games")
        .select("gameId")
        .order("timestamp", { ascending: false })
        .limit(100);
      if (rows && rows.length > 0) {
        floor = Math.max(floor, maxSeqAmong(rows.map((r: any) => r.gameId), prefix) + 1);
      }
    } catch (err) {
      console.warn("[GameRecords] Failed to query Supabase for sequence init:", err);
    }
  }
  currentSeqNumber = Math.max(seqFromFile ?? 1, floor);
  if (seqFromFile !== currentSeqNumber) schedulePersist("seq");

  isInitialized = true;
  console.log(`[GameRecords] Initialized with sequence #${currentSeqNumber}, ${recordsCache.size} records, ${seriesCache.size} series.`);
}

/**
 * Generate a sequential numeric Kentro Game Code:
 * Format: YYM + a minimum four-digit sequence (e.g. 2690001 or 26100001).
 * Codes grow to eight digits in October–December. Never returns a
 * code that is an existing room id or an already-recorded game.
 */
export function getNextGameCode(existingRooms?: Map<string, any>): string {
  const prefix = currentPrefix();
  for (let guard = 0; guard < 100000; guard++) {
    const seqStr = String(currentSeqNumber).padStart(4, "0");
    const code = `${prefix}${seqStr}`;
    currentSeqNumber++;
    schedulePersist("seq");
    if (recordsCache.has(code)) continue;
    if (existingRooms && existingRooms.has(code)) continue;
    return code;
  }
  // Practically unreachable; keep the code unique anyway.
  return `${prefix}${String(Date.now()).slice(-4)}`;
}

/**
 * Record a new game starting
 */
export function recordGameStart(params: {
  gameCode: string;
  previousGameCode?: string | null;
  seriesId?: string;
  seriesGameNumber?: number;
  player1: string; // White
  player2: string; // Black
  playerColors: Record<string, "W" | "B">;
  gameMode: string;
  timeControl: string;
  startingPosition?: any;
  startingTurn?: "W" | "B";
  ratingsBefore?: Record<string, number>;
}): KentroGameRecord {
  const existing = recordsCache.get(params.gameCode);
  if (existing) return existing;
  const seriesId = params.seriesId || `series_${params.gameCode}`;
  const seriesGameNumber = params.seriesGameNumber || 1;

  const rec: KentroGameRecord = {
    gameCode: params.gameCode,
    previousGameCode: params.previousGameCode || null,
    nextGameCode: null,
    seriesId,
    seriesGameNumber,
    player1: params.player1,
    player2: params.player2,
    whitePlayer: params.player1,
    blackPlayer: params.player2,
    playerColors: { ...params.playerColors },
    gameMode: params.gameMode,
    timeControl: params.timeControl,
    startingPosition: params.startingPosition ? structuredClone(params.startingPosition) : null,
    startingTurn: params.startingTurn || "W",
    completeMoveHistory: [],
    moveHistoryStrings: [],
    currentPosition: params.startingPosition ? structuredClone(params.startingPosition) : null,
    currentTurn: params.startingTurn || "W",
    gameStartTime: Date.now(),
    gameEndTime: 0,
    durationSeconds: 0,
    finalResult: "½–½",
    resultReason: "In Progress",
    winner: null,
    loser: null,
    isDraw: false,
    playerRatingsBefore: params.ratingsBefore || {},
    playerRatingsAfter: {},
    rematchStatus: "none",
    connectionEvents: [
      { timestamp: Date.now(), username: params.player1, event: "connected" },
      { timestamp: Date.now(), username: params.player2, event: "connected" },
    ],
  };

  cacheRecord(rec);
  schedulePersist("records");
  return rec;
}

/**
 * Authoritatively record completed game result and settle series statistics.
 * Never throws for local bookkeeping; the Supabase sync is best effort and
 * skipped entirely when the server has no service key.
 */
export async function recordGameEnd(params: {
  gameCode: string;
  completeMoveHistory: any[];
  moveHistoryStrings?: string[];
  currentPosition?: any;
  startingPosition?: any;
  startingTurn?: "W" | "B";
  currentTurn?: "W" | "B";
  finalResult: "1–0" | "0–1" | "½–½";
  resultReason: string;
  winnerColor: "W" | "B" | null;
  winnerUsername: string | null;
  loserUsername: string | null;
  isDraw: boolean;
  ratingsAfter?: Record<string, number>;
  playMode?: string;
  // Optional context so a record can be synthesised correctly even when
  // recordGameStart was never called (draws used to lose both names).
  whitePlayer?: string;
  blackPlayer?: string;
  seriesId?: string;
  seriesGameNumber?: number;
  timeControl?: string;
}): Promise<KentroGameRecord> {
  let rec = recordsCache.get(params.gameCode);
  // The first authoritative completion wins. Replayed callbacks cannot
  // rewrite the winner, history, timestamp or series score.
  if (rec?.gameEndTime > 0) return rec;

  const endTime = Date.now();
  const startTime = rec?.gameStartTime || endTime;
  const durationSeconds = Math.max(1, Math.round((endTime - startTime) / 1000));

  if (!rec) {
    // Game was started before recordGameStart was called (or the record
    // aged out of the cache): rebuild what we can.
    const white = params.whitePlayer
      || (params.winnerColor === "W" ? params.winnerUsername : params.winnerColor === "B" ? params.loserUsername : null)
      || "White";
    const black = params.blackPlayer
      || (params.winnerColor === "B" ? params.winnerUsername : params.winnerColor === "W" ? params.loserUsername : null)
      || "Black";
    rec = {
      gameCode: params.gameCode,
      previousGameCode: null,
      nextGameCode: null,
      seriesId: params.seriesId || `series_${params.gameCode}`,
      seriesGameNumber: params.seriesGameNumber || 1,
      player1: white,
      player2: black,
      whitePlayer: white,
      blackPlayer: black,
      playerColors: { [white]: "W", [black]: "B" },
      gameMode: params.playMode || "Multiplayer",
      timeControl: params.timeControl || "Standard",
      completeMoveHistory: structuredClone(params.completeMoveHistory || []),
      startingPosition: params.startingPosition ? structuredClone(params.startingPosition) : null,
      startingTurn: params.startingTurn || "W",
      currentTurn: params.currentTurn,
      moveHistoryStrings: params.moveHistoryStrings || [],
      currentPosition: params.currentPosition ? structuredClone(params.currentPosition) : null,
      gameStartTime: startTime,
      gameEndTime: endTime,
      durationSeconds,
      finalResult: params.finalResult,
      resultReason: params.resultReason,
      winner: params.winnerUsername,
      loser: params.loserUsername,
      isDraw: params.isDraw,
      playerRatingsBefore: {},
      playerRatingsAfter: params.ratingsAfter || {},
      rematchStatus: "none",
    };
  } else {
    rec.gameEndTime = endTime;
    rec.durationSeconds = durationSeconds;
    rec.completeMoveHistory = structuredClone(params.completeMoveHistory || []);
    rec.moveHistoryStrings = params.moveHistoryStrings || [];
    rec.currentPosition = params.currentPosition ? structuredClone(params.currentPosition) : rec.currentPosition;
    if (params.startingPosition) rec.startingPosition = structuredClone(params.startingPosition);
    if (params.startingTurn) rec.startingTurn = params.startingTurn;
    if (params.currentTurn) rec.currentTurn = params.currentTurn;
    rec.finalResult = params.finalResult;
    rec.resultReason = params.resultReason;
    rec.winner = params.winnerUsername;
    rec.loser = params.loserUsername;
    rec.isDraw = params.isDraw;
    if (params.ratingsAfter) {
      rec.playerRatingsAfter = params.ratingsAfter;
    }
  }

  cacheRecord(rec);
  schedulePersist("records");

  // Update Series tracking
  const seriesId = rec.seriesId || `series_${rec.gameCode}`;
  let series = seriesCache.get(seriesId);
  if (!series) {
    series = {
      seriesId,
      games: [],
      seriesGamesCount: 0,
      scores: {
        [rec.whitePlayer]: 0,
        [rec.blackPlayer]: 0,
      },
      draws: 0,
    };
  }

  const existingGameIdx = series.games.findIndex(g => g.gameCode === rec!.gameCode);
  const summary: SeriesGameSummary = {
    gameCode: rec.gameCode,
    player1: rec.whitePlayer,
    player2: rec.blackPlayer,
    score: rec.finalResult,
    resultReason: rec.resultReason,
    winner: rec.winner,
    isDraw: rec.isDraw,
  };
  if (existingGameIdx >= 0) series.games[existingGameIdx] = summary;
  else series.games.push(summary);

  series.seriesGamesCount = series.games.length;
  const newScores: Record<string, number> = {
    [rec.whitePlayer]: 0,
    [rec.blackPlayer]: 0,
  };
  let drawsCount = 0;
  for (const g of series.games) {
    if (g.isDraw) drawsCount++;
    else if (g.winner) newScores[g.winner] = (newScores[g.winner] || 0) + 1;
  }
  series.scores = newScores;
  series.draws = drawsCount;

  cacheSeries(series);
  schedulePersist("series");

  // Sync to Supabase completed_games (best effort)
  if (!supabaseConfigured()) {
    if (!warnedNoSupabase) {
      warnedNoSupabase = true;
      console.log("[GameRecords] SUPABASE_SECRET_KEY not set -- game records are kept locally only.");
    }
    return rec;
  }
  try {
    const db = getSupabaseAdmin();
    const supabasePayload = {
      gameId: rec.gameCode,
      whitePlayer: rec.whitePlayer,
      blackPlayer: rec.blackPlayer,
      winner: rec.isDraw ? "Draw" : (params.winnerColor || (rec.winner === rec.whitePlayer ? "W" : "B")),
      moveHistoryStrings: rec.moveHistoryStrings || [],
      moveHistory: rec.completeMoveHistory || [],
      moveEvaluations: {
        __kentroGameRecord: {
          gameCode: rec.gameCode,
          previousGameCode: rec.previousGameCode,
          nextGameCode: rec.nextGameCode ?? null,
          seriesId: rec.seriesId,
          seriesGameNumber: rec.seriesGameNumber,
          finalResult: rec.finalResult,
          resultReason: rec.resultReason,
          durationSeconds: rec.durationSeconds,
          timeControl: rec.timeControl,
          startingPosition: rec.startingPosition ?? null,
          startingTurn: rec.startingTurn ?? "W",
          currentPosition: rec.currentPosition ?? null,
          currentTurn: rec.currentTurn,
        }
      },
      playMode: rec.gameMode || "Multiplayer",
      timestamp: rec.gameEndTime || Date.now(),
    };

    const { error } = await db.from("completed_games").upsert(supabasePayload, { onConflict: "gameId", ignoreDuplicates: true });
    if (error) {
      console.warn(`[GameRecords] Supabase upsert error for ${rec.gameCode}:`, error.message);
    } else {
      console.log(`[GameRecords] Saved game ${rec.gameCode} to completed_games in Supabase.`);
    }
  } catch (err) {
    console.error(`[GameRecords] Failed to sync ${rec.gameCode} to Supabase:`, err);
  }

  return rec;
}

/**
 * Link previous game to newly created rematch / next series game
 */
export function linkRematch(previousGameCode: string, newGameCode: string) {
  const prev = recordsCache.get(previousGameCode);
  if (prev) {
    prev.nextGameCode = newGameCode;
    prev.rematchStatus = "accepted";
    schedulePersist("records");
  }
}

function rowToRecord(row: any): KentroGameRecord {
  const extra = (row.moveEvaluations as any)?.__kentroGameRecord || {};
  const isDraw = row.winner === "Draw" || row.winner === null;
  const finalResult = isDraw ? "½–½" : row.winner === "W" ? "1–0" : "0–1";
  const winnerName = isDraw ? null : (row.winner === "W" ? row.whitePlayer : row.blackPlayer);
  const loserName = isDraw ? null : (row.winner === "W" ? row.blackPlayer : row.whitePlayer);
  return {
    gameCode: row.gameId,
    previousGameCode: extra.previousGameCode || null,
    nextGameCode: extra.nextGameCode || null,
    seriesId: extra.seriesId || `series_${row.gameId}`,
    seriesGameNumber: extra.seriesGameNumber || 1,
    player1: row.whitePlayer || "White",
    player2: row.blackPlayer || "Black",
    whitePlayer: row.whitePlayer || "White",
    blackPlayer: row.blackPlayer || "Black",
    playerColors: { [row.whitePlayer]: "W", [row.blackPlayer]: "B" },
    gameMode: row.playMode || "Multiplayer",
    timeControl: extra.timeControl || "Standard",
    startingPosition: extra.startingPosition || null,
    startingTurn: extra.startingTurn === "B" ? "B" : "W",
    currentPosition: extra.currentPosition || null,
    currentTurn: extra.currentTurn === "B" ? "B" : extra.currentTurn === "W" ? "W" : undefined,
    completeMoveHistory: Array.isArray(row.moveHistory) ? row.moveHistory : [],
    moveHistoryStrings: Array.isArray(row.moveHistoryStrings) ? row.moveHistoryStrings : [],
    gameStartTime: row.timestamp ? Number(row.timestamp) - (extra.durationSeconds || 60) * 1000 : Date.now(),
    gameEndTime: row.timestamp ? Number(row.timestamp) : Date.now(),
    durationSeconds: extra.durationSeconds || 60,
    finalResult: (extra.finalResult as any) || finalResult,
    resultReason: extra.resultReason || (isDraw ? "Draw" : "Win"),
    winner: winnerName,
    loser: loserName,
    isDraw,
    rematchStatus: "none",
  };
}

/**
 * Lookup game by Game Code (checks local cache first, then Supabase)
 */
export async function getGameRecordByCode(gameCode: string): Promise<KentroGameRecord | null> {
  const cached = recordsCache.get(gameCode);
  if (cached) return cached;
  if (!supabaseConfigured()) return null;

  try {
    const db = getSupabaseAdmin();
    const { data: row, error } = await db
      .from("completed_games")
      .select("*")
      .eq("gameId", gameCode)
      .maybeSingle();

    if (error || !row) return null;
    const rec = rowToRecord(row);
    cacheRecord(rec);
    return rec;
  } catch (err) {
    console.error(`[GameRecords] Failed to get game ${gameCode}:`, err);
    return null;
  }
}

/**
 * Get recent completed games
 */
export async function getRecentGameRecords(limit: number = 25): Promise<KentroGameRecord[]> {
  const all = Array.from(recordsCache.values())
    .filter(g => g.gameEndTime > 0)
    .sort((a, b) => b.gameEndTime - a.gameEndTime);

  if (all.length >= limit || !supabaseConfigured()) {
    return uniqueCompletedMatches(all).slice(0, limit);
  }

  // Complement with Supabase if cache is small
  try {
    const db = getSupabaseAdmin();
    const { data: rows } = await db
      .from("completed_games")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(limit);

    if (rows) {
      for (const row of rows) {
        if (!recordsCache.has(row.gameId)) cacheRecord(rowToRecord(row));
      }
    }
  } catch (err) {
    console.warn("[GameRecords] Failed to query recent games from Supabase:", err);
  }

  return uniqueCompletedMatches(Array.from(recordsCache.values())
    .filter(g => g.gameEndTime > 0))
    .slice(0, limit);
}

/**
 * Get series by ID
 */
export function getSeriesById(seriesId: string): RematchSeriesData | null {
  return seriesCache.get(seriesId) || null;
}
