import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, Maximize2, Minimize2,
  SwitchCamera, Volume2, VolumeX, ChevronDown, ChevronUp, Radio,
  RefreshCw, ScreenShare, ScreenShareOff, MonitorUp, Eye, Monitor,
  ArrowLeftRight, Sparkles, Layers, ShieldCheck, ZoomIn
} from "lucide-react";
import type { CallState, CallType, NetworkQualityStats } from "../../lib/useWebRTCCall";
import { isIdleLike } from "../../lib/callStateMachine";
import { getAudioContext } from "../../lib/audio";
import { NetworkQualityBadge } from "./NetworkQualityBadge";
import type { Board, Move, Piece } from "../../gameLogic";

export interface FloatingVideoCallProps {
  opponentName: string;
  callState: CallState;
  callType: CallType;
  localStream: MediaStream | null;
  localScreenStream?: MediaStream | null;
  remoteStream: MediaStream | null;
  remoteScreenStream?: MediaStream | null;
  isMicMuted: boolean;
  isVideoMuted: boolean;
  isRemoteVideoEnabled?: boolean;
  callDuration: number;
  networkQuality?: NetworkQualityStats;
  isReconnecting?: boolean;
  renegotiationAttempt?: number;
  maxRenegotiationAttempts?: number;
  isScreenSharing?: boolean;
  isRemoteScreenSharing?: boolean;
  /** Optional external ref for the single remote <audio> element (App's remoteVoiceAudioRef). */
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  onToggleMic: () => void;
  onToggleVideo: () => void;
  onFlipCamera?: () => void;
  onToggleScreenShare?: () => void;
  onEndCall: () => void;
  // Live Game Context for live spectator feed:
  board?: Board;
  turn?: "W" | "B";
  lastMove?: Move | null;
  yourColor?: "W" | "B" | null;
  whiteName?: string;
  blackName?: string;
}

const SPEAKING_THRESHOLD = 14;

/** True when a stream carries at least one video track that is actually delivering frames. */
function streamHasLiveVideo(stream: MediaStream | null | undefined): boolean {
  if (!stream) return false;
  return stream.getVideoTracks().some((t) => t.enabled && t.readyState === "live" && !t.muted);
}

/** Speaking indicator meter */
function useSpeakingMeter(stream: MediaStream | null, enabled: boolean): boolean {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!stream || !enabled) {
      setSpeaking(false);
      return;
    }
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      setSpeaking(false);
      return;
    }
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let animId: number | null = null;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let last = false;
      const tick = () => {
        if (!analyser) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const now = sum / data.length > SPEAKING_THRESHOLD;
        if (now !== last) {
          last = now;
          setSpeaking(now);
        }
        animId = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // AudioContext unavailable
    }
    return () => {
      if (animId) cancelAnimationFrame(animId);
      try {
        source?.disconnect();
        analyser?.disconnect();
      } catch {}
      setSpeaking(false);
    };
  }, [stream, enabled]);
  return speaking;
}

export function FloatingVideoCall({
  opponentName,
  callState,
  callType,
  localStream,
  localScreenStream,
  remoteStream,
  remoteScreenStream,
  isMicMuted,
  isVideoMuted,
  isRemoteVideoEnabled = true,
  callDuration,
  networkQuality,
  isReconnecting = false,
  renegotiationAttempt = 0,
  maxRenegotiationAttempts = 4,
  isScreenSharing = false,
  isRemoteScreenSharing = false,
  audioRef: externalAudioRef,
  onToggleMic,
  onToggleVideo,
  onFlipCamera,
  onToggleScreenShare,
  onEndCall,
  board,
  turn,
  lastMove,
  yourColor,
  whiteName,
  blackName,
}: FloatingVideoCallProps) {
  const remoteEyesVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteScreenVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const internalAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioRef = externalAudioRef ?? internalAudioRef;

  // View state:
  // - "dual": default side-by-side view showing both Opponent Eyes and Screen at the same time
  // - "inspect-eyes": Eyes enlarged to hero view, Screen in live companion PIP
  // - "inspect-screen": Screen enlarged to hero view, Eyes in live companion PIP
  const [viewMode, setViewMode] = useState<"dual" | "inspect-eyes" | "inspect-screen">("dual");
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [isTheaterExpanded, setIsTheaterExpanded] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [audioBlocked, setAudioBlocked] = useState<boolean>(false);
  const [remoteVideoLive, setRemoteVideoLive] = useState<boolean>(() => streamHasLiveVideo(remoteStream));
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isRemoteSpeaking = useSpeakingMeter(remoteStream, callState === "connected" || callState === "reconnecting");
  const isLocalSpeaking = useSpeakingMeter(localStream, !isMicMuted);

  const formatDuration = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // 1. Audio playback (Always single-source raw audio element)
  useEffect(() => {
    const audioEl = audioRef.current;
    if (!remoteStream) {
      if (audioEl) audioEl.srcObject = null;
      setAudioBlocked(false);
      return;
    }
    if (!audioEl) return;
    if (audioEl.srcObject !== remoteStream) audioEl.srcObject = remoteStream;
    audioEl.volume = 1.0;
    audioEl.muted = false;

    const tryPlay = () => {
      const p = audioEl.play();
      if (p && typeof p.then === "function") {
        p.then(() => setAudioBlocked(false)).catch((err) => {
          console.warn("Audio autoplay restricted by browser policy:", err);
          setAudioBlocked(true);
        });
      }
    };
    tryPlay();

    const audioTracks = remoteStream.getAudioTracks();
    audioTracks.forEach((t) => t.addEventListener("unmute", tryPlay));
    return () => {
      audioTracks.forEach((t) => t.removeEventListener("unmute", tryPlay));
    };
  }, [remoteStream, audioRef]);

  // Global user-gesture unblock for audio
  useEffect(() => {
    if (!audioBlocked) return;
    const unlockAudio = () => {
      const el = audioRef.current;
      if (el) el.play().then(() => setAudioBlocked(false)).catch(() => {});
    };
    window.addEventListener("click", unlockAudio, { once: true });
    window.addEventListener("touchstart", unlockAudio, { once: true });
    return () => {
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
    };
  }, [audioBlocked, audioRef]);

  // Track whether remote camera delivers frames
  useEffect(() => {
    setRemoteVideoLive(streamHasLiveVideo(remoteStream));
    if (!remoteStream) return;
    const tracks = remoteStream.getVideoTracks();
    const refresh = () => setRemoteVideoLive(streamHasLiveVideo(remoteStream));
    tracks.forEach((t) => {
      t.addEventListener("mute", refresh);
      t.addEventListener("unmute", refresh);
      t.addEventListener("ended", refresh);
    });
    return () => {
      tracks.forEach((t) => {
        t.removeEventListener("mute", refresh);
        t.removeEventListener("unmute", refresh);
        t.removeEventListener("ended", refresh);
      });
    };
  }, [remoteStream]);

  // 2. Bind remote eyes video (Opponent Face / Camera)
  const setRemoteEyesVideoEl = useCallback((el: HTMLVideoElement | null) => {
    remoteEyesVideoRef.current = el;
    if (el) {
      el.muted = true;
      el.defaultMuted = true;
      if (remoteStream && el.srcObject !== remoteStream) el.srcObject = remoteStream;
      el.play().catch(() => {});
    }
  }, [remoteStream]);

  useEffect(() => {
    const el = remoteEyesVideoRef.current;
    if (el) {
      el.muted = true;
      el.defaultMuted = true;
      if (remoteStream && el.srcObject !== remoteStream) el.srcObject = remoteStream;
      el.play().catch(() => {});
    }
  }, [remoteStream, viewMode, isTheaterExpanded, isMinimized, remoteVideoLive]);

  // 3. Bind remote screen video (Opponent Shared Screen)
  const screenMediaStream = remoteScreenStream || (isRemoteScreenSharing ? remoteStream : null);
  const setRemoteScreenVideoEl = useCallback((el: HTMLVideoElement | null) => {
    remoteScreenVideoRef.current = el;
    if (el) {
      el.muted = true;
      el.defaultMuted = true;
      if (screenMediaStream && el.srcObject !== screenMediaStream) el.srcObject = screenMediaStream;
      el.play().catch(() => {});
    }
  }, [screenMediaStream]);

  useEffect(() => {
    const el = remoteScreenVideoRef.current;
    if (el) {
      el.muted = true;
      el.defaultMuted = true;
      if (screenMediaStream && el.srcObject !== screenMediaStream) el.srcObject = screenMediaStream;
      el.play().catch(() => {});
    }
  }, [screenMediaStream, viewMode, isTheaterExpanded, isMinimized, isRemoteScreenSharing]);

  // 4. Bind local video (You)
  const setLocalVideoEl = useCallback((el: HTMLVideoElement | null) => {
    localVideoRef.current = el;
    if (el) {
      el.muted = true;
      el.defaultMuted = true;
      if (localStream && el.srcObject !== localStream) el.srcObject = localStream;
      el.play().catch(() => {});
    }
  }, [localStream]);

  useEffect(() => {
    const el = localVideoRef.current;
    if (el) {
      el.muted = true;
      el.defaultMuted = true;
      if (localStream && el.srcObject !== localStream) el.srcObject = localStream;
      el.play().catch(() => {});
    }
  }, [localStream, isVideoMuted, isMinimized]);

  // Auto-hide controls timer
  const triggerControls = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 5000);
  };

  if (isIdleLike(callState)) return null;

  const hasRemoteEyesVideo = Boolean(isRemoteVideoEnabled && remoteVideoLive);
  const hasRemoteScreenStream = Boolean(isRemoteScreenSharing && streamHasLiveVideo(screenMediaStream));

  const hasLocalVideo = Boolean(
    !isVideoMuted &&
    localStream &&
    localStream.getVideoTracks().length > 0 &&
    localStream.getVideoTracks().some((t) => t.enabled)
  );

  const canScreenShare =
    typeof onToggleScreenShare === "function" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function";

  const isLive = callState === "connected";
  const isRecovering = isReconnecting || callState === "reconnecting";

  const statusText = isRecovering
    ? "Reconnecting…"
    : callState === "connected"
    ? formatDuration(callDuration)
    : callState === "calling"
    ? "Calling…"
    : callState === "ringing"
    ? "Incoming call…"
    : "Connecting…";

  // Opponent color for board perspective
  const opponentColor: "W" | "B" = yourColor === "W" ? "B" : "W";

  // Render a live opponent board perspective for Frame 2 when OS screen share is idle
  const miniBoardSquares = useMemo(() => {
    // 10x10 squares mapped from opponent's perspective
    const squares: { sq: number; row: number; col: number; isDark: boolean; piece: Piece }[] = [];
    const flipForOpponent = opponentColor === "B";
    for (let r = 0; r < 10; r++) {
      const actualRow = flipForOpponent ? 9 - r : r;
      for (let c = 0; c < 10; c++) {
        const actualCol = flipForOpponent ? 9 - c : c;
        const isDark = (actualRow + actualCol) % 2 === 1;
        let sq = 0;
        if (isDark) {
          sq = actualRow * 5 + Math.floor(actualCol / 2) + 1;
        }
        squares.push({
          sq,
          row: r,
          col: c,
          isDark,
          piece: (board && sq > 0) ? board[sq] : null,
        });
      }
    }
    return squares;
  }, [board, opponentColor]);

  // Handler for tapping into Frame 1 (Eyes)
  const handleTapEyes = () => {
    if (viewMode === "inspect-eyes") {
      setViewMode("dual");
    } else {
      setViewMode("inspect-eyes");
    }
  };

  // Handler for tapping into Frame 2 (Screen)
  const handleTapScreen = () => {
    if (viewMode === "inspect-screen") {
      setViewMode("dual");
    } else {
      setViewMode("inspect-screen");
    }
  };

  // Swap hero view between Eyes and Screen
  const handleSwapInspect = () => {
    setViewMode((prev) => (prev === "inspect-eyes" ? "inspect-screen" : "inspect-eyes"));
  };

  return (
    <>
      {/* Invisible audio element for remote voice playback */}
      <audio
        ref={audioRef}
        autoPlay
        playsInline
        className="hidden"
        aria-hidden="true"
      />

      <div className="fixed z-[95] pointer-events-none select-none">
        {/* Minimized Pill Capsule View */}
        {isMinimized ? (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            drag
            dragMomentum={false}
            className={`fixed bottom-20 right-4 sm:bottom-6 sm:right-6 pointer-events-auto bg-slate-950/95 border rounded-full p-2 pr-4 shadow-2xl backdrop-blur-xl flex items-center gap-2.5 cursor-grab active:cursor-grabbing transition ${
              isRemoteSpeaking ? "border-cyan-400 ring-2 ring-cyan-500/30" : "border-slate-800"
            }`}
          >
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-600 to-amber-600 border border-amber-400/40 flex items-center justify-center text-white font-bold text-xs shadow-md">
                {opponentName ? opponentName.charAt(0).toUpperCase() : "P"}
              </div>
              <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-slate-950 ${isRemoteSpeaking ? "bg-cyan-400 animate-ping" : isRecovering ? "bg-amber-500 animate-pulse" : "bg-emerald-500 animate-pulse"}`} />
            </div>

            <div className="flex flex-col text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-black text-white leading-tight truncate max-w-[90px]">{opponentName}</span>
                {isRemoteSpeaking && <Volume2 className="w-3 h-3 text-cyan-400 animate-pulse" />}
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-800 text-[8px] font-mono text-cyan-300 border border-cyan-500/30">
                  <Eye className="w-2.5 h-2.5" />
                  <Monitor className="w-2.5 h-2.5 text-emerald-400" />
                </div>
              </div>
              <span className="text-[9px] font-mono text-amber-400 leading-tight flex items-center gap-1">
                {isRecovering && <RefreshCw className="w-2.5 h-2.5 animate-spin text-amber-400" />}
                <span>{statusText}</span>
              </span>
            </div>

            {audioBlocked && (
              <button
                onClick={() => {
                  audioRef.current?.play().then(() => setAudioBlocked(false)).catch(() => {});
                }}
                className="p-1 rounded bg-rose-500/30 text-rose-300 border border-rose-500/40 text-[9px] font-bold flex items-center gap-1 cursor-pointer animate-pulse"
                title="Tap to unblock opponent audio"
              >
                <VolumeX className="w-3 h-3" /> Unmute
              </button>
            )}

            <button
              onClick={() => setIsMinimized(false)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
              title="Expand Arena Video Call"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ) : (
          /* High-Class Arena Dual Deck (Never Shrinks the Board) */
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 15 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 15 }}
            drag={!isTheaterExpanded}
            dragMomentum={false}
            onMouseMove={triggerControls}
            onTouchStart={triggerControls}
            className={`fixed pointer-events-auto transition-all duration-300 bg-slate-950/95 border rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-2xl overflow-hidden flex flex-col ${
              isRemoteSpeaking ? "ring-2 ring-cyan-500/40 border-cyan-500/50 shadow-[0_0_30px_rgba(6,182,212,0.2)]" : "border-slate-800"
            } ${
              isTheaterExpanded
                ? "top-3 left-3 right-3 bottom-3 sm:top-6 sm:left-1/2 sm:-translate-x-1/2 sm:w-[min(96vw,840px)] sm:bottom-6 z-[98] border-amber-500/50 ring-1 ring-amber-500/30 shadow-[0_0_60px_rgba(245,158,11,0.25)]"
                : viewMode === "dual"
                ? "top-14 right-3 sm:top-16 sm:right-6 w-[min(94vw,430px)] sm:w-[460px] cursor-grab active:cursor-grabbing hover:border-slate-700"
                : "top-14 right-3 sm:top-16 sm:right-6 w-[min(94vw,380px)] sm:w-[420px] cursor-grab active:cursor-grabbing hover:border-slate-700"
            }`}
          >
            {/* Top Deck Glass Header */}
            <div className="px-3 py-2 bg-gradient-to-r from-slate-950/95 via-slate-900/90 to-slate-950/95 border-b border-slate-800/80 flex items-center justify-between pointer-events-auto">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex h-2.5 w-2.5 relative shrink-0">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isLive ? "bg-cyan-400" : "bg-amber-400"}`} />
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isLive ? "bg-cyan-500" : "bg-amber-500"}`} />
                </span>

                <div className="flex items-center gap-1.5 truncate">
                  <span className="text-xs font-black text-white tracking-wide truncate max-w-[110px]">
                    {opponentName || "Opponent"}
                  </span>
                  {isRemoteSpeaking && <Volume2 className="w-3 h-3 text-cyan-400 animate-pulse shrink-0" />}
                </div>

                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[9px] font-mono font-bold uppercase shrink-0">
                  {isRecovering && <RefreshCw className="w-2.5 h-2.5 animate-spin text-amber-400" />}
                  <span>{statusText}</span>
                </div>

                <NetworkQualityBadge networkQuality={networkQuality} />
              </div>

              {/* Header Right Actions */}
              <div className="flex items-center gap-1 shrink-0">
                {audioBlocked && (
                  <button
                    onClick={() => {
                      audioRef.current?.play().then(() => setAudioBlocked(false)).catch(() => {});
                    }}
                    className="p-1 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[9px] font-bold flex items-center gap-1 cursor-pointer animate-pulse"
                    title="Tap to allow peer audio playback"
                  >
                    <VolumeX className="w-3 h-3" /> Unmute
                  </button>
                )}

                {/* View Mode Mode Toggler (Dual vs Inspect) */}
                {viewMode !== "dual" && (
                  <button
                    onClick={() => setViewMode("dual")}
                    className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition text-[9px] font-mono font-bold flex items-center gap-1 cursor-pointer"
                    title="Show Both Frames Side by Side"
                  >
                    <Layers className="w-3 h-3 text-amber-400" /> Dual
                  </button>
                )}

                {/* Swap Frames button (when inspecting one) */}
                {viewMode !== "dual" && (
                  <button
                    onClick={handleSwapInspect}
                    className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 transition cursor-pointer"
                    title="Swap Hero and Companion Frames (Eyes ⇄ Screen)"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                  </button>
                )}

                {/* Minimize to Pill */}
                {!isTheaterExpanded && (
                  <button
                    onClick={() => setIsMinimized(true)}
                    className="p-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                    title="Minimize to Pill"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                )}

                {/* Theater / Fullscreen toggle */}
                <button
                  onClick={() => setIsTheaterExpanded(!isTheaterExpanded)}
                  className="p-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                  title={isTheaterExpanded ? "Exit Theater Mode" : "Expand Arena View"}
                >
                  {isTheaterExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Media Deck Container (Dual Frames) */}
            <div className="relative w-full bg-slate-950 p-2 sm:p-2.5 flex flex-col gap-2 overflow-hidden">
              {/* LAYOUT A: DUAL SIDE-BY-SIDE FRAMES (Shows BOTH Eyes and Screen at the exact same time!) */}
              {viewMode === "dual" && (
                <div className="grid grid-cols-2 gap-2 w-full h-[140px] sm:h-[170px]">
                  {/* FRAME 1: OPPONENT EYES / FACE CAM */}
                  <div
                    onClick={handleTapEyes}
                    className={`relative rounded-xl overflow-hidden border bg-slate-900 flex flex-col cursor-pointer transition-all duration-300 group hover:border-cyan-400 hover:shadow-[0_0_15px_rgba(6,182,212,0.25)] ${
                      isRemoteSpeaking ? "border-cyan-400/80 ring-2 ring-cyan-500/40" : "border-slate-800"
                    }`}
                  >
                    {/* Badge */}
                    <div className="absolute top-1.5 left-1.5 z-20 flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-950/85 border border-cyan-500/40 text-[8.5px] font-mono font-bold text-cyan-300 shadow">
                      <Eye className="w-2.5 h-2.5 text-cyan-400" />
                      <span>EYES CAM</span>
                    </div>

                    <div className="absolute top-1.5 right-1.5 z-20 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition px-1.5 py-0.5 rounded bg-cyan-500/90 text-slate-950 text-[8px] font-mono font-black shadow">
                      <ZoomIn className="w-2.5 h-2.5" /> Inspect
                    </div>

                    {hasRemoteEyesVideo ? (
                      <video
                        ref={setRemoteEyesVideoEl}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover transform scale-100 group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      /* Standby Eyes Avatar */
                      <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center bg-gradient-to-b from-slate-900 to-slate-950">
                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-slate-800 border border-cyan-400/40 flex items-center justify-center text-white font-black text-sm mb-1 shadow ${
                          isRemoteSpeaking ? "ring-2 ring-cyan-400/80 scale-105" : ""
                        }`}>
                          {opponentName ? opponentName.charAt(0).toUpperCase() : "P"}
                        </div>
                        <span className="text-[9px] font-mono text-slate-400 font-bold">Eyes / Cam Standby</span>
                      </div>
                    )}
                  </div>

                  {/* FRAME 2: OPPONENT SCREEN STREAM */}
                  <div
                    onClick={handleTapScreen}
                    className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-900 flex flex-col cursor-pointer transition-all duration-300 group hover:border-emerald-400 hover:shadow-[0_0_15px_rgba(16,185,129,0.25)]"
                  >
                    {/* Badge */}
                    <div className="absolute top-1.5 left-1.5 z-20 flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-950/85 border border-emerald-500/40 text-[8.5px] font-mono font-bold text-emerald-300 shadow">
                      <Monitor className="w-2.5 h-2.5 text-emerald-400" />
                      <span>{hasRemoteScreenStream ? "SCREEN LIVE" : "SCREEN FEED"}</span>
                    </div>

                    <div className="absolute top-1.5 right-1.5 z-20 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition px-1.5 py-0.5 rounded bg-emerald-500/90 text-slate-950 text-[8px] font-mono font-black shadow">
                      <ZoomIn className="w-2.5 h-2.5" /> Inspect
                    </div>

                    {hasRemoteScreenStream ? (
                      <video
                        ref={setRemoteScreenVideoEl}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-contain bg-black"
                      />
                    ) : (
                      /* Live Opponent Board Screen Mirror */
                      <div className="w-full h-full flex flex-col items-center justify-center p-1.5 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900">
                        {/* Mini draughts 10x10 board mirror */}
                        <div className="w-20 h-20 sm:w-24 sm:h-24 grid grid-cols-10 border border-emerald-500/40 rounded-md overflow-hidden bg-amber-950/20 shadow">
                          {miniBoardSquares.map((sqData, i) => (
                            <div
                              key={i}
                              className={`w-full h-full flex items-center justify-center ${
                                sqData.isDark ? "bg-amber-950/70" : "bg-amber-100/10"
                              }`}
                            >
                              {sqData.piece && (
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                  sqData.piece.toLowerCase() === "w"
                                    ? "bg-amber-100 border border-amber-300 shadow-[0_0_2px_rgba(255,255,255,0.8)]"
                                    : "bg-slate-950 border border-slate-700 shadow-[0_0_2px_rgba(0,0,0,0.8)]"
                                }`} />
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-1 text-[8px] font-mono text-emerald-400 font-bold mt-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                          <span>Opponent Perspective</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* LAYOUT B: INSPECT MODE (Hero Enlarged Frame + Companion Live PIP) */}
              {viewMode !== "dual" && (
                <div className={`relative w-full rounded-xl overflow-hidden border border-slate-800 bg-slate-950 ${
                  isTheaterExpanded ? "h-[320px] sm:h-[420px]" : "h-[190px] sm:h-[220px]"
                }`}>
                  {/* Hero Inspected Frame */}
                  {viewMode === "inspect-eyes" ? (
                    /* HERO: OPPONENT EYES */
                    <div className="w-full h-full relative">
                      <div className="absolute top-2 left-2 z-20 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-950/90 border border-cyan-500/50 text-[10px] font-mono font-bold text-cyan-300 shadow">
                        <Eye className="w-3.5 h-3.5 text-cyan-400" />
                        <span>INSPECTING OPPONENT EYES (HD)</span>
                      </div>

                      {hasRemoteEyesVideo ? (
                        <video
                          ref={setRemoteEyesVideoEl}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-slate-900">
                          <div className={`w-16 h-16 rounded-2xl bg-cyan-600/30 border border-cyan-400 flex items-center justify-center text-white font-black text-2xl mb-2 ${
                            isRemoteSpeaking ? "ring-4 ring-cyan-400/80 scale-105" : ""
                          }`}>
                            {opponentName ? opponentName.charAt(0).toUpperCase() : "P"}
                          </div>
                          <span className="text-xs font-mono text-slate-300 font-bold">Opponent Eyes / Camera Off</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* HERO: OPPONENT SCREEN */
                    <div className="w-full h-full relative">
                      <div className="absolute top-2 left-2 z-20 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-950/90 border border-emerald-500/50 text-[10px] font-mono font-bold text-emerald-300 shadow">
                        <Monitor className="w-3.5 h-3.5 text-emerald-400" />
                        <span>INSPECTING OPPONENT SCREEN</span>
                      </div>

                      {hasRemoteScreenStream ? (
                        <video
                          ref={setRemoteScreenVideoEl}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-full object-contain bg-black"
                        />
                      ) : (
                        /* Large Live Board Screen Feed */
                        <div className="w-full h-full flex flex-col items-center justify-center p-3 bg-gradient-to-b from-slate-900 to-slate-950">
                          <div className="w-32 h-32 sm:w-40 sm:h-40 grid grid-cols-10 border border-emerald-500/50 rounded-xl overflow-hidden bg-amber-950/30 shadow-2xl">
                            {miniBoardSquares.map((sqData, i) => (
                              <div
                                key={i}
                                className={`w-full h-full flex items-center justify-center ${
                                  sqData.isDark ? "bg-amber-950/70" : "bg-amber-100/10"
                                }`}
                              >
                                {sqData.piece && (
                                  <span className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full ${
                                    sqData.piece.toLowerCase() === "w"
                                      ? "bg-amber-100 border border-amber-300 shadow-[0_0_4px_rgba(255,255,255,0.9)]"
                                      : "bg-slate-950 border border-slate-700 shadow-[0_0_4px_rgba(0,0,0,0.9)]"
                                  }`} />
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400 font-bold mt-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                            <span>Opponent Live Screen Feed ({opponentColor === "W" ? "White" : "Black"} Perspective)</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Companion Live PIP (Opposite Frame remains 100% active in corner) */}
                  <div
                    onClick={handleSwapInspect}
                    className="absolute bottom-2 right-2 z-20 w-24 sm:w-32 h-16 sm:h-22 rounded-lg border border-amber-500/50 bg-slate-900 overflow-hidden shadow-2xl cursor-pointer hover:scale-105 transition-transform group"
                    title="Tap to Swap Primary View"
                  >
                    <div className="absolute top-1 left-1 z-20 px-1 py-0.5 rounded bg-slate-950/90 text-[7.5px] font-mono text-amber-300 font-bold flex items-center gap-1">
                      {viewMode === "inspect-eyes" ? <Monitor className="w-2 h-2" /> : <Eye className="w-2 h-2" />}
                      <span>{viewMode === "inspect-eyes" ? "SCREEN" : "EYES"}</span>
                    </div>

                    {viewMode === "inspect-eyes" ? (
                      /* Companion: Screen */
                      hasRemoteScreenStream ? (
                        <video
                          ref={setRemoteScreenVideoEl}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-slate-900 text-[8px] font-mono text-emerald-400">
                          <Monitor className="w-4 h-4 text-emerald-400" />
                        </div>
                      )
                    ) : (
                      /* Companion: Eyes */
                      hasRemoteEyesVideo ? (
                        <video
                          ref={setRemoteEyesVideoEl}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-slate-900 text-[8px] font-mono text-cyan-400">
                          <Eye className="w-4 h-4 text-cyan-400" />
                        </div>
                      )
                    )}

                    <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-[8px] font-mono font-bold text-white">
                      Swap ⇄
                    </div>
                  </div>
                </div>
              )}

              {/* Local Video PIP Badge (You) */}
              {hasLocalVideo && (
                <div className="absolute bottom-3 left-3 z-20 w-16 sm:w-20 h-12 sm:h-15 rounded-lg border border-cyan-500/40 bg-slate-900 overflow-hidden shadow-xl">
                  <video
                    ref={setLocalVideoEl}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover transform scale-x-[-1]"
                  />
                  <div className="absolute bottom-0.5 left-1 px-1 py-0.2 rounded bg-slate-950/85 text-[7px] font-mono text-cyan-300 font-bold flex items-center gap-1">
                    <span>You</span>
                    {isLocalSpeaking && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />}
                  </div>
                </div>
              )}

              {/* Screen Sharing Active Badge for Local user */}
              {isScreenSharing && (
                <div className="absolute top-2.5 left-2.5 z-20 px-1.5 py-0.5 rounded bg-emerald-500 text-slate-950 text-[8px] font-black uppercase tracking-wider flex items-center gap-1 shadow">
                  <ScreenShare className="w-2.5 h-2.5" /> Sharing Your Screen
                </div>
              )}

              {/* Reconnection Overlay */}
              <AnimatePresence>
                {isRecovering && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-30 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-3 text-center select-none"
                  >
                    <RefreshCw className="w-6 h-6 animate-spin text-amber-400 mb-1" />
                    <span className="text-xs font-bold text-white">Reconnecting Media Stream…</span>
                    <span className="text-[9px] text-slate-400">Attempt {renegotiationAttempt} of {maxRenegotiationAttempts}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Broadcast Bottom Action Controls */}
            <AnimatePresence>
              {(showControls || isTheaterExpanded) && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="px-3 py-2 bg-gradient-to-r from-slate-950/95 via-slate-900 to-slate-950/95 border-t border-slate-800/80 flex items-center justify-between pointer-events-auto"
                >
                  <div className="flex items-center gap-1.5">
                    {/* Mic Toggle */}
                    <button
                      onClick={onToggleMic}
                      className={`p-2 rounded-full transition cursor-pointer flex items-center justify-center shrink-0 ${
                        isMicMuted
                          ? "bg-rose-500 text-white hover:bg-rose-600 shadow"
                          : isLocalSpeaking
                          ? "bg-cyan-500 text-slate-950 ring-2 ring-cyan-400 shadow-md scale-105"
                          : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                      }`}
                      title={isMicMuted ? "Unmute Microphone" : "Mute Microphone"}
                    >
                      {isMicMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                    </button>

                    {/* Camera Toggle */}
                    <button
                      onClick={onToggleVideo}
                      className={`p-2 rounded-full transition cursor-pointer flex items-center justify-center shrink-0 ${
                        isVideoMuted
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30"
                          : "bg-cyan-600 text-white hover:bg-cyan-500 shadow"
                      }`}
                      title={isVideoMuted ? "Turn On Camera" : "Turn Off Camera"}
                    >
                      {isVideoMuted ? <VideoOff className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
                    </button>

                    {/* Flip Camera (Mobile) */}
                    {onFlipCamera && hasLocalVideo && (
                      <button
                        onClick={onFlipCamera}
                        className="p-2 rounded-full bg-slate-800 text-slate-200 hover:bg-slate-700 transition cursor-pointer flex items-center justify-center shrink-0"
                        title="Flip Camera (Front/Back)"
                      >
                        <SwitchCamera className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Screen Share Toggle */}
                    {canScreenShare && (
                      <button
                        onClick={onToggleScreenShare}
                        className={`p-2 rounded-full transition cursor-pointer flex items-center justify-center shrink-0 ${
                          isScreenSharing
                            ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-md"
                            : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                        }`}
                        title={isScreenSharing ? "Stop Sharing Screen" : "Share Device Screen"}
                      >
                        {isScreenSharing ? <ScreenShareOff className="w-3.5 h-3.5" /> : <ScreenShare className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>

                  {/* Right side: View switch hint & Hang up */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setViewMode((prev) => (prev === "dual" ? "inspect-eyes" : prev === "inspect-eyes" ? "inspect-screen" : "dual"))}
                      className="px-2 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-[9px] font-mono text-slate-300 hover:text-white transition flex items-center gap-1 cursor-pointer"
                      title="Cycle View Modes"
                    >
                      <Layers className="w-3 h-3 text-cyan-400" />
                      <span>{viewMode === "dual" ? "Dual View" : viewMode === "inspect-eyes" ? "Eyes Focus" : "Screen Focus"}</span>
                    </button>

                    {/* Hang Up */}
                    <button
                      onClick={onEndCall}
                      className="p-2 rounded-full bg-rose-600 hover:bg-rose-500 text-white transition cursor-pointer flex items-center justify-center shadow-lg shadow-rose-950 shrink-0"
                      title="End Video Call"
                    >
                      <PhoneOff className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </>
  );
}
