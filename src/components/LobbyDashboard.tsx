import React, { useState } from "react";
import { guestDisplayName } from "../lib/guestTrial";
import { shallowEqualIgnoringFunctions } from "../memoUtils";
import { 
  Swords, Plus, User, ArrowRight, RefreshCw, Copy, Check, MessageSquare, 
  Play, Cpu, Compass, BookOpen, Clock, Activity, LogOut, Sparkles, Wifi,
  Trophy, Percent, Award, ShieldAlert, ArrowLeft, Shield, Sliders, Timer, Zap,
  Search, X, Users, Puzzle as PuzzleIcon, Crown, Target, Flame, Share2, ChevronRight, Radio, History
} from "lucide-react";
import { KentroCoin } from "./ui/KentroCoin";
import { motion, AnimatePresence } from "motion/react";
import { PlayMode, PlayerStats } from "../types";
import { MIN_MATCH_WAGER, MAX_MATCH_WAGER, MATCH_WAGER_STEP, ALLOWED_BEST_OF, BEST_OF_LABELS } from "../lib/constants";
import { AdminTappableName } from "../lib/adminProfileContext";
import { Avatar } from "./ui/Avatar";
import { copyInviteText, makeRoomInviteUrl } from "../lib/roomInvite";
import { supabase } from "../supabase";
import { discoverChallenges, findQuickMatchRoom, QUICK_MATCH_TIMES, type ChallengeFilter } from "../lib/arenaDiscovery";

interface LobbyDashboardProps {
  username: string;
  connectionStatus: "disconnected" | "connecting" | "connected";
  onlineUsers: string[];
  roomId: string | null;
  roomPlayers: { username: string; color: "W" | "B"; ready: boolean }[];
  yourColor: "W" | "B" | null;
  isReady: boolean;
  roomError: string | null;
  roomInput: string;
  setRoomInput: (val: string) => void;
  ws: WebSocket | null;
  onSignOut: () => void;
  isGuest?: boolean;
  onSelectMode: (mode: PlayMode) => void;
  chatInput: string;
  setChatInput: (val: string) => void;
  multiplayerMessages: { from: string; text: string }[];
  profileStats: PlayerStats;
  clockLimitType: "Blitz" | "Rapid" | "Classical" | "Untimed";
  
  // Custom matchmaking callbacks
  onHostMatch: (gameTime?: number, specialRule?: string, hostTime?: number, guestTime?: number, wagerAmount?: number, bestOf?: number) => void;
  onJoinRoom: (roomId: string) => void;
  onReconnect: () => void;
  pendingHostMatch?: boolean;
  pendingJoinRoom?: string | null;
  /** Room opened through a direct WhatsApp invitation. No search or code entry needed. */
  inviteRoomCode?: string | null;
  onDismissInvite?: () => void;

  // Preview properties
  pendingRoomPreview?: {
    roomId: string;
    hostName: string;
    gameTime: number;
    specialRule: string;
    hostTime: number;
    guestTime: number;
    entryFee?: number;
    wagerAmount?: number | null;
    bestOf?: number;
  } | null;
  onJoinRoomAccept?: (roomId: string) => void;
  onJoinRoomRefuse?: (roomId: string) => void;
  /** Leave the current room (App confirms during play). */
  onLeaveRoom?: () => void;

  openRooms?: Array<{
    id: string;
    creator: string;
    hostName: string;
    gameTime: number;
    specialRule: string;
    wagerAmount: number;
    bestOf: number;
    playersCount: number;
  }>;
  onCancelRoom?: (code: string) => void;
  onOpenPastGamesModal?: (filter?: "All" | "AI" | "PvP" | "Tournament") => void;
  onOpenPlayers?: () => void;
}

function LobbyDashboardImpl({
  username,
  connectionStatus,
  onlineUsers,
  roomId,
  roomPlayers,
  yourColor,
  isReady,
  roomError,
  roomInput,
  setRoomInput,
  ws,
  onSignOut,
  isGuest = false,
  onSelectMode,
  chatInput,
  setChatInput,
  multiplayerMessages,
  profileStats,
  clockLimitType,
  onHostMatch,
  onJoinRoom,
  onReconnect,
  pendingHostMatch,
  pendingJoinRoom,
  inviteRoomCode,
  onDismissInvite,
  pendingRoomPreview,
  onJoinRoomAccept,
  onJoinRoomRefuse,
  onLeaveRoom,
  openRooms = [],
  onCancelRoom,
  onOpenPastGamesModal,
  onOpenPlayers,
}: LobbyDashboardProps) {
  const [copied, setCopied] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [friendChallengeName, setFriendChallengeName] = useState("");
  const [friendChallengeState, setFriendChallengeState] = useState("");
  const [friendSuggestions, setFriendSuggestions] = useState<string[]>([]);
  const [challengeSending, setChallengeSending] = useState(false);
  React.useEffect(() => {
    if (!roomId || isGuest) return;
    let active = true;
    supabase.from("friends").select("user1,user2,status").eq("status", "accepted")
      .or(`user1.eq.${username},user2.eq.${username}`).limit(60)
      .then(({data}) => { if (active) setFriendSuggestions((data || []).map(row => row.user1?.toLowerCase() === username.toLowerCase() ? row.user2 : row.user1).filter(Boolean)); });
    return () => { active = false; };
  }, [roomId, username, isGuest]);
  const sendFriendChallenge = async () => {
    if (!roomId || !friendChallengeName.trim() || challengeSending) return;
    setChallengeSending(true);setFriendChallengeState("");
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) throw new Error("Sign in before inviting a friend.");
      const response = await fetch("/api/notifications/challenge", { method:"POST", headers:{"Content-Type":"application/json", "Authorization": `Bearer ${data.session.access_token}`}, body: JSON.stringify({ roomId, friendUsername: friendChallengeName.trim() }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not deliver the challenge.");
      setFriendChallengeState(`Challenge sent to ${friendChallengeName.trim()}!`);
    } catch (e) { setFriendChallengeState(e instanceof Error ? e.message : "Invitation could not be sent."); }
    finally {setChallengeSending(false);}
  };


  // Online dashboard modals
  const [showAwaitingModal, setShowAwaitingModal] = useState(false);
  const [showFindGameModal, setShowFindGameModal] = useState(false);
  const [quickTime, setQuickTime] = useState<number>(5);
  const [challengeFilter, setChallengeFilter] = useState<ChallengeFilter>('standard');
  const [showAllChallenges, setShowAllChallenges] = useState(false);
  const [showMoreArenaTools, setShowMoreArenaTools] = useState(false);

  // Modification Screen Setup State
  const [isHostingSetup, setIsHostingSetup] = useState(false);
  const [setupGameTime, setSetupGameTime] = useState(5);
  const [setupSpecialRule, setSetupSpecialRule] = useState<"none" | "short-one" | "short-two" | "short-three" | "crown-crown" | "no-kentrodraught">("none");
  const [setupUnevenTime, setSetupUnevenTime] = useState(false);
  const [setupHostTime, setSetupHostTime] = useState(5);
  const [setupGuestTime, setSetupGuestTime] = useState(5);
  const [setupWager, setSetupWager] = useState(0);
  const [setupBestOf, setSetupBestOf] = useState(1);

  React.useEffect(() => {
    if (roomId !== null) {
      setIsHostingSetup(false);
    }
  }, [roomId]);

  // Match discovery uses the server's existing live room list. We only
  // auto-join a free, standard, single game with the chosen clock.
  const visibleChallenges = discoverChallenges(openRooms, username, isGuest, challengeFilter);
  const joinableRoomCount = discoverChallenges(openRooms, username, isGuest, 'all').length;
  const awaitingRooms = openRooms.filter(room => !isGuest || ((room.wagerAmount ?? 0) === 0 && (room.bestOf ?? 1) === 1));
  const handleQuickMatch = () => {
    if (connectionStatus !== 'connected' || pendingHostMatch || pendingJoinRoom) return;
    const room = findQuickMatchRoom(openRooms, username, isGuest, quickTime);
    if (room) onJoinRoom(room.id);
    else onHostMatch(quickTime, 'none', quickTime, quickTime, 0, 1);
  };

  const handleCopyCode = async () => {
    if (!roomId) return;
    try {
      await copyInviteText(roomId);
      setCopied(true);
      setCopyError("");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError("Unable to copy. Please select the room number manually.");
    }
  };

  const handleCopyWhatsAppLink = async () => {
    if (!roomId) return;
    try {
      // Copy the direct URL, rather than sending the player to the homepage.
      await copyInviteText(makeRoomInviteUrl(roomId, window.location.origin));
      setInviteCopied(true);
      setCopyError("");
      setTimeout(() => setInviteCopied(false), 2500);
    } catch {
      setCopyError("Unable to copy the invitation link. Please try Copy Code.");
    }
  };

  const handleCreateRoomClick = () => {
    setIsHostingSetup(true);
  };

  const handleConfirmHost = () => {
    setIsHostingSetup(false);
    const finalHostTime = setupUnevenTime ? setupHostTime : setupGameTime;
    const finalGuestTime = setupUnevenTime ? setupGuestTime : setupGameTime;
    onHostMatch(setupGameTime, setupSpecialRule, finalHostTime, finalGuestTime, isGuest ? 0 : setupWager, isGuest ? 1 : setupBestOf);
  };

  const handleGameTimeChange = (time: number) => {
    setSetupGameTime(time);
    setSetupHostTime(time);
    setSetupGuestTime(time);
  };

  const handleAcceptMatch = () => {
    if (pendingRoomPreview && onJoinRoomAccept) {
      onJoinRoomAccept(pendingRoomPreview.roomId);
    }
  };

  const handleRefuseMatch = () => {
    if (pendingRoomPreview && onJoinRoomRefuse) {
      onJoinRoomRefuse(pendingRoomPreview.roomId);
    }
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomInput.trim()) {
      onJoinRoom(roomInput.trim());
    }
  };

  // (The old toggle-ready / chat-message handlers here sent message types
  // the server never understood and were never wired to any control; the
  // real ready/chat controls live in MultiplayerPanel.)
  const handleLeaveRoom = () => {
    if (onLeaveRoom) {
      onLeaveRoom(); // confirms first when a game is in progress (contract section 7)
      return;
    }
    if (ws && ws.readyState === WebSocket.OPEN && roomId) {
      ws.send(JSON.stringify({ type: "leave-room", roomId }));
    }
  };

  const getRuleDetails = (ruleKey: string) => {
    switch (ruleKey) {
      case "short-one":
        return {
          title: "1-Checker Handicap",
          desc: "Host removes 1 checker from back rank, creating a localized flank opening.",
          badge: "Handicap -1"
        };
      case "short-two":
        return {
          title: "2-Checker Handicap",
          desc: "Host removes 2 checkers, providing a heavy early advantage to guest.",
          badge: "Handicap -2"
        };
      case "short-three":
        return {
          title: "3-Checker Handicap",
          desc: "Extreme odds: Host plays with 3 fewer checkers.",
          badge: "Handicap -3"
        };
      case "crown-crown":
        return {
          title: "Crown-to-Crown Mode",
          desc: "Both players start with 2 promoted Kings on back rank corner squares.",
          badge: "Kings Battle"
        };
      case "no-kentrodraught":
        return {
          title: "No KentroDraught Rule",
          desc: "Clocks pause at <= 5 pieces; strict endgame move limits apply.",
          badge: "Endgame Rules"
        };
      default:
        return {
          title: "Standard Nigeria Draughts Rules",
          desc: "Official 10x10 board, flying kings, mandatory maximum capture chain.",
          badge: "Standard Rules"
        };
    }
  };

  const cardVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.25 } }
  };

  const getRankInfo = (elo: number) => {
    if (elo < 1400) return { name: "Novice", icon: "🥉", color: "bg-slate-800/80 text-amber-300 border-slate-700" };
    if (elo < 1600) return { name: "Challenger", icon: "🥈", color: "bg-slate-800/80 text-slate-300 border-slate-700" };
    if (elo < 1800) return { name: "Expert", icon: "🥇", color: "bg-slate-800/80 text-amber-300 border-slate-700" };
    if (elo < 2000) return { name: "Master", icon: "🏆", color: "bg-slate-800/80 text-amber-300 border-slate-700" };
    if (elo < 2200) return { name: "Grandmaster", icon: "👑", color: "bg-slate-800/80 text-rose-300 border-slate-700" };
    return { name: "Legend", icon: "✨", color: "bg-slate-800/80 text-purple-300 border-slate-700" };
  };

  const formatDuration = (seconds: number) => {
    if (!seconds || seconds <= 0) return "0s";
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  };

  const rank = getRankInfo(profileStats.elo);
  const totalGames = profileStats.wins + profileStats.draws + profileStats.losses;
  const winRate = totalGames > 0 ? ((profileStats.wins / totalGames) * 100).toFixed(1) : "0.0";

  return (
    <div className="k-arena-lobby w-full max-w-7xl mx-auto p-3 sm:p-4 md:p-6 text-slate-100 min-h-screen flex flex-col font-sans">
      
      {/* ARENA HEADER BAR */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 md:p-5 mb-6 shadow-xl flex flex-col md:flex-row items-center justify-between gap-4">
        
        {/* Left Identity */}
        <div className="flex items-center gap-3.5 w-full md:w-auto">
          <div className="w-11 h-11 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 flex items-center justify-center shrink-0 shadow-sm">
            <Swords className="w-5 h-5 stroke-[2]" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base md:text-lg font-bold tracking-tight text-white uppercase font-sans">
                Online Arena
              </h1>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-medium border ${
                connectionStatus === "connected"
                  ? "bg-slate-800 text-slate-300 border-slate-700"
                  : "bg-slate-800 text-slate-400 border-slate-700"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${connectionStatus === "connected" ? "bg-emerald-400" : "bg-rose-500"}`} />
                {connectionStatus === "connected" ? `${onlineUsers.length} Online` : connectionStatus}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {isGuest ? "Guest trial · 1 free online match · no coins required" : "Live Draughts 10x10 • Standard & Handicap Arenas"}
            </p>
          </div>
        </div>

        {/* Right Quick Player Pill */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-end border-t md:border-t-0 border-slate-800 pt-3 md:pt-0">
          <div className="bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl flex items-center gap-3 shadow-inner">
            <Avatar name={username} size={28} />
            <div className="text-left">
              <span className="text-[9px] font-mono text-slate-500 uppercase block leading-none">Logged In</span>
              <AdminTappableName username={username} className="text-xs font-bold text-slate-200 leading-tight">
                {username}
              </AdminTappableName>
            </div>
            <div className="h-5 w-[1px] bg-slate-800" />
            <div className="text-right">
              <span className="text-[9px] font-mono text-slate-500 uppercase block leading-none">Rating</span>
              <span className="text-xs font-mono font-bold text-slate-200 leading-tight">{profileStats.elo} ELO</span>
            </div>
          </div>

          {openRooms.length > 0 && (
            <button
              onClick={() => setShowAwaitingModal(true)}
              className="bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-xl transition text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>{openRooms.length} Waiting</span>
            </button>
          )}
        </div>

      </div>

      {/* DISCONNECTED WARNING */}
      {connectionStatus !== "connected" && (
        <div className="mb-6 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-slate-300 text-xs shadow-md">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-slate-400 shrink-0" />
            <span>Disconnected from the live match server. Check your connection or click reconnect.</span>
          </div>
          <button
            onClick={onReconnect}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold text-xs uppercase tracking-wider border border-slate-700 rounded-lg transition cursor-pointer shrink-0"
          >
            Reconnect Now
          </button>
        </div>
      )}

      {/* MAIN ARENA CONTENT VIEW */}
      <AnimatePresence mode="wait">
        
        {/* CASE A: HOST MATCH CREATION DRAWERS */}
        {isHostingSetup && (
          <motion.div
            key="host-setup"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="w-full max-w-2xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 md:p-8 shadow-2xl relative"
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 flex items-center justify-center">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white uppercase tracking-tight font-sans">
                    Configure Match Arena
                  </h2>
                  <p className="text-xs text-slate-400">
                    Set up time controls, stakes, and rules for your room.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsHostingSetup(false)}
                className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white border border-slate-700 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col gap-5">
              
              {/* 1. Time Control */}
              <div className="bg-slate-950 p-4 border border-slate-800 rounded-xl flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                    <Timer className="w-3.5 h-3.5 text-amber-400" />
                    Time Control
                  </span>
                  <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 rounded-md">
                    {setupGameTime} min per side
                  </span>
                </div>

                {/* Stepper & Direct input */}
                <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl p-1.5">
                  <button
                    type="button"
                    onClick={() => handleGameTimeChange(Math.max(1, setupGameTime - 1))}
                    className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-black text-base flex items-center justify-center border border-slate-700 cursor-pointer active:scale-95 transition"
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
                      onChange={(e) => handleGameTimeChange(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
                      className="w-16 bg-slate-950 border border-slate-700 rounded-lg py-1 text-center font-mono font-bold text-sm text-white focus:outline-none focus:border-amber-400 select-text"
                    />
                    <span className="text-xs font-mono text-slate-400">min / side</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleGameTimeChange(Math.min(60, setupGameTime + 1))}
                    className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-black text-base flex items-center justify-center border border-slate-700 cursor-pointer active:scale-95 transition"
                    title="Increase 1 minute"
                  >
                    +
                  </button>
                </div>

                {/* Granular Quick Preset Chips */}
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30].map((time) => (
                    <button
                      key={time}
                      type="button"
                      onClick={() => handleGameTimeChange(time)}
                      className={`px-2.5 py-1.5 rounded-lg font-mono text-xs font-bold transition border cursor-pointer ${
                        setupGameTime === time
                          ? "bg-amber-500 border-amber-400 text-slate-950 shadow-md shadow-amber-500/20"
                          : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                      }`}
                    >
                      {time}m
                    </button>
                  ))}
                </div>
              </div>

              {/* Time Advantage / Handicap Times */}
              <div className="bg-slate-950 p-4 border border-slate-800 rounded-xl flex flex-col gap-3">
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
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                    <Timer className="w-3.5 h-3.5 text-slate-400" />
                    Handicap Times (Time Advantage)
                  </span>
                </label>
                {setupUnevenTime && (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] text-slate-400 font-mono">You (Host) Minutes</span>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={setupHostTime}
                        onChange={(e) => setSetupHostTime(Math.max(1, Number(e.target.value) || 1))}
                        className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-bold select-text"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] text-slate-400 font-mono">Opponent Minutes</span>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={setupGuestTime}
                        onChange={(e) => setSetupGuestTime(Math.max(1, Number(e.target.value) || 1))}
                        className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-bold select-text"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 2. Special Rules */}
              <div className="bg-slate-950 p-4 border border-slate-800 rounded-xl">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-1.5 mb-3">
                  <Shield className="w-3.5 h-3.5 text-slate-400" />
                  Rules & Odds Modification
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { id: "none", label: "Standard Rules", desc: "Equal 20 checkers per side" },
                    { id: "short-one", label: "1-Checker Odds", desc: "Host plays with 19 checkers" },
                    { id: "short-two", label: "2-Checker Odds", desc: "Host plays with 18 checkers" },
                    { id: "crown-crown", label: "Crown-to-Crown", desc: "2 Promoted Kings on corners" },
                    { id: "no-kentrodraught", label: "No KentroDraught Rule", desc: "Clocks pause at <= 5 pieces; strict endgame move limits apply." },
                  ].map((rule) => (
                    <button
                      key={rule.id}
                      type="button"
                      onClick={() => setSetupSpecialRule(rule.id as any)}
                      className={`p-3 rounded-lg border text-left transition cursor-pointer ${
                        setupSpecialRule === rule.id
                          ? "bg-slate-800 border-slate-600 text-white"
                          : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <span className="text-xs font-bold block text-slate-200">{rule.label}</span>
                      <span className="text-[10px] text-slate-500 leading-tight block mt-0.5">{rule.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {isGuest ? (
                <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-4 text-emerald-200 text-xs">
                  <strong>Guest Trial:</strong> Your online match is free and single-game. Sign in afterward for unlimited games and rematches.
                </div>
              ) : (<>
              {/* 3. Coin Wager */}
              <div className="bg-slate-950 p-4 border border-amber-500/25 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-amber-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                    <KentroCoin size="2xs" glow />
                    Coin Stake Wager
                  </span>
                  <span className="text-xs font-mono font-bold text-amber-200 flex items-center gap-1">
                    {setupWager === 0 ? "FREE MATCH" : (
                      <>
                        <KentroCoin size="2xs" />
                        {setupWager.toLocaleString()} / player
                      </>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSetupWager(0)}
                    className={`px-3 py-1 rounded-md text-xs font-bold border transition cursor-pointer ${
                      setupWager === 0
                        ? "bg-slate-800 border-slate-600 text-slate-200"
                        : "bg-slate-900 border-slate-800 text-slate-400"
                    }`}
                  >
                    Free
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={MAX_MATCH_WAGER}
                    step={MATCH_WAGER_STEP}
                    value={setupWager}
                    onChange={(e) => setSetupWager(Number(e.target.value))}
                    className="flex-1 accent-amber-500 cursor-pointer"
                  />
                  <input
                    type="number"
                    value={setupWager}
                    onChange={(e) => setSetupWager(Number(e.target.value))}
                    className="w-20 bg-slate-900 border border-slate-800 rounded-md px-2.5 py-1 text-xs text-amber-300 font-mono font-bold text-center focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* 4. Match Length */}
              <div className="bg-slate-950 p-4 border border-slate-800 rounded-xl">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-1.5 mb-3">
                  <Trophy className="w-3.5 h-3.5 text-slate-400" />
                  Series Length
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {ALLOWED_BEST_OF.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setSetupBestOf(n)}
                      className={`py-2 rounded-lg border text-center transition cursor-pointer ${
                        setupBestOf === n
                          ? "bg-slate-800 border-slate-600 text-white font-bold"
                          : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <span className="text-xs font-bold block">{BEST_OF_LABELS[n].label}</span>
                    </button>
                  ))}
                </div>
              </div>

              </>)}
              {/* Submit */}
              <button
                onClick={handleConfirmHost}
                disabled={pendingHostMatch}
                className="w-full py-3.5 bg-slate-100 hover:bg-white disabled:opacity-50 text-slate-950 font-bold uppercase text-xs tracking-wider rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-md"
              >
                {pendingHostMatch ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Creating Match Arena...</span>
                  </>
                ) : (
                  <>
                    <Swords className="w-4 h-4 stroke-[2]" />
                    <span>Launch & Create Match Arena</span>
                  </>
                )}
              </button>

            </div>
          </motion.div>
        )}

        {/* Tapped WhatsApp invitation: the guest only needs to press Start Game. */}
        {inviteRoomCode && roomId === null && !pendingRoomPreview && (
          <motion.div
            key="direct-room-invitation"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-lg w-full mx-auto bg-slate-900 border border-emerald-500/35 rounded-2xl p-6 md:p-8 shadow-2xl text-center"
          >
            <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
              <Swords className="w-6 h-6 text-emerald-300" />
            </div>
            <span className="text-[10px] uppercase font-mono tracking-widest font-bold text-emerald-300">Game invitation</span>
            <h2 className="text-xl font-black text-white mt-2">You're invited to play!</h2>
            <p className="text-slate-400 text-xs mt-2">Tap Start Game to join your opponent's online draughts match directly.</p>
            <div className="bg-slate-950 border border-slate-800 rounded-xl py-4 my-5">
              <span className="text-[10px] uppercase text-slate-500 font-mono block mb-1">Room Number</span>
              <span className="font-mono text-xl font-black tracking-widest text-amber-400">{inviteRoomCode}</span>
            </div>
            {roomError && <p role="alert" className="text-rose-300 text-xs mb-3">{roomError}</p>}
            {pendingJoinRoom && <p role="status" className="text-amber-300 text-xs mb-3">Connecting to the match…</p>}
            <button
              type="button"
              onClick={() => onJoinRoom(inviteRoomCode)}
              disabled={!!pendingJoinRoom}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl cursor-pointer disabled:cursor-wait disabled:opacity-60 transition flex items-center justify-center gap-2"
            >
              {pendingJoinRoom ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
              {pendingJoinRoom ? "Joining Game…" : "Start Game"}
            </button>
            <button type="button" onClick={onDismissInvite} className="text-xs text-slate-400 hover:text-slate-200 mt-4 cursor-pointer">
              Not now
            </button>
          </motion.div>
        )}

        {/* CASE B: GUEST MATCH PREVIEW */}
        {pendingRoomPreview && (
          <motion.div
            key="room-preview"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="w-full max-w-lg mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 md:p-8 shadow-2xl text-center"
          >
            <div className="w-11 h-11 bg-slate-800 text-slate-200 border border-slate-700 rounded-xl flex items-center justify-center mx-auto mb-3">
              <ShieldAlert className="w-5 h-5 stroke-[2]" />
            </div>

            <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase font-mono block mb-1">
              Match invitation received
            </span>
            <h2 className="text-lg font-bold text-white uppercase tracking-tight font-sans">
              Arena #{pendingRoomPreview.roomId} Details
            </h2>
            <p className="text-slate-400 text-xs mt-1">
              Host <span className="text-slate-200 font-bold">{pendingRoomPreview.hostName}</span> invites you to play.
            </p>

            <div className="my-6 space-y-3 text-left">
              <div className="bg-slate-950 border border-slate-800 p-3.5 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-bold text-slate-500 block uppercase font-mono">Time Limits</span>
                  <span className="text-xs font-bold text-slate-200">{pendingRoomPreview.gameTime} Minutes / Side</span>
                </div>
                <div className="text-right">
                  <span className="text-[9px] font-bold text-slate-500 block uppercase font-mono">Match Stake</span>
                  <span className="text-xs font-mono font-bold text-slate-200">
                    {pendingRoomPreview.entryFee ? (
                      <span className="inline-flex items-center gap-1 text-amber-300">
                        <KentroCoin size="2xs" /> {pendingRoomPreview.entryFee.toLocaleString()}
                      </span>
                    ) : "Free Match"}
                  </span>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 p-3.5 rounded-xl">
                <span className="text-[9px] font-bold text-slate-500 block uppercase font-mono mb-1">Rule Variation</span>
                <span className="text-xs font-bold text-slate-200 block">
                  {getRuleDetails(pendingRoomPreview.specialRule).title}
                </span>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {getRuleDetails(pendingRoomPreview.specialRule).desc}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleRefuseMatch}
                className="py-3 px-4 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white font-bold text-xs uppercase tracking-wider rounded-xl transition cursor-pointer"
              >
                Refuse Match
              </button>
              <button
                onClick={handleAcceptMatch}
                className="py-3 px-4 bg-slate-100 hover:bg-white text-slate-950 font-bold text-xs uppercase tracking-wider rounded-xl transition cursor-pointer shadow-md"
              >
                Accept & Play
              </button>
            </div>
          </motion.div>
        )}

        {/* CASE C: STANDARD LOBBY VIEWS */}
        {!isHostingSetup && !pendingRoomPreview && (!inviteRoomCode || roomId !== null) && (
          roomId === null ? (
            
            /* MAIN LOBBY DASHBOARD */
            <motion.div
              key="lobby-home"
              initial="hidden"
              animate="visible"
              variants={{
                visible: { transition: { staggerChildren: 0.05 } }
              }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-6"
            >
              {/* Left Feature Column (8 Cols) */}
              <div className="lg:col-span-8 flex flex-col gap-6">
                
                {/* Play-first hero: the only primary call to action. */}
                <section className="k-arena-quick bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-5" aria-labelledby="arena-find-title">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <p className="text-xs text-emerald-300 font-bold mb-2 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400"/> Nigerian Draughts · 10×10</p>
                      <h2 id="arena-find-title" className="text-xl md:text-2xl font-bold text-white tracking-tight">Find your next match</h2>
                      <p className="text-slate-400 text-sm mt-1">Choose your clock. Play a free standard game in one tap.</p>
                    </div>
                    <span className="self-start text-xs font-medium text-slate-300 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2">{joinableRoomCount} available challenge{joinableRoomCount === 1 ? '' : 's'}</span>
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-slate-300 mb-2 block">Minutes per player</span>
                    <div className="grid grid-cols-4 gap-2" role="group" aria-label="Quick Match clock">
                      {QUICK_MATCH_TIMES.map(minutes => (
                        <button key={minutes} type="button" onClick={() => setQuickTime(minutes)} aria-pressed={quickTime === minutes}
                          className={`k-arena-time-preset rounded-xl py-3 text-sm font-bold border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 ${quickTime === minutes ? 'bg-amber-300 text-slate-950 border-amber-200' : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'}`}>
                          {minutes} min
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button type="button" onClick={handleQuickMatch}
                      disabled={connectionStatus !== 'connected' || Boolean(pendingHostMatch || pendingJoinRoom)}
                      className="k-arena-primary flex items-center justify-center gap-2 rounded-xl bg-amber-300 text-slate-950 py-3.5 px-5 font-bold text-sm hover:bg-amber-200 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300">
                      {pendingHostMatch || pendingJoinRoom ? <RefreshCw className="w-4 h-4 animate-spin"/> : <Zap className="w-4 h-4"/>}
                      {pendingHostMatch || pendingJoinRoom ? 'Connecting…' : `Play ${quickTime}-minute match`}
                    </button>
                    <button type="button" onClick={handleCreateRoomClick}
                      className="k-arena-secondary flex items-center justify-center gap-2 rounded-xl bg-slate-800 text-slate-100 py-3.5 px-5 font-bold text-sm border border-slate-700 hover:bg-slate-700">
                      <Plus className="w-4 h-4"/> Custom game
                    </button>
                  </div>
                  <p role="status" className="text-xs text-slate-400">Quick Match joins a compatible open room. If none exists, your free room waits for an opponent.</p>
                </section>

                {/* Discoverable live challenges, inspired by a challenge lobby rather than a code-only flow. */}
                <section className="k-arena-challenges bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5" aria-labelledby="arena-challenges-heading">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                      <h3 id="arena-challenges-heading" className="text-base font-bold text-white">Open challenges</h3>
                      <p className="text-xs text-slate-400 mt-1">Join someone already waiting to play.</p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-slate-800 text-slate-200 text-xs font-semibold">{visibleChallenges.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Challenge type">
                    {([['standard','Standard · Free'], ['free','All free'], ['all','All games']] as const).map(([value,label]) => (
                      <button type="button" key={value} onClick={() => { setChallengeFilter(value); setShowAllChallenges(false); }}
                        aria-pressed={challengeFilter === value}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold border focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 ${challengeFilter === value ? 'border-amber-300/80 bg-amber-300/15 text-amber-200' : 'border-slate-700 text-slate-300 bg-slate-800 hover:bg-slate-700'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {visibleChallenges.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-700 text-center px-4 py-6">
                      <Users className="w-6 h-6 text-slate-400 mx-auto mb-2"/>
                      <p className="text-sm font-semibold text-slate-200">No matching challenges yet</p>
                      <p className="text-xs text-slate-400 mt-1">Use Quick Match to create a waiting room, or choose another filter.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {(showAllChallenges ? visibleChallenges : visibleChallenges.slice(0, 4)).map(challenge => (
                        <div key={challenge.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-sm text-white truncate">{guestDisplayName(challenge.hostName)}</p>
                            <p className="text-xs text-slate-400 mt-1">{challenge.gameTime} min · {challenge.specialRule === 'none' ? 'Standard rules' : 'Modified rules'} · {(challenge.wagerAmount ?? 0) > 0 ? `${challenge.wagerAmount} coins` : 'Free'}{(challenge.bestOf ?? 1) > 1 ? ` · Best of ${challenge.bestOf}` : ''}</p>
                          </div>
                          <button type="button" onClick={() => onJoinRoom(challenge.id)}
                            disabled={connectionStatus !== 'connected' || Boolean(pendingHostMatch || pendingJoinRoom)}
                            aria-label={`Join ${guestDisplayName(challenge.hostName)}'s ${challenge.gameTime} minute game`}
                            className="shrink-0 rounded-lg bg-slate-200 text-slate-950 px-4 py-2.5 text-xs font-bold hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed">Join</button>
                        </div>
                      ))}
                      {visibleChallenges.length > 4 && (
                        <button type="button" onClick={() => setShowAllChallenges(v => !v)}
                          className="w-full rounded-lg border border-slate-700 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-800">
                          {showAllChallenges ? 'Show fewer' : `View all ${visibleChallenges.length} challenges`}
                        </button>
                      )}
                    </div>
                  )}
                  {isGuest && <p className="text-xs text-slate-400 mt-3">Guest games must be free and single-match. Sign in to access coin games and series.</p>}
                </section>

                {/* Follow matches without leaving the arena for technical tools. */}
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => onSelectMode('KentroTV')}
                    className="bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl p-3.5 flex items-center gap-3 text-left text-sm font-semibold text-slate-200 min-h-14">
                    <Radio className="h-5 w-5 text-emerald-300 shrink-0"/> Watch live games <ArrowRight className="h-4 w-4 ml-auto text-slate-400"/>
                  </button>
                  <button type="button" onClick={() => onOpenPastGamesModal?.('PvP')}
                    className="bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl p-3.5 flex items-center gap-3 text-left text-sm font-semibold text-slate-200 min-h-14">
                    <History className="h-5 w-5 text-amber-300 shrink-0"/> Recent matches <ArrowRight className="h-4 w-4 ml-auto text-slate-400"/>
                  </button>
                </div>

                {/* DIRECT ROOM CODE SEARCH BAR */}
                <form
                  onSubmit={handleJoinRoom}
                  className="k-arena-join bg-slate-900 border border-slate-800 rounded-xl p-2.5 flex flex-col sm:flex-row items-center gap-2 shadow-md"
                >
                  <div className="flex items-center gap-2.5 px-3 py-2 w-full sm:w-auto flex-1 bg-slate-950 rounded-lg border border-slate-800">
                    <Search className="w-4 h-4 text-slate-500 shrink-0" />
                    <input
                      type="text"
                      maxLength={8}
                      value={roomInput}
                      onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                      placeholder="ENTER ROOM CODE (e.g. 2680001)"
                      className="bg-transparent border-none text-slate-100 placeholder-slate-600 text-xs text-center sm:text-left font-mono font-bold tracking-widest focus:outline-none w-full uppercase"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!roomInput.trim() || pendingJoinRoom !== null}
                    className="w-full sm:w-auto px-5 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 font-bold text-xs uppercase tracking-wider border border-slate-700 rounded-lg transition cursor-pointer shrink-0 shadow-sm flex items-center justify-center gap-1.5"
                  >
                    {pendingJoinRoom ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                    <span>Join Room</span>
                  </button>
                </form>

                {roomError && (
                  <p className="text-xs text-rose-400 font-medium bg-rose-500/10 px-3 py-2 rounded-xl border border-rose-500/20 text-center">
                    {roomError}
                  </p>
                )}

                <button type="button" onClick={() => onSelectMode("OfflineNearby")}
                  className="w-full bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-bold rounded-xl px-4 py-3 flex items-center justify-center gap-2 text-xs">
                  <Wifi className="w-4 h-4" /> Play Nearby Offline — Wi-Fi / Hotspot
                </button>

                {/* Advanced utilities are discoverable, not forced ahead of finding a match. */}
                <button type="button" onClick={() => setShowMoreArenaTools(v => !v)} className="k-arena-tools-toggle" aria-expanded={showMoreArenaTools}>
                  <Sliders className="w-4 h-4"/> {showMoreArenaTools ? "Hide more arena tools" : "More arena tools"} <ChevronRight className={showMoreArenaTools ? "rotate-90 w-4 h-4" : "w-4 h-4"}/>
                </button>
                {showMoreArenaTools && <div className="k-arena-advanced bg-slate-900 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                      <Swords className="w-4 h-4 text-slate-400" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 font-mono">
                        Online Game Hub
                      </h3>
                    </div>
                    <span className="text-[10px] text-slate-300 bg-slate-800 border border-slate-700 px-2.5 py-0.5 rounded-full font-mono">
                      {onlineUsers.length} Players Online
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    
                    {/* 1. Create game */}
                    <button
                      onClick={handleCreateRoomClick}
                      disabled={pendingHostMatch}
                      className="bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 font-bold p-4 rounded-xl flex flex-col items-center justify-center gap-2 transition cursor-pointer text-center group"
                    >
                      <Plus className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors stroke-[2]" />
                      <span className="text-xs font-semibold uppercase tracking-wider">Create game</span>
                    </button>

                    {/* 2. Active games */}
                    <button
                      onClick={() => onSelectMode("KentroTV")}
                      className="bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 font-bold p-4 rounded-xl flex flex-col items-center justify-center gap-2 transition cursor-pointer text-center group"
                    >
                      <Activity className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors stroke-[2]" />
                      <span className="text-xs font-semibold uppercase tracking-wider">Watch live</span>
                    </button>

                    {/* 3. All Matches */}
                    <button
                      onClick={() => onOpenPastGamesModal?.("PvP")}
                      className="bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 font-bold p-4 rounded-xl flex flex-col items-center justify-center gap-2 transition cursor-pointer text-center group"
                    >
                      <Trophy className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors stroke-[2]" />
                      <span className="text-xs font-semibold uppercase tracking-wider">All Matches</span>
                    </button>

                    {/* 4. Find Game */}
                    <button
                      onClick={() => setShowFindGameModal(true)}
                      className="bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 font-bold p-4 rounded-xl flex flex-col items-center justify-center gap-2 transition cursor-pointer text-center group"
                    >
                      <Search className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors stroke-[2]" />
                      <span className="text-xs font-semibold uppercase tracking-wider">Find Game</span>
                    </button>

                    {/* 5. Players */}
                    <button
                      onClick={onOpenPlayers}
                      className="bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 font-bold p-4 rounded-xl flex flex-col items-center justify-center gap-2 transition cursor-pointer text-center group"
                    >
                      <Users className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors stroke-[2]" />
                      <span className="text-xs font-semibold uppercase tracking-wider">Players</span>
                    </button>

                    {/* 6. Coin Matches */}
                    <button
                      onClick={() => {
                        setSetupWager(50);
                        setIsHostingSetup(true);
                      }}
                      className="bg-slate-950 hover:bg-slate-900 border border-amber-500/30 hover:border-amber-400/60 text-amber-200 font-bold p-4 rounded-xl flex flex-col items-center justify-center gap-2 transition cursor-pointer text-center group shadow-md"
                    >
                      <KentroCoin size="md" glow interactive />
                      <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">Coin Matches</span>
                    </button>

                    {/* 7. Quick Match */}
                    <button
                      onClick={() => {
                        handleQuickMatch();
                      }}
                      className="bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 font-bold p-4 rounded-xl flex flex-col items-center justify-center gap-2 transition cursor-pointer text-center group"
                    >
                      <Zap className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors stroke-[2]" />
                      <span className="text-xs font-semibold uppercase tracking-wider">Quick Match</span>
                    </button>

                    {/* 8. Awaiting opponent */}
                    <button
                      onClick={() => setShowAwaitingModal(true)}
                      className="relative bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 font-bold p-4 rounded-xl flex flex-col items-center justify-center gap-2 transition cursor-pointer text-center group"
                    >
                      {openRooms.length > 0 && (
                        <span className="absolute top-2.5 right-2.5 bg-slate-800 text-slate-200 border border-slate-700 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full shadow-sm">
                          {openRooms.length}
                        </span>
                      )}
                      <Clock className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors stroke-[2]" />
                      <span className="text-xs font-semibold uppercase tracking-wider">Awaiting opponent</span>
                    </button>

                    {/* 9. Puzzles */}
                    <button
                      onClick={() => onSelectMode("Puzzles")}
                      className="bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 font-bold p-4 rounded-xl flex flex-col items-center justify-center gap-2 transition cursor-pointer text-center group"
                    >
                      <PuzzleIcon className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors stroke-[2]" />
                      <span className="text-xs font-semibold uppercase tracking-wider">Puzzles</span>
                    </button>

                    {/* 10. Tournaments */}
                    <button
                      onClick={() => onSelectMode("Tournament")}
                      className="bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 font-bold p-4 rounded-xl flex flex-col items-center justify-center gap-2 transition cursor-pointer text-center group"
                    >
                      <Award className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors stroke-[2]" />
                      <span className="text-xs font-semibold uppercase tracking-wider">Tournaments</span>
                    </button>

                    {/* 11. Special Rules */}
                    <button
                      onClick={() => {
                        setSetupSpecialRule("crown-crown");
                        setIsHostingSetup(true);
                      }}
                      className="bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 font-bold p-4 rounded-xl flex flex-col items-center justify-center gap-2 transition cursor-pointer text-center group"
                    >
                      <Shield className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors stroke-[2]" />
                      <span className="text-xs font-semibold uppercase tracking-wider">Special Rules</span>
                    </button>

                    {/* 12. Custom Board */}
                    <button
                      onClick={() => setIsHostingSetup(true)}
                      className="bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 font-bold p-4 rounded-xl flex flex-col items-center justify-center gap-2 transition cursor-pointer text-center group"
                    >
                      <Sliders className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors stroke-[2]" />
                      <span className="text-xs font-semibold uppercase tracking-wider">Custom Board</span>
                    </button>

                  </div>
                </div>}

                {/* INLINE AWAITING OPPONENT OPEN ROOMS BAR */}
                {openRooms.length > 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
                    <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-slate-400" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 font-mono">
                          Open Rooms Waiting ({openRooms.length})
                        </h3>
                      </div>
                      <button
                        onClick={() => setShowAwaitingModal(true)}
                        className="text-[11px] text-slate-400 hover:text-slate-200 font-bold uppercase font-mono transition"
                      >
                        View All →
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {openRooms.slice(0, 4).map((r) => {
                        const isMine = r.creator === username || r.hostName === username;
                        return (
                          <div
                            key={r.id}
                            className={`p-3.5 rounded-xl border flex items-center justify-between ${
                              isMine ? "bg-slate-800 border-slate-700" : "bg-slate-950 border-slate-800"
                            }`}
                          >
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-mono font-bold text-slate-200">
                                  #{r.id}
                                </span>
                                {isMine && (
                                  <span className="text-[8px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded font-mono">
                                    Your Code
                                  </span>
                                )}
                              </div>
                              <span className="text-xs font-medium text-slate-300 block">{r.hostName}</span>
                              <span className="text-[10px] text-slate-500 font-mono">⏱️ {r.gameTime}m</span>
                            </div>

                            {isMine ? (
                              <button
                                onClick={() => onCancelRoom?.(r.id)}
                                className="px-3 py-1.5 bg-slate-900 hover:bg-rose-900/40 text-slate-300 hover:text-rose-300 border border-slate-700 font-medium text-xs rounded-lg transition cursor-pointer"
                              >
                                Cancel
                              </button>
                            ) : (
                              <button
                                onClick={() => onJoinRoom(r.id)}
                                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold text-xs rounded-lg border border-slate-700 transition cursor-pointer"
                              >
                                Join
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              </div>

              {/* Right Sidebar (4 Cols) */}
              <div className="lg:col-span-4 flex flex-col gap-6">
                
                {/* PLAYER STATS CARD */}
                <motion.div
                  variants={cardVariants}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4 shadow-xl relative overflow-hidden"
                >
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-1.5">
                      <Award className="w-4 h-4 text-slate-400" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 font-mono">
                        Your Statistics
                      </h3>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">Rating Record</span>
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between bg-slate-950 border border-slate-800 p-3 rounded-xl">
                      <div>
                        <span className="text-[9px] font-bold text-slate-500 block uppercase font-mono mb-0.5">ELO Rating</span>
                        <span className="text-2xl font-black text-slate-100 font-mono leading-none">{profileStats.elo}</span>
                      </div>
                      <div className={`flex items-center gap-1.5 ${rank.color} border px-3 py-1 rounded-lg text-xs font-bold shadow-sm`}>
                        <span>{rank.icon}</span>
                        <span>{rank.name}</span>
                      </div>
                    </div>

                    <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl flex flex-col gap-1.5">
                      <div className="flex justify-between items-center text-[10px] font-mono">
                        <span className="text-slate-400 uppercase font-semibold">Record (W-D-L)</span>
                        <span className="font-bold text-slate-200">
                          <span className="text-slate-200">{profileStats.wins}W</span> -{" "}
                          <span className="text-slate-400">{profileStats.draws}D</span> -{" "}
                          <span className="text-slate-500">{profileStats.losses}L</span>
                        </span>
                      </div>

                      <div className="w-full h-2 rounded-full overflow-hidden bg-slate-800 flex">
                        {totalGames === 0 ? (
                          <div className="w-full h-full bg-slate-700/50" />
                        ) : (
                          <>
                            {profileStats.wins > 0 && (
                              <div className="h-full bg-slate-300" style={{ width: `${(profileStats.wins / totalGames) * 100}%` }} />
                            )}
                            {profileStats.draws > 0 && (
                              <div className="h-full bg-slate-500" style={{ width: `${(profileStats.draws / totalGames) * 100}%` }} />
                            )}
                            {profileStats.losses > 0 && (
                              <div className="h-full bg-slate-700" style={{ width: `${(profileStats.losses / totalGames) * 100}%` }} />
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-slate-950 p-2.5 border border-slate-800 rounded-lg text-center">
                        <span className="text-[8px] font-bold text-slate-500 uppercase font-mono block">Win Rate</span>
                        <span className="text-xs font-mono font-bold text-slate-200">{winRate}%</span>
                      </div>
                      <div className="bg-slate-950 p-2.5 border border-slate-800 rounded-lg text-center">
                        <span className="text-[8px] font-bold text-slate-500 uppercase font-mono block">Avg Match</span>
                        <span className="text-xs font-mono font-bold text-slate-200">{formatDuration(profileStats.averageDuration)}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>

                {/* ONLINE PLAYERS FEED */}
                <motion.div 
                  variants={cardVariants}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col flex-grow shadow-xl"
                >
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
                    <div className="flex items-center gap-1.5">
                      <Activity className="w-4 h-4 text-slate-400" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 font-mono">
                        Online Lobby ({onlineUsers.length})
                      </h3>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  </div>

                  <div className="flex-grow overflow-y-auto max-h-[320px] bg-slate-950 rounded-xl border border-slate-800 p-2.5 flex flex-col gap-2 scrollbar-thin">
                    {onlineUsers.filter(u => u !== username).length === 0 ? (
                      <div className="text-center py-8 text-slate-500 text-xs italic">
                        No other players online right now.
                      </div>
                    ) : (
                      onlineUsers.map((user, idx) => (
                        <div 
                          key={idx} 
                          className={`p-2.5 flex items-center justify-between rounded-lg border transition ${
                            user === username ? "bg-slate-900 border-slate-800" : "bg-slate-950 border-slate-850"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Avatar name={user} size={24} />
                            <AdminTappableName
                              username={user}
                              className={`text-xs font-bold ${user === username ? "text-slate-100" : "text-slate-300"}`}
                            >
                              {user} {user === username ? "(You)" : ""}
                            </AdminTappableName>
                          </div>
                          <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        </div>
                      ))
                    )}
                  </div>
                </motion.div>

              </div>
            </motion.div>

          ) : (
            
            /* PRIVATE IN-ROOM MATCHMAKING LOBBY */
            <motion.div
              key="lobby-room"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="max-w-3xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 md:p-8 shadow-2xl space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                <div>
                  <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest block">
                    Active Room Arena
                  </span>
                  <h2 className="text-xl font-bold text-slate-100 font-mono tracking-wider">
                    ROOM #{roomId}
                  </h2>
                </div>
                <div className="flex items-center flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleCopyWhatsAppLink}
                    title="Copy a direct game link to paste in WhatsApp"
                    className="px-3.5 py-2 bg-emerald-900/30 hover:bg-emerald-800/50 border border-emerald-700/50 text-emerald-300 rounded-xl transition text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    {inviteCopied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                    <span>{inviteCopied ? "Link Copied!" : "Copy to WhatsApp"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="px-3.5 py-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-200 rounded-xl transition text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    <span>{copied ? "Copied!" : "Copy Code"}</span>
                  </button>
                  <button
                    onClick={handleLeaveRoom}
                    className="px-3.5 py-2 bg-slate-950 hover:bg-rose-900/40 text-rose-400 border border-slate-800 rounded-xl transition text-xs font-bold cursor-pointer"
                  >
                    Leave Room
                  </button>
                </div>
              </div>

              {copyError && <p role="alert" className="text-xs text-rose-300">{copyError}</p>}
              {inviteCopied && <p role="status" className="text-xs text-emerald-300">Link copied. Paste it in WhatsApp — your opponent can tap it and select Start Game.</p>}
              {!isGuest && roomPlayers.length < 2 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
                  <p className="text-xs font-extrabold text-amber-300">Challenge a friend · Send an in-app alert</p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input value={friendChallengeName} onChange={e => setFriendChallengeName(e.target.value)} list="kentro-friend-suggestions" placeholder="Friend's username" aria-label="Friend to challenge" className="flex-1 min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
                    <datalist id="kentro-friend-suggestions">{friendSuggestions.map(name => <option key={name} value={name}/>)}</datalist>
                    <button type="button" disabled={challengeSending || !friendChallengeName.trim()} onClick={() => void sendFriendChallenge()} className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 disabled:opacity-40">{challengeSending ? "Sending…" : "Send Challenge"}</button>
                  </div>
                  <p className="text-[10px] text-slate-400">For connected friends only. They can tap the notification to open your room.</p>
                  {friendChallengeState && <p role="status" className="text-xs text-amber-200">{friendChallengeState}</p>}
                </div>
              )}

              {/* Room Players Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {["W", "B"].map((colorKey) => {
                  const player = roomPlayers.find((p) => p.color === colorKey);
                  return (
                    <div
                      key={colorKey}
                      className={`p-5 rounded-xl border flex flex-col justify-between gap-3 ${
                        player
                          ? "bg-slate-950 border-slate-800"
                          : "bg-slate-950/40 border-slate-850 border-dashed"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                          {colorKey === "W" ? "White Pieces (First)" : "Black Pieces (Second)"}
                        </span>
                        <span className={`w-3 h-3 rounded-full ${colorKey === "W" ? "bg-slate-200" : "bg-slate-800 border border-slate-600"}`} />
                      </div>

                      {player ? (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={player.username} size={32} />
                            <div>
                              <AdminTappableName username={player.username} className="text-sm font-bold text-white block">
                                {player.username}
                              </AdminTappableName>
                              {player.username === username && (
                                <span className="text-[9px] text-slate-400 font-mono font-bold">You</span>
                              )}
                            </div>
                          </div>
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border ${
                            player.ready ? "bg-slate-800 text-slate-200 border-slate-700" : "bg-slate-950 text-slate-400 border-slate-800"
                          }`}>
                            {player.ready ? "READY" : "Waiting"}
                          </span>
                        </div>
                      ) : (
                        <div className="py-4 text-center text-slate-500 text-xs italic">
                          Waiting for opponent to join...
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Room Match Status */}
              <div className="pt-4 border-t border-slate-800 text-center">
                {roomPlayers.length < 2 ? (
                  <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center justify-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-xs font-mono font-bold text-slate-300">
                      Share code <span className="text-amber-400 tracking-wider font-black">#{roomId}</span> with your opponent — match launches directly to the board once accepted!
                    </span>
                  </div>
                ) : (
                  <div className="p-4 bg-emerald-950/40 border border-emerald-800/60 rounded-xl flex items-center justify-center gap-3 text-emerald-400">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                    <span className="text-xs font-mono font-bold">
                      Both players joined! Launching game board directly...
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          )
        )}

      </AnimatePresence>

      {/* AWAITING OPPONENT MODAL */}
      <AnimatePresence>
        {showAwaitingModal && (
          <div className="fixed inset-0 z-50 bg-slate-950/90 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh] relative"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-lg font-black text-white uppercase tracking-tight">Awaiting Opponent Bar</h3>
                </div>
                <button
                  onClick={() => setShowAwaitingModal(false)}
                  className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs text-slate-400 mt-3 mb-4">
                Below are active room codes created without an opponent yet. You can join any open room or manage codes created by you.
              </p>

              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {awaitingRooms.length === 0 ? (
                  <div className="text-center py-8 bg-slate-950/50 rounded-2xl border border-slate-800/80 p-4">
                    <Clock className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-slate-300 text-xs font-bold">No room codes waiting right now.</p>
                    <p className="text-slate-500 text-[11px] mt-1">Create a room code and share it or wait for an opponent to join!</p>
                    <button
                      onClick={() => {
                        setShowAwaitingModal(false);
                        setIsHostingSetup(true);
                      }}
                      className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-xl transition cursor-pointer"
                    >
                      + Create Room Code
                    </button>
                  </div>
                ) : (
                  awaitingRooms.map((room) => {
                    const isMine = room.creator === username || room.hostName === username;
                    return (
                      <div
                        key={room.id}
                        className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                          isMine
                            ? "bg-amber-500/10 border-amber-500/30"
                            : "bg-slate-950/80 border-slate-800/80"
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-mono font-black text-amber-400 tracking-wider">
                              ROOM #{room.id}
                            </span>
                            {isMine && (
                              <span className="text-[9px] font-extrabold bg-amber-400/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-400/30 uppercase font-mono">
                                Your Unused Code
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-bold text-slate-200">
                            Host: <span className="text-slate-300">{room.hostName}</span>
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                            <span>⏱️ {room.gameTime}m</span>
                            <span>•</span>
                            <span>{room.specialRule === "none" ? "Standard Rules" : room.specialRule}</span>
                            {room.wagerAmount > 0 && (
                              <>
                                <span>•</span>
                                <span className="text-amber-300 font-bold inline-flex items-center gap-1">
                                  <KentroCoin size="2xs" /> {room.wagerAmount.toLocaleString()}
                                </span>
                              </>
                            )}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end">
                          {isMine ? (
                            <button
                              onClick={() => {
                                if (onCancelRoom) onCancelRoom(room.id);
                              }}
                              className="px-3 py-2 bg-rose-500/15 hover:bg-rose-500 text-rose-400 hover:text-white border border-rose-500/30 font-extrabold text-xs rounded-xl transition cursor-pointer"
                            >
                              Cancel / Close Room
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                setShowAwaitingModal(false);
                                onJoinRoom(room.id);
                              }}
                              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-xl transition cursor-pointer shadow-md shadow-emerald-950/20"
                            >
                              Join Match
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* FIND GAME MODAL */}
      <AnimatePresence>
        {showFindGameModal && (
          <div className="fixed inset-0 z-50 bg-slate-950/90 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl relative"
            >
              <button
                onClick={() => setShowFindGameModal(false)}
                className="absolute top-4 right-4 p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="text-center mb-6">
                <div className="w-12 h-12 bg-emerald-500/10 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Search className="w-6 h-6 stroke-[2.5]" />
                </div>
                <h3 className="text-lg font-black text-white uppercase tracking-tight">Find Game Room</h3>
                <p className="text-slate-400 text-xs mt-1">
                  Enter a room code to search and join an existing match.
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (roomInput.trim()) {
                    setShowFindGameModal(false);
                    onJoinRoom(roomInput.trim());
                  }
                }}
                className="flex flex-col gap-3"
              >
                <input
                  type="text"
                  maxLength={8}
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                  placeholder="ENTER CODE (e.g. 2680001)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-600 text-sm text-center font-bold font-mono tracking-widest focus:outline-none focus:border-emerald-500 transition"
                />
                {roomError && (
                  <p className="text-[11px] text-rose-400 font-medium bg-rose-500/10 px-3 py-1.5 rounded-xl border border-rose-500/20 text-center">
                    {roomError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={!roomInput.trim() || pendingJoinRoom !== null}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-extrabold uppercase text-xs tracking-wider rounded-xl transition cursor-pointer shadow-lg shadow-emerald-950/20 flex items-center justify-center gap-2"
                >
                  {pendingJoinRoom && <RefreshCw className="w-4 h-4 animate-spin" />}
                  Search & Join Room
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>


    </div>
  );
}

export const LobbyDashboard = React.memo(LobbyDashboardImpl, shallowEqualIgnoringFunctions);
