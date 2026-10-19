import { AnalysisGraph as EvalFlowGraph } from "../AnalysisGraph";
import { analysisPdn, evaluationLabel, whiteEvaluation, moverAt, parseAnalysisPosition } from "../../lib/analysisPresentation";
import React, { useState, useEffect, useMemo } from "react";
import {
  Brain, Cpu, Sparkles, TrendingUp, Lightbulb, Swords, Library,
  Microscope, Copy, Check, ChevronRight, ChevronLeft, Play, Pause,
  SkipBack, SkipForward, RotateCcw, Award, Gauge, Zap, CheckCircle2,
  RefreshCw, Loader2, BookOpen, Settings2, Sliders, ArrowRight,
  ShieldCheck, Flame, Download, HelpCircle, Layers
} from "lucide-react";
import { Board, Move, createInitialBoard, boardToScanFen, scanFenToBoard, Piece, moveToNotationString } from "../../gameLogic";
import { EngineEval, MoveEvalResult } from "../../types";
import { QUALITY_BADGE_CLASSES, QUALITY_BADGE_ABBREV, KEN_LEVELS } from "../../lib/constants";
import { playPromoSound, playClickSound } from "../../lib/audio";
import { AdminTappableName } from "../../lib/adminProfileContext";
import { MatchResultPair } from "../MatchResultPair";

export interface AnalysisSidebarProps {
  moveHistory: Move[];
  moveHistoryStrings: string[];
  engineEval: EngineEval;
  moveEvaluations: Record<number, MoveEvalResult>;
  isReviewing: boolean;
  reviewProgress: number;
  onRunAIGameReview: () => void;
  onCancelReview?: () => void;
  reviewPaused?: boolean;
  historyViewIndex: number | null;
  onHistoryNavigate: (index: number) => void;
  onContinueFromHistory: () => void;
  onResetHistoryView: () => void;
  lastAnalysisEval: { quality: string; comment: string; delta: number } | null;
  renderBoard: Board;
  activeTurn: "W" | "B";
  initialBoard?: Board;
  initialTurn?: "W" | "B";
  analysisTimeMs?: number;
  onAnalysisTimeChange?: (ms: number) => void;
  onRetryAnalysis?: () => void;
  onEditPosition?: () => void;
  reviewError?: string | null;
  analysisPlayVsAI: boolean;
  setAnalysisPlayVsAI: React.Dispatch<React.SetStateAction<boolean>>;
  analysisPlayerColor: "W" | "B";
  setAnalysisPlayerColor: React.Dispatch<React.SetStateAction<"W" | "B">>;
  analysisAILevel: number;
  setAnalysisAILevel: React.Dispatch<React.SetStateAction<number>>;
  setBoard: React.Dispatch<React.SetStateAction<Board>>;
  onLoadPosition?: (board: Board, turn: "W" | "B") => void;
  setMoveHistory: React.Dispatch<React.SetStateAction<Move[]>>;
  setMoveEvaluations: React.Dispatch<React.SetStateAction<Record<number, MoveEvalResult>>>;
  setTurn: React.Dispatch<React.SetStateAction<"W" | "B">>;
  setHistoryViewIndex?: React.Dispatch<React.SetStateAction<number | null>>;
  setLastAnalysisEval: React.Dispatch<React.SetStateAction<{ quality: string; comment: string; delta: number } | null>>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
  muted: boolean;
  savedGamesFilter: "All" | "Mine";
  setSavedGamesFilter: React.Dispatch<React.SetStateAction<"All" | "Mine">>;
  savedGamesList: any[];
  myGamesList: any[];
  isLoadingSavedGames: boolean;
  fetchSavedGames: () => void;
  fetchMyGames: () => void;
  onLoadSavedGame: (game: any) => void;
  onOpenPdnModal?: () => void;
  onGoBackToAnalysis?: () => void;
  hasResumedAnalysis?: boolean;
  onOpenPastGamesModal?: (filter?: "All" | "AI" | "PvP" | "Tournament") => void;
}

/** Convert SCAN PV coordinates to Nigerian 1-50 numbers */
const pvToNigerian = (pvStr: string): string[] => {
  if (!pvStr) return [];
  return pvStr
    .trim()
    .split(/\s+/)
    .slice(0, 8)
    .map((tok) =>
      tok.replace(/\d+/g, (m) => {
        const n = parseInt(m, 10);
        const rb = Math.floor((n - 1) / 5) * 5 + 1;
        return String(2 * rb + 4 - n);
      })
    );
};

const ACCURACY_PENALTY: Record<string, number> = {
  Brilliant: 0, Best: 0, Excellent: 0, Forced: 0, Good: 2,
  Inaccuracy: 6, Mistake: 12, Blunder: 25, "Missed Win": 25,
};

function calculateSideAccuracy(moveEvaluations: Record<number, MoveEvalResult>, parity: 0 | 1): number | null {
  const evals = (Object.entries(moveEvaluations) as [string, MoveEvalResult][])
    .filter(([idx]) => parseInt(idx, 10) % 2 === parity)
    .map(([, ev]) => ev);
  if (evals.length === 0) return null;
  const penalty = evals.reduce((sum, ev) => sum + (ACCURACY_PENALTY[ev.quality] ?? 0), 0) / evals.length;
  return Math.max(0, Math.round((100 - penalty) * 10) / 10);
}

/** Tactical Nigerian Draughts insights generator */
function getTacticalCoachInsight(board: Board, turn: "W" | "B", whiteScore: number, pvChips: string[]) {
  let wMen = 0, bMen = 0, wKings = 0, bKings = 0;
  if (board) {
    for (let sq = 1; sq <= 50; sq++) {
      const p = board[sq];
      if (p === "w") wMen++;
      else if (p === "W") wKings++;
      else if (p === "b") bMen++;
      else if (p === "B") bKings++;
    }
  }

  const wTotal = wMen + wKings;
  const bTotal = bMen + bKings;
  const matDiff = wTotal - bTotal;
  const kingDiff = wKings - bKings;

  let title = "Balanced Position";
  let description = "Both sides have active chances. Maintain strong control of central squares (22, 23, 28, 29) to restrict opponent maneuvers.";
  let badge = "Neutral";
  let tone: "info" | "success" | "warning" = "info";

  if (Math.abs(whiteScore) >= 600) {
    const winningSide = whiteScore > 0 ? "White" : "Black";
    title = `${winningSide} Has a Large Advantage`;
    description = `${winningSide} has a large engine-estimated advantage; this is not proof of a forced win. ${pvChips[0] ? `Critical next strike: ${pvChips[0]}.` : "Look to convert with precision."}`;
    badge = "Decisive";
    tone = whiteScore > 0 ? (turn === "W" ? "success" : "warning") : (turn === "B" ? "success" : "warning");
  } else if (Math.abs(whiteScore) >= 200) {
    const winningSide = whiteScore > 0 ? "White" : "Black";
    title = `${winningSide} Position Advantage`;
    description = `The current search favors ${winningSide}. Candidate continuation: ${pvChips.slice(0, 3).join(" → ") || "Keep applying pressure"}.`;
    badge = "Advantage";
    tone = "success";
  } else if (kingDiff !== 0) {
    const leader = kingDiff > 0 ? "White" : "Black";
    title = `${leader} Has ${Math.abs(kingDiff)} More King${Math.abs(kingDiff) === 1 ? "" : "s"}`;
    description = `Flying kings move along open diagonals. Check available captures and the opponent’s replies.`;
    badge = "King Advantage";
    tone = "success";
  } else if (matDiff !== 0) {
    const leader = matDiff > 0 ? "White" : "Black";
    title = `${leader} Material Lead (+${Math.abs(matDiff)} Pieces)`;
    description = `${leader} is ahead in piece count. Check the engine line before exchanging; material alone does not decide the result.`;
    badge = "Material Lead";
    tone = "success";
  } else if (pvChips.length > 0) {
    title = `Engine Best Line: ${pvChips[0]}`;
    description = `Ken AI calculates candidate continuation: ${pvChips.slice(0, 4).join(" → ")}`;
    badge = "Tactical Line";
  }

  return { title, description, badge, tone, wMen, bMen, wKings, bKings, wTotal, bTotal, matDiff };
}

/** Nigerian Draughts Classic Study Presets */
const NIGERIAN_PRESETS = [
  {
    name: "Starting Setup (20v20)",
    desc: "Standard 10x10 Nigerian tournament opening",
    fen: boardToScanFen(createInitialBoard(), "W"),
  },
  {
    name: "Long Diagonal Duel",
    desc: "1 White King vs 1 Black King on the main diagonal",
    fen: boardToScanFen({ 46: "W", 5: "B" }, "W"),
  },
  {
    name: "3 Kings vs 1 Flying King Trap",
    desc: "Classic endgame triangular trap technique",
    fen: boardToScanFen({ 22: "W", 28: "W", 40: "W", 6: "B" }, "W"),
  },
  {
    name: "Center Bridge Lockdown",
    desc: "Tactical blockade on squares 22, 23, 28, 29",
    fen: boardToScanFen({ 28: "w", 32: "w", 33: "w", 37: "w", 18: "b", 19: "b", 23: "b", 24: "b" }, "W"),
  },
  {
    name: "Sacrifice Study",
    desc: "Explore candidate captures and promotion paths",
    fen: boardToScanFen({ 27: "w", 31: "w", 36: "w", 16: "b", 21: "b", 26: "b" }, "W"),
  },
];

export function AnalysisSidebar(props: AnalysisSidebarProps) {
  const {
    moveHistory, moveHistoryStrings, engineEval, moveEvaluations,
    isReviewing, reviewProgress, onRunAIGameReview,
    historyViewIndex, onHistoryNavigate, onContinueFromHistory, onResetHistoryView,
    lastAnalysisEval, renderBoard, activeTurn,
    analysisPlayVsAI, setAnalysisPlayVsAI, analysisPlayerColor, setAnalysisPlayerColor,
    analysisAILevel, setAnalysisAILevel,
    setBoard, setMoveHistory, setMoveEvaluations, setTurn, setLastAnalysisEval, setStatusMessage, muted,
    savedGamesFilter, setSavedGamesFilter, savedGamesList, myGamesList, isLoadingSavedGames,
    fetchSavedGames, fetchMyGames, onLoadSavedGame,
    onOpenPastGamesModal, onOpenPdnModal,
  } = props;

  const [activeTab, setActiveTab] = useState<"engine" | "moves" | "practice" | "setup" | "archive">("engine");
  const [copiedFen, setCopiedFen] = useState(false);
  const [copiedPdn, setCopiedPdn] = useState(false);
  const [toolError, setToolError] = useState("");
  const initialTurn = props.initialTurn ?? "W";
  const [fenInput, setFenInput] = useState("");
  const [customBrushPiece, setCustomBrushPiece] = useState<Piece>("w");

  // Replay playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(1000);
  const SPEEDS = [
    { label: "0.5x", ms: 2000 },
    { label: "1x", ms: 1000 },
    { label: "2x", ms: 500 },
    { label: "4x", ms: 250 },
  ];

  useEffect(() => {
    if (!isPlaying) return;
    if (moveHistory.length === 0) { setIsPlaying(false); return; }
    const atEnd = historyViewIndex === null || historyViewIndex >= moveHistory.length - 1;
    if (atEnd) { setIsPlaying(false); return; }
    const timer = setTimeout(() => {
      const next = historyViewIndex === null ? 0 : historyViewIndex + 1;
      onHistoryNavigate(Math.min(moveHistory.length - 1, next));
    }, speedMs);
    return () => clearTimeout(timer);
  }, [isPlaying, historyViewIndex, speedMs, moveHistory.length, onHistoryNavigate]);

  const analyzedCount = Object.keys(moveEvaluations).length;
  const whiteAcc = calculateSideAccuracy(moveEvaluations, initialTurn === "W" ? 0 : 1);
  const blackAcc = calculateSideAccuracy(moveEvaluations, initialTurn === "W" ? 1 : 0);

  const whiteScore = whiteEvaluation(engineEval, activeTurn);
  const scoreLabel = evaluationLabel(engineEval, activeTurn);
  const hasEvaluation = engineEval.ready && !engineEval.isThinking && !engineEval.error;
  const barPct = Math.max(4, Math.min(96, 50 + (Math.max(-600, Math.min(600, whiteScore)) / 600) * 46));
  const pvChips = useMemo(() => pvToNigerian(engineEval.ready ? engineEval.pv : ""), [engineEval.pv, engineEval.ready]);

  const tactical = useMemo(
    () => getTacticalCoachInsight(renderBoard, activeTurn, whiteScore, pvChips),
    [renderBoard, activeTurn, whiteScore, pvChips]
  );

  const copyFenString = async () => {
    try {
      const fen = boardToScanFen(renderBoard, activeTurn);
      await navigator.clipboard.writeText(fen);
      setCopiedFen(true);
      setTimeout(() => setCopiedFen(false), 1500);
    } catch { setToolError("Clipboard unavailable. Use Export to save the game instead."); }
  };

  const copyPdnString = async () => {
    try {
      await navigator.clipboard.writeText(analysisPdn(moveHistory.map(moveToNotationString), props.initialBoard ?? createInitialBoard(), initialTurn));
      setCopiedPdn(true);
      setTimeout(() => setCopiedPdn(false), 1500);
    } catch { setToolError("Clipboard unavailable. Use Export to save the game instead."); }
  };

  const downloadPdnFile = () => {
    const content = analysisPdn(moveHistory.map(moveToNotationString), props.initialBoard ?? createInitialBoard(), initialTurn);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `draughts_analysis_${Date.now()}.pdn`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadFen = (fenStr: string) => {
    try {
      const res = parseAnalysisPosition(fenStr);
      setToolError("");
      setIsPlaying(false);
      setAnalysisPlayVsAI(false);
      if (props.onLoadPosition) props.onLoadPosition(res.board, res.turn);
      else { setBoard(res.board); setTurn(res.turn); }
      setMoveHistory([]);
      setMoveEvaluations({});
      if (props.setHistoryViewIndex) props.setHistoryViewIndex(null);
      setLastAnalysisEval(null);
      setStatusMessage("Position loaded successfully!");
      playClickSound(muted);
      setFenInput("");
    } catch (error) {
      setToolError(error instanceof Error ? error.message : "Invalid position. Use W or B followed by 50 piece/empty markers.");
    }
  };

  const GLYPH: Record<string, string> = {
    Brilliant: "!!", Best: "!", Excellent: "✓", Good: "✓",
    Inaccuracy: "?!", Mistake: "?", Blunder: "??", "Missed Win": "??"
  };

  return (
    <div className="flex flex-col gap-2.5 h-full select-none text-slate-100 font-sans">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs text-slate-300">
        <p className="font-bold text-amber-300">{historyViewIndex === -1 ? "Starting position" : historyViewIndex === null ? "Current position" : `After move ${historyViewIndex + 1}`} · {activeTurn === "W" ? "White" : "Black"} to move</p>
        <p className="mt-1">Tap a piece, then a highlighted square. Use Moves to replay, or Setup to load a position. All scores use White’s perspective.</p>
      </div>
      {isReviewing && <button type="button" onClick={props.onCancelReview} className="text-xs text-amber-300 underline p-2">Pause depth-30 review</button>}
      {props.reviewPaused && <p role="status" className="text-xs text-slate-300 p-2">Review paused. Resume from Moves; completed positions stay cached.</p>}
      {props.reviewError && <p role="alert" className="text-xs text-rose-300 p-2">Review stopped: {props.reviewError}. Retry from Moves.</p>}
      {toolError && <p role="alert" className="text-xs text-rose-300 p-2">{toolError}</p>}
      {/* ── Top Segment Switcher ────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-1 bg-slate-950 border border-slate-800/90 rounded-2xl p-1 shrink-0 shadow-lg">
        {[
          { id: "engine", label: "Engine", Icon: Cpu },
          { id: "moves", label: "Moves", Icon: Microscope },
          { id: "practice", label: "Practice", Icon: Swords },
          { id: "setup", label: "Setup", Icon: Sliders },
          { id: "archive", label: "Archive", Icon: Library },
        ].map(({ id, label, Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => {
                setActiveTab(id as any);
                playClickSound(muted);
              }}
              className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl text-[9px] font-black uppercase tracking-wider transition cursor-pointer ${
                isActive
                  ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-black"
                  : "text-slate-400 hover:text-white hover:bg-slate-900/60"
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0 mb-0.5" />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>

      {/* ── TAB 1: ENGINE & LIVE EVAL ──────────────────────────────── */}
      {activeTab === "engine" && (
        <div className="flex flex-col gap-2.5 overflow-y-auto pr-0.5">
          <label className="flex justify-between items-center text-xs text-slate-300">Analysis time per position
            <select aria-label="Analysis time per position" value={props.analysisTimeMs ?? 0} onChange={event => props.onAnalysisTimeChange?.(Number(event.target.value))} className="rounded bg-slate-900 border border-slate-700 p-2">
              <option value={0}>Depth 30 · full search</option><option value={1500}>Quick · 1.5 seconds</option><option value={5000}>Deeper · 5 seconds</option><option value={15000}>Deep · 15 seconds</option>
            </select>
          </label>
          {engineEval.error && <div role="alert" className="text-xs text-rose-300 p-3 border border-rose-500/30 rounded-xl">{engineEval.error}<button className="ml-2 underline" onClick={props.onRetryAnalysis}>Retry analysis</button></div>}
          {engineEval.terminal && <p role="status" className="text-xs text-amber-300">{scoreLabel}: {engineEval.terminal.reason}</p>}
          {/* Main Eval Display Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 flex flex-col gap-3 shadow-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
                  <Brain className={`w-4 h-4 ${engineEval.isThinking ? "animate-pulse" : ""}`} />
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 block font-mono">
                    Ken Analysis Engine
                  </span>
                  <span className="text-[9px] text-slate-400 font-semibold">
                    10x10 Nigerian Draughts Engine
                  </span>
                </div>
              </div>

              {engineEval.isThinking ? (
                <span className="text-[9px] bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-bold animate-pulse flex items-center gap-1 font-mono">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" /> Analyzing position
                </span>
              ) : (
                <span className="text-[9px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 font-mono">
                  <CheckCircle2 className="w-2.5 h-2.5" /> {engineEval.error ? "Unavailable" : engineEval.terminal ? "Position complete" : hasEvaluation ? `Depth ${engineEval.depth}` : isReviewing ? "Review running" : "Waiting"}
                </span>
              )}
            </div>

            {/* Eval Gauge & Win Probability */}
            <div className="flex items-center gap-3 bg-slate-950 p-2.5 rounded-xl border border-slate-850">
              <div className="flex flex-col items-center justify-center shrink-0 min-w-[3.6rem]">
                <span className={`text-2xl font-black font-mono leading-none ${whiteScore >= 0 ? "text-amber-400" : "text-sky-400"}`}>
                  {scoreLabel}
                </span>
                <span className="text-[8px] text-slate-500 font-bold uppercase mt-1">Eval</span>
              </div>

              <div className="flex-1 flex flex-col gap-1.5">
                <div className="h-2.5 w-full rounded-full bg-slate-900 border border-slate-800 overflow-hidden flex shadow-inner">
                  <div
                    className="h-full bg-gradient-to-r from-amber-400 via-amber-300 to-emerald-400 transition-all duration-300"
                    style={{ width: `${barPct}%` }}
                  />
                </div>
                <div className="flex justify-between text-[8px] font-mono font-bold uppercase">
                  <span className="text-amber-300">White advantage</span>
                  <span className="text-slate-500 flex items-center gap-1">
                    <Gauge className="w-2.5 h-2.5" /> Depth {hasEvaluation ? engineEval.depth : "—"}
                  </span>
                  <span className="text-sky-300">Black advantage</span>
                </div>
              </div>
            </div>

            {/* Principal Variation (Best Line) */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[8px] uppercase font-bold tracking-wider text-slate-400">
                <span className="flex items-center gap-1 text-amber-400">
                  <Zap className="w-3 h-3" /> Recommended Move Sequence
                </span>
                <span className="text-slate-500">Nigerian 1-50 notation</span>
              </div>
              <div className="flex flex-wrap gap-1 bg-slate-950 p-2 rounded-xl border border-slate-850">
                {pvChips.length === 0 ? (
                  <span className="text-[10px] text-slate-500 italic font-sans flex items-center gap-1.5 py-1">
                    {engineEval.isThinking ? "Analyzing the displayed position…" : engineEval.error ? "No engine result available." : isReviewing ? "Game review is running. Live analysis resumes afterwards." : "No continuation available."}
                  </span>
                ) : (
                  pvChips.map((mv, i) => (
                    <span
                      key={i}
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg border transition ${
                        i === 0
                          ? "bg-amber-500 text-slate-950 border-amber-400 shadow-sm font-black scale-105"
                          : "bg-slate-900 border-slate-800 text-slate-300"
                      }`}
                    >
                      {i === 0 ? `★ ${mv}` : mv}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Smart AI Tactical Coach Card */}
          {hasEvaluation && !engineEval.terminal && <div className={`border rounded-2xl p-3.5 flex flex-col gap-2 transition shadow-md ${
            tactical.tone === "success"
              ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-200"
              : tactical.tone === "warning"
              ? "bg-amber-950/20 border-amber-500/30 text-amber-200"
              : "bg-slate-900/80 border-slate-800 text-slate-200"
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider flex items-center gap-1.5 font-black text-amber-400">
                <Lightbulb className="w-3.5 h-3.5" /> AI Tactical Coach
              </span>
              <span className="text-[9px] bg-slate-950/90 text-slate-300 px-2 py-0.5 rounded-full border border-slate-800 font-mono">
                W:{tactical.wTotal} (K{tactical.wKings}) vs B:{tactical.bTotal} (K{tactical.bKings})
              </span>
            </div>
            <div>
              <h4 className="text-xs font-black text-white">{tactical.title}</h4>
              <p className="text-[11px] text-slate-300 leading-relaxed mt-0.5">
                {tactical.description}
              </p>
            </div>
          </div>

          }
          <p className="text-[10px] text-slate-400">Engine estimates are not win probabilities. A deeper search may change the suggested line.</p>
          {/* Quick Position Tools & Export */}
          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={copyFenString}
              className="py-2 px-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-amber-500/40 text-slate-300 hover:text-amber-300 text-[10px] font-bold flex items-center justify-center gap-1 transition cursor-pointer"
            >
              {copiedFen ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedFen ? "Copied" : "Copy FEN"}</span>
            </button>
            <button
              onClick={copyPdnString}
              className="py-2 px-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-amber-500/40 text-slate-300 hover:text-amber-300 text-[10px] font-bold flex items-center justify-center gap-1 transition cursor-pointer"
            >
              {copiedPdn ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedPdn ? "Copied" : "Copy PDN"}</span>
            </button>
            <button
              onClick={downloadPdnFile}
              className="py-2 px-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-amber-500/40 text-slate-300 hover:text-amber-300 text-[10px] font-bold flex items-center justify-center gap-1 transition cursor-pointer"
            >
              <Download className="w-3 h-3" />
              <span>Export</span>
            </button>
          </div>
        </div>
      )}

      {/* ── TAB 2: MOVES & GAME REVIEW ──────────────────────────────── */}
      {activeTab === "moves" && (
        <div className="flex flex-col gap-2.5 flex-grow min-h-0 bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 shrink-0 shadow-md">
          {props.reviewError && <p role="alert" className="text-xs text-rose-300">Review stopped: {props.reviewError}. Completed grades remain available; retry the review.</p>}
          <p className="text-[10px] text-slate-400">Quality percentages are heuristic summaries of reviewed moves, not a measured playing strength.</p>
          {/* Review Accuracy Header */}
          <div className="flex items-center justify-between shrink-0">
            <span className="text-[10px] text-slate-300 font-extrabold uppercase tracking-wide flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5 text-amber-400" /> Move Quality &amp; Accuracy
            </span>
            <span className="text-[9px] text-slate-500 font-mono">
              {analyzedCount}/{moveHistory.length} moves graded
            </span>
          </div>

          {/* Accuracy Meters */}
          {moveHistory.length > 0 && (
            <div className="grid grid-cols-2 gap-2 shrink-0">
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-850 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-amber-200">White</span>
                  <span className={`text-base font-black font-mono leading-none ${
                    whiteAcc === null ? "text-slate-600" : whiteAcc >= 85 ? "text-emerald-400" : whiteAcc >= 70 ? "text-amber-400" : "text-rose-400"
                  }`}>
                    {whiteAcc === null ? "—" : `${whiteAcc}%`}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-900 overflow-hidden">
                  <div className="h-full bg-amber-400 transition-all duration-300" style={{ width: `${whiteAcc ?? 0}%` }} />
                </div>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-850 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-sky-200">Black</span>
                  <span className={`text-base font-black font-mono leading-none ${
                    blackAcc === null ? "text-slate-600" : blackAcc >= 85 ? "text-emerald-400" : blackAcc >= 70 ? "text-amber-400" : "text-rose-400"
                  }`}>
                    {blackAcc === null ? "—" : `${blackAcc}%`}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-900 overflow-hidden">
                  <div className="h-full bg-sky-400 transition-all duration-300" style={{ width: `${blackAcc ?? 0}%` }} />
                </div>
              </div>
            </div>
          )}

          {/* Flow Graph */}
          {moveHistory.length > 1 && (
            <EvalFlowGraph
              initialTurn={initialTurn}
              moveEvaluations={moveEvaluations}
              count={moveHistory.length}
              historyViewIndex={historyViewIndex}
              onHistoryNavigate={onHistoryNavigate}
            />
          )}

          {/* AI Review Action Button */}
          {moveHistory.length > 0 && (
            <button
              onClick={onRunAIGameReview}
              disabled={isReviewing}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 text-slate-950 font-black text-xs shadow-md shadow-amber-500/20 hover:brightness-110 disabled:opacity-50 transition cursor-pointer flex items-center justify-center gap-1.5 shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isReviewing ? `Depth-30 review… ${reviewProgress}%` : "Run / Resume Depth-30 Review"}</span>
            </button>
          )}

          {/* Move Sheet Table */}
          {moveHistory.length === 0 ? (
            <div className="flex-grow flex flex-col items-center justify-center text-center italic text-slate-500 text-xs p-6 gap-2 bg-slate-950/60 rounded-xl border border-slate-900">
              <Microscope className="w-8 h-8 text-slate-700" />
              <span>Play moves on the board, import a PDN, or load a match to review.</span>
            </div>
          ) : (
            <div className="flex-grow overflow-y-auto border border-slate-950 rounded-xl bg-slate-950 divide-y divide-slate-900/80 font-mono text-[11px]">
              {Array.from({ length: Math.ceil((moveHistory.length + (initialTurn === "B" ? 1 : 0)) / 2) }).map((_, idx) => {
                const whiteIdx = initialTurn === "W" ? idx * 2 : idx * 2 - 1;
                const blackIdx = initialTurn === "W" ? idx * 2 + 1 : idx * 2;
                const whiteMvStr = moveHistoryStrings[whiteIdx];
                const blackMvStr = moveHistoryStrings[blackIdx] || "";
                const isWhiteViewed = historyViewIndex === whiteIdx;
                const isBlackViewed = historyViewIndex === blackIdx;
                const whiteEval = moveEvaluations[whiteIdx];
                const blackEval = moveEvaluations[blackIdx];

                return (
                  <div key={idx} className="flex items-center text-left py-1.5 px-3 gap-1 hover:bg-slate-900/40">
                    <span className="text-slate-500 font-bold w-6 text-right pr-2 border-r border-slate-900 select-none">
                      {idx + 1}.
                    </span>
                    <div className="flex-1 flex items-center">
                      <button
                        onClick={() => whiteIdx >= 0 && onHistoryNavigate(whiteIdx)}
                        className={`text-left font-bold flex items-center justify-between px-2 py-0.5 rounded-lg transition w-full cursor-pointer ${
                          isWhiteViewed ? "bg-amber-500 text-slate-950 font-black" : "text-amber-100 hover:bg-slate-900"
                        }`}
                      >
                        <span className="truncate">{whiteMvStr}</span>
                        {whiteEval && (
                          <span className={`text-[8px] px-1 py-px rounded font-sans font-black leading-none shrink-0 ml-1 ${QUALITY_BADGE_CLASSES[whiteEval.quality]}`}>
                            {QUALITY_BADGE_ABBREV[whiteEval.quality]}
                          </span>
                        )}
                      </button>
                    </div>
                    {blackMvStr && (
                      <div className="flex-1 flex items-center">
                        <button
                          onClick={() => onHistoryNavigate(blackIdx)}
                          className={`text-left font-bold flex items-center justify-between px-2 py-0.5 rounded-lg transition w-full cursor-pointer ${
                            isBlackViewed ? "bg-amber-500 text-slate-950 font-black" : "text-slate-300 hover:bg-slate-900"
                          }`}
                        >
                          <span className="truncate">{blackMvStr}</span>
                          {blackEval && (
                            <span className={`text-[8px] px-1 py-px rounded font-sans font-black leading-none shrink-0 ml-1 ${QUALITY_BADGE_CLASSES[blackEval.quality]}`}>
                              {QUALITY_BADGE_ABBREV[blackEval.quality]}
                            </span>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Replay Controls Footer */}
          {moveHistory.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-slate-800 pt-2 shrink-0">
              <div className="flex items-center justify-center gap-1">
                <button
                  onClick={() => { setIsPlaying(false); onHistoryNavigate(-1); }}
                  disabled={historyViewIndex === -1}
                  className="p-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-25 transition cursor-pointer"
                  title="Starting position"
                >
                  <SkipBack className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setIsPlaying(false);
                    onHistoryNavigate(historyViewIndex === null ? moveHistory.length - 2 : Math.max(-1, historyViewIndex - 1));
                  }}
                  disabled={historyViewIndex === -1}
                  className="p-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-25 transition cursor-pointer"
                  title="Previous move"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    const atEnd = historyViewIndex === null || historyViewIndex >= moveHistory.length - 1;
                    if (atEnd) onHistoryNavigate(-1);
                    setIsPlaying((p) => !p);
                  }}
                  className="p-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 transition cursor-pointer shadow-md"
                  title={isPlaying ? "Pause playback" : "Auto play"}
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
                </button>
                <button
                  onClick={() => {
                    setIsPlaying(false);
                    onHistoryNavigate(historyViewIndex === null ? moveHistory.length - 1 : Math.min(moveHistory.length - 1, historyViewIndex + 1));
                  }}
                  disabled={historyViewIndex === null || historyViewIndex >= moveHistory.length - 1}
                  className="p-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-25 transition cursor-pointer"
                  title="Next move"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { setIsPlaying(false); onResetHistoryView(); }}
                  disabled={historyViewIndex === null}
                  className="p-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-25 transition cursor-pointer"
                  title="Latest move"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
              </div>

              {historyViewIndex !== null && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setIsPlaying(false); onContinueFromHistory(); }}
                    className="flex-1 py-1.5 px-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500 hover:text-slate-950 font-bold text-[11px] transition cursor-pointer"
                  >
                    Explore from here
                  </button>
                  <button
                    onClick={() => { setIsPlaying(false); onResetHistoryView(); }}
                    className="flex-1 py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[11px] transition cursor-pointer"
                  >
                    Return to latest
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: PRACTICE VS KEN AI ───────────────────────────────── */}
      {activeTab === "practice" && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 flex flex-col gap-3 shrink-0 shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-300 font-extrabold uppercase tracking-wider flex items-center gap-1.5">
              <Swords className="w-3.5 h-3.5 text-emerald-400" /> Practice from Current Position
            </span>
            <button
              onClick={() => {
                setAnalysisPlayVsAI(!analysisPlayVsAI);
                playPromoSound(muted);
              }}
              className={`text-[10px] px-3 py-1.5 rounded-xl font-black transition cursor-pointer ${
                analysisPlayVsAI
                  ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20"
                  : "bg-slate-950 border border-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              {analysisPlayVsAI ? "Practice: ACTIVE" : "Practice: OFF"}
            </button>
          </div>

          <p className="text-[11px] text-slate-300 leading-relaxed">
            Test your ideas against Ken AI directly from this board setup. Every move is evaluated in real time, with instant warnings if you make a blunder.
          </p>

          <div className="flex flex-col gap-2.5 pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300">Play As:</span>
              <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  onClick={() => setAnalysisPlayerColor("W")}
                  className={`px-3 py-1 rounded-lg text-xs font-black cursor-pointer transition ${
                    analysisPlayerColor === "W" ? "bg-amber-500 text-slate-950" : "text-slate-400"
                  }`}
                >
                  White
                </button>
                <button
                  onClick={() => setAnalysisPlayerColor("B")}
                  className={`px-3 py-1 rounded-lg text-xs font-black cursor-pointer transition ${
                    analysisPlayerColor === "B" ? "bg-amber-500 text-slate-950" : "text-slate-400"
                  }`}
                >
                  Black
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300">Ken Difficulty:</span>
              <select
                value={analysisAILevel}
                onChange={(e) => setAnalysisAILevel(Number(e.target.value))}
                className="bg-slate-950 border border-slate-800 text-slate-200 rounded-xl text-xs py-1.5 px-3 focus:outline-none focus:border-amber-500 font-bold"
              >
                {KEN_LEVELS.map((lvl) => (
                  <option key={lvl.id} value={lvl.id}>
                    Level {lvl.id} ({lvl.name})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 4: BOARD SETUP & PRESETS ────────────────────────────── */}
      {activeTab === "setup" && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 flex flex-col gap-3 overflow-y-auto pr-0.5 shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-300 font-extrabold uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-amber-400" /> Position Setup &amp; Study Presets
            </span>
          </div>

          {/* Quick Board Setup Actions */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                handleLoadFen(boardToScanFen(createInitialBoard(), "W"));
                playClickSound(muted);
              }}
              className="py-2.5 px-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-amber-500/40 text-slate-200 font-bold text-xs transition cursor-pointer"
            >
              Starting Board (20v20)
            </button>
            <button
              onClick={() => {
                props.onEditPosition?.();
                playClickSound(muted);
              }}
              className="py-2.5 px-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-rose-500/40 text-rose-300 font-bold text-xs transition cursor-pointer"
            >
              Open board editor
            </button>
          </div>

          {/* Turn Toggle */}
          <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-850">
            <span className="text-xs font-bold text-slate-300">Side to move (starts a new study):</span>
            <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => handleLoadFen(boardToScanFen(renderBoard, "W"))}
                className={`px-3 py-1 rounded-md text-xs font-bold transition cursor-pointer ${
                  activeTurn === "W" ? "bg-amber-500 text-slate-950 font-black" : "text-slate-400"
                }`}
              >
                White
              </button>
              <button
                onClick={() => handleLoadFen(boardToScanFen(renderBoard, "B"))}
                className={`px-3 py-1 rounded-md text-xs font-bold transition cursor-pointer ${
                  activeTurn === "B" ? "bg-amber-500 text-slate-950 font-black" : "text-slate-400"
                }`}
              >
                Black
              </button>
            </div>
          </div>

          {/* FEN Paste Box */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="analysis-fen" className="text-[10px] font-bold text-slate-400 uppercase">Load Custom FEN Position:</label>
            <div className="flex items-center gap-1.5">
              <input
                id="analysis-fen"
                type="text"
                value={fenInput}
                onChange={(e) => setFenInput(e.target.value)}
                placeholder="Paste the 51-character FEN copied from the board"
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-amber-500"
              />
              <button
                onClick={() => handleLoadFen(fenInput)}
                className="py-2 px-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl transition cursor-pointer shrink-0"
              >
                Load
              </button>
            </div>
          </div>

          {/* Preset Endgames & Studies */}
          <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-800">
            <span className="text-[10px] font-bold text-amber-400 uppercase flex items-center gap-1">
              <BookOpen className="w-3 h-3" /> Classic Nigerian Draughts Presets:
            </span>
            <div className="flex flex-col gap-1.5">
              {NIGERIAN_PRESETS.map((pst, i) => (
                <button
                  key={i}
                  onClick={() => handleLoadFen(pst.fen)}
                  className="p-2.5 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-850 hover:border-amber-500/40 text-left transition cursor-pointer flex flex-col gap-0.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-white">{pst.name}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-amber-500/60" />
                  </div>
                  <span className="text-[10px] text-slate-400 leading-snug">{pst.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 5: MATCH ARCHIVE & LIBRARY ─────────────────────────── */}
      {activeTab === "archive" && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 flex flex-col gap-2.5 overflow-y-auto pr-0.5 shadow-md">
          <div className="flex items-center justify-between shrink-0">
            <span className="text-[10px] text-slate-300 font-extrabold uppercase tracking-wider flex items-center gap-1.5">
              <Library className="w-3.5 h-3.5 text-sky-400" />
              {savedGamesFilter === "Mine" ? "Your Match Archive" : "Community Match Archive"}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setSavedGamesFilter((prev) => {
                    const next = prev === "All" ? "Mine" : "All";
                    if (next === "Mine") fetchMyGames(); else fetchSavedGames();
                    return next;
                  });
                }}
                className="text-[9px] text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer"
              >
                Switch to {savedGamesFilter === "All" ? "Mine" : "All"}
              </button>
              <button
                onClick={() => (savedGamesFilter === "Mine" ? fetchMyGames() : fetchSavedGames())}
                disabled={isLoadingSavedGames}
                className="text-[9px] text-amber-400 hover:text-amber-300 font-bold cursor-pointer flex items-center gap-1"
              >
                <RefreshCw className={`w-2.5 h-2.5 ${isLoadingSavedGames ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>

          {onOpenPastGamesModal && (
            <button
              onClick={() => onOpenPastGamesModal("All")}
              className="w-full py-2 px-3 bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500 hover:text-slate-950 font-black rounded-xl transition text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow shrink-0"
            >
              <Library className="w-3.5 h-3.5" /> Open Full Match Archive
            </button>
          )}

          {isLoadingSavedGames ? (
            <div className="text-center py-6 text-xs text-slate-500 italic flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" /> Loading saved matches...
            </div>
          ) : (() => {
            const displayed = savedGamesFilter === "Mine" ? myGamesList : savedGamesList;
            if (displayed.length === 0) {
              return (
                <div className="text-center py-6 text-xs text-slate-500 italic">
                  {savedGamesFilter === "Mine" ? "No finished matches recorded yet." : "No community matches found."}
                </div>
              );
            }
            return (
              <div className="flex flex-col gap-1.5 overflow-y-auto max-h-[340px]">
                {displayed.map((g, idx) => {
                  const dateStr = g.timestamp
                    ? new Date(g.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                    : "Recent";
                  return (
                    <div
                      key={g.id || idx}
                      onClick={() => onLoadSavedGame(g)}
                      className="p-2.5 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-850 hover:border-amber-500/40 text-left transition cursor-pointer flex flex-col gap-1"
                    >
                      <MatchResultPair game={g} compact />
                      <div className="text-[9px] text-slate-400 text-center">{dateStr}</div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
