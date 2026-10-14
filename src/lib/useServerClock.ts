// Server-authoritative clock helpers (docs/ONLINE_PLAY_PROTOCOL.md section 4).
//
// The client never counts time itself: it keeps the last `ClockState`
// snapshot plus the server-time offset measured when that snapshot arrived,
// and every display derives "remaining" from those two numbers and the
// wall clock. Nothing at the App level ticks; the small components that
// show a time tick themselves via `useClockTicker` and only re-render when
// the displayed second changes.
//
// The same snapshot shape is reused for LOCAL timed games (vs Ken,
// tournament rounds) with offset 0, so one display path serves both.

import { useEffect, useReducer, useRef } from "react";
import { ClockState, Color, remainingMs, UNTIMED_CLOCK } from "../shared/protocol";

export interface ClockSnapshot {
  clock: ClockState;
  /** `serverNow - Date.now()` measured when the snapshot was received. */
  offset: number;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Coerce whatever the wire gave us into a well-formed ClockState. */
export function normalizeClock(raw: Partial<ClockState> | null | undefined): ClockState {
  if (!raw || typeof raw !== "object") return { ...UNTIMED_CLOCK };
  const running = raw.running === "W" || raw.running === "B" ? raw.running : null;
  return {
    whiteMs: Math.max(0, num(raw.whiteMs)),
    blackMs: Math.max(0, num(raw.blackMs)),
    running,
    turnStartedAt: num(raw.turnStartedAt),
    serverNow: num(raw.serverNow),
    incrementMs: Math.max(0, num(raw.incrementMs)),
  };
}

/** Build a snapshot from a server `clock` payload received at `receivedAt` (local ms). */
export function makeClockSnapshot(raw: Partial<ClockState> | null | undefined, receivedAt: number = Date.now()): ClockSnapshot {
  const clock = normalizeClock(raw);
  const offset = clock.serverNow > 0 ? clock.serverNow - receivedAt : 0;
  return { clock, offset };
}

/** Same snapshot with a refined offset (e.g. from a pong). */
export function withOffset(snap: ClockSnapshot, offset: number): ClockSnapshot {
  if (!Number.isFinite(offset) || snap.offset === offset) return snap;
  return { clock: snap.clock, offset };
}

/** Remaining ms for `color` right now (or at `now`). Never negative. */
export function clockRemainingMs(snap: ClockSnapshot | null | undefined, color: Color, now: number = Date.now()): number {
  if (!snap) return 0;
  return remainingMs(snap.clock, color, now + snap.offset);
}

/** Whole seconds for display -- rounds UP so "0:01" is shown until the flag. */
export function msToDisplaySeconds(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000));
}

export function formatClockMs(ms: number): string {
  const total = msToDisplaySeconds(ms);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs < 10 ? `0${secs}` : secs}`;
}

export function isUntimedClock(snap: ClockSnapshot | null | undefined): boolean {
  if (!snap) return true;
  const c = snap.clock;
  return c.running === null && c.whiteMs === 0 && c.blackMs === 0 && c.incrementMs === 0 && c.turnStartedAt === 0;
}

// ---------------------------------------------------------------- local games

/** A fresh local (client-owned) clock. `running` starts the given side's count. */
export function createLocalClock(perSideMs: number, running: Color | null, incrementMs: number, now: number = Date.now()): ClockSnapshot {
  return {
    clock: {
      whiteMs: Math.max(0, perSideMs),
      blackMs: Math.max(0, perSideMs),
      running,
      turnStartedAt: now,
      serverNow: now,
      incrementMs: Math.max(0, incrementMs),
    },
    offset: 0,
  };
}

/** Local move by `mover`: deduct elapsed, add the increment, hand the clock to the other side. */
export function advanceLocalClock(snap: ClockSnapshot, mover: Color, now: number = Date.now()): ClockSnapshot {
  const c = snap.clock;
  const elapsed = c.running === mover ? Math.max(0, now + snap.offset - c.turnStartedAt) : 0;
  const base = mover === "W" ? c.whiteMs : c.blackMs;
  const next = Math.max(0, base - elapsed) + c.incrementMs;
  const other: Color = mover === "W" ? "B" : "W";
  return {
    offset: snap.offset,
    clock: {
      ...c,
      whiteMs: mover === "W" ? next : c.whiteMs,
      blackMs: mover === "B" ? next : c.blackMs,
      running: other,
      turnStartedAt: now + snap.offset,
      serverNow: now + snap.offset,
    },
  };
}

/** Stop the clock, keeping whatever is left on both sides. */
export function freezeClock(snap: ClockSnapshot, now: number = Date.now()): ClockSnapshot {
  if (snap.clock.running === null) return snap;
  return {
    offset: snap.offset,
    clock: {
      ...snap.clock,
      whiteMs: clockRemainingMs(snap, "W", now),
      blackMs: clockRemainingMs(snap, "B", now),
      running: null,
      turnStartedAt: now + snap.offset,
      serverNow: now + snap.offset,
    },
  };
}

/** Resume a frozen local clock for `running`. */
export function resumeLocalClock(snap: ClockSnapshot, running: Color, now: number = Date.now()): ClockSnapshot {
  return {
    offset: snap.offset,
    clock: { ...snap.clock, running, turnStartedAt: now + snap.offset, serverNow: now + snap.offset },
  };
}

/** Freeze with `color` at zero -- the local flag. */
export function flagLocalClock(snap: ClockSnapshot, color: Color, now: number = Date.now()): ClockSnapshot {
  const frozen = freezeClock(snap, now);
  return {
    offset: frozen.offset,
    clock: {
      ...frozen.clock,
      whiteMs: color === "W" ? 0 : frozen.clock.whiteMs,
      blackMs: color === "B" ? 0 : frozen.clock.blackMs,
    },
  };
}

// ---------------------------------------------------------------------- hooks

export interface ClockReading {
  whiteMs: number;
  blackMs: number;
  whiteSec: number;
  blackSec: number;
  running: Color | null;
}

function readingKey(snap: ClockSnapshot | null | undefined, now: number): string {
  if (!snap) return "-";
  return `${msToDisplaySeconds(clockRemainingMs(snap, "W", now))}:${msToDisplaySeconds(clockRemainingMs(snap, "B", now))}`;
}

/**
 * Ticks a snapshot. Re-renders the CALLING component only when a displayed
 * second changes and only while a side is actually running, so a memoized
 * clock component costs at most one render per second.
 */
export function useClockTicker(snap: ClockSnapshot | null | undefined, intervalMs: number = 250): ClockReading {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const lastKeyRef = useRef<string>("");

  useEffect(() => {
    lastKeyRef.current = readingKey(snap, Date.now());
    if (!snap || snap.clock.running === null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const remaining = clockRemainingMs(snap, snap.clock.running as Color);
      if (remaining <= 0) return;
      // Wake just after the NEXT visible second changes. This replaces four
      // 250ms wake-ups per second (per clock) with ~one; no extra App renders.
      // The 15ms margin avoids waking just before a display boundary.
      const toBoundary = remaining % 1000 || 1000;
      const delay = Math.max(30, Math.min(1015, Math.ceil(toBoundary) + 15));
      timer = setTimeout(tick, delay);
    };
    const tick = () => {
      timer = null;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      const key = readingKey(snap, now);
      if (key !== lastKeyRef.current) {
        lastKeyRef.current = key;
        force();
      }
      schedule();
    };
    const onVisible = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') tick();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [snap, intervalMs]);

  const now = Date.now();
  const whiteMs = clockRemainingMs(snap, "W", now);
  const blackMs = clockRemainingMs(snap, "B", now);
  return {
    whiteMs,
    blackMs,
    whiteSec: msToDisplaySeconds(whiteMs),
    blackSec: msToDisplaySeconds(blackMs),
    running: snap ? snap.clock.running : null,
  };
}

/**
 * Fires `onFlag(color)` once when the running side of a LOCAL clock reaches
 * zero. One timeout per snapshot -- no per-second state anywhere.
 * Pass `null` to disable (multiplayer clocks are flagged by the server).
 */
export function useClockDeadline(snap: ClockSnapshot | null | undefined, onFlag: ((color: Color) => void) | null): void {
  const onFlagRef = useRef(onFlag);
  useEffect(() => {
    onFlagRef.current = onFlag;
  }, [onFlag]);

  useEffect(() => {
    if (!snap || !onFlag || snap.clock.running === null) return;
    const running = snap.clock.running;
    const remaining = clockRemainingMs(snap, running, Date.now());
    const id = setTimeout(() => {
      onFlagRef.current?.(running);
    }, Math.max(0, remaining) + 20);
    return () => clearTimeout(id);
    // onFlag identity changes are absorbed by the ref above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, onFlag === null]);
}
