// Pure helpers for the WebRTC call hook: ICE configuration, SDP tuning,
// recovery timing, the offline signalling queue and the incoming-message
// gate. Nothing here touches the DOM so it is unit-testable in node.
import type { CallPhase } from "./callStateMachine";
import { isActiveCall, isIdleLike } from "./callStateMachine";

// Public STUN only. Short-lived, authenticated TURN credentials come from
// /api/media/ice; never embed a shared relay password in the browser bundle.
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

// --- Timing (ms) ---
/** Ring/setup budget, mirrors the server's CALL_REQUEST_TIMEOUT_MS. */
export const CALL_SETUP_DEADLINE_MS = 40_000;
/** How long "disconnected" may last before we start ICE restarts. */
export const DISCONNECTED_GRACE_MS = 5_000;
/** Total time we keep trying to recover a dropped connection. */
export const RECOVERY_DEADLINE_MS = 45_000;
/** Backoff between ICE restarts (attempt 1..4). */
export const RESTART_BACKOFF_MS: readonly number[] = [2_000, 4_000, 8_000, 16_000];
export const MAX_RESTART_ATTEMPTS = RESTART_BACKOFF_MS.length;

/** Delay before restart attempt `attempt` (1-based); null once exhausted. */
export function restartDelayMs(attempt: number): number | null {
  if (attempt < 1 || attempt > RESTART_BACKOFF_MS.length) return null;
  return RESTART_BACKOFF_MS[attempt - 1];
}

// --- Bitrate / device heuristics ---
export function isMobileUserAgent(ua: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(ua);
}

export function videoMaxBitrateFor(isMobile: boolean): number {
  return isMobile ? 600_000 : 1_200_000;
}

/** "relay" | "srflx" | "prflx" | "host" | "unknown" from an ICE candidate line. */
export function classifyCandidate(candidate: string | null | undefined): string {
  const m = /\styp\s+(\w+)/.exec(candidate || "");
  return m ? m[1] : "unknown";
}

/**
 * Opus fmtp tuning for real-time speech (DTX, in-band FEC, mono, 32 kbps).
 * setCodecPreferences can only ORDER codecs, so these parameters still go
 * through the SDP; the edit is limited to the opus fmtp line.
 */
export function optimizeOpusSdp(sdp: string): string {
  if (!sdp) return sdp;
  const opusMatch = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000/i);
  if (!opusMatch) return sdp;
  const pt = opusMatch[1];

  const fmtpRegex = new RegExp(`^a=fmtp:${pt}\\s+(.*)$`, "m");
  const desired = ["useinbandfec=1", "usedtx=1", "stereo=0", "sprop-stereo=0", "maxaveragebitrate=32000"];

  if (fmtpRegex.test(sdp)) {
    return sdp.replace(fmtpRegex, (_line, existingParams: string) => {
      const parts = existingParams.split(";").map((s) => s.trim()).filter(Boolean);
      for (const d of desired) {
        const key = d.split("=")[0];
        const idx = parts.findIndex((p) => p.startsWith(key + "="));
        if (idx >= 0) parts[idx] = d;
        else parts.push(d);
      }
      return `a=fmtp:${pt} ${parts.join(";")}`;
    });
  }
  return sdp.replace(
    new RegExp(`(a=rtpmap:${pt}\\s+opus\\/48000[^\\r\\n]*\\r?\\n)`, "i"),
    `$1a=fmtp:${pt} ${desired.join(";")}\r\n`
  );
}

// --- Offline signalling queue (WebSocket reconnect window) ---
export class SignalQueue<T> {
  private items: { msg: T; ts: number }[] = [];

  constructor(private readonly ttlMs: number) {}

  push(msg: T, now: number): void {
    this.items.push({ msg, ts: now });
  }

  /** Returns every message still within the TTL (in order) and empties the queue. */
  drain(now: number): T[] {
    const live = this.items.filter((i) => now - i.ts <= this.ttlMs).map((i) => i.msg);
    this.items = [];
    return live;
  }

  /** Drops expired messages without sending anything; returns how many were dropped. */
  prune(now: number): number {
    const before = this.items.length;
    this.items = this.items.filter((i) => now - i.ts <= this.ttlMs);
    return before - this.items.length;
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}

// --- Message names ---
export type SignalKind =
  | "request"
  | "accept"
  | "decline"
  | "cancel"
  | "offer"
  | "answer"
  | "ice"
  | "end"
  | "busy";

const VIDEO_NAMES: Record<SignalKind, string> = {
  request: "call-request",
  accept: "call-accept",
  decline: "call-decline",
  cancel: "call-cancel",
  offer: "call-offer",
  answer: "call-answer",
  ice: "call-ice-candidate",
  end: "call-end",
  busy: "call-busy",
};

const VOICE_NAMES: Record<SignalKind, string> = {
  request: "voice-call-request",
  accept: "voice-call-accept",
  decline: "voice-call-decline",
  cancel: "voice-call-cancel",
  offer: "voice-offer",
  answer: "voice-answer",
  ice: "voice-ice-candidate",
  end: "voice-leave",
  busy: "voice-call-busy",
};

export function signalName(kind: SignalKind, callType: "voice" | "video"): string {
  return callType === "voice" ? VOICE_NAMES[kind] : VIDEO_NAMES[kind];
}

/** Maps either prefix ("call-*" / "voice-*") back to a SignalKind. */
export function signalKindOf(type: string): SignalKind | null {
  for (const kind of Object.keys(VIDEO_NAMES) as SignalKind[]) {
    if (VIDEO_NAMES[kind] === type || VOICE_NAMES[kind] === type) return kind;
  }
  return null;
}

/** Messages the server itself may originate (no `from` of a peer). */
const SERVER_ORIGINATED = new Set(["call-unavailable", "call-busy", "voice-call-busy"]);

export type IncomingGate = "handle" | "ignore" | "busy";

/**
 * Decide what to do with an incoming call message before looking at it:
 *  - a request while idle is handled;
 *  - a request from a third party during a call gets a busy reply;
 *  - a request from the current peer while we are calling them is the
 *    mutual-call case and is handled (tie-break happens later);
 *  - everything else must come from the current peer or be ignored.
 */
export function gateIncomingCallMessage(args: {
  type: string;
  from?: string | null;
  state: CallPhase;
  peer: string | null;
}): IncomingGate {
  const { type, from, state, peer } = args;
  const kind = signalKindOf(type);

  if (kind === "request") {
    if (isIdleLike(state)) return "handle";
    if (from && peer && from === peer) return state === "calling" ? "handle" : "ignore";
    return "busy";
  }

  if (!isActiveCall(state)) return "ignore";
  if (SERVER_ORIGINATED.has(type) && !from) return "handle";
  if (!peer || !from) return "ignore";
  return from === peer ? "handle" : "ignore";
}
