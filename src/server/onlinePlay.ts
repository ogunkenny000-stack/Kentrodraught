import path from "node:path";
import { DurableState } from "./durableState";
import { replayForAnalysis } from "../lib/analysisReplay";
// Online play (multiplayer rooms) -- the WebSocket server.
//
// Implements the server side of docs/ONLINE_PLAY_PROTOCOL.md (v2):
//   §1 sessions / identity          §2 error envelope
//   §3 phases + per-room seq        §4 server-authoritative clocks
//   §5 ping/pong                    §6 reconnect / resync
//   §7 leaving / abandoning         §8 rematch
//   §9 validation + limits          §10 call relay rules
//   §11 records + settlement
//
// Mounted from server.ts via attachOnlinePlay(server, deps). The `deps`
// are the coin/pricing helpers that live in server.ts (they are shared with
// the HTTP API and stay there); everything room-related lives here.
import { WebSocketServer } from "ws";
import type { Server as HttpServer } from "http";
import { applyMove, createInitialBoard } from "../gameLogic";
import type { Board, Move } from "../gameLogic";
import { debitMultipleWallets, settleMatchPot } from "../../coinsService";
import { getSupabaseAdmin } from "../../supabaseAdmin";
import { getNextGameCode, linkRematch, recordGameEnd, recordGameStart, recordGameStartingPosition } from "./gameRecordsManager";
import { checkGameEndFrom, normalizeBoard } from "./gameEnd";
import {
  applyMoveToClock,
  clockSnapshot,
  createClock,
  legacySeconds,
  pauseClock,
  remainingMs as clockRemainingMs,
  resumeClock,
  untimedClock,
  type RoomClock,
} from "./roomClock";
import { SessionStore, type Session } from "./sessions";
import { isOnlineGuest, guestHasOnlineTrial, claimOnlineGuestTrials, localGuestTrials, restoreGuestTrials } from "./guestQuota";
import { notifyMatchEnded } from "./notifications";
import { isCallMessageType, validateMessage } from "./wsValidation";
import {
  CALL_PEER_DISCONNECT_GRACE_MS,
  CALL_REQUEST_TIMEOUT_MS,
  MAX_WS_PAYLOAD_BYTES,
  SESSION_TTL_MS,
  SIGNALLING_BUFFER_MS,
  clockLimitTypeFor,
  type ChatTailEntry,
  type ClockState,
  type Color,
  type PendingOffer,
  type RoomPhase,
  type ServerErrorCode,
} from "../shared/protocol";

type WS = any;

export interface OnlinePlayDeps {
  recoveryPath?: string | false;
  onGameCompleted?: (game: { gameCode: string; white: string; black: string; winner: Color | null; draw: boolean; roomId: string; tournamentId?: string }) => void | Promise<void>;
  coinsEnabled: boolean;
  getCoinSettings: () => Promise<{ matchRakePercent: number } & Record<string, any>>;
  resolveEntryFee: (room: { gameTime: number; specialRule: string; wagerAmount?: number }, settings: any) => number;
  sanitizeWagerAmount: (raw: unknown) => number | null;
  sanitizeBestOf: (raw: unknown) => number;
  sanitizeCustomBoard: (raw: unknown) => Board | null;
  findLegalMatch: (board: Board, turn: Color, claimed: Move) => Move | null;
}

type ClockLimitType = "Blitz" | "Rapid" | "Classical" | "Untimed";
type SpecialRule = "none" | "short-one" | "short-two" | "short-three" | "crown-crown" | "no-kentrodraught";

interface OnlinePlayer {
  ws: WS;
  username: string;
  key: string;
  roomId: string | null;
  token: string;
}

interface Seat {
  ws: WS | null; // null while disconnected (grace) or a ghost in a finished room
  username: string;
  key: string;
  userId: string | null;
  color: Color;
  ready: boolean;
  // --- Fair Play Guard ---
  awayStrikes: number;
  awayMs: number;
  awaySince: number | null;
  awayForfeitTimer: NodeJS.Timeout | null;
  // --- Disconnect grace (per player, so BOTH may be away at once) ---
  disconnectedAt: number | null;
  forfeitTimer: NodeJS.Timeout | null;
  graceExpired: boolean;
}

interface Spectator {
  ws: WS | null;
  username: string;
  key: string;
  disconnectedAt: number | null;
}

interface GameState {
  board: Board | null;
  turn: Color;
  moveHistory: Move[];
  whiteTime: number;
  blackTime: number;
  statusMessage: string;
}

interface Room {
  id: string;
  tournamentId?: string;
  tournamentMatchId?: string;
  awaitingFirstJoin?: boolean;
  terminalResult?: { isDraw: boolean; winnerColor: Color | null; reason: string };
  private: boolean;
  seq: number;
  phase: RoomPhase;
  players: Seat[];
  spectators: Spectator[];
  gameState: GameState | null;
  started: boolean;
  clockLimitType: ClockLimitType;
  clock: RoomClock;
  flagTimer: NodeJS.Timeout | null;
  incrementSec: number;
  startBoard: Board | null;
  startTurn: Color;
  deletionTimer: NodeJS.Timeout | null;
  gameTime: number;
  specialRule: SpecialRule;
  hostTime: number;
  guestTime: number;
  wagerAmount?: number;
  creator: string;
  bestOf: number;
  seriesGameNumber: number;
  seriesScore: { [username: string]: number };
  seriesDraws: number;
  seriesOver: boolean;
  seriesNextGameTimer: NodeJS.Timeout | null;
  customBoard?: Board;
  customTurn?: Color;
  setupPhase: {
    [username: string]: {
      kingSq?: number;
      kingSelected?: boolean;
      pendingKingPlacement?: boolean;
      removedFromSq?: number;
    };
  } | null;
  feesCharged: boolean;
  entryFeePerPlayer?: number;
  potSettled: boolean;
  potGeneration?: number;
  potSettling: boolean;
  potId: string;
  starting: boolean;
  resultRecorded: boolean;
  gamesStarted: number;
  pendingEndOffer: { type: "resign" | "draw"; fromUsername: string } | null;
  previousGameCode: string | null;
  gameCode: string;
  seriesId: string;
  gameStartTime: number;
  pendingRematch: { fromUsername: string; requestedAt: number } | null;
  chatTail: ChatTailEntry[];
}

interface ActiveCall {
  peer: string; // key of the other party
  kind: "call" | "voice";
  pending: boolean;
  startedAt: number;
  timer: NodeJS.Timeout | null;
}

const DISCONNECT_GRACE_UNTIMED_MS = 10 * 60 * 1000;
const DISCONNECT_GRACE_MIN_MS = 2_000;
const ROOM_EMPTY_DELETE_MS = 15 * 60 * 1000;
const NEXT_GAME_DELAY_MS = 6000;
const NEXT_GAME_RETRY_MS = 2000;
const CHAT_TAIL_MAX = 50;
const SPECTATOR_GRACE_MS = 2 * 60 * 1000;
const BROADCAST_COALESCE_MS = 1000;
const MAX_OPEN_ROOMS_PER_USER = 3;
const FLOOD_WINDOW_MS = 3000;
const FLOOD_MAX_MESSAGES = 75;
const CHAT_MAX_PER_WINDOW = 8;

// --- Fair Play Guard tuning (unchanged) ---
const FAIRPLAY_MAX_STRIKES = 7;
const FAIRPLAY_SINGLE_ABSENCE_MS = 15_000;
const FAIRPLAY_MAX_TOTAL_AWAY_MS = 30_000;

const supabaseConfigured = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const accountAuthRequired = () => process.env.NODE_ENV === "production" || !!(process.env.SUPABASE_URL || process.env.SUPABASE_SECRET_KEY);

export function attachOnlinePlay(server: HttpServer, deps: OnlinePlayDeps) {
  const wss = new WebSocketServer({ server, maxPayload: MAX_WS_PAYLOAD_BYTES, perMessageDeflate: false });

  const onlinePlayers = new Map<WS, OnlinePlayer>();
  const rooms = new Map<string, Room>();
  const userSessions = new Map<string, Set<Session>>();
  const authRevocations = new Map<string, number>();
  let authRevision = 0;
  const sessions = new SessionStore({
    ttlMs: SESSION_TTL_MS,
    keepAlive: (s) => holdsLiveSeat(s.key),
    onExpire: (s) => {
      forgetUserSession(s);
      cleanupGhostSeats(s.key);
      console.log(`[WS] Session expired: ${s.username}`);
    },
  });
  const activeCalls = new Map<string, ActiveCall>();
  const callDisconnectTimers = new Map<string, NodeJS.Timeout>();
  const signalBuffers = new Map<string, { items: any[]; timer: NodeJS.Timeout }>();
  let shuttingDown = false;
  let storageFailed = false;
  const recovery = new DurableState<any>(deps.recoveryPath ?? (process.env.NODE_ENV === 'test' && !process.env.KENTRO_DATA_DIR ? false : path.join(process.env.KENTRO_DATA_DIR || path.join(process.cwd(), 'data'), 'live_rooms.json')));
  const excluded = new Set(['ws', 'expireTimer', 'flagTimer', 'deletionTimer', 'seriesNextGameTimer', 'awayForfeitTimer', 'forfeitTimer']);
  let checkpointFingerprint = "";
  function checkpoint(force = false): void {
    if (shuttingDown || !recovery.file) return;
    if (storageFailed) throw new Error('Room persistence unavailable; restart after repairing storage');
    try {
      const persistedRooms = JSON.parse(JSON.stringify([...rooms.values()], (key, value) => excluded.has(key) ? undefined : value));
      for (const room of persistedRooms) room.seq = Math.ceil(room.seq / 256) * 256;
      const fingerprint = JSON.stringify({ rooms: persistedRooms, sessions: sessions.snapshot(), guestTrials: localGuestTrials() });
      if (!force && fingerprint === checkpointFingerprint) return;
      for (const room of persistedRooms) { const live = rooms.get(room.id)!; room.clock = { ...live.clock, whiteMs: clockRemainingMs(live.clock, "W", now()), blackMs: clockRemainingMs(live.clock, "B", now()), running: null }; }
      recovery.write({ rooms: persistedRooms, sessions: sessions.snapshot(), guestTrials: localGuestTrials() });
      checkpointFingerprint = fingerprint;
    } catch (error) { storageFailed = true; throw error; }
  }


  // ------------------------------------------------------------------
  // Small utilities
  // ------------------------------------------------------------------
  const now = () => Date.now();
  const keyOf = (name: string) => name.toLowerCase();
  const isSameUser = (u1?: string | null, u2?: string | null) => !!u1 && !!u2 && u1.trim().toLowerCase() === u2.trim().toLowerCase();
  const isLive = (ws: WS | null | undefined) => !!ws && ws.readyState === 1;
  const otherColor = (c: Color): Color => (c === "W" ? "B" : "W");
  const colorName = (c: Color | null) => (c === "W" ? "White" : c === "B" ? "Black" : "Nobody");

  function forgetUserSession(session: Session): void {
    if (!session.userId) return;
    const bound = userSessions.get(session.userId);
    bound?.delete(session);
    if (bound?.size === 0) userSessions.delete(session.userId);
  }

  /** Remove every resume token and disconnect the account through normal match cleanup. */
  function revokeUser(userId: string): void {
    authRevocations.set(userId, ++authRevision);
    for (const session of Array.from(userSessions.get(userId) ?? [])) {
      sessions.remove(session);
      forgetUserSession(session);
      if (session.ws) {
        sendError(session.ws, "not-logged-in", "Account access has been removed.");
        try { session.ws.close(4003, "account-access-revoked"); }
        catch { session.ws.terminate(); }
      }
    }
  }

  function safeTimer(label: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`[WS] timer "${label}" failed:`, err);
    }
  }

  function sendJson(ws: WS, msg: any): void {
    if (!isLive(ws)) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      console.error("[WS] send failed:", err);
    }
  }

  function sendError(ws: WS, code: ServerErrorCode, message: string, context?: Record<string, unknown>): void {
    sendJson(ws, context ? { type: "error", code, message, context } : { type: "error", code, message });
  }

  function nextSeq(room: Room): number {
    room.seq += 1;
    return room.seq;
  }

  /** Players AND live spectators. Every room-scoped message carries `seq`. Seated players receive their specific `yourColor`. */
  function sendToRoom(room: Room, message: any, excludeWs?: WS): void {
    const seq = nextSeq(room);
    checkpoint();
    for (const p of room.players) {
      if (p.ws && p.ws !== excludeWs && isLive(p.ws)) {
        sendJson(p.ws, message.yourColor !== undefined
          ? { ...message, seq }
          : { ...message, yourColor: p.color, seq });
      }
    }
    for (const s of room.spectators) {
      if (s.ws && s.ws !== excludeWs && isLive(s.ws)) {
        sendJson(s.ws, message.yourColor !== undefined
          ? { ...message, seq }
          : { ...message, yourColor: "W", seq });
      }
    }
  }

  function sendDirect(room: Room, ws: WS, message: any): void {
    sendJson(ws, { ...message, seq: nextSeq(room) });
  }

  function cleanRoomCode(raw: any): string {
    if (raw === null || raw === undefined) return "";
    return String(raw).replace(/[^A-Za-z0-9]/g, "").toUpperCase().trim().slice(0, 10);
  }

  function sanitizeInputString(input: unknown, maxLen = 500): string {
    if (typeof input !== "string") return "";
    return input
      .slice(0, maxLen)
      .replace(/[<>]/g, "")
      .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
      .trim();
  }

  function isValidUsername(username: unknown): boolean {
    if (typeof username !== "string") return false;
    const trimmed = username.trim();
    return trimmed.length >= 1 && trimmed.length <= 40 && !/[<>\x00-]/.test(trimmed);
  }

  function onlineUsernames(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of onlinePlayers.values()) {
      if (!isLive(p.ws) || seen.has(p.key)) continue;
      seen.add(p.key);
      out.push(p.username);
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Coalesced lobby broadcasts (§9): at most one per second, and only to
  // sockets that are NOT inside a live game.
  // ------------------------------------------------------------------
  function makeCoalescer(label: string, build: () => any) {
    let timer: NodeJS.Timeout | null = null;
    let lastSentAt = 0;
    const flush = () => {
      timer = null;
      lastSentAt = now();
      const payload = JSON.stringify(build());
      for (const p of onlinePlayers.values()) {
        if (!isLive(p.ws)) continue;
        if (p.roomId) {
          const r = rooms.get(p.roomId);
          if (r && (r.phase === "playing" || r.phase === "setup")) continue;
        }
        // Lobby broadcasts are informational. Drop an obsolete snapshot
        // rather than grow the outbound buffer of a congested mobile socket.
        // Critical room/move traffic still uses sendToRoom separately.
        if (p.ws.bufferedAmount > 256 * 1024) continue;
        try { p.ws.send(payload); } catch { /* socket close handler cleans up */ }
      }
    };
    return {
      schedule() {
        if (shuttingDown || timer) return;
        const wait = Math.max(0, BROADCAST_COALESCE_MS - (now() - lastSentAt));
        timer = setTimeout(() => safeTimer(label, flush), wait);
      },
      cancel() { if (timer) clearTimeout(timer); timer = null; },
    };
  }
  const onlineUsersBroadcast = makeCoalescer("online-users", () => ({ type: "online-users-update", onlineUsers: onlineUsernames() }));
  const openRoomsBroadcast = makeCoalescer("open-rooms", () => ({ type: "open-rooms-list", rooms: getOpenRoomsData() }));
  const broadcastOnlineUsers = () => onlineUsersBroadcast.schedule();
  const broadcastOpenRooms = () => openRoomsBroadcast.schedule();

  function getOpenRoomsData() {
    const openList: any[] = [];
    for (const r of rooms.values()) {
      const host = r.players[0];
      if (r.private || r.phase !== "lobby" || r.players.length !== 1 || !host || !isLive(host.ws)) continue;
      openList.push({
        id: r.id,
        creator: r.creator || host.username,
        hostName: host.username,
        gameTime: r.gameTime,
        increment: r.incrementSec,
        specialRule: r.specialRule,
        wagerAmount: r.wagerAmount || 0,
        bestOf: r.bestOf || 1,
        playersCount: r.players.length,
      });
    }
    return openList;
  }

  // ------------------------------------------------------------------
  // Room lookups / payloads
  // ------------------------------------------------------------------
  function seatOf(room: Room, ws: WS): Seat | undefined {
    return room.players.find((p) => p.ws === ws);
  }

  function seatByKey(room: Room, key: string): Seat | undefined {
    return room.players.find((p) => p.key === key);
  }

  function opponentOf(room: Room, seat: Seat): Seat | undefined {
    return room.players.find((p) => p !== seat);
  }

  function isSpectatorWs(room: Room, ws: WS): boolean {
    return room.spectators.some((s) => s.ws === ws);
  }

  function liveSpectatorCount(room: Room): number {
    return room.spectators.filter((s) => isLive(s.ws)).length;
  }

  function pruneSpectators(room: Room): void {
    const t = now();
    room.spectators = room.spectators.filter((s) => isLive(s.ws) || (s.disconnectedAt !== null && t - s.disconnectedAt < SPECTATOR_GRACE_MS));
  }

  function isLivePhase(room: Room): boolean {
    return room.phase === "playing" || room.phase === "setup";
  }

  /** A Best-of-N match that has begun but not finished (between games or mid-game). */
  function isSeriesUnderway(room: Room): boolean {
    if (room.bestOf <= 1 || room.seriesOver || room.players.length < 2) return false;
    return (
      room.seriesGameNumber > 1 ||
      room.seriesDraws > 0 ||
      Object.values(room.seriesScore).some((v) => v > 0) ||
      (!!room.entryFeePerPlayer && !room.potSettled && room.feesCharged)
    );
  }

  function pendingOfferOf(room: Room): PendingOffer | null {
    if (room.pendingEndOffer) return { type: room.pendingEndOffer.type, from: room.pendingEndOffer.fromUsername };
    if (room.pendingRematch) return { type: "rematch", from: room.pendingRematch.fromUsername };
    return null;
  }

  function clockOf(room: Room): ClockState {
    return clockSnapshot(room.clock, now());
  }

  function refreshLegacyTimes(room: Room): void {
    if (!room.gameState) return;
    const t = now();
    room.gameState.whiteTime = legacySeconds(room.clock, "W", t);
    room.gameState.blackTime = legacySeconds(room.clock, "B", t);
  }

  function playersPayload(room: Room) {
    return room.players.map((p) => ({ username: p.username, color: p.color, ready: p.ready, connected: isLive(p.ws) }));
  }

  function roomInfoPayload(room: Room) {
    refreshLegacyTimes(room);
    return {
      type: "room-info",
      roomId: room.id,
      private: room.private,
      players: playersPayload(room),
      spectatorCount: liveSpectatorCount(room),
      gameState: room.gameState,
      started: room.started,
      phase: room.phase,
      clock: clockOf(room),
      clockLimitType: room.clockLimitType,
      gameTime: room.gameTime,
      increment: room.incrementSec,
      specialRule: room.specialRule,
      hostTime: room.hostTime,
      guestTime: room.guestTime,
      wagerAmount: room.wagerAmount,
      bestOf: room.bestOf,
      seriesGameNumber: room.seriesGameNumber,
      seriesScore: room.seriesScore,
      seriesDraws: room.seriesDraws,
      seriesOver: room.seriesOver,
      creator: room.creator,
      setupPhase: room.setupPhase,
      gameCode: room.gameCode,
      pendingOffer: pendingOfferOf(room),
    };
  }

  function sendRoomInfo(room: Room, extra?: any): void {
    sendToRoom(room, { ...roomInfoPayload(room), ...extra });
  }

  function rejoinExtras(room: Room, seat: Seat | null) {
    const opp = seat ? opponentOf(room, seat) : undefined;
    return {
      clock: clockOf(room),
      phase: room.phase,
      yourColor: seat ? seat.color : null,
      pendingOffer: pendingOfferOf(room),
      chatTail: room.chatTail.slice(-CHAT_TAIL_MAX),
      opponentConnected: seat ? !!(opp && isLive(opp.ws)) : room.players.every((p) => isLive(p.ws)),
    };
  }

  function pushChat(room: Room, from: string, text: string): void {
    room.chatTail.push({ from, text, ts: now() });
    if (room.chatTail.length > CHAT_TAIL_MAX) room.chatTail.splice(0, room.chatTail.length - CHAT_TAIL_MAX);
  }

  function broadcastSeriesUpdate(room: Room, extra?: any): void {
    sendToRoom(room, {
      type: "series-update",
      bestOf: room.bestOf,
      gameNumber: room.seriesGameNumber,
      score: room.seriesScore,
      draws: room.seriesDraws,
      seriesOver: room.seriesOver,
      ...extra,
    });
  }

  // ------------------------------------------------------------------
  // Clock management (§4)
  // ------------------------------------------------------------------
  function clockShouldRun(room: Room): boolean {
    return (
      room.clock.timed &&
      room.phase === "playing" &&
      !!room.gameState &&
      !room.pendingEndOffer &&
      room.players.length === 2 &&
      room.players.every((p) => isLive(p.ws) && p.disconnectedAt === null)
    );
  }

  /** Reconcile the clock with the room's state: run for the side to move, or pause. */
  function syncClock(room: Room): void {
    const t = now();
    if (clockShouldRun(room)) {
      const turn = room.gameState!.turn;
      if (room.clock.running !== turn) resumeClock(room.clock, turn, t);
    } else if (room.clock.running) {
      pauseClock(room.clock, t);
    }
    armFlagTimer(room);
    refreshLegacyTimes(room);
  }

  function clearFlagTimer(room: Room): void {
    if (room.flagTimer) {
      clearTimeout(room.flagTimer);
      room.flagTimer = null;
    }
  }

  function armFlagTimer(room: Room): void {
    clearFlagTimer(room);
    if (!room.clock.timed || !room.clock.running) return;
    const rem = clockRemainingMs(room.clock, room.clock.running, now());
    room.flagTimer = setTimeout(() => safeTimer(`flag ${room.id}`, () => onFlag(room)), Math.max(0, rem) + 1);
  }

  function onFlag(room: Room): void {
    room.flagTimer = null;
    if (rooms.get(room.id) !== room) return;
    if (room.phase !== "playing" || !room.clock.running || !room.gameState) return;
    const side = room.clock.running;
    const rem = clockRemainingMs(room.clock, side, now());
    if (rem > 0) {
      armFlagTimer(room); // woke up early (timer drift) -- re-arm
      return;
    }
    pauseClock(room.clock, now());
    if (side === "W") room.clock.whiteMs = 0;
    else room.clock.blackMs = 0;
    const winner = otherColor(side);
    endLiveGame(
      room,
      { isDraw: false, winnerColor: winner },
      "timeout",
      `Game Over! ${colorName(winner)} wins on time. ⏱️`,
      { recordReason: "Timeout" },
    );
  }

  /** Sends the (possibly paused/resumed) clock to one socket -- used for the actor of a dialog. */
  function sendClockSync(room: Room, ws: WS): void {
    sendDirect(room, ws, { type: "clock-sync", clock: clockOf(room), phase: room.phase });
  }

  // ------------------------------------------------------------------
  // Game lifecycle
  // ------------------------------------------------------------------
  function buildInitialRoomBoard(room: Room): { board: Board; startingTurn: Color; statusMessage: string } {
    let initialBoard: Board = {};
    if (room.customBoard) {
      initialBoard = normalizeBoard(room.customBoard);
    } else {
      for (let sq = 1; sq <= 50; sq++) {
        if (sq >= 1 && sq <= 20) initialBoard[sq] = "b";
        else if (sq >= 31 && sq <= 50) initialBoard[sq] = "w";
        else initialBoard[sq] = null;
      }
    }

    const host = room.players.find((p) => p.username === room.creator) ?? room.players[0];
    const hostColor: Color = host?.color ?? "W";
    if (!room.customBoard && room.specialRule === "short-one") {
      if (hostColor === "W") initialBoard[50] = null;
      else initialBoard[1] = null;
    } else if (!room.customBoard && room.specialRule === "short-two") {
      if (hostColor === "W") { initialBoard[50] = null; initialBoard[49] = null; }
      else { initialBoard[1] = null; initialBoard[2] = null; }
    } else if (!room.customBoard && room.specialRule === "short-three") {
      if (hostColor === "W") { initialBoard[50] = null; initialBoard[49] = null; initialBoard[48] = null; }
      else { initialBoard[1] = null; initialBoard[2] = null; initialBoard[3] = null; }
    }

    const startingTurn: Color = room.customBoard ? (room.customTurn || "W") : "W";
    const statusMessage = room.customBoard
      ? `Custom position loaded! ${colorName(startingTurn)} to play.`
      : room.specialRule === "crown-crown"
        ? "Crown Crown Mode: Tap one of your front-row pieces to remove it, then tap any square on your back row to crown it there (a man already there slides forward into the gap)."
        : "Multiplayer game started! White to play.";
    return { board: initialBoard, startingTurn, statusMessage };
  }

  function seriesWinsNeeded(bestOf: number): number {
    return Math.floor(bestOf / 2) + 1;
  }

  /** The record code for the next game in this room (§11: one per game). */
  function allocateGameCode(room: Room): string {
    return room.gamesStarted === 0 ? room.id : getNextGameCode(rooms);
  }

  function minutesToMs(min: number): number {
    return Math.round(Math.max(0, min) * 60_000);
  }

  function resetSeatForGame(p: Seat): void {
    p.ready = true;
    p.awayStrikes = 0;
    p.awayMs = 0;
    p.awaySince = null;
    if (p.awayForfeitTimer) {
      clearTimeout(p.awayForfeitTimer);
      p.awayForfeitTimer = null;
    }
    p.graceExpired = false;
  }

  /** Puts the room into a fresh game (first game, next series game, rematch). */
  function beginGame(room: Room, gameCode: string, labelPrefix: string): void {
    const { board, startingTurn, statusMessage } = buildInitialRoomBoard(room);
    const host = room.players.find((p) => p.username === room.creator) ?? room.players[0];
    const hostColor: Color = host?.color ?? "W";
    const hostMin = room.hostTime > 0 ? room.hostTime : room.gameTime;
    const guestMin = room.guestTime > 0 ? room.guestTime : room.gameTime;
    const timed = room.clockLimitType !== "Untimed" && room.gameTime > 0;
    room.clock = createClock(
      hostColor === "W" ? minutesToMs(hostMin) : minutesToMs(guestMin),
      hostColor === "B" ? minutesToMs(hostMin) : minutesToMs(guestMin),
      room.incrementSec * 1000,
      timed,
    );
    clearFlagTimer(room);

    room.startBoard = normalizeBoard(board);
    room.startTurn = startingTurn;
    const crown = !room.customBoard && room.specialRule === "crown-crown";
    room.setupPhase = crown ? Object.fromEntries(room.players.map((p) => [p.username, {}])) : null;
    room.phase = crown ? "setup" : "playing";
    room.started = true;
    room.resultRecorded = false;
    room.terminalResult = undefined;
    room.pendingEndOffer = null;
    room.pendingRematch = null;
    room.gameState = {
      board,
      turn: startingTurn,
      moveHistory: [],
      whiteTime: 0,
      blackTime: 0,
      statusMessage: labelPrefix + statusMessage,
    };
    room.gameStartTime = now();
    room.previousGameCode = room.gamesStarted > 0 ? room.gameCode : null;
    room.gameCode = gameCode;
    room.gamesStarted += 1;
    for (const p of room.players) resetSeatForGame(p);

    if (room.previousGameCode && room.previousGameCode !== gameCode) {
      try { linkRematch(room.previousGameCode, gameCode); } catch (err) { console.error("[GameRecord] link error:", err); }
    }
    const whiteName = room.players.find((p) => p.color === "W")?.username || "White";
    const blackName = room.players.find((p) => p.color === "B")?.username || "Black";
    try {
      recordGameStart({
        gameCode,
        private: room.private,
        participantUserIds: room.players.flatMap((p) => {
          const id = p.userId;
          return id ? [id] : [];
        }),
        previousGameCode: room.previousGameCode,
        seriesId: room.seriesId,
        seriesGameNumber: room.seriesGameNumber || 1,
        player1: whiteName,
        player2: blackName,
        playerColors: { [whiteName]: "W", [blackName]: "B" },
        gameMode: "Multiplayer",
        timeControl: timed ? `${room.gameTime} min${room.incrementSec ? ` + ${room.incrementSec}s` : ""}` : "Untimed",
        startingPosition: room.startBoard,
        startingTurn: room.startTurn,
      });
    } catch (err) {
      console.error("[GameRecord] Failed to record game start:", err);
    }

    syncClock(room);
    // Fresh colors first (clients read yourColor from the players list),
    // then the actual game start.
    sendRoomInfo(room);
    sendToRoom(room, {
      type: "game-started",
      roomId: room.id,
      private: room.private,
      players: playersPayload(room),
      gameState: room.gameState,
      clockLimitType: room.clockLimitType,
      clock: clockOf(room),
      phase: room.phase,
      gameCode,
      bestOf: room.bestOf,
      seriesGameNumber: room.seriesGameNumber,
    });
    if (room.bestOf > 1 && room.seriesGameNumber > 1) broadcastSeriesUpdate(room);
    broadcastOpenRooms();
    console.log(`[WS] Room ${room.id}: game ${gameCode} started (${room.phase}, ${whiteName} vs ${blackName}${room.bestOf > 1 ? `, series game ${room.seriesGameNumber}/${room.bestOf}` : ""}).`);
  }

  /**
   * Starts a match: charges entry fees (once, under a synchronous lock so a
   * double `ready`/accept can't double-debit), then begins game 1.
   */
  async function startRoomMatch(room: Room, preallocatedGameCode?: string): Promise<void> {
    if (room.players.length !== 2 || room.starting || isLivePhase(room)) return;
    if (room.players.some((p) => !isLive(p.ws) || p.disconnectedAt !== null)) {
      sendToRoom(room, { type: "room-error", error: "Both players must be connected to start the match." });
      sendRoomInfo(room);
      return;
    }
    room.starting = true;
    // Keep the exact charged participants even if a seat is removed during
    // an asynchronous settings/debit call. Never debit a replacement roster.
    const participants = room.players.map((seat) => ({ seat, username: seat.username, color: seat.color }));
    const rosterIsCurrent = () => rooms.get(room.id) === room && room.players.length === participants.length &&
      participants.every((p, index) => room.players[index] === p.seat && p.seat.username === p.username &&
        p.seat.color === p.color && p.seat.disconnectedAt === null && isLive(p.seat.ws));
    try {
      for (const pl of room.players) pl.ready = true;
      const gameCode = preallocatedGameCode ?? allocateGameCode(room);

      if (!room.feesCharged && deps.coinsEnabled && !participants.some(p => isOnlineGuest(p.username))) {
        const coinSettings = await deps.getCoinSettings();
        if (!rosterIsCurrent()) {
          for (const pl of room.players) pl.ready = false;
          if (rooms.get(room.id) === room) sendRoomInfo(room);
          return;
        }
        const entryFee = coinSettings ? deps.resolveEntryFee(room, coinSettings) : 0;
        if (entryFee > 0) {
          const usernames = participants.map((p) => p.username);
          let chargeResult: Awaited<ReturnType<typeof debitMultipleWallets>>;
          try {
            chargeResult = await debitMultipleWallets(usernames, entryFee, "match_entry", gameCode);
          } catch (err) {
            console.error("Wallet debit failed at match start:", err);
            for (const pl of room.players) pl.ready = false;
            sendToRoom(room, { type: "room-error", error: "Wallet service is unavailable right now — try again in a moment." });
            sendRoomInfo(room);
            return;
          }
          if (chargeResult.ok === false) {
            for (const pl of room.players) pl.ready = false;
            sendToRoom(room, {
              type: "room-error",
              error: `Match cannot start: ${chargeResult.insufficientUsers.join(", ")} don't have enough Kentro Coins (need ${entryFee}).`,
            });
            sendRoomInfo(room);
            return;
          }
          room.potGeneration = (room.potGeneration ?? 0) + 1;
          room.feesCharged = true;
          room.entryFeePerPlayer = entryFee;
          room.potSettled = false;
          room.potSettling = false;
          room.potId = gameCode;
        }
      }

      // Somebody may have vanished while the wallet call was in flight.
      if (!rosterIsCurrent()) {
        if (room.feesCharged && room.entryFeePerPlayer && !room.potSettled) {
          settleWithRetry(room, { isDraw: true, winnerColor: null }, "refund (player left before start)", participants);
        }
        room.feesCharged = false;
        room.entryFeePerPlayer = undefined;
        for (const pl of room.players) pl.ready = false;
        if (rooms.get(room.id) === room) sendRoomInfo(room);
        return;
      }

      // The authoritative one-game quota is claimed once, immediately
      // before the first match starts (never just for creating a lobby).
      // Durable RPC performs an atomic all-or-none claim for both guests.
      if (participants.some(p => isOnlineGuest(p.username))) {
        let admitted = false;
        try {
          admitted = await claimOnlineGuestTrials(participants.map(p => p.username));
        } catch (err) {
          console.error("[Guest] Admission service failure", err);
          sendToRoom(room, { type: "room-error", error: "Guest trial service is unavailable. Try again shortly." });
          return;
        }
        if (!admitted) {
          for (const p of participants) {
            if (isOnlineGuest(p.username) && isLive(p.seat.ws)) {
              sendJson(p.seat.ws, { type: "guest-limit-reached", mode: "online", message: "Your one free online game is finished. Sign in to play more." });
            }
          }
          sendToRoom(room, { type: "room-error", error: "A guest has used their free online match. Sign in to play again." });
          return;
        }
        if (!rosterIsCurrent()) return;
      }
      if (!room.seriesId) room.seriesId = `series_${gameCode}`;
      room.seriesGameNumber = 1;
      beginGame(room, gameCode, room.bestOf > 1 ? `Game 1 of ${room.bestOf}: ` : "");
    } finally {
      room.starting = false;
    }
  }

  function scheduleNextSeriesGame(room: Room, delayMs: number): void {
    if (room.seriesNextGameTimer) clearTimeout(room.seriesNextGameTimer);
    room.seriesNextGameTimer = setTimeout(() => {
      room.seriesNextGameTimer = null;
      safeTimer(`next-series-game ${room.id}`, () => {
        if (rooms.get(room.id) !== room || room.seriesOver || isLivePhase(room)) return;
        startNextSeriesGame(room);
      });
    }, delayMs);
  }

  /** Next game of a Best-of-N: colours swap, clocks reset, board rebuilt. */
  function startNextSeriesGame(room: Room): void {
    if (room.seriesOver || room.players.length < 2 || isLivePhase(room)) return;
    if (room.players.some((p) => !isLive(p.ws))) {
      // Somebody is in disconnect grace -- wait for them (their forfeit
      // timer ends the series if they never come back).
      scheduleNextSeriesGame(room, NEXT_GAME_RETRY_MS);
      return;
    }
    room.seriesGameNumber += 1;
    for (const p of room.players) p.color = otherColor(p.color);
    beginGame(room, allocateGameCode(room), `Game ${room.seriesGameNumber} of ${room.bestOf}: `);
  }

  /**
   * Ends the game currently in progress in `room` (playing or setup).
   * Exactly once per game (guarded by resultRecorded). Broadcasts
   * game-ended, then routes the result through recordGameResultAndSettle.
   */
  function endLiveGame(
    room: Room,
    result: { isDraw: boolean; winnerColor: Color | null },
    reason: string,
    statusMessage: string,
    opts?: { forfeitWholeSeries?: boolean; recordReason?: string; abandonSeries?: boolean },
  ): boolean {
    if (room.resultRecorded || !isLivePhase(room)) return false;
    room.terminalResult = { ...result, reason: opts?.recordReason ?? reason };
    room.resultRecorded = true;
    pauseClock(room.clock, now());
    clearFlagTimer(room);
    room.phase = "ended";
    room.started = false;
    room.pendingEndOffer = null;
    room.setupPhase = null;
    for (const p of room.players) {
      if (p.awayForfeitTimer) { clearTimeout(p.awayForfeitTimer); p.awayForfeitTimer = null; }
      p.awaySince = null;
    }
    refreshLegacyTimes(room);
    if (room.gameState) room.gameState.statusMessage = statusMessage;

    recordGameResultAndSettle(room, result, {
      forfeitWholeSeries: opts?.forfeitWholeSeries,
      reason: opts?.recordReason ?? reason,
      abandonSeries: opts?.abandonSeries,
    });
    sendToRoom(room, {
      type: "game-ended",
      reason,
      winnerColor: result.winnerColor,
      statusMessage,
      clock: clockOf(room),
      phase: room.phase,
      gameCode: room.gameCode,
    });
    if (room.players.every((p) => !isLive(p.ws))) armDeletionTimer(room);
    broadcastOpenRooms();
    return true;
  }

  /**
   * Pot settlement with retries (§11). potSettled is only set once
   * settleMatchPot has actually succeeded; failures are logged and never
   * block game flow.
   */
  function settleWithRetry(room: Room, result: { isDraw: boolean; winnerColor: Color | null }, label: string, participants?: Array<{ username: string; color: Color }>): void {
    if (room.potSettled || room.potSettling || !room.entryFeePerPlayer) return;
    room.potSettling = true;
    const generation = room.potGeneration ?? 0;
    const players = (participants ?? room.players).map((p) => ({ username: p.username, color: p.color }));
    const fee = room.entryFeePerPlayer;
    const potId = room.potId || room.id;
    const delays = [0, 1000, 4000];
    void (async () => {
      for (let attempt = 0; attempt < delays.length; attempt++) {
        if (delays[attempt]) await new Promise((r) => setTimeout(r, delays[attempt]));
        try {
          const settings = await deps.getCoinSettings();
          await settleMatchPot(players, fee, result, potId, settings.matchRakePercent);
          if ((room.potGeneration ?? 0) === generation) {
            room.potSettled = true;
            room.potSettling = false;
            checkpoint();
          }
          console.log(`[Coins] Pot ${potId} settled (${label}) on attempt ${attempt + 1}.`);
          return;
        } catch (err) {
          console.error(`[Coins] Settlement attempt ${attempt + 1} failed for pot ${potId} (${label}):`, err);
        }
      }
      if ((room.potGeneration ?? 0) === generation) room.potSettling = false;
      console.error(`[Coins] GAVE UP settling pot ${potId} (${label}) after ${delays.length} attempts -- needs manual review.`);
    })();
  }

  /**
   * THE single funnel every finished game goes through -- rule-based
   * endings, resignations, agreed draws, flags, disconnect and fair-play
   * forfeits. Records the game (fire-and-forget), then either settles the
   * single-game pot or does the series bookkeeping.
   */
  function recordGameResultAndSettle(
    room: Room,
    result: { isDraw: boolean; winnerColor: Color | null },
    opts?: { forfeitWholeSeries?: boolean; reason?: string; skipRecord?: boolean; abandonSeries?: boolean },
  ): void {
    const whitePlayer = room.players.find((p) => p.color === "W")?.username || "White";
    const blackPlayer = room.players.find((p) => p.color === "B")?.username || "Black";
    let winner: string | null = null;
    let loser: string | null = null;
    let finalResult: "1–0" | "0–1" | "½–½" = "½–½";
    if (!result.isDraw && result.winnerColor) {
      if (result.winnerColor === "W") { winner = whitePlayer; loser = blackPlayer; finalResult = "1–0"; }
      else { winner = blackPlayer; loser = whitePlayer; finalResult = "0–1"; }
    }

    if (!opts?.skipRecord) {
      const gameCode = room.gameCode;
      const moves = room.gameState?.moveHistory || [];
      recordGameEnd({
        gameCode: room.gameCode,
        private: room.private,
        participantUserIds: room.players.flatMap((p) => {
          const id = p.userId;
          return id ? [id] : [];
        }),
        completeMoveHistory: moves,
        currentPosition: room.gameState?.board,
        currentTurn: room.gameState?.turn,
        startingPosition: room.startBoard,
        startingTurn: room.startTurn,
        finalResult,
        resultReason: opts?.reason || (result.isDraw ? "Draw" : "Win"),
        winnerColor: result.winnerColor,
        winnerUsername: winner,
        loserUsername: loser,
        isDraw: result.isDraw,
        playMode: "Multiplayer",
        whitePlayer,
        blackPlayer,
        seriesId: room.seriesId,
        seriesGameNumber: room.seriesGameNumber,
      }).then(() => notifyMatchEnded(gameCode, whitePlayer, blackPlayer, winner))
        .catch((err) => console.error("[GameRecord/Notifications] Failed to save game result or send alert:", err));
    }

    if (deps.onGameCompleted) void Promise.resolve().then(() => deps.onGameCompleted!({ gameCode: room.gameCode, white: whitePlayer, black: blackPlayer, winner: result.winnerColor, draw: result.isDraw, roomId: room.id, tournamentId: room.tournamentId })).catch(error => console.error('[Tournament] Result synchronization pending', error));

    // ---- Classic single game ----
    if (!room.bestOf || room.bestOf <= 1) {
      settleWithRetry(room, result, result.isDraw ? "draw/refund" : "win");
      return;
    }

    // ---- Series bookkeeping ----
    if (room.seriesOver) return;
    for (const p of room.players) {
      if (!Object.prototype.hasOwnProperty.call(room.seriesScore, p.username)) room.seriesScore[p.username] = 0;
    }
    const winnerPlayer = !result.isDraw && result.winnerColor
      ? room.players.find((p) => p.color === result.winnerColor) ?? null
      : null;
    if (winnerPlayer) room.seriesScore[winnerPlayer.username] = (room.seriesScore[winnerPlayer.username] || 0) + 1;
    else room.seriesDraws += 1;

    if (opts?.abandonSeries) {
      room.seriesOver = true;
      if (room.seriesNextGameTimer) { clearTimeout(room.seriesNextGameTimer); room.seriesNextGameTimer = null; }
      broadcastSeriesUpdate(room, { seriesWinner: null, statusMessage: "Match abandoned — entry fees are refunded." });
      settleWithRetry(room, { isDraw: true, winnerColor: null }, "series abandoned/refund");
      return;
    }

    const needed = seriesWinsNeeded(room.bestOf);
    const gamesPlayed = Object.values(room.seriesScore).reduce((a, b) => a + b, 0) + room.seriesDraws;
    const entries = room.players.map((p) => ({ username: p.username, color: p.color, wins: room.seriesScore[p.username] || 0 }));
    entries.sort((a, b) => b.wins - a.wins);
    const leader = entries[0];
    const runnerUp = entries[1];

    let seriesWinner: { username: string; color: Color } | null = null;
    let seriesDrawn = false;
    if (opts?.forfeitWholeSeries && winnerPlayer) {
      seriesWinner = { username: winnerPlayer.username, color: winnerPlayer.color };
    } else if (leader && leader.wins >= needed) {
      seriesWinner = { username: leader.username, color: leader.color };
    } else if (gamesPlayed >= room.bestOf) {
      if (leader && runnerUp && leader.wins > runnerUp.wins) seriesWinner = { username: leader.username, color: leader.color };
      else seriesDrawn = true;
    }

    if (seriesWinner || seriesDrawn) {
      room.seriesOver = true;
      if (room.seriesNextGameTimer) { clearTimeout(room.seriesNextGameTimer); room.seriesNextGameTimer = null; }
      broadcastSeriesUpdate(room, {
        seriesWinner: seriesWinner?.username ?? null,
        statusMessage: seriesWinner
          ? `🏆 ${seriesWinner.username} wins the series ${room.seriesScore[seriesWinner.username]}–${runnerUp ? room.seriesScore[runnerUp.username] ?? 0 : 0}!`
          : "Series drawn — the pot is split.",
      });
      settleWithRetry(
        room,
        seriesWinner ? { isDraw: false, winnerColor: seriesWinner.color } : { isDraw: true, winnerColor: null },
        seriesWinner ? "series win" : "series draw/refund",
      );
      return;
    }

    // Series continues: pause, then roll straight into the next game.
    broadcastSeriesUpdate(room, { nextGameInMs: NEXT_GAME_DELAY_MS });
    scheduleNextSeriesGame(room, NEXT_GAME_DELAY_MS);
  }

  /** A player walked out BETWEEN series games: the stayer takes the series. */
  function abandonSeries(room: Room, leaver: Seat, stayer: Seat): void {
    if (room.seriesOver) return;
    if (room.seriesNextGameTimer) { clearTimeout(room.seriesNextGameTimer); room.seriesNextGameTimer = null; }
    sendToRoom(room, {
      type: "game-ended",
      reason: "abandoned",
      winnerColor: stayer.color,
      statusMessage: `Series over! ${stayer.username} wins — ${leaver.username} left the match. 🏳️`,
      clock: clockOf(room),
      phase: room.phase,
      gameCode: room.gameCode,
    });
    recordGameResultAndSettle(room, { isDraw: false, winnerColor: stayer.color }, { forfeitWholeSeries: true, skipRecord: true, reason: "Abandoned" });
  }

  // ------------------------------------------------------------------
  // Leaving / abandoning / disconnect grace (§7)
  // ------------------------------------------------------------------
  function clearSeatTimers(seat: Seat): void {
    if (seat.forfeitTimer) { clearTimeout(seat.forfeitTimer); seat.forfeitTimer = null; }
    if (seat.awayForfeitTimer) { clearTimeout(seat.awayForfeitTimer); seat.awayForfeitTimer = null; }
    seat.awaySince = null;
  }

  function removeSeat(room: Room, seat: Seat): void {
    clearSeatTimers(seat);
    room.players = room.players.filter((p) => p !== seat);
    if (room.pendingRematch) {
      room.pendingRematch = null;
      sendToRoom(room, { type: "rematch-cancelled", from: seat.username, fromUsername: seat.username });
    }
    if (room.pendingEndOffer && room.pendingEndOffer.fromUsername === seat.username) room.pendingEndOffer = null;
  }

  function deleteRoom(room: Room): void {
    if (rooms.get(room.id) !== room) return;
    clearFlagTimer(room);
    if (room.seriesNextGameTimer) { clearTimeout(room.seriesNextGameTimer); room.seriesNextGameTimer = null; }
    if (room.deletionTimer) { clearTimeout(room.deletionTimer); room.deletionTimer = null; }
    for (const p of room.players) clearSeatTimers(p);
    for (const op of onlinePlayers.values()) {
      if (op.roomId === room.id) op.roomId = null;
    }
    rooms.delete(room.id);
    broadcastOpenRooms();
    console.log(`[WS] Room ${room.id} deleted.`);
  }

  function armDeletionTimer(room: Room): void {
    if (room.deletionTimer) return;
    room.deletionTimer = setTimeout(() => {
      room.deletionTimer = null;
      safeTimer(`delete-room ${room.id}`, () => {
        if (rooms.get(room.id) !== room) return;
        if (room.players.some((p) => isLive(p.ws)) || room.spectators.some((s) => isLive(s.ws))) return;
        if (isLivePhase(room)) return; // grace timers own this case
        deleteRoom(room);
      });
    }, ROOM_EMPTY_DELETE_MS);
  }

  function clearDeletionTimer(room: Room): void {
    if (room.deletionTimer) {
      clearTimeout(room.deletionTimer);
      room.deletionTimer = null;
    }
  }

  /** How long a disconnected player has to come back (§7). */
  function graceFor(room: Room, seat: Seat): number {
    if (!isLivePhase(room) || !room.clock.timed) return DISCONNECT_GRACE_UNTIMED_MS;
    return Math.max(DISCONNECT_GRACE_MIN_MS, clockRemainingMs(room.clock, seat.color, now()));
  }

  function onGraceExpired(room: Room, seat: Seat): void {
    seat.forfeitTimer = null;
    if (rooms.get(room.id) !== room) return;
    if (isLive(seat.ws)) return; // came back (timer should already be cleared)
    const opp = opponentOf(room, seat);

    if (isLivePhase(room)) {
      if (opp && isLive(opp.ws)) {
        endLiveGame(
          room,
          { isDraw: false, winnerColor: opp.color },
          "disconnected",
          `Game Over! ${colorName(opp.color)} wins (opponent disconnected). 🏳️`,
          { forfeitWholeSeries: true, recordReason: "Disconnected" },
        );
        return;
      }
      seat.graceExpired = true;
      if (!opp || opp.graceExpired) {
        // Both gone: nobody can honestly be declared the winner.
        endLiveGame(
          room,
          { isDraw: true, winnerColor: null },
          "abandoned",
          "Game abandoned — both players disconnected. Entry fees are refunded. 🤝",
          { recordReason: "Abandoned (both players disconnected)", abandonSeries: true },
        );
        armDeletionTimer(room);
      }
      return;
    }

    if (isSeriesUnderway(room)) {
      if (opp && isLive(opp.ws)) {
        abandonSeries(room, seat, opp);
        removeSeat(room, seat);
        sendRoomInfo(room);
        return;
      }
      seat.graceExpired = true;
      if (!opp || opp.graceExpired) {
        room.seriesOver = true;
        if (room.seriesNextGameTimer) { clearTimeout(room.seriesNextGameTimer); room.seriesNextGameTimer = null; }
        settleWithRetry(room, { isDraw: true, winnerColor: null }, "series abandoned by both/refund");
        armDeletionTimer(room);
      }
      return;
    }

    // Lobby / finished room: just drop the ghost seat.
    removeSeat(room, seat);
    if (room.players.length === 0 && !room.spectators.some((s) => isLive(s.ws))) deleteRoom(room);
    else sendRoomInfo(room);
    broadcastOpenRooms();
  }

  /**
   * The one exit path for a seat/spectator (§7):
   *   "close"  -> socket died: grace period (game keeps the seat)
   *   "leave"  -> explicit leave-room: immediate forfeit of the whole series
   *   "switch" -> creating/joining/spectating elsewhere: same as leave
   */
  function abandonRoom(player: OnlinePlayer, reason: "close" | "leave" | "switch"): void {
    const roomId = player.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) {
      player.roomId = null;
      return;
    }
    const ws = player.ws;

    // Spectators never touch the game.
    const specIdx = room.spectators.findIndex((s) => s.ws === ws || s.key === player.key);
    if (specIdx >= 0) {
      if (reason === "close") {
        room.spectators[specIdx].ws = null;
        room.spectators[specIdx].disconnectedAt = now();
      } else {
        room.spectators.splice(specIdx, 1);
      }
      player.roomId = null;
      pruneSpectators(room);
      sendRoomInfo(room);
      if (room.players.every((p) => !isLive(p.ws)) && !room.spectators.some((s) => isLive(s.ws)) && !isLivePhase(room)) armDeletionTimer(room);
      return;
    }

    const seat = seatOf(room, ws);
    if (!seat) {
      player.roomId = null;
      return;
    }
    // Resolve a flag before disconnect/leave handling can pause and erase it.
    if (room.phase === "playing" && room.clock.running && clockRemainingMs(room.clock, room.clock.running, now()) <= 0) onFlag(room);
    const live = isLivePhase(room);

    if (reason === "close") {
      seat.ws = null;
      seat.disconnectedAt = now();
      seat.graceExpired = false;
      if (seat.awayForfeitTimer) { clearTimeout(seat.awayForfeitTimer); seat.awayForfeitTimer = null; }
      seat.awaySince = null;
      if (seat.forfeitTimer) clearTimeout(seat.forfeitTimer);
      seat.forfeitTimer = null;

      if (live) {
        syncClock(room); // pauses
        const graceMs = graceFor(room, seat);
        sendToRoom(room, {
          type: "opponent-disconnected",
          username: seat.username,
          message: `${seat.username} has disconnected. They have ${room.clock.timed ? "until their time runs out" : "10 minutes"} to reconnect.`,
          graceMs,
          clock: clockOf(room),
          phase: room.phase,
        });
        seat.forfeitTimer = setTimeout(() => safeTimer(`grace ${room.id}/${seat.username}`, () => onGraceExpired(room, seat)), graceMs);
      } else if (isSeriesUnderway(room)) {
        sendToRoom(room, {
          type: "opponent-disconnected",
          username: seat.username,
          message: `${seat.username} has disconnected between games. They have 10 minutes to return or the match is forfeited.`,
          graceMs: DISCONNECT_GRACE_UNTIMED_MS,
          clock: clockOf(room),
          phase: room.phase,
        });
        seat.forfeitTimer = setTimeout(() => safeTimer(`grace ${room.id}/${seat.username}`, () => onGraceExpired(room, seat)), DISCONNECT_GRACE_UNTIMED_MS);
      } else if (room.phase === "lobby" && room.players.length > 1) {
        // A lobby with two seats never lasts long (accept starts the game),
        // but if it happens, the leaver simply loses the seat.
        removeSeat(room, seat);
        for (const p of room.players) p.ready = false;
        sendRoomInfo(room);
        sendToRoom(room, { type: "opponent-disconnected", username: seat.username, message: `${seat.username} has left the room.` });
      } else {
        // Host waiting alone (hidden from the open list while offline) or
        // a finished game: keep the seat so a token reconnect can restore it.
        sendToRoom(room, {
          type: "opponent-disconnected",
          username: seat.username,
          message: `${seat.username} has disconnected.`,
          clock: clockOf(room),
          phase: room.phase,
        });
      }
      if (room.players.every((p) => !isLive(p.ws)) && !live) armDeletionTimer(room);
      broadcastOpenRooms();
      return;
    }

    // ---- explicit leave / switching rooms ----
    player.roomId = null;
    if (live) {
      const opp = opponentOf(room, seat);
      if (opp) {
        endLiveGame(
          room,
          { isDraw: false, winnerColor: opp.color },
          "abandoned",
          `Game Over! ${colorName(opp.color)} wins (${seat.username} left the match). 🏳️`,
          { forfeitWholeSeries: true, recordReason: "Abandoned" },
        );
      }
    } else if (isSeriesUnderway(room)) {
      const opp = opponentOf(room, seat);
      if (opp) abandonSeries(room, seat, opp);
    }

    removeSeat(room, seat);
    if (room.players.length === 0) {
      deleteRoom(room);
    } else {
      for (const p of room.players) p.ready = false;
      sendRoomInfo(room);
      sendToRoom(room, { type: "opponent-disconnected", username: seat.username, message: `${seat.username} has left the room.` });
      if (room.players.every((p) => !isLive(p.ws))) armDeletionTimer(room);
    }
    broadcastOpenRooms();
  }

  /** Does this user hold a seat that must survive session expiry? */
  function holdsLiveSeat(key: string): boolean {
    for (const room of rooms.values()) {
      if (!seatByKey(room, key)) continue;
      if (isLivePhase(room) || isSeriesUnderway(room)) return true;
    }
    return false;
  }

  /** Drops ghost seats of `key` from rooms that are NOT mid-match. */
  function cleanupGhostSeats(key: string, except?: Room): void {
    for (const room of Array.from(rooms.values())) {
      if (room === except) continue;
      const seat = seatByKey(room, key);
      if (seat && !isLive(seat.ws) && !isLivePhase(room) && !isSeriesUnderway(room)) {
        removeSeat(room, seat);
        if (room.players.length === 0 && !room.spectators.some((s) => isLive(s.ws))) deleteRoom(room);
        else sendRoomInfo(room);
      }
      const before = room.spectators.length;
      room.spectators = room.spectators.filter((s) => !(s.key === key));
      if (room.spectators.length !== before && rooms.get(room.id) === room) sendRoomInfo(room);
    }
    broadcastOpenRooms();
  }

  /** The seat a reconnecting user should get back (real players only, not casual spectators). */
  function findSeatFor(key: string, currentWs?: WS): { room: Room; seat: Seat | null; spectator: Spectator | null } | null {
    let best: { room: Room; seat: Seat | null; spectator: Spectator | null; rank: number } | null = null;
    for (const room of rooms.values()) {
      const seat = seatByKey(room, key);
      if (seat && (!seat.ws || seat.ws !== currentWs || !isLive(seat.ws))) {
        const rank = isLivePhase(room) ? 3 : isSeriesUnderway(room) ? 2 : (room.creator === seat.username ? 1.5 : 1);
        if (!best || rank > best.rank) best = { room, seat, spectator: null, rank };
        continue;
      }
      const spectator = room.spectators.find((s) => s.key === key &&
        (s.ws !== currentWs || !isLive(s.ws)) &&
        (isLive(s.ws) || (s.disconnectedAt !== null && now() - s.disconnectedAt < SPECTATOR_GRACE_MS)));
      if (spectator && !room.private && isLivePhase(room) && (!best || best.rank < 0)) {
        best = { room, seat: null, spectator, rank: 0 };
      }
    }
    return best ? { room: best.room, seat: best.seat, spectator: best.spectator } : null;
  }

  /** A seat of `key` is in disconnect grace (live game or series pause). */
  function seatInGrace(key: string): boolean {
    for (const room of rooms.values()) {
      const seat = seatByKey(room, key);
      if (seat && !isLive(seat.ws) && (isLivePhase(room) || isSeriesUnderway(room))) return true;
    }
    return false;
  }

  function attachToSeat(room: Room, seat: Seat, player: OnlinePlayer): void {
    const ws = player.ws;
    if (room.awaitingFirstJoin) {
      room.awaitingFirstJoin = false;
      for (const other of room.players) if (other !== seat && !isLive(other.ws)) {
        other.disconnectedAt = now();
        other.forfeitTimer = setTimeout(() => safeTimer('tournament join deadline', () => onGraceExpired(room, other)), 120_000);
      }
    }
    seat.ws = ws;
    seat.disconnectedAt = null;
    seat.graceExpired = false;
    if (seat.forfeitTimer) { clearTimeout(seat.forfeitTimer); seat.forfeitTimer = null; }
    clearDeletionTimer(room);
    player.roomId = room.id;
    syncClock(room);

    sendDirect(room, ws, { ...roomInfoPayload(room), type: "room-rejoined", ...rejoinExtras(room, seat) });
    sendToRoom(room, {
      type: "opponent-reconnected",
      username: seat.username,
      message: `${seat.username} has reconnected.`,
      clock: clockOf(room),
      phase: room.phase,
    }, ws);
    flushSignalBuffer(player.key);
    console.log(`[WS] Player reconnected: ${seat.username} -> room ${room.id} (${room.phase})`);

    const opp = opponentOf(room, seat);
    if (opp && opp.graceExpired && !isLive(opp.ws)) {
      // We are back, they never came back: their grace already ran out.
      onGraceExpired(room, opp);
      return;
    }
    if (room.phase === "ended" && isSeriesUnderway(room) && !room.seriesNextGameTimer && room.players.every((p) => isLive(p.ws))) {
      scheduleNextSeriesGame(room, 3000);
    }
  }

  function attachSpectator(room: Room, sp: Spectator, player: OnlinePlayer): void {
    sp.ws = player.ws;
    sp.disconnectedAt = null;
    player.roomId = room.id;
    clearDeletionTimer(room);
    sendDirect(room, player.ws, {
      type: "spectate-joined",
      roomId: room.id,
      private: room.private,
      players: playersPayload(room),
      gameState: room.gameState,
      gameTime: room.gameTime,
      specialRule: room.specialRule,
      clockLimitType: room.clockLimitType,
      bestOf: room.bestOf,
      seriesGameNumber: room.seriesGameNumber,
      seriesScore: room.seriesScore,
      seriesDraws: room.seriesDraws,
      spectatorCount: liveSpectatorCount(room),
      ...rejoinExtras(room, null),
    });
    sendRoomInfo(room);
  }

  /** Session takeover (§1): the old socket is told and closed; its seat is handed over. */
  function replaceSocket(oldWs: WS): void {
    const old = onlinePlayers.get(oldWs);
    oldWs.__replaced = true;
    sendJson(oldWs, { type: "session-replaced" });
    onlinePlayers.delete(oldWs);
    if (old?.roomId) {
      const room = rooms.get(old.roomId);
      if (room) {
        const seat = seatOf(room, oldWs);
        if (seat) seat.ws = null;
        const sp = room.spectators.find((s) => s.ws === oldWs);
        if (sp) { sp.ws = null; sp.disconnectedAt = now(); }
      }
    }
    try { oldWs.close(4000, "session-replaced"); } catch {}
  }

  // ------------------------------------------------------------------
  // Calls (§10)
  // ------------------------------------------------------------------
  function playerByKey(key: string): OnlinePlayer | null {
    const s = sessions.get(key);
    if (!s || !isLive(s.ws)) return null;
    return onlinePlayers.get(s.ws) ?? null;
  }

  function isSpectatorPlayer(p: OnlinePlayer): boolean {
    if (!p.roomId) return false;
    const room = rooms.get(p.roomId);
    return !!room && isSpectatorWs(room, p.ws);
  }

  function seatedRoomOf(p: OnlinePlayer): Room | null {
    if (!p.roomId) return null;
    const room = rooms.get(p.roomId);
    return room && seatOf(room, p.ws) ? room : null;
  }

  function callKindOf(type: string): "call" | "voice" {
    return type.startsWith("voice-") ? "voice" : "call";
  }

  function clearCall(key: string): void {
    const c = activeCalls.get(key);
    if (!c) return;
    if (c.timer) clearTimeout(c.timer);
    activeCalls.delete(key);
    const peer = activeCalls.get(c.peer);
    if (peer && peer.peer === key) {
      if (peer.timer) clearTimeout(peer.timer);
      activeCalls.delete(c.peer);
    }
  }

  /** Delivers to a live socket, or buffers for a seat in disconnect grace (15 s). */
  function relayToKey(targetKey: string, msg: any): boolean {
    const target = playerByKey(targetKey);
    if (target) {
      sendJson(target.ws, msg);
      return true;
    }
    if (!seatInGrace(targetKey)) return false;
    let buf = signalBuffers.get(targetKey);
    if (!buf) {
      const timer = setTimeout(() => safeTimer("signal-buffer", () => signalBuffers.delete(targetKey)), SIGNALLING_BUFFER_MS);
      buf = { items: [], timer };
      signalBuffers.set(targetKey, buf);
    }
    buf.items.push(msg);
    if (buf.items.length > 200) buf.items.shift();
    return true;
  }

  function flushSignalBuffer(key: string): void {
    const buf = signalBuffers.get(key);
    if (!buf) return;
    clearTimeout(buf.timer);
    signalBuffers.delete(key);
    const target = playerByKey(key);
    if (!target) return;
    for (const m of buf.items) sendJson(target.ws, m);
  }

  function onCallPartyDisconnected(key: string): void {
    if (!activeCalls.has(key)) return;
    const existing = callDisconnectTimers.get(key);
    if (existing) clearTimeout(existing);
    callDisconnectTimers.set(key, setTimeout(() => safeTimer("call-peer-disconnect", () => {
      callDisconnectTimers.delete(key);
      if (playerByKey(key)) return; // re-attached in time
      const c = activeCalls.get(key);
      if (!c) return;
      const me = sessions.get(key)?.username ?? key;
      relayToKey(c.peer, { type: c.kind === "voice" ? "voice-leave" : "call-end", from: me, reason: "peer-disconnected" });
      if (c.kind === "voice") relayToKey(c.peer, { type: "call-end", from: me, reason: "peer-disconnected" });
      clearCall(key);
    }), CALL_PEER_DISCONNECT_GRACE_MS));
  }

  function handleCallMessage(ws: WS, player: OnlinePlayer, data: any): void {
    const type: string = data.type;
    const kind = callKindOf(type);
    const isRequest = type === "call-request" || type === "voice-call-request";
    const isAccept = type === "call-accept" || type === "voice-call-accept";
    const isTerminal = ["call-decline", "voice-call-decline", "call-cancel", "voice-call-cancel", "call-end", "voice-leave"].includes(type);

    if (isSpectatorPlayer(player)) {
      sendError(ws, "busy", "Spectators can't take part in calls.");
      return;
    }

    // Resolve the target: explicit `to`, or the room opponent.
    let targetKey: string | null = null;
    const toRaw = typeof data.to === "string" ? data.to.trim() : "";
    if (toRaw && toRaw.toLowerCase() !== "opponent") {
      targetKey = keyOf(toRaw);
    } else {
      const room = seatedRoomOf(player);
      const mySeat = room ? seatOf(room, ws) : undefined;
      const opp = room && mySeat ? opponentOf(room, mySeat) : undefined;
      if (opp) targetKey = opp.key;
    }
    if (!targetKey || targetKey === player.key) {
      if (isRequest) sendJson(ws, { type: "call-unavailable", message: `${toRaw || "Opponent"} is currently offline or unavailable for calls.` });
      return;
    }
    const existing = activeCalls.get(player.key);

    if (isRequest) {
      // Busy check first (§10): either party already on/awaiting a call.
      if (activeCalls.has(player.key) || activeCalls.has(targetKey)) {
        const toName = sessions.get(targetKey)?.username ?? toRaw ?? targetKey;
        sendJson(ws, { type: kind === "voice" ? "voice-call-busy" : "call-busy", from: toName, to: toName });
        return;
      }
      const target = playerByKey(targetKey);
      if (!target || isSpectatorPlayer(target)) {
        sendJson(ws, { type: "call-unavailable", message: `${toRaw || "Opponent"} is currently offline or unavailable for calls.` });
        return;
      }
      const myRoom = seatedRoomOf(player);
      const theirRoom = seatedRoomOf(target);
      const samePlayers = !!myRoom && myRoom === theirRoom;
      const bothLoungers = !player.roomId && !target.roomId;
      if (!samePlayers && !bothLoungers) {
        sendJson(ws, { type: "call-unavailable", message: `${target.username} is busy in another room.` });
        return;
      }
      const timer = setTimeout(() => safeTimer("call-timeout", () => {
        const c = activeCalls.get(player.key);
        if (!c || !c.pending || c.peer !== targetKey) return;
        relayToKey(targetKey!, { type: kind === "voice" ? "voice-call-cancel" : "call-cancel", from: player.username, reason: "timeout" });
        relayToKey(player.key, { type: "call-unavailable", message: `${target.username} didn't answer.`, reason: "timeout" });
        clearCall(player.key);
      }), CALL_REQUEST_TIMEOUT_MS);
      const t = now();
      activeCalls.set(player.key, { peer: targetKey, kind, pending: true, startedAt: t, timer });
      activeCalls.set(targetKey, { peer: player.key, kind, pending: true, startedAt: t, timer: null });
      sendJson(target.ws, { ...data, from: player.username });
      return;
    }

    // Everything else only flows between the two parties of the call.
    if (!existing || existing.peer !== targetKey) {
      if (isTerminal) return; // stale hangup for a call that is already gone
      sendError(ws, "busy", "No active call with that user.");
      return;
    }

    if (isAccept) {
      existing.pending = false;
      if (existing.timer) { clearTimeout(existing.timer); existing.timer = null; }
      const peer = activeCalls.get(targetKey);
      if (peer) { peer.pending = false; if (peer.timer) { clearTimeout(peer.timer); peer.timer = null; } }
      relayToKey(targetKey, { ...data, from: player.username });
      return;
    }

    if (isTerminal) {
      const reason = typeof data.reason === "string" ? data.reason : "hangup";
      relayToKey(targetKey, { ...data, from: player.username, reason });
      clearCall(player.key);
      return;
    }

    relayToKey(targetKey, { ...data, from: player.username });
  }

  // ------------------------------------------------------------------
  // Handler helpers
  // ------------------------------------------------------------------
  function requirePlayer(ws: WS): OnlinePlayer | null {
    const p = onlinePlayers.get(ws);
    if (!p) sendError(ws, "not-logged-in", "Please log in first.");
    return p ?? null;
  }

  function requireRoom(ws: WS, player: OnlinePlayer): Room | null {
    const room = player.roomId ? rooms.get(player.roomId) : undefined;
    if (!room) {
      player.roomId = null;
      sendError(ws, "not-in-room", "You are not in a room.");
      return null;
    }
    return room;
  }

  function requireSeat(ws: WS, room: Room): Seat | null {
    const seat = seatOf(room, ws);
    if (!seat) sendError(ws, "not-in-room", "Only the two players can do that.");
    return seat ?? null;
  }

  function requirePhase(ws: WS, room: Room, phases: RoomPhase[], action: string): boolean {
    // A queued dialog/rematch message cannot beat a flag whose timer has not
    // run yet. Settle expiration before any handler is allowed to pause time.
    if (room.phase === "playing" && room.clock.running && clockRemainingMs(room.clock, room.clock.running, now()) <= 0) onFlag(room);
    if (phases.includes(room.phase)) return true;
    if (isLivePhase(room) && !phases.includes("playing") && !phases.includes("setup")) {
      sendError(ws, "game-in-progress", `A game is in progress — you can't ${action} now. Resign or finish the game first.`, { phase: room.phase });
    } else {
      sendError(ws, "wrong-phase", `You can't ${action} while the room is in the "${room.phase}" phase.`, { phase: room.phase });
    }
    return false;
  }

  function resetRoomForRematch(room: Room): void {
    // Ghost seats don't play rematches.
    for (const p of Array.from(room.players)) {
      if (!isLive(p.ws)) removeSeat(room, p);
    }
    for (const p of room.players) {
      p.color = otherColor(p.color);
      p.ready = false;
      resetSeatForGame(p);
      p.ready = false;
    }
    if (room.seriesNextGameTimer) { clearTimeout(room.seriesNextGameTimer); room.seriesNextGameTimer = null; }
    clearFlagTimer(room);
    room.phase = "lobby";
    room.started = false;
    room.gameState = null;
    room.setupPhase = null;
    room.clock = untimedClock();
    room.pendingEndOffer = null;
    room.pendingRematch = null;
    room.potGeneration = (room.potGeneration ?? 0) + 1;
    room.feesCharged = false;
    room.entryFeePerPlayer = undefined;
    room.potSettled = false;
    room.potSettling = false;
    room.seriesGameNumber = 1;
    room.seriesScore = Object.create(null);
    for (const p of room.players) room.seriesScore[p.username] = 0;
    room.seriesDraws = 0;
    room.seriesOver = false;
    room.resultRecorded = false;
    room.seriesId = ""; // a rematch is a fresh series; startRoomMatch mints the id
  }

  // ------------------------------------------------------------------
  // Connection handling
  // ------------------------------------------------------------------
  wss.on("connection", (ws: WS) => {
    console.log("[WS] New client connected");
    try {
      (ws as any)._socket?.setNoDelay(true);
      (ws as any)._socket?.setKeepAlive(true, 10000);
    } catch {}
    ws.isAlive = true;
    (ws as any).missedPings = 0;
    ws.on("pong", () => {
      ws.isAlive = true;
      (ws as any).missedPings = 0;
    });

    let msgCount = 0;
    let windowReset = now() + FLOOD_WINDOW_MS;
    let floodWarned = false;
    let chatCount = 0;
    let chatReset = now() + FLOOD_WINDOW_MS;

    ws.on("error", (err: any) => {
      console.warn("[WS] socket error:", err?.message || err);
    });

    ws.on("close", () => {
      try {
        handleClose(ws);
      } catch (err) {
        console.error("[WS] close handler failed:", err);
      }
    });

    ws.on("message", (raw: any) => {
      ws.isAlive = true;
      (ws as any).missedPings = 0;
      return handleMessage(ws, raw).then(() => checkpoint()).catch((err) => {
        console.error("[WS] Error processing msg:", err);
      });
    });

    function handleClose(ws: WS): void {
      if (shuttingDown || ws.__replaced) return; // shutdown/takeover owns cleanup
      const player = onlinePlayers.get(ws);
      if (!player) return;
      console.log(`[WS] Player disconnected: ${player.username}`);
      onlinePlayers.delete(ws);
      abandonRoom(player, "close");
      const session = sessions.get(player.key);
      if (session && session.ws === ws) sessions.detach(session);
      onCallPartyDisconnected(player.key);
      broadcastOnlineUsers();
      checkpoint();
    }

    async function handleMessage(ws: WS, raw: any): Promise<void> {
      if (shuttingDown || !isLive(ws) || storageFailed) { if (storageFailed) ws.close(1011, "room storage unavailable"); return; }
      // Flood protection: max 75 messages per 3 s window per socket.
      const t = now();
      if (t > windowReset) {
        msgCount = 0;
        windowReset = t + FLOOD_WINDOW_MS;
        floodWarned = false;
      }
      msgCount++;
      if (msgCount > FLOOD_MAX_MESSAGES) {
        if (!floodWarned) {
          floodWarned = true;
          sendError(ws, "rate-limited", "You're sending messages too fast. Please slow down.");
        }
        return;
      }

      let text: string;
      if (typeof raw === "string") text = raw;
      else if (Buffer.isBuffer(raw)) text = raw.toString("utf8");
      else if (Array.isArray(raw)) text = Buffer.concat(raw).toString("utf8");
      else text = Buffer.from(raw).toString("utf8");

      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        sendError(ws, "invalid-payload", "Message is not valid JSON.");
        return;
      }
      const problem = validateMessage(data);
      if (problem) {
        sendError(ws, "invalid-payload", problem, typeof data?.type === "string" ? { type: data.type } : undefined);
        return;
      }

      switch (data.type) {
        // ----------------------------------------------------------
        case "ping": {
          sendJson(ws, { type: "pong", t: typeof data.t === "number" ? data.t : null, serverNow: now() });
          break;
        }

        // ----------------------------------------------------------
        case "login": {
          if (!isValidUsername(data.username)) {
            sendError(ws, "invalid-payload", "Invalid username. Please enter a valid name.");
            return;
          }
          let cleanedName = sanitizeInputString(data.username, 32);
          if (!cleanedName) {
            sendError(ws, "invalid-payload", "Invalid username. Please enter a valid name.");
            return;
          }
          const key = keyOf(cleanedName);
          const presentedToken: string | null = typeof data.sessionToken === "string" ? data.sessionToken : null;

          let userId: string | null = null;
          const verificationRevision = authRevision;
          if (supabaseConfigured() && typeof data.accessToken === "string" && data.accessToken) {
            try {
              const db = getSupabaseAdmin();
              const { data: verified, error } = await db.auth.getUser(data.accessToken);
              if (!error && verified?.user) {
                // Auth user_metadata is self-editable. Only the canonical,
                // owner-protected profile can bind a wallet/room username.
                const { data: profile, error: profileError } = await db.from("profiles")
                  .select("username, usernameLower, ownerId, banned, suspendedUntil")
                  .eq("ownerId", verified.user.id).maybeSingle();
                if (!profileError && profile?.ownerId === verified.user.id &&
                    keyOf(String(profile.usernameLower || "")) === key &&
                    keyOf(String(profile.username || "").trim()) === key && key !== "kentro_house" &&
                    (authRevocations.get(verified.user.id) ?? 0) <= verificationRevision &&
                    profile.banned !== true && !(Number(profile.suspendedUntil) > now())) {
                  userId = verified.user.id;
                  cleanedName = sanitizeInputString(profile.username || cleanedName, 32);
                }
              }
            } catch { userId = null; }
          }
          if (!isLive(ws)) return; // closed while we were verifying
          // Guests use distinct reserved names. Production and partially configured
          // environments require verified accounts even when auth is unavailable.
          if (accountAuthRequired()) {
            if (isOnlineGuest(cleanedName) ? !!userId : !userId) {
              sendError(ws, "not-logged-in", supabaseConfigured()
                ? "Sign in to use your account, or choose Continue as Guest."
                : "Account sign-in is unavailable. Choose Continue as Guest.");
              return;
            }
          }

          const already = onlinePlayers.get(ws);
          if (already) {
            if (already.key === key) {
              sendJson(ws, { type: "login-success", username: already.username, sessionToken: already.token, serverNow: now(), onlineUsers: onlineUsernames() });
            } else {
              sendError(ws, "invalid-payload", `This connection is already logged in as ${already.username}.`);
            }
            return;
          }

          const existing = sessions.get(key);
          // A session is resumed by its token, or -- when Supabase auth is
          // configured -- by a verified user id that matches the one the
          // session was bound to. The second path is what lets a player who
          // lost the token (new phone, cleared storage) get their seat back
          // instead of being locked out for the rest of the game.
          const ownsTournamentSeat = [...rooms.values()].some(room => room.tournamentId && room.players.some(seat => seat.key === key && (userId ? seat.userId === userId : !accountAuthRequired())));
          const tokenMatches = ownsTournamentSeat || !!existing && (
            (!!presentedToken && presentedToken === existing.token) ||
            (!!userId && !!existing.userId && userId === existing.userId)
          );
          const liveElsewhere = !!existing && isLive(existing.ws) && onlinePlayers.has(existing.ws);
          if ((liveElsewhere || seatInGrace(key)) && !tokenMatches) {
            sendError(
              ws,
              "name-taken",
              liveElsewhere
                ? `"${cleanedName}" is already online in another tab or device. Continue from there, or sign in there and back here to take over.`
                : `"${cleanedName}" still has a game in progress from another tab or device. Reopen the app there to continue, or wait for that game to end.`,
            );
            return;
          }

          let session: Session;
          if (existing && tokenMatches) {
            cleanedName = existing.username;
            if (liveElsewhere) replaceSocket(existing.ws);
            session = existing;
            session.userId = userId ?? session.userId;
            sessions.attach(session, ws);
          } else {
            if (existing) forgetUserSession(existing);
            session = sessions.create(cleanedName, userId);
            sessions.attach(session, ws);
            // A token-less login never inherits old seats.
            cleanupGhostSeats(key);
          }
          if (session.userId) {
            const bound = userSessions.get(session.userId) ?? new Set<Session>();
            bound.add(session);
            userSessions.set(session.userId, bound);
          }
          const dcTimer = callDisconnectTimers.get(key);
          if (dcTimer) { clearTimeout(dcTimer); callDisconnectTimers.delete(key); }

          const player: OnlinePlayer = { ws, username: cleanedName, key, roomId: null, token: session.token };
          onlinePlayers.set(ws, player);
          checkpoint();
          sendJson(ws, { type: "login-success", username: cleanedName, sessionToken: session.token, serverNow: now(), onlineUsers: onlineUsernames() });
          if (isOnlineGuest(cleanedName)) {
            try {
              const available = await guestHasOnlineTrial(cleanedName);
              if (isLive(ws)) sendJson(ws, { type: "guest-quota", onlineRemaining: available ? 1 : 0 });
            } catch (err) {
              console.error("[Guest] Unable to load online allowance", err);
              if (isLive(ws)) sendJson(ws, { type: "guest-quota", onlineRemaining: 0 });
            }
          }
          console.log(`[WS] Player logged in: ${cleanedName}${tokenMatches ? " (session resumed)" : ""}`);

          if (tokenMatches) {
            const found = findSeatFor(key, ws);
            if (found) {
              if (found.seat && found.seat.ws && found.seat.ws !== ws) {
                try { replaceSocket(found.seat.ws); } catch {}
              }
              cleanupGhostSeats(key, found.room);
              if (found.seat) attachToSeat(found.room, found.seat, player);
              else if (found.spectator) attachSpectator(found.room, found.spectator, player);
            }
          }
          broadcastOnlineUsers();
          break;
        }

        // ----------------------------------------------------------
        case "get-open-rooms": {
          sendJson(ws, { type: "open-rooms-list", rooms: getOpenRoomsData() });
          break;
        }

        case "list-live-rooms": {
          const liveRooms = Array.from(rooms.values())
            .filter((r) => !r.private && isLivePhase(r) && r.gameState)
            .map((r) => ({
              roomId: r.id,
              white: r.players.find((p) => p.color === "W")?.username ?? "?",
              black: r.players.find((p) => p.color === "B")?.username ?? "?",
              gameTime: r.gameTime,
              specialRule: r.specialRule,
              bestOf: r.bestOf,
              phase: r.phase,
              spectatorCount: liveSpectatorCount(r),
            }));
          const openRooms = getOpenRoomsData().map((r) => ({
            roomId: r.id,
            hostName: r.hostName,
            gameTime: r.gameTime,
            specialRule: r.specialRule,
            wagerAmount: r.wagerAmount,
            bestOf: r.bestOf,
          }));
          sendJson(ws, { type: "live-rooms-list", rooms: liveRooms, openRooms });
          break;
        }

        // ----------------------------------------------------------
        case "cancel-room": {
          const player = requirePlayer(ws);
          if (!player) return;
          const roomId = cleanRoomCode(data.roomId);
          const room = rooms.get(roomId);
          if (!room) { sendError(ws, "room-not-found", "That room no longer exists."); return; }
          if (room.creator !== player.username) { sendError(ws, "not-in-room", "Only the host can cancel a room."); return; }
          if (!requirePhase(ws, room, ["lobby"], "cancel the room")) return;
          deleteRoom(room);
          if (player.roomId === roomId) player.roomId = null;
          sendJson(ws, { type: "room-cancelled", roomId });
          break;
        }

        // ----------------------------------------------------------
        case "create-room": {
          const player = requirePlayer(ws);
          if (!player) return;
          const previousRoomId = player.roomId;
          if (isOnlineGuest(player.username)) {
            try {
              if (!await guestHasOnlineTrial(player.username)) {
                sendJson(ws, { type: "guest-limit-reached", mode: "online", message: "Your free online game has been used. Sign in to keep playing." });
                return;
              }
            } catch (err) {
              console.error("[Guest] Failed to check room entitlement", err);
              sendJson(ws, { type: "room-error", error: "Guest online play is temporarily unavailable. Try again shortly." });
              return;
            }
          }
          // Entitlement checks are asynchronous: a closed/replaced socket or
          // another room action must not leave a new orphan lobby behind.
          if (!isLive(ws) || onlinePlayers.get(ws) !== player || player.roomId !== previousRoomId) return;

          let userOpenCount = 0;
          for (const r of rooms.values()) {
            if (r.creator === player.username && r.phase === "lobby" && r.players.length < 2) userOpenCount++;
          }
          if (userOpenCount >= MAX_OPEN_ROOMS_PER_USER) {
            sendJson(ws, {
              type: "room-error",
              error: `You already have ${MAX_OPEN_ROOMS_PER_USER} unused rooms waiting for an opponent. Close or play one before creating a new room.`,
            });
            return;
          }

          if (player.roomId) abandonRoom(player, "switch");

          const roomId = getNextGameCode(rooms);
          const gameTime = typeof data.gameTime === "number" ? data.gameTime : 5;
          const specialRule = (typeof data.specialRule === "string" ? data.specialRule : "none") as SpecialRule;
          const hostTime = typeof data.hostTime === "number" ? data.hostTime : gameTime;
          const guestTime = typeof data.guestTime === "number" ? data.guestTime : gameTime;
          const incrementSec = typeof data.increment === "number" ? Math.max(0, Math.round(data.increment)) : 0;
          // Guest matches are free and strictly one game per invitation.
          const wagerAmount = isOnlineGuest(player.username) ? 0 : deps.sanitizeWagerAmount(data.wagerAmount) ?? undefined;
          const bestOf = isOnlineGuest(player.username) ? 1 : deps.sanitizeBestOf(data.bestOf);
          const customBoard = deps.sanitizeCustomBoard(data.customBoard) ?? undefined;
          const customTurn = customBoard && (data.customTurn === "W" || data.customTurn === "B") ? data.customTurn : undefined;
          const color: Color = Math.random() > 0.5 ? "W" : "B";

          const newRoom: Room = {
            id: roomId,
            private: data.private === true,
            seq: 0,
            phase: "lobby",
            players: [{
              ws, username: player.username, key: player.key, userId: sessions.get(player.key)?.userId ?? null, color, ready: false,
              awayStrikes: 0, awayMs: 0, awaySince: null, awayForfeitTimer: null,
              disconnectedAt: null, forfeitTimer: null, graceExpired: false,
            }],
            spectators: [],
            gameState: null,
            started: false,
            clockLimitType: clockLimitTypeFor(gameTime),
            clock: untimedClock(),
            flagTimer: null,
            incrementSec,
            startBoard: null,
            startTurn: "W",
            deletionTimer: null,
            gameTime,
            specialRule,
            hostTime,
            guestTime,
            wagerAmount,
            creator: player.username,
            bestOf,
            seriesGameNumber: 1,
            seriesScore: { [player.username]: 0 },
            seriesDraws: 0,
            seriesOver: false,
            seriesNextGameTimer: null,
            customBoard,
            customTurn,
            setupPhase: specialRule === "crown-crown" ? {} : null,
            feesCharged: false,
            potSettled: false,
            potSettling: false,
            potId: roomId,
            starting: false,
            resultRecorded: false,
            gamesStarted: 0,
            pendingEndOffer: null,
            previousGameCode: null,
            gameCode: roomId,
            seriesId: "",
            gameStartTime: 0,
            pendingRematch: null,
            chatTail: [],
          };
          rooms.set(roomId, newRoom);
          player.roomId = roomId;
          broadcastOpenRooms();
          sendDirect(newRoom, ws, { ...roomInfoPayload(newRoom), yourColor: color });
          console.log(`[WS] Room ${roomId} created by ${player.username} (Settings: ${gameTime}m${incrementSec ? `+${incrementSec}s` : ""}, ${specialRule}, best of ${bestOf})`);
          break;
        }

        // ----------------------------------------------------------
        case "join-room":
        case "join-room-accept": {
          const player = requirePlayer(ws);
          if (!player) return;
          const roomId = cleanRoomCode(data.roomId);
          if (!roomId) { sendJson(ws, { type: "room-error", error: "Please enter a valid room code" }); return; }
          const room = rooms.get(roomId);
          if (!room) { sendJson(ws, { type: "room-error", error: `Room #${roomId} not found` }); return; }

          // 1. If player is ALREADY seated in this room (reconnection, intent replay, or duplicate event):
          const existingSeat = seatByKey(room, player.key) || 
            (player.username ? room.players.find((p) => isSameUser(p.username, player.username)) : undefined) ||
            room.players.find((p) => p.ws === ws);

          if (existingSeat) {
            const other = player.roomId && player.roomId !== room.id ? rooms.get(player.roomId) : null;
            if (other && (isLivePhase(other) || isSeriesUnderway(other)) && seatByKey(other, player.key)) {
              sendJson(ws, { type: "room-error", error: "Finish or leave your current match before joining another game." }); return;
            }
            if (other) abandonRoom(player, "leave");
            attachToSeat(room, existingSeat, player);
            player.roomId = room.id;
            sendJson(ws, { type: "join-success", yourColor: existingSeat.color, roomId: room.id });
            sendDirect(room, ws, { ...roomInfoPayload(room), yourColor: existingSeat.color });
            if (isLivePhase(room) && room.gameState) {
              sendDirect(room, ws, {
                type: "game-started",
                roomId: room.id,
                players: playersPayload(room),
                gameState: room.gameState,
                clockLimitType: room.clockLimitType,
                clock: clockOf(room),
                phase: room.phase,
                gameCode: room.gameCode || room.id,
                bestOf: room.bestOf,
                seriesGameNumber: room.seriesGameNumber,
              });
            }
            return;
          }

          const host = room.players[0];
          if (!host) {
            sendJson(ws, { type: "room-error", error: "Room is invalid or closed." });
            return;
          }

          if (!requirePhase(ws, room, ["lobby"], "join as a new player")) return;
          const previousRoomId = player.roomId;

          // 2. If the user joining is actually the host:
          if (host.key === player.key || (player.username && isSameUser(host.username, player.username))) {
            attachToSeat(room, host, player);
            player.roomId = room.id;
            sendJson(ws, { type: "join-success", yourColor: host.color, roomId: room.id });
            sendDirect(room, ws, { ...roomInfoPayload(room), yourColor: host.color });
            return;
          }

          // Guests can join only free, single-game rooms. Check the server
          // quota before seating them; startRoomMatch checks again atomically.
          if (isOnlineGuest(player.username) || room.players.some(p => isOnlineGuest(p.username))) {
            if (room.bestOf !== 1 || (room.wagerAmount ?? 0) > 0) {
              sendJson(ws, { type: "room-error", error: "Guests can only play free single matches. Choose a free room or sign in." });
              return;
            }
          }
          if (isOnlineGuest(player.username)) {
            try {
              if (!await guestHasOnlineTrial(player.username)) {
                sendJson(ws, { type: "guest-limit-reached", mode: "online", message: "Your free online game has been used. Sign in to continue." });
                return;
              }
            } catch (err) {
              console.error("[Guest] Failed to check join entitlement", err);
              sendJson(ws, { type: "room-error", error: "Guest online play is temporarily unavailable. Try again shortly." });
              return;
            }
          }
          if (!isLive(ws) || onlinePlayers.get(ws) !== player || player.roomId !== previousRoomId) return;
          if (rooms.get(roomId) !== room) { sendJson(ws, { type: "room-error", error: "Room is no longer available." }); return; }
          if (!requirePhase(ws, room, ["lobby"], "join as a new player")) return;

          // Looking up an invite is a preview, never consent to leave the
          // current room, consume a guest trial, or debit either wallet.
          if (data.type === "join-room") {
            if (room.players.length >= 2 && !room.players.some((p, index) => index > 0 && !isLive(p.ws))) {
              sendJson(ws, { type: "room-error", error: "Room is already full with 2 active players." });
              return;
            }
            let entryFee = 0;
            if (deps.coinsEnabled && !isOnlineGuest(player.username) && !room.players.some(p => isOnlineGuest(p.username))) {
              try {
                const settings = await deps.getCoinSettings();
                if (settings) entryFee = deps.resolveEntryFee(room, settings);
              } catch (err) {
                console.error("[WS] Failed to price room preview:", err);
                sendJson(ws, { type: "room-error", error: "Match pricing is unavailable. Try again shortly." });
                return;
              }
            }
            if (!isLive(ws) || onlinePlayers.get(ws) !== player || player.roomId !== previousRoomId) return;
            if (rooms.get(roomId) !== room || room.players[0] !== host || room.phase !== "lobby") {
              sendJson(ws, { type: "room-error", error: "Room is no longer available." });
              return;
            }
            sendJson(ws, {
              type: "room-preview", roomId, hostName: host.username,
              private: room.private, gameTime: room.gameTime, increment: room.incrementSec,
              specialRule: room.specialRule, hostTime: room.hostTime, guestTime: room.guestTime,
              wagerAmount: room.wagerAmount ?? 0, bestOf: room.bestOf, entryFee,
            });
            return;
          }

          // 3. If room already has 2 active players:
          if (room.players.length >= 2) {
            // Check if any guest seat is dead/disconnected in lobby phase and can be replaced:
            const deadGuestIndex = room.players.findIndex((p, idx) => idx > 0 && !isLive(p.ws));
            if (deadGuestIndex > 0 && room.phase === "lobby") {
              room.players.splice(deadGuestIndex, 1);
            } else {
              sendJson(ws, { type: "room-error", error: "Room is already full with 2 active players." });
              return;
            }
          }

          if (player.roomId && player.roomId !== roomId) abandonRoom(player, "switch");
          if (rooms.get(roomId) !== room) { sendJson(ws, { type: "room-error", error: "Room not found" }); return; }

          clearDeletionTimer(room);
          const color = otherColor(host.color);
          room.players.push({
            ws, username: player.username, key: player.key, userId: sessions.get(player.key)?.userId ?? null, color, ready: true,
            awayStrikes: 0, awayMs: 0, awaySince: null, awayForfeitTimer: null,
            disconnectedAt: null, forfeitTimer: null, graceExpired: false,
          });
          host.ready = true;
          if (room.seriesNextGameTimer) { clearTimeout(room.seriesNextGameTimer); room.seriesNextGameTimer = null; }
          room.seriesGameNumber = 1;
          room.seriesDraws = 0;
          room.seriesOver = false;
          room.seriesScore = Object.create(null);
          for (const pl of room.players) room.seriesScore[pl.username] = 0;
          player.roomId = roomId;

          sendJson(ws, { type: "join-success", yourColor: color, roomId });
          await startRoomMatch(room);
          if (rooms.get(roomId) === room && room.phase !== "lobby") {
            const text = `🎮 ${player.username} joined the match! Game started. Good luck!`;
            pushChat(room, "System", text);
            sendToRoom(room, { type: "chat-message", from: "System", text });
          }
          console.log(`[WS] Player ${player.username} joined room ${roomId} as ${color}`);
          broadcastOpenRooms();
          break;
        }

        case "join-room-refuse": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = rooms.get(cleanRoomCode(data.roomId));
          if (room) {
            const text = `${player.username} has declined the match invitation.`;
            pushChat(room, "System", text);
            sendToRoom(room, { type: "chat-message", from: "System", text });
          }
          break;
        }

        // ----------------------------------------------------------
        // Crown Crown setup (phase "setup")
        case "remove-front-row-piece": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          const seat = requireSeat(ws, room);
          if (!seat) return;
          if (!requirePhase(ws, room, ["setup"], "remove a piece")) return;
          if (!room.setupPhase || !room.gameState?.board) return;
          const sq: number = data.sq;
          const userSetup = room.setupPhase[seat.username];
          if (!userSetup || userSetup.kingSelected) { sendError(ws, "wrong-phase", "Your King is already placed."); return; }
          const board = room.gameState.board;
          const piece = board[sq];
          if (!piece) { sendError(ws, "invalid-payload", "There is no piece on that square."); return; }
          const pieceColor: Color = piece === "w" || piece === "W" ? "W" : "B";
          if (seat.color !== pieceColor) { sendError(ws, "invalid-payload", "That isn't your piece."); return; }
          const frontRow = seat.color === "W" ? [31, 32, 33, 34, 35] : [16, 17, 18, 19, 20];
          if (!frontRow.includes(sq)) { sendJson(ws, { type: "room-error", error: "Pick one of your front-row pieces." }); return; }
          if (userSetup.pendingKingPlacement && userSetup.removedFromSq) {
            board[userSetup.removedFromSq] = seat.color === "W" ? "w" : "b";
          }
          board[sq] = null;
          userSetup.pendingKingPlacement = true;
          userSetup.removedFromSq = sq;
          room.gameState.statusMessage = `${seat.username} removed a piece from the front row -- now placing their King.`;
          sendRoomInfo(room);
          break;
        }

        case "place-starting-king": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          const seat = requireSeat(ws, room);
          if (!seat) return;
          if (!requirePhase(ws, room, ["setup"], "place a King")) return;
          if (!room.setupPhase || !room.gameState?.board) return;
          const sq: number = data.sq;
          const userSetup = room.setupPhase[seat.username];
          if (!userSetup || !userSetup.pendingKingPlacement || userSetup.kingSelected) { sendError(ws, "wrong-phase", "Remove a front-row piece first."); return; }
          const board = room.gameState.board;
          const backRow = seat.color === "W" ? [46, 47, 48, 49, 50] : [1, 2, 3, 4, 5];
          if (!backRow.includes(sq)) { sendError(ws, "invalid-payload", "Pick a square on your back row."); return; }
          const occupant = board[sq];
          if (occupant) {
            const occupantColor: Color = occupant === "w" || occupant === "W" ? "W" : "B";
            if (occupantColor !== seat.color) return;
            if (occupant === "W" || occupant === "B") return;
            if (!userSetup.removedFromSq) return;
            board[userSetup.removedFromSq] = seat.color === "W" ? "w" : "b";
          }
          board[sq] = seat.color === "W" ? "W" : "B";
          userSetup.kingSq = sq;
          userSetup.kingSelected = true;
          userSetup.pendingKingPlacement = false;

          const playersWithSetup = Object.keys(room.setupPhase);
          const bothFinished = playersWithSetup.length === 2 && playersWithSetup.every((u) => room.setupPhase?.[u]?.kingSelected);
          if (bothFinished) {
            room.setupPhase = null;
            room.phase = "playing";
            room.startBoard = normalizeBoard(board); // the crowned setup IS the starting position
            try { recordGameStartingPosition(room.gameCode, room.startBoard); }
            catch (err) { console.error("[GameRecord] Failed to save crowned starting position:", err); }
            room.gameState.statusMessage = "Crown Crown setup complete! Clocks are active. White to play.";
            syncClock(room);
            sendToRoom(room, { type: "crown-crown-complete", gameState: room.gameState, clock: clockOf(room), phase: room.phase });
            sendRoomInfo(room);
          } else {
            room.gameState.statusMessage = `${seat.username} placed their King! Waiting for opponent.`;
            sendRoomInfo(room);
          }
          break;
        }

        // ----------------------------------------------------------
        case "emoji-reaction": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          sendToRoom(room, { type: "emoji-reaction", emoji: data.emoji, sender: player.username });
          break;
        }

        // ----------------------------------------------------------
        case "start-game":
        case "ready": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          const seat = requireSeat(ws, room);
          if (!seat) return;
          if (!requirePhase(ws, room, ["lobby"], data.type === "ready" ? "ready up" : "start the game")) return;
          const isHost = room.players[0] === seat;
          seat.ready = true;
          if (isHost && data.type === "start-game") for (const p of room.players) p.ready = true;
          const canStart = room.players.length === 2 && (isHost || room.players.every((p) => p.ready));
          if (canStart) await startRoomMatch(room);
          else sendRoomInfo(room);
          break;
        }

        case "set-clock": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          const seat = requireSeat(ws, room);
          if (!seat) return;
          if (room.players[0] !== seat) { sendJson(ws, { type: "room-error", error: "Only the host can set the clock conditions" }); return; }
          if (!requirePhase(ws, room, ["lobby"], "change the clock")) return;
          room.clockLimitType = data.clockLimitType;
          sendRoomInfo(room);
          break;
        }

        // ----------------------------------------------------------
        case "resync": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          refreshLegacyTimes(room);
          sendDirect(room, ws, { type: "opponent-moved", gameState: room.gameState, clock: clockOf(room), phase: room.phase });
          break;
        }

        // ----------------------------------------------------------
        case "make-move": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          const seat = requireSeat(ws, room);
          if (!seat) return;
          if (!requirePhase(ws, room, ["playing"], "move")) return;
          if (!room.gameState) return;
          if (room.players.length !== 2 || room.players.some((p) => !isLive(p.ws) || p.disconnectedAt !== null)) {
            sendError(ws, "busy", "Both players must be connected before moving.");
            return;
          }
          if (room.pendingEndOffer) { sendError(ws, "busy", "Answer (or cancel) the pending offer before moving."); return; }
          if (!room.gameState.board) room.gameState.board = room.startBoard ? normalizeBoard(room.startBoard) : createInitialBoard();
          refreshLegacyTimes(room);

          if (seat.color !== room.gameState.turn) {
            sendDirect(room, ws, { type: "move-rejected", code: "not-your-turn", reason: "It's not your turn.", gameState: room.gameState, clock: clockOf(room), phase: room.phase });
            return;
          }
          const t = now();
          if (room.clock.timed && room.clock.running === seat.color && clockRemainingMs(room.clock, seat.color, t) <= 0) {
            onFlag(room); // the flag timer just hasn't fired yet
            return;
          }
          const claimed: Move = { from: data.move.from, to: data.move.to, caps: Array.isArray(data.move.caps) ? data.move.caps : [] };
          const legalMatch = deps.findLegalMatch(room.gameState.board, room.gameState.turn, claimed);
          if (!legalMatch) {
            sendDirect(room, ws, { type: "move-rejected", code: "illegal-move", reason: "That move isn't legal in the current position.", gameState: room.gameState, clock: clockOf(room), phase: room.phase });
            return;
          }

          const { board: newBoard } = applyMove(room.gameState.board, legalMatch);
          const nextTurn = otherColor(room.gameState.turn);
          applyMoveToClock(room.clock, seat.color, t);
          const statusMessage = `${colorName(nextTurn)} to play`;
          room.gameState = {
            board: newBoard,
            turn: nextTurn,
            moveHistory: [...(room.gameState.moveHistory ?? []), legalMatch],
            whiteTime: 0,
            blackTime: 0,
            statusMessage,
          };
          syncClock(room); // resumes for nextTurn (unless paused for a reason) + re-arms the flag timer

          sendToRoom(room, {
            type: "move-made",
            move: legalMatch,
            moveIndex: room.gameState.moveHistory.length,
            turn: nextTurn,
            whiteTime: room.gameState.whiteTime,
            blackTime: room.gameState.blackTime,
            statusMessage,
            clock: clockOf(room),
            phase: room.phase,
            by: seat.username,
          });

          const endResult = checkGameEndFrom(room.startBoard ?? createInitialBoard(), room.startTurn, room.gameState.moveHistory, newBoard, nextTurn);
          if (endResult.isOver) {
            endLiveGame(
              room,
              { isDraw: endResult.isDraw, winnerColor: endResult.winner },
              endResult.isDraw ? "draw" : "win",
              endResult.isDraw ? `Game Draw! ${endResult.reason}. 🤝` : `Game Over! ${colorName(endResult.winner)} wins (${endResult.reason}). 🏆`,
              { recordReason: endResult.reason },
            );
          }
          break;
        }

        // ----------------------------------------------------------
        case "game-reset": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          const seat = requireSeat(ws, room);
          if (!seat) return;
          if (!requirePhase(ws, room, ["ended"], "start a new game")) return;
          if (isSeriesUnderway(room)) { sendError(ws, "game-in-progress", "The series is still in progress — the next game starts automatically."); return; }
          if (room.players.some(p => isOnlineGuest(p.username))) {
            sendToRoom(room, { type: "room-error", error: "The guest free online game is complete. Sign in to play another match." });
            return;
          }
          resetRoomForRematch(room);
          sendToRoom(room, { type: "game-reset-by-opponent", players: playersPayload(room), phase: room.phase });
          sendRoomInfo(room);
          broadcastOpenRooms();
          break;
        }

        case "rematch-request": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          if (room.tournamentId) { sendError(ws, "busy", "Tournament rematches are scheduled by the server."); return; }
          const seat = requireSeat(ws, room);
          if (!seat) return;
          if (!requirePhase(ws, room, ["ended"], "request a rematch")) return;
          if (isSeriesUnderway(room)) { sendError(ws, "game-in-progress", "The series is still in progress — the next game starts automatically."); return; }
          if (room.players.some(p => isOnlineGuest(p.username))) {
            sendToRoom(room, { type: "room-error", error: "Guests can play one free online match. Sign in before requesting a rematch." });
            return;
          }
          const opp = opponentOf(room, seat);
          if (!opp || !isLive(opp.ws)) { sendError(ws, "not-in-room", "Your opponent has left the room."); return; }
          if (room.pendingRematch) { sendError(ws, "busy", "A rematch request is already pending."); return; }
          room.pendingRematch = { fromUsername: seat.username, requestedAt: now() };
          sendDirect(room, ws, { type: "rematch-waiting", fromUsername: seat.username });
          sendDirect(room, opp.ws, { type: "rematch-requested", from: seat.username, fromUsername: seat.username });
          break;
        }

        case "rematch-cancel": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          const seat = requireSeat(ws, room);
          if (!seat) return;
          if (!requirePhase(ws, room, ["ended"], "cancel a rematch")) return;
          if (!room.pendingRematch || room.pendingRematch.fromUsername !== seat.username) { sendError(ws, "busy", "You have no pending rematch request."); return; }
          room.pendingRematch = null;
          sendToRoom(room, { type: "rematch-cancelled", from: seat.username, fromUsername: seat.username }, ws);
          break;
        }

        case "rematch-response": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          if (room.tournamentId) { sendError(ws, "busy", "Tournament games are paired by the server."); return; }
          const seat = requireSeat(ws, room);
          if (!seat) return;
          if (!requirePhase(ws, room, ["ended"], "answer a rematch")) return;
          const pending = room.pendingRematch;
          if (!pending || pending.fromUsername === seat.username) { sendError(ws, "busy", "There is no rematch request to answer."); return; }
          const requester = room.players.find((p) => p.username === pending.fromUsername);
          if (!requester || !isLive(requester.ws)) {
            room.pendingRematch = null;
            sendError(ws, "not-in-room", "The player who asked for a rematch has left.");
            return;
          }
          if (!data.accept) {
            room.pendingRematch = null;
            sendDirect(room, requester.ws, { type: "rematch-declined", from: seat.username, fromUsername: seat.username });
            return;
          }
          if (isSeriesUnderway(room)) { sendError(ws, "game-in-progress", "The series is still in progress."); return; }
          if (room.players.some(p => isOnlineGuest(p.username))) {
            sendToRoom(room, { type: "room-error", error: "Guests get one free online game. Sign in before playing a rematch." });
            return;
          }
          const previousGameCode = room.gameCode;
          resetRoomForRematch(room);
          const newGameCode = allocateGameCode(room);
          try { linkRematch(previousGameCode, newGameCode); } catch (err) { console.error("[Rematch] link error:", err); }
          room.seriesId = `series_${newGameCode}`;
          room.previousGameCode = previousGameCode;
          for (const p of room.players) p.ready = true;
          sendToRoom(room, { type: "rematch-accepted", newGameCode, previousGameCode, seriesId: room.seriesId, roomId: room.id });
          await startRoomMatch(room, newGameCode);
          break;
        }

        // ----------------------------------------------------------
        // Resign / draw: two-party offers (unchanged semantics, now phase-gated
        // and the clock pauses while an offer is open).
        case "resign": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          const seat = requireSeat(ws, room);
          if (!seat) return;
          if (!requirePhase(ws, room, ["playing"], "resign")) return;
          if (room.pendingEndOffer) { sendError(ws, "busy", "There is already an offer waiting for an answer."); return; }
          room.pendingEndOffer = { type: "resign", fromUsername: seat.username };
          syncClock(room);
          sendToRoom(room, { type: "resign-requested", from: seat.username, clock: clockOf(room), phase: room.phase }, ws);
          sendClockSync(room, ws);
          break;
        }

        case "resign-response": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          const seat = requireSeat(ws, room);
          if (!seat) return;
          if (!requirePhase(ws, room, ["playing"], "answer a resignation")) return;
          const pending = room.pendingEndOffer;
          if (!pending || pending.type !== "resign" || pending.fromUsername === seat.username) { sendError(ws, "busy", "There is no resignation to answer."); return; }
          room.pendingEndOffer = null;
          if (data.accept) {
            const resigning = room.players.find((p) => p.username === pending.fromUsername);
            if (!resigning) return;
            const winnerColor = otherColor(resigning.color);
            endLiveGame(room, { isDraw: false, winnerColor }, "resign",
              `Game Over! ${colorName(winnerColor)} wins (${resigning.username} resigned). 🏳️`, { recordReason: "Resignation" });
          } else {
            syncClock(room);
            sendToRoom(room, { type: "resign-declined", from: seat.username, clock: clockOf(room), phase: room.phase }, ws);
            sendClockSync(room, ws);
          }
          break;
        }

        case "cancel-resign": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          const seat = requireSeat(ws, room);
          if (!seat) return;
          if (!requirePhase(ws, room, ["playing"], "cancel a resignation")) return;
          const pending = room.pendingEndOffer;
          if (!pending || pending.type !== "resign" || pending.fromUsername !== seat.username) { sendError(ws, "busy", "You have no resignation offer to cancel."); return; }
          room.pendingEndOffer = null;
          syncClock(room);
          sendToRoom(room, { type: "resign-cancelled", from: seat.username, clock: clockOf(room), phase: room.phase });
          break;
        }

        case "offer-draw": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          const seat = requireSeat(ws, room);
          if (!seat) return;
          if (!requirePhase(ws, room, ["playing"], "offer a draw")) return;
          if (room.pendingEndOffer) { sendError(ws, "busy", "There is already an offer waiting for an answer."); return; }
          room.pendingEndOffer = { type: "draw", fromUsername: seat.username };
          syncClock(room);
          sendToRoom(room, { type: "draw-offered", from: seat.username, clock: clockOf(room), phase: room.phase }, ws);
          sendClockSync(room, ws);
          break;
        }

        case "draw-response": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          const seat = requireSeat(ws, room);
          if (!seat) return;
          if (!requirePhase(ws, room, ["playing"], "answer a draw offer")) return;
          const pending = room.pendingEndOffer;
          if (!pending || pending.type !== "draw" || pending.fromUsername === seat.username) { sendError(ws, "busy", "There is no draw offer to answer."); return; }
          room.pendingEndOffer = null;
          if (data.accept) {
            endLiveGame(room, { isDraw: true, winnerColor: null }, "draw", "Game Over! Draw agreed by mutual agreement. 🤝", { recordReason: "Draw Agreement" });
          } else {
            syncClock(room);
            sendToRoom(room, { type: "draw-declined", from: seat.username, clock: clockOf(room), phase: room.phase }, ws);
            sendClockSync(room, ws);
          }
          break;
        }

        case "cancel-draw": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          const seat = requireSeat(ws, room);
          if (!seat) return;
          if (!requirePhase(ws, room, ["playing"], "cancel a draw offer")) return;
          const pending = room.pendingEndOffer;
          if (!pending || pending.type !== "draw" || pending.fromUsername !== seat.username) { sendError(ws, "busy", "You have no draw offer to cancel."); return; }
          room.pendingEndOffer = null;
          syncClock(room);
          sendToRoom(room, { type: "draw-cancelled", from: seat.username, clock: clockOf(room), phase: room.phase });
          break;
        }

        // ----------------------------------------------------------
        // Fair Play Guard:
        // - Leaving the app: Warnings 1 to 7 without resignation/forfeit.
        //   Only exceeding 7 strikes (> 7) OR game clock expiration causes a loss.
        // - Split-screen: Automatic forfeit immediately winning for opponent.
        case "focus-lost": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          const p = seatOf(room, ws);
          if (!p) return; // spectators may wander freely
          if (!requirePhase(ws, room, ["playing"], "report focus")) return;
          if (p.awaySince) return;
          p.awaySince = now();
          p.awayStrikes = (p.awayStrikes || 0) + 1;
          if (p.awayStrikes > FAIRPLAY_MAX_STRIKES) {
            const winnerColor = otherColor(p.color);
            endLiveGame(room, { isDraw: false, winnerColor }, "fairplay",
              `Game Over! ${colorName(winnerColor)} wins — ${p.username} exceeded the 7-departure fair-play limit. 🛡️`,
              { forfeitWholeSeries: true, recordReason: "Fair-play forfeit: exceeded 7 departures" });
            return;
          }
          const remainingWarnings = FAIRPLAY_MAX_STRIKES - p.awayStrikes;
          const warningMsg = p.awayStrikes === FAIRPLAY_MAX_STRIKES
            ? `FINAL WARNING (${p.awayStrikes}/${FAIRPLAY_MAX_STRIKES}): You left the app during a live game. Leaving again will result in an automatic forfeit!`
            : `FAIR PLAY WARNING (${p.awayStrikes}/${FAIRPLAY_MAX_STRIKES}): You left the app during a live game. You have ${remainingWarnings} warning(s) remaining before automatic forfeit.`;

          sendJson(ws, {
            type: "fairplay-warning",
            strikes: p.awayStrikes,
            maxStrikes: FAIRPLAY_MAX_STRIKES,
            message: warningMsg,
          });
          sendToRoom(room, { type: "opponent-away", username: p.username, strikes: p.awayStrikes, maxStrikes: FAIRPLAY_MAX_STRIKES, clock: clockOf(room), phase: room.phase }, ws);
          break;
        }

        case "focus-regained": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          const p = seatOf(room, ws);
          if (!p || !p.awaySince) return;
          if (p.awayForfeitTimer) { clearTimeout(p.awayForfeitTimer); p.awayForfeitTimer = null; }
          p.awayMs = (p.awayMs || 0) + (now() - p.awaySince);
          p.awaySince = null;
          sendToRoom(room, { type: "opponent-back", username: p.username, strikes: p.awayStrikes || 0, clock: clockOf(room), phase: room.phase }, ws);
          break;
        }

        case "split-screen-detected": {
          // Split screen is allowed without warning or forfeit as requested.
          break;
        }

        // ----------------------------------------------------------
        case "spectate-room": {
          const player = requirePlayer(ws);
          if (!player) return;
          const targetRoomId = cleanRoomCode(data.roomId);
          const room = rooms.get(targetRoomId);
          if (!room || !isLivePhase(room)) { sendJson(ws, { type: "room-error", error: "That game isn't live right now." }); return; }
          if (room.private) { sendError(ws, "busy", "This game is private. Spectating is disabled."); return; }
          if (seatByKey(room, player.key)) { sendError(ws, "busy", "You are a player in that room — log in with your session to rejoin it."); return; }
          if (player.roomId && player.roomId !== room.id) abandonRoom(player, "switch");
          if (rooms.get(targetRoomId) !== room) { sendJson(ws, { type: "room-error", error: "That game isn't live right now." }); return; }
          const existingSp = room.spectators.find((s) => s.key === player.key);
          if (existingSp) {
            attachSpectator(room, existingSp, player);
            break;
          }
          const sp: Spectator = { ws, username: player.username, key: player.key, disconnectedAt: null };
          room.spectators.push(sp);
          attachSpectator(room, sp, player);
          break;
        }

        case "leave-spectate": {
          const player = requirePlayer(ws);
          if (!player) return;
          let leftRoomId: string | null = null;
          for (const room of rooms.values()) {
            const specIdx = room.spectators.findIndex((s) => s.ws === ws || s.key === player.key);
            if (specIdx >= 0) {
              leftRoomId = room.id;
              room.spectators.splice(specIdx, 1);
              pruneSpectators(room);
              sendRoomInfo(room);
              if (room.players.every((p) => !isLive(p.ws)) && !room.spectators.some((s) => isLive(s.ws)) && !isLivePhase(room)) armDeletionTimer(room);
            }
          }
          if (player.roomId === leftRoomId) player.roomId = null;
          sendJson(ws, { type: "left-room-success" });
          break;
        }

        // ----------------------------------------------------------
        case "chat": {
          const player = requirePlayer(ws);
          if (!player) return;
          const room = requireRoom(ws, player);
          if (!room) return;
          const t2 = now();
          if (t2 > chatReset) { chatCount = 0; chatReset = t2 + FLOOD_WINDOW_MS; }
          chatCount++;
          if (chatCount > CHAT_MAX_PER_WINDOW) {
            sendJson(ws, { type: "chat-error", message: "Sending messages too fast. Please slow down." });
            return;
          }
          const sanitizedText = sanitizeInputString(data.text, 500);
          if (!sanitizedText) return;
          pushChat(room, player.username, sanitizedText);
          sendToRoom(room, { type: "chat-message", from: player.username, text: sanitizedText, ts: now() });
          break;
        }

        // ----------------------------------------------------------
        case "leave-room": {
          const player = onlinePlayers.get(ws);
          if (player && player.roomId) abandonRoom(player, "leave");
          sendJson(ws, { type: "left-room-success" });
          break;
        }

        // ----------------------------------------------------------
        default: {
          if (isCallMessageType(data.type)) {
            const player = requirePlayer(ws);
            if (!player) return;
            handleCallMessage(ws, player, data);
            break;
          }
          console.warn(`[WS] Ignoring unknown message type "${String(data.type).slice(0, 40)}"`);
          break;
        }
      }
    }
  });

  // Restore durable seats before admitting connections. Clocks freeze during
  // the outage; each player receives a fresh bounded reconnect window.
  const saved = recovery.read();
  if (saved) {
    if (!Array.isArray(saved.rooms) || !Array.isArray(saved.sessions) || saved.rooms.length > 1000) throw new Error('Invalid saved multiplayer state');
    restoreGuestTrials(saved.guestTrials || []);
    for (const raw of saved.rooms) {
      if (!/^\d{7,10}$/.test(raw.id) || !Array.isArray(raw.players) || raw.players.length > 2 || !['lobby','setup','playing','ended'].includes(raw.phase)) throw new Error('Invalid saved room');
      const room = raw as Room;
      if (room.gameState?.board && room.phase !== 'setup') {
        const replay = replayForAnalysis(room.gameState.moveHistory, room.startBoard, room.startTurn);
        const board = replay.boards.at(-1)!;
        if (JSON.stringify(normalizeBoard(board)) !== JSON.stringify(normalizeBoard(room.gameState.board)) || replay.turns.at(-1) !== room.gameState.turn) throw new Error('Saved room history does not match its board');
      }
      if (room.clock) {
        for (const value of [room.clock.whiteMs, room.clock.blackMs, room.clock.turnStartedAt, room.clock.incrementMs]) if (!Number.isFinite(value) || value < 0) throw new Error('Invalid saved clock');
        // The snapshot stores a wall-clock turn anchor. Bound elapsed to the
        // last persisted event by saving remaining time during checkpoint.
        room.clock.running = null;
      }
      room.flagTimer = room.deletionTimer = room.seriesNextGameTimer = null;
      room.starting = room.potSettling = false;
      room.spectators = []; // spectators must explicitly re-authorize discovery
      for (const seat of room.players) {
        seat.ws = null; seat.forfeitTimer = seat.awayForfeitTimer = null;
        seat.disconnectedAt = now(); seat.awaySince = null; seat.graceExpired = false;
      }
      rooms.set(room.id, room);
    }
    sessions.restore(saved.sessions);
    for (const session of sessions.snapshot()) {
      const live = sessions.get(session.key)!;
      if (live.userId) { const bound = userSessions.get(live.userId) || new Set<Session>(); bound.add(live); userSessions.set(live.userId, bound); }
    }
    for (const room of rooms.values()) {
      if (room.awaitingFirstJoin) { /* Unclaimed pairings wait for the first competitor. */ }
      else if (isLivePhase(room) || isSeriesUnderway(room)) for (const seat of room.players) {
        seat.forfeitTimer = setTimeout(() => safeTimer('restart grace', () => onGraceExpired(room, seat)), 120_000);
      } else armDeletionTimer(room);
      if (room.terminalResult) {
        const result = room.terminalResult;
        const white = room.players.find(p => p.color === 'W')?.username || '';
        const black = room.players.find(p => p.color === 'B')?.username || '';
        void recordGameEnd({ gameCode: room.gameCode, completeMoveHistory: room.gameState?.moveHistory || [], currentPosition: room.gameState?.board, currentTurn: room.gameState?.turn, startingPosition: room.startBoard, startingTurn: room.startTurn, private: room.private, participantUserIds: room.players.flatMap(p => p.userId ? [p.userId] : []), winnerColor: result.winnerColor, winnerUsername: result.isDraw ? null : result.winnerColor === 'W' ? white : black, loserUsername: result.isDraw ? null : result.winnerColor === 'W' ? black : white, isDraw: result.isDraw, finalResult: result.isDraw ? '½–½' : result.winnerColor === 'W' ? '1–0' : '0–1', resultReason: result.reason }).catch(error => console.error('[Recovery] Terminal sync pending', error));
        if (deps.onGameCompleted) void Promise.resolve().then(() => deps.onGameCompleted!({ gameCode: room.gameCode, white, black, winner: result.winnerColor, draw: result.isDraw, roomId: room.id, tournamentId: room.tournamentId })).catch(error => console.error('[Recovery] Tournament sync pending', error));
        if (room.bestOf <= 1) settleWithRetry(room, result, 'restart recovery');
        else if (room.seriesOver) {
          const ranked = room.players.slice().sort((a,b) => (room.seriesScore[b.username] || 0) - (room.seriesScore[a.username] || 0));
          const tied = !ranked[1] || room.seriesScore[ranked[0].username] === room.seriesScore[ranked[1].username];
          settleWithRetry(room, { isDraw: tied, winnerColor: tied ? null : ranked[0].color }, 'restart series recovery');
        }
      }
    }
    console.log(`[WS] Restored ${rooms.size} durable rooms; clocks await reconnection.`);
  }

  const recoveryHeartbeat = setInterval(() => safeTimer("durable clock", () => checkpoint(true)), 1000);
  recoveryHeartbeat.unref();

  // Periodic WebSocket heartbeat every 20s to prune dead/stale connections safely
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((wsClient: any) => {
      if (wsClient.isAlive === false) {
        wsClient.missedPings = (wsClient.missedPings || 0) + 1;
        if (wsClient.missedPings >= 3) {
          console.log("[WS] Terminating stale socket after missed heartbeats");
          return wsClient.terminate();
        }
      } else {
        wsClient.missedPings = 0;
      }
      wsClient.isAlive = false;
      try { wsClient.ping(); } catch {}
    });
  }, 20000);

  wss.on("close", () => {
    shutdown();
  });

  /** Stop transport timers on process shutdown without adjudicating games. */
  function shutdown(): void {
    if (shuttingDown) return;
    checkpoint(true);
    shuttingDown = true;
    clearInterval(heartbeatInterval);
    clearInterval(recoveryHeartbeat);
    onlineUsersBroadcast.cancel();
    openRoomsBroadcast.cancel();
    for (const room of rooms.values()) {
      clearFlagTimer(room);
      if (room.seriesNextGameTimer) clearTimeout(room.seriesNextGameTimer);
      if (room.deletionTimer) clearTimeout(room.deletionTimer);
      for (const seat of room.players) clearSeatTimers(seat);
    }
    for (const call of activeCalls.values()) if (call.timer) clearTimeout(call.timer);
    for (const timer of callDisconnectTimers.values()) clearTimeout(timer);
    for (const buffer of signalBuffers.values()) clearTimeout(buffer.timer);
    sessions.dispose();
    userSessions.clear();
    onlinePlayers.clear();
    rooms.clear();
    recovery.close();
    activeCalls.clear();
    callDisconnectTimers.clear();
    signalBuffers.clear();
    for (const ws of wss.clients) {
      try { ws.close(1012, "server restarting"); } catch { /* caller owns deadline termination */ }
    }
  }

  console.log(`[WS] Online play attached (maxPayload ${MAX_WS_PAYLOAD_BYTES} bytes, coins ${deps.coinsEnabled && supabaseConfigured() ? "enabled" : "disabled — no SUPABASE_SECRET_KEY"}).`);

  function ensureTournamentRoom(spec: { id: string; tournamentId: string; matchId: string; white: { username: string; uid: string }; black: { username: string; uid: string }; private: boolean; minutes: number; specialRule: string }): void {
    const existing = rooms.get(spec.id);
    if (existing) { if (existing.tournamentId !== spec.tournamentId || existing.tournamentMatchId !== spec.matchId) throw new Error('Room identity conflict'); return; }
    if (!/^\d{7,10}$/.test(spec.id) || spec.white.username.toLowerCase() === spec.black.username.toLowerCase()) throw new Error('Invalid tournament room');
    const seat = (player: { username: string; uid: string }, color: Color): Seat => ({ ws: null, username: player.username, key: keyOf(player.username), userId: player.uid, color, ready: true, awayStrikes: 0, awayMs: 0, awaySince: null, awayForfeitTimer: null, disconnectedAt: now(), forfeitTimer: null, graceExpired: false });
    const room: Room = { id: spec.id, tournamentId: spec.tournamentId, tournamentMatchId: spec.matchId, awaitingFirstJoin: true, private: spec.private, seq: 0, phase: 'lobby', players: [seat(spec.white,'W'),seat(spec.black,'B')], spectators: [], gameState: null, started: false,
      clockLimitType: clockLimitTypeFor(spec.minutes), clock: untimedClock(), flagTimer: null, incrementSec: 0, startBoard: null, startTurn: 'W', deletionTimer: null, gameTime: spec.minutes, specialRule: spec.specialRule as SpecialRule,
      hostTime: spec.minutes, guestTime: spec.minutes, creator: spec.white.username, bestOf: 1, seriesGameNumber: 1, seriesScore: {}, seriesDraws: 0, seriesOver: false, seriesNextGameTimer: null, setupPhase: null,
      feesCharged: true, potSettled: true, potSettling: false, potId: spec.id, starting: false, resultRecorded: false, gamesStarted: 0, pendingEndOffer: null, previousGameCode: null, gameCode: spec.id, seriesId: 'tournament:'+spec.tournamentId, gameStartTime: 0, pendingRematch: null, chatTail: [] };
    rooms.set(room.id, room);beginGame(room, room.id, 'Tournament: ');
    checkpoint();
  }

  return {
    wss,
    ensureTournamentRoom,
    shutdown,
    revokeUser,
    /** Live room map (read-only use: /api/games/next-code avoids codes of live rooms). */
    rooms: rooms as ReadonlyMap<string, unknown> as Map<string, unknown>,
    /** Test/diagnostic hooks -- not used by the app itself. */
    checkpoint,
    storageHealthy: () => !storageFailed,
    stats: () => ({ players: onlinePlayers.size, rooms: rooms.size, sessions: sessions.size, calls: activeCalls.size }),
  };
}
