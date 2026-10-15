import React, { useState, useEffect, useRef, useReducer, useMemo, useCallback, lazy, Suspense } from "react";
import { supabase, handleSupabaseError, OperationType, authReady, onAuthStateChange, signOutUser, resendVerificationEmail, isSupabaseConfigured } from "./supabase";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import { AuthScreen } from "./AuthScreen";
import { apiGet, apiPost } from "./apiClient";
import InstallAppPrompt from "./InstallAppPrompt";

const AdminPanel = lazy(() => import("./AdminPanel"));
import { 
  Trophy, RotateCcw, Volume2, VolumeX, BookOpen, 
  Settings as SettingsIcon, HelpCircle, X, ChevronRight, Check, Wrench, 
  Trash2, Plus, ArrowLeft, ArrowRight, Play, Sparkles, RefreshCw, Layout, Crown, User, Cpu, ChevronLeft, Swords,
  Menu, TrendingUp, Copy, Mic, MicOff, Eye, Square, Pause, Smile, Volume1, Lock, Compass, ClipboardList, Handshake, Flag,
  PuzzleIcon, GraduationCap,
  ShieldAlert, Phone, PhoneOff, Maximize2, Video, VideoOff, SwitchCamera, Clock
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { 
  Board, Move, Piece, createInitialBoard, generateLegalMoves, 
  applyMove, boardToScanFen, scanFenToBoard, checkGameEnd, 
  ngSqToRc, ngRcToSq, hubMoveStringToNigerian, movesAreEquivalent,
  moveToNotationString, parsePdnMoveList, captureClickTargets, resolveCaptureClick,
  getCol
} from "./gameLogic";

import { PlayMode, BoardTheme, BOARD_THEMES, EngineEval, PlayerStats, MoveEvalResult, Puzzle } from "./types";
import { gameSocket, GameSocketEvent } from "./lib/gameSocket";
import {
  ClockSnapshot, createLocalClock, advanceLocalClock, freezeClock, flagLocalClock, useClockDeadline,
} from "./lib/useServerClock";
import { roomReducer, initialRoomState, isSameUser, findMe } from "./lib/roomState";
import type { Color, RoomPhase, ServerErrorCode } from "./shared/protocol";
import { EvaluationBar } from "./components/EvaluationBar";
import { BestMoveArrow } from "./components/BestMoveArrow";
import { OpeningExplorer } from "./components/OpeningExplorer";
import { ChessClock } from "./components/ChessClock";
import { EnginePanel } from "./components/EnginePanel";
import { MenuSidebar } from "./components/MenuSidebar";
import { HomeLobby } from "./components/HomeLobby";
const ProfilePage = lazy(() => import("./components/ProfilePage").then(m => ({ default: m.ProfilePage })));
const FriendsPage = lazy(() => import("./components/FriendsPage").then(m => ({ default: m.FriendsPage })));
import { ComingSoonPane } from "./components/ComingSoonPane";
import { LobbyDashboard } from "./components/LobbyDashboard";
const TournamentDashboard = lazy(() => import("./components/TournamentDashboard").then(m => ({ default: m.TournamentDashboard })));
const GlobalChatLounge = lazy(() => import("./components/GlobalChatLounge").then(m => ({ default: m.GlobalChatLounge })));
import {
  playClickSound, playCaptureSound, playPromoSound, playGameStartSound,
  playVictorySound, playDefeatSound, playDrawSound, playWarningAlertSound,
  startVoiceRingtone, startVoiceRingback,
} from "./lib/audio";
import { PositionEval, evaluatePosition, classifyMove, analyzeMoveHistory } from "./lib/analysis";
import {
  QUALITY_BADGE_CLASSES, QUALITY_BADGE_ABBREV, OPAY_PAYMENT_DETAILS,
  KenDifficulty, KENTRO_COINS_ENABLED, MIN_MATCH_WAGER, MAX_MATCH_WAGER,
  MATCH_WAGER_STEP, KEN_LEVELS,
} from "./lib/constants";

import { TopNav } from "./components/layout/TopNav";
import { MobileDrawers } from "./components/layout/MobileDrawers";
import { MobileTabBar } from "./components/layout/MobileTabBar";
import { GameScreen } from "./components/game/GameScreen";
const OfflineNearby = lazy(() => import("./components/game/OfflineNearby").then(m => ({ default: m.OfflineNearby })));
const KentroTV = lazy(() => import("./components/KentroTV").then(m => ({ default: m.KentroTV })));
import { NotificationCenter, useKentroNotifications } from "./components/NotificationCenter";
import { parseReplayLink } from "./lib/kentroTv";
import { uniqueCompletedMatches } from "./lib/completedMatches";
import { FloatingVideoCall } from "./components/game/FloatingVideoCall";
import { useWebRTCCall } from "./lib/useWebRTCCall";
import { MultiplayerPanel, VoiceCallState } from "./components/panels/MultiplayerPanel";
import { GameSidebar } from "./components/panels/GameSidebar";
import { AnalysisSidebar } from "./components/panels/AnalysisSidebar";
import { RulesModal } from "./components/modals/RulesModal";
import { AppGuideModal } from "./components/modals/AppGuideModal";
import { SettingsModal } from "./components/modals/SettingsModal";
import { AnalysisSetupModal } from "./components/modals/AnalysisSetupModal";
import { PdnImportModal } from "./components/modals/PdnImportModal";
import { CoinsPurchaseModal } from "./components/modals/CoinsPurchaseModal";
import { ComputerConfigModal } from "./components/modals/ComputerConfigModal";
import { GameOverModal } from "./components/modals/GameOverModal";
import { SandboxPlayChoiceModal } from "./components/modals/SandboxPlayChoiceModal";
const PlayerDirectoryModal = lazy(() => import("./components/modals/PlayerDirectoryModal").then(m => ({ default: m.PlayerDirectoryModal })));
const PastGamesModal = lazy(() => import("./components/modals/PastGamesModal").then(m => ({ default: m.PastGamesModal })));
const AnalysisLabModal = lazy(() => import("./components/modals/AnalysisLabModal").then(m => ({ default: m.AnalysisLabModal })));
const PuzzlesPane = lazy(() => import("./components/panels/PuzzlesPane").then(m => ({ default: m.PuzzlesPane })));
import { ModalShell } from "./components/ui/ModalShell";
import { markPuzzleSolved } from "./lib/puzzles";
import { getKenMove, analyzeKen, EngineUnavailableError, SupersededError } from "./lib/kenEngine";
import { primeAvatar } from "./lib/avatarCache";
import { AdminProfileProvider } from "./lib/adminProfileContext";
import { KentroSplashScreen } from "./components/splash/KentroSplashScreen";
import { saveFastResumeState, loadFastResumeState, clearFastResumeState, saveActiveRoom, loadActiveRoom, clearActiveRoom } from "./lib/fastResume";
import { cleanInviteRoomCode, getRoomCodeFromUrl, removeRoomInviteFromUrl } from "./lib/roomInvite";
import { GUEST_AI_LIMIT, GUEST_ONLINE_LIMIT, GUEST_AI_SAVE, isGuestActive, setGuestActive, getGuestName, getGuestAiUsed, claimGuestAiGame, isGuestName, guestDisplayName } from "./lib/guestTrial";
import { safeStorage, safeSessionStorage } from "./lib/safeStorage";

// Compatibility re-exports -- other modules historically imported these from
// App; canonical home is now src/lib/constants.ts.
export { KEN_LEVELS } from "./lib/constants";
export type { KenDifficulty } from "./lib/constants";

export default function App() {
  const [initialReplay, setInitialReplay] = useState(() => typeof window === "undefined" ? null : parseReplayLink(window.location.search));
  // Direct links from WhatsApp are invitations, never automatic match entry.
  // The guest explicitly presses Start Game before we contact the room server.
  const [inviteRoomCode, setInviteRoomCode] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getRoomCodeFromUrl(window.location.search)
  );

  // --- Kentro Splash Screen ---
  const [showSplash, setShowSplash] = useState<boolean>(() => {
    try {
      if (typeof window !== "undefined") {
        // No splash barrier when someone opens an invitation on their phone.
        if (getRoomCodeFromUrl(window.location.search) || parseReplayLink(window.location.search) || new URLSearchParams(window.location.search).get("offline") === "1") return false;
        // Never show splash if resuming an active room/match
        if (safeStorage.getItem("kd.active_room")) return false;
        // Never show splash on returning session/visit
        if (safeStorage.getItem("kentro_splash_seen") || safeSessionStorage.getItem("kentro_splash_seen")) {
          return false;
        }
      }
    } catch {
      // Storage access blocked or restricted in iframe
    }
    return true;
  });
  const handleSplashComplete = () => {
    try {
      if (typeof window !== "undefined") {
        safeStorage.setItem("kentro_splash_seen", "true");
        safeSessionStorage.setItem("kentro_splash_seen", "true");
      }
    } catch {
      // ignore
    }
    setShowSplash(false);
  };

  // --- Game Engine & Board State ---
  const [board, setBoard] = useState<Board>(() => {
    try {
      const active = loadActiveRoom();
      if (active && active.roomId) {
        const cached = loadFastResumeState(active.roomId);
        if (cached && cached.board) {
          return cached.board;
        }
      }
    } catch {}
    return createInitialBoard();
  });
  const [turn, setTurn] = useState<"W" | "B">(() => {
    try {
      const active = loadActiveRoom();
      if (active && active.roomId) {
        const cached = loadFastResumeState(active.roomId);
        if (cached && (cached.turn === "W" || cached.turn === "B")) return cached.turn;
      }
    } catch {}
    return "W";
  });
  // Local custom matches must replay and undo from their own initial
  // position, including when Black was selected as the first mover.
  const initialPositionRef = useRef<{ board: Board; turn: "W" | "B" }>({ board: createInitialBoard(), turn: "W" });
  const [moveHistory, setMoveHistory] = useState<Move[]>(() => {
    try {
      const active = loadActiveRoom();
      if (active && active.roomId) {
        const cached = loadFastResumeState(active.roomId);
        if (cached && Array.isArray(cached.moveHistory)) return cached.moveHistory;
      }
    } catch {}
    return [];
  });
  const [selectedSq, setSelectedSq] = useState<number | null>(null);
  // Landing squares clicked so far while walking a multi-jump capture one
  // hop at a time (physical-board style). Resets whenever the selection,
  // turn or position changes.
  const [captureWalk, setCaptureWalk] = useState<number[]>([]);
  const [capturedAnimations, setCapturedAnimations] = useState<{ sq: number; piece: string; id: string }[]>([]);
  
  // --- Game Config & Mode Settings ---
  const [playMode, setPlayMode] = useState<PlayMode>(() => {
    try {
      if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("offline") === "1") return "OfflineNearby";
      if (typeof window !== "undefined" && getRoomCodeFromUrl(window.location.search)) return "Multiplayer";
      if (typeof window !== "undefined" && parseReplayLink(window.location.search)) return "KentroTV";
      if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "tournament") return "Tournament";
      const active = loadActiveRoom();
      if (active && active.roomId) return "Multiplayer";
    } catch {}
    return "Home";
  });
  const playModeRef = useRef<PlayMode>("Home");
  useEffect(() => { playModeRef.current = playMode; }, [playMode]);
  const isComputerMode = playMode === "Human_vs_AI" || playMode === "AI_vs_Human" || playMode === "AI_vs_AI";
  const [kenLevelId, setKenLevelId] = useState<number>(2); // Default to Ken 2
  const [boardTheme, setBoardTheme] = useState<BoardTheme>(() => {
    return (safeStorage.getItem("lidraughts_board_theme") as BoardTheme) || "wood";
  });
  
  // --- Custom Board Theme States ---
  const [customLightSquare, setCustomLightSquare] = useState<string>(() => {
    return safeStorage.getItem("lidraughts_custom_light") || "#f8fafc";
  });
  const [customDarkSquare, setCustomDarkSquare] = useState<string>(() => {
    return safeStorage.getItem("lidraughts_custom_dark") || "#1e293b";
  });
  const [customBorder, setCustomBorder] = useState<string>(() => {
    return safeStorage.getItem("lidraughts_custom_border") || "#0f172a";
  });

  // Keep custom theme colors updated in localStorage
  useEffect(() => {
    safeStorage.setItem("lidraughts_custom_light", customLightSquare);
  }, [customLightSquare]);

  useEffect(() => {
    safeStorage.setItem("lidraughts_custom_dark", customDarkSquare);
  }, [customDarkSquare]);

  useEffect(() => {
    safeStorage.setItem("lidraughts_custom_border", customBorder);
  }, [customBorder]);

  useEffect(() => {
    safeStorage.setItem("lidraughts_board_theme", boardTheme);
  }, [boardTheme]);

  // --- Tournament Mode States ---
  const [isTournamentActive, setIsTournamentActive] = useState<boolean>(() => {
    return safeStorage.getItem("lidraughts_tournament_active") === "true";
  });
  const [tournamentRound, setTournamentRound] = useState<number>(() => {
    return parseInt(safeStorage.getItem("lidraughts_tournament_round") || "1", 10);
  });
  const [tournamentPoints, setTournamentPoints] = useState<number>(() => {
    return parseInt(safeStorage.getItem("lidraughts_tournament_points") || "0", 10);
  });
  const [tournamentHistory, setTournamentHistory] = useState<Array<{ round: number; opponent: string; outcome: "win" | "loss" | "draw"; points: number }>>(() => {
    const saved = safeStorage.getItem("lidraughts_tournament_history");
    return saved ? JSON.parse(saved) : [];
  });
  const [isTournamentGameInProgress, setIsTournamentGameInProgress] = useState<boolean>(() => {
    return safeStorage.getItem("lidraughts_tournament_game_in_progress") === "true";
  });
  const [activeTournamentMatchId, setActiveTournamentMatchId] = useState<string | null>(null);
  const [activeTournamentOpponent, setActiveTournamentOpponent] = useState<string | null>(null);
  const [activeTournamentOutcome, setActiveTournamentOutcome] = useState<"win" | "loss" | "draw" | null>(null);

  // Local-gauntlet integrity: if the app was closed/reloaded WHILE a
  // tournament round was in progress, that round is recorded as a forfeit
  // loss on next launch -- exactly like a real tournament. Without this,
  // reloading mid-game was a free escape hatch from any losing position
  // (and even from a Fair Play forfeit in progress).
  const tournamentAbandonCheckedRef = useRef(false);
  useEffect(() => {
    if (tournamentAbandonCheckedRef.current) return;
    tournamentAbandonCheckedRef.current = true;
    if (safeStorage.getItem("lidraughts_tournament_game_in_progress") !== "true") return;
    if (!isTournamentActive) {
      safeStorage.setItem("lidraughts_tournament_game_in_progress", "false");
      return;
    }
    const abandonedRound = tournamentRound;
    setTournamentHistory((prev) => {
      const nh = [...prev, {
        round: abandonedRound,
        opponent: `Ken Level ${getTournamentKenLevelId(abandonedRound)}`,
        outcome: "loss" as const,
        points: 0,
      }];
      safeStorage.setItem("lidraughts_tournament_history", JSON.stringify(nh));
      return nh;
    });
    setIsTournamentGameInProgress(false);
    safeStorage.setItem("lidraughts_tournament_game_in_progress", "false");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- App Guide and Settings Modal States ---
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [showAppGuideModal, setShowAppGuideModal] = useState<boolean>(false);
  const [copiedRoomCode, setCopiedRoomCode] = useState<boolean>(false);

  const [showSquareNumbers, setShowSquareNumbers] = useState<boolean>(() => safeStorage.getItem("kentro_show_square_numbers") !== "false");
  const [focusMode, setFocusMode] = useState<boolean>(() => safeStorage.getItem("kentro_focus_mode") === "true");
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => safeStorage.getItem("kentro_reduce_motion") === "true");
  useEffect(() => { safeStorage.setItem("kentro_show_square_numbers", String(showSquareNumbers)); }, [showSquareNumbers]);
  useEffect(() => { safeStorage.setItem("kentro_focus_mode", String(focusMode)); }, [focusMode]);
  useEffect(() => { safeStorage.setItem("kentro_reduce_motion", String(reducedMotion)); }, [reducedMotion]);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [muted, setMuted] = useState<boolean>(() => {
    return safeStorage.getItem("lidraughts_muted") === "true";
  });

  useEffect(() => {
    safeStorage.setItem("lidraughts_muted", muted ? "true" : "false");
  }, [muted]);
  const [boardScale, setBoardScale] = useState<number>(() => {
    const saved = safeStorage.getItem("lidraughts_board_scale");
    return saved ? parseInt(saved, 10) : 112;
  });
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    safeStorage.setItem("lidraughts_board_scale", boardScale.toString());
  }, [boardScale]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Query parameters are read above during initialization. Do not auto-join:
  // entering an online match requires the invitee to tap Start Game first.

  // --- Responsive Drawer States (Mobile/Tablet overlays) ---
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState<boolean>(false);
  const [isRightDrawerOpen, setIsRightDrawerOpen] = useState<boolean>(false);

  // --- Chess clocks ---
  // clockLimitType is the user's pick for LOCAL games (and mirrors the
  // server-derived value while in a room). Clocks themselves are never
  // counted here: multiplayer clocks are a server `ClockState` snapshot kept
  // in the room reducer (contract section 4); local timed games keep their
  // own snapshot in `localClock`. Only the small clock components tick.
  const [clockLimitType, setClockLimitType] = useState<"Blitz" | "Rapid" | "Classical" | "Untimed">("Blitz");
  const [localClock, setLocalClock] = useState<ClockSnapshot | null>(null);
  const clockSecondsFor = (limit: "Blitz" | "Rapid" | "Classical" | "Untimed") =>
    limit === "Rapid" ? 600 : limit === "Classical" ? 1200 : limit === "Blitz" ? 300 : 0;
  const clockIncrementFor = (limit: "Blitz" | "Rapid" | "Classical" | "Untimed") =>
    limit === "Blitz" ? 3 : limit === "Rapid" ? 5 : limit === "Classical" ? 10 : 0;
  /** Start (or clear) the local clock for a non-multiplayer game. */
  const startLocalClock = (limit: "Blitz" | "Rapid" | "Classical" | "Untimed", running: Color | null = "W") => {
    const secs = clockSecondsFor(limit);
    setLocalClock(secs > 0 ? createLocalClock(secs * 1000, running, clockIncrementFor(limit) * 1000) : null);
  };

  // --- Interactive Move Log Navigation View ---
  const [historyViewIndex, setHistoryViewIndex] = useState<number | null>(null);

  // --- Tactics Puzzles State ---
  const [activePuzzleId, setActivePuzzleId] = useState<string | null>(null);
  // Steps may carry `caps` (exact capture path) and `role` ("solver" |
  // "reply"). New-format puzzles store the ENTIRE legal line -- the
  // defender's replies included -- so multi-move puzzles play out under the
  // real game rules. Legacy puzzles (no role field) keep the old
  // solver-steps-only behavior.
  const [puzzleSolution, setPuzzleSolution] = useState<{ from: number; to: number; text: string; caps?: number[]; role?: "solver" | "reply" }[]>([]);
  const [puzzleStepIndex, setPuzzleStepIndex] = useState<number>(0);
  const [puzzleCompleted, setPuzzleCompleted] = useState<boolean>(false);
  const [puzzleError, setPuzzleError] = useState<string | null>(null);

  // --- Live C++ Engine evaluation states ---
  const [engineEval, setEngineEval] = useState<EngineEval>({
    score: 0,
    depth: 0,
    pv: "",
    isThinking: false
  });

  // --- AI Game Review Analysis States ---
  const [moveEvaluations, setMoveEvaluations] = useState<Record<number, MoveEvalResult>>({});
  const [isReviewing, setIsReviewing] = useState<boolean>(false);
  const [reviewProgress, setReviewProgress] = useState<number>(0);

  // Past Games Archive Modal
  const [showPastGamesModal, setShowPastGamesModal] = useState<boolean>(false);
  const [pastGamesModalFilter, setPastGamesModalFilter] = useState<"All" | "AI" | "PvP" | "Tournament">("All");

  // Analysis Lab & AI Game Review Modal
  const [showAnalysisLabModal, setShowAnalysisLabModal] = useState<boolean>(false);
  const [analysisLabTab, setAnalysisLabTab] = useState<"review" | "coach" | "engine" | "tools">("review");

  // Resumed practice session from analysis
  const [resumedAnalysisSnapshot, setResumedAnalysisSnapshot] = useState<{
    board: Board;
    moveHistory: Move[];
    moveEvaluations: Record<number, MoveEvalResult>;
    historyViewIndex: number | null;
  } | null>(null);
  const [isUnsavedPracticeGame, setIsUnsavedPracticeGame] = useState<boolean>(false);

  // --- Continuous background analysis (runs WHILE the game is being played,
  // not just after it ends) ---
  // positionEvalCacheRef: each board position is evaluated by the engine at
  // most once, ever, for the lifetime of the current game -- position i's
  // "after this move" eval IS position i+1's "before next move" eval (same
  // board, same side to move), so caching by position index halves the
  // engine calls versus evaluating before/after separately per move.
  const positionEvalCacheRef = useRef<Map<number, PositionEval>>(new Map());
  const analyzedIndexesRef = useRef<Set<number>>(new Set());
  const liveAnalysisRunningRef = useRef<boolean>(false);
  const liveAnalysisPendingRef = useRef<boolean>(false);
  const lastMoveCountForAnalysisRef = useRef<number>(0);

  const runLiveAnalysis = async () => {
    if (liveAnalysisRunningRef.current) {
      liveAnalysisPendingRef.current = true;
      return;
    }
    liveAnalysisRunningRef.current = true;
    try {
      do {
        liveAnalysisPendingRef.current = false;
        if (playModeRef.current !== "Analysis" && playModeRef.current !== "Training") break;
        const historySnapshot = moveHistoryRef.current;
        if (historySnapshot.length === 0) break;

        let b = createInitialBoard();
        const boardsList: Board[] = [b];
        for (let i = 0; i < historySnapshot.length; i++) {
          b = applyMove(b, historySnapshot[i]).board;
          boardsList.push(b);
        }

        for (let i = 0; i < historySnapshot.length; i++) {
          if (analyzedIndexesRef.current.has(i)) continue;
          // A newer move may have arrived (or the game may have been reset)
          // while we were mid-loop -- re-check against the live ref rather
          // than the snapshot so we never analyze a move from a game that's
          // no longer the active one.
          if (moveHistoryRef.current.length < historySnapshot.length) break;

          const mover: "W" | "B" = i % 2 === 0 ? "W" : "B";
          const opponent: "W" | "B" = mover === "W" ? "B" : "W";

          let before = positionEvalCacheRef.current.get(i);
          if (!before) {
            before = await evaluatePosition(boardsList[i], mover, 0.25);
            positionEvalCacheRef.current.set(i, before);
          }
          let after = positionEvalCacheRef.current.get(i + 1);
          if (!after) {
            after = await evaluatePosition(boardsList[i + 1], opponent, 0.25);
            positionEvalCacheRef.current.set(i + 1, after);
          }

          const result = classifyMove(boardsList[i], mover, historySnapshot[i], before, after);
          const finalResult: MoveEvalResult = { ...result, index: i };
          analyzedIndexesRef.current.add(i);
          setMoveEvaluations((prev) => (prev[i] ? prev : { ...prev, [i]: finalResult }));

          // Only surface the "Last Move Evaluation" bubble for the most
          // recent move, not ones we're catching up on in the background.
          if (i === historySnapshot.length - 1) {
            setLastAnalysisEval({
              quality: finalResult.quality,
              comment: finalResult.comment,
              delta: before.score + after.score,
            });
          }
        }
      } while (liveAnalysisPendingRef.current);
    } catch (err) {
      console.error("Live background analysis error:", err);
    } finally {
      liveAnalysisRunningRef.current = false;
    }
  };

  const moveHistoryRef = useRef<Move[]>([]);
  useEffect(() => {
    moveHistoryRef.current = moveHistory;

    // A shorter history than last time means a new game started (or a
    // different saved game was loaded) -- cached position evals no longer
    // correspond to this game, so start fresh.
    if (moveHistory.length < lastMoveCountForAnalysisRef.current) {
      positionEvalCacheRef.current.clear();
      analyzedIndexesRef.current.clear();
    }
    lastMoveCountForAnalysisRef.current = moveHistory.length;

    // If a saved game was loaded with its own moveEvaluations already
    // present, mark those indexes as done so we don't needlessly re-query
    // the engine for moves already analyzed.
    Object.keys(moveEvaluations).forEach((k) => analyzedIndexesRef.current.add(Number(k)));

    // Spec: analysis "will be working while the player is playing, even if
    // no one is playing analysis will continue in the background" -- this
    // fires on every new move, for every play mode, not just after the game
    // ends, so by the time a game finishes most (often all) of it is
    // already analyzed and the post-game "Analyse" view opens instantly.
    // Continuous move-grading is an ANALYSIS BOARD feature only. Games
    // against the AI, online matches, tournaments and puzzles are plain
    // games: no engine grades, coach bubbles or badges while playing.
    // (Finished games still get their one-off background review saved to
    // the database at game end, so the Analysis board can review them.)
    if (moveHistory.length > 0 && (playModeRef.current === "Analysis" || playModeRef.current === "Training")) {
      runLiveAnalysis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveHistory.length]);

  // --- VS Computer & Analysis Interactive States ---
  const [showComputerConfigModal, setShowComputerConfigModal] = useState<boolean>(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState<boolean>(false);
  const [showAdminPanel, setShowAdminPanel] = useState<boolean>(false);
  const [gameOverInfo, setGameOverInfo] = useState<{
    outcome: "win" | "loss" | "draw";
    isAIGame: boolean;
    canLevelUp: boolean;
    durationSeconds?: number;
    movesCount?: number;
  } | null>(null);

  // --- Resume an in-progress AI game after leaving and coming back ---
  // The app always lands on the Lobby on load (unchanged) -- this is only
  // about what happens next if you tap "VS Computer": resume a game you
  // left mid-match, instead of always starting fresh. Saved on every move,
  // cleared the moment the game actually ends (see setGameOverInfo below)
  // or when a genuinely new match is started via the config modal.
  const AI_MODES: PlayMode[] = ["Human_vs_AI", "AI_vs_Human", "AI_vs_AI"];

  useEffect(() => {
    if (!AI_MODES.includes(playMode) || gameOverInfo || moveHistory.length === 0) return;
    try {
      safeStorage.setItem(AI_GAME_STORAGE_KEY, JSON.stringify({
        board, moveHistory, turn, kenLevelId, playMode, savedAt: Date.now(),
        initialBoard: initialPositionRef.current.board, initialTurn: initialPositionRef.current.turn,
      }));
    } catch {
      // localStorage can throw (quota, private browsing) -- losing the
      // ability to resume is a minor inconvenience, not worth crashing over.
    }
  }, [board, moveHistory, turn, kenLevelId, playMode, gameOverInfo]);

  // Hidden admin entry point (spec: "built in a place that is secret and
  // hard to access except from admin"). Type the sequence below anywhere in
  // the app -- no visible button, no link in any menu, nothing in the DOM
  // that reveals it exists. The panel itself still checks server-side
  // whether this browser's Supabase uid is actually a registered admin
  // (see AdminPanel.tsx -> /api/admin/whoami), so knowing the sequence alone
  // doesn't grant access -- it only opens a door that's locked unless the
  // uid behind it was actually granted access from the Admins tab.
  useEffect(() => {
    const secret = "kentroadmin";
    let buffer = "";
    let lastKeyTime = 0;
    const handler = (e: KeyboardEvent) => {
      const now = Date.now();
      if (now - lastKeyTime > 2000) buffer = "";
      lastKeyTime = now;
      if (e.key.length === 1) {
        buffer = (buffer + e.key.toLowerCase()).slice(-secret.length);
        if (buffer === secret) {
          setShowAdminPanel(true);
          buffer = "";
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const [showPdnImportModal, setShowPdnImportModal] = useState<boolean>(false);
  const [pdnImportText, setPdnImportText] = useState<string>("");
  const [pdnImportError, setPdnImportError] = useState<string | null>(null);
  const [savedGamesFilter, setSavedGamesFilter] = useState<"All" | "Mine">("All");
  const [analysisPlayVsAI, setAnalysisPlayVsAI] = useState<boolean>(false);
  const [analysisAILevel, setAnalysisAILevel] = useState<number>(3);
  const [analysisPlayerColor, setAnalysisPlayerColor] = useState<"W" | "B">("W");
  const [lastAnalysisEval, setLastAnalysisEval] = useState<{ quality: string; comment: string; delta: number } | null>(null);
  const [savedGamesList, setSavedGamesList] = useState<any[]>([]); // "All" / community feed -- recent games from any player
  const [myGamesList, setMyGamesList] = useState<any[]>([]); // "Mine" -- every game this account has played, fetched by identity, not a recency window shared with everyone else
  const [isLoadingSavedGames, setIsLoadingSavedGames] = useState<boolean>(false);

  // --- Player directory / profiles / head-to-head ---
  const [showPlayerDirectory, setShowPlayerDirectory] = useState<boolean>(false);
  const [playersDirectoryList, setPlayersDirectoryList] = useState<PlayerStats[]>([]);
  const [isLoadingDirectory, setIsLoadingDirectory] = useState<boolean>(false);
  const [viewingPlayer, setViewingPlayer] = useState<string | null>(null);
  const [viewingPlayerStats, setViewingPlayerStats] = useState<PlayerStats | null>(null);
  const [viewingPlayerGames, setViewingPlayerGames] = useState<any[]>([]);
  const [isLoadingPlayerProfile, setIsLoadingPlayerProfile] = useState<boolean>(false);
  const [headToHead, setHeadToHead] = useState<{ opponent: string; gamesPlayed: number; myWins: number; theirWins: number; draws: number } | null>(null);

  // --- Editor State ---
  const [editorSelectedPiece, setEditorSelectedPiece] = useState<Piece>("w");
  const [pendingSandboxBoard, setPendingSandboxBoard] = useState<Board | null>(null);
  const [showSandboxPlayChoice, setShowSandboxPlayChoice] = useState<boolean>(false);
  const [unreadLoungeCount, setUnreadLoungeCount] = useState<number>(0);
  const [editorTurn, setEditorTurn] = useState<"W" | "B">("W");

  // --- Modals and Alerts ---
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const aiRequestGenerationRef = useRef(0);
  const [statusMessage, setStatusMessage] = useState<string>("White to play");
  const [promotedToast, setPromotedToast] = useState<string | null>(null);
  const [showRules, setShowRules] = useState<boolean>(false);

  // --- WebSocket & Multiplayer State ---
  // username is no longer a free-typed nickname cached in localStorage --
  // it's read from the authenticated Supabase account's user_metadata (see
  // the auth bootstrap effect below). localStorage is still used as a
  // read-through cache purely to avoid a username-less flash of UI while
  // the auth check is in flight on repeat visits; it is never the
  // source of truth and is overwritten as soon as the real fetch resolves.
  const [username, setUsername] = useState<string | null>(() => {
    return safeStorage.getItem("lidraughts_username") || null;
  });

  // --- Supabase Auth State (the real, user-facing identity layer) ---
  const [authUser, setAuthUser] = useState<SupabaseAuthUser | null>(null);
  const [guestEnabled, setGuestEnabled] = useState<boolean>(() => isGuestActive());
  const guestMode = guestEnabled && !authUser;
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationManager = useKentroNotifications(authUser?.id || null, !!authUser && !guestMode);
  const AI_GAME_STORAGE_KEY = guestMode ? GUEST_AI_SAVE : "kentro_ai_game_in_progress";
  const [guestAiUsed, setGuestAiUsed] = useState(() => getGuestAiUsed());
  const [guestOnlineUsed, setGuestOnlineUsed] = useState(0);
  const [guestLimitNotice, setGuestLimitNotice] = useState<string | null>(null);
  const guestAiStartReservedRef = useRef(false);
  const requireAccount = (reason = "Sign in to unlock this feature, save progress and enjoy unlimited matches."): boolean => {
    if (!guestMode) return true;
    setGuestLimitNotice(reason);
    return false;
  };
  const takeGuestAiTrial = (): boolean => {
    if (!guestMode) return true;
    if (!claimGuestAiGame()) {
      setGuestLimitNotice(`You've used all ${GUEST_AI_LIMIT} free AI games. Sign in or create an account to play more.`);
      return false;
    }
    setGuestAiUsed(getGuestAiUsed());
    return true;
  };
  const [authChecked, setAuthChecked] = useState<boolean>(false); // true once we know, one way or the other, whether someone is signed in
  const [verifyBannerDismissed, setVerifyBannerDismissed] = useState(false); // per-session only (not persisted) -- reappears next visit until actually verified, so it can't be silenced by accident forever
  const [verifyEmailSent, setVerifyEmailSent] = useState(false);
  const handleResendVerification = async () => {
    try {
      await resendVerificationEmail();
      setVerifyEmailSent(true);
    } catch (err: any) {
      setStatusMessage(err?.code === "over_email_send_rate_limit" || err?.code === "over_request_rate_limit"
        ? "Too many requests -- wait a bit before trying again."
        : "Couldn't resend the verification email. Try again shortly.");
    }
  };

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    (async () => {
      try {
        await authReady;
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user ?? null;
        // Best-effort identity proof for the game server (contract §1).
        gameSocket.setAccessToken(session?.access_token ?? null);
        setAuthUser(user);
        if (user) {
          setGuestActive(false);
          setGuestEnabled(false);
          const uname = (user.user_metadata?.username as string | undefined) || null;
          setUsername(uname);
          if (uname) safeStorage.setItem("lidraughts_username", uname);
        } else {
          const guest = isGuestActive();
          setGuestEnabled(guest);
          setUsername(guest ? getGuestName() : null);
          safeStorage.removeItem("lidraughts_username");
        }
      } catch (err) {
        console.error("Auth bootstrap failed:", err);
        setAuthUser(null);
        setUsername(null);
      } finally {
        setAuthChecked(true);
      }

      unsubscribe = onAuthStateChange((changedUser) => {
        // Token can refresh without a username change. Keep WebSocket login
        // proof fresh for the next network reconnect.
        supabase.auth.getSession().then(({ data }) => gameSocket.setAccessToken(data.session?.access_token ?? null)).catch(() => {});
        setAuthUser(changedUser);
        if (changedUser) {
          setGuestActive(false);
          setGuestEnabled(false);
          const uname = (changedUser.user_metadata?.username as string | undefined) || null;
          setUsername(uname);
          if (uname) safeStorage.setItem("lidraughts_username", uname);
        } else {
          setUsername(isGuestActive() ? getGuestName() : null);
          safeStorage.removeItem("lidraughts_username");
        }
      });
    })();

    return () => unsubscribe?.();
  }, []);

  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [openRooms, setOpenRooms] = useState<Array<{
    id: string;
    creator: string;
    hostName: string;
    gameTime: number;
    specialRule: string;
    wagerAmount: number;
    bestOf: number;
    playersCount: number;
  }>>([]);
  // The raw socket is only kept as React state for legacy consumers
  // (useWebRTCCall, GlobalChatLounge). Everything else goes through the
  // gameSocket manager, which owns reconnects, queueing and heartbeats.
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [reconnectAttempts, setReconnectAttempts] = useState<number>(0);
  const [pingMs, setPingMs] = useState<number>(0);
  const [premove, setPremove] = useState<{ from: number; to?: number } | null>(null);
  const premoveRef = useRef<{ from: number; to?: number } | null>(null);
  premoveRef.current = premove;
  const [sessionNotice, setSessionNotice] = useState<{ kind: "replaced" | "name-taken"; message: string } | null>(null);

  // --- Room / multiplayer state lives in ONE reducer (audit H3) ---
  // Socket handlers dispatch actions; decisions that depend on current room
  // state are made inside the reducer, so no handler can act on a stale
  // closure. RESET_ROOM is the single exit path for leaving/cancel/spectate.
  const [room, dispatchRoom] = useReducer(roomReducer, initialRoomState, (init) => {
    try {
      const active = loadActiveRoom();
      if (active && active.roomId) {
        return {
          ...init,
          roomId: active.roomId,
          yourColor: active.yourColor ?? null,
          specialRule: active.specialRule || "none",
          phase: active.gameStarted ? "playing" : "lobby",
          started: Boolean(active.gameStarted),
        };
      }
    } catch {}
    return init;
  });
  const patchRoom = useCallback((patch: Partial<typeof initialRoomState>) => dispatchRoom({ type: "PATCH", patch }), []);
  const {
    roomId,
    players: roomPlayers,
    yourColor,
    isReady,
    started: multiplayerStarted,
    isSpectating,
    spectatorCount,
    gameTime: multiplayerGameTime,
    specialRule: multiplayerSpecialRule,
    wagerAmount: multiplayerWagerAmount,
    seriesInfo,
    setupPhase,
    drawOfferReceived,
    drawOfferSent,
    resignOfferReceived,
    resignOfferSent,
    serverGameEnd,
    opponentAway,
    messages: multiplayerMessages,
    roomError,
    rematch: rematchState,
    phase: roomPhase,
  } = room;
  const yourColorRef = useRef<"W" | "B" | null>(null);
  useEffect(() => { yourColorRef.current = yourColor; }, [yourColor]);

  // Auto-orient board so the player's pieces are always conveniently at the bottom:
  // White pieces at bottom if yourColor === "W", Black pieces at bottom if yourColor === "B".
  // This automatically adjusts when sides swap on rematch, new series game, or room start.
  useEffect(() => {
    if (playMode === "Multiplayer" && !isSpectating && (yourColor === "W" || yourColor === "B")) {
      setIsFlipped(yourColor === "B");
    }
  }, [playMode, isSpectating, yourColor]);
  const [moveRejectedError, setMoveRejectedError] = useState<string | null>(null);
  const moveRejectedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Transient in-game notice (rejected move, refused send, server error). */
  const showInlineNotice = useCallback((text: string, ms = 4000) => {
    setMoveRejectedError(text);
    if (moveRejectedTimerRef.current) clearTimeout(moveRejectedTimerRef.current);
    moveRejectedTimerRef.current = setTimeout(() => setMoveRejectedError(null), ms);
  }, []);

  // --- Modern WebRTC Voice & HD Video Calling Engine ---
  const boardArenaRef = useRef<HTMLDivElement | null>(null);
  const remoteVoiceAudioRef = useRef<HTMLAudioElement | null>(null);

  const {
    callState: voiceCallState,
    callType,
    incomingCall: incomingVoiceCall,
    opponentName: callOpponentName,
    localStream: localMediaStream,
    localScreenStream,
    remoteStream: remoteAudioStream,
    remoteScreenStream,
    isMicMuted: voiceMuted,
    isVideoMuted: videoMuted,
    isRemoteVideoEnabled,
    callDuration,
    networkQuality,
    isReconnecting,
    renegotiationAttempt,
    maxRenegotiationAttempts,
    isScreenSharing,
    isRemoteScreenSharing,
    isCallActive,
    failureInfo,
    toggleScreenShare,
    startCall,
    acceptCall,
    declineCall,
    cancelCall,
    endCall,
    toggleMic,
    toggleVideo,
    flipCamera,
    handleSignalingMessage,
  } = useWebRTCCall(ws, username, muted, (msg) => setStatusMessage(msg));

  const handleSignalingMessageRef = useRef(handleSignalingMessage);
  useEffect(() => {
    handleSignalingMessageRef.current = handleSignalingMessage;
  }, [handleSignalingMessage]);

  const outgoingVoiceRinging = voiceCallState === "calling";
  const [liveRoomsList, setLiveRoomsList] = useState<{ roomId: string; white: string; black: string; gameTime: number; specialRule: string; spectatorCount: number }[]>([]);

  // (Room settings -- game time, special rule, wager, series -- now live in
  // the room reducer above; see `room`.)
  const [pendingRoomPreview, setPendingRoomPreview] = useState<any>(null);
  const [floatingEmojis, setFloatingEmojis] = useState<{ id: string; emoji: string; sender: string }[]>([]);
  const [roomInput, setRoomInput] = useState("");
  const [chatInput, setChatInput] = useState("");

  // --- Voice Note Simulation State ---
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingIntervalRef = useRef<any>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

  // --- Sharp / Brilliant Connection states and refs ---
  const [pendingHostMatch, setPendingHostMatchState] = useState<boolean>(false);
  const [pendingJoinRoom, setPendingJoinRoomState] = useState<string | null>(null);

  const pendingHostMatchRef = useRef<boolean>(false);
  const pendingJoinRoomRef = useRef<string | null>(null);

  // Settings chosen on the "Host a Match" modification screen (Game Time,
  // Time Advantage, Special Rule). Kept in a ref (not just state) so that if
  // the socket is reconnecting when Create Match is pressed, the reconnect
  // handler below can resend the SAME settings instead of silently falling
  // back to server defaults (5 min, no special rule).
  const pendingHostSettingsRef = useRef<{
    gameTime: number;
    specialRule: "none" | "short-one" | "short-two" | "short-three" | "crown-crown" | "no-kentrodraught";
    hostTime: number;
    guestTime: number;
    wagerAmount: number;
    bestOf: number;
    private: boolean;
    customBoard?: Board;
    customTurn?: "W" | "B";
  }>({ gameTime: 5, specialRule: "none", hostTime: 5, guestTime: 5, wagerAmount: MIN_MATCH_WAGER, bestOf: 1, private: false });

  const [showHostSetupModal, setShowHostSetupModal] = useState<boolean>(false);
  const [setupGameTime, setSetupGameTime] = useState<number>(5);
  const [setupSpecialRule, setSetupSpecialRule] = useState<
    "none" | "short-one" | "short-two" | "short-three" | "crown-crown" | "no-kentrodraught"
  >("none");
  const [setupUnevenTime, setSetupUnevenTime] = useState<boolean>(false);
  const [setupHostTime, setSetupHostTime] = useState<number>(5);
  const [setupGuestTime, setSetupGuestTime] = useState<number>(5);
  const [setupWagerAmount, setSetupWagerAmount] = useState<number>(MIN_MATCH_WAGER);
  const [setupBestOf, setSetupBestOf] = useState<number>(1);
  const [setupPrivate, setSetupPrivate] = useState(false);

  const setPendingHostMatch = (val: boolean) => {
    pendingHostMatchRef.current = val;
    setPendingHostMatchState(val);
  };

  const setPendingJoinRoom = (val: string | null) => {
    pendingJoinRoomRef.current = val;
    setPendingJoinRoomState(val);
  };

  // --- Player Profile & Game Timing States ---
  const [gameStartTime, setGameStartTime] = useState<number | null>(null);
  const [gameRecorded, setGameRecorded] = useState<boolean>(false);
  const [usedHintsOrUndo, setUsedHintsOrUndo] = useState<boolean>(false);
  const [profileStats, setProfileStats] = useState<PlayerStats>({
    username: username || "player",
    elo: 1500,
    wins: 0,
    losses: 0,
    draws: 0,
    gamesCount: 0,
    totalPlayTime: 0,
    averageDuration: 0,
    maxUnlockedKenLevel: 3
  });
  // NOTE: AI level access is now driven entirely by profileStats.maxUnlockedKenLevel,
  // which both the win-without-hint/undo path AND the coin-unlock path
  // (/api/coins/unlock-ai-level) update -- see handleUnlockKenLevel below.
  // This removed the old separate isPremiumUnlocked flag/fullAIPackPurchased
  // field entirely rather than leaving two parallel unlock systems.
  const [showPurchaseModal, setShowPurchaseModal] = useState<boolean>(false);
  const [showProfilePage, setShowProfilePage] = useState<boolean>(false);
  const [showFriendsPage, setShowFriendsPage] = useState<boolean>(false);
  const [purchaseReceiptRef, setPurchaseReceiptRef] = useState<string>("");
  const [purchaseSubmitting, setPurchaseSubmitting] = useState<boolean>(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseSubmitted, setPurchaseSubmitted] = useState<boolean>(false);
  const [coinPackages, setCoinPackages] = useState<{ id: string; coins: number; priceNaira: number }[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string>("");
  const [coinBalance, setCoinBalance] = useState<number>(0);
  const [coinSettings, setCoinSettings] = useState<{
    matchEntryFee: { blitz: number; rapid: number; classical: number };
    crownCrownSurcharge: number;
    tournamentEntryFeeDefault: number;
    aiUnlockCostPerLevel: number;
    aiUnlockAllCost: number;
    withdrawalRatePerHundredCoins: number;
    withdrawalMinCoins: number;
    withdrawalMinGamesPlayed: number;
    withdrawalMinAccountAgeDays: number;
  } | null>(null);

  const [storeTab, setStoreTab] = useState<"buy" | "withdraw">("buy");
  const [withdrawCoins, setWithdrawCoins] = useState<string>("");
  const [withdrawAccountName, setWithdrawAccountName] = useState<string>("");
  const [withdrawAccountNumber, setWithdrawAccountNumber] = useState<string>("");
  const [withdrawBankName, setWithdrawBankName] = useState<string>("");
  const [withdrawSubmitting, setWithdrawSubmitting] = useState<boolean>(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSubmitted, setWithdrawSubmitted] = useState<{ nairaAmount: number } | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      const uname = username || "player";
      const cleanUname = uname.toLowerCase().trim();
      if (!isSupabaseConfigured || !authUser) {
        setProfileStats({
          username: uname,
          elo: 1500,
          wins: 0,
          losses: 0,
          draws: 0,
          gamesCount: 0,
          totalPlayTime: 0,
          averageDuration: 0,
          maxUnlockedKenLevel: 3
        });
        return;
      }
      try {
        await authReady; // RLS now requires auth.uid() to be set (see supabase/schema.sql)
        let data: any = null;
        try {
          const { data: row, error } = await supabase.from("profiles").select("*").eq("usernameLower", cleanUname).maybeSingle();
          if (error) throw error;
          data = row;
        } catch (err) {
          handleSupabaseError(err, OperationType.GET, `profiles/${cleanUname}`);
          return;
        }
        if (data) {
          setProfileStats({
            ...data,
            maxUnlockedKenLevel: Math.max(3, data.maxUnlockedKenLevel || 1)
          });
        } else {
          const newStats = {
            username: uname,
            usernameLower: cleanUname,
            elo: 1500,
            wins: 0,
            losses: 0,
            draws: 0,
            gamesCount: 0,
            totalPlayTime: 0,
            averageDuration: 0,
            maxUnlockedKenLevel: 3,
            // Required by RLS so only this browser session's identity can
            // update this row's rating going forward. See src/supabase.ts.
            ownerId: authUser?.id || null
          };
          setProfileStats(newStats);
          if (authUser) {
            try {
              const { error } = await supabase.from("profiles").upsert(newStats, { onConflict: "usernameLower" });
              if (error) console.warn("Profile upsert warning:", error);
            } catch (err) {
              console.warn("Profile upsert error:", err);
            }
          }
        }
      } catch (e) {
        console.error("Failed to load stats from Supabase", e);
      }
    };
    fetchStats();
  }, [username, authUser]);

  // --- Kentro Coins: load public pricing + this player's wallet balance ---
  useEffect(() => {
    fetch("/api/coins/settings").then(r => r.json()).then((data) => {
      setCoinSettings(data);
      const packages = data.coinPackages || [];
      setCoinPackages(packages);
      if (packages.length > 0) setSelectedPackageId((prev) => prev || packages[0].id);
    }).catch(() => {});
  }, []);

  const refreshCoinBalance = async () => {
    if (!username || guestMode) return;
    try {
      const data = await apiGet(`/api/coins/wallet/${encodeURIComponent(username.toLowerCase().trim())}`);
      setCoinBalance(data.balance || 0);
    } catch {
      // not signed in yet / wallet doesn't exist yet -- balance stays 0
    }
  };

  useEffect(() => {
    refreshCoinBalance();
  }, [username, guestMode]);

  // --- Admin permission check (silent -- this is NOT the Admin Panel gate,
  // just enough info for the rest of the UI to know whether to show
  // admin-only controls, e.g. tournament creation). Empty array for a
  // regular player is the expected, common case, not an error. ---
  const [adminPermissions, setAdminPermissions] = useState<string[]>([]);
  const isTournamentAdmin = adminPermissions.includes("manage_tournaments");

  useEffect(() => {
    if (!username || guestMode) { setAdminPermissions([]); return; }
    (async () => {
      try {
        const res = await apiPost("/api/admin/whoami", {});
        setAdminPermissions(res.isAdmin ? (res.permissions || []) : []);
      } catch {
        setAdminPermissions([]);
      }
    })();
  }, [username, guestMode]);

  // --- Check game over states to update stats & play sounds ---
  useEffect(() => {
    // We only record if a game is active, not yet recorded, and no modal is currently shown
    if (gameRecorded || gameOverInfo || !gameStartTime || isSpectating) return;

    const lowerMsg = statusMessage.toLowerCase();

    // Guard against any draw/resign proposal, rejection, decline, cancellation, or waiting state
    const isOfferLifecycleMessage =
      lowerMsg.includes("offer sent") ||
      lowerMsg.includes("draw offer") ||
      lowerMsg.includes("resignation offer") ||
      lowerMsg.includes("offered") ||
      lowerMsg.includes("declined") ||
      lowerMsg.includes("withdrawn") ||
      lowerMsg.includes("cancelled") ||
      lowerMsg.includes("canceled") ||
      lowerMsg.includes("rejected") ||
      lowerMsg.includes("waiting for opponent") ||
      lowerMsg.includes("clock paused while opponent responds");

    if (isOfferLifecycleMessage) return;

    // Multiplayer: ONLY the server's game-ended payload concludes a game --
    // never a status string (the client no longer flags anyone locally, C1).
    // Local games: the status strings written by the rules engine / local flag.
    const isServerGame = playMode === "Multiplayer";

    // A real draw is an authoritative game conclusion
    const hasDraw = isServerGame
      ? !!serverGameEnd && (serverGameEnd.winnerColor === null || serverGameEnd.reason === "draw")
      : (
        lowerMsg.startsWith("game draw!") ||
        lowerMsg.startsWith("series drawn") ||
        lowerMsg.includes("draw agreed") ||
        lowerMsg.includes("game drawn") ||
        (lowerMsg.startsWith("game over!") && (lowerMsg.includes("draw") || lowerMsg.includes("drawn")))
      );

    // A real win is an authoritative game conclusion
    const hasWon = isServerGame
      ? !!serverGameEnd && serverGameEnd.winnerColor !== null
      : (
        (lowerMsg.startsWith("game over!") && (lowerMsg.includes("wins") || lowerMsg.includes("won"))) ||
        (lowerMsg.startsWith("series over!") && (lowerMsg.includes("wins") || lowerMsg.includes("won"))) ||
        lowerMsg.includes("flagged!") ||
        lowerMsg.includes("wins on time")
      );

    if (!hasWon && !hasDraw) return;

    // Determine the outcome for our user
    let outcome: "win" | "loss" | "draw" | null = null;
    let opponentElo = 1500;

    // AI ELO based on level
    const aiElos: Record<number, number> = {
      1: 1200,
      2: 1400,
      3: 1600,
      4: 1800,
      5: 2000,
      6: 2200,
      7: 2400,
      8: 2600
    };

    if (playMode === "Multiplayer") {
      opponentElo = Math.max(1200, profileStats.elo + (Math.random() > 0.5 ? 25 : -25));
      if (hasDraw) {
        outcome = "draw";
      } else if (serverGameEnd?.winnerColor) {
        outcome = serverGameEnd.winnerColor === yourColor ? "win" : "loss";
      } else {
        const whiteWins = lowerMsg.includes("white wins") || (lowerMsg.includes("black flagged") && lowerMsg.includes("white wins"));
        const blackWins = lowerMsg.includes("black wins") || (lowerMsg.includes("white flagged") && lowerMsg.includes("black wins"));
        
        if (yourColor === "W") {
          outcome = whiteWins ? "win" : blackWins ? "loss" : null;
        } else if (yourColor === "B") {
          outcome = blackWins ? "win" : whiteWins ? "loss" : null;
        } else if (username && lowerMsg.includes(`${username.toLowerCase()} wins`)) {
          outcome = "win";
        }
      }
    } else if (playMode === "Human_vs_AI") {
      opponentElo = aiElos[kenLevelId] || 1400;
      if (hasDraw) {
        outcome = "draw";
      } else {
        const whiteWins = lowerMsg.includes("white wins") || lowerMsg.includes("black flagged");
        outcome = whiteWins ? "win" : "loss";
      }
    } else if (playMode === "AI_vs_Human") {
      opponentElo = aiElos[kenLevelId] || 1400;
      if (hasDraw) {
        outcome = "draw";
      } else {
        const blackWins = lowerMsg.includes("black wins") || lowerMsg.includes("white flagged");
        outcome = blackWins ? "win" : "loss";
      }
    } else if (playMode === "Tournament") {
      opponentElo = aiElos[getTournamentKenLevelId(tournamentRound)] || 1400;
      if (hasDraw) {
        outcome = "draw";
      } else {
        const isWhite = tournamentRound === 1 || tournamentRound === 3;
        if (isWhite) {
          const whiteWins = lowerMsg.includes("white wins") || lowerMsg.includes("black flagged");
          outcome = whiteWins ? "win" : "loss";
        } else {
          const blackWins = lowerMsg.includes("black wins") || lowerMsg.includes("white flagged");
          outcome = blackWins ? "win" : "loss";
        }
      }

      // Record tournament outcome
      if (outcome && isTournamentGameInProgress) {
        if (activeTournamentMatchId) {
          setActiveTournamentOutcome(outcome);
          setIsTournamentGameInProgress(false);
          safeStorage.setItem("lidraughts_tournament_game_in_progress", "false");
        } else if (isTournamentActive) {
          const pts = outcome === "win" ? 2 : outcome === "draw" ? 1 : 0;
          setTournamentPoints((p) => {
            const np = p + pts;
            safeStorage.setItem("lidraughts_tournament_points", String(np));
            return np;
          });

          const nextHistItem = {
            round: tournamentRound,
            opponent: `Ken Level ${getTournamentKenLevelId(tournamentRound)}`,
            outcome,
            points: pts,
          };

          setTournamentHistory((prev) => {
            const nh = [...prev, nextHistItem];
            safeStorage.setItem("lidraughts_tournament_history", JSON.stringify(nh));
            return nh;
          });

          setIsTournamentGameInProgress(false);
          safeStorage.setItem("lidraughts_tournament_game_in_progress", "false");
        }
      }
    }

    if (outcome) {
      setGameRecorded(true);
      const durationSeconds = Math.round((Date.now() - gameStartTime) / 1000);
      const isAIGame = playMode === "Human_vs_AI" || playMode === "AI_vs_Human" || playMode === "AI_vs_AI" || playMode === "Analysis" || playMode === "Training";
      const isMultiplayer = playMode === "Multiplayer";

      setGameOverInfo({
        outcome,
        isAIGame,
        canLevelUp: outcome === "win" && isAIGame && kenLevelId < 8 && kenLevelId + 1 <= Math.max(3, profileStats.maxUnlockedKenLevel || 1) && !usedHintsOrUndo,
        durationSeconds,
        movesCount: moveHistory.length,
      });
      if (isAIGame) safeStorage.removeItem(AI_GAME_STORAGE_KEY);

      // Verified online results update canonical statistics on the server.
      // Practice, local and AI results cannot grant ranked stats or paid unlocks.
      // Guests do not save matches. For online multiplayer, the authoritative
      // server already writes ONE record using the shared room game code.
      // Both clients inserting their own random game IDs was creating 2–4
      // archive entries per match. Refresh the archive after server sync.
      if (!guestMode && playMode === "Multiplayer") {
        const refreshSettlement = async () => {
          void fetchMyGames(); void fetchSavedGames();
          if (!authUser) return;
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user.id !== authUser.id) return;
            const { data, error } = await supabase.from("profiles").select("*").eq("ownerId", authUser.id).maybeSingle();
            const { data: currentSession } = await supabase.auth.getSession();
            if (!error && data && currentSession.session?.user.id === authUser.id) setProfileStats(data as PlayerStats);
          } catch { /* The next archive refresh can retry; keep the last verified profile. */ }
        };
        window.setTimeout(() => { void refreshSettlement(); }, 1800);
        window.setTimeout(() => { void refreshSettlement(); }, 5000);
      }
      if (!guestMode && playMode !== "Multiplayer" && playMode !== "Tournament") {
      // Local practice records are unranked. Official tournament records belong to the server.
      if (isUnsavedPracticeGame) {
        console.log("Practice game resumed from analysis finished -- skipping auto-save to completed_games as requested.");
        setStatusMessage("Practice game complete! (Position practice was not saved to match history).");
        return;
      }

      try {
        const gameId = `game_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

        let whiteName = "White";
        let blackName = "Black";
        if (playMode === "Multiplayer") {
          const whiteUser = roomPlayers.find(p => p.color === "W");
          const blackUser = roomPlayers.find(p => p.color === "B");
          if (whiteUser) whiteName = whiteUser.username;
          if (blackUser) blackName = blackUser.username;
        } else if (playMode === "Tournament") {
          const isWhite = tournamentRound === 1 || tournamentRound === 3;
          whiteName = isWhite ? (username || "You") : `Ken Level ${getTournamentKenLevelId(tournamentRound)}`;
          blackName = isWhite ? `Ken Level ${getTournamentKenLevelId(tournamentRound)}` : (username || "You");
        } else if (playMode === "Human_vs_AI") {
          whiteName = username || "You";
          blackName = `Ken Level ${kenLevelId}`;
        } else if (playMode === "AI_vs_Human") {
          whiteName = `Ken Level ${kenLevelId}`;
          blackName = username || "You";
        } else if (playMode === "AI_vs_AI") {
          whiteName = `Ken Level ${kenLevelId} (White)`;
          blackName = `Ken Level ${kenLevelId} (Black)`;
        } else if (playMode === "Training" || playMode === "Analysis") {
          whiteName = analysisPlayerColor === "W" ? (username || "You") : (analysisPlayVsAI ? `Ken Level ${analysisAILevel}` : "Black Player");
          blackName = analysisPlayerColor === "B" ? (username || "You") : (analysisPlayVsAI ? `Ken Level ${analysisAILevel}` : "White Player");
        } else {
          whiteName = "White Player";
          blackName = "Black Player";
        }

        const winnerName = outcome === "win" ? (yourColor === "W" || playMode === "Human_vs_AI" || (playMode === "Tournament" && (tournamentRound === 1 || tournamentRound === 3)) || ((playMode === "Training" || playMode === "Analysis") && analysisPlayerColor === "W") ? "White" : "Black") : (outcome === "loss" ? (yourColor === "W" || playMode === "Human_vs_AI" || (playMode === "Tournament" && (tournamentRound === 1 || tournamentRound === 3)) || ((playMode === "Training" || playMode === "Analysis") && analysisPlayerColor === "W") ? "Black" : "White") : "Draw");

        const completedGameData = {
          gameId,
          whitePlayer: whiteName,
          blackPlayer: blackName,
          winner: winnerName,
          moveHistoryStrings,
          moveHistory,
          moveEvaluations: moveEvaluations || {},
          playMode,
          timestamp: Date.now(),
        };

        (async () => {
          try {
            const { error: insertError } = await supabase.from("completed_games").insert(completedGameData);
            if (insertError) throw insertError;
            // Refresh "Recent Games" / "Your Matches" immediately so the just-finished
            // game shows up right away instead of waiting for an unrelated navigation
            // (e.g. opening Analysis) to happen to trigger the next fetch.
            fetchMyGames();
            // Automatic Server-Side Background Deep Analysis
            if (moveHistory.length > 0) {
              fetch("/api/engine/analyze-game", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ gameId }),
              })
                .then((res) => res.json())
                .then((data) => {
                  if (data && data.moveEvaluations) {
                    setMoveEvaluations(data.moveEvaluations);
                  }
                })
                .catch((e) => console.error("Server-side background analysis call error:", e));
            }
          } catch (err: unknown) {
            handleSupabaseError(err, OperationType.WRITE, `completed_games/${gameId}`);
          }
        })();
      } catch (saveError) {
        console.error("Failed to construct game data for save:", saveError);
      }
      }

      // Play corresponding victory/defeat/draw sound
      if (outcome === "win") {
        playVictorySound(muted);
      } else if (outcome === "loss") {
        playDefeatSound(muted);
      } else {
        playDrawSound(muted);
      }
    }
  }, [statusMessage, serverGameEnd, isSpectating, gameRecorded, gameOverInfo, gameStartTime, playMode, yourColor, kenLevelId, username, muted, isTournamentActive, isTournamentGameInProgress, tournamentRound, profileStats.elo, guestMode]);

  // ===================================================================
  // ONLINE PLAY: socket wiring (docs/ONLINE_PLAY_PROTOCOL.md)
  // ===================================================================
  // The gameSocket singleton owns the connection (reconnects with backoff,
  // heartbeat, queueing, session token). App subscribes exactly ONCE and
  // routes every event through `socketEventRef`, which always points at
  // the handler from the latest render -- so handlers read fresh state and
  // none of the old per-socket closure bugs (audit H1/H3) can recur.

  const moveCountRef = useRef<number>(0);
  useEffect(() => { moveCountRef.current = moveHistory.length; }, [moveHistory.length]);
  const mutedRef = useRef(muted);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // Per-room sequence tracking (contract section 3).
  const lastSeqRef = useRef<{ roomId: string | null; seq: number }>({ roomId: null, seq: 0 });
  const lastGameStartedSeqRef = useRef<number>(-1);
  const pendingReplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const roomIdRef = useRef<string | null>(null);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  /** Forget everything about the current room -- the single exit path. */
  const resetRoomState = useCallback(() => {
    const curRoomId = roomIdRef.current;
    if (curRoomId) clearFastResumeState(curRoomId);
    dispatchRoom({ type: "RESET_ROOM" });
    lastSeqRef.current = { roomId: null, seq: 0 };
    lastGameStartedSeqRef.current = -1;
    if (pendingReplayTimerRef.current) {
      clearTimeout(pendingReplayTimerRef.current);
      pendingReplayTimerRef.current = null;
    }
  }, []);

  /** False when `data` is older than state we already applied (stale). */
  const acceptSeq = (data: any): boolean => {
    if (typeof data?.seq !== "number") return true;
    const rid: string | null = typeof data.roomId === "string" ? data.roomId : lastSeqRef.current.roomId;
    if (rid !== lastSeqRef.current.roomId) {
      lastSeqRef.current = { roomId: rid, seq: data.seq };
      return true;
    }
    if (data.seq < lastSeqRef.current.seq) return false;
    lastSeqRef.current.seq = data.seq;
    return true;
  };

  /** Adopt a full server `gameState` (board/turn/history/status). Clocks come from `clock` only. */
  const applyGameState = (gs: any, opts: { resetView?: boolean } = {}) => {
    if (!gs || typeof gs !== "object") return;
    if (gs.board) setBoard(gs.board);
    if (gs.turn === "W" || gs.turn === "B") setTurn(gs.turn);
    if (Array.isArray(gs.moveHistory)) {
      setMoveHistory(gs.moveHistory);
      moveCountRef.current = gs.moveHistory.length;
    }
    if (typeof gs.statusMessage === "string") setStatusMessage(gs.statusMessage);
    if (opts.resetView) {
      setHistoryViewIndex(null);
      setSelectedSq(null);
    }
  };

  const applyClockFrom = (data: any, receivedAt: number) => {
    if (data && data.clock && typeof data.clock === "object") {
      dispatchRoom({ type: "CLOCK", clock: data.clock, receivedAt });
    }
  };

  const playMoveSound = (mv: Move | null | undefined) => {
    if (mv && Array.isArray(mv.caps) && mv.caps.length > 0) playCaptureSound(mutedRef.current);
    else playClickSound(mutedRef.current);
  };

  const requestResync = () => {
    gameSocket.send(roomId ? { type: "resync", roomId } : { type: "resync" });
  };

  /**
   * Replay a create/join intent once a fresh login has settled. Deferred a
   * beat so a `room-rejoined` the server sends right after `login-success`
   * (we're already seated) is processed first and clears the intent.
   */
  const replayPendingIntent = () => {
    if (pendingReplayTimerRef.current) {
      clearTimeout(pendingReplayTimerRef.current);
      pendingReplayTimerRef.current = null;
    }
    if (roomIdRef.current !== null || multiplayerStarted) {
      setPendingHostMatch(false);
      setPendingJoinRoom(null);
      return;
    }
    pendingReplayTimerRef.current = setTimeout(() => {
      pendingReplayTimerRef.current = null;
      if (gameSocket.getStatus() !== "connected") return;
      if (roomIdRef.current !== null || multiplayerStarted) {
        setPendingHostMatch(false);
        setPendingJoinRoom(null);
        return;
      }
      if (pendingHostMatchRef.current) {
        gameSocket.send({ type: "create-room", ...pendingHostSettingsRef.current });
      } else if (pendingJoinRoomRef.current) {
        gameSocket.send({ type: "join-room", roomId: pendingJoinRoomRef.current });
      }
    }, 250);
  };

  /** Contract section 2: every refused action arrives as `error { code, message }`. */
  const handleServerError = (data: { code?: ServerErrorCode | string; message?: string; context?: unknown }) => {
    const code = data.code;
    const message = typeof data.message === "string" && data.message ? data.message : "The server refused that action.";
    // Any pending create/join intent is dead once the server refuses.
    setPendingHostMatch(false);
    setPendingJoinRoom(null);
    const inLiveGame = playModeRef.current === "Multiplayer" && multiplayerStarted;
    switch (code) {
      case "name-taken":
        // Another live socket holds this name and we have no matching
        // session token: stop the reconnect loop instead of hammering.
        gameSocket.pause();
        setSessionNotice({
          kind: "name-taken",
          // The server knows WHY (another live tab vs. a game still in
          // progress elsewhere) -- show its wording, then a Retry.
          message: (typeof data.message === "string" && data.message)
            || `"${username ?? "This name"}" is already online on another device or tab. Continue there, or tap Retry once you have closed it.`,
        });
        setStatusMessage("Name in use elsewhere — not connected.");
        break;
      case "game-in-progress":
        // Also answers game-reset / rematch-* during a series pause: a
        // rematch we optimistically marked "waiting" is not pending.
        if (rematchState.status === "waiting") dispatchRoom({ type: "REMATCH", rematch: { status: "idle" } });
        showInlineNotice("A game is in progress — use Resign to end it before starting a new one.", 5000);
        setStatusMessage("Game in progress — resign to end it.");
        break;
      case "busy":
        // A move while a draw/resign offer is pending: the clock is paused
        // and the offerer can cancel. Reconcile the optimistic move.
        if (inLiveGame) {
          showInlineNotice(message || "Respond to the pending offer first — the clock is paused.", 5000);
          requestResync();
        } else {
          patchRoom({ roomError: message });
        }
        if (rematchState.status === "waiting") dispatchRoom({ type: "REMATCH", rematch: { status: "idle" } });
        setStatusMessage(message);
        break;
      case "room-not-found":
      case "room-full":
        if (!inLiveGame && !roomIdRef.current) {
          patchRoom({ roomError: message });
        }
        setStatusMessage(message);
        break;
      case "not-your-turn":
      case "illegal-move":
      case "wrong-phase":
      case "not-in-room":
        // A refused game action may have been applied optimistically: pull
        // the authoritative state so the board can never drift.
        if (inLiveGame) {
          showInlineNotice(message);
          requestResync();
        } else {
          patchRoom({ roomError: message });
        }
        if (rematchState.status === "waiting") dispatchRoom({ type: "REMATCH", rematch: { status: "idle" } });
        setStatusMessage(message);
        break;
      case "rate-limited":
      case "invalid-payload":
      case "not-logged-in":
      default:
        if (inLiveGame) showInlineNotice(message);
        else patchRoom({ roomError: message });
        setStatusMessage(message);
        break;
    }
  };

  const handleSocketMessage = (data: any) => {
    if (!data || typeof data.type !== "string") return;
    const receivedAt = Date.now();
    const quiet = mutedRef.current;

    switch (data.type) {
      case "login-success":
        if (typeof data.username === "string") {
          if (!isGuestName(data.username)) safeStorage.setItem("lidraughts_username", data.username);
          if (!username && (authUser || guestMode)) setUsername(data.username);
        }
        setOnlineUsers(Array.isArray(data.onlineUsers) ? data.onlineUsers : []);
        setSessionNotice(null);
        gameSocket.send({ type: "get-open-rooms" });
        replayPendingIntent();
        {
          const currentActive = loadActiveRoom();
          if (currentActive && currentActive.roomId && !roomPlayers.length) {
            gameSocket.send({ type: "join-room", roomId: currentActive.roomId });
          }
        }
        break;
      case "online-users-update":
        setOnlineUsers(Array.isArray(data.onlineUsers) ? data.onlineUsers : []);
        break;
      case "guest-quota":
        if (typeof data.onlineRemaining === "number") setGuestOnlineUsed(previous => Math.max(previous, GUEST_ONLINE_LIMIT - data.onlineRemaining));
        break;
      case "guest-limit-reached":
        setGuestOnlineUsed(GUEST_ONLINE_LIMIT);
        setGuestLimitNotice(data.message || "You've played your free online game. Sign in to continue.");
        setPendingHostMatch(false);
        setPendingJoinRoom(null);
        break;
      case "open-rooms-list":
        setOpenRooms(data.rooms || []);
        break;
      case "pong":
        // Offset refresh is delivered by the manager as an "offset" event.
        break;
      case "error":
        handleServerError(data);
        break;
      case "chat-error":
        showInlineNotice(typeof data.message === "string" ? data.message : "Message not sent.");
        break;
      case "session-replaced":
        setSessionNotice({ kind: "replaced", message: "You signed in from another device or tab, so this one was disconnected." });
        setStatusMessage("Signed in elsewhere — disconnected here.");
        break;
      case "room-cancelled":
        if (typeof data.roomId === "string") {
          const wasMine = data.roomId === roomId;
          dispatchRoom({ type: "ROOM_CANCELLED", roomId: data.roomId });
          if (wasMine) {
            lastSeqRef.current = { roomId: null, seq: 0 };
            lastGameStartedSeqRef.current = -1;
            setStatusMessage("Room cancelled.");
          }
        }
        break;
      case "room-info": {
        if (typeof data.roomId !== "string") break;
        const players: any[] = Array.isArray(data.players) ? data.players : [];
        const meIn = !!username && players.some((p) => p && isSameUser(p.username, username));
        const isMyRoom = data.roomId === roomId;
        // A room I'm neither seated in nor watching is none of my business (M5).
        if (!meIn && !isMyRoom) break;
        if (!acceptSeq(data)) break;
        const enteringRoom = meIn && !isMyRoom;
        const wasPending = pendingHostMatchRef.current || !!pendingJoinRoomRef.current;
        setPendingHostMatch(false);
        if (meIn) {
          setPendingJoinRoom(null);
          if (pendingReplayTimerRef.current) {
            clearTimeout(pendingReplayTimerRef.current);
            pendingReplayTimerRef.current = null;
          }
        }
        dispatchRoom({ type: "ROOM_INFO", data, username, receivedAt });
        patchRoom({ roomError: null });
        if (data.clockLimitType) setClockLimitType(data.clockLimitType);
        const myColor: Color | null =
          data.yourColor === "W" || data.yourColor === "B" ? data.yourColor
          : (players.find((p) => p && isSameUser(p.username, username))?.color ?? null);
        if (myColor && meIn && !isSpectating) setIsFlipped(myColor === "B");
        // Only pull the player onto the Multiplayer screen when they are in
        // this room's flow (they just created/joined it), never because an
        // unrelated room they still sit in changed under an AI game (M5).
        if (enteringRoom && (wasPending || playModeRef.current === "Multiplayer")) {
          setPlayMode("Multiplayer");
        }

        if (data.gameState) {
          applyGameState(data.gameState);
        } else if (data.started && meIn) {
          const cached = loadFastResumeState(data.roomId);
          if (cached && cached.board) {
            setBoard(cached.board);
            if (cached.turn) setTurn(cached.turn);
            if (cached.moveHistory) {
              setMoveHistory(cached.moveHistory);
              moveCountRef.current = cached.moveHistory.length;
            }
          }
        } else if (!data.started && meIn) {
          // Pre-initialize the host's draft board based on the rule selected.
          const initBoard = createInitialBoard();
          const creatorColor = myColor || "W";
          const sRule = data.specialRule || "none";
          if (sRule === "short-one") {
            if (creatorColor === "W") initBoard[50] = null; else initBoard[1] = null;
          } else if (sRule === "short-two") {
            if (creatorColor === "W") { initBoard[50] = null; initBoard[49] = null; }
            else { initBoard[1] = null; initBoard[2] = null; }
          } else if (sRule === "short-three") {
            if (creatorColor === "W") { initBoard[50] = null; initBoard[49] = null; initBoard[48] = null; }
            else { initBoard[1] = null; initBoard[2] = null; initBoard[3] = null; }
          }
          // (crown-crown setup is interactive after the game starts.)
          setBoard(initBoard);
          setTurn("W");
          setMoveHistory([]);
          moveCountRef.current = 0;
        }
        break;
      }
      case "join-success":
        // The room accepted this invitee; drop the URL so refresh does not
        // prompt for the same invitation after a game has begun.
        if (inviteRoomCode && cleanInviteRoomCode(String(data.roomId || "")) === inviteRoomCode) {
          dismissRoomInvite();
        }
        setPendingJoinRoom(null);
        setPendingHostMatch(false);
        setPendingRoomPreview(null);
        if (pendingReplayTimerRef.current) {
          clearTimeout(pendingReplayTimerRef.current);
          pendingReplayTimerRef.current = null;
        }
        patchRoom({
          ...(typeof data.roomId === "string" ? { roomId: data.roomId } : {}),
          yourColor: (data.yourColor === "W" || data.yourColor === "B") ? data.yourColor : undefined,
          roomError: null,
        });
        if (data.yourColor === "W" || data.yourColor === "B") {
          setIsFlipped(data.yourColor === "B");
        }
        setPlayMode("Multiplayer");
        break;
      case "room-error":
        setPendingHostMatch(false);
        setPendingJoinRoom(null);
        if (!multiplayerStarted && roomPhase !== "playing" && roomPhase !== "setup" && !roomIdRef.current) {
          patchRoom({ roomError: typeof data.error === "string" ? data.error : (typeof data.message === "string" ? data.message : "Room error") });
        }
        break;
      case "room-preview":
        setPendingJoinRoom(null);
        patchRoom({ roomError: null });
        setPendingRoomPreview({
          roomId: data.roomId,
          hostName: data.hostName,
          gameTime: data.gameTime,
          specialRule: data.specialRule,
          hostTime: data.hostTime,
          guestTime: data.guestTime,
          entryFee: typeof data.entryFee === "number" ? data.entryFee : 0,
          wagerAmount: typeof data.wagerAmount === "number" ? data.wagerAmount : null,
          bestOf: typeof data.bestOf === "number" ? data.bestOf : 1,
        });
        break;
      case "clock-sync":
        // Sent to the ACTOR of a draw/resign offer/decline/cancel: just a
        // fresh clock snapshot (+ phase) -- the other side gets the usual
        // draw-offered / resign-declined / ... with the same clock.
        if (!acceptSeq(data)) break;
        applyClockFrom(data, receivedAt);
        if (data.phase) patchRoom({ phase: data.phase as RoomPhase });
        break;
      case "crown-crown-complete":
        if (!acceptSeq(data)) break;
        patchRoom({ setupPhase: null, ...(data.phase ? { phase: data.phase as RoomPhase } : {}) });
        applyClockFrom(data, receivedAt);
        applyGameState(data.gameState);
        playGameStartSound(quiet);
        break;
      case "emoji-reaction": {
        const reactionId = Math.random().toString();
        const reactionObj = { id: reactionId, emoji: data.emoji, sender: data.sender };
        setFloatingEmojis((prev) => [...prev, reactionObj]);
        setTimeout(() => {
          setFloatingEmojis((prev) => prev.filter((x) => x.id !== reactionId));
        }, 3000);
        break;
      }
      case "series-update": {
        if (!acceptSeq(data)) break;
        // Live Best-of-N scoreboard from the server: game just ended,
        // series over, or the next game is about to auto-start.
        dispatchRoom({ type: "SERIES_UPDATE", data });
        if (typeof data.statusMessage === "string" && data.statusMessage) {
          setStatusMessage(data.statusMessage);
        } else if (!data.seriesOver && typeof data.nextGameInMs === "number") {
          setStatusMessage(`Game ${data.gameNumber} of ${data.bestOf} finished — next game starts in ${Math.round(data.nextGameInMs / 1000)}s (colors swap).`);
        }
        break;
      }
      case "game-started": {
        if (guestMode) setGuestOnlineUsed(GUEST_ONLINE_LIMIT);
        // Duplicate protection via seq (a re-broadcast must not reset the board).
        if (typeof data.seq === "number") {
          if (data.seq <= lastGameStartedSeqRef.current) break;
          lastGameStartedSeqRef.current = data.seq;
        }
        if (!acceptSeq(data)) break;
        const known = Array.isArray(data.players);
        const players: any[] = known ? data.players : roomPlayers;
        const meIn = !!username && players.some((p) => p && isSameUser(p.username, username));
        if (known && !meIn && !isSpectating) break;
        dispatchRoom({ type: "GAME_STARTED", data, username, receivedAt });
        setFairPlayWarning(null);
        setMyAwayStrikes(0);
        setPendingRoomPreview(null);
        setPendingJoinRoom(null);
        setPendingHostMatch(false);
        if (pendingReplayTimerRef.current) {
          clearTimeout(pendingReplayTimerRef.current);
          pendingReplayTimerRef.current = null;
        }
        patchRoom({ roomError: null });
        setPlayMode("Multiplayer");
        // A series auto-starts its next game while the previous game's
        // result modal may still be open -- close it so the board is
        // usable the moment the new game begins.
        setGameOverInfo(null);
        setHistoryViewIndex(null);
        setMoveEvaluations({});
        setLastAnalysisEval(null);
        setSelectedSq(null);
        if (data.gameState && data.gameState.board) {
          applyGameState(data.gameState);
        } else {
          setBoard(createInitialBoard());
          setTurn("W");
          setMoveHistory([]);
          moveCountRef.current = 0;
          setStatusMessage("Multiplayer game started! White to play.");
        }
        if (data.clockLimitType) setClockLimitType(data.clockLimitType);
        const myColor = (data.yourColor === "W" || data.yourColor === "B")
          ? data.yourColor
          : (players.find((p) => p && isSameUser(p.username, username))?.color ?? yourColor);
        if (!isSpectating && (myColor === "W" || myColor === "B")) setIsFlipped(myColor === "B");
        if (!isSpectating) setPlayMode("Multiplayer");
        setGameStartTime(Date.now());
        setGameRecorded(false);
        playGameStartSound(quiet);
        break;
      }
      case "move-made": {
        if (!acceptSeq(data)) break;
        // Per-move delta: ~120 bytes instead of the whole game state.
        const mv = data.move as Move | undefined;
        const idx = typeof data.moveIndex === "number" ? data.moveIndex : -1;
        if (!mv || idx < 0) break;
        applyClockFrom(data, receivedAt);
        const localLen = moveCountRef.current;
        if (localLen === idx) {
          // Our own optimistic move echoed back -- board already right,
          // just adopt the server's turn/status (clock came from `clock`).
          if (data.turn === "W" || data.turn === "B") setTurn(data.turn);
          if (typeof data.statusMessage === "string") setStatusMessage(data.statusMessage);
          setMoveRejectedError(null);
        } else if (localLen === idx - 1) {
          // The opponent's move (or, for spectators, either player's):
          // apply it locally with the same rules engine the server used.
          moveCountRef.current = idx;
          let resultingBoard: Board | null = null;
          setBoard((prev) => {
            if (mv.caps && mv.caps.length > 0) {
              const newAnims = mv.caps.map((sq) => {
                const piece = prev[sq];
                return piece ? { sq, piece, id: `${sq}-${Date.now()}-${Math.random()}` } : null;
              }).filter((anim) => anim !== null);
              if (newAnims.length > 0) {
                setCapturedAnimations((p) => [...p, ...newAnims]);
                setTimeout(() => {
                  setCapturedAnimations((p) => p.filter((anim) => !newAnims.some((na) => na.id === anim.id)));
                }, 350);
              }
            }
            resultingBoard = applyMove(prev, mv).board;
            return resultingBoard;
          });
          setMoveHistory((prev) => [...prev, mv]);
          setHistoryViewIndex(null);
          if (data.turn === "W" || data.turn === "B") setTurn(data.turn);
          if (typeof data.statusMessage === "string") setStatusMessage(data.statusMessage);
          setMoveRejectedError(null);
          if (data.turn !== yourColorRef.current) playMoveSound(mv);

          // Fast pre-move execution trigger
          const queued = premoveRef.current;
          if (queued && data.turn === yourColorRef.current) {
            setPremove(null);
            setTimeout(() => {
              executePremoveIfLegal(queued, resultingBoard);
            }, 10);
          }
        } else {
          // Out of step (missed a message): ask for the full state; the
          // server replies with "opponent-moved" below.
          requestResync();
        }
        break;
      }
      case "opponent-moved":
        // Full state: the resync reply (and the legacy full-state broadcast).
        if (!acceptSeq(data)) break;
        applyClockFrom(data, receivedAt);
        if (data.phase) patchRoom({ phase: data.phase as RoomPhase });
        if (data.gameState) {
          applyGameState(data.gameState, { resetView: true });
          setMoveRejectedError(null);
          if (data.gameState.turn !== yourColorRef.current) {
            const history = data.gameState.moveHistory;
            const lastMove = Array.isArray(history) && history.length > 0 ? history[history.length - 1] : null;
            if (lastMove) playMoveSound(lastMove);
          } else {
            const queued = premoveRef.current;
            if (queued) {
              setPremove(null);
              setTimeout(() => {
                executePremoveIfLegal(queued, data.gameState.board);
              }, 10);
            }
          }
        }
        break;
      case "move-rejected":
        // Roll the optimistic local move back to the server's authoritative
        // state (sent along with the rejection) and say so visibly.
        if (!acceptSeq(data)) break;
        applyClockFrom(data, receivedAt);
        if (data.gameState) applyGameState(data.gameState, { resetView: true });
        showInlineNotice(typeof data.reason === "string" && data.reason ? data.reason : "That move was rejected by the server.");
        playClickSound(quiet);
        break;
      case "chat-message":
        if (typeof data.from === "string" && typeof data.text === "string") {
          dispatchRoom({ type: "CHAT", message: { from: data.from, text: data.text, ts: typeof data.ts === "number" ? data.ts : undefined } });
        }
        break;
      case "game-ended":
        // Server is authoritative on every outcome (resign, draw, timeout,
        // forfeit): adopt its winnerColor/status; the recorder effect below
        // turns it into the result modal + stats.
        if (!acceptSeq(data)) break;
        dispatchRoom({ type: "GAME_ENDED", data, receivedAt });
        if (typeof data.statusMessage === "string") setStatusMessage(data.statusMessage);
        break;
      case "fairplay-warning":
        setFairPlayWarning({ strikes: data.strikes, maxStrikes: data.maxStrikes, message: data.message });
        setMyAwayStrikes(typeof data.strikes === "number" ? data.strikes : 0);
        playWarningAlertSound(quiet);
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          try { navigator.vibrate([250, 100, 250]); } catch {}
        }
        break;
      case "opponent-away":
        applyClockFrom(data, receivedAt);
        patchRoom({ opponentAway: { username: data.username, strikes: data.strikes, maxStrikes: data.maxStrikes } });
        break;
      case "opponent-back":
        applyClockFrom(data, receivedAt);
        patchRoom({ opponentAway: null });
        break;
      case "draw-offered":
        if (!acceptSeq(data)) break;
        applyClockFrom(data, receivedAt);
        patchRoom({ drawOfferReceived: data.from });
        playClickSound(quiet);
        break;
      case "draw-declined":
        applyClockFrom(data, receivedAt);
        patchRoom({ drawOfferSent: false });
        setStatusMessage(`${data.from} declined the draw offer.`);
        break;
      case "draw-cancelled":
        applyClockFrom(data, receivedAt);
        patchRoom({ drawOfferReceived: null, drawOfferSent: false });
        setStatusMessage(`${data.from} cancelled the draw offer.`);
        break;
      // Resign is a request the opponent must accept (handleResignResponse).
      case "resign-requested":
        if (!acceptSeq(data)) break;
        applyClockFrom(data, receivedAt);
        patchRoom({ resignOfferReceived: data.from });
        playClickSound(quiet);
        break;
      case "resign-declined":
        applyClockFrom(data, receivedAt);
        patchRoom({ resignOfferSent: false });
        setStatusMessage(`${data.from} declined the resignation -- game continues.`);
        break;
      case "resign-cancelled":
        applyClockFrom(data, receivedAt);
        patchRoom({ resignOfferReceived: null, resignOfferSent: false });
        setStatusMessage(`${data.from} cancelled the resignation offer.`);
        break;
      case "game-reset-by-opponent": {
        if (!acceptSeq(data)) break;
        const resetPlayers = Array.isArray(data.players) ? data.players : roomPlayers;
        dispatchRoom({
          type: "GAME_RESET",
          players: Array.isArray(data.players) ? data.players : undefined,
          username,
          yourColor: data.yourColor === "W" || data.yourColor === "B" ? data.yourColor : undefined,
        });
        const myResetColor: Color | null =
          data.yourColor === "W" || data.yourColor === "B" ? data.yourColor
          : (resetPlayers.find((p: any) => p && isSameUser(p.username, username))?.color ?? yourColor);
        if (!isSpectating && (myResetColor === "W" || myResetColor === "B")) {
          setIsFlipped(myResetColor === "B");
        }
        setBoard(createInitialBoard());
        setTurn("W");
        setMoveHistory([]);
        moveCountRef.current = 0;
        setGameOverInfo(null);
        setFairPlayWarning(null);
        setMyAwayStrikes(0);
        // game-reset returns the room to the LOBBY (colours swapped, fresh
        // series); nothing auto-starts -- both players press Ready again.
        setStatusMessage("Match reset — press Ready when you are ready to play again (colours swap).");
        break;
      }
      case "spectate-joined": {
        if (typeof data.roomId !== "string") break;
        lastSeqRef.current = { roomId: data.roomId, seq: typeof data.seq === "number" ? data.seq : 0 };
        lastGameStartedSeqRef.current = typeof data.seq === "number" ? data.seq : -1;
        // Fresh slate: series/wager/offers of any previous room are gone (M7).
        dispatchRoom({ type: "SPECTATE_JOINED", data, receivedAt });
        setIsFlipped(false);
        setGameOverInfo(null);
        applyGameState(data.gameState, { resetView: true });
        if (data.clockLimitType) setClockLimitType(data.clockLimitType);
        setPlayMode("Multiplayer");
        break;
      }
      case "live-rooms-list":
        setLiveRoomsList(Array.isArray(data.rooms) ? data.rooms : []);
        break;
      // --- Incoming voice & HD video chat signaling from the other player ---
      case "call-request":
      case "voice-call-request":
      case "call-accept":
      case "voice-call-accept":
      case "call-decline":
      case "voice-call-decline":
      case "call-cancel":
      case "voice-call-cancel":
      case "call-offer":
      case "voice-offer":
      case "call-answer":
      case "voice-answer":
      case "call-ice-candidate":
      case "voice-ice-candidate":
      case "call-renegotiate-request":
      case "voice-renegotiate-request":
      case "call-end":
      case "voice-leave":
      case "call-unavailable":
      case "call-toggle-video":
      case "call-toggle-audio":
      case "call-busy":
      case "voice-call-busy":
      case "call-screen-share": {
        handleSignalingMessageRef.current?.(data);
        break;
      }
      case "opponent-disconnected":
        // The game isn't over: the other side has a grace period (their
        // remaining clock, or 10 minutes untimed) to come back. Keep the
        // board up; the server pauses the clock and tells us via `clock`.
        applyClockFrom(data, receivedAt);
        patchRoom({ opponentConnected: false });
        if (typeof data.message === "string") {
          setStatusMessage(data.message);
        } else {
          const who = typeof data.username === "string" ? data.username : "Your opponent";
          const grace = typeof data.graceMs === "number" ? ` They have ${Math.max(1, Math.round(data.graceMs / 60000))} min to return.` : "";
          setStatusMessage(`${who} disconnected — clock paused.${grace}`);
        }
        break;
      case "opponent-reconnected":
        applyClockFrom(data, receivedAt);
        patchRoom({ opponentConnected: true });
        if (typeof data.message === "string") setStatusMessage(data.message);
        break;
      case "room-rejoined": {
        // Full state restoration for the RECONNECTING player's own client
        // (contract section 6): same path as room-info + clock, then resume.
        if (typeof data.roomId !== "string") break;
        lastSeqRef.current = { roomId: data.roomId, seq: typeof data.seq === "number" ? data.seq : 0 };
        lastGameStartedSeqRef.current = typeof data.seq === "number" ? data.seq : -1;
        if (pendingReplayTimerRef.current) {
          clearTimeout(pendingReplayTimerRef.current);
          pendingReplayTimerRef.current = null;
        }
        setPendingJoinRoom(null);
        setPendingHostMatch(false);
        setSessionNotice(null);
        dispatchRoom({ type: "ROOM_INFO", data, username, receivedAt, rejoin: true });
        if (data.yourColor === "W" || data.yourColor === "B") setIsFlipped(data.yourColor === "B");
        if (data.clockLimitType) setClockLimitType(data.clockLimitType);
        if (data.gameState) {
          applyGameState(data.gameState, { resetView: true });
          setStatusMessage("Reconnected! " + (data.gameState.statusMessage || ""));
        }
        const phase = data.phase as RoomPhase | undefined;
        const live = phase === "playing" || phase === "setup" || (!phase && data.started !== false);
        if (live) {
          setGameRecorded(false);
          setGameOverInfo(null);
        }
        // The player still holds a seat in this room (lobby, live or just
        // ended), so a refresh/reconnect always lands them back in it.
        setPlayMode("Multiplayer");
        break;
      }
      case "left-room-success":
        // Wherever the player is stays as is: the Multiplayer screen simply
        // shows the lobby again; an AI game in progress is left alone (M5).
        resetRoomState();
        break;
      // --- Rematch (contract section 8; legacy names kept for older servers) ---
      case "rematch-requested":
      case "rematch-offered": {
        const from = typeof data.from === "string" ? data.from : data.fromUsername;
        dispatchRoom({ type: "REMATCH", rematch: { status: "requested", fromUsername: from } });
        setStatusMessage(`${from || "Your opponent"} wants a rematch!`);
        playClickSound(quiet);
        break;
      }
      case "rematch-waiting":
        dispatchRoom({ type: "REMATCH", rematch: { status: "waiting", fromUsername: data.from ?? data.fromUsername } });
        break;
      case "rematch-declined":
        dispatchRoom({ type: "REMATCH", rematch: { status: "declined", fromUsername: data.from ?? data.fromUsername } });
        setStatusMessage(`${data.from ?? data.fromUsername ?? "Your opponent"} declined the rematch.`);
        break;
      case "rematch-cancelled":
        dispatchRoom({ type: "REMATCH", rematch: { status: "idle" } });
        setStatusMessage("Rematch offer withdrawn.");
        break;
      case "rematch-accepted":
        dispatchRoom({ type: "REMATCH", rematch: { status: "accepted", newGameCode: typeof data.newGameCode === "string" ? data.newGameCode : undefined } });
        if (typeof data.previousGameCode === "string") patchRoom({ previousGameCode: data.previousGameCode });
        if (!isSpectating && (data.yourColor === "W" || data.yourColor === "B")) {
          setIsFlipped(data.yourColor === "B");
        }
        break;
      default:
        break;
    }
  };

  const handleSocketEvent = (ev: GameSocketEvent) => {
    switch (ev.kind) {
      case "status":
        setConnectionStatus(ev.status);
        setWs(ev.socket);
        if (ev.status === "connected") {
          setReconnectAttempts(0);
        } else if (typeof ev.attempts === "number") {
          setReconnectAttempts(ev.attempts);
        }
        break;
      case "message":
        try {
          handleSocketMessage(ev.data);
        } catch (err) {
          console.error("[WS] Error handling message:", err);
        }
        break;
      case "send-refused":
        // A game action while the link is down is never silently dropped
        // (audit H2): tell the player and let the reconnect loop run.
        showInlineNotice(
          ev.reason === "stopped"
            ? "Not connected — tap Retry in the banner to reconnect."
            : "Not connected — that action was not sent. Reconnecting…"
        );
        break;
      case "offset":
        dispatchRoom({ type: "OFFSET", offset: ev.offset });
        break;
      case "ping":
        if (typeof ev.ping === "number") {
          setPingMs(ev.ping);
        }
        break;
      case "session-replaced":
        // The message form of this event is handled in handleSocketMessage.
        break;
      default:
        break;
    }
  };

  // Always the handler from the LATEST render (fresh state, no stale closures).
  const socketEventRef = useRef<(ev: GameSocketEvent) => void>(() => {});
  useEffect(() => {
    socketEventRef.current = handleSocketEvent;
  });

  // Subscribe exactly once for the lifetime of the app.
  useEffect(() => {
    const unsubscribe = gameSocket.subscribe((ev) => socketEventRef.current(ev));
    return () => {
      unsubscribe();
      if (pendingReplayTimerRef.current) clearTimeout(pendingReplayTimerRef.current);
    };
  }, []);

  // The connection follows the signed-in username ONLY (audit H1).
  const prevUsernameRef = useRef<string | null>(username);
  useEffect(() => {
    if (prevUsernameRef.current && prevUsernameRef.current !== username) {
      resetRoomState();
    }
    prevUsernameRef.current = username;
    setSessionNotice(null);
    if (!username) {
      gameSocket.disconnect();
      return;
    }
    gameSocket.connect(username);
  }, [username, resetRoomState]);

  const isEditorMode = playMode === "Editor";

  // Legal moves for the current board/turn -- memoized: this used to run the
  // full generator on EVERY render, including the per-second clock ticks (M8).
  const legalMoves = useMemo(() => generateLegalMoves(board, turn), [board, turn]);

  // Mandatory capture squares: glowing halo so player always knows which pieces must jump
  const obligatoryCaptureSquares = useMemo(() => {
    if (playMode === "Editor" || isEditorMode) return new Set<number>();
    const captures = legalMoves.filter((m) => m && Array.isArray(m.caps) && m.caps.length > 0);
    if (captures.length === 0) return new Set<number>();
    return new Set<number>(captures.map((m) => m.from));
  }, [legalMoves, playMode, isEditorMode]);

  // Any change of selection, side to move or position invalidates a
  // half-walked capture path.
  useEffect(() => { setCaptureWalk([]); }, [selectedSq, turn, moveHistory.length, activePuzzleId, playMode]);

  // Stats calculation
  const getPieceCounts = () => {
    let whitePieces = 0;
    let whiteKings = 0;
    let blackPieces = 0;
    let blackKings = 0;

    for (let sq = 1; sq <= 50; sq++) {
      const pc = board[sq];
      if (pc === "w") whitePieces++;
      if (pc === "W") {
        whitePieces++;
        whiteKings++;
      }
      if (pc === "b") blackPieces++;
      if (pc === "B") {
        blackPieces++;
        blackKings++;
      }
    }
    return { whitePieces, whiteKings, blackPieces, blackKings };
  };

  const stats = getPieceCounts();

  // --- Clocks ---
  // Multiplayer: the server's ClockState snapshot (room.clock, contract §4).
  // Local timed games: our own snapshot, advanced per MOVE in executeMove.
  // Neither is ticked here -- the clock components tick themselves, so App
  // never re-renders per second (audit C1/C2/M4/M8).
  const clockSnapshot: ClockSnapshot | null = playMode === "Multiplayer" ? room.clock : localClock;

  // Local flag: a single timeout at the running side's deadline. Multiplayer
  // flags come ONLY from the server's game-ended { reason: "timeout" }; the
  // display just sits at 0:00 until that arrives.
  const handleLocalFlag = useCallback((color: Color) => {
    setLocalClock((prev) => (prev ? flagLocalClock(prev, color) : prev));
    const loser = color === "W" ? "White" : "Black";
    const winner = color === "W" ? "Black" : "White";
    setStatusMessage(`${loser} flagged! ${winner} wins on time. ⏰`);
  }, []);
  const localClockArmed = playMode !== "Multiplayer" && !isEditorMode && !activePuzzleId && !gameOverInfo;
  useClockDeadline(localClockArmed ? localClock : null, localClockArmed ? handleLocalFlag : null);

  // A finished local game stops its clock where it is.
  useEffect(() => {
    if (!gameOverInfo || playMode === "Multiplayer") return;
    setLocalClock((prev) => (prev && prev.clock.running ? freezeClock(prev) : prev));
  }, [gameOverInfo, playMode]);

  // Get active rendering board (current play vs historical review state)
  const renderBoard = (() => {
    if (historyViewIndex !== null) {
      let tempBoard = { ...initialPositionRef.current.board };
      for (let i = 0; i <= historyViewIndex; i++) {
        tempBoard = applyMove(tempBoard, moveHistory[i]).board;
      }
      return tempBoard;
    }
    return board;
  })();

  const turnAfterMoves = (count: number): "W" | "B" => count % 2 === 0 ? initialPositionRef.current.turn : (initialPositionRef.current.turn === "W" ? "B" : "W");
  const activeTurn = historyViewIndex !== null ? turnAfterMoves(historyViewIndex + 1) : turn;

  // --- Real-time debounced calculation of position analysis ---
  useEffect(() => {
    // Live engine evaluation belongs to the Analysis board ONLY -- a game
    // against the AI (or anywhere else in the app) is a plain game with no
    // engine assistance running underneath it.
    const isAnalysisActive = playMode === "Analysis" || playMode === "Training";
    if (!isAnalysisActive || isThinking) return;

    const debounceCalc = setTimeout(async () => {
      setEngineEval((prev) => ({ ...prev, isThinking: true }));
      try {
        // High-performance analysis with automatic fallback
        const data = await analyzeKen(renderBoard, activeTurn, 800, "live-eval");
        setEngineEval({
          score: data.score || 0,
          depth: data.depth || 0,
          pv: data.pv || "",
          isThinking: false
        });
      } catch (err: any) {
        // If superseded by a newer position, don't clear the thinking indicator
        if (err instanceof SupersededError || err?.name === "SupersededError") {
          return;
        }
        setEngineEval((prev) => ({ ...prev, isThinking: false }));
      }
    }, 200);

    return () => clearTimeout(debounceCalc);
  }, [renderBoard, activeTurn, playMode, isThinking]);

  // Handle computer move trigger
  useEffect(() => {
    if (isThinking || isEditorMode || activePuzzleId || playMode === "Multiplayer") return;

    // Check game terminal states -- single source of truth for every rule
    // (no legal moves, threefold repetition, 25-move king rule, 16/5-move
    // material-insufficiency rules), shared with the server's authoritative
    // PvP check (see server.ts's make-move handler).
    const endResult = checkGameEnd(moveHistory, initialPositionRef.current.board, initialPositionRef.current.turn);
    if (endResult.isOver) {
      if (endResult.isDraw) {
        setStatusMessage(`Game Draw! ${endResult.reason}. 🤝`);
      } else {
        const winnerName = endResult.winner === "W" ? "White" : "Black";
        setStatusMessage(`Game Over! ${winnerName} wins (${endResult.reason}). 🏆`);
      }
      return;
    }

    // AI Moves dispatcher
    const isNewTournamentAiTurn = 
      playMode === "Tournament" && 
      activeTournamentMatchId && 
      isTournamentGameInProgress && 
      turn !== yourColor;

    const shouldWhiteAiPlay = 
      ((playMode === "AI_vs_Human" || playMode === "AI_vs_AI") && turn === "W") ||
      (playMode === "Tournament" && isTournamentActive && isTournamentGameInProgress && (tournamentRound === 2 || tournamentRound === 4) && turn === "W") ||
      (isNewTournamentAiTurn && turn === "W");

    const shouldBlackAiPlay = 
      ((playMode === "Human_vs_AI" || playMode === "AI_vs_AI") && turn === "B") ||
      (playMode === "Tournament" && isTournamentActive && isTournamentGameInProgress && (tournamentRound === 1 || tournamentRound === 3) && turn === "B") ||
      (isNewTournamentAiTurn && turn === "B");

    const shouldAnalysisAiPlay = 
      ((playMode === "Analysis" || playMode === "Training") && analysisPlayVsAI && turn !== analysisPlayerColor && historyViewIndex === null);

    if ((shouldWhiteAiPlay || shouldBlackAiPlay || shouldAnalysisAiPlay) && !isThinking) {
      const timer = setTimeout(() => {
        triggerAiMove();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [turn, isThinking, playMode, legalMoves, board, activePuzzleId, isTournamentActive, isTournamentGameInProgress, tournamentRound, analysisPlayVsAI, analysisPlayerColor, historyViewIndex, activeTournamentMatchId, yourColor]);

  const getTournamentKenLevelId = (round: number): number => {
    if (round === 1) return 1;
    if (round === 2) return 3;
    if (round === 3) return 5;
    return 8;
  };

  const getTournamentOpponentLevel = (opponentName: string | null): number => {
    if (!opponentName) return 3;
    const name = opponentName.toLowerCase();
    if (name === "ken 5" || name.includes("ken 5")) return 5;
    if (name.includes("kentro") || name.includes("bashir")) return 8;
    if (name.includes("flying") || name.includes("emeka")) return 6;
    if (name.includes("delay") || name.includes("yakubu")) return 5;
    if (name.includes("golden") || name.includes("nduka")) return 4;
    return 3;
  };

  // Ken runs entirely on the server's native engine. No on-device fallback
  // exists, so a failed request means the player simply needs a connection.
  const reportEngineUnavailable = () => {
    setStatusMessage("Ken engine is analyzing position...");
  };


  const triggerAiMove = async () => {
    if (isThinking) return;
    const generation = aiRequestGenerationRef.current;
    setIsThinking(true);
    setStatusMessage("Ken is thinking...");
    let currentKenLevelId = kenLevelId;
    try {
      if (playMode === "Tournament") {
        if (activeTournamentMatchId && activeTournamentOpponent) {
          currentKenLevelId = getTournamentOpponentLevel(activeTournamentOpponent);
        } else {
          currentKenLevelId = getTournamentKenLevelId(tournamentRound);
        }
      } else if ((playMode === "Analysis" || playMode === "Training") && analysisPlayVsAI) {
        currentKenLevelId = analysisAILevel;
      }
      const data = await getKenMove(board, turn, currentKenLevelId);
      // Navigation or a fresh game invalidates the position this request used.
      if (generation !== aiRequestGenerationRef.current) return;
      if (data && data.move) {
        const currentLegals = generateLegalMoves(board, turn);
        let matchedMove = currentLegals.find((m) => movesAreEquivalent(m, data.move));
        if (!matchedMove && data.move) {
          const moveFrom = data.move.from;
          const moveTo = data.move.to;
          matchedMove = currentLegals.find((m) => m && m.from === moveFrom && m.to === moveTo);
        }
        if (!matchedMove && data.move) {
          const pieceAtFrom = board[data.move.from];
          if (pieceAtFrom && getCol(pieceAtFrom) === turn) {
            matchedMove = data.move as Move;
          }
        }
        if (matchedMove) {
          executeMove(matchedMove);
        } else {
          console.error("C++ engine returned move not matching legal moves:", data.move);
          setStatusMessage("C++ Engine: move could not be validated against legal moves.");
        }
      } else {
        console.error("C++ engine returned no move");
        setStatusMessage("C++ Engine: no move returned.");
      }
    } catch (e: any) {
      if (generation !== aiRequestGenerationRef.current) return;
      console.error("C++ engine move execution error:", e);
      setStatusMessage(`C++ Engine error: ${e?.message || "Engine unavailable"}`);
    } finally {
      if (generation === aiRequestGenerationRef.current) setIsThinking(false);
    }
  };


  const executePremoveIfLegal = (queued: { from: number; to?: number }, freshBoard?: Board | null) => {
    const currentBoard = freshBoard || board;
    const currentTurn = yourColorRef.current;
    if (!currentTurn) return;
    const legalList = generateLegalMoves(currentBoard, currentTurn);

    if (queued.to !== undefined) {
      const matched = legalList.find((m) => m && m.from === queued.from && m.to === queued.to);
      if (matched) {
        executeMove(matched);
        return;
      }
    }

    const piece = currentBoard[queued.from];
    const isMine = piece && (
      (currentTurn === "W" && (piece === "w" || piece === "W")) ||
      (currentTurn === "B" && (piece === "b" || piece === "B"))
    );
    if (isMine) {
      const pieceLegals = legalList.filter((m) => m && m.from === queued.from);
      if (pieceLegals.length > 0) {
        setSelectedSq(queued.from);
        setCaptureWalk([]);
        playClickSound(muted);
        setStatusMessage("Piece ready — tap landing square to move!");
      }
    }
  };

  const executeMove = (mv: Move) => {
    setPremove(null);
    if (playMode === "Multiplayer") {
      // The server validates the move and owns the clocks: ship the move
      // alone (times we sent would be ignored, contract §4). If the manager
      // refuses because the link is down, do NOT apply it locally -- a move
      // that never reached the server must not appear on the board (H2).
      if (!gameSocket.send({ type: "make-move", move: mv })) return;
      moveCountRef.current = moveHistory.length + 1;
    } else if (localClock && !activePuzzleId && !isEditorMode) {
      // Local timed game: the snapshot advances per move, never per second.
      setLocalClock((prev) => (prev ? advanceLocalClock(prev, turn) : prev));
    }

    const isCapture = mv.caps.length > 0;
    if (isCapture) {
      playCaptureSound(muted);
      
      // Store captured piece details to trigger the 300ms shrink & fade out animation
      const newAnims = mv.caps.map((sq) => {
        const piece = board[sq];
        return piece ? { sq, piece, id: `${sq}-${Date.now()}-${Math.random()}` } : null;
      }).filter((anim) => anim !== null);

      if (newAnims.length > 0) {
        setCapturedAnimations((prev) => [...prev, ...newAnims]);
        setTimeout(() => {
          setCapturedAnimations((prev) =>
            prev.filter((anim) => !newAnims.some((na) => na.id === anim.id))
          );
        }, 300);
      }
    } else {
      playClickSound(muted);
    }

    const { board: newBoard, promoted } = applyMove(board, mv);

    if (promoted) {
      playPromoSound(muted);
      const playerColor = turn === "W" ? "White" : "Black";
      setPromotedToast(`${playerColor} promoted to King! 👑`);
      setTimeout(() => setPromotedToast(null), 3500);
    }

    setBoard(newBoard);
    setMoveHistory((prev) => [...prev, mv]);
    setSelectedSq(null);
    setHistoryViewIndex(null); // Return to active live play on new moves

    const nextTurn = turn === "W" ? "B" : "W";
    setTurn(nextTurn);
    setStatusMessage(`${nextTurn === "W" ? "White" : "Black"} to play`);
  };

  // User click on checkers squares
  const handleSquareClick = (sq: number) => {
    if (isEditorMode) {
      handleEditorSquareClick(sq);
      return;
    }
    if (isThinking || historyViewIndex !== null || isSpectating) return;

    if (playMode === "Multiplayer") {
      if (serverGameEnd || roomPhase === "ended") {
        setStatusMessage("This game is over.");
        return;
      }
      // While a draw/resign offer is pending the server refuses moves
      // (`error busy`) and the clock is paused -- don't even try.
      if (drawOfferSent || drawOfferReceived || resignOfferSent || resignOfferReceived) {
        setStatusMessage("Clock paused — respond to the pending offer (or cancel yours) first.");
        return;
      }
      // Intercept clicks during setupPhase of Crown Crown mode -- two steps:
      // first tap one of your own front-row pieces (removes it), then tap
      // an empty square on your own back row (places it there as a King).
      if (setupPhase && username && setupPhase[username] && !setupPhase[username].kingSelected) {
        const myStep = setupPhase[username];
        if (myStep.pendingKingPlacement) {
          // Step 2: ANY square on your own back row works. If one of your
          // men is already standing there (the usual case -- the back row
          // starts full), the server slides him forward into the front-row
          // gap your removed piece left, keeping all 20 pieces in play.
          const myBackRow = yourColor === "W" ? [46, 47, 48, 49, 50] : [1, 2, 3, 4, 5];
          if (myBackRow.includes(sq)) {
            const occ = board[sq];
            const occIsMyMan = occ === (yourColor === "W" ? "w" : "b");
            if (!occ || occIsMyMan) {
              if (gameSocket.send({ type: "place-starting-king", sq })) playClickSound(muted);
            }
            return;
          }
          // A non-back-row tap falls through: tapping a different front-row
          // piece re-picks which one to sacrifice.
        }
        const pc = board[sq];
        const matchesColor = pc && (
          (yourColor === "W" && (pc === "w" || pc === "W")) ||
          (yourColor === "B" && (pc === "b" || pc === "B"))
        );
        if (matchesColor) {
          if (gameSocket.send({ type: "remove-front-row-piece", sq })) playClickSound(muted);
        }
        return;
      }

      if (!multiplayerStarted) {
        setStatusMessage("Waiting for both players to be READY to start the match!");
        return;
      }

      // Block moving normal pieces if Crown Crown Setup is active for opponent
      if (setupPhase) {
        setStatusMessage("Crown Crown Phase: Waiting for opponent to select their starting King.");
        return;
      }

      if (turn !== yourColor) {
        const pc = board[sq];
        const isMyPiece = pc && (
          (yourColor === "W" && (pc === "w" || pc === "W")) ||
          (yourColor === "B" && (pc === "b" || pc === "B"))
        );

        if (isMyPiece) {
          if (premove?.from === sq && !premove?.to) {
            setPremove(null);
            playClickSound(muted);
            setStatusMessage("Pre-move cancelled.");
          } else {
            setPremove({ from: sq });
            playClickSound(muted);
            setStatusMessage("Piece queued ⚡ Tap a landing square to pre-move (or it will select on your turn).");
          }
          return;
        }

        if (premove && typeof premove.from === "number") {
          if (premove.from === sq) {
            setPremove(null);
            setStatusMessage("Pre-move cancelled.");
            return;
          }
          setPremove({ from: premove.from, to: sq });
          playClickSound(muted);
          setStatusMessage("Pre-move queued ⚡ Will execute instantly on your turn! (tap to cancel)");
          return;
        }

        setStatusMessage("Opponent's turn — tap one of your pieces to queue a pre-move ⚡");
        return;
      }
    }

    if (activePuzzleId) {
      // Puzzle mode tap interactions
      handlePuzzleSquareClick(sq);
      return;
    }

    const pc = board[sq];
    const isPlayerPiece = pc && (
      (turn === "W" && (pc === "w" || pc === "W")) ||
      (turn === "B" && (pc === "b" || pc === "B"))
    );

    if (isPlayerPiece) {
      const hasCapturesOnBoard = legalMoves.some((m) => m.caps.length > 0);
      const pieceMoves = legalMoves.filter((m) => m.from === sq);
      
      if (hasCapturesOnBoard && pieceMoves.length === 0) {
        setStatusMessage("Capture Obligatory: Select one of the glowing pieces!");
        return;
      }

      setSelectedSq(sq);
      setCaptureWalk([]);
      playClickSound(muted);
      return;
    }

    if (selectedSq !== null) {
      const candidates = legalMoves.filter((m) => m.from === selectedSq);
      const res = resolveCaptureClick(candidates, captureWalk, sq);
      if (res.kind === "apply") {
        executeMove(res.move);
      } else if (res.kind === "extend") {
        // Walking a multi-jump one landing at a time -- keep the piece
        // selected and light up the next hops.
        setCaptureWalk(res.walked);
        playClickSound(muted);
        setStatusMessage("Keep jumping — tap the next landing square!");
      } else {
        setSelectedSq(null);
      }
    }
  };

  // New-format puzzles store the whole line (solver + defender replies).
  const puzzleUsesFullLine = puzzleSolution.some((s) => s.role === "solver" || s.role === "reply");

  // Finds the actual legal move for a recorded puzzle step. Prefers an
  // exact capture-path match when the step carries `caps` (two legal moves
  // can share from/to but capture different pieces in draughts).
  const matchPuzzleStepMove = (b: Board, mover: "W" | "B", step: { from: number; to: number; caps?: number[] }): Move | null => {
    const candidates = generateLegalMoves(b, mover).filter((m) => m.from === step.from && m.to === step.to);
    if (candidates.length === 0) return null;
    if (step.caps && step.caps.length > 0) {
      const wanted = [...step.caps].sort().join(",");
      const exact = candidates.find((m) => [...m.caps].sort().join(",") === wanted);
      if (exact) return exact;
    }
    return candidates[0];
  };

  // Puzzle step handler -- the player's taps. In full-line puzzles the
  // player only ever plays the SOLVER steps; the defender's recorded
  // replies are auto-played by the effect below, with the turn flipping
  // after every move exactly as the rules require.
  const handlePuzzleSquareClick = (sq: number) => {
    const step = puzzleSolution[puzzleStepIndex];
    if (!step) return;
    if (puzzleUsesFullLine && step.role === "reply") return; // opponent is "moving" -- wait

    const pc = board[sq];
    if (pc && pc.toUpperCase() === turn) {
      setSelectedSq(sq);
      setCaptureWalk([]);
      playClickSound(muted);
      return;
    }

    if (selectedSq !== null) {
      // Resolve the tap the same way the main game does: one tap on the
      // final square OR walking a multi-jump landing-by-landing.
      const candidates = generateLegalMoves(board, turn).filter((m) => m.from === selectedSq);
      const res = resolveCaptureClick(candidates, captureWalk, sq);

      if (res.kind === "extend") {
        setCaptureWalk(res.walked);
        playClickSound(muted);
        setStatusMessage("Keep jumping — tap the next landing square!");
        return;
      }

      if (res.kind === "apply") {
        const played = res.move;
        const capsMatch =
          !step.caps || step.caps.length === 0 ||
          [...step.caps].sort().join(",") === [...played.caps].sort().join(",");
        const isExpected = played.from === step.from && played.to === step.to && capsMatch;

        if (isExpected) {
          const { board: nextB, promoted } = applyMove(board, played);
          setBoard(nextB);

          if (played.caps.length > 0) playCaptureSound(muted);
          else if (promoted) playPromoSound(muted);
          else playClickSound(muted);

          const nextIndex = puzzleStepIndex + 1;
          setPuzzleStepIndex(nextIndex);
          setPuzzleError(null);
          setSelectedSq(null);
          setCaptureWalk([]);
          if (puzzleUsesFullLine) setTurn((t) => (t === "W" ? "B" : "W"));

          // Full-rules game-over check: if this move leaves the opponent
          // with NO legal reply (captured out or completely blocked), the
          // game is won right here -- the puzzle is complete even if the
          // stored line had more steps (older data), because the rules
          // don't allow play past a win.
          const opponentColor: "W" | "B" = turn === "W" ? "B" : "W";
          const opponentStuck = puzzleUsesFullLine && generateLegalMoves(nextB, opponentColor).length === 0;

          if (nextIndex >= puzzleSolution.length || opponentStuck) {
            setPuzzleCompleted(true);
            playPromoSound(muted);
            setStatusMessage(opponentStuck
              ? "Trap sprung — your opponent has no legal reply! Puzzle solved! 👑"
              : "Correct! Puzzle fully solved! 👑");
          } else if (puzzleUsesFullLine && puzzleSolution[nextIndex]?.role === "reply") {
            setStatusMessage("Great move! Opponent is replying...");
          } else {
            setStatusMessage("Great move! Finding next step...");
          }
          return;
        }
        // A legal move, but not the puzzle's move.
        setPuzzleError("Not quite. Analyze the diagonals carefully!");
        playCaptureSound(muted);
        setSelectedSq(null);
        setCaptureWalk([]);
        return;
      }

      // Not a legal destination at all.
      setPuzzleError("Not quite. Analyze the diagonals carefully!");
      playCaptureSound(muted);
      setSelectedSq(null);
      setCaptureWalk([]);
    }
  };

  // Auto-plays the DEFENDER's recorded reply in full-line puzzles: after
  // the solver's correct move, the opponent's answer appears on the board
  // (legal-move verified) and the turn passes back to the solver.
  useEffect(() => {
    if (!activePuzzleId || puzzleCompleted || !puzzleUsesFullLine) return;
    const step = puzzleSolution[puzzleStepIndex];
    if (!step || step.role !== "reply") return;

    // Rules guard for old/corrupt data: a "reply" for a side with no legal
    // moves is impossible in a real game -- the puzzle was already won.
    if (generateLegalMoves(board, turn).length === 0) {
      setPuzzleCompleted(true);
      setStatusMessage("Trap sprung — your opponent has no legal reply! Puzzle solved! 👑");
      return;
    }

    const timer = setTimeout(() => {
      setBoard((prevBoard) => {
        const replyMove = matchPuzzleStepMove(prevBoard, turn, step)
          ?? { from: step.from, to: step.to, caps: step.caps ?? [] };
        const { board: nextB } = applyMove(prevBoard, replyMove);
        if (replyMove.caps.length > 0) playCaptureSound(muted);
        else playClickSound(muted);
        return nextB;
      });
      setTurn((t) => (t === "W" ? "B" : "W"));
      setPuzzleStepIndex((idx) => {
        const nextIdx = idx + 1;
        if (nextIdx >= puzzleSolution.length) {
          // Defensive: a line should never END on a defender reply, but if
          // stored data does, treat the puzzle as solved rather than stuck.
          setPuzzleCompleted(true);
          setStatusMessage("Correct! Puzzle fully solved! 👑");
        } else {
          setStatusMessage("Your move -- find the next step!");
        }
        return nextIdx;
      });
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePuzzleId, puzzleStepIndex, puzzleCompleted, puzzleUsesFullLine]);

  // Suggest Hint Move from C++ Engine
  const handleSuggestMove = async () => {
    if (playMode === "Multiplayer" || playMode === "Tournament") {
      setStatusMessage("Hints are disabled in Multiplayer/Tournament games!");
      return;
    }
    if (isThinking) return;
    setUsedHintsOrUndo(true);
    setIsThinking(true);
    setStatusMessage("Calculating best suggestion...");
    try {
      // Hints always use full-strength on-device analysis: a hint from a
      // node-capped, handicapped Ken 1 would be worse than no hint at all.
      const data = await analyzeKen(board, turn, 900);
      if (data && data.move && typeof data.move.from === "number") {
        setSelectedSq(data.move.from);
        setStatusMessage(`Hint: Move piece from square ${data.move.from}!`);
        playPromoSound(muted);
      } else {
        throw new Error("Empty move received");
      }
    } catch (e) {
      console.error("Engine hint failure:", e);
      setStatusMessage(
        e instanceof EngineUnavailableError
          ? "Unable to generate hint at this time."
          : "Failed to get suggestion."
      );
    } finally {
      setIsThinking(false);
    }
  };

  const handleApplyOpeningHint = (moveStr: string) => {
    // Parse opening hint string (e.g. "32-28" or "18x23") and trigger it on board
    const parts = moveStr.split(/[x\-]/);
    const from = parseInt(parts[0], 10);
    const to = parseInt(parts[1], 10);

    const matched = legalMoves.find((m) => m.from === from && m.to === to);
    if (matched) {
      executeMove(matched);
    } else {
      setStatusMessage(`Selected opening line (${moveStr}) is not legal from here.`);
    }
  };

  // Start new standard match
  const handleNewGame = (customStartBoard?: Board, customStartTurn?: "W" | "B", countGuestAi = true) => {
    if (guestAiStartReservedRef.current) guestAiStartReservedRef.current = false;
    else if (countGuestAi && guestMode && AI_MODES.includes(playMode) && !takeGuestAiTrial()) return;
    aiRequestGenerationRef.current += 1;
    setIsThinking(false);
    setGameOverInfo(null);
    if (playMode === "Multiplayer" && roomId !== null) {
      // Contract §3: game-reset is only allowed once the game has ENDED.
      // Mid-game the server answers `game-in-progress`; offer Resign instead.
      const playing = roomPhase === "playing" || roomPhase === "setup" || (multiplayerStarted && !serverGameEnd);
      if (playing) {
        showInlineNotice("A game is in progress — use Resign to end it first.", 5000);
        return;
      }
      dispatchRoom({ type: "OFFER_RESET" });
      gameSocket.send({ type: "game-reset" });
      return;
    }
    if (playMode === "Tournament") {
      setIsTournamentGameInProgress(false);
      safeStorage.setItem("lidraughts_tournament_game_in_progress", "false");
      setStatusMessage("Returned to Tournament Hub.");
      return;
    }
    if (countGuestAi && AI_MODES.includes(playMode)) safeStorage.removeItem(AI_GAME_STORAGE_KEY);
    setBoard(customStartBoard || createInitialBoard());
    initialPositionRef.current = { board: { ...(customStartBoard || createInitialBoard()) }, turn: customStartTurn || "W" };
    setTurn(customStartTurn || "W");
    setMoveHistory([]);
    setSelectedSq(null);
    setHistoryViewIndex(null);
    setMoveEvaluations({});
    setActivePuzzleId(null);
    setStatusMessage(customStartBoard ? `Custom position loaded. ${(customStartTurn || "W") === "W" ? "White" : "Black"} to play.` : "New Game started. White to play.");
    setGameStartTime(Date.now());
    setGameRecorded(false);
    setUsedHintsOrUndo(false);
    startLocalClock(clockLimitType, customStartTurn || "W");
    playGameStartSound(muted);
  };

  // Undo Move
  const handleUndo = () => {
    if (playMode === "Multiplayer" || playMode === "Tournament") {
      setStatusMessage("Undo is disabled in Multiplayer/Tournament games!");
      return;
    }
    if (moveHistory.length === 0 || isThinking) return;
    setUsedHintsOrUndo(true);

    let undoCount = 1;
    if (playMode === "Human_vs_AI" || playMode === "AI_vs_Human" || ((playMode === "Analysis" || playMode === "Training") && analysisPlayVsAI)) {
      undoCount = 2;
    }

    const newHistory = moveHistory.slice(0, Math.max(0, moveHistory.length - undoCount));
    
    let tempBoard = { ...initialPositionRef.current.board };
    newHistory.forEach((mv) => {
      tempBoard = applyMove(tempBoard, mv).board;
    });

    setBoard(tempBoard);
    setMoveHistory(newHistory);
    setSelectedSq(null);
    setHistoryViewIndex(null);
    setLastAnalysisEval(null);
    
    const finalTurn = turnAfterMoves(newHistory.length);
    setTurn(finalTurn);
    setStatusMessage(`${finalTurn === "W" ? "White" : "Black"} to play`);
    playClickSound(muted);
  };

  // --- Post-game modal actions ---
  // Multiplayer rematch is a REQUEST the opponent must accept (contract §8):
  // rematch-request -> rematch-requested (opponent) -> rematch-response
  // {accept} -> room-info + game-started (accepted) or rematch-declined.
  const handlePostGameRematch = () => {
    if (playMode === "Multiplayer" && roomId !== null) {
      if (isSpectating) return;
      if (gameSocket.send({ type: "rematch-request" })) {
        dispatchRoom({ type: "REMATCH", rematch: { status: "waiting", fromUsername: username ?? undefined } });
        setStatusMessage("Rematch offered -- waiting for your opponent.");
      }
      return;
    }
    setGameOverInfo(null);
    handleNewGame();
  };

  const handleCancelRematch = () => {
    if (gameSocket.send({ type: "rematch-cancel" })) {
      dispatchRoom({ type: "REMATCH", rematch: { status: "idle" } });
      setStatusMessage("Rematch offer withdrawn.");
    }
  };

  const handleRematchResponse = (accept: boolean) => {
    if (!gameSocket.send({ type: "rematch-response", accept })) return;
    dispatchRoom({ type: "REMATCH", rematch: accept ? { status: "accepted" } : { status: "idle" } });
    if (!accept) setStatusMessage("Rematch declined.");
  };

  /**
   * Contract §7: an explicit leave during play forfeits the game (and the
   * whole series) -- always confirm first. Spectators just stop watching.
   * Returns false when the player changed their mind.
   */
  const leaveRoomWithConfirm = (): boolean => {
    if (roomId === null) return true;
    if (isSpectating) {
      gameSocket.send({ type: "leave-spectate" });
      return true;
    }
    const seriesLive = !!seriesInfo && seriesInfo.bestOf > 1 && !seriesInfo.seriesOver;
    const playing = roomPhase === "playing" || roomPhase === "setup" || (multiplayerStarted && !serverGameEnd);
    if (playing || seriesLive) {
      const msg = playing
        ? (seriesLive
            ? "You will forfeit this game AND the rest of the series. Leave anyway?"
            : "You will forfeit this game. Leave anyway?")
        : "Leaving now forfeits the rest of the series. Leave anyway?";
      if (!window.confirm(msg)) return false;
    }
    gameSocket.send({ type: "leave-room" });
    return true;
  };

  /** "Exit Room" from the room panel. */
  const handleLeaveRoom = () => {
    if (!leaveRoomWithConfirm()) return;
    if (isSpectating) {
      resetRoomState();
      setBoard(createInitialBoard());
      setMoveHistory([]);
      setPlayMode("Home");
    }
  };

  const handlePostGameBackToLobby = () => {
    if (playMode === "Multiplayer" && roomId !== null) {
      if (!leaveRoomWithConfirm()) return;
    }
    setGameOverInfo(null);
    handleModeChange("Home", true); // already confirmed and sent leave-room
  };

  /** Best-of-N: close the result modal and let the next game auto-start (M2). */
  const handleWaitForNextGame = () => {
    setGameOverInfo(null);
  };

  const currentGameNames = () => {
    if (playMode === "Multiplayer") {
      return {
        white: roomPlayers.find((p) => p.color === "W")?.username || "White",
        black: roomPlayers.find((p) => p.color === "B")?.username || "Black",
      };
    }
    if (playMode === "Human_vs_AI") return { white: username || "You", black: `Ken Level ${kenLevelId}` };
    if (playMode === "AI_vs_Human") return { white: `Ken Level ${kenLevelId}`, black: username || "You" };
    return { white: "White", black: "Black" };
  };

  /** Result modal -> open the game that just finished on the Analysis board. */
  const handleAnalyzeCurrentGame = () => {
    const names = currentGameNames();
    const outcome = gameOverInfo?.outcome;
    const myColor: "W" | "B" | null =
      playMode === "Multiplayer" || playMode === "Tournament" ? yourColor
      : playMode === "Human_vs_AI" ? "W"
      : playMode === "AI_vs_Human" ? "B"
      : null;
    const winner =
      outcome === "draw" || !outcome || !myColor ? null
      : outcome === "win" ? myColor
      : myColor === "W" ? "B" : "W";
    setGameOverInfo(null);
    handleAnalyzePastGame({
      id: `local_${Date.now()}`,
      whitePlayer: names.white,
      blackPlayer: names.black,
      winner,
      moveHistory,
      moveEvaluations,
      playMode,
      timestamp: Date.now(),
    });
  };

  /** Result modal -> step through the finished game from move 1. */
  const handleViewReplay = () => {
    setGameOverInfo(null);
    if (moveHistory.length > 0) setHistoryViewIndex(0);
  };

  const handlePostGameLevelUp = () => {
    setGameOverInfo(null);
    setKenLevelId((prev) => Math.min(8, prev + 1));
    handleNewGame();
  };

  // Resign: immediately ends the match with the opponent as winner. Server
  // decides and broadcasts the outcome to both players (see "resign" case
  // in server.ts) so there's no ambiguity about who won.
  // Resign is now a REQUEST, not an instant loss -- the opponent must
  // accept it before the game actually ends (see the "resign" case in
  // server.ts, which now relays this instead of resolving it immediately).
  // A real forfeit -- disconnect timeout, fair-play violations -- is a
  // separate server-driven path and is unaffected: it stays fully
  // automatic since there's no one to ask.
  const handleResign = () => {
    if (playMode === "Multiplayer") {
      if (isSpectating) return;
      // The server only tracks ONE pending draw/resign offer per room -- don't
      // let a second one (mine or theirs, either direction) silently clobber
      // an offer that's still awaiting a response.
      if (resignOfferSent || drawOfferSent || drawOfferReceived || resignOfferReceived) return;
      if (!gameSocket.send({ type: "resign" })) return;
      patchRoom({ resignOfferSent: true });
      setStatusMessage("Resignation offered -- clock paused while opponent responds.");
      playClickSound(muted);
      return;
    }

    if (playMode === "Human_vs_AI" || playMode === "AI_vs_Human" || playMode === "Tournament") {
      if (!confirm("Are you sure you want to resign? Ken AI will win this game.")) return;
      const winnerColor = turn === "W" ? "B" : "W";
      setStatusMessage(`Game Over! ${winnerColor === "W" ? "White" : "Black"} wins (${username || "Player"} resigned). 🏳️`);
      playClickSound(muted);
    }
  };

  const handleCancelResign = () => {
    if (!gameSocket.send({ type: "cancel-resign" })) return;
    patchRoom({ resignOfferSent: false });
    setStatusMessage("Resignation offer withdrawn. Clock resumed.");
    playClickSound(muted);
  };

  const handleResignResponse = (accept: boolean) => {
    if (!gameSocket.send({ type: "resign-response", accept })) return;
    patchRoom({ resignOfferReceived: null });
    playClickSound(muted);
  };

  // Draw offer: sent to the opponent, shown as a banner above the board
  // (not a blocking modal) so it never interrupts the game itself.
  const handleOfferDraw = () => {
    if (playMode === "Multiplayer") {
      if (isSpectating) return;
      if (drawOfferSent || resignOfferSent || drawOfferReceived || resignOfferReceived) return;
      if (!gameSocket.send({ type: "offer-draw" })) return;
      patchRoom({ drawOfferSent: true });
      setStatusMessage("Draw offer sent -- waiting for opponent to accept.");
      playClickSound(muted);
      return;
    }

    if (playMode === "Human_vs_AI" || playMode === "AI_vs_Human" || playMode === "Tournament") {
      if (moveHistory.length < 6) {
        setStatusMessage("Draw offer rejected by Ken AI (game is too short).");
        return;
      }
      if (confirm("Offer a draw to Ken AI?")) {
        setStatusMessage("Game Over! Game drawn by mutual agreement. 🤝");
        playClickSound(muted);
      }
    }
  };

  const handleCancelDraw = () => {
    if (!gameSocket.send({ type: "cancel-draw" })) return;
    patchRoom({ drawOfferSent: false });
    setStatusMessage("Draw offer withdrawn. Clock resumed.");
    playClickSound(muted);
  };

  const handleDrawResponse = (accept: boolean) => {
    if (!gameSocket.send({ type: "draw-response", accept })) return;
    patchRoom({ drawOfferReceived: null });
    playClickSound(muted);
  };

  // Position Editor handlers
  const handleEditorSquareClick = (sq: number) => {
    const newBoard = { ...board };
    if (editorSelectedPiece === null) {
      newBoard[sq] = null;
    } else {
      newBoard[sq] = editorSelectedPiece;
    }
    setBoard(newBoard);
    playClickSound(muted);
  };

  const handleStartSandboxMatch = () => {
    // Any number of pieces is fine -- there's no 20-piece requirement here,
    // this is whatever the editor currently has on it.
    setPendingSandboxBoard({ ...board });
    setShowSandboxPlayChoice(true);
    playClickSound(muted);
  };

  // "vs AI" choice: reuses the existing AI level/color config modal exactly
  // as a normal AI game does -- the only difference is Apply & Start Match
  // starts from pendingSandboxBoard instead of a fresh standard board.
  const handleSandboxPlayVsAI = () => {
    setShowSandboxPlayChoice(false);
    setShowComputerConfigModal(true);
  };

  // "vs another player" choice: creates a real multiplayer room the same
  // way Host Match does, just carrying the custom board along so the
  // server starts the actual game from it instead of the standard setup.
  // Switches into Multiplayer mode first -- the host setup modal only
  // renders within that mode's render tree, so opening it while still in
  // Editor mode wouldn't show anything.
  const handleSandboxPlayVsHuman = () => {
    setShowSandboxPlayChoice(false);
    setPlayMode("Multiplayer");
    setShowHostSetupModal(true);
  };

  const handleCancelRoom = (code: string) => {
    gameSocket.send({ type: "cancel-room", roomId: code });
  };

  const handleClearBoard = () => {
    setBoard({});
    playClickSound(muted);
  };

  /** Manual reconnect (lobby button / session banner): resets backoff and retries now. */
  const handleReconnect = () => {
    setSessionNotice(null);
    gameSocket.reconnectNow();
  };

  /** Every message the UI sends goes through the manager (queue / refuse / reconnect). */
  const sendSocketMessage = useCallback((msg: { type: string } & Record<string, unknown>) => gameSocket.send(msg), []);

  // wagerAmount defaults to 0 (FREE) -- nobody's coins are ever staked
  // unless the host explicitly chose an amount in the setup screen.
  // The intent is remembered in a ref so a reconnect can replay it with
  // the SAME settings if the socket drops before the server answers.
  const handleHostMatch = (gameTime = 5, specialRule = "none", hostTime = 5, guestTime = 5, wagerAmount = 0, bestOf = 1, customBoard?: Board, customTurn?: "W" | "B", privateRoom = false) => {
    pendingHostSettingsRef.current = { gameTime, specialRule: specialRule as any, hostTime, guestTime, wagerAmount, bestOf, customBoard, customTurn, private: privateRoom };
    setPendingJoinRoom(null);
    setPendingHostMatch(true);
    if (gameSocket.getStatus() === "connected") {
      gameSocket.send({
        type: "create-room",
        gameTime,
        specialRule,
        hostTime,
        guestTime,
        wagerAmount,
        bestOf,
        customBoard,
        customTurn,
        private: privateRoom,
      });
    } else if (connectionStatus === "disconnected") {
      handleReconnect();
    }
  };

  const dismissRoomInvite = () => {
    setInviteRoomCode(null);
    try {
      window.history.replaceState(window.history.state, "", removeRoomInviteFromUrl(window.location.href));
    } catch { /* Embedded browsers may deny history changes. */ }
  };

  const handleJoinRoom = (code: string) => {
    const cleanedCode = cleanInviteRoomCode(code);
    if (!cleanedCode) return;
    patchRoom({ roomError: null });
    setPendingHostMatch(false);
    setPendingJoinRoom(cleanedCode);
    if (gameSocket.getStatus() === "connected") {
      gameSocket.send({ type: "join-room", roomId: cleanedCode });
    } else if (connectionStatus === "disconnected") {
      handleReconnect();
    }
  };

  const handleJoinRoomAccept = (targetRoomId: string) => {
    const cleanedCode = targetRoomId.replace(/[^A-Za-z0-9]/g, "").toUpperCase().trim();
    if (!cleanedCode) return;
    setPendingJoinRoom(null);
    patchRoom({ roomError: null });
    gameSocket.send({ type: "join-room-accept", roomId: cleanedCode });
  };

  const handleJoinRoomRefuse = (targetRoomId: string) => {
    const cleanedCode = targetRoomId.replace(/[^A-Za-z0-9]/g, "").toUpperCase().trim();
    gameSocket.send({ type: "join-room-refuse", roomId: cleanedCode });
    setPendingRoomPreview(null);
  };

  const handleFetchLiveRooms = () => {
    if (gameSocket.getStatus() === "connected") gameSocket.send({ type: "list-live-rooms" });
  };

  const handleSpectateRoom = (targetRoomId: string) => {
    gameSocket.send({ type: "spectate-room", roomId: targetRoomId });
  };

  const handleLeaveSpectate = () => {
    gameSocket.send({ type: "leave-spectate" });
    resetRoomState();
    setBoard(createInitialBoard());
    setMoveHistory([]);
    setPlayMode("Home");
  };

  // Grandmaster Lounge notifications -- GlobalChatLounge's own realtime
  // subscription only exists while that component is mounted (i.e. only
  // while actually viewing the lounge), so it can't tell you about a new
  // message while you're off playing a game. This is a second, always-on
  // subscription at the app level purely for the unread badge; the lounge
  // itself still owns actually displaying/loading messages.
  useEffect(() => {
    if (!username || guestMode) return;
    const myUname = username.toLowerCase().trim();
    const channel = supabase
      .channel("global_chat_notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "global_chat" }, (payload: any) => {
        // global_chat columns are "sender" / "text" (the old code read a
        // non-existent .username, so the self-check never actually worked).
        const sender = String(payload.new?.sender || "");
        const text = String(payload.new?.text || "");
        if (sender.toLowerCase().trim() === myUname) return; // don't notify yourself
        if (playModeRef.current === "Global_Chat") return; // already looking at it
        setUnreadLoungeCount((prev) => prev + 1);
        // In-app notification toast -- visible even mid-game, tap to jump
        // to the Grandmaster's Lounge.
        setLoungeToast({ sender, text });
        if (loungeToastTimerRef.current) clearTimeout(loungeToastTimerRef.current);
        loungeToastTimerRef.current = setTimeout(() => setLoungeToast(null), 5000);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [username, guestMode]);

  // Clear the unread count the moment the lounge is actually opened.
  useEffect(() => {
    if (playMode === "Global_Chat") setUnreadLoungeCount(0);
  }, [playMode]);

  // Refresh the "watch a live game" list while sitting in the multiplayer
  // lobby (not in a room) -- once on entry, then every 10s so newly-started
  // games show up without needing a manual refresh.
  useEffect(() => {
    if (playMode !== "Multiplayer" || roomId !== null || connectionStatus !== "connected") return;
    handleFetchLiveRooms();
    const interval = setInterval(() => { if (document.visibilityState === "visible") handleFetchLiveRooms(); }, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playMode, roomId, connectionStatus]);

  /** Caller taps "Voice Call" */
  const handleStartVoiceCall = () => {
    const opp = roomPlayers.find((p) => p.username !== username)?.username;
    if (!opp) {
      setStatusMessage("No opponent found to call in this room.");
      return;
    }
    startCall(opp, "voice");
  };

  /** Caller taps "HD Video Call" */
  const handleStartVideoCall = () => {
    const opp = roomPlayers.find((p) => p.username !== username)?.username;
    if (!opp) {
      setStatusMessage("No opponent found to call in this room.");
      return;
    }
    startCall(opp, "video");
  };

  const handleCancelVoiceCall = () => {
    cancelCall();
  };

  const handleAcceptVoiceCall = (acceptType?: "voice" | "video") => {
    acceptCall(acceptType || incomingVoiceCall?.callType || "voice");
  };

  const handleDeclineVoiceCall = () => {
    declineCall();
  };

  const handleLeaveVoiceChat = () => {
    endCall();
  };

  const handleToggleVoiceMute = () => {
    toggleMic();
  };

  const handleToggleVideoMute = () => {
    toggleVideo();
  };

  const handleFlipCamera = () => {
    flipCamera();
  };

  const handleJoinVoiceChat = () => {
    handleStartVoiceCall();
  };

  const handleToggleScreenShare = () => {
    toggleScreenShare();
  };


  // Confirms the "Host a Match" modification screen: reads whatever the host
  // picked (Game Time, Special Rule, Time Advantage) and actually sends it,
  // instead of the old "Generate Room Number" button that ignored all of
  // this and always created a bare 5-minute/no-rule room.
  const handleConfirmHostSetup = () => {
    const hostTime = setupUnevenTime ? setupHostTime : setupGameTime;
    const guestTime = setupUnevenTime ? setupGuestTime : setupGameTime;
    handleHostMatch(setupGameTime, setupSpecialRule, hostTime, guestTime, setupWagerAmount, setupBestOf, pendingSandboxBoard || undefined, pendingSandboxBoard ? editorTurn : undefined, setupPrivate);
    setPendingSandboxBoard(null);
    setShowHostSetupModal(false);
  };

  // --- Supabase & Analysis Helper Functions ---

  // Community feed ("All" tab): a recent-activity sample across every
  // player. A cap here is fine -- this is a discovery feed, not anyone's
  // personal record, so it's OK if it doesn't show literally everything.
  const fetchSavedGames = async () => {
    if (!isSupabaseConfigured) return;
    setIsLoadingSavedGames(true);
    try {
      let rows;
      try {
        const { data, error } = await supabase.from("completed_games").select("*").order("timestamp", { ascending: false }).limit(120);
        if (error) throw error;
        rows = data;
      } catch (err) {
        handleSupabaseError(err, OperationType.GET, "completed_games");
        return;
      }
      const games: any[] = (rows ?? []).map((row) => ({ id: row.gameId, ...row }));
      setSavedGamesList(uniqueCompletedMatches(games).slice(0, 30));
    } catch (e) {
      console.error("Error fetching saved games:", e);
    } finally {
      setIsLoadingSavedGames(false);
    }
  };

  const fetchMyGames = async (limit = 120) => {
    if (!username || !isSupabaseConfigured) { setMyGamesList([]); return; }
    setIsLoadingSavedGames(true);
    try {
      const { data, error } = await supabase
        .from("completed_games")
        .select("*")
        .or(`whitePlayer.eq.${username},blackPlayer.eq.${username}`)
        .order("timestamp", { ascending: false })
        .limit(Math.min(Math.max(limit, 1), 1000));
      if (error) {
        handleSupabaseError(error, OperationType.GET, "completed_games (whitePlayer/blackPlayer)");
        return;
      }

      const byId = new Map<string, any>();
      for (const row of data ?? []) byId.set(row.gameId, { id: row.gameId, ...row });

      const merged = uniqueCompletedMatches(Array.from(byId.values()));
      setMyGamesList(merged);
    } catch (e) {
      console.error("Error fetching your games:", e);
    } finally {
      setIsLoadingSavedGames(false);
    }
  };

  useEffect(() => {
    if (username && !guestMode) {
      fetchMyGames();
      fetchSavedGames(); // community feed -- powers Home's "just finished" strip
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, guestMode]);

  // Live Games on the Home page: poll the live-rooms list every 10s while
  // Home is on screen (the lobby's own Watch Live section polls separately).
  useEffect(() => {
    if (playMode !== "Home" || connectionStatus !== "connected") return;
    const send = () => { if (gameSocket.getStatus() === "connected") gameSocket.send({ type: "list-live-rooms" }); };
    send();
    const timer = setInterval(() => { if (document.visibilityState === "visible") send(); }, 15_000);
    return () => clearInterval(timer);
  }, [playMode, connectionStatus]);

  const fetchPlayersDirectory = async () => {
    setIsLoadingDirectory(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("username, elo, wins, losses, draws, gamesCount, totalPlayTime, averageDuration, avatarUrl")
        .order("elo", { ascending: false })
        .limit(200);
      if (error) { handleSupabaseError(error, OperationType.GET, "profiles (directory)"); return; }
      setPlayersDirectoryList((data ?? []).map((p: any) => ({
        username: p.username, elo: p.elo ?? 1500, wins: p.wins ?? 0, losses: p.losses ?? 0,
        draws: p.draws ?? 0, gamesCount: p.gamesCount ?? 0, totalPlayTime: p.totalPlayTime ?? 0,
        averageDuration: p.averageDuration ?? 0, avatarUrl: p.avatarUrl ?? undefined,
      })));
    } catch (e) {
      console.error("Error fetching players directory:", e);
    } finally {
      setIsLoadingDirectory(false);
    }
  };

  // Same shape/pattern as fetchMyGames, just parameterized to any username
  // instead of always the signed-in account -- this is what actually makes
  // "analyze anyone's past game" possible, since the community feed alone
  // only ever shows the 30 most recent games from everyone combined.
  const fetchPlayerGames = async (targetUsername: string): Promise<any[]> => {
    const { data, error } = await supabase
      .from("completed_games")
      .select("*")
      // ilike, not eq: usernames are stored in their original case in
      // completed_games, but every caller passes a lowercased name --
      // case-sensitive eq returned ZERO games for anyone with a capital
      // letter in their name, which looked like the feature didn't exist.
      .or(`whitePlayer.ilike.${targetUsername},blackPlayer.ilike.${targetUsername}`)
      .order("timestamp", { ascending: false })
      .limit(1000);
    if (error) { handleSupabaseError(error, OperationType.GET, "completed_games (player profile)"); return []; }
    const byId = new Map<string, any>();
    for (const row of data ?? []) byId.set(row.gameId, { id: row.gameId, ...row });
    return uniqueCompletedMatches(Array.from(byId.values()));
  };

  const handleOpenPlayerProfile = async (targetUsername: string) => {
    const uname = targetUsername.toLowerCase().trim();
    setViewingPlayer(uname);
    setIsLoadingPlayerProfile(true);
    setHeadToHead(null);
    try {
      const [{ data: profileRow, error: profileError }, games] = await Promise.all([
        supabase.from("profiles").select("username, elo, wins, losses, draws, gamesCount, totalPlayTime, averageDuration, avatarUrl").eq("usernameLower", uname).maybeSingle(),
        fetchPlayerGames(uname),
      ]);
      if (profileError) { handleSupabaseError(profileError, OperationType.GET, "profiles (single)"); }
      setViewingPlayerStats(profileRow ? {
        username: profileRow.username, elo: profileRow.elo ?? 1500, wins: profileRow.wins ?? 0,
        losses: profileRow.losses ?? 0, draws: profileRow.draws ?? 0, gamesCount: profileRow.gamesCount ?? 0,
        totalPlayTime: profileRow.totalPlayTime ?? 0, averageDuration: profileRow.averageDuration ?? 0,
        avatarUrl: profileRow.avatarUrl ?? undefined,
      } : null);
      setViewingPlayerGames(games);

      // Head-to-head against whoever's currently signed in, computed from
      // exactly the same rows the profile's game list just loaded -- so
      // the tally can never disagree with what's actually shown below it.
      if (username && uname !== username.toLowerCase().trim()) {
        const myUname = username.toLowerCase().trim();
        let myWins = 0, theirWins = 0, draws = 0, gamesPlayed = 0;
        for (const g of games) {
          const white = (g.whitePlayer || "").toLowerCase();
          const black = (g.blackPlayer || "").toLowerCase();
          const involvesMe = white === myUname || black === myUname;
          if (!involvesMe) continue;
          gamesPlayed += 1;
          if (!g.winner) draws += 1;
          else {
            const winnerUname = (g.winner === "W" ? white : black);
            if (winnerUname === myUname) myWins += 1; else theirWins += 1;
          }
        }
        setHeadToHead(gamesPlayed > 0 ? { opponent: profileRow?.username || targetUsername, gamesPlayed, myWins, theirWins, draws } : null);
      }
    } catch (e) {
      console.error("Error loading player profile:", e);
    } finally {
      setIsLoadingPlayerProfile(false);
    }
  };

  const handleLoadSavedGame = (savedGame: any) => {
    initialPositionRef.current = { board: savedGame.initialBoard || createInitialBoard(), turn: savedGame.initialTurn === "B" ? "B" : "W" };
    let tempBoard = { ...initialPositionRef.current.board };
    const loadedMoves: Move[] = savedGame.moveHistory || [];
    const loadedEvals: Record<number, MoveEvalResult> = savedGame.moveEvaluations || {};

    setBoard(tempBoard);
    setMoveHistory(loadedMoves);
    setHistoryViewIndex(loadedMoves.length - 1);
    setMoveEvaluations(loadedEvals);
    setTurn(turnAfterMoves(loadedMoves.length));
    setLastAnalysisEval(null);
    setAnalysisPlayVsAI(false);
    setStatusMessage(`Loaded saved game: ${savedGame.whitePlayer} vs ${savedGame.blackPlayer}`);
    playClickSound(muted);

    // Past games often aren't fully analyzed yet (the automatic background
    // review only runs once, right after the game first ends) -- fill in the
    // gap here so every loaded game is reviewable move-by-move, the same way
    // a freshly-finished game or a PDN import already is. Uses loadedMoves
    // directly rather than the runAIGameReview()/moveHistory state helper,
    // since that state hasn't committed yet at this point in the function.
    if (loadedMoves.length > 0 && Object.keys(loadedEvals).length < loadedMoves.length && !isReviewing) {
      setIsReviewing(true);
      setReviewProgress(0);
      analyzeMoveHistory(loadedMoves, setReviewProgress)
        .then((evals) => setMoveEvaluations(evals))
        .catch((err) => console.error("AI Game Review failed:", err))
        .finally(() => { setIsReviewing(false); setReviewProgress(100); });
    }
  };

  // Home -> "Analyse" on a past game: jump straight onto the Analysis
  // board with that game loaded (skipping the analysis setup modal).
  const handleAnalyzePastGame = (g: any) => {
    setActivePuzzleId(null);
    setGameOverInfo(null);
    setShowAnalysisModal(false);
    setHistoryViewIndex(null);
    setIsFlipped(false);
    setPlayMode("Analysis");
    handleLoadSavedGame(g);
  };

  // Home -> "Open Analysis Library": land on the Analysis board with fresh
  // community + personal game lists ready in the Library tab.
  const handleOpenAnalysisFromHome = () => {
    setActivePuzzleId(null);
    setGameOverInfo(null);
    setShowAnalysisModal(false);
    setPlayMode("Analysis");
    fetchSavedGames();
    fetchMyGames();
  };

  // The sidebar must not bypass locked Ken levels. The main AI setup
  // remains the only place to request unlocks and view their costs.
  const handleSidebarKenLevel = (level: number) => {
    const unlocked = Math.max(3, profileStats.maxUnlockedKenLevel || 1);
    if (level > unlocked) {
      setStatusMessage(`Ken Level ${level} is locked. Unlock it from the Play Ken AI setup.`);
      setShowComputerConfigModal(true);
      return;
    }
    setKenLevelId(level);
  };

  // Menu Sidebar mode dispatcher
  const handleModeChange = (mode: PlayMode, alreadyLeftRoom = false) => {
    if (guestMode && (mode === "Tournament" || mode === "Global_Chat")) {
      requireAccount(mode === "Tournament" ? "Create an account to enter tournaments." : "Sign in to join the community chat and messaging.");
      return;
    }
    // Every navigation surface must respect the live-match forfeit confirmation.
    if (mode !== "Multiplayer" && playMode === "Multiplayer" && roomId && !isSpectating && !alreadyLeftRoom) {
      const seriesLive = !!seriesInfo && seriesInfo.bestOf > 1 && !seriesInfo.seriesOver;
      const gameLive = roomPhase === "playing" || roomPhase === "setup" || (multiplayerStarted && !serverGameEnd);
      if ((gameLive || seriesLive) && !leaveRoomWithConfirm()) return;
    }
    if (mode === "OfflineNearby" && playMode === "Multiplayer" && multiplayerStarted) {
      setStatusMessage("Leave your online match before starting a nearby offline game.");
      return;
    }
    aiRequestGenerationRef.current += 1;
    setIsThinking(false);
    setActivePuzzleId(null);
    setHistoryViewIndex(null);
    setPendingHostMatch(false);
    setPendingJoinRoom(null);
    setUsedHintsOrUndo(false);
    setGameOverInfo(null);
    setLocalClock(null); // re-created by handleNewGame for timed local modes
    if (mode !== "Multiplayer" && isCallActive) {
      handleLeaveVoiceChat();
    }
    // If the user was spectating a match, cleanly exit spectating so they aren't trapped in someone else's game
    if (isSpectating) {
      gameSocket.send({ type: "leave-spectate" });
      resetRoomState();
      setBoard(createInitialBoard());
      setMoveHistory([]);
    }
    setPlayMode(mode);
    initialPositionRef.current = { board: createInitialBoard(), turn: "W" };
    if (mode === "AI_vs_Human") {
      setIsFlipped(true);
    } else if (mode === "Human_vs_AI") {
      setIsFlipped(false);
    } else if (mode === "Multiplayer") {
      if (!isSpectating && (yourColor === "W" || yourColor === "B")) {
        setIsFlipped(yourColor === "B");
      }
    }

    if (mode === "Human_vs_AI" || mode === "AI_vs_Human" || mode === "AI_vs_AI") {
      const savedRaw = safeStorage.getItem(AI_GAME_STORAGE_KEY);
      if (savedRaw) {
        try {
          const saved = JSON.parse(savedRaw);
          if (saved && Array.isArray(saved.moveHistory) && saved.moveHistory.length > 0) {
            // Verify the save is actually self-consistent before trusting
            // it: replay moveHistory from scratch and require it to land
            // on the exact board that was saved alongside it. A desynced
            // save (board and moveHistory disagreeing, e.g. from the
            // periodic autosave firing mid-update) used to get resumed
            // as-is and crash the moment the next move referenced a square
            // that the real replay says is empty -- and since AI mode
            // always auto-resumes, that trapped the player in an
            // unrecoverable reload loop (see ErrorBoundary's "New Game"
            // button for the other half of this fix).
            let replayOk = true;
            try {
              let replayBoard = saved.initialBoard || createInitialBoard();
              for (const mv of saved.moveHistory) replayBoard = applyMove(replayBoard, mv).board;
              for (let sq = 1; sq <= 50 && replayOk; sq++) {
                if ((replayBoard[sq] ?? null) !== (saved.board?.[sq] ?? null)) replayOk = false;
              }
            } catch {
              replayOk = false;
            }

            if (replayOk) {
              if (guestMode && getGuestAiUsed() === 0 && !takeGuestAiTrial()) return;
              setBoard(saved.board);
              initialPositionRef.current = { board: saved.initialBoard || createInitialBoard(), turn: saved.initialTurn === "B" ? "B" : "W" };
              setMoveHistory(saved.moveHistory);
              setTurn(saved.turn);
              setKenLevelId(saved.kenLevelId);
              setPlayMode(saved.playMode); // resume exactly the side/mode they were playing, not necessarily whatever nav button was tapped
              setClockLimitType("Untimed");
              // Without a fresh gameStartTime the game-over recorder skips the
              // game entirely -- resumed AI games were silently never saved to
              // the database, so they could never be analysed later.
              setGameStartTime(Date.now());
              setGameRecorded(false);
              setStatusMessage("Resumed your game in progress.");
              return;
            }
            // Inconsistent save -- resuming it would just crash again.
            // Clear it so it can't come back on a later attempt, and fall
            // through to the normal fresh-start flow below.
            safeStorage.removeItem(AI_GAME_STORAGE_KEY);
          }
        } catch {
          // Corrupted/unreadable save -- fall through to the normal fresh-start flow below.
        }
      }
      setClockLimitType("Untimed");
      setShowComputerConfigModal(true);
      setBoard(createInitialBoard());
      setTurn("W");
      setMoveHistory([]);
      setStatusMessage("Configure your AI level and play style above!");
      return;
    }

    if (mode === "Analysis") {
      setShowAnalysisModal(true);
      fetchSavedGames();
      fetchMyGames();
      return;
    }

    if (mode === "Multiplayer") {
      setStatusMessage("Online Arena: Enter/Join a match room to start!");
    } else if (mode === "Editor") {
      // Fresh, self-contained editor state: no leftover move history means
      // no ghost "last move" highlights, no stale scorecard/evaluations,
      // and the engine/AI dispatcher stays fully out of the way.
      setBoard(createInitialBoard());
      setTurn("W");
      setMoveHistory([]);
      setMoveEvaluations({});
      setLastAnalysisEval(null);
      setSelectedSq(null);
      setClockLimitType("Untimed");
      setStatusMessage("Editor: tap squares with a brush to set up any position, then Play This Position.");
    } else {
      handleNewGame(undefined, undefined, false); // navigation isn't a new AI match
    }
  };

  // Navigation across history logs
  const handleHistoryNavigate = (index: number) => {
    if (index < 0 || index >= moveHistory.length) return;
    setHistoryViewIndex(index);
    playClickSound(muted);
  };

  const handleResetHistoryView = () => {
    setHistoryViewIndex(null);
    playClickSound(muted);
  };

  // Continue playing from currently viewed historical position
  const handleContinueFromHistory = () => {
    if (historyViewIndex === null) return;
    const newHistory = moveHistory.slice(0, historyViewIndex + 1);

    // Save snapshot of analysis session so player can return anytime
    setResumedAnalysisSnapshot({
      board,
      moveHistory,
      moveEvaluations,
      historyViewIndex,
    });
    setIsUnsavedPracticeGame(true);

    setBoard(renderBoard);
    setMoveHistory(newHistory);
    const finalTurn = turnAfterMoves(newHistory.length);
    setTurn(finalTurn);
    setHistoryViewIndex(null);
    setPlayMode("Training");
    setMoveEvaluations({}); // Clear old review since history has changed
    setStatusMessage(`Practice Game started from move #${newHistory.length}. (Unsaved match — click 'Go Back to Analysis' anytime).`);
    playClickSound(muted);
  };

  const handleGoBackToAnalysis = () => {
    if (resumedAnalysisSnapshot) {
      setBoard(resumedAnalysisSnapshot.board);
      setMoveHistory(resumedAnalysisSnapshot.moveHistory);
      setMoveEvaluations(resumedAnalysisSnapshot.moveEvaluations);
      setHistoryViewIndex(resumedAnalysisSnapshot.historyViewIndex);
      setTurn(turnAfterMoves(resumedAnalysisSnapshot.moveHistory.length));
      setPlayMode("Analysis");
      setResumedAnalysisSnapshot(null);
      setIsUnsavedPracticeGame(false);
      setStatusMessage("Returned to Game Analysis session.");
      playClickSound(muted);
    } else {
      setPlayMode("Analysis");
      setIsUnsavedPracticeGame(false);
    }
  };

  // Spec/rule: Kentro Coin purchases are paid by direct bank transfer into
  // the owner's account, NOT through any payment gateway. This just files a
  // purchase request Kenny can check against his bank statement and approve
  // by hand in the admin panel (/api/admin/resolve-purchase credits the
  // wallet on approval) -- it does NOT credit coins automatically.
  // Spec: "Option 2 - Coin Unlock: Spend Kentro Coins to unlock any locked
  // AI level instantly" (or unlock all at once). Server-verified: the
  // server debits the wallet AND sets maxUnlockedKenLevel atomically -- see
  // /api/coins/unlock-ai-level in server.ts.
  const handleUnlockKenLevel = async (level: number | "all") => {
    if (!username) return;
    try {
      const result = await apiPost("/api/coins/unlock-ai-level", { username: username.toLowerCase().trim(), level });
      setCoinBalance(result.balance);
      setProfileStats((prev) => ({ ...prev, maxUnlockedKenLevel: result.maxUnlockedKenLevel }));
      setStatusMessage(level === "all" ? "All AI levels unlocked!" : `Ken Level ${level} unlocked!`);
      playClickSound(muted);
    } catch (err: any) {
      if (err?.status === 402) {
        setStatusMessage(`Not enough Kentro Coins (need ${err.data?.cost ?? "more"}). You have ${err.data?.balance ?? coinBalance}.`);
      } else {
        setStatusMessage("Couldn't unlock that level right now.");
      }
    }
  };

  const handleSubmitPurchaseReceipt = async () => {
    const uname = (username || "player").toLowerCase().trim();
    if (!purchaseReceiptRef.trim()) {
      setPurchaseError("Enter your transaction reference or a short note (e.g. bank name + time paid) so it can be matched to your transfer.");
      return;
    }
    const pkg = coinPackages.find((p) => p.id === selectedPackageId) || coinPackages[0];
    if (!pkg) {
      setPurchaseError("Coin packages haven't loaded yet -- try again in a moment.");
      return;
    }
    setPurchaseSubmitting(true);
    setPurchaseError(null);
    try {
      await authReady;
      const { error } = await supabase.from("purchase_requests").insert({
        username: uname,
        item: "kentro_coins",
        packageId: pkg.id,
        coins: pkg.coins,
        amountNaira: pkg.priceNaira,
        receiptRef: purchaseReceiptRef.trim(),
        status: "pending",
        submittedAt: Date.now(),
        ownerId: authUser?.id || null,
      });
      if (error) throw error;
      setPurchaseSubmitted(true);
      setShowPurchaseModal(false);
      setStatusMessage(`Receipt submitted. ${pkg.coins} Kentro Coins will be added once confirmed.`);
    } catch (err) {
      handleSupabaseError(err, OperationType.WRITE, "purchase_requests");
      setPurchaseError("Couldn't submit right now. Please try again in a moment.");
    } finally {
      setPurchaseSubmitting(false);
    }
  };

  const handleSubmitWithdrawal = async () => {
    const uname = (username || "player").toLowerCase().trim();
    const coins = parseInt(withdrawCoins, 10);
    if (!Number.isFinite(coins) || coins <= 0) {
      setWithdrawError("Enter how many coins you want to withdraw.");
      return;
    }
    if (!withdrawAccountName.trim() || !withdrawAccountNumber.trim()) {
      setWithdrawError("Enter the name and account number to pay out to.");
      return;
    }
    setWithdrawSubmitting(true);
    setWithdrawError(null);
    try {
      const result = await apiPost("/api/coins/withdraw-request", {
        username: uname,
        coins,
        accountName: withdrawAccountName.trim(),
        accountNumber: withdrawAccountNumber.trim(),
        bankName: withdrawBankName.trim() || undefined,
      });
      setCoinBalance(result.balance);
      setWithdrawSubmitted({ nairaAmount: result.nairaAmount });
      setWithdrawCoins("");
      setWithdrawAccountName("");
      setWithdrawAccountNumber("");
      setWithdrawBankName("");
    } catch (err: any) {
      setWithdrawError(err?.data?.error || "Couldn't submit your withdrawal right now. Please try again in a moment.");
    } finally {
      setWithdrawSubmitting(false);
    }
  };

  // Spec: "Analyze Any Game" -> Import PDN files / paste moves. Parses the Parses the
  // pasted move list (this app's own square notation, validated move-by-move
  // against the real legal-move generator -- see parsePdnMoveList), loads it
  // as the active game, and immediately kicks off the same engine review
  // used everywhere else.
  const handlePdnImport = async () => {
    setPdnImportError(null);
    let parsedMoves: Move[];
    try {
      parsedMoves = parsePdnMoveList(pdnImportText);
    } catch (err) {
      setPdnImportError(err instanceof Error ? err.message : "Couldn't parse that move list.");
      return;
    }
    if (parsedMoves.length === 0) {
      setPdnImportError("Paste at least one move, e.g. \"32-28 19-23\".");
      return;
    }

    setPlayMode("Analysis");
    setBoard(createInitialBoard());
    initialPositionRef.current = { board: createInitialBoard(), turn: "W" };
    setTurn(parsedMoves.length % 2 === 0 ? "W" : "B");
    setMoveHistory(parsedMoves);
    setHistoryViewIndex(null);
    setMoveEvaluations({});
    setGameRecorded(true); // imported game isn't a live match; don't try to record it as one
    setShowPdnImportModal(false);
    setPdnImportText("");
    setStatusMessage(`Imported ${parsedMoves.length} moves. Running AI Game Review...`);
    playClickSound(muted);

    setIsReviewing(true);
    setReviewProgress(0);
    try {
      const evals = await analyzeMoveHistory(parsedMoves, setReviewProgress);
      setMoveEvaluations(evals);
    } catch (err) {
      console.error("PDN import analysis failed:", err);
    } finally {
      setIsReviewing(false);
      setReviewProgress(100);
    }
  };

  // Run full AI Game Review
  const runAIGameReview = async () => {
    if (moveHistory.length === 0 || isReviewing) return;
    setIsReviewing(true);
    setReviewProgress(0);

    try {
      const evals = await analyzeMoveHistory(moveHistory, setReviewProgress);
      setMoveEvaluations(evals);
    } catch (err) {
      console.error("AI Game Review failed:", err);
    } finally {
      setIsReviewing(false);
      setReviewProgress(100);
    }
  };

  const selectedDestSquares = (() => {
    if (selectedSq === null || historyViewIndex !== null) return new Set<number>();
    const candidates = legalMoves.filter((m) => m.from === selectedSq);
    if (candidates.some((m) => m.caps.length > 0)) {
      // Multi-jump aware: shows the NEXT landing of each surviving capture
      // line plus its final square, so both one-tap-to-the-end and
      // square-by-square jumping work.
      return captureClickTargets(candidates, captureWalk);
    }
    return new Set<number>(candidates.map((m) => m.to));
  })();

  const capturingSquares = (() => {
    if (selectedSq === null || historyViewIndex !== null) return new Map<number, number>();
    const mapping = new Map<number, number>();
    const candidates = legalMoves.filter((m) => m.from === selectedSq && m.caps.length > 0);
    for (const m of candidates) {
      const path = m.path && m.path.length > 0 ? m.path : [m.to];
      if (captureWalk.length > path.length) continue;
      if (!captureWalk.every((sqr, i) => path[i] === sqr)) continue;
      if (captureWalk.length < path.length) {
        mapping.set(path[captureWalk.length], m.caps[captureWalk.length] ?? m.caps[0]);
      }
      mapping.set(m.to, m.caps[m.caps.length - 1]);
    }
    return mapping;
  })();

  const rows = Array.from({ length: 10 }, (_, i) => i);
  const cols = Array.from({ length: 10 }, (_, i) => i);
  const displayRows = isFlipped ? [...rows].reverse() : rows;
  const displayCols = isFlipped ? [...cols].reverse() : cols;

  const activeThemeColors = BOARD_THEMES[boardTheme];

  // Helper formatting for move histories
  const moveHistoryStrings = moveHistory.map((mv) => {
    if (!mv || typeof mv.from !== "number" || typeof mv.to !== "number") return "";
    const isCap = Array.isArray(mv.caps) && mv.caps.length > 0;
    return `${mv.from}${isCap ? "x" : "-"}${mv.to}`;
  });

  const lastMove = (historyViewIndex !== null
    ? moveHistory[historyViewIndex]
    : (moveHistory.length > 0 ? moveHistory[moveHistory.length - 1] : null)) ?? null;

  // ---------------------------------------------------------------------
  // View composition (extracted components)
  //
  // The two giant inline render functions that used to live here
  // (renderMultiplayerPanel, ~700 lines, and renderRightSidebarContent,
  // ~400 lines) are now real components in src/components/panels/. App
  // stays the single owner of state; these consts just wire it through.
  // ---------------------------------------------------------------------

  // Mobile in-game room chat sheet (multiplayer). The chat/voice/ready
  // panel was previously unreachable on phones once a match started.
  const [showMobileChatSheet, setShowMobileChatSheet] = useState<boolean>(false);
  const [mpChatSeenCount, setMpChatSeenCount] = useState<number>(0);
  const unreadRoomChat = Math.max(0, multiplayerMessages.length - mpChatSeenCount);

  // --- Head-to-head between ANY two players (live games, room, spectating) ---
  const [pairH2H, setPairH2H] = useState<{
    a: string; b: string; loading: boolean;
    gamesPlayed: number; aWins: number; bWins: number; draws: number;
  } | null>(null);

  const handleViewPairH2H = async (playerA: string, playerB: string) => {
    const a = (playerA || "").trim();
    const b = (playerB || "").trim();
    if (!a || !b) return;
    setPairH2H({ a, b, loading: true, gamesPlayed: 0, aWins: 0, bWins: 0, draws: 0 });
    try {
      const games = await fetchPlayerGames(a.toLowerCase());
      const aL = a.toLowerCase(), bL = b.toLowerCase();
      let aWins = 0, bWins = 0, draws = 0, gamesPlayed = 0;
      for (const g of games) {
        const white = (g.whitePlayer || "").toLowerCase();
        const black = (g.blackPlayer || "").toLowerCase();
        const pair = (white === aL && black === bL) || (white === bL && black === aL);
        if (!pair) continue;
        gamesPlayed += 1;
        if (!g.winner) draws += 1;
        else {
          const winnerUname = g.winner === "W" ? white : black;
          if (winnerUname === aL) aWins += 1; else bWins += 1;
        }
      }
      setPairH2H({ a, b, loading: false, gamesPlayed, aWins, bWins, draws });
    } catch (e) {
      console.error("H2H lookup failed:", e);
      setPairH2H({ a, b, loading: false, gamesPlayed: 0, aWins: 0, bWins: 0, draws: 0 });
    }
  };


  const multiplayerPanelElement = (
    <MultiplayerPanel
      username={username}
      connectionStatus={connectionStatus}
      ws={ws}
      roomId={roomId}
      roomError={roomError}
      roomInput={roomInput}
      setRoomInput={setRoomInput}
      onlineUsers={onlineUsers}
      liveRoomsList={liveRoomsList}
      onFetchLiveRooms={handleFetchLiveRooms}
      onSpectateRoom={handleSpectateRoom}
      onJoinRoom={handleJoinRoom}
      sendMessage={sendSocketMessage}
      onLeaveRoom={handleLeaveRoom}
      onRequestRematch={handlePostGameRematch}
      roomPhase={roomPhase}
      showHostSetupModal={showHostSetupModal}
      setShowHostSetupModal={setShowHostSetupModal}
      setupGameTime={setupGameTime}
      setSetupGameTime={setSetupGameTime}
      setupUnevenTime={setupUnevenTime}
      setSetupUnevenTime={setSetupUnevenTime}
      setupHostTime={setupHostTime}
      setSetupHostTime={setSetupHostTime}
      setupGuestTime={setupGuestTime}
      setSetupGuestTime={setSetupGuestTime}
      setupSpecialRule={setupSpecialRule}
      setSetupSpecialRule={setSetupSpecialRule}
      setupWagerAmount={setupWagerAmount}
      setSetupWagerAmount={setSetupWagerAmount}
      setupBestOf={setupBestOf}
      setSetupBestOf={setSetupBestOf}
      setupPrivate={setupPrivate}
      setSetupPrivate={setSetupPrivate}
      coinBalance={coinBalance}
      onConfirmHostSetup={handleConfirmHostSetup}
      roomPlayers={roomPlayers}
      yourColor={yourColor}
      isReady={isReady}
      multiplayerStarted={multiplayerStarted}
      multiplayerWagerAmount={multiplayerWagerAmount}
      seriesInfo={seriesInfo}
      isSpectating={isSpectating}
      spectatorCount={spectatorCount}
      onLeaveSpectate={handleLeaveSpectate}
      voiceCallState={voiceCallState}
      callType={callType}
      voiceMuted={voiceMuted}
      videoMuted={videoMuted}
      isScreenSharing={isScreenSharing}
      isRemoteScreenSharing={isRemoteScreenSharing}
      outgoingVoiceRinging={outgoingVoiceRinging}
      onStartVoiceCall={handleStartVoiceCall}
      onStartVideoCall={handleStartVideoCall}
      onCancelVoiceCall={handleCancelVoiceCall}
      opponentName={roomPlayers.find((p) => p.username !== username)?.username || "Opponent"}
      onJoinVoiceChat={handleJoinVoiceChat}
      onToggleVoiceMute={handleToggleVoiceMute}
      onToggleVideoMute={handleToggleVideoMute}
      onToggleScreenShare={handleToggleScreenShare}
      onFlipCamera={handleFlipCamera}
      onLeaveVoiceChat={handleLeaveVoiceChat}
      remoteVoiceAudioRef={remoteVoiceAudioRef}
      callFailure={failureInfo}
      multiplayerMessages={multiplayerMessages}
      chatInput={chatInput}
      setChatInput={setChatInput}
      isRecording={isRecording}
      setIsRecording={setIsRecording}
      recordingSeconds={recordingSeconds}
      setRecordingSeconds={setRecordingSeconds}
      recordingIntervalRef={recordingIntervalRef}
      playingVoiceId={playingVoiceId}
      setPlayingVoiceId={setPlayingVoiceId}
      onViewH2H={handleViewPairH2H}
    />
  );

  // Which desk sits beside the board?
  //  - Multiplayer     -> lobby / room panel
  //  - Analysis board  -> the full AnalysisSidebar (the ONLY place any
  //                       engine analysis appears in the app; "Training"
  //                       is the continue-from-history sandbox that
  //                       belongs to the same analysis workspace)
  //  - Everything else -> the plain game sidebar: clocks, move sheet and
  //                       replay. A game vs the AI is just a game.
  const sidebarContent = playMode === "Multiplayer" ? multiplayerPanelElement
    : playMode === "Analysis" || playMode === "Training" ? (
    <AnalysisSidebar
      moveHistory={moveHistory}
      moveHistoryStrings={moveHistoryStrings}
      engineEval={engineEval}
      moveEvaluations={moveEvaluations}
      isReviewing={isReviewing}
      reviewProgress={reviewProgress}
      onRunAIGameReview={runAIGameReview}
      historyViewIndex={historyViewIndex}
      onHistoryNavigate={handleHistoryNavigate}
      onContinueFromHistory={handleContinueFromHistory}
      onResetHistoryView={handleResetHistoryView}
      lastAnalysisEval={lastAnalysisEval}
      renderBoard={renderBoard}
      activeTurn={turn}
      analysisPlayVsAI={analysisPlayVsAI}
      setAnalysisPlayVsAI={setAnalysisPlayVsAI}
      analysisPlayerColor={analysisPlayerColor}
      setAnalysisPlayerColor={setAnalysisPlayerColor}
      analysisAILevel={analysisAILevel}
      setAnalysisAILevel={setAnalysisAILevel}
      setBoard={setBoard}
      onLoadPosition={(position, firstTurn) => {
        initialPositionRef.current = { board: { ...position }, turn: firstTurn };
        setBoard(position);
        setTurn(firstTurn);
        setGameOverInfo(null);
      }}
      setMoveHistory={setMoveHistory}
      setMoveEvaluations={setMoveEvaluations}
      setTurn={setTurn}
      setLastAnalysisEval={setLastAnalysisEval}
      setStatusMessage={setStatusMessage}
      muted={muted}
      savedGamesFilter={savedGamesFilter}
      setSavedGamesFilter={setSavedGamesFilter}
      savedGamesList={savedGamesList}
      myGamesList={myGamesList}
      isLoadingSavedGames={isLoadingSavedGames}
      fetchSavedGames={fetchSavedGames}
      fetchMyGames={fetchMyGames}
      onLoadSavedGame={handleLoadSavedGame}
      setHistoryViewIndex={setHistoryViewIndex}
      onGoBackToAnalysis={handleGoBackToAnalysis}
      hasResumedAnalysis={resumedAnalysisSnapshot !== null}
      onOpenPastGamesModal={(f) => {
        setPastGamesModalFilter(f || "All");
        setShowPastGamesModal(true);
      }}
      onOpenPdnModal={() => {
        setPdnImportError(null);
        setPdnImportText("");
        setShowPdnImportModal(true);
        playClickSound(muted);
      }}
    />
  ) : (
    <GameSidebar
      isComputerMode={isComputerMode}
      isEditorMode={isEditorMode}
      clock={clockSnapshot}
      turn={turn}
      clockLimitType={isEditorMode ? "Untimed" : clockLimitType}
      activePuzzleId={activePuzzleId}
      moveHistory={moveHistory}
      moveHistoryStrings={moveHistoryStrings}
      historyViewIndex={historyViewIndex}
      onHistoryNavigate={handleHistoryNavigate}
      onContinueFromHistory={handleContinueFromHistory}
      onResetHistoryView={handleResetHistoryView}
      onGoBackToAnalysis={handleGoBackToAnalysis}
      hasResumedAnalysis={resumedAnalysisSnapshot !== null}
    />
  );

  // Which screen occupies <main>? Mirrors the ternary chain in the JSX
  // below; used to hide the mobile tab bar during live board play.
  const isBoardScreenActive = !(
    playMode === "Home" ||
    playMode === "OfflineNearby" ||
    playMode === "KentroTV" ||
    playMode === "Learn" ||
    (playMode === "Puzzles" && !activePuzzleId) ||
    playMode === "Global_Chat" ||
    (playMode === "Multiplayer" && !multiplayerStarted) ||
    (playMode === "Tournament" && !isTournamentGameInProgress)
  );

  const openMobileChatSheet = () => {
    setMpChatSeenCount(multiplayerMessages.length);
    setShowMobileChatSheet(true);
  };
  const closeMobileChatSheet = () => {
    setMpChatSeenCount(multiplayerMessages.length);
    setShowMobileChatSheet(false);
  };

  // --- Grandmaster's Lounge chat notification toast ---
  const [loungeToast, setLoungeToast] = useState<{ sender: string; text: string } | null>(null);
  const loungeToastTimerRef = useRef<any>(null);

  // --- Weekly puzzles ---
  const [puzzleSolvedVersion, setPuzzleSolvedVersion] = useState<number>(0);

  const handleStartPuzzle = (p: Puzzle & { source?: string }) => {
    try {
      const parsed = scanFenToBoard(p.fen);
      setBoard(parsed.board);
      setTurn(parsed.turn);
      setMoveHistory([]);
      setMoveEvaluations({});
      setHistoryViewIndex(null);
      setLastAnalysisEval(null);
      setSelectedSq(null);
      setIsFlipped(parsed.turn === "B");
      setLocalClock(null);
      setActivePuzzleId(p.id);
      setPuzzleSolution(Array.isArray(p.solution) ? p.solution : []);
      setPuzzleStepIndex(0);
      setPuzzleCompleted(false);
      setPuzzleError(null);
      setPlayMode("Puzzles");
      setStatusMessage(p.description || `${parsed.turn === "W" ? "White" : "Black"} to play -- find the winning line!`);
      playGameStartSound(muted);
    } catch (e) {
      console.error("Failed to load puzzle:", e);
      setStatusMessage("This puzzle's position could not be loaded.");
    }
  };

  const handleExitPuzzles = () => {
    setActivePuzzleId(null);
    setPuzzleSolution([]);
    setPuzzleStepIndex(0);
    setPuzzleCompleted(false);
    setPuzzleError(null);
    setBoard(createInitialBoard());
    setTurn("W");
    setMoveHistory([]);
    setHistoryViewIndex(null);
    setIsFlipped(false);
    setPlayMode("Puzzles");
    playClickSound(muted);
  };

  // Record weekly progress the moment a puzzle is fully solved.
  useEffect(() => {
    if (puzzleCompleted && activePuzzleId) {
      markPuzzleSolved(activePuzzleId);
      setPuzzleSolvedVersion((v) => v + 1);
    }
  }, [puzzleCompleted, activePuzzleId]);

  // Wrong puzzle answer: show the expected move as a board arrow
  // ("you should have played this"), lidraughts-style.
  const currentPuzzleStep = activePuzzleId && puzzleError && puzzleStepIndex < puzzleSolution.length ? puzzleSolution[puzzleStepIndex] : null;
  const puzzleArrowSquares =
    currentPuzzleStep && currentPuzzleStep.role !== "reply" && typeof currentPuzzleStep.from === "number" && typeof currentPuzzleStep.to === "number"
      ? { from: currentPuzzleStep.from, to: currentPuzzleStep.to }
      : null;

  // --- Profile avatar (players can upload a picture of themselves) ---
  const handleSaveAvatar = async (dataUrl: string) => {
    if (!authUser) return;
    const { error } = await supabase
      .from("profiles")
      .update({ avatarUrl: dataUrl })
      .eq("ownerId", authUser.id);
    if (error) {
      handleSupabaseError(error, OperationType.UPDATE, "profiles (avatar)");
      throw error;
    }
    setProfileStats((prev) => ({ ...prev, avatarUrl: dataUrl }));
    primeAvatar(username, dataUrl);
  };

  // Whatever we already know about the signed-in player's picture goes into
  // the shared avatar cache, so their face appears instantly (chat, lobby)
  // with zero extra reads.
  useEffect(() => {
    if (username) primeAvatar(username, profileStats?.avatarUrl ?? null);
  }, [username, profileStats?.avatarUrl]);

  // -----------------------------------------------------------------
  // FAIR PLAY GUARD (client side): detects switching to another app,
  // window blur (split screen / floating windows), and split-screen
  // viewport shrink during a live game, and reports it. Multiplayer
  // enforcement is server-side (strikes -> forfeit); tournament games
  // vs Ken forfeit locally; casual AI games void the level-unlock.
  // -----------------------------------------------------------------
  // Site-wide announcement / maintenance notice, set by admins.
  const [siteAnnouncement, setSiteAnnouncement] = useState<{ text: string; tone: string } | null>(null);
  const [siteMaintenance, setSiteMaintenance] = useState<{ message: string } | null>(null);
  const [announcementDismissed, setAnnouncementDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      // No background fetch while a player has moved to another app.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      fetch("/api/site-config")
        .then((r) => (r.ok ? r.json() : null))
        .then((cfg) => {
          if (!alive || !cfg) return;
          setSiteAnnouncement(cfg.announcement || null);
          setSiteMaintenance(cfg.maintenance || null);
        })
        .catch(() => {});
    };
    load();
    // Re-check periodically so a new announcement reaches players who
    // already have the app open.
    const t = setInterval(load, 120000);
    document.addEventListener("visibilitychange", load);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", load); };
  }, []);

  const [fairPlayWarning, setFairPlayWarning] = useState<{ strikes: number; maxStrikes: number; message: string } | null>(null);
  const [myAwayStrikes, setMyAwayStrikes] = useState<number>(0);
  const awayRef = useRef<boolean>(false);
  const tournamentAwayStrikesRef = useRef<number>(0);
  const tournamentForfeitedRef = useRef<boolean>(false);

  useEffect(() => {
    if (isTournamentGameInProgress) {
      tournamentAwayStrikesRef.current = 0;
      tournamentForfeitedRef.current = false;
      setMyAwayStrikes(0);
    }
  }, [isTournamentGameInProgress]);

  // Fairplay warnings and away tracking strictly apply to live PVP Multiplayer and Tournament games.
  const isGuardedMultiplayerGame = playMode === "Multiplayer" && multiplayerStarted && !isSpectating && !gameOverInfo && !serverGameEnd;
  const isGuardedTournamentGame = playMode === "Tournament" && isTournamentGameInProgress && !gameOverInfo;

  useEffect(() => {
    const isMultiplayerGame = isGuardedMultiplayerGame;
    const isTournamentGame = isGuardedTournamentGame;
    const guardedPvP = isMultiplayerGame || isTournamentGame;

    if (!guardedPvP) return;

    const goAway = () => {
      if (awayRef.current) return;
      awayRef.current = true;
      if (isMultiplayerGame) {
        gameSocket.send({ type: "focus-lost" });
      } else if (isTournamentGame) {
        tournamentAwayStrikesRef.current += 1;
        const strikes = tournamentAwayStrikesRef.current;
        setMyAwayStrikes(strikes);
        playWarningAlertSound(mutedRef.current);
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          try { navigator.vibrate([250, 100, 250]); } catch {}
        }
        if (strikes > 7) {
          if (!tournamentForfeitedRef.current) {
            tournamentForfeitedRef.current = true;
            setFairPlayWarning({
              strikes: 7,
              maxStrikes: 7,
              message: "Tournament match forfeited! You exceeded 7 app departures during a live tournament match."
            });
            const winnerName = yourColorRef.current === "W" ? "Black" : "White";
            setStatusMessage(`Game Over! ${winnerName} wins (Forfeit — Fair Play Violation: exceeded 7 app departures). 🏳️`);
          }
        } else {
          setFairPlayWarning({
            strikes,
            maxStrikes: 7,
            message: `Tournament Fair Play Warning (${strikes}/7): You left the app during a live tournament game. Exceeding 7 departures forfeits the match.`
          });
        }
      }
    };

    const comeBack = () => {
      if (!awayRef.current) return;
      awayRef.current = false;
      if (isMultiplayerGame) {
        gameSocket.send({ type: "focus-regained" });
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        goAway();
      } else {
        comeBack();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (awayRef.current) {
        awayRef.current = false;
        if (isMultiplayerGame) {
          try { gameSocket.send({ type: "focus-regained" }); } catch {}
        }
      }
    };
  }, [isGuardedMultiplayerGame, isGuardedTournamentGame]);

  // Fast-Resume & Active Room: Persist room and match state locally during active multiplayer sessions.
  useEffect(() => {
    if (playMode === "Multiplayer" && roomId) {
      saveActiveRoom({
        roomId,
        playMode: "Multiplayer",
        yourColor,
        specialRule: multiplayerSpecialRule,
        gameStarted: multiplayerStarted,
      });

      if (multiplayerStarted && board) {
        const whiteName = roomPlayers.find((p) => p.color === "W")?.username || "White";
        const blackName = roomPlayers.find((p) => p.color === "B")?.username || "Black";
        saveFastResumeState({
          roomId,
          board,
          turn,
          lastMove,
          moveHistory,
          yourColor,
          whiteName,
          blackName,
          specialRule: multiplayerSpecialRule,
        });
      }
    }
  }, [playMode, roomId, multiplayerStarted, board, turn, lastMove, moveHistory, yourColor, roomPlayers, multiplayerSpecialRule]);

  // Still checking whether a Supabase session exists -- avoid flashing the
  // sign-in screen on reload, but if username is already known, do not block the UI.
  if (playMode === "OfflineNearby" && !authUser) {
    return <OfflineNearby username="Guest" onBack={() => { window.history.replaceState({}, "", window.location.pathname); setPlayMode("Home"); }} />;
  }

  if (!authChecked && !username) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center z-50 w-full h-full">
        <div className="flex flex-col items-center gap-3">
          <Crown className="w-10 h-10 text-amber-500 animate-pulse" />
          <span className="text-xs text-slate-500 font-sans">Loading Kentro Draught...</span>
        </div>
      </div>
    );
  }

  // No real account signed in -- show the actual auth screen. onAuthenticated
  // below is a no-op because the onAuthStateChange listener (set up in the
  // auth effect above) already handles flipping authUser/username -- this
  // callback exists so AuthScreen doesn't need to know any of that.
  if (!authUser && !guestEnabled) {
    return <AuthScreen onAuthenticated={() => {}} onPlayOffline={() => setPlayMode("OfflineNearby")}
      onContinueAsGuest={() => {
        setGuestActive(true);
        setGuestEnabled(true);
        setGuestAiUsed(getGuestAiUsed());
        setUsername(getGuestName());
        if (!inviteRoomCode && !initialReplay) setPlayMode("Home");
      }} />;
  }

  // Signed in, but no username in user_metadata -- shouldn't normally
  // happen (signUpWithEmail always sets one), but if it ever does, land
  // here rather than silently proceeding with a null identity.
  if (!username) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center z-50 w-full h-full">
        <div className="flex flex-col items-center gap-3">
          <Crown className="w-10 h-10 text-rose-500" />
          <span className="text-xs text-slate-500 font-sans">Couldn't load your profile. Try refreshing.</span>
        </div>
      </div>
    );
  }

  const whitePlayerName =
    playMode === "Multiplayer" ? guestDisplayName(roomPlayers.find((p) => p.color === "W")?.username || "White")
    : playMode === "Human_vs_AI" ? (username || "You")
    : playMode === "AI_vs_Human" ? `Ken ${kenLevelId}`
    : playMode === "Tournament" ? (yourColor === "W" ? (username || "You") : (activeTournamentOpponent || `Ken ${getTournamentKenLevelId(tournamentRound)}`))
    : "White";

  const blackPlayerName =
    playMode === "Multiplayer" ? guestDisplayName(roomPlayers.find((p) => p.color === "B")?.username || "Black")
    : playMode === "Human_vs_AI" ? `Ken ${kenLevelId}`
    : playMode === "AI_vs_Human" ? (username || "You")
    : playMode === "Tournament" ? (yourColor === "B" ? (username || "You") : (activeTournamentOpponent || `Ken ${getTournamentKenLevelId(tournamentRound)}`))
    : "Black";

  // --- Result modal details (real names / reason / series state, audit M1/M2) ---
  const seriesInProgress = playMode === "Multiplayer" && !!seriesInfo && seriesInfo.bestOf > 1 && !seriesInfo.seriesOver;
  const gameOverOpponentName =
    playMode === "Multiplayer" ? guestDisplayName(roomPlayers.find((p) => p.username !== username)?.username || "Opponent")
    : playMode === "Human_vs_AI" || playMode === "AI_vs_Human" || playMode === "AI_vs_AI" ? `Ken Level ${kenLevelId}`
    : playMode === "Tournament" ? (activeTournamentOpponent || `Ken Level ${getTournamentKenLevelId(tournamentRound)}`)
    : (playMode === "Analysis" || playMode === "Training") && analysisPlayVsAI ? `Ken Level ${analysisAILevel}`
    : "Opponent";
  const gameOverReason = (() => {
    if (playMode !== "Multiplayer" || !serverGameEnd) return undefined;
    const r = (serverGameEnd.reason || "").toLowerCase();
    const iWon = gameOverInfo?.outcome === "win";
    if (r === "timeout" || r.includes("time")) return "Timeout";
    if (r.includes("resign")) return iWon ? "Opponent Resigned" : "Resigned";
    if (r.includes("draw")) return "Draw Agreement";
    if (r.includes("fair")) return "Fair Play Forfeit";
    if (r.includes("abandon") || r.includes("disconnect") || r.includes("forfeit") || r.includes("left")) return iWon ? "Opponent Abandoned" : "Forfeit";
    return undefined; // the modal derives it from the status message
  })();

  return (
    <AdminProfileProvider permissions={adminPermissions}>
    <div className={`k-app-shell fixed inset-0 text-slate-100 flex flex-col font-sans select-none overflow-hidden w-full h-full ${focusMode && isBoardScreenActive ? "k-focus-active" : ""} ${reducedMotion ? "k-motion-reduced" : ""}`}>
      <InstallAppPrompt />
      {guestMode && (
        <div className="shrink-0 bg-emerald-500/10 border-b border-emerald-500/25 px-3 py-2 flex items-center justify-between gap-2 z-40">
          <div className="min-w-0 text-[11px] text-emerald-200 font-sans">
            <strong>Guest Mode</strong> · AI {Math.max(0, GUEST_AI_LIMIT - guestAiUsed)}/{GUEST_AI_LIMIT} left · Online {Math.max(0, GUEST_ONLINE_LIMIT - guestOnlineUsed)}/{GUEST_ONLINE_LIMIT} left
          </div>
          <button type="button" className="shrink-0 rounded-lg bg-amber-500 text-slate-950 px-3 py-1 text-[11px] font-extrabold" onClick={() => { setGuestActive(false); setGuestEnabled(false); setUsername(null); gameSocket.disconnect(); }}>Sign In / Register</button>
        </div>
      )}

      {authUser && !authUser.email_confirmed_at && !verifyBannerDismissed && (
        <div className="shrink-0 bg-amber-500/10 border-b border-amber-500/30 px-3 py-2 flex items-center justify-between gap-2 z-40">
          <span className="text-[11px] text-amber-400 font-sans">
            {verifyEmailSent
              ? "Verification email sent -- check your inbox."
              : "Verify your email to secure your account."}
          </span>
          <div className="flex items-center gap-3 shrink-0">
            {!verifyEmailSent && (
              <button onClick={handleResendVerification} className="text-[11px] font-bold text-amber-400 hover:text-amber-300 transition">
                Resend email
              </button>
            )}
            <button onClick={() => setVerifyBannerDismissed(true)} className="text-amber-500/60 hover:text-amber-400 transition">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Session notice: signed in elsewhere / name in use (contract section 1) */}
      {sessionNotice && (
        <div className="shrink-0 bg-rose-500/10 border-b border-rose-500/30 px-3 py-2 flex items-center justify-between gap-2 z-40">
          <span className="text-[11px] text-rose-300 font-sans">{sessionNotice.message}</span>
          <div className="flex items-center gap-3 shrink-0">
            <button onClick={handleReconnect} className="text-[11px] font-bold text-rose-300 hover:text-rose-200 transition cursor-pointer">
              {sessionNotice.kind === "replaced" ? "Use this tab" : "Retry"}
            </button>
            <button onClick={() => setSessionNotice(null)} className="text-rose-400/60 hover:text-rose-300 transition cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Visual Reconnecting Status Indicator with Failed Attempt Counter and Fast-Resume Status */}
      {!sessionNotice && connectionStatus !== "connected" && username && (
        <div className="shrink-0 bg-gradient-to-r from-amber-950/90 via-slate-900/95 to-amber-950/90 border-b border-amber-500/40 px-3.5 py-2 flex items-center justify-between gap-2.5 z-40 shadow-lg shadow-black/40 backdrop-blur-md">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
            </span>
            <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-black text-amber-300 tracking-wide font-mono">
                  {connectionStatus === "connecting"
                    ? `Reconnecting (Attempt #${reconnectAttempts > 0 ? reconnectAttempts : 1})…`
                    : "Connection Dropped"}
                </span>
                <span className="hidden sm:inline-block w-1.5 h-1.5 rounded-full bg-amber-400/60" />
              </div>
              <span className="text-[11px] text-slate-300 truncate">
                {roomId && multiplayerStarted
                  ? "⚡ Fast-Resume active — your board state & clock are preserved."
                  : "Syncing connection with server…"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleReconnect}
              className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black transition flex items-center gap-1.5 shadow-md shadow-amber-500/20 cursor-pointer active:scale-95"
              title="Force immediate reconnection retry"
            >
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>Retry Now</span>
            </button>
          </div>
        </div>
      )}

      {/* GLOBAL TOP NAV BAR */}
      <TopNav
        showAdmin={adminPermissions.length > 0}
        onOpenAdmin={() => setShowAdminPanel(true)}
        isMobile={isMobile}
        playMode={playMode}
        unreadLoungeCount={unreadLoungeCount}
        moveHistory={moveHistory}
        muted={muted}
        setMuted={setMuted}
        handleModeChange={handleModeChange}
        setIsLeftDrawerOpen={setIsLeftDrawerOpen}
        setIsRightDrawerOpen={setIsRightDrawerOpen}
        setShowAppGuideModal={setShowAppGuideModal}
        setShowSettingsModal={setShowSettingsModal}
        isGameActive={isBoardScreenActive}
        showMobileDeskButton={isBoardScreenActive && playMode !== "Multiplayer"}
      />

      {/* Admin announcement / maintenance notice */}
      {(siteMaintenance || (siteAnnouncement && !announcementDismissed)) && (
        <div
          className={`px-4 py-2 text-[11px] font-bold text-center flex items-center justify-center gap-2 ${
            siteMaintenance
              ? "bg-rose-600 text-white"
              : siteAnnouncement?.tone === "warning"
                ? "bg-amber-600 text-slate-950"
                : siteAnnouncement?.tone === "success"
                  ? "bg-emerald-600 text-white"
                  : "bg-sky-700 text-white"
          }`}
        >
          <span className="leading-snug">{siteMaintenance ? siteMaintenance.message : siteAnnouncement?.text}</span>
          {!siteMaintenance && (
            <button
              onClick={() => setAnnouncementDismissed(true)}
              className="shrink-0 opacity-70 hover:opacity-100 cursor-pointer"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Incoming voice call -- full-width ringing banner, visible on any
          screen, exactly like a phone call. */}
      {/* Incoming Call Overlay Alert Banner */}
      <AnimatePresence>
        {incomingVoiceCall && (
          <motion.div
            initial={{ opacity: 0, y: -60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -60 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[96] w-[min(92vw,400px)] bg-gradient-to-b from-slate-900 to-slate-950 border border-emerald-500/40 rounded-3xl shadow-2xl shadow-emerald-500/10 p-4 flex flex-col gap-3"
          >
            <div className="flex items-center gap-3">
              <span className="relative flex h-11 w-11 items-center justify-center shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/30" />
                <span className={`relative flex h-11 w-11 items-center justify-center rounded-full ${incomingVoiceCall.callType === "video" ? "bg-indigo-500/20 border border-indigo-400/50" : "bg-emerald-500/15 border border-emerald-500/40"}`}>
                  {incomingVoiceCall.callType === "video" ? (
                    <Video className="w-5 h-5 text-indigo-400 animate-pulse" />
                  ) : (
                    <Phone className="w-5 h-5 text-emerald-400 animate-pulse" />
                  )}
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400 font-mono block">
                  {incomingVoiceCall.callType === "video" ? "Incoming HD Video Call" : "Incoming Voice Call"}
                </span>
                <span className="text-sm font-black text-white truncate block">{incomingVoiceCall.from}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <button
                onClick={handleDeclineVoiceCall}
                className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black transition cursor-pointer"
              >
                <PhoneOff className="w-4 h-4" /> Decline
              </button>
              {incomingVoiceCall.callType === "video" && (
                <button
                  onClick={() => handleAcceptVoiceCall("voice")}
                  className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition cursor-pointer border border-slate-700"
                >
                  <Phone className="w-3.5 h-3.5" /> Audio Only
                </button>
              )}
              <button
                onClick={() => handleAcceptVoiceCall(incomingVoiceCall.callType)}
                className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-white text-xs font-black transition cursor-pointer animate-pulse ${
                  incomingVoiceCall.callType === "video"
                    ? "bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 col-span-2 sm:col-span-1"
                    : "bg-emerald-600 hover:bg-emerald-500"
                }`}
              >
                {incomingVoiceCall.callType === "video" ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
                {incomingVoiceCall.callType === "video" ? "Accept Video" : "Accept"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Promotion Crown Alert */}
      <AnimatePresence>
        {promotedToast && (
          <motion.div
            initial={{ opacity: 0, y: -40 }}
            animate={{ opacity: 1, y: 12 }}
            exit={{ opacity: 0, y: -40 }}
            className="fixed top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-yellow-500 to-amber-500 text-slate-950 font-black px-6 py-3 rounded-full shadow-2xl flex items-center space-x-2 z-50 border border-yellow-300 text-xs sm:text-sm tracking-wide"
          >
            <Crown className="w-4 h-4 fill-slate-950 animate-bounce" />
            <span>{promotedToast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Primary Grid Layout - Responsive 3-Column on Desktop */}
      <div className="k-app-layout flex-grow flex flex-col lg:flex-row overflow-hidden w-full min-h-0">
        {/* Left Sidebar Menu (Desktop only) */}
        <MenuSidebar
          showAdmin={adminPermissions.length > 0}
          onOpenAdmin={() => setShowAdminPanel(true)}
          className="hidden lg:flex lg:w-64 flex-col shrink-0 overflow-y-auto select-none h-full"
          activeMode={playMode}
          onSelectMode={handleModeChange}
          onOpenFriends={() => { if (requireAccount()) setShowFriendsPage(true); }}
          onOpenProfile={() => { if (requireAccount()) setShowProfilePage(true); }}
          onOpenStore={() => { if (requireAccount()) setShowPurchaseModal(true); }}
          onOpenPlayers={() => { setShowPlayerDirectory(true); fetchPlayersDirectory(); }}
          unreadLoungeCount={unreadLoungeCount}
          muted={muted}
          onToggleMuted={() => setMuted(!muted)}
          onShowRules={() => setShowRules(true)}
          boardTheme={boardTheme}
          onSelectBoardTheme={setBoardTheme}
          clockLimitType={clockLimitType}
          onSelectClockLimit={setClockLimitType}
          kenLevelId={kenLevelId}
          onSelectKenLevel={handleSidebarKenLevel}
          boardScale={boardScale}
          onSelectBoardScale={setBoardScale}
        />

        {/* Center Screen: Game Board Section */}
        <main className={`flex-1 min-h-0 min-w-0 flex flex-col ${isBoardScreenActive ? "items-center justify-center overflow-hidden" : playMode === "Global_Chat" ? "items-stretch justify-start overflow-hidden" : "items-stretch justify-start overflow-y-auto"} relative k-app-main w-full`}>
          <Suspense fallback={<div role="status" className="flex min-h-40 items-center justify-center text-xs text-slate-400">Loading…</div>}>
          {playMode === "Home" ? (
            <HomeLobby
              username={username || "Player"}
              isGuest={guestMode}
              coinBalance={coinBalance}
              profileStats={profileStats}
              recentGames={myGamesList}
              onSelectMode={handleModeChange}
              onOpenStore={() => { if (requireAccount("Sign in to use Kentro Coins and the shop.")) setShowPurchaseModal(true); }}
              onOpenProfile={() => { if (requireAccount("Sign in to create your profile and save your results.")) setShowProfilePage(true); }}
              liveGames={liveRoomsList}
              communityGames={savedGamesList}
              onWatchLive={handleSpectateRoom}
              onAnalyzeGame={handleAnalyzePastGame}
              onOpenAnalysis={handleOpenAnalysisFromHome}
              onOpenPlayers={() => { setShowPlayerDirectory(true); fetchPlayersDirectory(); }}
              onOpenPastGamesModal={(f) => {
                setPastGamesModalFilter(f || "All");
                setShowPastGamesModal(true);
              }}
              kenLevelId={kenLevelId}
              setKenLevelId={setKenLevelId}
              onOpenComputerModal={() => setShowComputerConfigModal(true)}
              onUnlockKenLevel={handleUnlockKenLevel}
              onOpenNotifications={() => setShowNotifications(true)}
              onOpenKentroTV={() => handleModeChange("KentroTV")}
              unreadNotificationCount={notificationManager.unread}
              onSignOut={guestMode ? undefined : () => {
                signOutUser().catch((err) => console.error("Sign out failed:", err));
              }}
            />
          ) : playMode === "KentroTV" ? (
            <KentroTV
              liveRooms={liveRoomsList}
              onRefresh={handleFetchLiveRooms}
              onWatch={handleSpectateRoom}
              onBack={() => { setInitialReplay(null); window.history.replaceState(window.history.state, "", window.location.pathname); handleModeChange("Home"); }}
              initialReplay={initialReplay}
            />
          ) : playMode === "OfflineNearby" ? (
            <OfflineNearby username={username || "Player"} onBack={() => { window.history.replaceState({}, "", window.location.pathname); handleModeChange("Home"); }} />
          ) : playMode === "Learn" ? (
            <ComingSoonPane
              icon={GraduationCap}
              title="Learn"
              description="Guided lessons, opening theory, and tactics training for Nigerian draughts are on the way."
              featureKey="learn"
              onBackToHome={() => handleModeChange("Home")}
            />
          ) : playMode === "Puzzles" && !activePuzzleId ? (
            <PuzzlesPane onStartPuzzle={handleStartPuzzle} solvedVersion={puzzleSolvedVersion} onBackToHome={() => handleModeChange("Home")} />
          ) : playMode === "Global_Chat" ? (
            <GlobalChatLounge
              username={username || "Player"}
              profileStats={profileStats}
              onlineUsers={onlineUsers}
              onSelectMode={handleModeChange}
              onLoadSavedGame={handleAnalyzePastGame}
              myGamesList={myGamesList}
              savedGamesList={savedGamesList}
              fetchMyGames={fetchMyGames}
              onStartVoiceCall={(targetUser, type) => startCall(targetUser, type || "voice")}
              ws={ws}
              activeVoiceCall={{
                callState: voiceCallState,
                opponentName: callOpponentName,
                callDuration: callDuration,
                isMicMuted: voiceMuted,
                toggleMic: toggleMic,
                endCall: endCall,
              }}
            />
          ) : playMode === "Multiplayer" && !multiplayerStarted ? (
            <LobbyDashboard
              username={username || ""}
              isGuest={guestMode}
              connectionStatus={connectionStatus}
              onlineUsers={onlineUsers}
              openRooms={openRooms}
              roomId={roomId}
              roomPlayers={roomPlayers}
              yourColor={yourColor}
              isReady={isReady}
              roomError={roomError}
              roomInput={roomInput}
              setRoomInput={setRoomInput}
              ws={ws}
              onSignOut={() => {
                if (guestMode) { setGuestActive(false); setGuestEnabled(false); setUsername(null); gameSocket.disconnect(); }
                else signOutUser().catch((err) => console.error("Sign out failed:", err));
              }}
              onSelectMode={handleModeChange}
              chatInput={chatInput}
              setChatInput={setChatInput}
              multiplayerMessages={multiplayerMessages}
              profileStats={profileStats}
              clockLimitType={clockLimitType}
              onHostMatch={(gameTime, specialRule, hostTime, guestTime, wagerAmount, bestOf, privateRoom) => handleHostMatch(gameTime, specialRule, hostTime, guestTime, wagerAmount, bestOf, undefined, undefined, privateRoom)}
              onJoinRoom={handleJoinRoom}
              onCancelRoom={handleCancelRoom}
              onOpenPastGamesModal={(f) => {
                setPastGamesModalFilter(f || "PvP");
                setShowPastGamesModal(true);
              }}
              onOpenPlayers={() => setShowPlayerDirectory(true)}
              onReconnect={handleReconnect}
              pendingHostMatch={pendingHostMatch}
              pendingJoinRoom={pendingJoinRoom}
              inviteRoomCode={inviteRoomCode}
              onDismissInvite={dismissRoomInvite}
              pendingRoomPreview={pendingRoomPreview}
              onJoinRoomAccept={handleJoinRoomAccept}
              onJoinRoomRefuse={handleJoinRoomRefuse}
              onLeaveRoom={handleLeaveRoom}
            />
          ) : playMode === "Tournament" && !isTournamentGameInProgress ? (
            <TournamentDashboard
              username={username || "You"}
              userRating={profileStats?.elo || 1500}
              onStartMatch={(opponent, color, handicap, matchId, timeControl) => {
                setActiveTournamentMatchId(matchId);
                setActiveTournamentOpponent(opponent);
                patchRoom({ yourColor: color });
                setIsFlipped(color === "B");
                setBoard(createInitialBoard());
                setTurn("W");
                setMoveHistory([]);
                setSelectedSq(null);
                setHistoryViewIndex(null);
                setGameStartTime(Date.now());
                setGameRecorded(false);
                setGameOverInfo(null);
                startLocalClock(clockLimitType, "W");

                // Apply Handicap Rules to Board
                // NOTE: this previously treated `board` as a numeric array (values
                // 1/-1/2/-2, `nextBoard.findIndex(...)`) left over from an old board
                // representation. The real Board type (see gameLogic.ts) is a plain
                // object keyed by square number (1-50) holding "w"/"W"/"b"/"B"/null,
                // so `[...currentBoard]` on it threw at runtime ("not iterable") the
                // instant any tournament match with a handicap other than "None" was
                // launched. Rewritten to operate on the real Board shape, matching
                // the same square-removal approach already used correctly for
                // multiplayer rooms in server.ts.
                if (handicap && handicap !== "None") {
                  setBoard((currentBoard) => {
                    const nextBoard: Board = { ...currentBoard };
                    const colorToRemove = color; // the handicapped side (see handleLaunchMatch)
                    const removeCount =
                      handicap === "Short One" ? 1 : handicap === "Short Two" ? 2 : handicap === "Short Three" ? 3 : 0;

                    if (removeCount > 0) {
                      let removed = 0;
                      // Remove from the back rank inward so the missing piece(s) mirror
                      // the "corner" convention already used for the multiplayer version
                      // of this same rule.
                      for (let sq = 1; sq <= 50 && removed < removeCount; sq++) {
                        const targetSq = colorToRemove === "W" ? 51 - sq : sq;
                        if (nextBoard[targetSq] === colorToRemove.toLowerCase()) {
                          nextBoard[targetSq] = null;
                          removed++;
                        }
                      }
                    } else if (handicap === "Crown Crown") {
                      // Real Crown Crown rule (matches the interactive
                      // multiplayer version): each side removes one man from
                      // its FRONT row and crowns a King on its BACK row; the
                      // back-row man who was standing there slides forward
                      // into the vacated front square. 20 pieces per side,
                      // 19 men + 1 King. Tournament matches apply it
                      // deterministically (center-most squares) since
                      // there's no interactive setup phase here.
                      const apply = (side: "W" | "B") => {
                        const man = side.toLowerCase() as "w" | "b";
                        const frontRow = side === "W" ? [33, 32, 34, 31, 35] : [18, 19, 17, 20, 16];
                        const backRow = side === "W" ? [48, 47, 49, 46, 50] : [3, 2, 4, 1, 5];
                        const frontSq = frontRow.find((q) => nextBoard[q] === man);
                        const backSq = backRow.find((q) => nextBoard[q] === man || !nextBoard[q]);
                        if (frontSq === undefined || backSq === undefined) return;
                        nextBoard[frontSq] = null;                 // the sacrifice
                        if (nextBoard[backSq] === man) {
                          nextBoard[frontSq] = man;                // back-row man slides forward
                        }
                        nextBoard[backSq] = side;                  // crowned King on the back row
                      };
                      apply("W");
                      apply("B");
                    }

                    return nextBoard;
                  });
                }

                setIsTournamentGameInProgress(true);
                safeStorage.setItem("lidraughts_tournament_game_in_progress", "true");
                setStatusMessage(`Tournament Match: Playing against ${opponent}. Time Limit: ${timeControl}. Handicap: ${handicap}. Good luck!`);
                playGameStartSound(muted);
              }}
              activeMatchId={activeTournamentMatchId}
              activeMatchOutcome={activeTournamentOutcome}
              onResetMatchOutcome={() => {
                setActiveTournamentOutcome(null);
                setActiveTournamentMatchId(null);
                setActiveTournamentOpponent(null);
              }}
              muted={muted}
              playClickSound={() => playClickSound(muted)}
              playPromoSound={() => playPromoSound(muted)}
              playVictorySound={() => playVictorySound(muted)}
              canManageTournaments={isTournamentAdmin}
              onBackToHome={() => handleModeChange("Home")}
            />
          ) : (
            <GameScreen
              playMode={playMode}
              roomId={roomId}
              multiplayerStarted={multiplayerStarted}
              multiplayerGameTime={multiplayerGameTime}
              multiplayerSpecialRule={multiplayerSpecialRule}
              copiedRoomCode={copiedRoomCode}
              setCopiedRoomCode={setCopiedRoomCode}
              ws={ws}
              handleModeChange={handleModeChange}
              isComputerMode={isComputerMode}
              setShowComputerConfigModal={setShowComputerConfigModal}
              kenLevelId={kenLevelId}
              isThinking={isThinking}
              turn={turn}
              statusMessage={statusMessage}
              stats={stats}
              activePuzzleId={activePuzzleId}
              clockLimitType={isEditorMode ? "Untimed" : clockLimitType}
              clock={clockSnapshot}
              connectionStatus={connectionStatus}
              reconnectAttempts={reconnectAttempts}
              pingMs={pingMs}
              premove={premove}
              obligatoryCaptureSquares={obligatoryCaptureSquares}
              onReconnect={handleReconnect}
              onLeaveSpectate={handleLeaveSpectate}
              sendMessage={sendSocketMessage}
              inlineNotice={moveRejectedError}
              isMobile={isMobile}
              boardScale={boardScale}
              focusMode={focusMode}
              setFocusMode={setFocusMode}
              engineEval={engineEval}
              isFlipped={isFlipped}
              setIsFlipped={setIsFlipped}
              isEditorMode={isEditorMode}
              boardTheme={boardTheme}
              activeThemeColors={activeThemeColors}
              customBorder={customBorder}
              customDarkSquare={customDarkSquare}
              customLightSquare={customLightSquare}
              boardArenaRef={boardArenaRef}
              floatingEmojis={floatingEmojis}
              displayRows={displayRows}
              displayCols={displayCols}
              showSquareNumbers={showSquareNumbers}
              setShowSquareNumbers={setShowSquareNumbers}
              renderBoard={renderBoard}
              capturedAnimations={capturedAnimations}
              selectedSq={selectedSq}
              selectedDestSquares={selectedDestSquares}
              capturingSquares={capturingSquares}
              lastMove={lastMove}
              handleSquareClick={handleSquareClick}
              historyViewIndex={historyViewIndex}
              handleResetHistoryView={handleResetHistoryView}
              moveEvaluations={moveEvaluations}
              drawOfferReceived={drawOfferReceived}
              handleDrawResponse={handleDrawResponse}
              moveHistory={moveHistory}
              drawOfferSent={drawOfferSent}
              handleOfferDraw={handleOfferDraw}
              handleCancelDraw={handleCancelDraw}
              handleResign={handleResign}
              resignOfferReceived={resignOfferReceived}
              resignOfferSent={resignOfferSent}
              handleResignResponse={handleResignResponse}
              handleCancelResign={handleCancelResign}
              handleNewGame={() => handleNewGame()}
              handleUndo={handleUndo}
              handleSuggestMove={handleSuggestMove}
              editorSelectedPiece={editorSelectedPiece}
              setEditorSelectedPiece={setEditorSelectedPiece}
              editorTurn={editorTurn}
              setEditorTurn={setEditorTurn}
              handleClearBoard={handleClearBoard}
              handleStartSandboxMatch={handleStartSandboxMatch}
                            sidebarContent={sidebarContent}
              moveHistoryStrings={moveHistoryStrings}
              onHistoryNavigate={handleHistoryNavigate}
              onContinueFromHistory={handleContinueFromHistory}
              onOpenRules={() => setShowRules(true)}
              onOpenAppGuide={() => setShowAppGuideModal(true)}
              onOpenSettings={() => setShowSettingsModal(true)}
              yourColor={
                playMode === "Multiplayer" || playMode === "Tournament" ? yourColor
                : playMode === "Human_vs_AI" ? "W"
                : playMode === "AI_vs_Human" ? "B"
                : null
              }
              whiteName={
                playMode === "Multiplayer" ? guestDisplayName(roomPlayers.find((p) => p.color === "W")?.username || "White")
                : playMode === "Human_vs_AI" ? (username || "You")
                : playMode === "AI_vs_Human" ? `Ken ${kenLevelId}`
                : playMode === "Tournament" ? (yourColor === "W" ? (username || "You") : (activeTournamentOpponent || `Ken ${getTournamentKenLevelId(tournamentRound)}`))
                : "White"
              }
              blackName={
                playMode === "Multiplayer" ? guestDisplayName(roomPlayers.find((p) => p.color === "B")?.username || "Black")
                : playMode === "Human_vs_AI" ? `Ken ${kenLevelId}`
                : playMode === "AI_vs_Human" ? (username || "You")
                : playMode === "Tournament" ? (yourColor === "B" ? (username || "You") : (activeTournamentOpponent || `Ken ${getTournamentKenLevelId(tournamentRound)}`))
                : "Black"
              }
              onOpenMobileChat={playMode === "Multiplayer" && multiplayerStarted ? openMobileChatSheet : null}
              unreadRoomChat={unreadRoomChat}
              puzzleArrowSquares={puzzleArrowSquares}
              onExitPuzzles={activePuzzleId ? handleExitPuzzles : null}
              roomPlayers={roomPlayers}
              multiplayerMessages={multiplayerMessages}
              chatInput={chatInput}
              setChatInput={setChatInput}
              spectatorCount={spectatorCount}
              roomWagerAmount={multiplayerWagerAmount}
              isSpectating={isSpectating}
              opponentAway={opponentAway}
              myAwayStrikes={myAwayStrikes}
              isReviewing={isReviewing}
              reviewProgress={reviewProgress}
              onRunAIGameReview={runAIGameReview}
              lastAnalysisEval={lastAnalysisEval}
              analysisPlayVsAI={analysisPlayVsAI}
              setAnalysisPlayVsAI={setAnalysisPlayVsAI}
              analysisPlayerColor={analysisPlayerColor}
              setAnalysisPlayerColor={setAnalysisPlayerColor}
              analysisAILevel={analysisAILevel}
              setAnalysisAILevel={setAnalysisAILevel}
              setBoard={setBoard}
              setMoveHistory={setMoveHistory}
              setMoveEvaluations={setMoveEvaluations}
              setTurn={setTurn}
              setLastAnalysisEval={setLastAnalysisEval}
              savedGamesFilter={savedGamesFilter}
              setSavedGamesFilter={setSavedGamesFilter}
              savedGamesList={savedGamesList}
              myGamesList={myGamesList}
              isLoadingSavedGames={isLoadingSavedGames}
              fetchSavedGames={fetchSavedGames}
              fetchMyGames={fetchMyGames}
              onLoadSavedGame={handleLoadSavedGame}
              onOpenPastGamesModal={(filter) => {
                setPastGamesModalFilter(filter || "All");
                setShowPastGamesModal(true);
              }}
              onOpenAnalysisLabModal={(tab) => {
                setAnalysisLabTab(tab || "review");
                setShowAnalysisLabModal(true);
              }}
              onOpenPdnModal={() => {
                setPdnImportError(null);
                setPdnImportText("");
                setShowPdnImportModal(true);
                playClickSound(muted);
              }}
              onStartVoiceCall={handleStartVoiceCall}
              onStartVideoCall={handleStartVideoCall}
              isCallActive={isCallActive}
            />
          )}
          </Suspense>
        </main>

        {/* Right Sidebar (Desktop only) */}
        {isBoardScreenActive && playMode !== "Editor" && (
          <section className="k-game-desk hidden lg:flex w-full lg:w-96 border-l border-slate-800/80 bg-slate-950/45 p-4 flex-col gap-4 select-none overflow-y-auto shrink-0 h-full">
            {/* Section title */}
            <div className="flex justify-between items-center shrink-0 border-b border-slate-900 pb-2.5">
              <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 flex items-center gap-1.5 font-sans">
                <Trophy className="w-4 h-4 text-amber-500" />
                <span>Draughts Arena Desk</span>
              </h3>
              <span className="text-[9px] text-slate-500 font-mono">Ver 3.2</span>
            </div>

            {sidebarContent}
          </section>
        )}
      </div>

      {/* Bottom Tab Bar (phones, hub screens only) */}
      {!isBoardScreenActive && (
        <MobileTabBar
          playMode={playMode}
          unreadLoungeCount={unreadLoungeCount}
          onSelectMode={handleModeChange}
          onPlayVsAI={() => handleModeChange("Human_vs_AI")}
        />
      )}

      {/* Mobile slide-out drawers (menu + scorecard) */}
      <MobileDrawers
        isLeftDrawerOpen={isLeftDrawerOpen}
        setIsLeftDrawerOpen={setIsLeftDrawerOpen}
        isRightDrawerOpen={isRightDrawerOpen}
        setIsRightDrawerOpen={setIsRightDrawerOpen}
        playMode={playMode}
        handleModeChange={handleModeChange}
        onOpenFriends={() => { if (requireAccount()) setShowFriendsPage(true); }}
        onOpenProfile={() => { if (requireAccount()) setShowProfilePage(true); }}
        onOpenStore={() => { if (requireAccount()) setShowPurchaseModal(true); }}
        setShowPlayerDirectory={setShowPlayerDirectory}
        fetchPlayersDirectory={fetchPlayersDirectory}
        unreadLoungeCount={unreadLoungeCount}
        muted={muted}
        setMuted={setMuted}
        setShowRules={setShowRules}
        boardTheme={boardTheme}
        setBoardTheme={setBoardTheme}
        clockLimitType={clockLimitType}
        setClockLimitType={setClockLimitType}
        kenLevelId={kenLevelId}
        setKenLevelId={setKenLevelId}
        onSelectKenLevel={handleSidebarKenLevel}
        boardScale={boardScale}
        setBoardScale={setBoardScale}
        sidebarContent={sidebarContent}
      />

      {/* Mobile in-game Room Chat bottom sheet (multiplayer) */}
      <AnimatePresence>
        {showMobileChatSheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-slate-950/90 lg:hidden flex items-end"
            onClick={closeMobileChatSheet}
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
              className="w-full h-[85dvh] bg-[#070913] border-t border-slate-800 rounded-t-3xl flex flex-col shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="pt-2.5 pb-1 flex justify-center shrink-0">
                <div className="w-10 h-1 rounded-full bg-slate-700/80" />
              </div>
              <div className="flex justify-between items-center px-4 pb-3 border-b border-slate-900 shrink-0">
                <span className="text-xs font-black uppercase tracking-wider text-slate-300">Room Chat & Controls</span>
                <button
                  onClick={closeMobileChatSheet}
                  className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {multiplayerPanelElement}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {playMode !== "Home" && !isBoardScreenActive && (
        <button type="button" onClick={() => setShowNotifications(true)} aria-label={`Open notifications, ${notificationManager.unread} unread`}
          className="fixed bottom-20 right-4 z-[45] rounded-full border border-amber-500/30 bg-slate-900 p-3 shadow-2xl hover:bg-slate-800">
          <span className="relative"><span className="text-amber-400">🔔</span>{notificationManager.unread > 0 && <span className="absolute -top-3 -right-3 rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">{notificationManager.unread > 9 ? "9+" : notificationManager.unread}</span>}</span>
        </button>
      )}
      <NotificationCenter
        userId={authUser?.id || null}
        open={showNotifications}
        onClose={() => setShowNotifications(false)}
        onNavigate={(path) => {
          if (playMode === "Multiplayer" && roomId && !isSpectating && !serverGameEnd && multiplayerStarted) {
            showInlineNotice("Finish or leave your live match before opening a notification.", 5000);
            return;
          }
          window.location.assign(path);
        }}
        manager={notificationManager}
      />

      {/* Grandmaster's Lounge message notification -- visible everywhere,
          including mid-game. Tap to jump straight to the Lounge. */}
      <AnimatePresence>
        {loungeToast && playMode !== "Global_Chat" && (
          <motion.button
            initial={{ opacity: 0, y: -24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -24 }}
            onClick={() => {
              setLoungeToast(null);
              if (loungeToastTimerRef.current) clearTimeout(loungeToastTimerRef.current);
              handleModeChange("Global_Chat");
            }}
            className="fixed top-[calc(3.25rem+env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[65] w-[min(92vw,360px)] bg-slate-900 border border-amber-500/30 rounded-2xl px-3.5 py-2.5 shadow-2xl shadow-black/50 flex items-center gap-2.5 text-left cursor-pointer"
          >
            <span className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-amber-400" />
            </span>
            <span className="flex flex-col min-w-0">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-400">
                Lounge · {loungeToast.sender}
              </span>
              <span className="text-[11px] text-slate-200 truncate">{loungeToast.text}</span>
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Fair Play Guard warning (leaving the app mid-game) */}
      <ModalShell
        open={!!fairPlayWarning}
        onClose={() => setFairPlayWarning(null)}
        size="md"
        title="Fair Play Enforcement Warning"
        icon={<ShieldAlert className="w-5 h-5 text-rose-500 animate-pulse" />}
      >
        {fairPlayWarning && (
          <div className="flex flex-col gap-4 py-1">
            {/* Warning Level Header */}
            <div className="flex flex-col items-center gap-2 bg-gradient-to-b from-rose-950/60 to-slate-900/60 p-4 rounded-2xl border border-rose-500/30 shadow-[0_0_25px_rgba(244,63,94,0.15)] text-center">
              <div className="w-14 h-14 rounded-2xl bg-rose-500/20 border-2 border-rose-500/50 flex items-center justify-center text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.3)] animate-pulse mb-1">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <span className="text-[11px] font-mono tracking-widest uppercase text-rose-400 font-bold">
                App Departure Detected
              </span>
              <div className="text-xl font-black text-white font-mono flex items-center gap-2">
                <span>WARNING</span>
                <span className="bg-rose-500 text-slate-950 px-2.5 py-0.5 rounded-lg font-black text-lg">
                  {fairPlayWarning.strikes}
                </span>
                <span className="text-slate-400 font-normal">OF</span>
                <span className="text-slate-200">7</span>
              </div>
              <div className="w-full flex items-center justify-center gap-1.5 pt-2">
                {Array.from({ length: fairPlayWarning.maxStrikes }).map((_, i) => {
                  const isUsed = i < fairPlayWarning.strikes;
                  return (
                    <div
                      key={i}
                      className={`h-3 flex-1 rounded-full transition-all duration-300 ${
                        isUsed
                          ? "bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.8)] border border-rose-400"
                          : "bg-slate-800 border border-slate-700/60"
                      }`}
                      title={`Warning ${i + 1}`}
                    />
                  );
                })}
              </div>
            </div>

            {/* Warning Message & Rule Info */}
            <div className={`rounded-xl p-3.5 border text-center ${
              fairPlayWarning.strikes >= 7
                ? "bg-rose-950/70 border-rose-500 text-rose-200"
                : "bg-amber-500/10 border-amber-500/30 text-amber-200"
            }`}>
              <p className="text-xs font-bold leading-relaxed mb-1">
                {fairPlayWarning.message}
              </p>
              <p className="text-[11px] opacity-85 font-sans">
                {fairPlayWarning.strikes >= 7
                  ? "⚠️ You have reached your limit of 7 warnings. Any further departure will result in an immediate forfeit!"
                  : `You have ${fairPlayWarning.maxStrikes - fairPlayWarning.strikes} warning(s) remaining. The game will NOT resign you as long as you do not exceed 7 departures and have time on your clock.`}
              </p>
            </div>

            {/* Active Clock Notice */}
            <div className="flex items-center justify-center gap-2 text-[11px] text-amber-300 font-mono bg-slate-900/90 py-2.5 px-3 rounded-xl border border-slate-800">
              <Clock className="w-3.5 h-3.5 text-amber-400 animate-spin" />
              <span>Your game timer keeps running while you are away!</span>
            </div>

            {/* Primary Action Button */}
            <button
              onClick={() => setFairPlayWarning(null)}
              className="w-full bg-gradient-to-r from-rose-600 via-amber-500 to-rose-600 hover:brightness-110 text-slate-950 font-black py-3.5 rounded-xl transition text-xs uppercase tracking-wider font-mono shadow-lg cursor-pointer active:scale-98"
            >
              I Understand — Return to Match
            </button>
          </div>
        )}
      </ModalShell>

      {/* Head-to-head record between any two players */}
      <ModalShell
        open={!!pairH2H}
        onClose={() => setPairH2H(null)}
        size="sm"
        title="Head to Head"
        icon={<Swords className="w-4 h-4 text-amber-500" />}
      >
        {pairH2H && (
          <div className="flex flex-col gap-3 pb-1">
            <div className="text-center text-sm font-extrabold text-slate-100">
              {pairH2H.a} <span className="text-slate-500 text-xs font-bold">vs</span> {pairH2H.b}
            </div>
            {pairH2H.loading ? (
              <p className="text-xs text-slate-500 text-center py-6">Tallying every game they've played...</p>
            ) : pairH2H.gamesPlayed === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">These two haven't finished a game against each other yet.</p>
            ) : (
              <>
                <div className="text-center text-xs text-slate-400">
                  <span className="text-amber-400 font-black text-base">{pairH2H.gamesPlayed}</span> games played
                </div>
                <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden flex">
                  <div className="h-full bg-emerald-500" style={{ width: `${(pairH2H.aWins / pairH2H.gamesPlayed) * 100}%` }} />
                  <div className="h-full bg-slate-600" style={{ width: `${(pairH2H.draws / pairH2H.gamesPlayed) * 100}%` }} />
                  <div className="h-full bg-rose-500" style={{ width: `${(pairH2H.bWins / pairH2H.gamesPlayed) * 100}%` }} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-slate-950/60 border border-slate-900 rounded-xl py-2.5">
                    <div className="text-base font-black text-emerald-400">{pairH2H.aWins}</div>
                    <div className="text-[9px] text-slate-500 font-bold uppercase truncate px-1">{pairH2H.a}</div>
                    <div className="text-[10px] font-mono text-emerald-400/80">{Math.round((pairH2H.aWins / pairH2H.gamesPlayed) * 100)}%</div>
                  </div>
                  <div className="bg-slate-950/60 border border-slate-900 rounded-xl py-2.5">
                    <div className="text-base font-black text-slate-300">{pairH2H.draws}</div>
                    <div className="text-[9px] text-slate-500 font-bold uppercase">Draws</div>
                    <div className="text-[10px] font-mono text-slate-400">{Math.round((pairH2H.draws / pairH2H.gamesPlayed) * 100)}%</div>
                  </div>
                  <div className="bg-slate-950/60 border border-slate-900 rounded-xl py-2.5">
                    <div className="text-base font-black text-rose-400">{pairH2H.bWins}</div>
                    <div className="text-[9px] text-slate-500 font-bold uppercase truncate px-1">{pairH2H.b}</div>
                    <div className="text-[10px] font-mono text-rose-400/80">{Math.round((pairH2H.bWins / pairH2H.gamesPlayed) * 100)}%</div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </ModalShell>

      {/* ------------------------- Modals ------------------------- */}
      <RulesModal open={showRules} onClose={() => setShowRules(false)} />

      <SettingsModal
        open={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        muted={muted}
        setMuted={setMuted}
        showSquareNumbers={showSquareNumbers}
        setShowSquareNumbers={setShowSquareNumbers}
        boardTheme={boardTheme}
        setBoardTheme={setBoardTheme}
        customLightSquare={customLightSquare}
        setCustomLightSquare={setCustomLightSquare}
        customDarkSquare={customDarkSquare}
        setCustomDarkSquare={setCustomDarkSquare}
        customBorder={customBorder}
        setCustomBorder={setCustomBorder}
        boardScale={boardScale}
        setBoardScale={setBoardScale}
        focusMode={focusMode}
        setFocusMode={setFocusMode}
        reducedMotion={reducedMotion}
        setReducedMotion={setReducedMotion}
        onReplaySplash={() => setShowSplash(true)}
      />

      <AppGuideModal open={showAppGuideModal} onClose={() => setShowAppGuideModal(false)} />

      <AnalysisSetupModal
        open={showAnalysisModal}
        onClose={() => setShowAnalysisModal(false)}
        onAnalyzePastGames={() => {
          setSavedGamesFilter("Mine");
          setPlayMode("Analysis");
          setBoard(createInitialBoard());
          initialPositionRef.current = { board: createInitialBoard(), turn: "W" };
          setMoveHistory([]);
          setHistoryViewIndex(null);
          setShowAnalysisModal(false);
          playClickSound(muted);
        }}
        onBlankBoard={() => {
          setPlayMode("Analysis");
          setBoard(createInitialBoard());
          initialPositionRef.current = { board: createInitialBoard(), turn: "W" };
          setMoveHistory([]);
          setTurn("W");
          setHistoryViewIndex(null);
          setMoveEvaluations({});
          setShowAnalysisModal(false);
          setStatusMessage("Blank Analysis Board. Make moves to explore!");
          playClickSound(muted);
        }}
        onImportPdn={() => {
          setShowAnalysisModal(false);
          setPdnImportError(null);
          setPdnImportText("");
          setShowPdnImportModal(true);
          playClickSound(muted);
        }}
      />

      <PdnImportModal
        open={showPdnImportModal}
        onClose={() => setShowPdnImportModal(false)}
        pdnImportText={pdnImportText}
        setPdnImportText={setPdnImportText}
        pdnImportError={pdnImportError}
        onImport={handlePdnImport}
      />

      <CoinsPurchaseModal
        open={showPurchaseModal}
        onClose={() => setShowPurchaseModal(false)}
        coinBalance={coinBalance}
        storeTab={storeTab}
        setStoreTab={setStoreTab}
        coinPackages={coinPackages}
        selectedPackageId={selectedPackageId}
        setSelectedPackageId={setSelectedPackageId}
        purchaseReceiptRef={purchaseReceiptRef}
        setPurchaseReceiptRef={setPurchaseReceiptRef}
        purchaseError={purchaseError}
        setPurchaseError={setPurchaseError}
        purchaseSubmitting={purchaseSubmitting}
        purchaseSubmitted={purchaseSubmitted}
        setPurchaseSubmitted={setPurchaseSubmitted}
        onSubmitPurchase={handleSubmitPurchaseReceipt}
        coinSettings={coinSettings}
        withdrawCoins={withdrawCoins}
        setWithdrawCoins={setWithdrawCoins}
        withdrawAccountName={withdrawAccountName}
        setWithdrawAccountName={setWithdrawAccountName}
        withdrawAccountNumber={withdrawAccountNumber}
        setWithdrawAccountNumber={setWithdrawAccountNumber}
        withdrawBankName={withdrawBankName}
        setWithdrawBankName={setWithdrawBankName}
        withdrawError={withdrawError}
        setWithdrawError={setWithdrawError}
        withdrawSubmitting={withdrawSubmitting}
        withdrawSubmitted={withdrawSubmitted}
        setWithdrawSubmitted={setWithdrawSubmitted}
        onSubmitWithdrawal={handleSubmitWithdrawal}
      />

      <ComputerConfigModal
        open={showComputerConfigModal}
        onClose={() => setShowComputerConfigModal(false)}
        coinBalance={coinBalance}
        profileStats={profileStats}
        coinSettings={coinSettings}
        kenLevelId={kenLevelId}
        setKenLevelId={setKenLevelId}
        setStatusMessage={setStatusMessage}
        muted={muted}
        playMode={playMode}
        setPlayMode={setPlayMode}
        purchaseSubmitted={purchaseSubmitted}
        onUnlockKenLevel={handleUnlockKenLevel}
        onOpenStore={() => {
          if (!requireAccount("Sign in to purchase Kentro Coins and unlock premium levels.")) return;
          setPurchaseError(null);
          setPurchaseSubmitted(false);
          setPurchaseReceiptRef("");
          setShowPurchaseModal(true);
          playClickSound(muted);
        }}
        onApplyStart={() => {
          if (guestMode) {
            if (!takeGuestAiTrial()) return;
            guestAiStartReservedRef.current = true;
          }
          // Starting from the Editor: the config modal opens while playMode
          // is still "Editor". Unless the player happened to toggle a side,
          // the game would "start" with no AI allowed to move and every tap
          // still painting pieces. Force a real AI mode first.
          if (!AI_MODES.includes(playMode)) setPlayMode("Human_vs_AI");
          setShowComputerConfigModal(false);
          safeStorage.removeItem(AI_GAME_STORAGE_KEY);
          handleNewGame(pendingSandboxBoard || undefined, pendingSandboxBoard ? editorTurn : undefined);
          setPendingSandboxBoard(null);
          playPromoSound(muted);
        }}
        onOpenPastGamesModal={(f) => {
          setPastGamesModalFilter(f || "AI");
          setShowPastGamesModal(true);
        }}
      />

      <GameOverModal
        gameOverInfo={gameOverInfo}
        statusMessage={statusMessage}
        player1={username || "You"}
        player2={gameOverOpponentName}
        outcome={gameOverInfo?.outcome}
        resultReason={gameOverReason}
        gameCode={playMode === "Multiplayer" ? (room.gameCode ?? roomId ?? undefined) : undefined}
        previousGameCode={playMode === "Multiplayer" ? room.previousGameCode : undefined}
        movesCount={gameOverInfo?.movesCount ?? moveHistory.length}
        durationSeconds={gameOverInfo?.durationSeconds ?? 0}
        currentUsername={username || undefined}
        rematchState={playMode === "Multiplayer" ? rematchState : { status: "idle" }}
        onLevelUp={handlePostGameLevelUp}
        onRematch={handlePostGameRematch}
        onCancelRematch={playMode === "Multiplayer" ? handleCancelRematch : undefined}
        onAcceptRematch={playMode === "Multiplayer" ? () => handleRematchResponse(true) : undefined}
        onDeclineRematch={playMode === "Multiplayer" ? () => handleRematchResponse(false) : undefined}
        onAnalyzeGame={handleAnalyzeCurrentGame}
        onViewReplay={handleViewReplay}
        onBackToLobby={handlePostGameBackToLobby}
        onWaitForNextGame={seriesInProgress ? handleWaitForNextGame : undefined}
        onGoBackToAnalysis={resumedAnalysisSnapshot ? handleGoBackToAnalysis : undefined}
        isUnsavedPracticeGame={isUnsavedPracticeGame}
        seriesNote={
          playMode === "Multiplayer" && seriesInfo && seriesInfo.bestOf > 1
            ? seriesInfo.seriesOver
              ? seriesInfo.seriesWinner
                ? `🏆 ${seriesInfo.seriesWinner} wins the ${seriesInfo.bestOf === 5 ? "Best of 5" : "Best of 3"} series!`
                : "Series drawn — the pot is split."
              : `Game ${seriesInfo.gameNumber} of ${seriesInfo.bestOf} complete. The next game starts automatically — colors swap.`
            : null
        }
        hideRematch={seriesInProgress || (playMode === "Multiplayer" && isSpectating)}
      />

      {showPastGamesModal && <Suspense fallback={null}><PastGamesModal
        open={showPastGamesModal}
        onClose={() => setShowPastGamesModal(false)}
        myGamesList={myGamesList}
        savedGamesList={savedGamesList}
        initialFilter={pastGamesModalFilter}
        fetchMyGames={() => { void fetchMyGames(1000); }}
        username={username || "Player"}
        onAnalyzeGame={(g) => {
          handleLoadSavedGame(g);
          setShowPastGamesModal(false);
          setPlayMode("Analysis");
        }}
      /></Suspense>}

      {showAnalysisLabModal && <Suspense fallback={null}><AnalysisLabModal
        open={showAnalysisLabModal}
        onClose={() => setShowAnalysisLabModal(false)}
        initialTab={analysisLabTab}
        moveHistory={moveHistory}
        moveHistoryStrings={moveHistoryStrings}
        historyViewIndex={historyViewIndex}
        onHistoryNavigate={(idx) => handleHistoryNavigate(idx)}
        onContinueFromHistory={handleContinueFromHistory}
        engineEval={engineEval}
        moveEvaluations={moveEvaluations}
        whiteName={whitePlayerName}
        blackName={blackPlayerName}
        activeTurn={turn}
        renderBoard={renderBoard}
        isReviewing={isReviewing}
        reviewProgress={reviewProgress}
        onRunAIGameReview={runAIGameReview}
        lastAnalysisEval={lastAnalysisEval}
        setBoard={setBoard}
        setTurn={setTurn}
        setMoveHistory={setMoveHistory}
        setMoveEvaluations={setMoveEvaluations}
        setLastAnalysisEval={setLastAnalysisEval}
        setStatusMessage={setStatusMessage}
        onOpenPdnModal={() => {
          setPdnImportError(null);
          setPdnImportText("");
          setShowPdnImportModal(true);
          playClickSound(muted);
        }}
        onPracticeWithKen={() => {
          setShowAnalysisLabModal(false);
          handleModeChange("Human_vs_AI");
        }}
      /></Suspense>}

      <SandboxPlayChoiceModal
        open={showSandboxPlayChoice}
        onClose={() => setShowSandboxPlayChoice(false)}
        onPlayVsAI={handleSandboxPlayVsAI}
        onPlayVsHuman={handleSandboxPlayVsHuman}
        editorTurn={editorTurn}
        setEditorTurn={setEditorTurn}
      />

      {showPlayerDirectory && <Suspense fallback={null}><PlayerDirectoryModal
        open={showPlayerDirectory}
        onClose={() => {
          setShowPlayerDirectory(false);
          setViewingPlayer(null);
          setViewingPlayerStats(null);
          setViewingPlayerGames([]);
          setHeadToHead(null);
        }}
        viewingPlayer={viewingPlayer}
        viewingPlayerStats={viewingPlayerStats}
        viewingPlayerGames={viewingPlayerGames}
        isLoadingDirectory={isLoadingDirectory}
        isLoadingPlayerProfile={isLoadingPlayerProfile}
        playersDirectoryList={playersDirectoryList}
        headToHead={headToHead}
        onBack={() => {
          setViewingPlayer(null);
          setViewingPlayerStats(null);
          setViewingPlayerGames([]);
          setHeadToHead(null);
        }}
        onOpenPlayerProfile={handleOpenPlayerProfile}
        onLoadGame={(g) => {
          handleLoadSavedGame(g);
          setShowPlayerDirectory(false);
          setViewingPlayer(null);
          setPlayMode("Analysis");
        }}
      /></Suspense>}

      {showAdminPanel && <Suspense fallback={null}><AdminPanel onClose={() => setShowAdminPanel(false)} /></Suspense>}

      {showProfilePage && (
        <Suspense fallback={null}><ProfilePage
          username={username || "Player"}
          profileStats={profileStats}
          coinBalance={coinBalance}
          memberSince={authUser?.created_at ?? null}
          onClose={() => setShowProfilePage(false)}
          onSaveAvatar={handleSaveAvatar}
          onSignOut={() => {
            signOutUser().catch((err) => console.error("Sign out failed:", err));
          }}
        /></Suspense>
      )}

      {showFriendsPage && (
        <Suspense fallback={null}><FriendsPage
          username={username || "Player"}
          userElo={profileStats.elo}
          myGamesList={myGamesList}
          onOpenLounge={() => {
            setShowFriendsPage(false);
            handleModeChange("Global_Chat");
          }}
          onClose={() => setShowFriendsPage(false)}
        /></Suspense>
      )}

      {/* Live In-Game Sharp Video Call Overlay */}
      {isCallActive && (
        <FloatingVideoCall
          opponentName={callOpponentName || roomPlayers.find((p) => p.username !== username)?.username || "Opponent"}
          callState={voiceCallState}
          callType={callType}
          localStream={localMediaStream}
          localScreenStream={localScreenStream}
          remoteStream={remoteAudioStream}
          remoteScreenStream={remoteScreenStream}
          isMicMuted={voiceMuted}
          isVideoMuted={videoMuted}
          isRemoteVideoEnabled={isRemoteVideoEnabled}
          callDuration={callDuration}
          networkQuality={networkQuality}
          isReconnecting={isReconnecting}
          renegotiationAttempt={renegotiationAttempt}
          maxRenegotiationAttempts={maxRenegotiationAttempts}
          isScreenSharing={isScreenSharing}
          isRemoteScreenSharing={isRemoteScreenSharing}
          audioRef={remoteVoiceAudioRef}
          onToggleScreenShare={toggleScreenShare}
          onToggleMic={toggleMic}
          onToggleVideo={toggleVideo}
          onFlipCamera={flipCamera}
          onEndCall={endCall}
          board={board}
          turn={turn}
          lastMove={lastMove}
          yourColor={yourColor}
          whiteName={whitePlayerName}
          blackName={blackPlayerName}
        />
      )}

      <ModalShell open={!!guestLimitNotice} onClose={() => setGuestLimitNotice(null)} size="sm" zIndex={130} title="Unlock more Kentro Draught">
        <p className="text-sm text-slate-300 mt-3 leading-relaxed">{guestLimitNotice}</p>
        <button type="button" className="w-full bg-amber-500 text-slate-950 font-extrabold rounded-xl py-3 mt-5" onClick={() => { setGuestLimitNotice(null); setGuestActive(false); setGuestEnabled(false); setUsername(null); gameSocket.disconnect(); }}>Sign In or Create Account</button>
        <button type="button" className="w-full text-slate-400 py-3 text-sm mt-1" onClick={() => { setGuestLimitNotice(null); if (playMode === "Multiplayer" && !multiplayerStarted) setPlayMode("Home"); }}>Keep Exploring</button>
      </ModalShell>

      {/* Splash Screen */}
      {showSplash && (
        <KentroSplashScreen
          onComplete={handleSplashComplete}
          canSkip
        />
      )}
    </div>
    </AdminProfileProvider>
  );
}
