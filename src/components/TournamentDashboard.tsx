import React, { useState, useEffect, useRef } from "react";
import { 
  Trophy, Users, Calendar, Clock, Shield, Award, Sparkles, Cpu, 
  MessageSquare, Send, Plus, RefreshCw, User, Heart, ThumbsUp, 
  Flame, Trash2, AlertTriangle, Crown, BookOpen, ChevronRight, 
  Info, X, ChevronDown, Check, Lock, Unlock, Play, Eye, Volume2, ShieldAlert,
  ArrowLeft
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { supabase, handleSupabaseError, OperationType } from "../supabase";
import { apiPost } from "../apiClient";
import { shallowEqualIgnoringFunctions } from "../memoUtils";
import { AdminTappableName } from "../lib/adminProfileContext";

export interface TournamentPlayer {
  username: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  streak: number;
  country: string;
  team?: string;
  isHuman: boolean;
  handicap?: string;
  // Set on exactly one roster entry per tournament: the official Ken 5 AI
  // Legacy archives may identify an engine entrant.
  isKen5?: boolean;
}

export interface TournamentMatch {
  id: string;
  round: number;
  white: string;
  black: string;
  winner: "W" | "B" | "D" | null;
  status: "pending" | "playing" | "completed";
  handicapInfo?: string;
  moveHistory?: string[];
  roomId?: string;
}

export interface TournamentChatMsg {
  id: string;
  sender: string;
  message: string;
  timestamp: number;
  isAnnouncement?: boolean;
  replyTo?: string;
  reactions?: Record<string, number>;
}

export interface Tournament {
  engineState?: { endsAt?: number; champions?: string[] };
  id: string;
  name: string;
  description: string;
  type: string;
  visibility: "public" | "private";
  inviteCode: string;
  maxPlayers: number;
  minPlayers: number;
  registrationDeadline: string;
  startTime: string;
  timeControl: string;
  handicap: string;
  tieBreak: string;
  prize: string;
  spectatorPermission: boolean;
  status: "registration" | "active" | "completed";
  currentRound: number;
  maxRounds: number;
  players: TournamentPlayer[];
  matches: TournamentMatch[];
  chat: TournamentChatMsg[];
  logs: string[];
  createdAt: string;
}

interface TournamentDashboardProps {
  username: string;
  userRating: number;
  onStartMatch: (opponent: string, playerColor: "W" | "B", handicap: string, matchId: string, timeControl: string, roomId?: string) => void;
  activeMatchId: string | null;
  activeMatchOutcome: "win" | "loss" | "draw" | null;
  onResetMatchOutcome: () => void;
  muted: boolean;
  playClickSound: (m: boolean) => void;
  playPromoSound: (m: boolean) => void;
  playVictorySound: (m: boolean) => void;
  canManageTournaments: boolean;
  onSpectateMatch?: (roomId: string) => void;
  onBackToHome?: () => void;
}

function TournamentDashboardImpl({
  username,
  userRating,
  onStartMatch,
  onSpectateMatch,
  activeMatchId,
  activeMatchOutcome,
  onResetMatchOutcome,
  muted,
  playClickSound,
  playPromoSound,
  playVictorySound,
  canManageTournaments,
  onBackToHome
}: TournamentDashboardProps) {
  const [organizerWinner, setOrganizerWinner] = useState<string>("");
  const [organizerBusy, setOrganizerBusy] = useState<boolean>(false);
  
  const [viewState, setViewState] = useState<"lobby" | "create" | "active" | "results">("lobby");
  const [tournamentsList, setTournamentsList] = useState<Tournament[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Toast notifications -- replaces native alert() dialogs, which look
  // jarring/out of place next to the rest of this app's custom-styled UI.
  // Mirrors the auto-dismissing pill pattern already used for the
  // "promoted to King" toast in App.tsx, for visual consistency.
  const [toast, setToast] = useState<{ message: string; kind: "error" | "info" } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (message: string, kind: "error" | "info" = "error") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, kind });
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  };
  
  // Create Form States
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formType, setFormType] = useState("Swiss Tournament");
  const [formVisibility, setFormVisibility] = useState<"public" | "private">("public");
  const [formInviteCode, setFormInviteCode] = useState("");
  const [formMaxPlayers, setFormMaxPlayers] = useState(8);
  const [formMinPlayers, setFormMinPlayers] = useState(4);
  const [formTimeControl, setFormTimeControl] = useState("Rapid 5+5");
  const [formHandicap, setFormHandicap] = useState("None");
  const [formTieBreak, setFormTieBreak] = useState("Sonneborn-Berger");
  const [formPrize, setFormPrize] = useState("100 Coins + Gold Badge");
  const [formSpectator, setFormSpectator] = useState(true);
  const [formTeamName, setFormTeamName] = useState("Lagos Kings");

  // Invitation Code Join State
  const [joinCode, setJoinCode] = useState("");

  // Active Tournament
  const [activeTour, setActiveTour] = useState<Tournament | null>(null);
  
  // Interactive Live Chat
  const [chatInput, setChatInput] = useState("");
  const [replyToId, setReplyToId] = useState<string | undefined>(undefined);
  const [isOrganizerAnnouncement, setIsOrganizerAnnouncement] = useState(false);
  const [notifications, setNotifications] = useState<string[]>([]);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Spectator simulation states

  // Timer simulation tick (runs in active tournament)
  const [timeRemaining, setTimeRemaining] = useState<number>(3600); // 1 hour

  // Fetch or setup basic tournaments
  const loadTournaments = async () => {
    setIsLoading(true);
    try {
      let list: Tournament[] = [];
      try {
        // Bounded (was an unbounded fetch-the-whole-table query) -- 50 most
        // recent tournaments is plenty for the listing view and keeps read cost
        // from growing linearly with total tournaments ever created.
        const { data, error } = await supabase.from("tournaments").select("*").order("createdAt", { ascending: false }).limit(50);
        if (error) throw error;
        list = (data ?? []) as Tournament[];
      } catch (err) {
        handleSupabaseError(err, OperationType.GET, "tournaments");
      }
      
      // Real tournaments only -- no fake/demo placeholders. An empty list is
      // shown as-is; see the "No tournaments" empty state in the lobby view.
      setTournamentsList(list);
      setActiveTour(current => current ? list.find(t => t.id === current.id) || null : null);
    } catch (e) {
      console.error("Supabase tournaments error, falling back:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void loadTournaments(); const timer = setInterval(() => void loadTournaments(), 5000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (activeMatchOutcome) { onResetMatchOutcome(); void loadTournaments(); } }, [activeMatchOutcome]);
  useEffect(() => {
    const update = () => setTimeRemaining(Math.max(0, Math.ceil(((activeTour?.engineState?.endsAt || Date.now()) - Date.now()) / 1000)));
    update(); const timer = setInterval(update, 1000); return () => clearInterval(timer);
  }, [activeTour?.engineState?.endsAt]);

  // Auto scroll chat to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeTour?.chat]);

  // Create Tournament Handler
  const handleCreateTournament = async () => {
    if (!formName.trim() || isLoading) return;
    setIsLoading(true);
    try {
      const result = await apiPost('/api/admin/tournaments', { name: formName, description: formDesc, type: formType, visibility: formVisibility,
        maxPlayers: formMaxPlayers, minPlayers: formMinPlayers, timeControl: formTimeControl, handicap: formHandicap, tieBreak: formTieBreak,
        prize: formPrize, spectatorPermission: formSpectator });
      setActiveTour(result.tournament); setViewState('active'); await loadTournaments();
    } catch (error) { showToast((error as Error).message || 'Could not create the tournament.'); }
    finally { setIsLoading(false); }
  };

  // Delete specific tournament
  const handleDeleteTournament = async (tournamentId: string, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation();
    }
    if (!window.confirm("Are you sure you want to delete this tournament? This action cannot be undone.")) {
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.from("tournaments").delete().eq("id", tournamentId);
      if (error) throw error;
      setTournamentsList(prev => prev.filter(t => t.id !== tournamentId));
      if (activeTour?.id === tournamentId) {
        setActiveTour(null);
        setViewState("lobby");
      }
      playVictorySound(muted);
    } catch (err) {
      console.error("Failed to delete tournament", err);
      handleSupabaseError(err, OperationType.WRITE, `tournaments/${tournamentId}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Delete all tournaments
  const handleDeleteAllTournaments = async () => {
    if (!window.confirm("Are you sure you want to delete ALL available tournaments? This action cannot be undone.")) {
      return;
    }
    setIsLoading(true);
    try {
      const ids = tournamentsList.map(t => t.id);
      if (ids.length > 0) {
        const { error } = await supabase.from("tournaments").delete().in("id", ids);
        if (error) throw error;
      }
      setTournamentsList([]);
      setActiveTour(null);
      setViewState("lobby");
      playVictorySound(muted);
    } catch (err) {
      console.error("Failed to delete all tournaments", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Join Tournament Handler
  const handleJoinTournament = async (tour: Tournament) => {
    playClickSound(muted);

    // Check if already in players -- just navigate, no payment involved.
    if (tour.players.some(p => p.username === username)) {
      setActiveTour(tour);
      setViewState("active");
      return;
    }

    // Spec: "When a player joins a tournament: the entry fee is deducted
    // automatically. If the player does not have enough coins, they cannot
    // register." This single call both charges the fee AND adds the player
    // to the roster, atomically, server-side (see /api/coins/tournament-entry)
    // -- capacity and "already registered" are re-checked there too, right
    // before charging, so this local `tour.players.length >= tour.maxPlayers`
    // check is just an early UI hint, not the real enforcement (the tour
    // object here could be stale; the server's is not).
    if (tour.players.length >= tour.maxPlayers) {
      showToast("Tournament is full!");
      return;
    }

    try {
      const result = await apiPost("/api/coins/tournament-entry", {
        // No username: the server derives it from the verified session --
        // the ONLY wallet this can ever charge is the caller's own.
        tournamentId: tour.id,
        playerData: { country: "NG", team: formTeamName },
      });

      // Trust the server's authoritative roster (result.players) rather than
      // constructing one locally -- this is what actually got committed,
      // atomically, alongside the payment.
      const updatedTour = { ...tour, players: result.players };
      setActiveTour(updatedTour);
      setViewState("active");
      loadTournaments();
    } catch (err: any) {
      if (err?.status === 402) {
        showToast(`Not enough Kentro Coins to enter this tournament (need ${err.data?.cost ?? "more"}). Buy more coins from the AI level panel.`);
      } else if (err?.status === 409 && err.data?.error === "Tournament is full") {
        showToast("Tournament just filled up -- try another one.");
        loadTournaments();
      } else if (err?.status === 409 && err.data?.players) {
        // Already registered (e.g. a duplicate click race) -- the server
        // still returns the current roster, so just adopt it.
        setActiveTour({ ...tour, players: err.data.players });
        setViewState("active");
      } else {
        showToast("Couldn't process the entry fee right now. Please try again.");
      }
    }
  };

  // Join Private Tournament
  const handleJoinPrivate = async () => {
    if (!joinCode.trim() || isLoading) return;
    setIsLoading(true);
    try {
      const result = await apiPost("/api/tournaments/invite", { inviteCode: joinCode.trim() });
      if (!result.tournament?.id || !Array.isArray(result.tournament.players)) throw new Error("The tournament invitation could not be loaded.");
      const authorizedTournament = result.tournament as Tournament;
      setTournamentsList(previous => [...previous.filter(tournament => tournament.id !== authorizedTournament.id), authorizedTournament]);
      setJoinCode("");
      await handleJoinTournament(authorizedTournament);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not redeem this invitation. Please try again.");
    } finally { setIsLoading(false); }
  };

  // Server-owned pairings, results and progression. The browser never reports a winner.
  const handleStartTournament = async () => {
    if (!activeTour || !canManageTournaments || isLoading) return;
    setIsLoading(true);
    try { const result = await apiPost('/api/tournaments/start', { tournamentId: activeTour.id }); setActiveTour(result.tournament); await loadTournaments(); }
    catch (error) { showToast((error as Error).message); }
    finally { setIsLoading(false); }
  };
  const handleLaunchMatch = async (match: TournamentMatch) => {
    if (!activeTour) return;
    try {
      const result = await apiPost('/api/tournaments/join-match', { tournamentId: activeTour.id, matchId: match.id });
      onStartMatch(match.white === username ? match.black : match.white, result.color, activeTour.handicap, match.id, activeTour.timeControl, result.roomId);
    } catch (error) { showToast((error as Error).message); }
  };
  const handleCompleteTournament = () => showToast('The server completes the tournament after its authoritative games finish.', 'info');

  // Chat message sending
  const handleSendChatMessage = async () => {
    if (!activeTour || !chatInput.trim()) return;
    playClickSound(muted);

    const newMsg: TournamentChatMsg = {
      id: `chat_${Date.now()}`,
      sender: username || "You",
      message: chatInput,
      timestamp: Date.now(),
      isAnnouncement: isOrganizerAnnouncement,
      replyTo: replyToId,
      reactions: {}
    };

    const updatedChat = [...activeTour.chat, newMsg];
    
    setActiveTour({
      ...activeTour,
      chat: updatedChat
    });

    setChatInput("");
    setReplyToId(undefined);
    setIsOrganizerAnnouncement(false);

    try {
      const { data: savedChat, error } = await supabase.rpc("kentro_tournament_chat", {
        p_tournament: activeTour.id, p_message: chatInput.trim(), p_reply: replyToId || null,
      });
      if (!error && Array.isArray(savedChat)) setActiveTour(current => current ? { ...current, chat: savedChat } : current);
      if (error) throw error;
    } catch (e) {
      setActiveTour(current => current ? { ...current, chat: current.chat.filter(message => message.id !== newMsg.id) } : current);
      showToast("Your chat message could not be sent. Please try again.");
    }
  };

  // Add notification to active tray
  const addNotification = (text: string) => {
    setNotifications(prev => [text, ...prev.slice(0, 4)]);
  };

  // Formatted date and times
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins}:${remainder < 10 ? "0" : ""}${remainder}`;
  };

  const getMedalColor = (index: number) => {
    if (index === 0) return "text-amber-400 bg-amber-500/10 border-amber-500/30";
    if (index === 1) return "text-slate-300 bg-slate-400/10 border-slate-400/30";
    if (index === 2) return "text-amber-700 bg-amber-700/10 border-amber-750/30";
    return "text-slate-500 bg-slate-900/40 border-slate-850";
  };

  // Quit active tournament lobby
  const handleQuitLobby = () => {
    playClickSound(muted);
    setActiveTour(null);
    setViewState("lobby");
  };

  return (
    <div className="k-tournament-hub w-full max-w-6xl mx-auto flex flex-col gap-5 text-slate-100 p-1.5 md:p-3 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -40 }}
            animate={{ opacity: 1, y: 12 }}
            exit={{ opacity: 0, y: -40 }}
            className={`fixed top-3 left-1/2 -translate-x-1/2 font-bold px-5 py-3 rounded-full shadow-2xl flex items-center gap-2 z-50 border text-xs tracking-wide max-w-[90vw] ${
              toast.kind === "error"
                ? "bg-red-950/95 border-red-500/40 text-red-200"
                : "bg-slate-900/95 border-amber-500/30 text-amber-200"
            }`}
          >
            {toast.kind === "error" ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <Check className="w-4 h-4 shrink-0" />}
            <span>{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HEADER HUB BAR */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 gap-4">
        <div>
          <h2 className="text-lg font-black tracking-tight text-white uppercase flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500 animate-pulse" />
            <span>KENTRO TOURNAMENT CENTRE</span>
          </h2>
          <p className="text-slate-400 text-xs mt-0.5">
            Create, register, automatically pair, chat and battle in 12 premium draughts formats.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {onBackToHome && (
            <button
              onClick={onBackToHome}
              className="bg-slate-900 border border-slate-800 hover:bg-slate-800 text-amber-400 font-extrabold px-3 py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shrink-0"
              title="Return to Home Dashboard"
            >
              <ArrowLeft className="w-4 h-4 text-amber-400" />
              <span>Home</span>
            </button>
          )}
          {viewState === "lobby" ? (
            canManageTournaments && (
              <button
                onClick={() => {
                  setViewState("create");
                  playClickSound(muted);
                }}
                className="w-full sm:w-auto bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-4 py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer uppercase shadow-md shadow-amber-500/10"
              >
                <Plus className="w-4 h-4 text-slate-950" />
                <span>Host Tournament</span>
              </button>
            )
          ) : (
            <button
              onClick={handleQuitLobby}
              className="w-full sm:w-auto bg-slate-800/80 hover:bg-slate-800 text-slate-300 font-bold px-4 py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <ChevronRight className="w-4 h-4 rotate-180" />
              <span>Back to Lobby</span>
            </button>
          )}
        </div>
      </div>

      {/* NOTIFICATIONS BAR */}
      {notifications.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5 px-4 text-xs text-amber-400 flex items-center justify-between gap-3 font-medium animate-pulse shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>{notifications[0]}</span>
          </div>
          <button 
            onClick={() => setNotifications([])} 
            className="text-amber-500 hover:text-amber-400 text-[10px] uppercase font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* RENDER CURRENT VIEW */}
      <AnimatePresence mode="wait">
        
        {/* VIEW 1: TOURNAMENT LOBBY LIST */}
        {viewState === "lobby" && (
          <motion.div
            key="lobby"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-5"
          >
            {/* PUBLIC TOURNAMENTS LIST */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">
                  Active & Upcoming Tournaments
                </h3>
                <div className="flex items-center gap-3">
                  <button
                    onClick={loadTournaments}
                    disabled={isLoading}
                    className="text-[10px] text-amber-400 hover:text-amber-300 transition flex items-center gap-1 font-bold"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </button>
                  {tournamentsList.length > 0 && canManageTournaments && (
                    <button
                      onClick={handleDeleteAllTournaments}
                      disabled={isLoading}
                      className="text-[10px] text-rose-500 hover:text-rose-400 transition flex items-center gap-1 font-bold bg-rose-500/10 hover:bg-rose-500/20 px-2 py-1 rounded border border-rose-500/20 cursor-pointer"
                      title="Delete all available tournaments"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete All
                    </button>
                  )}
                </div>
              </div>

              {isLoading ? (
                <div className="bg-slate-900/20 border border-slate-800/50 rounded-2xl py-12 text-center text-xs text-slate-400 italic">
                  Refreshing tournament brackets and registries...
                </div>
              ) : tournamentsList.length === 0 ? (
                <div className="bg-slate-900/20 border border-slate-800/50 rounded-2xl py-12 text-center text-xs text-slate-400 italic">
                  {canManageTournaments
                    ? "No active public tournaments found. Click 'Host Tournament' above to kickstart a custom event!"
                    : "No tournaments right now -- check back soon. New events are organized by the Kentro team."}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {tournamentsList.map(t => (
                    <div 
                      key={t.id}
                      className="bg-[#0b0e17] border border-slate-800/80 rounded-2xl p-5 flex flex-col justify-between hover:border-amber-500/30 transition shadow-lg relative overflow-hidden"
                    >
                      {/* Accent color badge based on status */}
                      <div className={`absolute top-0 right-0 px-2.5 py-0.5 rounded-bl-xl text-[9px] font-black uppercase ${
                        t.status === "registration" ? "bg-amber-500/10 text-amber-400 border-l border-b border-amber-500/25" :
                        t.status === "active" ? "bg-emerald-500/10 text-emerald-400 border-l border-b border-emerald-500/25 animate-pulse" :
                        "bg-slate-800 text-slate-400 border-l border-b border-slate-700"
                      }`}>
                        {t.status}
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between pr-16">
                          <span className="inline-flex text-[9px] font-black uppercase tracking-wider text-amber-500 bg-amber-500/5 px-2 py-0.5 rounded border border-amber-500/10">
                            {t.type}
                          </span>
                          {canManageTournaments && (
                            <button
                              onClick={(e) => handleDeleteTournament(t.id, e)}
                              className="p-1 text-rose-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition cursor-pointer"
                              title="Delete Tournament"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <h4 className="text-sm font-black text-white uppercase tracking-tight truncate pr-16">{t.name}</h4>
                        <p className="text-slate-400 text-xs line-clamp-2 leading-relaxed">{t.description}</p>
                      </div>

                      <div className="grid grid-cols-3 gap-2 border-t border-slate-900/80 pt-4 mt-4 text-[10px] text-slate-400">
                        <div>
                          <span className="block text-slate-500 font-bold uppercase text-[8px] tracking-wide">Checkers</span>
                          <span className="font-sans text-slate-300 font-semibold">{t.timeControl}</span>
                        </div>
                        <div>
                          <span className="block text-slate-500 font-bold uppercase text-[8px] tracking-wide">Handicap</span>
                          <span className="font-sans text-slate-300 font-semibold">{t.handicap}</span>
                        </div>
                        <div>
                          <span className="block text-slate-500 font-bold uppercase text-[8px] tracking-wide">Roster</span>
                          <span className="font-sans text-slate-300 font-semibold">{t.players.length}/{t.maxPlayers} Players</span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleJoinTournament(t)}
                        className="w-full mt-4 bg-slate-900 hover:bg-slate-850 hover:text-amber-400 text-slate-300 font-extrabold py-2 rounded-xl text-xs border border-slate-800 transition cursor-pointer"
                      >
                        {t.players.some(p => p.username === username) ? "ENTER LOBBY 🏆" : "REGISTER NOW ⚔️"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* JOIN PRIVATE & COMPETITION RULES */}
            <div className="space-y-5">
              
              {/* JOIN PRIVATE PANEL */}
              <div className="bg-[#0b0e17] border border-slate-800/80 rounded-2xl p-5 shadow-lg">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-amber-500" />
                  <span>Enter Private Invitation</span>
                </h3>
                <p className="text-slate-400 text-[11px] leading-relaxed mb-4">
                  Have an invitation code from a friend or club organizer? Paste it below to open your invitation securely.
                </p>
                
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    placeholder="e.g. NGP19A"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 font-mono font-bold tracking-widest uppercase"
                  />
                  <button
                    onClick={handleJoinPrivate}
                    disabled={isLoading || !joinCode.trim()}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-4 py-2 rounded-xl text-xs transition cursor-pointer uppercase"
                  >
                    Join
                  </button>
                </div>
              </div>

              {/* TOURNAMENT RULES SUMMARY PANEL */}
              <div className="bg-[#0b0e17] border border-slate-800/80 rounded-2xl p-5 shadow-lg space-y-3.5">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-amber-500" />
                  <span>Draughts Fair Play Center</span>
                </h3>

                <div className="space-y-3 text-[11px] text-slate-300 leading-normal">
                  <div className="flex gap-2.5">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <p>
                      <strong>Auto pairing matches:</strong> Pairing and byes are handled strictly by pairing rules (e.g. Swiss score-equality).
                    </p>
                  </div>
                  <div className="flex gap-2.5">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <p>
                      <strong>Robin Hood Handicaps:</strong> Rating differences trigger checkers handicaps (Short 1, 2, or 3) to balance the contest fairly.
                    </p>
                  </div>
                  <div className="flex gap-2.5">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <p>
                      <strong>Anti-Cheating Logs:</strong> Active games are reviewed by the Ken engine. Delayed ghost removal is fully audited.
                    </p>
                  </div>
                  <div className="flex gap-2.5">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <p>
                      <strong>Clock forfeits:</strong> Clocks run in live matches. Exceeding limit results in immediate defeat.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* VIEW 2: CREATE TOURNAMENT FORM */}
        {viewState === "create" && (
          <motion.div
            key="create"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-[#0b0e17] border border-slate-800/80 rounded-2xl p-6 md:p-8 shadow-2xl max-w-2xl mx-auto"
          >
            <h3 className="text-base font-black uppercase text-white tracking-tight mb-5 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" />
              <span>Configure Custom Tournament</span>
            </h3>

            <div className="space-y-5 text-xs text-slate-300">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-400 uppercase tracking-wider text-[9px]">Tournament Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Lagos Masters Draught League"
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500 font-medium"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-400 uppercase tracking-wider text-[9px]">Tournament Format (Select Type)</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value)}
                    className="bg-slate-950 border border-slate-800 text-slate-300 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-500 font-semibold"
                  >
                    <option value="Swiss Tournament">1. Swiss Tournament</option>
                    <option value="Arena Tournament">2. Arena Tournament (Speed Run)</option>
                    <option value="Single Elimination">3. Single Elimination</option>
                    <option value="Double Elimination">4. Double Elimination Bracket</option>
                    <option value="Round Robin">5. Round Robin League</option>
                    <option value="Team Tournament">6. Team Tournament</option>
                    <option value="League Tournament">7. Weekly League Cup</option>
                    <option value="Knockout Cup">8. Knockout Cup Playoffs</option>
                    <option value="Group Stage + Knockout">9. Group Stage + Knockout</option>
                    <option value="King of the Hill">10. King of the Hill (Winner stays on)</option>
                    <option value="Robin Hood Tournament (Handicap Tournament)">11. Robin Hood Handicap Cup</option>
                    <option value="Custom Tournament">12. Custom Bracket Tournament</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-slate-400 uppercase tracking-wider text-[9px]">Description & Rules</label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Explain event schedules, specific Nigerian rules (flying kings etc.), or prizes..."
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500 font-medium h-20 resize-none"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-400 uppercase tracking-wider text-[9px]">Time Control</label>
                  <select
                    value={formTimeControl}
                    onChange={(e) => setFormTimeControl(e.target.value)}
                    className="bg-slate-950 border border-slate-800 text-slate-300 rounded-xl px-3 py-2 focus:outline-none focus:border-amber-500 font-semibold"
                  >
                    <option value="Blitz 3 min">⚡ Blitz 3 mins</option>
                    <option value="Blitz 3+2">⚡ Blitz 3 mins + 2s increment</option>
                    <option value="Blitz 4 min">⚡ Blitz 4 mins</option>
                    <option value="Blitz 4+2">⚡ Blitz 4 mins + 2s</option>
                    <option value="Rapid 5 min">⏱️ Rapid 5 mins</option>
                    <option value="Rapid 5+5">⏱️ Rapid 5 mins + 5s increment</option>
                    <option value="Rapid 6 min">⏱️ Rapid 6 mins</option>
                    <option value="Rapid 7 min">⏱️ Rapid 7 mins</option>
                    <option value="Rapid 8 min">⏱️ Rapid 8 mins</option>
                    <option value="Rapid 9 min">⏱️ Rapid 9 mins</option>
                    <option value="Rapid 10 min">⏱️ Rapid 10 mins</option>
                    <option value="Classical 10+5">🏛️ Classical 10 mins + 5s</option>
                    <option value="Classical 15 min">🏛️ Classical 15 mins</option>
                    <option value="Classical 20 min">🏛️ Classical 20 mins</option>
                    <option value="Classical 30 min">🏛️ Classical 30 mins</option>
                    <option value="Untimed">∞ Untimed Match</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-400 uppercase tracking-wider text-[9px]">Handicap Rules</label>
                  <select
                    value={formHandicap}
                    onChange={(e) => setFormHandicap(e.target.value)}
                    className="bg-slate-950 border border-slate-800 text-slate-300 rounded-xl px-3 py-2 focus:outline-none focus:border-amber-500 font-semibold"
                  >
                    <option value="None">None (Standard 10x10)</option>
                    <option value="Short One">Short One (-1 checker)</option>
                    <option value="Short Two">Short Two (-2 checkers)</option>
                    <option value="Short Three">Short Three (-3 checkers)</option>
                    <option value="Time Advantage">Time Advantage (+3 mins to lower ELO)</option>
                    <option value="Crown Crown">Crown Crown (Start with 2 pre-crowned Kings)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-400 uppercase tracking-wider text-[9px]">Visibility Type</label>
                  <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        setFormVisibility("public");
                        playClickSound(muted);
                      }}
                      className={`flex-1 py-1 rounded-lg text-[10px] font-bold transition text-center ${
                        formVisibility === "public"
                          ? "bg-slate-900 text-amber-400 border border-slate-850"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      Public
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFormVisibility("private");
                        playClickSound(muted);
                      }}
                      className={`flex-1 py-1 rounded-lg text-[10px] font-bold transition text-center ${
                        formVisibility === "private"
                          ? "bg-slate-900 text-amber-400 border border-slate-850"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      Private Code
                    </button>
                  </div>
                </div>
              </div>

              {formVisibility === "private" && (
                <div className="flex flex-col gap-1.5 border border-amber-500/10 bg-amber-500/5 rounded-xl p-3">
                  <label className="font-bold text-amber-400 uppercase tracking-wider text-[9px]">Custom Invitation Code</label>
                  <input
                    type="text"
                    value={formInviteCode}
                    onChange={(e) => setFormInviteCode(e.target.value.toUpperCase())}
                    placeholder="e.g. NIGERIA100"
                    className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500 font-mono tracking-widest uppercase font-bold"
                  />
                  <span className="text-[10px] text-slate-500">Leaving blank auto-generates a secure 5-digit code.</span>
                </div>
              )}

              {formType.includes("Team Tournament") && (
                <div className="flex flex-col gap-1.5 border border-slate-800 bg-slate-950/40 rounded-xl p-3">
                  <label className="font-bold text-slate-400 uppercase tracking-wider text-[9px]">Select Your Team Squad</label>
                  <select
                    value={formTeamName}
                    onChange={(e) => setFormTeamName(e.target.value)}
                    className="bg-slate-950 border border-slate-800 text-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-500 font-semibold"
                  >
                    <option value="Lagos Kings">Lagos Kings (SW region)</option>
                    <option value="Abuja Warriors">Abuja Warriors (NC region)</option>
                    <option value="Enugu Falcons">Enugu Falcons (SE region)</option>
                    <option value="Kano Knights">Kano Knights (NW region)</option>
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-400 uppercase tracking-wider text-[9px]">Prize Config</label>
                  <input
                    type="text"
                    value={formPrize}
                    onChange={(e) => setFormPrize(e.target.value)}
                    placeholder="e.g. 500 Coins + Event Medal"
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500 font-medium"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-400 uppercase tracking-wider text-[9px]">Roster Limits</label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-1 bg-slate-950 px-2 py-1.5 rounded-xl border border-slate-800">
                      <span className="text-slate-500 font-semibold text-[10px]">Min:</span>
                      <input
                        type="number"
                        value={formMinPlayers}
                        onChange={(e) => setFormMinPlayers(Math.max(2, parseInt(e.target.value) || 2))}
                        className="bg-transparent text-white font-bold w-full text-center focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-1 bg-slate-950 px-2 py-1.5 rounded-xl border border-slate-800">
                      <span className="text-slate-500 font-semibold text-[10px]">Max:</span>
                      <input
                        type="number"
                        value={formMaxPlayers}
                        onChange={(e) => setFormMaxPlayers(Math.max(2, parseInt(e.target.value) || 2))}
                        className="bg-transparent text-white font-bold w-full text-center focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="spectatorCheck"
                  checked={formSpectator}
                  onChange={(e) => setFormSpectator(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-800 text-amber-500 focus:ring-amber-500"
                />
                <label htmlFor="spectatorCheck" className="text-slate-400 font-semibold cursor-pointer select-none">
                  Enable active match live spectator mode for other participants
                </label>
              </div>

              <button
                type="button"
                onClick={handleCreateTournament}
                className="w-full mt-6 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-3 rounded-xl transition text-center tracking-wide uppercase cursor-pointer"
              >
                Host & Deploy Tournament ⚔️
              </button>
            </div>
          </motion.div>
        )}

        {/* VIEW 3: ACTIVE TOURNAMENT HUB DASHBOARD */}
        {viewState === "active" && activeTour && (
          <motion.div
            key="active"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="grid grid-cols-1 lg:grid-cols-4 gap-5 h-full"
          >
            {/* COLUMN 1: STANDINGS & TOURNAMENT GENERAL STATS */}
            <div className="lg:col-span-1 space-y-4 flex flex-col justify-between">
              
              {/* HEADER INFORMATION CARD */}
              <div className="bg-[#0b0e17] border border-slate-800/80 rounded-2xl p-4 space-y-3 shadow-lg shrink-0">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black uppercase text-amber-500 bg-amber-500/5 px-2 py-0.5 rounded border border-amber-500/15">
                    {activeTour.type}
                  </span>
                  
                  {activeTour.visibility === "private" && (
                    <span className="text-[9px] font-mono font-bold text-amber-400 bg-slate-950 border border-slate-800 px-1.5 py-0.5 rounded" title="Invite Code">
                      🔑 {activeTour.inviteCode}
                    </span>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-tight">{activeTour.name}</h3>
                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-3 leading-relaxed">{activeTour.description}</p>
                </div>

                {/* ---- Organizer payout controls (manage_tournaments only) ---- */}
                {canManageTournaments && (
                  <div className="border border-amber-500/30 bg-amber-500/5 rounded-xl p-2.5 flex flex-col gap-2">
                    <span className="text-[9px] font-extrabold text-amber-500 uppercase tracking-widest">Organizer — prize settlement</span>
                    <div className="text-[10px] text-slate-300">
                      Pool: <strong className="text-amber-400">{(activeTour as any).prizePool ?? 0}</strong> coins
                      {(activeTour as any).prizePaid ? <span className="text-emerald-400 font-bold"> · settled</span> : null}
                    </div>
                    {!(activeTour as any).prizePaid && (
                      <div className="flex flex-col gap-1.5">
                        <select
                          value={organizerWinner}
                          onChange={(e) => setOrganizerWinner(e.target.value)}
                          className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-slate-100 outline-none"
                        >
                          <option value="">Select winner…</option>
                          {[...activeTour.players].sort((a: any, b: any) => (b.points || 0) - (a.points || 0)).map((p: any) => (
                            <option key={p.username} value={p.username}>{p.username} — {p.points || 0} pts</option>
                          ))}
                        </select>
                        <div className="flex gap-1.5">
                          <button
                            disabled={!organizerWinner || organizerBusy}
                            onClick={async () => {
                              if (!confirm(`Pay this tournament's prize pool (minus rake) to ${organizerWinner}? This can only ever happen once.`)) return;
                              setOrganizerBusy(true);
                              try {
                                const r = await apiPost("/api/admin/pay-tournament-prize", { tournamentId: activeTour.id, winnerUsername: organizerWinner });
                                showToast(`Prize paid: ${r.payout} coins to ${organizerWinner} (rake ${r.rake}).`);
                              } catch (e: any) {
                                showToast(e?.message || "Payout failed");
                              } finally { setOrganizerBusy(false); }
                            }}
                            className="flex-1 text-[10px] font-extrabold px-2 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                          >Pay prize</button>
                          <button
                            disabled={organizerBusy}
                            onClick={async () => {
                              if (!confirm("Cancel this tournament and refund EVERY entry fee? This closes the pool permanently.")) return;
                              setOrganizerBusy(true);
                              try {
                                const r = await apiPost("/api/admin/refund-tournament", { tournamentId: activeTour.id });
                                showToast(`Refunded ${r.refundedTotal} coins to ${r.refundedCount} player${r.refundedCount === 1 ? "" : "s"}.`);
                              } catch (e: any) {
                                showToast(e?.message || "Refund failed");
                              } finally { setOrganizerBusy(false); }
                            }}
                            className="flex-1 text-[10px] font-extrabold px-2 py-1.5 rounded-lg bg-rose-600/80 hover:bg-rose-500 text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                          >Refund all</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 border-t border-slate-900/85 pt-3 text-[10px] text-slate-300">
                  <div className="bg-slate-950/40 p-1.5 rounded-lg border border-slate-850/60 text-center">
                    <span className="block text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Round</span>
                    <span className="font-extrabold text-amber-400 font-sans">
                      {activeTour.status === "registration" ? "Not Started" : `Round ${activeTour.currentRound}/${activeTour.maxRounds}`}
                    </span>
                  </div>
                  <div className="bg-slate-950/40 p-1.5 rounded-lg border border-slate-850/60 text-center">
                    <span className="block text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Timer</span>
                    <span className="font-extrabold text-slate-200 font-mono">
                      {activeTour.status === "registration" ? "Ready" : formatTime(timeRemaining)}
                    </span>
                  </div>
                </div>

                {activeTour.status === "registration" && activeTour.players.some(p => p.username === username) && (
                  <button
                    disabled={!canManageTournaments}
                    onClick={handleStartTournament}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-2 rounded-xl text-xs transition uppercase flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/10 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-slate-950" />
                    <span>Launch Brackets Now</span>
                  </button>
                )}
              </div>

              {/* LIVE LEADERBOARD / STANDINGS */}
              <div className="bg-[#0b0e17] border border-slate-800/80 rounded-2xl p-4 flex flex-col flex-1 shadow-lg max-h-[350px] lg:max-h-[500px]">
                <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5 shrink-0">
                  <Award className="w-4 h-4 text-amber-500" />
                  <span>Leaderboard Standings</span>
                </h4>

                <div className="flex-1 overflow-y-auto space-y-2 border border-slate-950 bg-slate-950/60 rounded-xl p-2 divide-y divide-slate-950">
                  {activeTour.players
                    .slice().sort((a, b) => b.points - a.points || b.rating - a.rating)
                    .map((p, index) => {
                      const isSelf = p.username === username;
                      return (
                        <div
                          key={p.username}
                          className={`flex items-center justify-between p-2 rounded-lg text-xs font-medium transition ${
                            isSelf ? "bg-amber-500/5 border border-amber-500/20" : ""
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span className={`w-5 h-5 rounded flex items-center justify-center font-black text-[10px] border ${getMedalColor(index)}`}>
                              {index + 1}
                            </span>
                            <div className="truncate">
                              <AdminTappableName username={p.username} className={`font-sans font-extrabold ${isSelf ? "text-amber-400" : "text-slate-200"}`} />
                              <span className="block text-[8px] text-slate-500 font-mono">
                                ELO {p.rating} {p.team ? `• ${p.team}` : ""}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 font-mono shrink-0">
                            {p.streak > 1 && (
                              <span className="text-[10px] text-amber-500 font-bold flex items-center" title="Win Streak">
                                <Flame className="w-3 h-3 fill-amber-500 text-amber-500" />
                                {p.streak}
                              </span>
                            )}
                            <span className="font-extrabold text-white text-right text-xs bg-slate-900 px-2 py-0.5 rounded">
                              {p.points} <span className="text-[8px] text-slate-500 font-semibold uppercase">pts</span>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            {/* COLUMN 2 & 3: MATCH PAIRINGS, SCHEDULER & SPECTATOR ZONE */}
            <div className="lg:col-span-2 space-y-4 flex flex-col justify-between">
              
              {/* CURRENT ROUND PAIRING BOARD */}
              <div className="bg-[#0b0e17] border border-slate-800/80 rounded-2xl p-4 flex flex-col flex-1 shadow-lg max-h-[380px] lg:max-h-[420px]">
                <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5 shrink-0">
                  <Cpu className="w-4 h-4 text-amber-500 animate-pulse" />
                  <span>Round {activeTour.currentRound} Match Grid</span>
                </h4>

                {activeTour.status === "registration" ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-3">
                    <div className="p-3 bg-amber-500/5 border border-amber-500/15 rounded-full text-amber-400 animate-pulse">
                      <Users className="w-8 h-8 text-amber-500" />
                    </div>
                    <div>
                      <h5 className="font-bold text-white text-sm uppercase">Accepting Registrations</h5>
                      <p className="text-slate-400 text-xs mt-1 max-w-sm leading-normal">
                        Roster currently has {activeTour.players.length} registered masters. Press "Launch Brackets Now" to begin pairings and lock roster.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto space-y-2.5 border border-slate-950 bg-slate-950/60 rounded-xl p-3">
                    {activeTour.matches
                      .filter(m => m.round === activeTour.currentRound)
                      .map(m => {
                        const isWhiteUser = m.white === username;
                        const isBlackUser = m.black === username;
                        const userPlays = isWhiteUser || isBlackUser;
                        
                        return (
                          <div
                            key={m.id}
                            className={`p-3 rounded-xl border flex items-center justify-between transition ${
                              userPlays 
                                ? "bg-amber-500/5 border-amber-500/30 shadow shadow-amber-500/5" 
                                : "bg-slate-900/60 border-slate-850"
                            }`}
                          >
                            <div className="flex flex-col gap-1 text-xs font-semibold flex-1 pr-4">
                              <div className="flex items-center justify-between">
                                <span className={`flex items-center gap-1.5 ${m.winner === "W" ? "text-emerald-400 font-extrabold" : "text-slate-300"}`}>
                                  <span className="w-2 h-2 rounded-full bg-white border border-slate-700" />
                                  <AdminTappableName username={m.white} className="truncate max-w-[120px]" />
                                </span>
                                {m.winner === "W" && <span className="text-[10px] text-emerald-400 font-black">WIN</span>}
                              </div>

                              <div className="flex items-center justify-between">
                                <span className={`flex items-center gap-1.5 ${m.winner === "B" ? "text-emerald-400 font-extrabold" : "text-slate-300"}`}>
                                  <span className="w-2 h-2 rounded-full bg-neutral-900 border border-neutral-850" />
                                  <AdminTappableName username={m.black} className="truncate max-w-[120px]" />
                                </span>
                                {m.winner === "B" && <span className="text-[10px] text-emerald-400 font-black">WIN</span>}
                              </div>
                            </div>

                            <div className="shrink-0 flex items-center gap-2">
                              {userPlays && m.status === "pending" && (
                                <button
                                  onClick={() => handleLaunchMatch(m)}
                                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-3.5 py-1.5 rounded-xl text-[10px] uppercase tracking-wide flex items-center gap-1 cursor-pointer transition shadow"
                                >
                                  <Play className="w-3 h-3 fill-slate-950" />
                                  <span>Play ⚔️</span>
                                </button>
                              )}

                              {userPlays && m.status === "playing" && (
                                <span className="text-[9px] font-black uppercase text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded animate-pulse">
                                  Playing Live
                                </span>
                              )}

                              {m.status === "completed" && (
                                <span className="text-[9px] font-extrabold uppercase text-slate-500 bg-slate-950 px-2 py-1 rounded">
                                  {m.winner === "D" ? "Draw" : "Finished"}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* SPECTATOR ARENA PREVIEW BOARD */}
              <div className="bg-[#0b0e17] border border-slate-800/80 rounded-2xl p-4 flex flex-col flex-1 shadow-lg max-h-[350px]">
                <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5 shrink-0">
                  <Eye className="w-4 h-4 text-amber-500" />
                  <span>Live Spectator Arena</span>
                </h4>

                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-2">
                  <Eye className="w-6 h-6 text-slate-500" />
                  <h5 className="font-bold text-slate-300 text-xs">Live tournament games</h5>
                  <p className="text-slate-400 text-xs max-w-xs leading-relaxed">
                    {activeTour.visibility === 'private' || !activeTour.spectatorPermission ? 'Spectating is disabled for this event.' : 'Open an authoritative live board below.'}
                    {activeTour.visibility !== 'private' && activeTour.spectatorPermission && activeTour.matches.filter(match => match.roomId && match.status !== 'completed').map(match => <button key={match.id} className="block p-2 text-amber-300" onClick={() => onSpectateMatch?.(match.roomId!)}>Watch {match.white} vs {match.black}</button>)}
                  </p>
                </div>
              </div>
            </div>

            {/* COLUMN 4: TOURNAMENT CHAT ROOM & ANNOUNCEMENTS */}
            <div className="lg:col-span-1 bg-[#0b0e17] border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between shadow-lg h-[400px] lg:h-full max-h-[600px] lg:max-h-[85vh]">
              <div className="flex items-center justify-between border-b border-slate-900/80 pb-3 mb-3 shrink-0">
                <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4 text-amber-500" />
                  <span>Public Lobby Chat</span>
                </h4>
                <span className="text-[10px] font-bold text-amber-500 bg-amber-500/5 border border-amber-500/20 px-2 py-0.5 rounded-full animate-pulse">
                  {activeTour.players.length} registered
                </span>
              </div>

              {/* Chat log messages list */}
              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 bg-slate-950/40 rounded-xl p-2.5 border border-slate-950 max-h-[300px] lg:max-h-full">
                {activeTour.chat.map((msg) => {
                  const isAnnouncement = msg.isAnnouncement;
                  const isSelf = msg.sender === username;
                  
                  return (
                    <div 
                      key={msg.id}
                      className={`p-2 rounded-xl text-[11px] leading-relaxed border transition ${
                        isAnnouncement 
                          ? "bg-amber-500/10 border-amber-500/20 text-amber-300" 
                          : isSelf 
                          ? "bg-slate-900 border-slate-850 ml-6 text-slate-200" 
                          : "bg-slate-950 border-slate-900 mr-6 text-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between font-extrabold text-[10px] mb-0.5">
                        <span className="flex items-center gap-1 font-sans">
                          {isAnnouncement && <ShieldAlert className="w-3 h-3 text-amber-500" />}
                          <span>{msg.sender}</span>
                        </span>
                        <span className="text-[8px] text-slate-500 font-mono">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      
                      {msg.replyTo && (
                        <div className="text-[9px] text-slate-500 italic bg-slate-950/40 border-l border-slate-800 pl-1.5 py-0.5 mb-1 truncate">
                          Replying to master comment...
                        </div>
                      )}

                      <p className="font-sans break-words">{msg.message}</p>

                      <div className="flex items-center justify-end gap-1.5 mt-1 font-mono text-[9px] text-slate-500">
                        <button 
                          onClick={() => {
                            setReplyToId(msg.id);
                            setChatInput(`@${msg.sender} `);
                            playClickSound(muted);
                          }}
                          className="hover:text-white"
                        >
                          Reply
                        </button>
                        {Object.entries(msg.reactions || {}).map(([emoji, count]) => {
                          const countNum = Number(count);
                          return countNum > 0 ? (
                            <span key={emoji} className="bg-slate-900 px-1 rounded flex items-center gap-0.5">
                              <span>{emoji}</span>
                              <span className="font-sans font-bold text-[8px] text-slate-400">{countNum}</span>
                            </span>
                          ) : null;
                        })}
                      </div>
                    </div>
                  );
                })}
                <div ref={chatBottomRef} />
              </div>

              {/* Chat action input bar */}
              <div className="pt-3 border-t border-slate-900/80 mt-3 shrink-0 space-y-2">
                {replyToId && (
                  <div className="flex items-center justify-between bg-slate-950 border border-slate-900 p-1 px-2.5 rounded-lg text-[9px] text-slate-400">
                    <span className="truncate">Replying to message...</span>
                    <button onClick={() => setReplyToId(undefined)} className="text-amber-500 hover:text-amber-400">Cancel</button>
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSendChatMessage()}
                    placeholder="Type master message..."
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 font-medium"
                  />
                  <button
                    onClick={handleSendChatMessage}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black p-2.5 rounded-xl text-xs transition cursor-pointer flex items-center justify-center"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-3 text-[10px]">
                  <label className="flex items-center gap-1 text-slate-500 select-none cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isOrganizerAnnouncement}
                      onChange={(e) => setIsOrganizerAnnouncement(e.target.checked)}
                      className="rounded bg-slate-950 border-slate-800 text-amber-500"
                    />
                    <span>Announcement</span>
                  </label>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* VIEW 4: FINAL RESULTS / CHAMPION CELEBRATION SCREEN */}
        {viewState === "results" && activeTour && (
          <motion.div
            key="results"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-[#0b0e17] border border-slate-800/80 rounded-2xl p-6 md:p-8 shadow-2xl max-w-2xl mx-auto text-center space-y-6"
          >
            <div className="inline-flex p-3 bg-amber-500/10 rounded-full text-amber-400 animate-bounce">
              <Trophy className="w-10 h-10 text-amber-500" />
            </div>

            <div>
              <span className="text-[9px] font-black uppercase text-amber-500 bg-amber-500/5 px-2.5 py-1 rounded border border-amber-500/20 tracking-wider">
                CHAMPIONSHIP COMPLETED 👑
              </span>
              <h3 className="text-xl sm:text-2xl font-black text-white uppercase tracking-tight mt-2">{activeTour.name}</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto mt-1 leading-relaxed">
                Brackets locked, matches audited and verified. All rating stats and awards are successfully compiled.
              </p>
            </div>

            {/* PODIUM MEDALISTS ROW */}
            <div className="grid grid-cols-3 gap-3 max-w-md mx-auto py-3">
              {[
                { label: "Runner-up", index: 1, medal: "🥈" },
                { label: "Champion", index: 0, medal: "🥇" },
                { label: "Third Place", index: 2, medal: "🥉" }
              ].map((pos) => {
                const p = activeTour.players.slice().sort((a, b) => b.points - a.points || b.rating - a.rating)[pos.index];
                if (!p) return null;
                return (
                  <div 
                    key={pos.index} 
                    className={`border rounded-2xl p-3 flex flex-col items-center justify-between ${
                      pos.index === 0 
                        ? "bg-amber-500/10 border-amber-500/20 py-5 -translate-y-2 scale-105" 
                        : "bg-slate-900/40 border-slate-850"
                    }`}
                  >
                    <span className="text-2xl mb-1">{pos.medal}</span>
                    <div className="truncate max-w-[100px] w-full text-center">
                      <AdminTappableName username={p.username} className="block font-sans font-extrabold text-white text-xs truncate" />
                      <span className="text-[9px] text-slate-500 font-mono">ELO {p.rating}</span>
                    </div>
                    <span className="text-[10px] font-black text-amber-400 font-mono mt-2 bg-slate-950 px-2 py-0.5 rounded">
                      {p.points} pts
                    </span>
                  </div>
                );
              })}
            </div>

            {/* COMPLETED MATCH ARCHIVE TO REPLAY */}
            <div className="border-t border-slate-900/85 pt-4 space-y-3">
              <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Completed Game Archives</h4>
              
              <div className="max-h-[150px] overflow-y-auto space-y-2 border border-slate-950 bg-slate-950 rounded-xl p-2.5">
                {activeTour.matches
                  .filter(m => m.status === "completed")
                  .map((m, mIdx) => (
                    <div 
                      key={m.id || mIdx}
                      className="p-2 bg-slate-900/60 rounded-lg text-[11px] flex items-center justify-between border border-slate-850/50"
                    >
                      <div className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span className="font-semibold text-slate-300">
                          <AdminTappableName username={m.white} /> vs <AdminTappableName username={m.black} />
                        </span>
                      </div>
                      <span className="text-[9px] text-slate-500 font-mono font-bold">
                        Winner: {m.winner === "W" ? "White" : m.winner === "B" ? "Black" : "Draw"}
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            {/* AWARDS SUMMARY ROW */}
            <div className="bg-amber-500/5 border border-amber-500/10 rounded-2xl p-4 text-xs flex flex-col sm:flex-row justify-between items-center gap-3">
              <div className="text-left">
                <span className="text-amber-400 font-extrabold text-xs block">DISTRIBUTED TOURNAMENT PRIZE:</span>
                <span className="text-slate-300 text-[11px] font-medium leading-relaxed">
                  🥇 {activeTour.prize} awarded. Rating modifications processed.
                </span>
              </div>
              <button
                onClick={() => {
                  setViewState("lobby");
                  playClickSound(muted);
                }}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-4 py-2 rounded-xl text-xs uppercase tracking-wide cursor-pointer transition shadow-lg shadow-amber-500/10 shrink-0"
              >
                Conclude Event 🏆
              </button>
            </div>

          </motion.div>
        )}

      </AnimatePresence>

    </div>
  );
}

// Biggest component in the app after App.tsx itself (~85KB of source). Uses the
// function-ignoring comparator because onStartMatch/onResetMatchOutcome/etc. below
// are inline arrows that App.tsx recreates every render.
export const TournamentDashboard = React.memo(TournamentDashboardImpl, shallowEqualIgnoringFunctions);
