// Pure call state machine for the voice/video call hook (useWebRTCCall).
// No browser APIs here so it can be unit-tested in node.
//
//   caller: idle -> calling -> connecting -> connected -> idle
//   callee: idle -> ringing -> connecting -> connected -> idle
//
// "connected" may bounce through "reconnecting" while ICE recovers. The
// display-only terminal states ("ended", "failed", "failed-network",
// "unsupported") behave like "idle" for the purpose of starting or
// receiving a new call.

export type CallPhase =
  | "idle"
  | "calling"
  | "ringing"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed"
  | "failed-network"
  | "unsupported"
  | "ended";

export type CallRole = "caller" | "callee";

/** States in which no call is in progress and a new one may start. */
export const IDLE_LIKE_STATES: readonly CallPhase[] = ["idle", "ended", "failed", "failed-network", "unsupported"];

/** States in which a call is in progress (signalling or media). */
export const ACTIVE_STATES: readonly CallPhase[] = ["calling", "ringing", "connecting", "connected", "reconnecting"];

const IDLE_EXITS: readonly CallPhase[] = ["idle", "calling", "ringing", "unsupported"];

const TRANSITIONS: Record<CallPhase, readonly CallPhase[]> = {
  idle: ["calling", "ringing", "unsupported"],
  ended: IDLE_EXITS,
  failed: IDLE_EXITS,
  "failed-network": IDLE_EXITS,
  // Only a support re-check can leave "unsupported".
  unsupported: ["idle"],
  // The caller side. "calling" -> "connecting" also covers the mutual-call
  // tie-break where the outgoing caller becomes the callee.
  calling: ["connecting", "idle", "ended", "failed", "failed-network"],
  ringing: ["connecting", "idle", "ended", "failed"],
  connecting: ["connected", "idle", "ended", "failed", "failed-network"],
  connected: ["reconnecting", "idle", "ended", "failed", "failed-network"],
  reconnecting: ["connected", "idle", "ended", "failed", "failed-network"],
};

export function isIdleLike(state: CallPhase): boolean {
  return IDLE_LIKE_STATES.includes(state);
}

export function isActiveCall(state: CallPhase): boolean {
  return ACTIVE_STATES.includes(state);
}

/** True once a PeerConnection exists (media phase), i.e. after accept. */
export function isMediaPhase(state: CallPhase): boolean {
  return state === "connecting" || state === "connected" || state === "reconnecting";
}

export function canTransition(from: CallPhase, to: CallPhase): boolean {
  if (from === to) return false;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export interface TransitionResult {
  ok: boolean;
  from: CallPhase;
  to: CallPhase;
  /** Present only when `ok` is false. */
  error?: string;
}

/** Validate a move; the hook only mutates its state through this. */
export function transition(from: CallPhase, to: CallPhase): TransitionResult {
  if (canTransition(from, to)) return { ok: true, from, to };
  return {
    ok: false,
    from,
    to,
    error: from === to ? `already in '${from}'` : `illegal transition '${from}' -> '${to}'`,
  };
}

export type ExitSignal = "cancel" | "decline" | "end";

/**
 * Which signalling message a LOCALLY initiated exit must send from a
 * given state (exactly one per call). Idle-like states send nothing.
 */
export function exitSignalFor(state: CallPhase): ExitSignal | null {
  switch (state) {
    case "calling":
      return "cancel";
    case "ringing":
      return "decline";
    case "connecting":
    case "connected":
    case "reconnecting":
      return "end";
    default:
      return null;
  }
}

/**
 * Mutual-call tie-break: when both players press "call" at the same time,
 * the lexicographically lower username stays the caller and the other one
 * auto-accepts. Deterministic on both ends without a round trip.
 */
export function resolveGlareRole(me: string, peer: string): CallRole {
  return me < peer ? "caller" : "callee";
}

/**
 * Where the machine lands after a call ends. Network-caused endings show the
 * "Couldn't Connect" surface; everything else returns to plain idle.
 */
export function terminalStateFor(reason: string): CallPhase {
  return reason === "ice-failed" || reason === "timeout" ? "failed-network" : "idle";
}
