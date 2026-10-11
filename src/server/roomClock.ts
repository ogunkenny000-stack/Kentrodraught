// Server-authoritative game clock for one online room (protocol §4).
//
// The clock is a tiny value object: banked ms per side, whose side is
// running (null = paused), and when the running side's turn started. Every
// mutation goes through the functions below so elapsed time is always
// deducted exactly once and never trusted from a client.
import { UNTIMED_CLOCK, type ClockState, type Color } from "../shared/protocol";

export interface RoomClock {
  timed: boolean;
  whiteMs: number;
  blackMs: number;
  running: Color | null;
  turnStartedAt: number;
  incrementMs: number;
}

export function createClock(whiteMs: number, blackMs: number, incrementMs: number, timed: boolean): RoomClock {
  return {
    timed,
    whiteMs: timed ? Math.max(0, Math.round(whiteMs)) : 0,
    blackMs: timed ? Math.max(0, Math.round(blackMs)) : 0,
    running: null,
    turnStartedAt: 0,
    incrementMs: timed ? Math.max(0, Math.round(incrementMs)) : 0,
  };
}

export function untimedClock(): RoomClock {
  return createClock(0, 0, 0, false);
}

/** Exact remaining ms for `color` right now (accounts for a running clock). */
export function remainingMs(c: RoomClock, color: Color, now: number): number {
  const base = color === "W" ? c.whiteMs : c.blackMs;
  if (c.running !== color) return Math.max(0, base);
  return Math.max(0, base - Math.max(0, now - c.turnStartedAt));
}

/** Bank the running side's elapsed time and stop the clock. No-op if paused. */
export function pauseClock(c: RoomClock, now: number): void {
  if (!c.running) return;
  const rem = remainingMs(c, c.running, now);
  if (c.running === "W") c.whiteMs = rem;
  else c.blackMs = rem;
  c.running = null;
}

/** Start `color`'s clock ticking from now. */
export function resumeClock(c: RoomClock, color: Color, now: number): void {
  if (!c.timed || c.running === color) return;
  if (c.running && c.running !== color) pauseClock(c, now);
  c.running = color;
  c.turnStartedAt = now;
}

/**
 * The side `mover` just moved: deduct what they used (if their clock was
 * running), add the increment, and leave the clock PAUSED -- the caller
 * decides whether the next side's clock may run (setup, dialogs and
 * disconnects all keep it paused) via resumeClock.
 */
export function applyMoveToClock(c: RoomClock, mover: Color, now: number): void {
  if (!c.timed) return;
  if (c.running === mover) pauseClock(c, now);
  else if (c.running) pauseClock(c, now); // defensive: never lose elapsed time
  if (mover === "W") c.whiteMs = Math.max(0, c.whiteMs + c.incrementMs);
  else c.blackMs = Math.max(0, c.blackMs + c.incrementMs);
}

export function clockSnapshot(c: RoomClock, now: number): ClockState {
  if (!c.timed) return { ...UNTIMED_CLOCK, serverNow: now };
  return {
    whiteMs: Math.max(0, Math.round(c.whiteMs)),
    blackMs: Math.max(0, Math.round(c.blackMs)),
    running: c.running,
    turnStartedAt: c.running ? c.turnStartedAt : now,
    serverNow: now,
    incrementMs: c.incrementMs,
  };
}

/** Legacy whole-seconds view used by gameState.whiteTime/blackTime. */
export function legacySeconds(c: RoomClock, color: Color, now: number): number {
  if (!c.timed) return 0;
  return Math.ceil(remainingMs(c, color, now) / 1000);
}
