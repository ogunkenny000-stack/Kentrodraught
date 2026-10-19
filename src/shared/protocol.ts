// Shared online-play protocol types (see docs/ONLINE_PLAY_PROTOCOL.md).
// Imported by BOTH server.ts and the client. Keep this file dependency-free.

export type Color = "W" | "B";

export type RoomPhase = "lobby" | "setup" | "playing" | "ended";

/** Server-authoritative clock snapshot. All timestamps are server epoch ms. */
export interface ClockState {
  /** Remaining ms for White as of `turnStartedAt` (exact if White is not running). */
  whiteMs: number;
  /** Remaining ms for Black as of `turnStartedAt` (exact if Black is not running). */
  blackMs: number;
  /** Whose clock is ticking; null while paused (setup, dialogs, disconnect, ended, untimed). */
  running: Color | null;
  /** Server time when the running side's turn started (or when the clock was last resumed). */
  turnStartedAt: number;
  /** Server time when this snapshot was produced; used by the client to compute its offset. */
  serverNow: number;
  /** Increment added to the mover after each move. */
  incrementMs: number;
}

export const UNTIMED_CLOCK: ClockState = {
  whiteMs: 0,
  blackMs: 0,
  running: null,
  turnStartedAt: 0,
  serverNow: 0,
  incrementMs: 0,
};

/** Remaining ms for `color` given a snapshot and the client's estimate of server time. */
export function remainingMs(clock: ClockState, color: Color, serverNowEstimate: number): number {
  const base = color === "W" ? clock.whiteMs : clock.blackMs;
  if (clock.running !== color) return Math.max(0, base);
  return Math.max(0, base - Math.max(0, serverNowEstimate - clock.turnStartedAt));
}

export type ServerErrorCode =
  | "name-taken"
  | "not-logged-in"
  | "invalid-payload"
  | "rate-limited"
  | "room-not-found"
  | "room-full"
  | "not-in-room"
  | "wrong-phase"
  | "game-in-progress"
  | "not-your-turn"
  | "illegal-move"
  | "busy";

export interface ServerErrorMessage {
  type: "error";
  code: ServerErrorCode;
  message: string;
  context?: Record<string, unknown>;
}

export type CallEndReason = "hangup" | "ice-failed" | "timeout" | "busy" | "peer-disconnected";

export interface PendingOffer {
  type: "draw" | "resign" | "rematch";
  from: string;
}

export interface ChatTailEntry {
  from: string;
  text: string;
  ts: number;
}

export const CLIENT_PING_INTERVAL_MS = 5_000;
export const CALL_REQUEST_TIMEOUT_MS = 40_000;
export const CALL_PEER_DISCONNECT_GRACE_MS = 5_000;
export const SIGNALLING_BUFFER_MS = 15_000;
export const SESSION_TTL_MS = 30 * 60_000;
export const MAX_WS_PAYLOAD_BYTES = 64 * 1024;

export function clockLimitTypeFor(gameTimeMinutes: number): "Blitz" | "Rapid" | "Classical" | "Untimed" {
  if (!gameTimeMinutes || gameTimeMinutes <= 0) return "Untimed";
  if (gameTimeMinutes <= 5) return "Blitz";
  if (gameTimeMinutes <= 15) return "Rapid";
  return "Classical";
}
