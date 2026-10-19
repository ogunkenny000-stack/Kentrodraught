import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft, Cpu, Check, Copy, Crown, Plus, RotateCcw, Sparkles, RefreshCw,
  Layout, Wrench, Trash2, Handshake, Flag, MessageSquare, ShieldAlert,
  Menu as MenuIcon, SkipBack, ChevronLeft, ChevronRight, SkipForward, Play, Pause,
  Settings as SettingsIcon, BookOpen, Volume2, VolumeX, Swords, Eye, Trophy, Clock, X,
  Phone, Video
} from "lucide-react";
import { EvaluationBar } from "../EvaluationBar";
import { BestMoveArrow } from "../BestMoveArrow";
import { Board, Move, Piece, ngRcToSq, boardToScanFen, hubMoveStringToNigerian } from "../../gameLogic";
import { PlayMode, BoardTheme, ThemeColors, EngineEval, MoveEvalResult } from "../../types";
import { AdminTappableName } from "../../lib/adminProfileContext";
import { Avatar } from "../ui/Avatar";
import { MobileBoardDock } from "./MobileBoardDock";
import { ActionMenuSheet } from "../modals/ActionMenuSheet";
import { ClockText } from "../ChessClock";
import type { ClockSnapshot } from "../../lib/useServerClock";

export interface GameScreenProps {
  playMode: PlayMode;
  roomId: string | null;
  multiplayerStarted: boolean;
  multiplayerGameTime: number;
  multiplayerSpecialRule: string;
  copiedRoomCode: boolean;
  setCopiedRoomCode: React.Dispatch<React.SetStateAction<boolean>>;
  ws: WebSocket | null;
  handleModeChange: (mode: PlayMode) => void;
  isComputerMode: boolean;
  setShowComputerConfigModal: React.Dispatch<React.SetStateAction<boolean>>;
  kenLevelId: number;
  isThinking: boolean;
  turn: "W" | "B";
  statusMessage: string;
  stats: { whitePieces: number; blackPieces: number; whiteKings: number; blackKings: number };
  activePuzzleId: string | null;
  clockLimitType: "Blitz" | "Rapid" | "Classical" | "Untimed";
  /** Clock snapshot (server-authoritative online, local otherwise); the pills tick themselves. */
  clock: ClockSnapshot | null;
  /** Socket status -- shows the "Reconnecting…" badge and pauses board input while down. */
  connectionStatus?: "disconnected" | "connecting" | "connected";
  /** Preferred outbound path (socket manager: queue / refuse / reconnect). */
  sendMessage?: (msg: { type: string } & Record<string, unknown>) => boolean;
  /** Transient in-game notice (rejected move, refused send, server error). */
  inlineNotice?: string | null;
  isMobile: boolean;
  boardScale: number;
  focusMode: boolean;
  setFocusMode: (value: boolean) => void;
  engineEval: EngineEval;
  isFlipped: boolean;
  setIsFlipped: React.Dispatch<React.SetStateAction<boolean>>;
  isEditorMode: boolean;
  boardTheme: BoardTheme;
  activeThemeColors: ThemeColors;
  customBorder: string;
  customDarkSquare: string;
  customLightSquare: string;
  boardArenaRef: React.RefObject<HTMLDivElement | null>;
  floatingEmojis: { id: string; emoji: string; sender: string }[];
  displayRows: number[];
  displayCols: number[];
  showSquareNumbers: boolean;
  setShowSquareNumbers: React.Dispatch<React.SetStateAction<boolean>>;
  renderBoard: Board;
  capturedAnimations: { sq: number; piece: string; id: string }[];
  selectedSq: number | null;
  selectedDestSquares: Set<number>;
  capturingSquares: Map<number, number>;
  lastMove: { from: number; to: number; caps?: number[] } | null;
  handleSquareClick: (sq: number) => void;
  historyViewIndex: number | null;
  handleResetHistoryView: () => void;
  moveEvaluations: Record<number, MoveEvalResult>;
  drawOfferReceived: string | null;
  handleDrawResponse: (accept: boolean) => void;
  moveHistory: Move[];
  drawOfferSent: boolean;
  handleOfferDraw: () => void;
  handleCancelDraw?: () => void;
  handleResign: () => void;
  resignOfferReceived: string | null;
  handleResignResponse: (accept: boolean) => void;
  resignOfferSent: boolean;
  handleCancelResign?: () => void;
  handleNewGame: () => void;
  handleUndo: () => void;
  handleSuggestMove: () => void;
  editorSelectedPiece: Piece;
  setEditorSelectedPiece: React.Dispatch<React.SetStateAction<Piece>>;
  editorTurn: "W" | "B";
  setEditorTurn: React.Dispatch<React.SetStateAction<"W" | "B">>;
  handleClearBoard: () => void;
  handleStartSandboxMatch: () => void;
  sidebarContent: React.ReactNode;
  onOpenMobileChat: (() => void) | null;
  unreadRoomChat: number;
  puzzleArrowSquares: { from: number; to: number } | null;
  onExitPuzzles: (() => void) | null;
  opponentAway: { username: string; strikes: number; maxStrikes: number } | null;
  myAwayStrikes?: number;
  yourColor: "W" | "B" | null;
  whiteName: string;
  blackName: string;

  // New props for standard native app feel
  moveHistoryStrings?: string[];
  onHistoryNavigate?: (index: number) => void;
  onContinueFromHistory?: () => void;
  onOpenRules?: () => void;
  onOpenAppGuide?: () => void;
  onOpenSettings?: () => void;

  /** PVP Live Room Chat & Spectator Props */
  roomPlayers?: { username: string; color: "W" | "B"; ready: boolean }[];
  multiplayerMessages?: { from: string; text: string }[];
  chatInput?: string;
  setChatInput?: (val: string) => void;
  spectatorCount?: number;
  roomWagerAmount?: number | null;
  isSpectating?: boolean;

  /** Analysis, Smart Lab, Practice & Match Archive Props */
  isReviewing?: boolean;
  reviewProgress?: number;
  onRunAIGameReview?: () => void;
  lastAnalysisEval?: { quality: string; comment: string; delta: number } | null;
  analysisPlayVsAI?: boolean;
  setAnalysisPlayVsAI?: React.Dispatch<React.SetStateAction<boolean>>;
  analysisPlayerColor?: "W" | "B";
  setAnalysisPlayerColor?: React.Dispatch<React.SetStateAction<"W" | "B">>;
  analysisAILevel?: number;
  setAnalysisAILevel?: React.Dispatch<React.SetStateAction<number>>;
  setBoard?: React.Dispatch<React.SetStateAction<Board>>;
  setMoveHistory?: React.Dispatch<React.SetStateAction<Move[]>>;
  setMoveEvaluations?: React.Dispatch<React.SetStateAction<Record<number, MoveEvalResult>>>;
  setTurn?: React.Dispatch<React.SetStateAction<"W" | "B">>;
  setLastAnalysisEval?: React.Dispatch<React.SetStateAction<{ quality: string; comment: string; delta: number } | null>>;
  setStatusMessage?: React.Dispatch<React.SetStateAction<string>>;
  savedGamesFilter?: "All" | "Mine";
  setSavedGamesFilter?: React.Dispatch<React.SetStateAction<"All" | "Mine">>;
  savedGamesList?: any[];
  myGamesList?: any[];
  isLoadingSavedGames?: boolean;
  fetchSavedGames?: () => void;
  fetchMyGames?: () => void;
  onLoadSavedGame?: (game: any) => void;
  onOpenPastGamesModal?: (filter?: "All" | "AI" | "PvP" | "Tournament") => void;
  onOpenAnalysisLabModal?: (tab?: "review" | "coach" | "engine" | "tools") => void;
  onOpenPdnModal?: () => void;
  onStartVoiceCall?: () => void;
  onStartVideoCall?: () => void;
  isCallActive?: boolean;
  reconnectAttempts?: number;
  onReconnect?: () => void;
  onLeaveSpectate?: () => void;
  premove?: { from: number; to?: number } | null;
  obligatoryCaptureSquares?: Set<number>;
  pingMs?: number;
}

export function GameScreen(props: GameScreenProps) {
  const {
    playMode, roomId, multiplayerStarted, multiplayerGameTime, multiplayerSpecialRule,
    copiedRoomCode, setCopiedRoomCode, ws, handleModeChange, isComputerMode,
    setShowComputerConfigModal, kenLevelId, isThinking, turn, statusMessage, stats,
    activePuzzleId, clockLimitType, clock, connectionStatus, sendMessage, inlineNotice, isMobile, boardScale, focusMode, setFocusMode,
    reconnectAttempts = 0, onReconnect, onLeaveSpectate, premove, obligatoryCaptureSquares, pingMs,
    engineEval, isFlipped, setIsFlipped, isEditorMode, boardTheme, activeThemeColors,
    customBorder, customDarkSquare, customLightSquare, boardArenaRef, floatingEmojis,
    displayRows, displayCols, showSquareNumbers, setShowSquareNumbers, renderBoard,
    capturedAnimations, selectedSq, selectedDestSquares, capturingSquares, lastMove,
    handleSquareClick, historyViewIndex, handleResetHistoryView, moveEvaluations,
    drawOfferReceived, handleDrawResponse, moveHistory, drawOfferSent, handleOfferDraw, handleCancelDraw,
    yourColor, whiteName, blackName,
    handleResign, resignOfferReceived, handleResignResponse, resignOfferSent, handleCancelResign,
    handleNewGame, handleUndo, handleSuggestMove, editorSelectedPiece,
    setEditorSelectedPiece, editorTurn, setEditorTurn, handleClearBoard,
    handleStartSandboxMatch, sidebarContent, onOpenMobileChat, unreadRoomChat,
    puzzleArrowSquares, onExitPuzzles, opponentAway, myAwayStrikes,
    moveHistoryStrings = [], onHistoryNavigate, onContinueFromHistory,
    onOpenRules, onOpenAppGuide, onOpenSettings,
    roomPlayers, multiplayerMessages, chatInput, setChatInput, spectatorCount, roomWagerAmount, isSpectating,
    isReviewing, reviewProgress, onRunAIGameReview, lastAnalysisEval, analysisPlayVsAI, setAnalysisPlayVsAI,
    analysisPlayerColor, setAnalysisPlayerColor, analysisAILevel, setAnalysisAILevel, setBoard, setMoveHistory,
    setMoveEvaluations, setTurn, setLastAnalysisEval, setStatusMessage: setStatusMsgProp,
    savedGamesFilter, setSavedGamesFilter, savedGamesList, myGamesList, isLoadingSavedGames,
    fetchSavedGames, fetchMyGames, onLoadSavedGame, onOpenPastGamesModal, onOpenAnalysisLabModal, onOpenPdnModal,
    onStartVoiceCall, onStartVideoCall, isCallActive
  } = props;

  // State for the native bottom action menu sheet (☰)
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [copiedFen, setCopiedFen] = useState(false);
  const [copiedPdn, setCopiedPdn] = useState(false);
  const [showThreatArrow, setShowThreatArrow] = useState(true);
  const [boardToolsOpen, setBoardToolsOpen] = useState(false);
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key.toLowerCase() !== "z" || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName || "")) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      setFocusMode(!focusMode);
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [focusMode, setFocusMode]);
  useEffect(() => {
    if (!boardToolsOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setBoardToolsOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [boardToolsOpen]);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);

  // High-performance pointer tracking for instant mobile tap response (<18px touch jitter tolerance)
  const pointerStartRef = useRef<{ x: number; y: number; sq: number; time: number } | null>(null);
  const lastPointerTapTimeRef = useRef<number>(0);

  // Auto-play move-by-move timer
  useEffect(() => {
    if (!isAutoPlaying) return;
    const interval = setInterval(() => {
      if (moveHistory.length === 0) {
        setIsAutoPlaying(false);
        return;
      }
      if (historyViewIndex === null) {
        handleNav(0);
      } else if (historyViewIndex < moveHistory.length - 1) {
        handleNav(historyViewIndex + 1);
      } else {
        handleResetHistoryView();
        setIsAutoPlaying(false);
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [isAutoPlaying, historyViewIndex, moveHistory.length]);

  const toggleAutoPlay = () => {
    if (moveHistory.length === 0) return;
    if (!isAutoPlaying) {
      if (historyViewIndex === null || historyViewIndex >= moveHistory.length - 1) {
        handleNav(0);
      }
      setIsAutoPlaying(true);
    } else {
      setIsAutoPlaying(false);
    }
  };

  // Extract candidate move arrow from engine PV
  const parsedPvMove = useMemo(() => {
    if (!engineEval?.pv) return null;
    const firstTok = engineEval.pv.trim().split(/\s+/)[0];
    if (!firstTok) return null;
    const res = hubMoveStringToNigerian(firstTok);
    if (res && typeof res.from === "number" && typeof res.to === "number") {
      return { from: res.from, to: res.to };
    }
    return null;
  }, [engineEval?.pv]);

  const activeArrowSquares = puzzleArrowSquares ?? (
    (showThreatArrow || playMode === "Analysis")
      ? (
          historyViewIndex !== null
            ? (
                moveEvaluations[historyViewIndex]?.bestMoveSquares || 
                (moveHistory[historyViewIndex] ? { from: moveHistory[historyViewIndex].from, to: moveHistory[historyViewIndex].to } : undefined)
              )
            : parsedPvMove
        )
      : undefined
  );

  // Active last move from moveHistory (or lastMove prop or history navigation)
  const effectiveLastMove = useMemo(() => {
    if (lastMove && typeof lastMove.from === "number" && typeof lastMove.to === "number") {
      return lastMove;
    }
    if (moveHistory && moveHistory.length > 0) {
      if (typeof historyViewIndex === "number" && historyViewIndex >= 0 && historyViewIndex < moveHistory.length) {
        return moveHistory[historyViewIndex];
      }
      return moveHistory[moveHistory.length - 1];
    }
    return lastMove ?? null;
  }, [lastMove, moveHistory, historyViewIndex]);

  // Seat orientation: which color sits at the BOTTOM of the board?
  const aiOpponentColor: "W" | "B" | null =
    playMode === "Human_vs_AI" ? "B" : playMode === "AI_vs_Human" ? "W" : null;
  const bottomColor: "W" | "B" = aiOpponentColor
    ? (aiOpponentColor === "W" ? "B" : "W")
    : isFlipped ? "B" : "W";
  const topColor: "W" | "B" = bottomColor === "W" ? "B" : "W";

  const seatLabel = (c: "W" | "B") => {
    const nm = c === "W" ? whiteName : blackName;
    const you = yourColor === c ? " (You)" : "";
    return `${nm}${you}`;
  };

  const capturedBy = (c: "W" | "B") => Math.max(0, 20 - (c === "W" ? stats.blackPieces : stats.whitePieces));

  // Material and King tally for Analysis Mode
  const analysisStats = useMemo(() => {
    let wMen = 0, bMen = 0, wKings = 0, bKings = 0;
    if (renderBoard) {
      for (let sq = 1; sq <= 50; sq++) {
        const p = renderBoard[sq];
        if (p === "w") wMen++;
        else if (p === "W") wKings++;
        else if (p === "b") bMen++;
        else if (p === "B") bKings++;
      }
    }
    const wTotal = wMen + wKings;
    const bTotal = bMen + bKings;
    return {
      wMen, bMen, wKings, bKings, wTotal, bTotal,
      diff: wTotal - bTotal,
      kingDiff: wKings - bKings,
    };
  }, [renderBoard]);

  // Keyboard navigation for Analysis Board and replay
  useEffect(() => {
    if (playMode !== "Analysis" && playMode !== "Training") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (moveHistory.length === 0) return;
        if (historyViewIndex === null) {
          if (moveHistory.length >= 2) handleNav(moveHistory.length - 2);
          else handleNav(0);
        } else if (historyViewIndex > 0) {
          handleNav(historyViewIndex - 1);
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (moveHistory.length === 0) return;
        if (historyViewIndex !== null && historyViewIndex < moveHistory.length - 1) {
          handleNav(historyViewIndex + 1);
        } else {
          handleResetHistoryView();
        }
      } else if (e.key === "Home" || e.key === "ArrowUp") {
        e.preventDefault();
        if (moveHistory.length > 0) handleNav(0);
      } else if (e.key === "End" || e.key === "ArrowDown") {
        e.preventDefault();
        handleResetHistoryView();
      } else if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        toggleAutoPlay();
      } else if (e.key === "f" || e.key === "F") {
        setIsFlipped((f) => !f);
      } else if (e.key === "u" || e.key === "U") {
        handleUndo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [playMode, historyViewIndex, moveHistory.length, handleUndo]);

  // Copy helper routines
  const handleCopyFen = async () => {
    try {
      await navigator.clipboard.writeText(boardToScanFen(renderBoard, turn));
      setCopiedFen(true);
      setTimeout(() => setCopiedFen(false), 1500);
    } catch {}
  };

  const handleCopyPdn = async () => {
    try {
      const pdn = moveHistoryStrings
        .map((mv, i) => (i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ${mv}` : mv))
        .join(" ");
      await navigator.clipboard.writeText(pdn || "(no moves)");
      setCopiedPdn(true);
      setTimeout(() => setCopiedPdn(false), 1500);
    } catch {}
  };

  // Safe navigation wrapper
  const handleNav = (idx: number) => {
    if (onHistoryNavigate) {
      onHistoryNavigate(idx);
    }
  };

  const currentMoveIndex = historyViewIndex !== null ? historyViewIndex : moveHistory.length - 1;

  return (
    <>
      <div className="k-match-screen flex-1 w-full h-full max-h-full flex flex-col items-center justify-between p-1 sm:p-2.5 overflow-hidden select-none relative">

        {/* ========================================================================= */}
        {/* 1. TOP SUB-HEADER: CLEAN QUICK ACTIONS & STATUS */}
        {/* ========================================================================= */}
        <div className="k-match-toolbar" role="toolbar" aria-label="Game toolbar">
          <button
            type="button"
            className="k-match-back"
            onClick={() => { if(activePuzzleId && onExitPuzzles) onExitPuzzles(); else if(isSpectating && onLeaveSpectate) onLeaveSpectate(); else handleModeChange("Home"); }}
            aria-label="Leave game"
          ><ArrowLeft size={18}/><span>Back</span></button>
          <div className="k-match-state" role="status" aria-live="polite"><span className={`k-turn-indicator ${isThinking ? "thinking" : turn === "W" ? "gold" : "black"}`}/><span>{statusMessage}</span></div>
          {playMode === "Multiplayer" && connectionStatus !== "connected" && <span className="k-match-reconnect">Reconnecting…</span>}
          {playMode === "Multiplayer" && connectionStatus === "connected" && typeof pingMs === "number" && <span className="k-match-ping" title={`Server latency: ${pingMs} ms`}>{pingMs > 0 ? `${pingMs} ms` : "Syncing"}</span>}
          <div className="k-match-tools-wrapper"><button type="button" className="k-match-more" aria-label="Board options" aria-expanded={boardToolsOpen} onClick={() => setBoardToolsOpen(v => !v)}><MenuIcon size={19}/><span>Options</span></button>
            {boardToolsOpen && <div className="k-match-tools-popover" role="group" aria-label="Board options">
              {isComputerMode && <button onClick={() => {setShowComputerConfigModal(true);setBoardToolsOpen(false);}}><Cpu size={17}/> Engine Ken · Level {kenLevelId}</button>}
              <button onClick={() => {setIsFlipped(!isFlipped);setBoardToolsOpen(false);}}><RefreshCw size={17}/> Flip board</button>
              <button onClick={() => {setShowSquareNumbers(!showSquareNumbers);setBoardToolsOpen(false);}}><Layout size={17}/> {showSquareNumbers ? "Hide" : "Show"} square numbers</button>
              <button onClick={() => {setFocusMode(!focusMode);setBoardToolsOpen(false);}} aria-pressed={focusMode}><Eye size={17}/> {focusMode ? "Exit focus mode" : "Focus on board"}</button>
              <button onClick={() => {setShowThreatArrow(!showThreatArrow);setBoardToolsOpen(false);}}><Sparkles size={17}/> {showThreatArrow ? "Hide" : "Show"} best-move arrow</button>
              {onOpenSettings && <button onClick={() => { onOpenSettings(); setBoardToolsOpen(false); }}><SettingsIcon size={17}/> All settings</button>}
            </div>}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 2. OPPONENT PLAYER HUD (TOP) / ANALYSIS BAR / EDITOR BAR */}
        {/* ========================================================================= */}
        {isEditorMode ? (
          <div className="w-full max-w-[min(96vw,520px)] flex items-center justify-between px-3 py-1.5 bg-slate-900/95 border border-slate-800/90 rounded-2xl shrink-0 shadow-md">
            {/* White and Black piece summary */}
            <div className="flex items-center gap-2 text-[11px] font-bold">
              <span className="text-amber-400 font-mono uppercase tracking-wider text-[10px] font-black">Board Editor</span>
              <span className="text-slate-600">•</span>
              <div className="flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-850">
                <span className="w-2.5 h-2.5 rounded-full bg-white border border-slate-300" />
                <span className="text-slate-200 font-mono">{analysisStats.wTotal}</span>
                {analysisStats.wKings > 0 && <span className="text-[9px] text-amber-400 font-mono font-black">K{analysisStats.wKings}</span>}
              </div>
              <span className="text-slate-500 font-mono text-[10px]">vs</span>
              <div className="flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-850">
                <span className="w-2.5 h-2.5 rounded-full bg-neutral-800 border border-neutral-700" />
                <span className="text-slate-200 font-mono">{analysisStats.bTotal}</span>
                {analysisStats.bKings > 0 && <span className="text-[9px] text-amber-400 font-mono font-black">K{analysisStats.bKings}</span>}
              </div>
            </div>

            {/* Timeless Badge */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-950/90 border border-slate-800 text-[10px] font-black text-amber-300 font-mono shrink-0">
              <span>∞ Timeless</span>
            </div>
          </div>
        ) : playMode === "Analysis" ? (
          <div className="w-full max-w-[min(96vw,520px)] flex items-center justify-between px-3 py-1.5 bg-slate-900/95 border border-slate-800/90 rounded-2xl shrink-0 shadow-md">
            {/* White and Black piece summary */}
            <div className="flex items-center gap-2 text-[11px] font-bold">
              <div className="flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-850">
                <span className="w-2.5 h-2.5 rounded-full bg-white border border-slate-300" />
                <span className="text-slate-200 font-mono">{analysisStats.wTotal}</span>
                {analysisStats.wKings > 0 && <span className="text-[9px] text-amber-400 font-mono font-black">K{analysisStats.wKings}</span>}
              </div>
              <span className="text-slate-500 font-mono text-[10px]">vs</span>
              <div className="flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-850">
                <span className="w-2.5 h-2.5 rounded-full bg-neutral-800 border border-neutral-700" />
                <span className="text-slate-200 font-mono">{analysisStats.bTotal}</span>
                {analysisStats.bKings > 0 && <span className="text-[9px] text-amber-400 font-mono font-black">K{analysisStats.bKings}</span>}
              </div>
              {analysisStats.diff !== 0 && (
                <span className={`text-[10px] font-mono font-black ${analysisStats.diff > 0 ? "text-amber-300" : "text-sky-300"}`}>
                  {analysisStats.diff > 0 ? `+${analysisStats.diff} W` : `+${Math.abs(analysisStats.diff)} B`}
                </span>
              )}
            </div>

            {/* Side to move toggle */}
            <button
              onClick={() => {
                if (setTurn) setTurn(turn === "W" ? "B" : "W");
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-950 hover:bg-slate-850 border border-slate-800 text-[10px] font-black cursor-pointer transition active:scale-95"
              title="Click to toggle active side to move"
            >
              <span className={`w-2 h-2 rounded-full ${turn === "W" ? "bg-white" : "bg-neutral-800 border border-neutral-600"}`} />
              <span className="text-amber-300">{turn === "W" ? "White to Move" : "Black to Move"}</span>
            </button>
          </div>
        ) : (
          <div className="w-full max-w-[min(96vw,520px)] flex items-center justify-between px-2.5 py-1 bg-slate-900/90 border border-slate-800/80 rounded-2xl shrink-0 shadow-md">
            <div className="flex items-center gap-2 min-w-0">
              <div className="relative shrink-0">
                <Avatar
                  name={topColor === "W" ? whiteName : blackName}
                  size={28}
                  className={turn === topColor && !isThinking && !activePuzzleId ? "ring-2 ring-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.6)]" : ""}
                />
                {turn === topColor && !isThinking && !activePuzzleId && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full border-2 border-slate-950 animate-ping" />
                )}
              </div>

              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[11px] font-black text-slate-100 truncate max-w-[130px] sm:max-w-[200px]">
                  {isComputerMode ? `Ken ${kenLevelId} (AI)` : (
                    <AdminTappableName username={topColor === "W" ? whiteName : blackName}>
                      {seatLabel(topColor)}
                    </AdminTappableName>
                  )}
                </span>

                <span className={`text-[8px] font-black px-1.5 py-0.2 rounded font-mono shrink-0 ${topColor === "W" ? "bg-amber-100 text-slate-950" : "bg-neutral-800 text-amber-200 border border-neutral-700"}`}>
                  {topColor === "W" ? "W" : "B"}
                </span>

                <span className="text-[9px] text-slate-400 font-mono font-bold bg-slate-950/60 px-1.5 py-0.5 rounded border border-slate-800/80">
                  +{capturedBy(topColor)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {playMode === "Multiplayer" && !isSpectating && !isComputerMode && onStartVoiceCall && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={onStartVoiceCall}
                    disabled={isCallActive}
                    className="p-1.5 rounded-xl bg-slate-950/80 hover:bg-slate-800 text-slate-300 hover:text-emerald-400 border border-slate-800 transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                    title={isCallActive ? "Call Active" : "Start Voice Call"}
                  >
                    <Phone className="w-3.5 h-3.5 text-emerald-400" />
                  </button>
                  {onStartVideoCall && (
                    <button
                      onClick={onStartVideoCall}
                      disabled={isCallActive}
                      className="p-1.5 rounded-xl bg-slate-950/80 hover:bg-slate-800 text-slate-300 hover:text-indigo-400 border border-slate-800 transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      title={isCallActive ? "Call Active" : "Start HD Video Call"}
                    >
                      <Video className="w-3.5 h-3.5 text-indigo-400" />
                    </button>
                  )}
                </div>
              )}

              {/* Opponent Timer / Level */}
              {!isComputerMode ? (
                <div className={`px-2 py-0.5 rounded-xl font-mono text-[10px] font-bold shrink-0 ${
                  turn === topColor && clockLimitType !== "Untimed" && !activePuzzleId && !isEditorMode
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse"
                    : "bg-slate-950/80 text-slate-400 border border-slate-800"
                }`}>
                  {clockLimitType === "Untimed" || activePuzzleId || isEditorMode ? "∞" : <ClockText clock={clock} color={topColor} limitType={clockLimitType} />}
                </div>
              ) : (
                <div className="px-2 py-0.5 rounded-xl font-mono text-[9px] font-bold bg-slate-950/80 text-slate-400 border border-slate-800 shrink-0">
                  AI Bot
                </div>
              )}
            </div>
          </div>
        )}

        {/* Draw Offer / Resign Offer Alerts (If any) */}
        {drawOfferReceived && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            className="w-full max-w-[min(96vw,540px)] bg-slate-900/95 border-2 border-indigo-500/50 rounded-2xl p-3.5 shadow-2xl backdrop-blur-md flex flex-col gap-3 shrink-0 relative overflow-hidden z-20"
          >
            {/* Ambient background glow */}
            <div className="absolute top-0 right-0 w-36 h-36 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none -mr-12 -mt-12" />

            {/* Top Bar: Handshake icon + title + Paused Clock Pill */}
            <div className="flex items-center justify-between gap-2 relative z-10">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0 shadow-sm">
                  <Handshake className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-white tracking-wide uppercase">Mutual Draw Offered</span>
                  </div>
                  <div className="text-[11px] text-indigo-200/90 font-medium truncate">
                    <AdminTappableName username={drawOfferReceived} /> offers to conclude the match in a draw
                  </div>
                </div>
              </div>

              {/* High visibility Paused Clock Pill */}
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 font-mono text-[10px] font-black shrink-0 animate-pulse shadow-sm">
                <Clock className="w-3 h-3 text-amber-400" />
                <span>Clock Paused</span>
              </div>
            </div>

            {/* Subtext description */}
            <div className="bg-slate-950/70 rounded-xl px-3 py-2 border border-slate-800 text-[11px] text-slate-300 relative z-10 flex items-center justify-between gap-2">
              <span>Accepting ends the match with split points (½ - ½). Declining resumes active clock play.</span>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2 relative z-10">
              <button
                onClick={() => handleDrawResponse(true)}
                className="py-2.5 px-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 active:scale-95 text-slate-950 font-black text-xs transition shadow-lg shadow-indigo-950/60 flex items-center justify-center gap-1.5 cursor-pointer border border-indigo-300"
              >
                <Handshake className="w-4 h-4 text-slate-950" />
                <span>Accept Draw (½ - ½)</span>
              </button>
              <button
                onClick={() => handleDrawResponse(false)}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 hover:text-white font-bold text-xs transition border border-slate-700 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Swords className="w-4 h-4 text-slate-400" />
                <span>Decline & Play On</span>
              </button>
            </div>
          </motion.div>
        )}

        {drawOfferSent && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            className="w-full max-w-[min(96vw,540px)] bg-slate-900/95 border border-indigo-500/30 rounded-2xl p-3 shadow-xl backdrop-blur-md flex items-center justify-between gap-3 shrink-0 z-20"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                <Handshake className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white">Draw Offer Pending</span>
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono text-[9px] font-bold">
                    <Clock className="w-2.5 h-2.5" /> Paused
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 truncate">Waiting for opponent to accept or decline...</p>
              </div>
            </div>
            {handleCancelDraw && (
              <button
                onClick={handleCancelDraw}
                className="py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-[10px] font-bold transition shrink-0 cursor-pointer flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                <span>Cancel</span>
              </button>
            )}
          </motion.div>
        )}

        {resignOfferReceived && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            className="w-full max-w-[min(96vw,540px)] bg-slate-900/95 border-2 border-rose-500/50 rounded-2xl p-3.5 shadow-2xl backdrop-blur-md flex flex-col gap-3 shrink-0 relative overflow-hidden z-20"
          >
            {/* Ambient background glow */}
            <div className="absolute top-0 right-0 w-36 h-36 bg-rose-500/15 rounded-full blur-3xl pointer-events-none -mr-12 -mt-12" />

            {/* Top Bar: Flag icon + title + Paused Clock Pill */}
            <div className="flex items-center justify-between gap-2 relative z-10">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0 shadow-sm">
                  <Flag className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-white tracking-wide uppercase">Resignation Offered</span>
                  </div>
                  <div className="text-[11px] text-rose-200/90 font-medium truncate">
                    <AdminTappableName username={resignOfferReceived} /> offers to concede this game
                  </div>
                </div>
              </div>

              {/* High visibility Paused Clock Pill */}
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 font-mono text-[10px] font-black shrink-0 animate-pulse shadow-sm">
                <Clock className="w-3 h-3 text-amber-400" />
                <span>Clock Paused</span>
              </div>
            </div>

            {/* Subtext description */}
            <div className="bg-slate-950/70 rounded-xl px-3 py-2 border border-slate-800 text-[11px] text-slate-300 relative z-10 flex items-center justify-between gap-2">
              <span>Accepting declares you the winner immediately. Declining will resume the game clock.</span>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2 relative z-10">
              <button
                onClick={() => handleResignResponse(true)}
                className="py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-black text-xs transition shadow-lg shadow-emerald-950/60 flex items-center justify-center gap-1.5 cursor-pointer border border-emerald-300"
              >
                <Trophy className="w-4 h-4 text-slate-950" />
                <span>Accept (Win Match)</span>
              </button>
              <button
                onClick={() => handleResignResponse(false)}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 hover:text-white font-bold text-xs transition border border-slate-700 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Swords className="w-4 h-4 text-slate-400" />
                <span>Decline & Play On</span>
              </button>
            </div>
          </motion.div>
        )}

        {resignOfferSent && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            className="w-full max-w-[min(96vw,540px)] bg-slate-900/95 border border-rose-500/30 rounded-2xl p-3 shadow-xl backdrop-blur-md flex items-center justify-between gap-3 shrink-0 z-20"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                <Flag className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white">Resignation Pending</span>
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono text-[9px] font-bold">
                    <Clock className="w-2.5 h-2.5" /> Paused
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 truncate">Waiting for opponent to accept or decline...</p>
              </div>
            </div>
            {handleCancelResign && (
              <button
                onClick={handleCancelResign}
                className="py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-[10px] font-bold transition shrink-0 cursor-pointer flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                <span>Cancel</span>
              </button>
            )}
          </motion.div>
        )}

        {opponentAway && (
          <div className="w-full max-w-[min(96vw,520px)] bg-amber-500/10 border border-amber-500/30 rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-1.5 shrink-0 text-[10px] text-amber-300 font-bold animate-pulse">
            <div className="flex items-center gap-1.5 truncate">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span><AdminTappableName username={opponentAway.username} /> left the app ({opponentAway.strikes}/7)</span>
            </div>
            <span className="text-[9px] text-amber-400/90 font-mono shrink-0">Timer keeps running ⏱️</span>
          </div>
        )}

        {typeof myAwayStrikes === "number" && myAwayStrikes > 0 && !opponentAway && (
          <div className={`w-full max-w-[min(96vw,520px)] border rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-1.5 shrink-0 text-[10px] font-bold ${
            myAwayStrikes >= 7
              ? "bg-rose-500/20 border-rose-500/50 text-rose-300 animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.25)]"
              : "bg-amber-500/10 border-amber-500/30 text-amber-300"
          }`}>
            <div className="flex items-center gap-1.5 truncate">
              <ShieldAlert className={`w-3.5 h-3.5 ${myAwayStrikes >= 7 ? "text-rose-400" : "text-amber-400"} shrink-0`} />
              <span>
                Fair Play: {myAwayStrikes}/7 departures
                {myAwayStrikes >= 7 ? " — FINAL WARNING!" : ` (${7 - myAwayStrikes} remaining)`}
              </span>
            </div>
            <span className="text-[9px] font-mono opacity-80 shrink-0">Forfeit at &gt;7</span>
          </div>
        )}

        {/* Transient notice: rejected move / refused send / server error */}
        {inlineNotice && (
          <div className="w-full max-w-[min(96vw,520px)] bg-rose-500/10 border border-rose-500/30 rounded-xl px-2.5 py-1.5 flex items-center gap-1.5 shrink-0 text-[10px] text-rose-300 font-bold">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span className="truncate">{inlineNotice}</span>
          </div>
        )}

        {/* Reconnection Status with Attempt Counter & Fast-Resume status */}
        {playMode === "Multiplayer" && connectionStatus !== "connected" && (
          <div className="w-full max-w-[min(96vw,520px)] bg-amber-500/15 border border-amber-500/40 rounded-xl px-3 py-2 flex items-center justify-between gap-2 shrink-0 shadow-lg shadow-amber-950/30 backdrop-blur-md">
            <div className="flex items-center gap-2.5 min-w-0">
              <RefreshCw className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
              <div className="flex flex-col min-w-0 text-left">
                <span className="text-xs font-black text-amber-300 font-mono tracking-wide">
                  {connectionStatus === "connecting"
                    ? `Reconnecting (Attempt #${reconnectAttempts > 0 ? reconnectAttempts : 1})…`
                    : "Connection Dropped"}
                </span>
                <span className="text-[10px] text-slate-300 truncate">
                  ⚡ Fast-Resume: Board cached & preserved
                </span>
              </div>
            </div>
            {onReconnect && (
              <button
                onClick={onReconnect}
                className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[11px] transition shrink-0 cursor-pointer shadow active:scale-95"
              >
                Retry Now
              </button>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* 3. 10x10 DRAUGHTS BOARD ARENA */}
        {/* ========================================================================= */}
        <div 
          className="k-match-stage flex gap-1.5 w-full max-w-[min(98vw,680px)] aspect-square relative flex-row justify-center items-center shrink-0 my-1"
          style={
            !isMobile && boardScale !== 100
              ? {
                  transform: `scale(${boardScale / 100}) translateZ(0)`,
                  transformOrigin: "center",
                }
              : undefined
          }
        >
          {/* Live Evaluation Bar (Only in Analysis Mode or desktop) */}
          <EvaluationBar
            score={engineEval.score}
            isFlipped={isFlipped}
            visible={playMode === "Analysis" && !isEditorMode && !activePuzzleId}
          />

          {/* Checkerboard Arena */}
          <div 
            ref={boardArenaRef}
            className={boardTheme === "wood"
              ? "kentro-royal-frame relative aspect-square w-full h-full my-auto overflow-hidden"
              : `relative aspect-square w-full h-full rounded-2xl shadow-2xl p-1.5 my-auto overflow-hidden border-4 transition-colors ${boardTheme === "custom" ? "" : `${activeThemeColors.boardBg} ${activeThemeColors.border}`}`}
            style={boardTheme === "custom" ? { backgroundColor: customBorder, borderColor: customBorder } : undefined}
          >
            {/* Floating Emojis Reaction Overlay */}
            <div className="absolute inset-0 z-40 pointer-events-none overflow-hidden rounded-2xl">
              <AnimatePresence>
                {floatingEmojis.map((item, index) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 180, scale: 0.6, x: (index * 30 - 60) + (Math.random() * 20 - 10) }}
                    animate={{ 
                      opacity: [0, 1, 1, 0], 
                      y: -20, 
                      scale: [0.6, 1.2, 1.2, 0.8],
                      x: (index * 30 - 60) + (Math.sin(index) * 20)
                    }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 2.5, ease: "easeOut" }}
                    className="absolute bottom-4 left-1/2 flex flex-col items-center gap-0.5"
                  >
                    <div className="text-3xl filter drop-shadow-[0_4px_8px_rgba(0,0,0,0.6)]">
                      {item.emoji}
                    </div>
                    <span className="text-[7px] bg-slate-950/90 text-amber-300 font-mono font-bold px-1 py-0.2 rounded border border-amber-500/10">
                      {item.sender}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            
            {/* Alpha labels (A-J) */}
            <div className="absolute top-0.5 left-2 right-2 flex justify-between px-3 text-[7px] font-mono font-black text-amber-200/30 select-none">
              {displayCols.map((c) => (
                <span key={c} className="w-5 text-center">{String.fromCharCode(65 + c)}</span>
              ))}
            </div>
            <div className="absolute bottom-0.5 left-2 right-2 flex justify-between px-3 text-[7px] font-mono font-black text-amber-200/30 select-none">
              {displayCols.map((c) => (
                <span key={c} className="w-5 text-center">{String.fromCharCode(65 + c)}</span>
              ))}
            </div>

            {/* Numeric labels (1-10) */}
            <div className="absolute left-0.5 top-2 bottom-2 flex flex-col justify-between py-2 text-[7px] font-mono font-black text-amber-200/30 w-2.5 text-center select-none">
              {displayRows.map((r) => (
                <span key={r} className="h-5 leading-5">{10 - r}</span>
              ))}
            </div>
            <div className="absolute right-0.5 top-2 bottom-2 flex flex-col justify-between py-2 text-[7px] font-mono font-black text-amber-200/30 w-2.5 text-center select-none">
              {displayRows.map((r) => (
                <span key={r} className="h-5 leading-5">{10 - r}</span>
              ))}
            </div>

            {/* 10x10 Grid Blocks */}
            <div className={`w-full h-full grid grid-cols-10 grid-rows-10 overflow-hidden ${boardTheme === "wood" ? "kentro-royal-grid" : "rounded-lg border border-slate-950/20"}`}>
              {displayRows.map((r) =>
                displayCols.map((c) => {
                  const sq = ngRcToSq(r, c);
                  const isDark = (r + c) % 2 === 0;
                  const activePiece = sq !== null ? renderBoard[sq] : null;
                  const animatingCap = sq !== null ? capturedAnimations.find((anim) => anim.sq === sq) : null;
                  const piece = activePiece || animatingCap?.piece;
                  const isCapturedAnim = !activePiece && !!animatingCap;

                  const isSelected = selectedSq === sq && sq !== null;
                  const isValidDest = sq !== null && selectedDestSquares.has(sq);
                  const isCaptureLand = isValidDest && capturingSquares.has(sq);
                  
                  const isPremoveStart = Boolean(premove && sq !== null && premove.from === sq);
                  const isPremoveDest = Boolean(premove && sq !== null && premove.to === sq);
                  const isObligatoryPiece = Boolean(obligatoryCaptureSquares && sq !== null && obligatoryCaptureSquares.has(sq));

                  const isLastMoveStart = Boolean(
                    effectiveLastMove &&
                    typeof effectiveLastMove.from === "number" &&
                    sq !== null &&
                    effectiveLastMove.from === sq
                  );
                  const isLastMoveEnd = Boolean(
                    effectiveLastMove &&
                    typeof effectiveLastMove.to === "number" &&
                    sq !== null &&
                    effectiveLastMove.to === sq
                  );

                  return (
                    <div
                      key={`${r}-${c}`}
                      id={`square-${sq}`}
                      onPointerDown={(e) => {
                        if (sq !== null) {
                          pointerStartRef.current = { x: e.clientX, y: e.clientY, sq, time: Date.now() };
                        }
                      }}
                      onPointerUp={(e) => {
                        if (sq !== null && pointerStartRef.current && pointerStartRef.current.sq === sq) {
                          const dx = Math.abs(e.clientX - pointerStartRef.current.x);
                          const dy = Math.abs(e.clientY - pointerStartRef.current.y);
                          const dt = Date.now() - pointerStartRef.current.time;
                          pointerStartRef.current = null;
                          if (dx < 20 && dy < 20 && dt < 600) {
                            lastPointerTapTimeRef.current = Date.now();
                            handleSquareClick(sq);
                          }
                        }
                      }}
                      onClick={() => {
                        if (Date.now() - lastPointerTapTimeRef.current < 250) return;
                        if (sq !== null) handleSquareClick(sq);
                      }}
                      className={`relative w-full h-full flex items-center justify-center transition-colors duration-100 touch-manipulation select-none ${
                        boardTheme === "wood"
                          ? (isDark ? "kentro-wood-dark" : "kentro-wood-light")
                          : boardTheme === "custom"
                          ? "hover:brightness-110"
                          : isDark ? `${activeThemeColors.darkSquare} hover:brightness-110` : activeThemeColors.lightSquare
                      } ${sq !== null ? "cursor-pointer" : "cursor-default"}`}
                      style={{
                        touchAction: "manipulation",
                        WebkitUserSelect: "none",
                        userSelect: "none",
                        ...(boardTheme === "custom" ? { backgroundColor: isDark ? customDarkSquare : customLightSquare } : {})
                      }}
                    >
                      {/* Clean Square Highlighting for Selected Square */}
                      {isSelected && (
                        <div className="absolute inset-0 pointer-events-none z-10 bg-emerald-500/35 ring-2 ring-inset ring-emerald-400 shadow-[inset_0_0_12px_rgba(52,211,153,0.5)]" />
                      )}

                      {/* Pre-move Selected Piece Highlighting */}
                      {isPremoveStart && (
                        <div className="absolute inset-0 pointer-events-none z-10 bg-cyan-500/35 ring-2 ring-inset ring-cyan-400 shadow-[inset_0_0_12px_rgba(6,182,212,0.6)] animate-pulse" />
                      )}

                      {/* Pre-move Destination Highlighting */}
                      {isPremoveDest && (
                        <div className="absolute inset-0 pointer-events-none z-10 bg-cyan-400/25 ring-2 ring-inset ring-cyan-300 shadow-[inset_0_0_10px_rgba(6,182,212,0.5)] flex items-center justify-center">
                          <div className="w-3.5 h-3.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.9)] animate-pulse" />
                        </div>
                      )}

                      {/* Obligatory Capture Ring: lights up all pieces that MUST jump so player is never left wondering */}
                      {isObligatoryPiece && !isSelected && !isPremoveStart && (
                        <div className="absolute inset-1 rounded-full border-2 border-rose-500/90 bg-rose-500/20 z-20 pointer-events-none animate-pulse shadow-[0_0_12px_rgba(244,63,94,0.7)]" />
                      )}

                      {/* Distinct Semi-Transparent Highlighting for Last Move (Start Square) */}
                      {isLastMoveStart && !isSelected && (
                        <div
                          className="absolute inset-0 pointer-events-none z-10 bg-amber-500/30 ring-2 ring-inset ring-amber-400/60 shadow-[inset_0_0_10px_rgba(251,191,36,0.35)] transition-colors duration-150"
                          title={`Last move start: square ${sq}`}
                        />
                      )}

                      {/* Distinct Semi-Transparent Highlighting for Last Move (End Square) */}
                      {isLastMoveEnd && !isSelected && (
                        <div
                          className="absolute inset-0 pointer-events-none z-10 bg-amber-400/35 ring-2 ring-inset ring-amber-300/80 shadow-[inset_0_0_12px_rgba(251,191,36,0.5)] transition-colors duration-150"
                          title={`Last move end: square ${sq}`}
                        />
                      )}
                      
                      {/* Square Numbers */}
                      {isDark && sq !== null && showSquareNumbers && (
                        <span className="absolute bottom-0.5 right-0.5 text-[7px] font-mono font-bold text-amber-100/25 z-10 pointer-events-none select-none">
                          {sq}
                        </span>
                      )}

                      {/* Rendering Draughts Pieces (Cleanly unburdened by piece-level highlight rings) */}
                      {piece && sq !== null && (
                        <motion.div
                          initial={isCapturedAnim ? { scale: 1, opacity: 1, rotate: 0 } : { scale: 0.85, opacity: 0 }}
                          animate={isCapturedAnim ? { scale: 0, opacity: 0, rotate: 180 } : { scale: 1, opacity: 1 }}
                          exit={{ scale: 0, opacity: 0 }}
                          transition={isCapturedAnim ? { duration: 0.35, ease: "easeIn" } : { duration: 0.12, ease: "easeOut" }}
                          className={`kentro-royal-piece ${piece === "w" || piece === "W" ? "kentro-royal-piece--gold" : "kentro-royal-piece--black"} ${isCapturedAnim ? "z-30 ring-2 ring-rose-500/80" : ""}`}
                          aria-label={`${piece === "W" || piece === "B" ? "King " : ""}${piece.toLowerCase() === "w" ? "Gold" : "Black"} piece`}
                        >
                          {(piece === "W" || piece === "B") && (
                            <span className="kentro-royal-king-mark" aria-hidden="true">
                              <Crown className="w-[60%] h-[60%] text-yellow-100 fill-amber-600 drop-shadow" />
                            </span>
                          )}
                        </motion.div>
                      )}

                      {/* Capture Particle Burst animation */}
                      {isCapturedAnim && (
                        <motion.div
                          initial={{ scale: 0.2, opacity: 1 }}
                          animate={{ scale: 1.6, opacity: 0 }}
                          transition={{ duration: 0.35, ease: "easeOut" }}
                          className="absolute inset-0 rounded-full border-2 border-rose-500 bg-rose-500/30 z-30 pointer-events-none shadow-[0_0_15px_rgba(244,63,94,0.8)]"
                        />
                      )}

                      {/* Legal Target Destination Highlighters */}
                      {isValidDest && (
                        <div className={`absolute w-3 h-3 rounded-full z-30 pointer-events-none ${
                          isCaptureLand ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)] animate-pulse" : "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
                        }`} />
                      )}

                      {/* Capture source highlighter */}
                      {selectedSq !== null && sq !== null && capturingSquares.has(sq) && (
                        <div className="absolute inset-0 bg-rose-500/10 pointer-events-none rounded-sm border border-rose-500/20" />
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* History viewing indicator banner */}
            {historyViewIndex !== null && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 pointer-events-none">
                <span className="text-[9px] font-black text-amber-400 bg-slate-950/90 border border-amber-500/30 px-2 py-0.5 rounded-full tracking-wide uppercase shadow-lg pointer-events-auto">
                  Move #{historyViewIndex + 1}
                </span>
                <button
                  onClick={handleResetHistoryView}
                  className="text-[9px] py-0.5 px-2 bg-amber-500 text-slate-950 font-black rounded-full hover:bg-amber-400 transition shadow-lg pointer-events-auto cursor-pointer"
                >
                  Live Play
                </button>
              </div>
            )}

            {/* Best-move suggestion arrow */}
            <BestMoveArrow
              boardArenaRef={boardArenaRef}
              bestMoveSquares={activeArrowSquares}
              isFlipped={isFlipped}
              boardScale={boardScale}
            />
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 4. USER PLAYER HUD (BOTTOM) / ANALYSIS HELPER / EDITOR HELPER */}
        {/* ========================================================================= */}
        {isEditorMode ? (
          <div className="w-full max-w-[min(96vw,520px)] flex items-center justify-between px-3 py-1 bg-slate-900/90 border border-slate-800/80 rounded-2xl shrink-0 shadow-md">
            <div className="flex items-center gap-2 text-[10px] text-slate-400 font-sans">
              <span className="font-bold text-emerald-400 font-mono">Custom Setup</span>
              <span className="text-slate-600 hidden sm:inline">•</span>
              <span className="hidden sm:inline text-slate-400">Brush active: tap dark squares to place or erase</span>
            </div>
            <button
              onClick={() => setEditorTurn(editorTurn === "W" ? "B" : "W")}
              className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-xl bg-slate-950 hover:bg-slate-850 border border-slate-800 text-[10px] font-black cursor-pointer transition active:scale-95"
              title="Click to toggle who moves first"
            >
              <span className={`w-2 h-2 rounded-full ${editorTurn === "W" ? "bg-white" : "bg-neutral-800 border border-neutral-600"}`} />
              <span className="text-amber-300">{editorTurn === "W" ? "White to Move" : "Black to Move"}</span>
            </button>
          </div>
        ) : playMode === "Analysis" ? (
          <div className="w-full max-w-[min(96vw,520px)] flex items-center justify-between px-3 py-1 bg-slate-900/90 border border-slate-800/80 rounded-2xl shrink-0 shadow-md">
            <div className="flex items-center gap-2 text-[10px] text-slate-400 font-sans">
              <span className="font-bold text-amber-400 font-mono">Analysis Workspace</span>
              <span className="text-slate-600 hidden sm:inline">•</span>
              <span className="hidden sm:inline text-slate-400">Keyboard: <kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-800 rounded text-slate-200 font-mono text-[9px]">←</kbd> <kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-800 rounded text-slate-200 font-mono text-[9px]">→</kbd> <kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-800 rounded text-slate-200 font-mono text-[9px]">Space</kbd></span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400">
              <span className="text-slate-500">Ken Engine:</span>
              <span className="text-emerald-400 font-bold font-mono">Depth {engineEval.depth || 20}</span>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-[min(96vw,520px)] flex items-center justify-between px-2.5 py-1 bg-slate-900/90 border border-slate-800/80 rounded-2xl shrink-0 shadow-md">
            <div className="flex items-center gap-2 min-w-0">
              <div className="relative shrink-0">
                <Avatar
                  name={bottomColor === "W" ? whiteName : blackName}
                  size={28}
                  className={turn === bottomColor && !isThinking ? "ring-2 ring-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.6)]" : ""}
                />
                {turn === bottomColor && !isThinking && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full border-2 border-slate-950 animate-ping" />
                )}
              </div>

              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[11px] font-black text-slate-100 truncate max-w-[130px] sm:max-w-[200px]">
                  {isComputerMode ? `You (${bottomColor === "W" ? "White" : "Black"})` : (
                    <AdminTappableName username={bottomColor === "W" ? whiteName : blackName}>
                      {seatLabel(bottomColor)}
                    </AdminTappableName>
                  )}
                </span>

                <span className={`text-[8px] font-black px-1.5 py-0.2 rounded font-mono shrink-0 ${bottomColor === "W" ? "bg-amber-100 text-slate-950" : "bg-neutral-800 text-amber-200 border border-neutral-700"}`}>
                  {bottomColor === "W" ? "W" : "B"}
                </span>

                <span className="text-[9px] text-slate-400 font-mono font-bold bg-slate-950/60 px-1.5 py-0.5 rounded border border-slate-800/80">
                  +{capturedBy(bottomColor)}
                </span>
              </div>
            </div>

            {/* User Timer */}
            {!isComputerMode ? (
              <div className={`px-2 py-0.5 rounded-xl font-mono text-[10px] font-bold shrink-0 ${
                turn === bottomColor && clockLimitType !== "Untimed" && !activePuzzleId && !isEditorMode
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse"
                  : "bg-slate-950/80 text-slate-400 border border-slate-800"
              }`}>
                {clockLimitType === "Untimed" || activePuzzleId || isEditorMode ? "∞" : <ClockText clock={clock} color={bottomColor} limitType={clockLimitType} />}
              </div>
            ) : (
              <div className="px-2 py-0.5 rounded-xl font-mono text-[9px] font-bold bg-slate-950/80 text-slate-400 border border-slate-800 shrink-0">
                Player
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* 5. SUB-BOARD COMPACT DOCK: MOVES, LAB, ARCHIVE, ENGINE, STATS, INFO, CHAT */}
        {/* ========================================================================= */}
        {!isEditorMode ? (
          <MobileBoardDock
            playMode={playMode}
            turn={turn}
            moveHistory={moveHistory}
            moveHistoryStrings={moveHistoryStrings}
            historyViewIndex={historyViewIndex}
            onHistoryNavigate={handleNav}
            onResetHistoryView={handleResetHistoryView}
            onContinueFromHistory={onContinueFromHistory}
            engineEval={engineEval}
            moveEvaluations={moveEvaluations}
            whiteName={whiteName}
            blackName={blackName}
            isThinking={isThinking}
            statusMessage={statusMessage}
            kenLevelId={kenLevelId}
            isComputerMode={isComputerMode}
            renderBoard={renderBoard}
            multiplayerMessages={multiplayerMessages}
            chatInput={chatInput}
            setChatInput={setChatInput}
            ws={ws}
            sendMessage={sendMessage}
            spectatorCount={spectatorCount}
            roomWagerAmount={roomWagerAmount}
            roomId={roomId}
            yourColor={yourColor}
            isReviewing={isReviewing}
            reviewProgress={reviewProgress}
            onRunAIGameReview={onRunAIGameReview}
            onOpenPastGamesModal={onOpenPastGamesModal}
            onOpenAnalysisLabModal={onOpenAnalysisLabModal}
            onOpenPdnModal={onOpenPdnModal}
            onOpenActionMenu={() => setIsActionMenuOpen(true)}
            isAutoPlaying={isAutoPlaying}
            onToggleAutoPlay={toggleAutoPlay}
          />
        ) : (
          /* Editor Brush Tools Toolbar */
          <div className="w-full max-w-[min(96vw,520px)] bg-slate-900 border border-slate-800 rounded-2xl p-2 flex flex-col gap-2 shrink-0">
            <div className="grid grid-cols-5 gap-1">
              <button
                onClick={() => setEditorSelectedPiece("w")}
                className={`py-1.5 rounded-xl border flex flex-col items-center justify-center transition cursor-pointer ${
                  editorSelectedPiece === "w" ? "bg-emerald-500/20 border-emerald-500 text-white" : "bg-slate-950/60 border-slate-850 text-slate-400"
                }`}
              >
                <div className="w-3.5 h-3.5 rounded-full bg-white border border-slate-300" />
                <span className="text-[7px] font-bold mt-0.5">W Man</span>
              </button>

              <button
                onClick={() => setEditorSelectedPiece("W")}
                className={`py-1.5 rounded-xl border flex flex-col items-center justify-center transition cursor-pointer ${
                  editorSelectedPiece === "W" ? "bg-emerald-500/20 border-emerald-500 text-white" : "bg-slate-950/60 border-slate-850 text-slate-400"
                }`}
              >
                <Crown className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                <span className="text-[7px] font-bold mt-0.5">W King</span>
              </button>

              <button
                onClick={() => setEditorSelectedPiece("b")}
                className={`py-1.5 rounded-xl border flex flex-col items-center justify-center transition cursor-pointer ${
                  editorSelectedPiece === "b" ? "bg-emerald-500/20 border-emerald-500 text-white" : "bg-slate-950/60 border-slate-850 text-slate-400"
                }`}
              >
                <div className="w-3.5 h-3.5 rounded-full bg-neutral-800 border border-neutral-700" />
                <span className="text-[7px] font-bold mt-0.5">B Man</span>
              </button>

              <button
                onClick={() => setEditorSelectedPiece("B")}
                className={`py-1.5 rounded-xl border flex flex-col items-center justify-center transition cursor-pointer ${
                  editorSelectedPiece === "B" ? "bg-emerald-500/20 border-emerald-500 text-white" : "bg-slate-950/60 border-slate-850 text-slate-400"
                }`}
              >
                <Crown className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                <span className="text-[7px] font-bold mt-0.5">B King</span>
              </button>

              <button
                onClick={() => setEditorSelectedPiece(null)}
                className={`py-1.5 rounded-xl border flex flex-col items-center justify-center transition cursor-pointer ${
                  editorSelectedPiece === null ? "bg-red-500/20 border-red-500 text-red-400" : "bg-slate-950/60 border-slate-850 text-slate-400"
                }`}
              >
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
                <span className="text-[7px] font-bold mt-0.5">Erase</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={() => setEditorTurn(editorTurn === "W" ? "B" : "W")}
                className="py-1 bg-slate-950 border border-slate-800 rounded-lg text-[9px] font-bold text-slate-300"
              >
                Turn: <strong className="text-amber-400">{editorTurn === "W" ? "White" : "Black"}</strong>
              </button>
              <button
                onClick={handleClearBoard}
                className="py-1 bg-rose-950/40 border border-rose-900/30 text-rose-400 rounded-lg text-[9px] font-bold"
              >
                Clear All
              </button>
              <button
                onClick={handleStartSandboxMatch}
                className="py-1 bg-emerald-500 text-slate-950 font-black rounded-lg text-[9px]"
              >
                Play Position
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 6. FIXED BOTTOM ACTION BAR: MENU (☰), FLIP, MOVE NAV, LIVE ACTIONS */}
        {/* ========================================================================= */}
        <div className="w-full max-w-[min(96vw,520px)] flex items-center justify-between gap-1 bg-slate-950/95 border border-slate-800/90 rounded-2xl p-1 shrink-0 shadow-2xl">
          {/* 1. Hamburger Menu Button (Opens ActionMenuSheet) */}
          <button
            onClick={() => setIsActionMenuOpen(true)}
            className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-850 border border-slate-800 text-amber-400 hover:text-amber-300 transition cursor-pointer flex items-center justify-center shrink-0"
            title="Game Options Menu"
          >
            <MenuIcon className="w-4 h-4" />
          </button>

          {/* 2. Review Navigation (|<, <, >, >|) or Live Play Buttons */}
          {moveHistory.length > 0 && (
            <div className="flex items-center gap-0.5 bg-slate-900/90 px-1 py-0.5 rounded-xl border border-slate-800">
              <button
                onClick={() => handleNav(0)}
                disabled={currentMoveIndex <= 0}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white disabled:opacity-20 cursor-pointer"
                title="First Move"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => handleNav(Math.max(0, currentMoveIndex - 1))}
                disabled={currentMoveIndex <= 0}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white disabled:opacity-20 cursor-pointer"
                title="Previous Move"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Auto-Play / Pause Move-by-Move Toggle */}
              <button
                onClick={toggleAutoPlay}
                disabled={moveHistory.length === 0}
                className={`p-1.5 rounded-lg transition cursor-pointer ${
                  isAutoPlaying
                    ? "bg-amber-500 text-slate-950 font-black shadow-md shadow-amber-500/30 animate-pulse"
                    : "text-amber-400 hover:text-amber-300 disabled:opacity-20"
                }`}
                title={isAutoPlaying ? "Pause Auto-Play" : "Play Move-by-Move"}
              >
                {isAutoPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              </button>

              <button
                onClick={() => {
                  if (historyViewIndex !== null && historyViewIndex < moveHistory.length - 1) {
                    handleNav(historyViewIndex + 1);
                  } else {
                    handleResetHistoryView();
                  }
                }}
                disabled={historyViewIndex === null || historyViewIndex >= moveHistory.length - 1}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white disabled:opacity-20 cursor-pointer"
                title="Next Move"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <button
                onClick={handleResetHistoryView}
                disabled={historyViewIndex === null}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white disabled:opacity-20 cursor-pointer"
                title="Live / Last Move"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* 3. In-Game Live Controls: Hint, Undo, Draw, Resign, New */}
          <div className="flex items-center gap-1 shrink-0">
            {playMode === "Multiplayer" && isSpectating ? (
              /* Spectators are read-only: no draw / resign controls (M7). */
              <div className="flex items-center gap-1.5">
                <div className="px-2.5 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-[10px] font-bold flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Watching</span>
                </div>
                {onLeaveSpectate && (
                  <button
                    onClick={onLeaveSpectate}
                    className="px-2.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition active:scale-95 shadow-sm"
                    title="Leave match and play your own game"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Exit & Play</span>
                  </button>
                )}
              </div>
            ) : playMode === "Multiplayer" ? (
              <>
                <button
                  onClick={handleOfferDraw}
                  disabled={drawOfferSent || resignOfferSent || !!drawOfferReceived || !!resignOfferReceived || moveHistory.length === 0}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white text-[10px] font-bold transition disabled:opacity-30 flex items-center gap-1 cursor-pointer"
                >
                  <Handshake className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="hidden sm:inline">Draw</span>
                </button>

                <button
                  onClick={handleResign}
                  disabled={resignOfferSent || drawOfferSent || !!drawOfferReceived || !!resignOfferReceived}
                  className="px-2.5 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 text-[10px] font-bold transition disabled:opacity-30 flex items-center gap-1 cursor-pointer"
                >
                  <Flag className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Resign</span>
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleSuggestMove}
                  disabled={playMode === "Tournament" || isThinking || activePuzzleId !== null}
                  className="p-1.5 sm:px-2 sm:py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-amber-400 hover:text-amber-300 hover:bg-slate-850 transition disabled:opacity-30 flex items-center gap-1 cursor-pointer"
                  title="Ask Engine for Hint"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-[10px] font-bold">Hint</span>
                </button>

                <button
                  onClick={handleUndo}
                  disabled={playMode === "Tournament" || moveHistory.length === 0 || isThinking || activePuzzleId !== null}
                  className="p-1.5 sm:px-2 sm:py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-850 transition disabled:opacity-30 flex items-center gap-1 cursor-pointer"
                  title="Takeback Move"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-[10px] font-bold">Undo</span>
                </button>

                <button
                  onClick={handleOfferDraw}
                  disabled={moveHistory.length === 0 || isThinking}
                  className="p-1.5 sm:px-2 sm:py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-850 transition disabled:opacity-30 flex items-center gap-1 cursor-pointer"
                  title="Offer Draw"
                >
                  <Handshake className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="hidden sm:inline text-[10px] font-bold">Draw</span>
                </button>

                <button
                  onClick={handleResign}
                  disabled={isThinking}
                  className="p-1.5 sm:px-2 sm:py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 transition disabled:opacity-30 flex items-center gap-1 cursor-pointer"
                  title="Resign Game"
                >
                  <Flag className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-[10px] font-bold">Resign</span>
                </button>

                <button
                  onClick={() => handleNewGame()}
                  className="p-1.5 sm:px-2 sm:py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 transition flex items-center gap-1 cursor-pointer shadow-md font-black"
                  title="New Match"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-[10px]">New</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Action Menu Bottom Sheet (☰) */}
        <ActionMenuSheet
          isOpen={isActionMenuOpen}
          onClose={() => setIsActionMenuOpen(false)}
          playMode={playMode}
          onSelectMode={handleModeChange}
          onContinueFromHere={onContinueFromHistory}
          onOpenBoardEditor={() => handleModeChange("Editor")}
          onOpenPuzzles={() => handleModeChange("Puzzles")}
          onPracticeWithKen={() => handleModeChange("Human_vs_AI")}
          onOpenAnalysisBoard={() => handleModeChange("Analysis")}
          onToggleShowThreat={() => setShowThreatArrow(!showThreatArrow)}
          showThreat={showThreatArrow}
          onFlipBoard={() => setIsFlipped(!isFlipped)}
          onOpenRules={() => onOpenRules && onOpenRules()}
          onOpenAppGuide={() => onOpenAppGuide && onOpenAppGuide()}
          onCopyFen={handleCopyFen}
          onCopyPdn={handleCopyPdn}
          copiedFen={copiedFen}
          copiedPdn={copiedPdn}
          isComputerMode={isComputerMode}
          onOpenComputerConfig={() => setShowComputerConfigModal(true)}
          onOpenPastGamesModal={onOpenPastGamesModal}
          onOpenAnalysisLabModal={onOpenAnalysisLabModal}
          onOpenPdnModal={onOpenPdnModal}
        />
      </div>
    </>
  );
}
