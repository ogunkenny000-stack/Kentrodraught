import React from "react";
import { Mic, MicOff, PhoneOff, RefreshCw } from "lucide-react";
import type { CallState } from "../../lib/useWebRTCCall";

interface VoiceCallModalProps {
  isOpen: boolean;
  targetUsername: string;
  /** Accepts the full hook state; the lounge's local fallback only uses a subset. */
  callState: CallState | "calling" | "ringing" | "connected" | "ended";
  callDuration: number;
  isMicMuted: boolean;
  onToggleMic: () => void;
  onEndCall: () => void;
}

const CLOSED_STATES: ReadonlyArray<string> = ["idle", "ended", "failed", "failed-network", "unsupported"];

export const VoiceCallModal: React.FC<VoiceCallModalProps> = ({
  isOpen,
  targetUsername,
  callState,
  callDuration,
  isMicMuted,
  onToggleMic,
  onEndCall
}) => {
  if (!isOpen || CLOSED_STATES.includes(callState)) return null;

  const formatSecs = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const isLive = callState === "connected";
  const isRecovering = callState === "reconnecting";

  const statusLine =
    callState === "calling"
      ? "Calling opponent..."
      : callState === "ringing"
      ? "Opponent phone ringing..."
      : callState === "connecting"
      ? "Connecting..."
      : isRecovering
      ? `Reconnecting • ${formatSecs(callDuration)}`
      : `Connected • ${formatSecs(callDuration)}`;

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-sm bg-[#0a0d1d] border border-amber-500/30 rounded-3xl shadow-2xl p-6 flex flex-col items-center gap-6 text-center">
        {/* Calling Header */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-[10px] text-amber-400 font-bold uppercase tracking-widest bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-full">
            KentroDraught Direct Voice
          </span>
          <span className="text-xs text-slate-400 font-mono mt-1 flex items-center gap-1.5">
            {isRecovering && <RefreshCw className="w-3 h-3 animate-spin text-amber-400" />}
            {statusLine}
          </span>
        </div>

        {/* Pulsing Avatar */}
        <div className="relative my-2">
          <div className="w-24 h-24 rounded-full bg-slate-900 border-2 border-amber-500 flex items-center justify-center text-4xl shadow-2xl relative z-10">
            {targetUsername.charAt(0).toUpperCase()}
          </div>
          {!isLive && (
            <>
              <div className="absolute inset-0 rounded-full bg-amber-500/20 animate-ping -z-0" />
              <div className="absolute -inset-3 rounded-full border border-amber-500/40 animate-pulse -z-0" />
            </>
          )}
        </div>

        {/* Player Name */}
        <div className="flex flex-col items-center">
          <h2 className="text-lg font-black text-white font-sans">
            @{targetUsername}
          </h2>
          <span className="text-xs text-slate-400">
            KentroDraught Tactician
          </span>
        </div>

        {/* Audio Equalizer visual when connected */}
        {isLive && (
          <div className="flex items-center gap-1.5 h-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="w-1 bg-emerald-400 rounded-full animate-pulse"
                style={{
                  height: `${25 + Math.random() * 75}%`,
                  animationDuration: `${0.3 + i * 0.08}s`
                }}
              />
            ))}
          </div>
        )}

        {/* Call Controls */}
        <div className="flex items-center gap-4 mt-2">
          {/* Mute Button */}
          <button
            onClick={onToggleMic}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition cursor-pointer border ${
              isMicMuted
                ? "bg-rose-500/20 border-rose-500/50 text-rose-400"
                : "bg-slate-900 border-slate-800 text-slate-200 hover:text-white hover:border-slate-700"
            }`}
            title={isMicMuted ? "Unmute Microphone" : "Mute Microphone"}
          >
            {isMicMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {/* End Call Button */}
          <button
            onClick={onEndCall}
            className="w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-lg shadow-rose-600/30 transition transform hover:scale-105 active:scale-95 cursor-pointer"
            title="End Call"
          >
            <PhoneOff className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );
};
