import React, { useState, useEffect, useRef } from "react";
import { Avatar } from "../ui/Avatar";
import { motion, AnimatePresence } from "motion/react";
import {
  User, Eye, RefreshCw, Plus, X, Mic, MicOff, Square, Play, Pause, Volume1, Check, Copy, Share2,
  Phone, PhoneOff, Video, VideoOff, SwitchCamera, Sparkles, ScreenShare, ScreenShareOff,
} from "lucide-react";
import { signOutUser } from "../../supabase";
import { MIN_MATCH_WAGER, MAX_MATCH_WAGER, MATCH_WAGER_STEP, ALLOWED_BEST_OF, BEST_OF_LABELS, SeriesInfo } from "../../lib/constants";
import { KENTRO_COINS_ENABLED } from "../../lib/coinFeatureFlag";
import { AdminTappableName } from "../../lib/adminProfileContext";
import { getAudioContext } from "../../lib/audio";
import { KentroCoin, CoinBadge } from "../ui/KentroCoin";
import { copyInviteText, makeRoomInviteUrl } from "../../lib/roomInvite";

export type SpecialRule = "none" | "short-one" | "short-two" | "short-three" | "crown-crown" | "no-kentrodraught";
export type VoiceCallState = "idle" | "calling" | "ringing" | "connecting" | "connected" | "reconnecting" | "failed" | "failed-network" | "unsupported" | "ended";

export interface LiveRoomSummary {
  roomId: string;
  white: string;
  black: string;
  gameTime: number;
  specialRule: string;
  spectatorCount: number;
}

export interface RoomPlayer {
  username: string;
  color: "W" | "B";
  ready: boolean;
}

export interface MultiplayerMessage {
  from: string;
  text: string;
  voiceDuration?: number;
}

/**
 * Voice note bubble with a simulated playback progress bar.
 *
 * Previously this component was declared *inside* renderMultiplayerPanel,
 * meaning React saw a brand-new component type on every App render and
 * remounted every bubble (resetting playback). Hoisted to module scope,
 * identity is now stable.
 */
function VoiceNotePlayer({
  msgId,
  duration,
  playingVoiceId,
  setPlayingVoiceId,
}: {
  msgId: string;
  duration: number;
  playingVoiceId: string | null;
  setPlayingVoiceId: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const isPlaying = playingVoiceId === msgId;
  const [progress, setProgress] = useState(0);
  const progressTimerRef = useRef<any>(null);

  useEffect(() => {
    if (isPlaying) {
      setProgress(0);
      progressTimerRef.current = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 100) {
            clearInterval(progressTimerRef.current);
            setPlayingVoiceId(null);
            return 100;
          }
          return prev + (100 / (duration * 10));
        });
      }, 100);
    } else {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      setProgress(0);
    }
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, [isPlaying, duration, setPlayingVoiceId]);

  const handleTogglePlay = () => {
    if (isPlaying) {
      setPlayingVoiceId(null);
    } else {
      setPlayingVoiceId(msgId);
      try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(320, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(480, ctx.currentTime + 0.35);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } catch (e) {}
    }
  };

  return (
    <div className="flex items-center gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800 mt-1 shrink-0 select-none w-full max-w-[200px]">
      <button
        type="button"
        onClick={handleTogglePlay}
        className="w-7 h-7 rounded-full bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center justify-center cursor-pointer transition shrink-0"
      >
        {isPlaying ? <Pause className="w-3 h-3 fill-slate-950 stroke-none" /> : <Play className="w-3 h-3 fill-slate-950 stroke-[2.5]" />}
      </button>

      <div className="flex-grow flex flex-col gap-1">
        <div className="flex items-center gap-[2px] h-5 px-1">
          {Array.from({ length: 12 }).map((_, i) => {
            const h = Math.abs(Math.sin(i * 0.4)) * 10 + 4;
            const active = isPlaying && progress > (i / 12) * 100;
            return (
              <span
                key={i}
                className={`w-[2.5px] rounded-full transition-all duration-150 ${
                  active ? "bg-amber-500 h-4" : "bg-slate-700 h-1.5"
                }`}
                style={{ height: active ? `${h + 3}px` : `${h}px` }}
              />
            );
          })}
        </div>
        <div className="flex justify-between items-center text-[7px] font-mono font-bold text-slate-500">
          <span>{isPlaying ? `0:0${Math.floor((progress / 100) * duration)}` : `0:0${duration}`}</span>
          <span className="flex items-center gap-0.5">
            <Volume1 className="w-2 h-2 text-slate-500" />
            VOICE
          </span>
        </div>
      </div>
    </div>
  );
}

export interface MultiplayerPanelProps {
  username: string | null;
  connectionStatus: "disconnected" | "connecting" | "connected";
  ws: WebSocket | null;
  roomId: string | null;
  roomError: string | null;
  roomInput: string;
  setRoomInput: React.Dispatch<React.SetStateAction<string>>;
  onlineUsers: string[];
  liveRoomsList: LiveRoomSummary[];
  onFetchLiveRooms: () => void;
  onSpectateRoom: (roomId: string) => void;
  /** Join by code -- routed through App so a pending join is replayed after a reconnect. */
  onJoinRoom: (code: string) => void;
  /** Every outbound message goes through the socket manager (queue / refuse / reconnect). */
  sendMessage: (msg: { type: string } & Record<string, unknown>) => boolean;
  /** Exit the room; App confirms first while a game is in progress (contract section 7). */
  onLeaveRoom: () => void;
  /** Offer a rematch (ended phase only; the opponent must accept). */
  onRequestRematch: () => void;
  /** Server room phase, when known. */
  roomPhase?: "lobby" | "setup" | "playing" | "ended" | null;
  // Host setup modal
  showHostSetupModal: boolean;
  setShowHostSetupModal: React.Dispatch<React.SetStateAction<boolean>>;
  setupGameTime: number;
  setSetupGameTime: React.Dispatch<React.SetStateAction<number>>;
  setupUnevenTime: boolean;
  setSetupUnevenTime: React.Dispatch<React.SetStateAction<boolean>>;
  setupHostTime: number;
  setSetupHostTime: React.Dispatch<React.SetStateAction<number>>;
  setupGuestTime: number;
  setSetupGuestTime: React.Dispatch<React.SetStateAction<number>>;
  setupSpecialRule: SpecialRule;
  setSetupSpecialRule: React.Dispatch<React.SetStateAction<SpecialRule>>;
  setupWagerAmount: number;
  setSetupWagerAmount: React.Dispatch<React.SetStateAction<number>>;
  setupBestOf: number;
  setSetupBestOf: React.Dispatch<React.SetStateAction<number>>;
  setupPrivate: boolean;
  setSetupPrivate: React.Dispatch<React.SetStateAction<boolean>>;
  coinBalance: number;
  coinsEnabled?: boolean;
  onConfirmHostSetup: () => void;
  // In-room
  roomPlayers: RoomPlayer[];
  yourColor: "W" | "B" | null;
  isReady: boolean;
  multiplayerStarted: boolean;
  multiplayerWagerAmount: number;
  /** Live Best-of-N series state (null for classic single-game rooms). */
  seriesInfo: SeriesInfo | null;
  isSpectating: boolean;
  spectatorCount: number;
  onLeaveSpectate: () => void;
  // Voice & Video Call
  voiceCallState: VoiceCallState;
  callType?: "voice" | "video";
  voiceMuted: boolean;
  videoMuted?: boolean;
  isScreenSharing?: boolean;
  isRemoteScreenSharing?: boolean;
  onJoinVoiceChat: () => void;
  /** Ring-style call setup */
  outgoingVoiceRinging: boolean;
  onStartVoiceCall: () => void;
  onStartVideoCall?: () => void;
  onCancelVoiceCall: () => void;
  opponentName: string;
  onToggleVoiceMute: () => void;
  onToggleVideoMute?: () => void;
  onToggleScreenShare?: () => void;
  onFlipCamera?: () => void;
  onLeaveVoiceChat: () => void;
  remoteVoiceAudioRef: React.RefObject<HTMLAudioElement | null>;
  /** Why the last call failed (from useWebRTCCall.failureInfo); drives the "Couldn't Connect" surface. */
  callFailure?: { message: string; suggestAudioOnly: boolean } | null;
  // Chat
  multiplayerMessages: MultiplayerMessage[];
  chatInput: string;
  setChatInput: React.Dispatch<React.SetStateAction<string>>;
  isRecording: boolean;
  setIsRecording: React.Dispatch<React.SetStateAction<boolean>>;
  recordingSeconds: number;
  setRecordingSeconds: React.Dispatch<React.SetStateAction<number>>;
  recordingIntervalRef: React.MutableRefObject<any>;
  playingVoiceId: string | null;
  setPlayingVoiceId: React.Dispatch<React.SetStateAction<string | null>>;
  /** Open the head-to-head record between any two players */
  onViewH2H: (playerA: string, playerB: string) => void;
}

/**
 * The multiplayer sidebar: pre-room lobby (identity, live games, match
 * setup, online players) and the in-room view (room code, voice chat,
 * players, ready controls, live chat with voice notes and reactions).
 *
 * Extracted verbatim from App.tsx's renderMultiplayerPanel. Works both as
 * the desktop right-hand sidebar and inside the mobile in-game chat sheet.
 */
export function MultiplayerPanel(props: MultiplayerPanelProps) {
  const {
    username, connectionStatus, roomId, roomError, roomInput, setRoomInput,
    onlineUsers, liveRoomsList, onFetchLiveRooms, onSpectateRoom,
    onJoinRoom, sendMessage, onLeaveRoom, onRequestRematch, roomPhase = null,
    showHostSetupModal, setShowHostSetupModal,
    setupGameTime, setSetupGameTime, setupUnevenTime, setSetupUnevenTime,
    setupHostTime, setSetupHostTime, setupGuestTime, setSetupGuestTime,
    setupSpecialRule, setSetupSpecialRule, setupWagerAmount, setSetupWagerAmount,
    setupBestOf, setSetupBestOf,
    setupPrivate, setSetupPrivate,
    coinBalance, onConfirmHostSetup,
    roomPlayers, yourColor, isReady, multiplayerStarted, multiplayerWagerAmount, seriesInfo,
    isSpectating, spectatorCount, onLeaveSpectate,
    voiceCallState, callType = "voice", voiceMuted, videoMuted = false,
    isScreenSharing = false, isRemoteScreenSharing = false,
    onJoinVoiceChat, onToggleVoiceMute, onToggleVideoMute, onToggleScreenShare, onFlipCamera, onLeaveVoiceChat, remoteVoiceAudioRef,
    callFailure = null,
    outgoingVoiceRinging, onStartVoiceCall, onStartVideoCall, onCancelVoiceCall, opponentName,
    multiplayerMessages, chatInput, setChatInput,
    isRecording, setIsRecording, recordingSeconds, setRecordingSeconds, recordingIntervalRef,
    playingVoiceId, setPlayingVoiceId, onViewH2H,
  } = props;

  const [copiedInRoom, setCopiedInRoom] = useState(false);
  const [copiedWhatsApp, setCopiedWhatsApp] = useState(false);
  const [shareError, setShareError] = useState("");

  const handleCopyRoomCode = async () => {
    if (!roomId) return;
    try {
      await copyInviteText(roomId);
      setCopiedInRoom(true);
      setShareError("");
      setTimeout(() => setCopiedInRoom(false), 2000);
    } catch {
      setShareError("Couldn't copy the room code. You can select it manually.");
    }
  };

  const handleShareToWhatsApp = async () => {
    if (!roomId) return;
    try {
      await copyInviteText(makeRoomInviteUrl(roomId, window.location.origin));
      setCopiedWhatsApp(true);
      setShareError("");
      setTimeout(() => setCopiedWhatsApp(false), 2500);
    } catch {
      setShareError("Couldn't copy the game link. Try Copy Code instead.");
    }
  };

  // Keep the chat stream pinned to the newest message (capped at 200 by App).
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [multiplayerMessages.length, roomId]);

  const gameInProgress = roomPhase === "playing" || roomPhase === "setup";

  if (roomId === null) {
    return (
      <>
      <div className="flex flex-col gap-4 h-full min-h-0 shrink-0">
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-3 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-300 font-mono">Your Identity</span>
            <span className={`text-[9px] border px-2 py-0.5 rounded-full font-mono ${
              connectionStatus === "connected"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse"
            }`}>
              {connectionStatus === "connected" ? "● Connected" : connectionStatus === "connecting" ? "Connecting..." : "Reconnecting..."}
            </span>
          </div>
          <div className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-900">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-bold text-slate-100">{username}</span>
            </div>
            <button
              onClick={() => {
                signOutUser().catch((err) => console.error("Sign out failed:", err));
              }}
              className="text-[10px] text-rose-400 hover:text-rose-300 font-semibold cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>

        {liveRoomsList.length > 0 && (
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-2.5 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider font-mono flex items-center gap-1.5">
                <Eye className="w-3 h-3" /> Live Games
              </span>
              <button onClick={onFetchLiveRooms} className="text-slate-500 hover:text-slate-300 cursor-pointer p-1">
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
            {liveRoomsList.map((r) => (
              <div key={r.roomId} className="flex items-stretch gap-1.5">
                <button
                  onClick={() => onSpectateRoom(r.roomId)}
                  className="flex-1 min-w-0 flex items-center justify-between bg-slate-950 hover:bg-slate-900 border border-slate-900 rounded-xl px-3 py-2.5 transition cursor-pointer"
                >
                  <span className="text-[11px] font-bold text-slate-200 truncate">{r.white} <span className="text-slate-600">vs</span> {r.black}</span>
                  <span className="text-[9px] text-slate-500 font-mono flex items-center gap-1 shrink-0 pl-2">
                    <Eye className="w-2.5 h-2.5" /> {r.spectatorCount}
                  </span>
                </button>
                <button
                  onClick={() => onViewH2H(r.white, r.black)}
                  title="Head-to-head record"
                  className="shrink-0 px-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-400 text-[9px] font-black hover:bg-amber-500/20 transition cursor-pointer"
                >
                  H2H
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-4 shrink-0">
          <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider block font-mono">
            Match Setup
          </span>

          <button
            onClick={() => {
              setSetupGameTime(5);
              setSetupSpecialRule("none");
              setSetupUnevenTime(false);
              setSetupHostTime(5);
              setSetupGuestTime(5);
              setSetupBestOf(1);
              setShowHostSetupModal(true);
            }}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded-xl transition duration-150 flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/20 cursor-pointer text-xs"
          >
            <Plus className="w-4 h-4" />
            Host a Match
          </button>

          <div className="relative flex items-center shrink-0">
            <div className="flex-grow border-t border-slate-850"></div>
            <span className="flex-shrink mx-4 text-[9px] text-slate-500 font-bold uppercase font-mono">Or Join Existing</span>
            <div className="flex-grow border-t border-slate-850"></div>
          </div>

          <form onSubmit={(e) => {
            e.preventDefault();
            if (roomInput.trim() !== "") onJoinRoom(roomInput.trim());
          }} className="flex gap-2">
            <input
              type="text"
              maxLength={6}
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              placeholder="Enter room code"
              className="flex-grow min-w-0 bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 text-slate-100 placeholder-slate-600 text-xs text-center font-bold tracking-widest focus:outline-none focus:border-amber-500 select-text"
            />
            <button
              type="submit"
              className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-3 rounded-xl transition text-xs cursor-pointer animate-pulse"
            >
              Join
            </button>
          </form>

          {roomError && (
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 text-xs text-rose-400 font-medium">
              {roomError}
            </div>
          )}
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-3 flex-grow min-h-[160px] overflow-hidden">
          <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider block font-mono">
            Active Players Online ({onlineUsers.length})
          </span>
          <div className="flex-grow overflow-y-auto bg-slate-950 border border-slate-900 rounded-xl p-3 divide-y divide-slate-900/50">
            {onlineUsers.filter(u => u !== username).length === 0 ? (
              <div className="h-full flex items-center justify-center text-center text-xs text-slate-500 italic font-sans">
                No other players online. Share the URL with a friend to play!
              </div>
            ) : (
              onlineUsers.map((user, idx) => (
                <div key={idx} className="py-2 flex items-center justify-between text-xs text-slate-300">
                  <span className="font-semibold">{user}</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showHostSetupModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/85 flex items-end sm:items-center justify-center sm:p-4"
            onClick={() => setShowHostSetupModal(false)}
          >
            <motion.div
              initial={{ y: 48, opacity: 0.6 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 48, opacity: 0 }}
              transition={{ type: "spring", damping: 30, stiffness: 360 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] w-full sm:max-w-sm flex flex-col gap-4 max-h-[88dvh] overflow-y-auto overscroll-contain"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-extrabold text-slate-100 font-mono">Host a Match</span>
                <button onClick={() => setShowHostSetupModal(false)} className="text-slate-500 hover:text-slate-300 cursor-pointer p-1.5 -mr-1.5">
                  <X className="w-4 h-4" />
                </button>
              </div>              {/* Coin wager -- FIRST thing the host sets, so it's never missed.
                  Host picks the per-player stake; winner takes the whole pot. */}
              {KENTRO_COINS_ENABLED && props.coinsEnabled === true && (
                <div className="bg-gradient-to-br from-amber-950/60 via-slate-950 to-amber-950/40 border-2 border-amber-500/40 rounded-xl p-3 space-y-2.5 shadow-lg shadow-amber-500/10">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-amber-300 font-extrabold uppercase tracking-wide font-mono flex items-center gap-1.5">
                      <KentroCoin size="2xs" glow /> Coins to Wager (per player)
                    </span>
                    <span className="text-sm font-black text-amber-300 font-sans flex items-center gap-1">
                      <KentroCoin size="xs" glow /> {setupWagerAmount.toLocaleString()}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={MIN_MATCH_WAGER}
                    max={MAX_MATCH_WAGER}
                    step={MATCH_WAGER_STEP}
                    value={setupWagerAmount}
                    onChange={(e) => setSetupWagerAmount(parseInt(e.target.value, 10))}
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {[0, 10, 50, 100, 250, 500, 1000].map((preset) => (
                      <button
                        key={preset}
                        onClick={() => setSetupWagerAmount(preset)}
                        className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition cursor-pointer flex items-center gap-1 ${
                          setupWagerAmount === preset
                            ? "bg-amber-500 border-amber-500 text-slate-950 shadow-md font-black"
                            : "bg-slate-900 border-slate-800 text-slate-300 hover:border-amber-500/40"
                        }`}
                      >
                        {preset === 0 ? "Free" : (
                          <>
                            <KentroCoin size="2xs" />
                            {preset}
                          </>
                        )}
                      </button>
                    ))}
                  </div>
                  {/* Exact amount: type any wager, not just slider/preset values.
                      Snapped to the allowed range/step on blur (the server
                      re-validates the same range anyway). */}
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wide shrink-0">Exact amount</span>
                    <div className="relative flex-1 min-w-0 flex items-center">
                      <div className="absolute left-2.5 pointer-events-none">
                        <KentroCoin size="2xs" />
                      </div>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={MAX_MATCH_WAGER}
                        step={MATCH_WAGER_STEP}
                        value={setupWagerAmount}
                        onChange={(e) => {
                          const raw = parseInt(e.target.value, 10);
                          setSetupWagerAmount(Number.isFinite(raw) ? Math.max(0, Math.min(MAX_MATCH_WAGER, raw)) : 0);
                        }}
                        onBlur={() => {
                          setSetupWagerAmount((prev) => {
                            if (prev <= 0) return 0; // free match
                            const stepped = Math.round(prev / MATCH_WAGER_STEP) * MATCH_WAGER_STEP;
                            return Math.min(MAX_MATCH_WAGER, Math.max(MIN_MATCH_WAGER, stepped));
                          });
                        }}
                        className="w-full bg-slate-950 border border-amber-500/30 rounded-lg pl-7 pr-3 py-2 text-xs text-amber-300 font-black font-mono focus:outline-none focus:border-amber-500 select-text"
                      />
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono shrink-0">({MIN_MATCH_WAGER}–{MAX_MATCH_WAGER})</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal font-sans">
                    {setupWagerAmount === 0
                      ? "Free match — no coins staked, just for fun."
                      : (
                        <span className="flex items-center gap-1 flex-wrap">
                          Winner takes full pot:
                          <strong className="text-amber-300 inline-flex items-center gap-0.5">
                            <KentroCoin size="2xs" /> {(setupWagerAmount * 2).toLocaleString()} Coins
                          </strong>.
                        </span>
                      )}
                    {setupWagerAmount > 0 && coinBalance < setupWagerAmount && (
                      <span className="text-rose-400 font-bold block mt-0.5 inline-flex items-center gap-1">
                        Your balance (<KentroCoin size="2xs" /> {coinBalance.toLocaleString()}) is below this wager.
                      </span>
                    )}
                  </p>
                </div>
              )}

              {/* Match Length: single game or a Best-of series */}
              <div className="flex flex-col gap-2">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono">Match Length</span>
                <div className="grid grid-cols-3 gap-2">
                  {ALLOWED_BEST_OF.map((n) => (
                    <button
                      key={n}
                      onClick={() => setSetupBestOf(n)}
                      className={`text-[10px] font-bold py-2.5 rounded-lg border cursor-pointer transition ${
                        setupBestOf === n
                          ? "bg-amber-500 border-amber-400 text-slate-950"
                          : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                      }`}
                    >
                      {BEST_OF_LABELS[n].label}
                    </button>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 leading-normal font-sans">
                  {BEST_OF_LABELS[setupBestOf]?.desc || BEST_OF_LABELS[1].desc}
                  {setupBestOf > 1 && (
                    <>
                      {" "}Colors swap every game; draws count as a played game.
                      {setupWagerAmount > 0 && (
                        <span className="inline-flex items-center gap-1 text-amber-300 font-semibold ml-1">
                          The <KentroCoin size="2xs" /> {(setupWagerAmount * 2).toLocaleString()} pot pays out once, to the series winner.
                        </span>
                      )}
                    </>
                  )}
                </p>
              </div>

              {/* Game Time */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono">
                    Game Time{setupBestOf > 1 ? " (per game)" : ""}
                  </span>
                  <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-md">
                    {setupGameTime} {setupGameTime === 1 ? "minute" : "minutes"}
                  </span>
                </div>

                {/* Minute Stepper & Direct Input */}
                <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl p-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.max(1, setupGameTime - 1);
                      setSetupGameTime(next);
                      if (!setupUnevenTime) {
                        setSetupHostTime(next);
                        setSetupGuestTime(next);
                      }
                    }}
                    className="w-8 h-8 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-white font-black text-base flex items-center justify-center border border-slate-800 cursor-pointer active:scale-95 transition"
                    title="Decrease 1 minute"
                  >
                    −
                  </button>
                  <div className="flex-1 flex items-center justify-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={setupGameTime}
                      onChange={(e) => {
                        const val = Math.max(1, Math.min(60, Number(e.target.value) || 1));
                        setSetupGameTime(val);
                        if (!setupUnevenTime) {
                          setSetupHostTime(val);
                          setSetupGuestTime(val);
                        }
                      }}
                      className="w-16 bg-slate-900 border border-slate-700/80 rounded-lg py-1 text-center font-mono font-bold text-sm text-white focus:outline-none focus:border-amber-400 select-text"
                    />
                    <span className="text-xs font-mono text-slate-400">min / side</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.min(60, setupGameTime + 1);
                      setSetupGameTime(next);
                      if (!setupUnevenTime) {
                        setSetupHostTime(next);
                        setSetupGuestTime(next);
                      }
                    }}
                    className="w-8 h-8 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-white font-black text-base flex items-center justify-center border border-slate-800 cursor-pointer active:scale-95 transition"
                    title="Increase 1 minute"
                  >
                    +
                  </button>
                </div>

                {/* Granular Quick Preset Chips: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30 min */}
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => {
                        setSetupGameTime(mins);
                        if (!setupUnevenTime) {
                          setSetupHostTime(mins);
                          setSetupGuestTime(mins);
                        }
                      }}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold border cursor-pointer transition ${
                        setupGameTime === mins
                          ? "bg-amber-500 border-amber-400 text-slate-950 shadow-md shadow-amber-500/20"
                          : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                      }`}
                    >
                      {mins}m
                    </button>
                  ))}
                </div>
              </div>

              {/* Time Advantage */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={setupUnevenTime}
                    onChange={(e) => {
                      setSetupUnevenTime(e.target.checked);
                      if (!e.target.checked) {
                        setSetupHostTime(setupGameTime);
                        setSetupGuestTime(setupGameTime);
                      }
                    }}
                    className="accent-amber-500"
                  />
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono">
                    Give opponent a different clock (Time Advantage)
                  </span>
                </label>
                {setupUnevenTime && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] text-slate-500 font-mono">You (Host)</span>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={setupHostTime}
                        onChange={(e) => setSetupHostTime(Math.max(1, Number(e.target.value) || 1))}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-slate-100 font-bold select-text"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] text-slate-500 font-mono">Opponent</span>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={setupGuestTime}
                        onChange={(e) => setSetupGuestTime(Math.max(1, Number(e.target.value) || 1))}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-slate-100 font-bold select-text"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Special Rule */}
              <div className="flex flex-col gap-2">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono">Special Match Rule</span>
                <div className="flex flex-col gap-1.5">
                  {[
                    { id: "none", label: "None", desc: "Standard 20 vs 20 pieces." },
                    { id: "short-one", label: "Short One", desc: "Host starts down 1 piece; opponent picks which." },
                    { id: "short-two", label: "Short Two", desc: "Host starts down 2 pieces; opponent picks which." },
                    { id: "short-three", label: "Short Three", desc: "Host starts down 3 pieces; opponent picks which." },
                    { id: "crown-crown", label: "Crown Crown", desc: "20 pieces each; remove one from your front row and crown it anywhere on your back row." },
                    { id: "no-kentrodraught", label: "No KentroDraught Rule", desc: "Clocks pause at <= 5 pieces; strict endgame move limits apply." },
                  ].map((rule) => (
                    <button
                      key={rule.id}
                      onClick={() => setSetupSpecialRule(rule.id as SpecialRule)}
                      className={`text-left px-3 py-2.5 rounded-lg border cursor-pointer transition ${
                        setupSpecialRule === rule.id
                          ? "bg-amber-500/10 border-amber-500/40"
                          : "bg-slate-950 border-slate-800 hover:border-slate-700"
                      }`}
                    >
                      <div className={`text-xs font-bold ${setupSpecialRule === rule.id ? "text-amber-400" : "text-slate-200"}`}>
                        {rule.label}
                      </div>
                      <div className="text-[10px] text-slate-500">{rule.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-start gap-3 bg-slate-950 p-3 border border-slate-800 rounded-xl text-xs text-slate-300">
                <input type="checkbox" checked={setupPrivate} onChange={event => setSetupPrivate(event.target.checked)} className="mt-0.5 accent-amber-500" />
                <span><strong className="block text-white mb-1">Private match</strong>Join by room code only. Hidden from public challenges and Kentro TV; spectators cannot watch.</span>
              </label>
              <button
                onClick={onConfirmHostSetup}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded-xl transition cursor-pointer text-xs mt-1"
              >
                Create Match
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </>
    );
  }

  const opponentPlayer = roomPlayers.find(p => p.username !== username);

  return (
    <div className="flex flex-col gap-4 h-full min-h-0 shrink-0">
      {/* Room Header Info */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-3 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono">ROOM NUMBER</span>
          <span className="text-[10px] text-slate-400 font-mono">10x10 ARENA</span>
        </div>
        <div className="flex flex-col bg-slate-950 px-4 py-3 rounded-xl border border-slate-900 gap-2">
          <span className="text-xl font-extrabold tracking-widest text-amber-400 font-mono select-all truncate">{roomId}</span>
          <div className="flex items-center flex-wrap gap-1.5">
            <button
              onClick={handleCopyRoomCode}
              className={`text-[10px] border px-2.5 py-1.5 rounded-lg transition font-bold cursor-pointer flex items-center gap-1.5 ${
                copiedInRoom
                  ? "bg-emerald-600/20 border-emerald-500/40 text-emerald-400"
                  : "bg-slate-900 hover:bg-slate-850 border-slate-800 text-slate-300"
              }`}
            >
              {copiedInRoom ? <Check className="w-3 h-3 stroke-[3]" /> : <Copy className="w-3 h-3" />}
              {copiedInRoom ? "Copied!" : "Copy Code"}
            </button>
            <button
              onClick={handleShareToWhatsApp}
              className="text-[10px] border px-2.5 py-1.5 rounded-lg transition font-bold cursor-pointer flex items-center gap-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border-emerald-500/40 text-emerald-300 shadow-sm active:scale-95"
              title="Copy a game invite link to paste into WhatsApp"
            >
              <Share2 className="w-3 h-3 text-emerald-400" />
              <span>{copiedWhatsApp ? "Link Copied!" : "Copy to WhatsApp"}</span>
            </button>
          </div>
        </div>
        {copiedWhatsApp && <p role="status" className="text-[11px] text-emerald-300">Paste the copied link in WhatsApp. Your opponent taps it, then Start Game.</p>}
        {shareError && <p role="alert" className="text-[11px] text-rose-300">{shareError}</p>}
        {multiplayerWagerAmount > 0 && (
          <div className="flex items-center justify-between mt-2 px-1 py-1 bg-amber-950/40 border border-amber-500/25 rounded-lg">
            <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider font-mono flex items-center gap-1">
              <KentroCoin size="2xs" glow /> Coin Stake
            </span>
            <span className="text-xs font-black text-amber-300 flex items-center gap-1.5 font-sans">
              <span>{multiplayerWagerAmount.toLocaleString()} each</span>
              <span className="text-slate-600">&middot;</span>
              <span className="text-amber-200 font-bold flex items-center gap-0.5">
                <KentroCoin size="2xs" /> {(multiplayerWagerAmount * 2).toLocaleString()} pot{seriesInfo && seriesInfo.bestOf > 1 ? " (series)" : ""}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Best-of-N series scoreboard */}
      {seriesInfo && seriesInfo.bestOf > 1 && (
        <div className="bg-gradient-to-br from-indigo-500/15 to-slate-950 border border-indigo-500/35 rounded-2xl p-4 flex flex-col gap-2.5 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-indigo-300 font-extrabold uppercase tracking-wider font-mono">
              {BEST_OF_LABELS[seriesInfo.bestOf]?.label || `Best of ${seriesInfo.bestOf}`} Series
            </span>
            <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-mono">
              {seriesInfo.seriesOver ? "FINISHED" : `GAME ${seriesInfo.gameNumber} / ${seriesInfo.bestOf}`}
            </span>
          </div>
          <div className="flex items-center justify-center gap-3 bg-slate-950/80 border border-slate-900 rounded-xl px-3 py-2.5">
            {roomPlayers.slice(0, 2).map((p, i) => (
              <React.Fragment key={p.username}>
                {i === 1 && <span className="text-slate-600 text-xs font-black shrink-0">–</span>}
                <div className={`flex-1 flex flex-col items-center gap-1 min-w-0 ${i === 1 ? "order-2" : ""}`}>
                  <Avatar name={p.username} size={28} />
                  <AdminTappableName
                    username={p.username}
                    className={`text-[10px] font-bold truncate max-w-full ${p.username === username ? "text-amber-300" : "text-slate-300"}`}
                  >
                    {p.username}{p.username === username ? " (You)" : ""}
                  </AdminTappableName>
                  <span className={`text-xl font-black font-mono leading-none ${
                    seriesInfo.seriesOver && seriesInfo.seriesWinner === p.username ? "text-emerald-400" : "text-slate-100"
                  }`}>
                    {seriesInfo.score[p.username] ?? 0}
                  </span>
                </div>
              </React.Fragment>
            ))}
          </div>
          <div className="flex items-center justify-between text-[9px] font-mono text-slate-500">
            <span>Draws: {seriesInfo.draws}</span>
            <span>First to {Math.floor(seriesInfo.bestOf / 2) + 1} wins</span>
          </div>
          {seriesInfo.seriesOver && seriesInfo.seriesWinner && (
            <div className="text-center text-[11px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg py-1.5">
              🏆 {seriesInfo.seriesWinner} wins the series!
            </div>
          )}
        </div>
      )}

      {isSpectating ? (
        <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-2xl p-4 flex items-center justify-between shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-wider font-mono text-indigo-300 flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5" /> Spectating (read-only)
          </span>
          <button
            onClick={onLeaveSpectate}
            className="text-[10px] bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold px-3 py-1.5 rounded-lg transition cursor-pointer"
          >
            Stop Watching
          </button>
        </div>
      ) : multiplayerStarted && spectatorCount > 0 && (
        <div className="flex items-center gap-1.5 px-1 -mt-1 shrink-0 text-[10px] text-slate-500 font-mono">
          <Eye className="w-3 h-3" /> {spectatorCount} watching
        </div>
      )}

      {/* Live Voice & HD Video chat -- players only, never spectators */}
      {multiplayerStarted && !isSpectating && (
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-3.5 flex flex-col gap-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {voiceCallState === "reconnecting" ? (
                <span className="relative flex h-3.5 w-3.5 items-center justify-center shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/40" />
                  <Mic className="relative w-3.5 h-3.5 text-amber-400" />
                </span>
              ) : voiceCallState === "connected" ? (
                <span className="relative flex h-3.5 w-3.5 items-center justify-center shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/40" />
                  {callType === "video" ? (
                    <Video className="relative w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Mic className="relative w-3.5 h-3.5 text-emerald-400" />
                  )}
                </span>
              ) : (
                <Video className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              )}
              <span className="text-[10px] font-bold uppercase tracking-wider font-mono text-slate-300 truncate">
                {voiceCallState === "connected"
                  ? callType === "video" ? "HD Video Call — Live" : "Voice Call — Live"
                  : outgoingVoiceRinging ? `Ringing ${opponentName}…`
                  : voiceCallState === "ringing" ? `${opponentName} is calling…`
                  : voiceCallState === "connecting" ? "Connecting…"
                  : voiceCallState === "reconnecting" ? "Reconnecting…"
                  : voiceCallState === "failed" ? "Call Ended"
                  : voiceCallState === "failed-network" ? "Couldn't Connect"
                  : voiceCallState === "unsupported" ? "Not Supported"
                  : "Live Arena Calling"}
              </span>
            </div>

            {outgoingVoiceRinging && (
              <button
                onClick={onCancelVoiceCall}
                className="text-[10px] bg-rose-600 hover:bg-rose-500 text-white font-bold px-2.5 py-1 rounded-lg transition cursor-pointer flex items-center gap-1 shrink-0"
              >
                <PhoneOff className="w-3 h-3" /> Cancel
              </button>
            )}

            {voiceCallState === "connecting" && (
              <button
                onClick={onLeaveVoiceChat}
                className="text-[10px] bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 font-bold px-2.5 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1 shrink-0"
                title="Stop connecting"
              >
                <PhoneOff className="w-3 h-3" /> Cancel
              </button>
            )}

            {(voiceCallState === "connected" || voiceCallState === "reconnecting") && (
              <div className="flex items-center gap-1.5 shrink-0">
                {/* Mute Mic */}
                <button
                  onClick={onToggleVoiceMute}
                  className={`p-1.5 rounded-lg transition cursor-pointer ${
                    voiceMuted ? "bg-rose-500/15 text-rose-400 border border-rose-500/30" : "bg-slate-800 text-slate-300 hover:text-white"
                  }`}
                  title={voiceMuted ? "Unmute Mic" : "Mute Mic"}
                >
                  {voiceMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                </button>

                {/* Toggle Video */}
                {callType === "video" && onToggleVideoMute && (
                  <button
                    onClick={onToggleVideoMute}
                    className={`p-1.5 rounded-lg transition cursor-pointer ${
                      videoMuted ? "bg-amber-500/15 text-amber-400 border border-amber-500/30" : "bg-indigo-600/30 text-indigo-300 border border-indigo-500/40"
                    }`}
                    title={videoMuted ? "Turn On Camera" : "Turn Off Camera"}
                  >
                    {videoMuted ? <VideoOff className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
                  </button>
                )}

                {/* Toggle Screen Share */}
                {onToggleScreenShare && (
                  <button
                    onClick={onToggleScreenShare}
                    className={`p-1.5 rounded-lg transition cursor-pointer ${
                      isScreenSharing ? "bg-amber-500 text-slate-950 font-black shadow-md shadow-amber-950" : "bg-slate-800 text-slate-300 hover:text-white"
                    }`}
                    title={isScreenSharing ? "Stop Sharing Screen" : "Share Screen"}
                  >
                    {isScreenSharing ? <ScreenShareOff className="w-3.5 h-3.5" /> : <ScreenShare className="w-3.5 h-3.5" />}
                  </button>
                )}

                {/* Flip Camera */}
                {callType === "video" && onFlipCamera && (
                  <button
                    onClick={onFlipCamera}
                    className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
                    title="Flip Camera"
                  >
                    <SwitchCamera className="w-3.5 h-3.5" />
                  </button>
                )}

                {/* Leave / End Call */}
                <button
                  onClick={onLeaveVoiceChat}
                  className="text-[10px] bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 font-bold px-2.5 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1"
                >
                  <PhoneOff className="w-3 h-3" /> End
                </button>
              </div>
            )}
          </div>

          {/* Idle Call Action Buttons: Audio Call and HD Video Call */}
          {(voiceCallState === "idle" || voiceCallState === "ended" || voiceCallState === "failed" || voiceCallState === "failed-network" || voiceCallState === "unsupported") && !outgoingVoiceRinging && (
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                onClick={onStartVoiceCall}
                disabled={voiceCallState === "unsupported"}
                className="text-[11px] bg-slate-800/90 hover:bg-slate-700/90 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 font-bold py-2 px-3 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 border border-slate-700/80"
              >
                <Phone className="w-3.5 h-3.5 text-emerald-400" />
                <span>Voice Call</span>
              </button>
              <button
                onClick={onStartVideoCall || onStartVoiceCall}
                disabled={voiceCallState === "unsupported"}
                className="text-[11px] bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black py-2 px-3 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-950 border border-indigo-400/40"
              >
                <Video className="w-3.5 h-3.5 text-white" />
                <span>HD Video</span>
              </button>
            </div>
          )}

          {voiceCallState === "failed-network" && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[9px] text-slate-500 leading-relaxed">
                {callFailure?.message || "Couldn't establish a peer-to-peer connection."}{" "}
                {callFailure?.suggestAudioOnly
                  ? "No relay path was found — this usually means a strict network (cellular NAT or a firewall). An audio-only call needs far less bandwidth and is more likely to get through."
                  : "The relay was reachable but the connection still dropped; check both players' internet and try again."}
              </p>
              {callFailure?.suggestAudioOnly && (
                <button
                  onClick={onStartVoiceCall}
                  className="text-[10px] self-start bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 font-bold px-2.5 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 border border-emerald-500/30"
                >
                  <Phone className="w-3 h-3" /> Retry with audio only
                </button>
              )}
            </div>
          )}

          {voiceCallState === "unsupported" && (
            <p className="text-[9px] text-slate-500 leading-relaxed">
              {callFailure?.message || "Voice and video calls need a modern browser (Chrome, Safari or Firefox) and a secure https:// connection."}
            </p>
          )}
        </div>
      )}

      {/* Room Players Status */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-3 shrink-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block font-mono">
            Arena Players
          </span>
          {roomPlayers.length >= 2 && (
            <button
              onClick={() => onViewH2H(roomPlayers[0].username, roomPlayers[1].username)}
              className="text-[9px] font-black px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-400 hover:bg-amber-500/20 transition cursor-pointer"
              title="Head-to-head record between these players"
            >
              H2H
            </button>
          )}
        </div>
        <div className="space-y-2.5">
          {/* You */}
          <div className="flex items-center justify-between bg-slate-950/80 border border-slate-900 px-3 py-2.5 rounded-xl">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${yourColor === "W" ? "bg-white border border-slate-300" : "bg-neutral-800 border border-neutral-700"}`} />
              <span className="text-xs font-bold text-slate-100">{username} (You)</span>
            </div>
            <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${isReady ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}>
              {isReady ? "READY" : "WAITING"}
            </span>
          </div>

          {/* Opponent */}
          {opponentPlayer ? (
            <div className="flex items-center justify-between bg-slate-950/80 border border-slate-900 px-3 py-2.5 rounded-xl">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${opponentPlayer.color === "W" ? "bg-white border border-slate-300" : "bg-neutral-800 border border-neutral-700"}`} />
                <span className="flex items-center gap-2">
                  <Avatar name={opponentPlayer.username} size={22} />
                  <AdminTappableName username={opponentPlayer.username} className="text-xs font-bold text-slate-100" />
                </span>
              </div>
              <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${opponentPlayer.ready ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}>
                {opponentPlayer.ready ? "READY" : "WAITING"}
              </span>
            </div>
          ) : (
            <div className="text-center py-4 px-3 border border-dashed border-slate-800 rounded-xl bg-slate-950/40 flex flex-col items-center justify-center gap-2.5 font-sans">
              <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
                <div className="w-2 h-2 bg-amber-400 rounded-full animate-ping" />
                Waiting for opponent to join...
              </div>
              <button
                type="button"
                onClick={handleShareToWhatsApp}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs transition cursor-pointer flex items-center justify-center gap-2 shadow-md shadow-emerald-950/40 active:scale-95"
              >
                <Share2 className="w-3.5 h-3.5 text-white" />
                <span>{copiedWhatsApp ? "Link Copied — Paste in WhatsApp" : "Copy to WhatsApp"}</span>
              </button>
              <span className="text-[10px] text-slate-500 font-mono">
                Your room stays open while you send the code.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Ready Actions */}
      {!isSpectating && (!multiplayerStarted ? (
        <button
          onClick={() => { sendMessage({ type: "ready" }); }}
          disabled={roomPlayers.length < 2 || connectionStatus !== "connected"}
          className={`w-full font-bold py-3 px-4 rounded-xl transition text-xs flex items-center justify-center gap-2 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0 ${
            isReady
              ? "bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/10"
              : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/20 animate-pulse"
          }`}
        >
          {isReady ? "Unready" : "Ready to Start"}
        </button>
      ) : (
        <button
          onClick={onRequestRematch}
          disabled={gameInProgress || connectionStatus !== "connected"}
          title={gameInProgress ? "Finish the game first (use Resign to end it)" : "Offer your opponent a rematch"}
          className="w-full bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold py-2 px-4 rounded-xl transition text-xs flex items-center justify-center gap-2 cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Offer Restart Match
        </button>
      ))}

      {/* Real-time Room Chat Panel */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-3 flex-grow min-h-[220px] overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-950 pb-2 mb-1 shrink-0">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block font-mono">
            Room Chat & Reactions
          </span>
          <span className="text-[8px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded font-mono uppercase">
            Live Arena
          </span>
        </div>

        {/* Quick Emoji Reactions */}
        <div className="flex justify-between bg-slate-950/85 p-1.5 rounded-xl border border-slate-900 shrink-0 select-none">
          {["😂", "🔥", "👍", "🧠", "👑", "😱", "👏", "💥"].map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => { sendMessage({ type: "emoji-reaction", emoji }); }}
              className="text-base hover:scale-125 hover:-translate-y-0.5 transition cursor-pointer p-1"
              title="Send reaction to board"
            >
              {emoji}
            </button>
          ))}
        </div>

        {/* Messages Container */}
        <div ref={chatScrollRef} className="flex-grow overflow-y-auto bg-slate-950 border border-slate-900 rounded-xl p-3 flex flex-col gap-2 font-sans text-xs min-h-[100px]">
          {multiplayerMessages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-center text-[10px] text-slate-600 italic font-sans p-4">
              Send a greeting! Type below or tap an emoji to react.
            </div>
          ) : (
            multiplayerMessages.map((msg, idx) => {
              if (!msg) return null;
              const msgText = msg.text || "";
              const isVoice = msgText.includes("[Voice Note 🎙️]");
              let voiceDur = 4;
              if (isVoice) {
                const match = msgText.match(/\(0:(\d+)\)/);
                if (match) {
                  voiceDur = parseInt(match[1]) || 4;
                }
              }

              return (
                <div key={idx} className={`max-w-[85%] rounded-xl px-3 py-1.5 flex flex-col ${msg.from === username ? "self-end bg-emerald-600/15 text-emerald-300 border border-emerald-500/10" : "self-start bg-slate-900 text-slate-300 border border-slate-800"}`}>
                  <div className="text-[8px] text-slate-500 font-bold leading-none mb-1 font-mono">{msg.from}</div>
                  {isVoice ? (
                    <VoiceNotePlayer
                      msgId={`${idx}-${msg.from}`}
                      duration={voiceDur}
                      playingVoiceId={playingVoiceId}
                      setPlayingVoiceId={setPlayingVoiceId}
                    />
                  ) : (
                    <div className="leading-tight text-slate-200 font-sans">{msg.text}</div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Recording or input bar */}
        {isRecording ? (
          <div className="bg-rose-500/10 border border-rose-500/35 p-3 rounded-xl flex items-center justify-between animate-pulse shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
              <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider font-mono">
                Recording Voice Note... ({recordingSeconds}s)
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (recordingIntervalRef.current) {
                  clearInterval(recordingIntervalRef.current);
                }
                setIsRecording(false);
                const duration = recordingSeconds || 3;
                sendMessage({
                  type: "chat",
                  text: `[Voice Note 🎙️] (0:${duration < 10 ? '0' : ''}${duration})`
                });
                setRecordingSeconds(0);
              }}
              className="bg-rose-600 hover:bg-rose-500 text-white rounded-lg p-2 transition cursor-pointer"
              title="Stop and Send"
            >
              <Square className="w-4 h-4 fill-white text-rose-600" />
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => {
            e.preventDefault();
            if (chatInput.trim() !== "") {
              if (sendMessage({ type: "chat", text: chatInput.trim() })) setChatInput("");
            }
          }} className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setIsRecording(true);
                setRecordingSeconds(0);
                recordingIntervalRef.current = setInterval(() => {
                  setRecordingSeconds((prev) => prev + 1);
                }, 1000);
              }}
              className="bg-slate-950 hover:bg-slate-900 text-rose-400 border border-slate-850 p-2.5 rounded-xl transition cursor-pointer shrink-0"
              title="Record Voice Note"
            >
              <Mic className="w-4 h-4 text-rose-400" />
            </button>

            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Type message..."
              className="flex-grow min-w-0 bg-slate-950 border border-slate-850 rounded-xl px-3 py-2.5 text-slate-200 placeholder-slate-600 text-xs focus:outline-none focus:border-emerald-500 select-text"
            />

            <button
              type="submit"
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3.5 py-2.5 rounded-xl transition text-xs cursor-pointer"
            >
              Send
            </button>
          </form>
        )}
      </div>

      {/* Leave Room Action */}
      <button
        onClick={onLeaveRoom}
        className="w-full bg-slate-950 hover:bg-slate-900 border border-slate-900 text-slate-500 hover:text-slate-400 py-3 rounded-xl transition text-[10px] font-bold mt-auto shrink-0 font-mono"
      >
        Exit Room
      </button>
    </div>
  );
}
