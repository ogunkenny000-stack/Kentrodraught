import { supabase } from "../supabase";
// Voice / video call hook (WebRTC) for Nigerian Draughts.
//
// Design:
//  - One stable controller (created once per mount) owns every mutable piece
//    of call state in plain closure variables/refs. React state is a mirror
//    for rendering only, so toggling unrelated props (app sound, toast
//    callback, socket object) can never tear the call down.
//  - A strict state machine (src/lib/callStateMachine.ts):
//      caller: idle -> calling -> connecting -> connected -> idle
//      callee: idle -> ringing -> connecting -> connected -> idle
//    plus connected <-> reconnecting while ICE recovers.
//  - "Perfect negotiation" (callee = polite, caller = impolite) with
//    pre-created transceivers, so either side can renegotiate: camera on/off,
//    screen share and ICE restarts are replaceTrack + direction changes.
//  - Raw getUserMedia tracks are sent (no Web Audio pipelines) and the raw
//    remote stream is played by the <audio> element in FloatingVideoCall.
//  - Every locally initiated exit sends exactly ONE signalling message
//    (call-cancel / call-decline / call-end { to, reason }).
//  - Signalling that cannot be sent while the WebSocket reconnects is queued
//    for up to 15 s (the server buffers the other direction).
import { useState, useRef, useEffect, useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  startVoiceRingtone,
  startVoiceRingback,
  playCallConnectedChime,
  playCallEndedChime,
  getAudioContext,
} from "./audio";
import type { CallEndReason } from "../shared/protocol";
import { CALL_REQUEST_TIMEOUT_MS, SIGNALLING_BUFFER_MS } from "../shared/protocol";
import {
  type CallPhase,
  type CallRole,
  type ExitSignal,
  transition,
  isIdleLike,
  isActiveCall,
  isMediaPhase,
  exitSignalFor,
  resolveGlareRole,
} from "./callStateMachine";
import {
  ICE_SERVERS,
  CALL_SETUP_DEADLINE_MS,
  DISCONNECTED_GRACE_MS,
  RECOVERY_DEADLINE_MS,
  MAX_RESTART_ATTEMPTS,
  restartDelayMs,
  isMobileUserAgent,
  videoMaxBitrateFor,
  classifyCandidate,
  optimizeOpusSdp,
  SignalQueue,
  signalName,
  signalKindOf,
  gateIncomingCallMessage,
  type SignalKind,
} from "./callSignalling";

// ---------------------------------------------------------------------------
// Public types (kept backward compatible; new values/fields are additive)
// ---------------------------------------------------------------------------

export type CallState = CallPhase;
export type CallType = "video" | "voice";

export type NetworkQualityLevel = "excellent" | "good" | "fair" | "poor" | "disconnected" | "checking";

export interface NetworkQualityStats {
  iceState: RTCIceConnectionState | "unknown";
  rttMs: number | null;
  level: NetworkQualityLevel;
  candidateType?: string;
  packetLossPercent?: number | null;
  jitterMs?: number | null;
  packetsLost?: number;
  resolution?: string | null;
}

export interface CallReactionItem {
  id: string;
  emoji: string;
  fromMe: boolean;
  createdAt: number;
}

export interface IncomingCallInfo {
  from: string;
  callType: CallType;
}

export type CallFailureReason = CallEndReason | "no-media" | "unsupported" | "declined" | "unavailable";

/** Why the last call ended abnormally; drives the "Couldn't Connect" surface. */
export interface CallFailureInfo {
  reason: CallFailureReason;
  message: string;
  /** True when no TURN relay candidate was ever seen: retrying audio-only is worth a shot. */
  suggestAudioOnly: boolean;
}

/** The minimal socket surface the hook needs (a real WebSocket satisfies it). */
export interface SignalingSocketLike {
  readonly readyState: number;
  send(data: string): void;
}

export const UNSUPPORTED_CALLS_MESSAGE =
  "Voice and video calls need a modern browser (Chrome, Safari or Firefox) and a secure https:// connection.";

const WS_OPEN = 1;

const INITIAL_QUALITY: NetworkQualityStats = { iceState: "new", rttMs: null, level: "checking" };

// High-fidelity voice constraints: hardware/software echo cancellation,
// noise suppression, auto gain, mono. These replace the old Web Audio DSP.
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

function videoConstraints(facing: "user" | "environment"): MediaTrackConstraints {
  return {
    facingMode: facing,
    width: { ideal: 640, max: 1280 },
    height: { ideal: 480, max: 720 },
    frameRate: { ideal: 24, max: 30 },
  };
}

function detectCallSupport(): boolean {
  if (typeof window === "undefined") return false;
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  return typeof RTCPeerConnection !== "undefined" && !!md && typeof md.getUserMedia === "function";
}

// Structured WebRTC logger with call-type tags (kept from the previous version).
function logWebRTC(
  category: "StateMachine" | "Signaling" | "ICE" | "PeerConnection" | "Media",
  callType: CallType,
  message: string,
  details?: unknown
) {
  const ts = new Date().toISOString().substring(11, 23);
  const tag = callType === "voice" ? "[Voice Call]" : "[Video Call]";
  const prefix = `[WebRTC::${category} @ ${ts}] ${tag}`;
  if (details !== undefined) console.log(prefix, message, details);
  else console.log(prefix, message);
}

function stopTrack(t: MediaStreamTrack | null | undefined) {
  if (!t) return;
  try {
    t.onended = null;
    t.stop();
  } catch {}
}

function stopStream(s: MediaStream | null | undefined) {
  if (!s) return;
  s.getTracks().forEach(stopTrack);
}

function vibrate(pattern: number | number[]) {
  try {
    (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate?.(pattern);
  } catch {}
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

interface ControllerSetters {
  callState: Dispatch<SetStateAction<CallState>>;
  callType: Dispatch<SetStateAction<CallType>>;
  incomingCall: Dispatch<SetStateAction<IncomingCallInfo | null>>;
  opponentName: Dispatch<SetStateAction<string>>;
  localStream: Dispatch<SetStateAction<MediaStream | null>>;
  remoteStream: Dispatch<SetStateAction<MediaStream | null>>;
  isMicMuted: Dispatch<SetStateAction<boolean>>;
  isVideoMuted: Dispatch<SetStateAction<boolean>>;
  isRemoteVideoEnabled: Dispatch<SetStateAction<boolean>>;
  isRemoteAudioEnabled: Dispatch<SetStateAction<boolean>>;
  facingMode: Dispatch<SetStateAction<"user" | "environment">>;
  callDuration: Dispatch<SetStateAction<number>>;
  networkQuality: Dispatch<SetStateAction<NetworkQualityStats>>;
  isReconnecting: Dispatch<SetStateAction<boolean>>;
  renegotiationAttempt: Dispatch<SetStateAction<number>>;
  isScreenSharing: Dispatch<SetStateAction<boolean>>;
  isRemoteScreenSharing: Dispatch<SetStateAction<boolean>>;
  localScreenStream?: Dispatch<SetStateAction<MediaStream | null>>;
  remoteScreenStream?: Dispatch<SetStateAction<MediaStream | null>>;
  failureInfo: Dispatch<SetStateAction<CallFailureInfo | null>>;
}

interface ControllerDeps {
  wsRef: MutableRefObject<SignalingSocketLike | null>;
  userRef: MutableRefObject<string | null>;
  mutedRef: MutableRefObject<boolean>;
  toastRef: MutableRefObject<((msg: string) => void) | undefined>;
  set: ControllerSetters;
}

interface Controller {
  startCall(target: string, type: CallType): Promise<void>;
  acceptCall(type?: CallType): Promise<void>;
  declineCall(): void;
  cancelCall(): void;
  endCall(): void;
  toggleMic(): void;
  toggleVideo(): Promise<void>;
  flipCamera(): Promise<void>;
  toggleScreenShare(): Promise<void>;
  handleMessage(data: unknown): Promise<void>;
  flushQueue(): void;
  hangupSilently(): void;
  dispose(): void;
}

type TimerName = "ring" | "setup" | "disconnect" | "restart" | "recovery" | "duration" | "stats" | "queue";

interface TerminateOptions {
  /** "auto" picks cancel/decline/end from the current state; "none" sends nothing (remote-initiated). */
  exit: "auto" | "none" | ExitSignal;
  reason: CallFailureReason;
  next?: CallPhase;
  toast?: string;
  failure?: { message: string; suggestAudioOnly: boolean };
}

export function createCallController(deps: ControllerDeps): Controller {
  const { wsRef, userRef, mutedRef, toastRef, set } = deps;
  const supported = detectCallSupport();
  const isMobile = typeof navigator !== "undefined" && isMobileUserAgent(navigator.userAgent || "");

  // ---- session state (single source of truth) ----
  let state: CallPhase = supported ? "idle" : "unsupported";
  let role: CallRole | null = null;
  let polite = false; // callee is polite in perfect negotiation
  let peer: string | null = null;
  let callType: CallType = "video";
  let iceServers = ICE_SERVERS;
  let callSeq = 0; // bumps on every new call; async continuations check it

  let pc: RTCPeerConnection | null = null;
  let audioTx: RTCRtpTransceiver | null = null;
  let videoTx: RTCRtpTransceiver | null = null;
  const codecPrefsApplied = new WeakSet<RTCRtpTransceiver>();

  let localStream: MediaStream | null = null;
  let cameraTrack: MediaStreamTrack | null = null;
  let screenTrack: MediaStreamTrack | null = null;
  let remoteStream: MediaStream | null = null;
  let remotePublishPending = false;

  let makingOffer = false;
  let ignoreOffer = false;
  let everNegotiated = false;
  let pendingCandidates: RTCIceCandidateInit[] = [];

  let exitSent = false;
  let micMuted = false;
  let videoMuted = false;
  let facing: "user" | "environment" = "user";
  let sawRelay = false;
  let everConnected = false;
  let restartAttempt = 0;
  let recoveryStartedAt: number | null = null;

  let stopRingback: (() => void) | null = null;
  let stopRingtone: (() => void) | null = null;

  const timers: Record<TimerName, ReturnType<typeof setTimeout> | null> = {
    ring: null,
    setup: null,
    disconnect: null,
    restart: null,
    recovery: null,
    duration: null,
    stats: null,
    queue: null,
  };
  const queue = new SignalQueue<Record<string, unknown>>(SIGNALLING_BUFFER_MS);

  // ---- small helpers ----
  const log = (
    category: "StateMachine" | "Signaling" | "ICE" | "PeerConnection" | "Media",
    message: string,
    details?: unknown
  ) => logWebRTC(category, callType, message, details);

  const toast = (msg: string) => {
    try {
      toastRef.current?.(msg);
    } catch {}
  };

  const clearTimer = (name: TimerName) => {
    const t = timers[name];
    if (t) {
      clearTimeout(t);
      clearInterval(t);
      timers[name] = null;
    }
  };

  const clearCallTimers = () => {
    (["ring", "setup", "disconnect", "restart", "recovery", "duration", "stats"] as TimerName[]).forEach(clearTimer);
  };

  const msgName = (kind: SignalKind) => signalName(kind, callType);

  const typeLabel = () => (callType === "voice" ? "Voice" : "Video");

  // Read the phase through a function after `await`s: TypeScript otherwise
  // keeps the narrowing from an earlier guard even though setState() mutated it.
  const phase = (): CallPhase => state;

  const unlockAudio = () => {
    // Called from click handlers only: resumes the app's shared AudioContext
    // (ringtones, chimes, level meters) inside a user gesture for iOS.
    try {
      getAudioContext();
    } catch {}
  };

  const setState = (next: CallPhase): boolean => {
    const r = transition(state, next);
    if (!r.ok) {
      log("StateMachine", `Transition rejected: ${r.error}`);
      return false;
    }
    log("StateMachine", `${state} -> ${next}`);
    state = next;
    set.callState(next);
    return true;
  };

  const isPcConnected = (conn: RTCPeerConnection) => {
    if (typeof conn.connectionState === "string") return conn.connectionState === "connected";
    const ice = conn.iceConnectionState;
    return ice === "connected" || ice === "completed";
  };

  // ---- signalling transport with an offline queue ----
  const socketOpen = () => {
    const s = wsRef.current;
    return !!s && s.readyState === WS_OPEN;
  };

  const sendRaw = (msg: Record<string, unknown>): boolean => {
    const s = wsRef.current;
    if (!s || s.readyState !== WS_OPEN) return false;
    try {
      s.send(JSON.stringify(msg));
      return true;
    } catch (e) {
      log("Signaling", `send failed for ${String(msg.type)}`, e);
      return false;
    }
  };

  const flushQueue = () => {
    queue.prune(Date.now());
    if (queue.size === 0) {
      clearTimer("queue");
      return;
    }
    if (!socketOpen()) return;
    const msgs = queue.drain(Date.now());
    log("Signaling", `Flushing ${msgs.length} queued signalling message(s)`);
    for (const m of msgs) {
      if (!sendRaw(m)) queue.push(m, Date.now());
    }
    if (queue.size === 0) clearTimer("queue");
  };

  const sendSignaling = (payload: Record<string, unknown>) => {
    const msg: Record<string, unknown> = {
      ...payload,
      callType: payload.callType ?? callType,
      to: payload.to ?? peer ?? undefined,
      from: userRef.current ?? undefined,
    };
    if (!msg.to) {
      log("Signaling", `Dropping ${String(payload.type)}: no peer`);
      return;
    }
    if (sendRaw(msg)) {
      log("Signaling", `-> ${String(payload.type)} to @${String(msg.to)}`, {
        reason: payload.reason,
        isRenegotiation: payload.isRenegotiation,
      });
      return;
    }
    queue.push(msg, Date.now());
    if (!timers.queue) timers.queue = setInterval(flushQueue, 500);
    log("Signaling", `Socket not open; queued ${String(payload.type)} (${queue.size} waiting, 15 s TTL)`);
  };

  // ---- call bookkeeping ----
  const beginCall = (target: string, type: CallType, myRole: CallRole) => {
    callSeq += 1;
    peer = target;
    role = myRole;
    polite = myRole === "callee";
    callType = type;
    set.callType(type);
    set.opponentName(target);
    exitSent = false;
    everConnected = false;
    everNegotiated = false;
    sawRelay = false;
    restartAttempt = 0;
    recoveryStartedAt = null;
    makingOffer = false;
    ignoreOffer = false;
    pendingCandidates = [];
    micMuted = false;
    videoMuted = false;
    set.failureInfo(null);
    set.isReconnecting(false);
    set.renegotiationAttempt(0);
  };

  const teardown = () => {
    callSeq += 1; // Invalidate permission prompts and renegotiations on every exit.
    clearCallTimers();
    if (stopRingback) {
      stopRingback();
      stopRingback = null;
    }
    if (stopRingtone) {
      stopRingtone();
      stopRingtone = null;
    }
    if (pc) {
      const conn = pc;
      pc = null;
      conn.onicecandidate = null;
      conn.ontrack = null;
      conn.onnegotiationneeded = null;
      conn.onconnectionstatechange = null;
      conn.oniceconnectionstatechange = null;
      conn.onsignalingstatechange = null;
      conn.onicegatheringstatechange = null;
      conn.onicecandidateerror = null;
      try {
        conn.close();
      } catch {}
    }
    audioTx = null;
    videoTx = null;
    stopTrack(screenTrack);
    screenTrack = null;
    stopTrack(cameraTrack);
    cameraTrack = null;
    stopStream(localStream);
    localStream = null;
    stopStream(remoteStream);
    remoteStream = null;
    pendingCandidates = [];
    makingOffer = false;
    ignoreOffer = false;

    set.localStream(null);
    set.remoteStream(null);
    set.localScreenStream?.(null);
    set.remoteScreenStream?.(null);
    set.incomingCall(null);
    set.callDuration(0);
    set.isMicMuted(false);
    set.isVideoMuted(false);
    set.isRemoteVideoEnabled(true);
    set.isRemoteAudioEnabled(true);
    set.isScreenSharing(false);
    set.isRemoteScreenSharing(false);
    set.isReconnecting(false);
    set.renegotiationAttempt(0);
    set.networkQuality(INITIAL_QUALITY);
  };

  /** The one and only exit path. Sends at most one signalling message per call. */
  const terminate = (opts: TerminateOptions) => {
    if (isIdleLike(state)) {
      teardown();
      return;
    }
    const peerName = peer;
    const wasConnected = everConnected;
    const sig: ExitSignal | null =
      opts.exit === "auto" ? exitSignalFor(state) : opts.exit === "none" ? null : opts.exit;

    if (sig && !exitSent && peerName) {
      exitSent = true;
      const kind: SignalKind = sig === "end" ? "end" : sig === "cancel" ? "cancel" : "decline";
      sendSignaling({ type: msgName(kind), to: peerName, reason: opts.reason });
    } else if (opts.exit !== "none") {
      exitSent = true;
    }
    log("StateMachine", `Ending call (${opts.reason}) from '${state}' -> '${opts.next ?? "idle"}'`);

    teardown();
    const next = opts.next ?? "idle";
    if (!setState(next) && next !== "idle") setState("idle");
    if (wasConnected) playCallEndedChime(mutedRef.current);
    if (opts.failure) {
      set.failureInfo({ reason: opts.reason, message: opts.failure.message, suggestAudioOnly: opts.failure.suggestAudioOnly });
    }
    if (opts.toast) toast(opts.toast);
    peer = null;
    role = null;
  };

  // ---- media ----
  const acquireMedia = async (type: CallType): Promise<MediaStream | null> => {
    const generation = callSeq;
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch('/api/media/ice', { signal: AbortSignal.timeout(3000), headers: data.session ? { 'x-access-token': data.session.access_token } : {} });
      const config = response.ok ? await response.json() : null;
      if (generation === callSeq) iceServers = Array.isArray(config?.iceServers) && config.iceServers.length <= 8 ? config.iceServers : ICE_SERVERS;
    } catch { if (generation === callSeq) iceServers = ICE_SERVERS; }
    if (generation !== callSeq) return null;

    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md || typeof md.getUserMedia !== "function") {
      toast(UNSUPPORTED_CALLS_MESSAGE);
      return null;
    }
    const tryGet = async (c: MediaStreamConstraints): Promise<MediaStream | null> => {
      try {
        if (generation !== callSeq) return null;
        const stream = await md.getUserMedia(c);
        if (generation !== callSeq) { stopStream(stream); return null; }
        return stream;
      } catch (e) {
        log("Media", "getUserMedia failed", { constraints: c, error: (e as { name?: string })?.name ?? String(e) });
        return null;
      }
    };

    let stream: MediaStream | null = null;
    if (type === "video") {
      stream =
        (await tryGet({ audio: AUDIO_CONSTRAINTS, video: videoConstraints(facing) })) ??
        (await tryGet({ audio: AUDIO_CONSTRAINTS, video: true }));
      if (!stream) {
        stream =
          (await tryGet({ audio: AUDIO_CONSTRAINTS, video: false })) ?? (await tryGet({ audio: true, video: false }));
        if (stream) toast("Camera unavailable — continuing with audio only.");
      }
    } else {
      stream =
        (await tryGet({ audio: AUDIO_CONSTRAINTS, video: false })) ?? (await tryGet({ audio: true, video: false }));
    }

    if (!stream) {
      toast(type === "video" ? "Microphone or camera permission is required." : "Microphone permission is required for voice calls.");
      return null;
    }
    log("Media", `Acquired local media: ${stream.getAudioTracks().length} audio, ${stream.getVideoTracks().length} video track(s)`);
    return stream;
  };

  const publishLocalStream = () => {
    set.localStream(localStream ? new MediaStream(localStream.getTracks()) : null);
  };

  const publishRemoteStream = () => {
    if (remotePublishPending) return;
    remotePublishPending = true;
    queueMicrotask(() => {
      remotePublishPending = false;
      set.remoteStream(remoteStream ? new MediaStream(remoteStream.getTracks()) : null);
    });
  };

  const onCameraEnded = (t: MediaStreamTrack) => {
    if (cameraTrack !== t) return;
    cameraTrack = null;
    videoMuted = true;
    set.isVideoMuted(true);
    try {
      localStream?.removeTrack(t);
    } catch {}
    if (videoTx && !screenTrack) {
      void videoTx.sender.replaceTrack(null).catch(() => {});
      setDirection(videoTx, "recvonly");
    }
    publishLocalStream();
    if (isActiveCall(state)) sendSignaling({ type: "call-toggle-video", videoEnabled: false });
  };

  const adoptLocalStream = (stream: MediaStream) => {
    localStream = stream;
    cameraTrack = stream.getVideoTracks()[0] ?? null;
    if (cameraTrack) {
      const t = cameraTrack;
      t.onended = () => onCameraEnded(t);
    }
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !micMuted;
    });
    videoMuted = !cameraTrack;
    set.isMicMuted(micMuted);
    set.isVideoMuted(videoMuted);
    set.localStream(stream);
  };

  // ---- sender tuning ----
  const setDirection = (tx: RTCRtpTransceiver, dir: RTCRtpTransceiverDirection) => {
    try {
      if (tx.direction !== dir) tx.direction = dir;
    } catch (e) {
      log("PeerConnection", `Could not set transceiver direction to ${dir}`, e);
    }
  };

  const preferOpus = (tx: RTCRtpTransceiver | null) => {
    if (!tx || codecPrefsApplied.has(tx) || typeof tx.setCodecPreferences !== "function") return;
    try {
      const caps = typeof RTCRtpReceiver !== "undefined" && typeof RTCRtpReceiver.getCapabilities === "function"
        ? RTCRtpReceiver.getCapabilities("audio")
        : null;
      if (!caps?.codecs?.length) return;
      const opus = caps.codecs.filter((c) => /opus/i.test(c.mimeType));
      if (!opus.length) return;
      const rest = caps.codecs.filter((c) => !/opus/i.test(c.mimeType));
      tx.setCodecPreferences([...opus, ...rest]);
      codecPrefsApplied.add(tx);
    } catch (e) {
      log("Media", "setCodecPreferences skipped", e);
    }
  };

  const applySenderParams = async (sender: RTCRtpSender, kind: "audio" | "video") => {
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) return; // Chrome forbids adding encodings post-hoc
      if (kind === "video") {
        params.encodings[0].maxBitrate = videoMaxBitrateFor(isMobile);
        params.encodings[0].maxFramerate = 30;
        (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = "balanced";
      } else {
        params.encodings[0].priority = "high";
        params.encodings[0].networkPriority = "high";
      }
      await sender.setParameters(params);
    } catch (e) {
      log("Media", `setParameters(${kind}) skipped`, e);
    }
  };

  const attachVideoTrack = async (t: MediaStreamTrack) => {
    if (!videoTx) return;
    setDirection(videoTx, "sendrecv");
    await videoTx.sender.replaceTrack(t);
    await applySenderParams(videoTx.sender, "video");
  };

  /**
   * Callee side (and after any renegotiation): find the transceivers the
   * remote offer created and plug our local tracks into them.
   */
  const ensureLocalTracksAttached = async (conn: RTCPeerConnection) => {
    const txs = conn.getTransceivers();
    if (!audioTx) audioTx = txs.find((t) => t.receiver?.track?.kind === "audio") ?? null;
    if (!videoTx) videoTx = txs.find((t) => t.receiver?.track?.kind === "video") ?? null;
    preferOpus(audioTx);

    const audioTrack = localStream?.getAudioTracks()[0] ?? null;
    if (audioTx && audioTrack && audioTx.sender.track !== audioTrack) {
      setDirection(audioTx, "sendrecv");
      await audioTx.sender.replaceTrack(audioTrack);
      await applySenderParams(audioTx.sender, "audio");
    }
    const v = screenTrack ?? (videoMuted ? null : cameraTrack);
    if (videoTx && v && videoTx.sender.track !== v) {
      setDirection(videoTx, "sendrecv");
      await videoTx.sender.replaceTrack(v);
      await applySenderParams(videoTx.sender, "video");
    }
  };

  // ---- stats ----
  const pollStats = async (conn: RTCPeerConnection | null) => {
    if (!conn || conn !== pc || conn.signalingState === "closed") return;
    try {
      const stats = await conn.getStats();
      let rtt: number | null = null;
      let candType: string | undefined;
      let packetsLost = 0;
      let packetsReceived = 0;
      let jitterMs: number | null = null;
      let resolution: string | null = null;

      stats.forEach((report) => {
        if (report.type === "candidate-pair" && (report.selected === true || report.nominated === true || report.state === "succeeded")) {
          if (typeof report.currentRoundTripTime === "number") {
            rtt = Math.round(report.currentRoundTripTime * 1000);
          } else if (typeof report.totalRoundTripTime === "number" && typeof report.responsesReceived === "number" && report.responsesReceived > 0) {
            rtt = Math.round((report.totalRoundTripTime / report.responsesReceived) * 1000);
          }
          const remoteCand = report.remoteCandidateId ? stats.get(report.remoteCandidateId) : null;
          const localCand = report.localCandidateId ? stats.get(report.localCandidateId) : null;
          if (remoteCand?.candidateType) candType = remoteCand.candidateType;
          if (remoteCand?.candidateType === "relay" || localCand?.candidateType === "relay") sawRelay = true;
        }
        if (report.type === "inbound-rtp") {
          if (report.kind === "audio" || report.kind === "video") {
            if (typeof report.packetsLost === "number") packetsLost += report.packetsLost;
            if (typeof report.packetsReceived === "number") packetsReceived += report.packetsReceived;
          }
          if (typeof report.jitter === "number") jitterMs = Math.round(report.jitter * 1000);
          if (report.kind === "video" && typeof report.frameWidth === "number" && typeof report.frameHeight === "number") {
            resolution = `${report.frameWidth}×${report.frameHeight}`;
          }
        }
      });

      const totalPackets = packetsLost + packetsReceived;
      const packetLossPercent = totalPackets > 30 ? Math.min(100, Math.round((packetsLost / totalPackets) * 100)) : null;
      const ice = conn.iceConnectionState || "unknown";
      let level: NetworkQualityLevel = "checking";
      if (ice === "failed" || ice === "disconnected" || ice === "closed") level = "disconnected";
      else if (ice === "checking" || ice === "new") level = "checking";
      else if (ice === "connected" || ice === "completed") {
        if (rtt === null) level = "good";
        else if (rtt < 85 && (packetLossPercent === null || packetLossPercent < 2)) level = "excellent";
        else if (rtt < 180 && (packetLossPercent === null || packetLossPercent < 5)) level = "good";
        else if (rtt < 350 && (packetLossPercent === null || packetLossPercent < 15)) level = "fair";
        else level = "poor";
      }
      set.networkQuality({ iceState: ice, rttMs: rtt, level, candidateType: candType, packetLossPercent, jitterMs, packetsLost, resolution });
    } catch {
      // stats on a closing connection: ignore
    }
  };

  const startStatsTimer = () => {
    if (timers.stats) return;
    void pollStats(pc);
    timers.stats = setInterval(() => void pollStats(pc), 2000);
  };

  const startDurationTimer = () => {
    if (timers.duration) return;
    set.callDuration(0);
    timers.duration = setInterval(() => set.callDuration((d) => d + 1), 1000);
  };

  // ---- connection lifecycle / recovery ----
  const onConnected = () => {
    if (!isMediaPhase(state)) return;
    clearTimer("setup");
    clearTimer("restart");
    clearTimer("recovery");
    clearTimer("disconnect");
    const wasRecovering = state === "reconnecting" || restartAttempt > 0;
    recoveryStartedAt = null;
    restartAttempt = 0;
    set.isReconnecting(false);
    set.renegotiationAttempt(0);
    if (state !== "connected") setState("connected");
    if (!everConnected) {
      everConnected = true;
      log("PeerConnection", "Media path established.");
      playCallConnectedChime(mutedRef.current);
      vibrate([60, 40, 60]);
      startDurationTimer();
    } else if (wasRecovering) {
      log("PeerConnection", "Media path recovered.");
      toast("Call reconnected.");
    }
    startStatsTimer();
  };

  const giveUp = (reason: "ice-failed" | "timeout") => {
    if (!isMediaPhase(state)) return;
    const connectedBefore = everConnected;
    const message = connectedBefore
      ? "The connection was lost and couldn't be restored."
      : reason === "timeout"
      ? "The call didn't connect in time."
      : "Couldn't establish a connection between the two devices.";
    terminate({
      exit: "auto",
      reason,
      next: "failed-network",
      toast: connectedBefore ? "Call dropped — couldn't reconnect." : "Couldn't connect the call.",
      failure: { message, suggestAudioOnly: !sawRelay },
    });
  };

  const attemptRestart = async (attempt: number) => {
    const conn = pc;
    if (!conn || !isMediaPhase(state)) return;
    if (isPcConnected(conn)) return;
    if (conn.signalingState !== "stable" || makingOffer) {
      log("ICE", `Deferring ICE restart #${attempt}: signalling busy (${conn.signalingState}${makingOffer ? ", making offer" : ""})`);
      timers.restart = setTimeout(() => {
        timers.restart = null;
        void attemptRestart(attempt);
      }, 1000);
      return;
    }
    restartAttempt = attempt;
    set.renegotiationAttempt(attempt);
    log("ICE", `ICE restart attempt ${attempt}/${MAX_RESTART_ATTEMPTS} [conn=${conn.connectionState}, ice=${conn.iceConnectionState}]`);
    try {
      if (typeof conn.restartIce === "function") {
        conn.restartIce(); // -> negotiationneeded -> negotiate()
      } else {
        await negotiate(conn, callSeq, { iceRestart: true });
      }
    } catch (e) {
      log("ICE", "restartIce failed", e);
    }
    scheduleRestart();
  };

  const scheduleRestart = () => {
    if (timers.restart) return;
    const attempt = restartAttempt + 1;
    const delay = restartDelayMs(attempt);
    if (delay === null) {
      log("ICE", "ICE restart attempts exhausted; waiting for the recovery deadline.");
      return;
    }
    timers.restart = setTimeout(() => {
      timers.restart = null;
      void attemptRestart(attempt);
    }, delay);
  };

  const beginRecovery = (cause: "disconnected" | "failed") => {
    if (!pc || !isMediaPhase(state)) return;
    if (recoveryStartedAt === null) {
      recoveryStartedAt = Date.now();
      clearTimer("recovery");
      timers.recovery = setTimeout(() => giveUp("ice-failed"), RECOVERY_DEADLINE_MS);
    }
    if (state === "connected") setState("reconnecting");
    set.isReconnecting(true);
    log("ICE", `Connection ${cause}; starting ICE restart ladder (2/4/8/16 s, ${RECOVERY_DEADLINE_MS / 1000} s budget).`);
    scheduleRestart();
  };

  const handleConnectionState = (conn: RTCPeerConnection) => {
    const cs = conn.connectionState;
    log("PeerConnection", `connectionState -> ${cs}`);
    if (cs === "connected") {
      clearTimer("disconnect");
      onConnected();
    } else if (cs === "disconnected") {
      if (!timers.disconnect) {
        timers.disconnect = setTimeout(() => {
          timers.disconnect = null;
          if (pc === conn && conn.connectionState === "disconnected") beginRecovery("disconnected");
        }, DISCONNECTED_GRACE_MS);
      }
    } else if (cs === "failed") {
      clearTimer("disconnect");
      beginRecovery("failed");
    } else if (cs !== "closed") {
      clearTimer("disconnect");
    }
  };

  const startSetupDeadline = () => {
    clearTimer("setup");
    timers.setup = setTimeout(() => {
      if (state === "connecting") giveUp("timeout");
    }, CALL_SETUP_DEADLINE_MS);
  };

  // ---- perfect negotiation ----
  const negotiate = async (conn: RTCPeerConnection, seq: number, opts?: { iceRestart?: boolean }) => {
    if (pc !== conn || seq !== callSeq) return;
    if (conn.signalingState !== "stable") {
      log("Signaling", `negotiationneeded ignored in state ${conn.signalingState}`);
      return;
    }
    makingOffer = true;
    try {
      const offer = await conn.createOffer(opts?.iceRestart ? { iceRestart: true } : undefined);
      if (pc !== conn || conn.signalingState !== "stable") return;
      await conn.setLocalDescription({ type: offer.type, sdp: optimizeOpusSdp(offer.sdp || "") });
      if (pc !== conn) return;
      const desc = conn.localDescription ?? offer;
      sendSignaling({
        type: msgName("offer"),
        payload: { type: desc.type, sdp: desc.sdp },
        isRenegotiation: everNegotiated,
        iceRestart: Boolean(opts?.iceRestart),
      });
      everNegotiated = true;
    } catch (e) {
      log("Signaling", "Creating/applying local offer failed", e);
      if (!everConnected && state === "connecting") {
        terminate({
          exit: "auto",
          reason: "ice-failed",
          next: "failed",
          toast: "Call setup failed. Please try again.",
          failure: { message: "The browser couldn't create a call offer.", suggestAudioOnly: false },
        });
      }
    } finally {
      makingOffer = false;
    }
  };

  const drainCandidates = async (conn: RTCPeerConnection) => {
    const queued = pendingCandidates;
    pendingCandidates = [];
    for (const c of queued) {
      try {
        await conn.addIceCandidate(c);
      } catch (e) {
        if (!ignoreOffer) log("ICE", "Failed applying queued ICE candidate", e);
      }
    }
  };

  const onDescription = async (desc: RTCSessionDescriptionInit | undefined) => {
    const conn = pc;
    const seq = callSeq;
    if (!conn) {
      log("Signaling", "Description received without a PeerConnection; ignored.");
      return;
    }
    if (!desc || (desc.type !== "offer" && desc.type !== "answer")) return;

    const offerCollision = desc.type === "offer" && (makingOffer || conn.signalingState !== "stable");
    ignoreOffer = !polite && offerCollision;
    if (ignoreOffer) {
      log("Signaling", "Offer collision: ignoring the remote offer (impolite peer).");
      return;
    }
    if (desc.type === "answer" && conn.signalingState !== "have-local-offer") {
      log("Signaling", `Ignoring answer in state ${conn.signalingState}`);
      return;
    }

    try {
      try {
        await conn.setRemoteDescription(desc);
      } catch (e) {
        // Older Safari cannot roll back implicitly: do it explicitly and retry.
        if (offerCollision && conn.signalingState === "have-local-offer") {
          await conn.setLocalDescription({ type: "rollback" });
          await conn.setRemoteDescription(desc);
        } else {
          throw e;
        }
      }
      if (pc !== conn || seq !== callSeq) return;
      log("Signaling", `Applied remote ${desc.type} (signalingState=${conn.signalingState})`);
      await drainCandidates(conn);

      if (desc.type === "offer") {
        await ensureLocalTracksAttached(conn);
        if (pc !== conn) return;
        const answer = await conn.createAnswer();
        if (pc !== conn) return;
        await conn.setLocalDescription({ type: answer.type, sdp: optimizeOpusSdp(answer.sdp || "") });
        const local = conn.localDescription ?? answer;
        sendSignaling({ type: msgName("answer"), payload: { type: local.type, sdp: local.sdp } });
        everNegotiated = true;
      }
    } catch (e) {
      log("Signaling", `Failed handling remote ${desc.type}`, e);
      if (!everConnected && state === "connecting") {
        terminate({
          exit: "auto",
          reason: "ice-failed",
          next: "failed",
          toast: "Call connection handshake failed.",
          failure: { message: "The browsers couldn't agree on a media session.", suggestAudioOnly: false },
        });
      }
    }
  };

  const onCandidate = async (cand: RTCIceCandidateInit | null | undefined) => {
    const conn = pc;
    if (!cand || typeof cand !== "object") return;
    if (!conn || !conn.remoteDescription) {
      pendingCandidates.push(cand);
      return;
    }
    try {
      await conn.addIceCandidate(cand);
    } catch (e) {
      if (!ignoreOffer) log("ICE", "Failed adding remote ICE candidate", e);
    }
  };

  const handleRemoteTrack = (e: RTCTrackEvent) => {
    const track = e.track;
    log("Media", `Remote ${track.kind} track (muted=${track.muted})`);
    if (!remoteStream) remoteStream = new MediaStream();
    if (!remoteStream.getTracks().some((t) => t.id === track.id)) remoteStream.addTrack(track);
    track.onended = () => {
      try {
        remoteStream?.removeTrack(track);
      } catch {}
      publishRemoteStream();
    };
    publishRemoteStream();
    // NOTE: "connected" is driven by pc.connectionState only (never by ontrack).
  };

  const createPeerConnection = (): RTCPeerConnection => {
    if (pc) {
      const old = pc;
      pc = null;
      try {
        old.close();
      } catch {}
    }
    const conn = new RTCPeerConnection({
      iceServers,
      iceCandidatePoolSize: 1,
      bundlePolicy: "max-bundle",
    });
    pc = conn;
    audioTx = null;
    videoTx = null;
    const seq = callSeq;
    log("PeerConnection", `Created RTCPeerConnection (${iceServers.length} ICE servers, polite=${polite})`);

    conn.onicecandidate = (ev) => {
      if (pc !== conn) return;
      if (ev.candidate) {
        const kind = classifyCandidate(ev.candidate.candidate);
        if (kind === "relay") sawRelay = true;
        log("ICE", `Local candidate [${kind}] ${ev.candidate.protocol ?? ""}`);
        const c = ev.candidate;
        const serialized: RTCIceCandidateInit =
          typeof c.toJSON === "function" ? c.toJSON() : { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex };
        sendSignaling({ type: msgName("ice"), payload: serialized });
      } else {
        log("ICE", "Local ICE gathering complete.");
      }
    };
    conn.onicecandidateerror = (ev: Event) => {
      const err = ev as Event & { errorCode?: number; errorText?: string; url?: string };
      log("ICE", `Candidate error ${err.errorCode ?? ""} ${err.errorText ?? ""} (${err.url ?? ""})`);
    };
    conn.ontrack = (ev) => {
      if (pc !== conn) return;
      handleRemoteTrack(ev);
    };
    conn.onnegotiationneeded = () => {
      if (pc !== conn) return;
      void negotiate(conn, seq);
    };
    conn.onconnectionstatechange = () => {
      if (pc !== conn) return;
      handleConnectionState(conn);
    };
    conn.oniceconnectionstatechange = () => {
      if (pc !== conn) return;
      const ice = conn.iceConnectionState;
      log("ICE", `iceConnectionState -> ${ice}`);
      set.networkQuality((prev) => ({
        ...prev,
        iceState: ice,
        level:
          ice === "failed" || ice === "disconnected" || ice === "closed"
            ? "disconnected"
            : ice === "checking"
            ? "checking"
            : prev.level,
      }));
      if (typeof conn.connectionState !== "string") {
        // Very old engines without connectionState: mirror ICE state.
        if (ice === "connected" || ice === "completed") onConnected();
        else if (ice === "failed") beginRecovery("failed");
      }
      void pollStats(conn);
    };
    conn.onsignalingstatechange = () => {
      if (pc === conn) log("PeerConnection", `signalingState -> ${conn.signalingState}`);
    };
    conn.onicegatheringstatechange = () => {
      if (pc === conn) log("ICE", `iceGatheringState -> ${conn.iceGatheringState}`);
    };
    return conn;
  };

  /** Caller side: pre-create both transceivers; negotiationneeded then sends the offer. */
  const setupCallerTransceivers = (conn: RTCPeerConnection) => {
    const audioTrack = localStream?.getAudioTracks()[0] ?? null;
    const v = screenTrack ?? (videoMuted ? null : cameraTrack);
    const streams = localStream ? [localStream] : [];
    audioTx = audioTrack
      ? conn.addTransceiver(audioTrack, { direction: "sendrecv", streams })
      : conn.addTransceiver("audio", { direction: "sendrecv" });
    videoTx = v
      ? conn.addTransceiver(v, {
          direction: "sendrecv",
          streams,
          sendEncodings: [{ maxBitrate: videoMaxBitrateFor(isMobile), maxFramerate: 30 }],
        })
      : conn.addTransceiver("video", { direction: "recvonly" });
    preferOpus(audioTx);
    if (audioTrack) void applySenderParams(audioTx.sender, "audio");
    if (v) void applySenderParams(videoTx.sender, "video");
  };

  // ---- incoming signalling ----
  const inferType = (data: { type?: string; callType?: string }): CallType =>
    data.callType === "voice" || String(data.type || "").startsWith("voice") ? "voice" : "video";

  const onRequest = (from: string, type: CallType) => {
    if (state === "calling") {
      // Both players pressed "call" at once (gate guarantees from === peer).
      const me = userRef.current || "";
      if (resolveGlareRole(me, from) === "caller") {
        log("StateMachine", "Mutual call: staying caller, waiting for their accept.");
        return;
      }
      log("StateMachine", "Mutual call: becoming callee and auto-accepting.");
      clearTimer("ring");
      if (stopRingback) {
        stopRingback();
        stopRingback = null;
      }
      role = "callee";
      polite = true;
      if (!cameraTrack && type === "voice" && callType !== "voice") {
        callType = "voice";
        set.callType("voice");
      }
      if (!setState("connecting")) return;
      startSetupDeadline();
      createPeerConnection();
      sendSignaling({ type: msgName("accept") });
      return;
    }
    if (!isIdleLike(state)) return;
    if (state === "unsupported") {
      sendSignaling({ type: signalName("decline", type), to: from, callType: type, reason: "unsupported" });
      return;
    }
    teardown();
    beginCall(from, type, "callee");
    if (!setState("ringing")) return;
    set.incomingCall({ from, callType: type });
    log("StateMachine", `Incoming ${type} call from @${from}`);
    if (stopRingtone) stopRingtone();
    stopRingtone = startVoiceRingtone(mutedRef.current);
    vibrate([400, 250, 400, 250, 400]);
    timers.ring = setTimeout(() => {
      if (state === "ringing") {
        terminate({ exit: "decline", reason: "timeout", next: "idle", toast: `Missed ${type} call from @${from}.` });
      }
    }, CALL_REQUEST_TIMEOUT_MS);
  };

  const onAccepted = () => {
    if (state !== "calling") return;
    clearTimer("ring");
    if (stopRingback) {
      stopRingback();
      stopRingback = null;
    }
    if (!setState("connecting")) return;
    startSetupDeadline();
    role = "caller";
    polite = false;
    const conn = createPeerConnection();
    try {
      setupCallerTransceivers(conn);
    } catch (e) {
      log("PeerConnection", "Failed adding transceivers", e);
      terminate({
        exit: "auto",
        reason: "ice-failed",
        next: "failed",
        toast: "Call setup failed. Please try again.",
        failure: { message: "The browser couldn't set up the media session.", suggestAudioOnly: false },
      });
    }
  };

  const onDeclined = (reason?: string) => {
    if (state !== "calling") return;
    const name = peer;
    const msg =
      reason === "no-media"
        ? `@${name} couldn't access a microphone.`
        : reason === "timeout"
        ? `No answer from @${name}.`
        : reason === "unsupported"
        ? `@${name}'s browser doesn't support calls.`
        : `${typeLabel()} call was declined.`;
    terminate({ exit: "none", reason: "declined", next: "idle", toast: msg });
  };

  const onCancelled = () => {
    const calleeStillSettingUp = state === "connecting" && role === "callee" && !everNegotiated;
    if (state !== "ringing" && !calleeStillSettingUp) return;
    terminate({ exit: "none", reason: "hangup", next: "idle", toast: `@${peer} cancelled the call.` });
  };

  const onPeerEnded = (reason?: string) => {
    if (!isActiveCall(state)) return;
    const name = peer;
    let msg: string;
    let next: CallPhase = "idle";
    switch (reason) {
      case "peer-disconnected":
        msg = `@${name} lost connection.`;
        break;
      case "ice-failed":
        msg = everConnected ? `Call with @${name} dropped.` : `Call with @${name} couldn't connect.`;
        next = everConnected ? "idle" : "failed-network";
        break;
      case "timeout":
        msg = everConnected ? `Call with @${name} timed out.` : `Call with @${name} didn't connect in time.`;
        next = everConnected ? "idle" : "failed-network";
        break;
      case "busy":
        msg = `@${name} is busy.`;
        break;
      default:
        msg = state === "calling" || state === "ringing" ? `@${name} ended the call.` : `${typeLabel()} call ended by @${name}.`;
    }
    const validReason: CallFailureReason =
      reason === "peer-disconnected" || reason === "ice-failed" || reason === "timeout" || reason === "busy" ? reason : "hangup";
    terminate({
      exit: "none",
      reason: validReason,
      next,
      toast: msg,
      failure: next === "failed-network" ? { message: msg, suggestAudioOnly: !sawRelay } : undefined,
    });
  };

  const onBusy = (from: string | null) => {
    if (state !== "calling") return;
    terminate({ exit: "none", reason: "busy", next: "idle", toast: `@${from ?? peer} is on another call.` });
  };

  const onUnavailable = (message?: string) => {
    if (state !== "calling") return;
    terminate({ exit: "none", reason: "unavailable", next: "idle", toast: message || `@${peer} is unavailable for calls.` });
  };

  const onLegacyRenegotiateRequest = () => {
    // Older clients ask the caller to restart ICE; with perfect negotiation
    // either side may, so just honour it when the signalling channel is idle.
    if (pc && pc.signalingState === "stable" && !makingOffer && typeof pc.restartIce === "function") {
      log("ICE", "Peer requested renegotiation; restarting ICE.");
      pc.restartIce();
    }
  };

  const handleMessage = async (raw: unknown) => {
    const data = raw as { type?: unknown; from?: unknown; callType?: unknown; payload?: unknown; reason?: unknown; message?: unknown; videoEnabled?: unknown; audioEnabled?: unknown; sharing?: unknown };
    if (!data || typeof data.type !== "string") return;
    const type = data.type;
    const from = typeof data.from === "string" ? data.from : undefined;
    const gate = gateIncomingCallMessage({ type, from, state, peer });
    log("Signaling", `<- ${type} from @${from ?? "server"} [${gate}] (state=${state})`);

    if (gate === "busy") {
      if (from) {
        const incomingType = inferType({ type, callType: typeof data.callType === "string" ? data.callType : undefined });
        sendSignaling({ type: signalName("busy", incomingType), to: from, callType: incomingType });
      }
      return;
    }
    if (gate === "ignore") return;

    const kind = signalKindOf(type);
    switch (kind ?? type) {
      case "request":
        if (from) onRequest(from, inferType({ type, callType: typeof data.callType === "string" ? data.callType : undefined }));
        break;
      case "accept":
        onAccepted();
        break;
      case "decline":
        onDeclined(typeof data.reason === "string" ? data.reason : undefined);
        break;
      case "cancel":
        onCancelled();
        break;
      case "offer":
      case "answer":
        await onDescription(data.payload as RTCSessionDescriptionInit | undefined);
        break;
      case "ice":
        await onCandidate(data.payload as RTCIceCandidateInit | undefined);
        break;
      case "end":
        onPeerEnded(typeof data.reason === "string" ? data.reason : undefined);
        break;
      case "busy":
        onBusy(from ?? null);
        break;
      case "call-unavailable":
        onUnavailable(typeof data.message === "string" ? data.message : undefined);
        break;
      case "call-renegotiate-request":
      case "voice-renegotiate-request":
        onLegacyRenegotiateRequest();
        break;
      case "call-toggle-video":
        set.isRemoteVideoEnabled(Boolean(data.videoEnabled));
        break;
      case "call-toggle-audio":
        set.isRemoteAudioEnabled(Boolean(data.audioEnabled));
        break;
      case "call-screen-share": {
        const sharing = Boolean(data.sharing);
        set.isRemoteScreenSharing(sharing);
        if (sharing) {
          set.remoteScreenStream?.(remoteStream);
        } else {
          set.remoteScreenStream?.(null);
        }
        break;
      }
      default:
        break;
    }
  };

  // ---- user actions ----
  const startCall = async (target: string, type: CallType) => {
    if (!supported) {
      toast(UNSUPPORTED_CALLS_MESSAGE);
      return;
    }
    if (!target || target === userRef.current) return;
    if (!isIdleLike(state)) {
      toast("You're already in a call.");
      return;
    }
    if (!socketOpen()) {
      toast("Server not connected. Please wait...");
      return;
    }
    unlockAudio();
    teardown();
    beginCall(target, type, "caller");
    if (!setState("calling")) return;
    log("StateMachine", `Calling @${target} (${type})`);

    const seq = callSeq;
    const stream = await acquireMedia(type);
    if (seq !== callSeq) {
      stopStream(stream);
      return;
    }
    if (!stream) {
      terminate({ exit: "none", reason: "no-media", next: "idle" });
      return;
    }
    if (phase() === "connecting" && role === "callee") {
      // Mutual call resolved while the mic prompt was open: we are now the callee.
      adoptLocalStream(stream);
      if (pc) await ensureLocalTracksAttached(pc).catch((e) => log("Media", "attach after glare failed", e));
      return;
    }
    if (phase() !== "calling") {
      stopStream(stream);
      return;
    }
    adoptLocalStream(stream);
    if (stopRingback) stopRingback();
    stopRingback = startVoiceRingback(mutedRef.current);
    sendSignaling({ type: msgName("request"), to: target, callType: type });
    clearTimer("ring");
    timers.ring = setTimeout(() => {
      if (state === "calling") {
        terminate({ exit: "auto", reason: "timeout", next: "idle", toast: `No answer from @${target}.` });
      }
    }, CALL_REQUEST_TIMEOUT_MS);
  };

  const acceptCall = async (acceptType?: CallType) => {
    if (state !== "ringing") {
      log("StateMachine", `acceptCall ignored in state '${state}'`);
      return;
    }
    unlockAudio();
    clearTimer("ring");
    if (stopRingtone) {
      stopRingtone();
      stopRingtone = null;
    }
    const chosen: CallType = acceptType ?? callType;
    if (chosen !== callType) {
      callType = chosen;
      set.callType(chosen);
    }
    set.incomingCall(null);
    if (!setState("connecting")) return;
    startSetupDeadline();
    role = "callee";
    polite = true;
    log("StateMachine", `Accepting ${chosen} call from @${peer}`);

    const seq = callSeq;
    const stream = await acquireMedia(chosen);
    if (seq !== callSeq || phase() !== "connecting") {
      stopStream(stream);
      return;
    }
    if (!stream) {
      terminate({ exit: "decline", reason: "no-media", next: "idle" });
      return;
    }
    adoptLocalStream(stream);
    if (!pc) createPeerConnection();
    else await ensureLocalTracksAttached(pc).catch((e) => log("Media", "attach on accept failed", e));
    sendSignaling({ type: msgName("accept") });
  };

  const declineCall = () => {
    if (state !== "ringing") return;
    terminate({ exit: "decline", reason: "declined", next: "idle" });
  };

  const cancelCall = () => {
    if (state !== "calling") return;
    terminate({ exit: "cancel", reason: "hangup", next: "idle" });
  };

  const endCall = () => {
    if (!isActiveCall(state)) return;
    const label = typeLabel();
    terminate({ exit: "auto", reason: "hangup", next: "idle", toast: `${label} call ended.` });
  };

  const hangupSilently = () => {
    if (!isActiveCall(state)) return;
    terminate({ exit: "auto", reason: "hangup", next: "idle" });
  };

  const toggleMic = () => {
    if (!localStream) return;
    micMuted = !micMuted;
    localStream.getAudioTracks().forEach((t) => {
      t.enabled = !micMuted;
    });
    set.isMicMuted(micMuted);
    log("Media", `Microphone ${micMuted ? "muted" : "unmuted"}`);
    if (isActiveCall(state)) sendSignaling({ type: "call-toggle-audio", audioEnabled: !micMuted });
  };

  const toggleVideo = async () => {
    if (!isActiveCall(state)) return;
    if (cameraTrack && !videoMuted) {
      // Camera off: stop sending AND release the device (LED off).
      videoMuted = true;
      set.isVideoMuted(true);
      const t = cameraTrack;
      cameraTrack = null;
      try {
        localStream?.removeTrack(t);
      } catch {}
      stopTrack(t);
      if (!screenTrack && videoTx) {
        try {
          await videoTx.sender.replaceTrack(null);
          setDirection(videoTx, "recvonly");
        } catch (e) {
          log("Media", "replaceTrack(null) failed", e);
        }
      }
      publishLocalStream();
      sendSignaling({ type: "call-toggle-video", videoEnabled: false });
      return;
    }
    try {
      const generation = callSeq;
      const s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(facing), audio: false });
      if (generation !== callSeq) { stopStream(s); return; }
      const t = s.getVideoTracks()[0];
      if (!t) { stopStream(s); return; }
      if (generation !== callSeq || !isActiveCall(state)) {
        stopStream(s);
        return;
      }
      if (cameraTrack) stopTrack(cameraTrack);
      cameraTrack = t;
      t.onended = () => onCameraEnded(t);
      if (!localStream) localStream = new MediaStream();
      localStream.addTrack(t);
      videoMuted = false;
      set.isVideoMuted(false);
      if (callType !== "video") {
        callType = "video";
        set.callType("video");
      }
      if (!screenTrack) await attachVideoTrack(t);
      publishLocalStream();
      sendSignaling({ type: "call-toggle-video", videoEnabled: true, callType: "video" });
    } catch (e) {
      log("Media", "Could not start camera", e);
      toast("Unable to access camera.");
    }
  };

  const flipCamera = async () => {
    if (!cameraTrack) return;
    const next: "user" | "environment" = facing === "user" ? "environment" : "user";
    try {
      const generation = callSeq;
      const s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(next), audio: false });
      if (generation !== callSeq) { stopStream(s); return; }
      const t = s.getVideoTracks()[0];
      if (!t) return;
      const old = cameraTrack;
      cameraTrack = t;
      t.onended = () => onCameraEnded(t);
      try {
        localStream?.removeTrack(old);
      } catch {}
      stopTrack(old);
      localStream?.addTrack(t);
      if (!screenTrack && videoTx) await videoTx.sender.replaceTrack(t);
      facing = next;
      set.facingMode(next);
      publishLocalStream();
      log("Media", `Camera flipped to ${next}`);
    } catch (e) {
      log("Media", "Failed to switch camera", e);
      toast("Could not switch camera.");
    }
  };

  const stopScreenShare = async (notify: boolean) => {
    const t = screenTrack;
    if (!t) return;
    screenTrack = null;
    stopTrack(t);
    set.isScreenSharing(false);
    set.localScreenStream?.(null);
    if (videoTx && pc) {
      try {
        const cam = !videoMuted ? cameraTrack : null;
        if (cam) {
          await videoTx.sender.replaceTrack(cam);
          await applySenderParams(videoTx.sender, "video");
        } else {
          await videoTx.sender.replaceTrack(null);
          setDirection(videoTx, "recvonly");
        }
      } catch (e) {
        log("Media", "Restoring camera after screen share failed", e);
      }
    }
    if (notify && isActiveCall(state)) {
      sendSignaling({ type: "call-screen-share", sharing: false });
      sendSignaling({ type: "call-toggle-video", videoEnabled: !!cameraTrack && !videoMuted });
    }
  };

  const toggleScreenShare = async () => {
    if (!isActiveCall(state)) return;
    if (screenTrack) {
      await stopScreenShare(true);
      return;
    }
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md || typeof md.getDisplayMedia !== "function") {
      toast("Screen sharing isn't available on this device.");
      return;
    }
    const generation = callSeq;
    try {
      const ds = await md.getDisplayMedia({ video: true, audio: false });
      const t = ds.getVideoTracks()[0];
      if (!t) { stopStream(ds); return; }
      if (generation !== callSeq || !isActiveCall(state)) {
        stopStream(ds);
        return;
      }
      screenTrack = t;
      t.onended = () => {
        void stopScreenShare(true);
      };
      try {
        t.contentHint = "detail";
      } catch {}
      if (videoTx) {
        setDirection(videoTx, "sendrecv");
        await videoTx.sender.replaceTrack(t);
        await applySenderParams(videoTx.sender, "video");
      }
      if (generation !== callSeq) { stopStream(ds); return; }
      set.isScreenSharing(true);
      set.localScreenStream?.(new MediaStream([t]));
      sendSignaling({ type: "call-screen-share", sharing: true });
      sendSignaling({ type: "call-toggle-video", videoEnabled: true });
      log("Media", "Screen share started");
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name !== "NotAllowedError" && name !== "AbortError") toast("Couldn't start screen sharing.");
      log("Media", "getDisplayMedia failed", e);
    }
  };

  const dispose = () => {
    hangupSilently();
    clearTimer("queue");
    queue.clear();
  };

  return {
    startCall,
    acceptCall,
    declineCall,
    cancelCall,
    endCall,
    toggleMic,
    toggleVideo,
    flipCamera,
    toggleScreenShare,
    handleMessage,
    flushQueue,
    hangupSilently,
    dispose,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWebRTCCall(
  ws: SignalingSocketLike | null,
  currentUser: string | null,
  isMuted: boolean,
  onStatusToast?: (msg: string) => void
) {
  const [callState, setCallState] = useState<CallState>(() => (detectCallSupport() ? "idle" : "unsupported"));
  const [callType, setCallType] = useState<CallType>("video");
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);
  const [opponentName, setOpponentName] = useState<string>("");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMicMuted, setIsMicMuted] = useState<boolean>(false);
  const [isVideoMuted, setIsVideoMuted] = useState<boolean>(false);
  const [isRemoteVideoEnabled, setIsRemoteVideoEnabled] = useState<boolean>(true);
  const [isRemoteAudioEnabled, setIsRemoteAudioEnabled] = useState<boolean>(true);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [callDuration, setCallDuration] = useState<number>(0);
  const [networkQuality, setNetworkQuality] = useState<NetworkQualityStats>(INITIAL_QUALITY);
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);
  const [renegotiationAttempt, setRenegotiationAttempt] = useState<number>(0);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [isRemoteScreenSharing, setIsRemoteScreenSharing] = useState<boolean>(false);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);
  const [failureInfo, setFailureInfo] = useState<CallFailureInfo | null>(() =>
    detectCallSupport() ? null : { reason: "unsupported", message: UNSUPPORTED_CALLS_MESSAGE, suggestAudioOnly: false }
  );

  // Props are mirrored into refs so that changing them never recreates the
  // controller or tears down a live call (the old cleanup-on-mute bug).
  const wsRef = useRef<SignalingSocketLike | null>(ws);
  const userRef = useRef<string | null>(currentUser);
  const mutedRef = useRef<boolean>(isMuted);
  const toastRef = useRef<((msg: string) => void) | undefined>(onStatusToast);

  const ctrlRef = useRef<Controller | null>(null);
  if (!ctrlRef.current) {
    ctrlRef.current = createCallController({
      wsRef,
      userRef,
      mutedRef,
      toastRef,
      set: {
        callState: setCallState,
        callType: setCallType,
        incomingCall: setIncomingCall,
        opponentName: setOpponentName,
        localStream: setLocalStream,
        remoteStream: setRemoteStream,
        isMicMuted: setIsMicMuted,
        isVideoMuted: setIsVideoMuted,
        isRemoteVideoEnabled: setIsRemoteVideoEnabled,
        isRemoteAudioEnabled: setIsRemoteAudioEnabled,
        facingMode: setFacingMode,
        callDuration: setCallDuration,
        networkQuality: setNetworkQuality,
        isReconnecting: setIsReconnecting,
        renegotiationAttempt: setRenegotiationAttempt,
        isScreenSharing: setIsScreenSharing,
        isRemoteScreenSharing: setIsRemoteScreenSharing,
        localScreenStream: setLocalScreenStream,
        remoteScreenStream: setRemoteScreenStream,
        failureInfo: setFailureInfo,
      },
    });
  }
  const ctrl = ctrlRef.current;

  useEffect(() => {
    wsRef.current = ws;
    ctrl.flushQueue();
  }, [ws, ctrl]);
  useEffect(() => {
    userRef.current = currentUser;
  }, [currentUser]);
  useEffect(() => {
    mutedRef.current = isMuted;
  }, [isMuted]);
  useEffect(() => {
    toastRef.current = onStatusToast;
  });

  // End the call exactly once on unmount or when the page is closed/refreshed.
  useEffect(() => {
    const onPageHide = () => ctrl.hangupSilently();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      ctrl.dispose();
    };
  }, [ctrl]);

  const startCall = useCallback((target: string, type: CallType) => ctrl.startCall(target, type), [ctrl]);
  const acceptCall = useCallback((type?: CallType) => ctrl.acceptCall(type), [ctrl]);
  const declineCall = useCallback(() => ctrl.declineCall(), [ctrl]);
  const cancelCall = useCallback(() => ctrl.cancelCall(), [ctrl]);
  const endCall = useCallback(() => ctrl.endCall(), [ctrl]);
  const toggleMic = useCallback(() => ctrl.toggleMic(), [ctrl]);
  const toggleVideo = useCallback(() => ctrl.toggleVideo(), [ctrl]);
  const flipCamera = useCallback(() => ctrl.flipCamera(), [ctrl]);
  const toggleScreenShare = useCallback(() => ctrl.toggleScreenShare(), [ctrl]);
  const handleSignalingMessage = useCallback((data: unknown) => ctrl.handleMessage(data), [ctrl]);

  const isCallActive = isActiveCall(callState);

  return {
    callState,
    callType,
    incomingCall,
    opponentName,
    localStream,
    remoteStream,
    isMicMuted,
    isVideoMuted,
    isRemoteVideoEnabled,
    isRemoteAudioEnabled,
    facingMode,
    callDuration,
    networkQuality,
    isReconnecting,
    renegotiationAttempt,
    maxRenegotiationAttempts: MAX_RESTART_ATTEMPTS,
    isScreenSharing,
    isRemoteScreenSharing,
    localScreenStream,
    remoteScreenStream,
    isCallActive,
    failureInfo,
    startCall,
    acceptCall,
    declineCall,
    cancelCall,
    endCall,
    toggleMic,
    toggleVideo,
    flipCamera,
    toggleScreenShare,
    handleSignalingMessage,
  };
}
