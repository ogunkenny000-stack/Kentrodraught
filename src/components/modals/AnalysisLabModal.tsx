import { AnalysisGraph as AdvantageFlowChart } from "../AnalysisGraph";
import { evaluationLabel, whiteEvaluation, moverAt, parseAnalysisPosition } from "../../lib/analysisPresentation";
import React, { useState } from "react";
import {
  Sparkles, Brain, Cpu, TrendingUp, Lightbulb, LineChart, CheckCircle2,
  AlertTriangle, Play, ChevronRight, Download, Copy, Check, RefreshCw,
  Swords, ArrowLeft, ArrowRight, BookOpen, ShieldCheck, Flame, Loader2
} from "lucide-react";
import { ModalShell } from "../ui/ModalShell";
import { Board, Move, boardToScanFen, scanFenToBoard } from "../../gameLogic";
import { EngineEval, MoveEvalResult } from "../../types";
import { QUALITY_BADGE_CLASSES, QUALITY_BADGE_ABBREV, KEN_LEVELS } from "../../lib/constants";
import { AdminTappableName } from "../../lib/adminProfileContext";

export interface AnalysisLabModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: "review" | "coach" | "engine" | "tools";
  moveHistory: Move[];
  moveHistoryStrings: string[];
  historyViewIndex: number | null;
  onHistoryNavigate: (index: number) => void;
  onContinueFromHistory?: () => void;
  engineEval: EngineEval;
  moveEvaluations: Record<number, MoveEvalResult>;
  whiteName: string;
  blackName: string;
  activeTurn: "W" | "B";
  initialTurn?: "W" | "B";
  onLoadPosition?: (board: Board, turn: "W" | "B") => void;
  analysisTimeMs?: number;
  onAnalysisTimeChange?: (ms: number) => void;
  onRetryAnalysis?: () => void;
  renderBoard: Board;
  isReviewing?: boolean;
  reviewProgress?: number;
  onRunAIGameReview?: () => void;
  onCancelReview?: () => void;
  lastAnalysisEval?: { quality: string; comment: string; delta: number } | null;
  // Position / Tool Handlers
  setBoard?: React.Dispatch<React.SetStateAction<Board>>;
  setTurn?: React.Dispatch<React.SetStateAction<"W" | "B">>;
  setMoveHistory?: React.Dispatch<React.SetStateAction<Move[]>>;
  setMoveEvaluations?: React.Dispatch<React.SetStateAction<Record<number, MoveEvalResult>>>;
  setLastAnalysisEval?: React.Dispatch<React.SetStateAction<{ quality: string; comment: string; delta: number } | null>>;
  setStatusMessage?: React.Dispatch<React.SetStateAction<string>>;
  onOpenPdnModal?: () => void;
  onPracticeWithKen?: () => void;
}

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

function sideAccuracy(moveEvaluations: Record<number, MoveEvalResult>, parity: 0 | 1): number | null {
  const evals = (Object.entries(moveEvaluations) as [string, MoveEvalResult][])
    .filter(([idx]) => parseInt(idx, 10) % 2 === parity)
    .map(([, ev]) => ev);
  if (evals.length === 0) return null;
  const penalty = evals.reduce((sum, ev) => sum + (ACCURACY_PENALTY[ev.quality] ?? 0), 0) / evals.length;
  return Math.max(0, Math.round((100 - penalty) * 10) / 10);
}

export function AnalysisLabModal({
  open,
  onClose,
  initialTab = "review",
  moveHistory,
  moveHistoryStrings,
  historyViewIndex,
  onHistoryNavigate,
  onContinueFromHistory,
  engineEval,
  moveEvaluations,
  whiteName,
  blackName,
  activeTurn,
  initialTurn = "W",
  onLoadPosition,
  analysisTimeMs = 0,
  onAnalysisTimeChange,
  onRetryAnalysis,
  renderBoard,
  isReviewing = false,
  reviewProgress = 0,
  onRunAIGameReview,
  onCancelReview,
  lastAnalysisEval,
  setBoard,
  setTurn,
  setMoveHistory,
  setMoveEvaluations,
  setLastAnalysisEval,
  setStatusMessage,
  onOpenPdnModal,
  onPracticeWithKen,
}: AnalysisLabModalProps) {
  const [activeTab, setActiveTab] = useState<"review" | "coach" | "engine" | "tools">(initialTab);
  const [fenInput, setFenInput] = useState("");
  const [showFenBox, setShowFenBox] = useState(false);
  const [copiedFen, setCopiedFen] = useState(false);

  React.useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
    }
  }, [open, initialTab]);

  const whiteScore = whiteEvaluation(engineEval, activeTurn);
  const scoreLabel = evaluationLabel(engineEval, activeTurn);
  const pvChips = pvToNigerian(engineEval.ready ? engineEval.pv : "");

  const whiteAcc = sideAccuracy(moveEvaluations, initialTurn === "W" ? 0 : 1);
  const blackAcc = sideAccuracy(moveEvaluations, initialTurn === "W" ? 1 : 0);

  const tally = (parity: 0 | 1) => {
    const counts = { Brilliant: 0, Best: 0, Good: 0, Inaccuracy: 0, Mistake: 0, Blunder: 0 };
    (Object.entries(moveEvaluations) as [string, MoveEvalResult][]).forEach(([idxStr, ev]) => {
      if (((parseInt(idxStr, 10) + (initialTurn === "B" ? 1 : 0)) % 2) !== parity) return;
      if (ev.quality === "Brilliant") counts.Brilliant += 1;
      else if (ev.quality === "Best" || ev.quality === "Excellent" || ev.quality === "Forced") counts.Best += 1;
      else if (ev.quality === "Good") counts.Good += 1;
      else if (ev.quality === "Inaccuracy") counts.Inaccuracy += 1;
      else if (ev.quality === "Mistake") counts.Mistake += 1;
      else if (ev.quality === "Blunder" || ev.quality === "Missed Win") counts.Blunder += 1;
    });
    return counts;
  };
  const whiteCounts = tally(0);
  const blackCounts = tally(1);

  // Group moves into pairs: [Move 1: W, B], [Move 2: W, B]
  const movePairs: { index: number; white?: { text: string; ply: number }; black?: { text: string; ply: number } }[] = [];
  for (let row = 0; row < Math.ceil((moveHistoryStrings.length + (initialTurn === "B" ? 1 : 0)) / 2); row++) {
    const w = initialTurn === "W" ? row * 2 : row * 2 - 1;
    const b = initialTurn === "W" ? row * 2 + 1 : row * 2;
    movePairs.push({ index: row + 1,
      white: w >= 0 && w < moveHistoryStrings.length ? { text: moveHistoryStrings[w], ply: w } : undefined,
      black: b < moveHistoryStrings.length ? { text: moveHistoryStrings[b], ply: b } : undefined });
  }

  // Critical turning points (Blunders / Mistakes / Brilliancies)
  const criticalMoves = (Object.entries(moveEvaluations) as [string, MoveEvalResult][])
    .filter(([, ev]) => ["Brilliant", "Blunder", "Mistake", "Missed Win"].includes(ev.quality))
    .map(([idxStr, ev]) => ({
      ply: parseInt(idxStr, 10),
      eval: ev,
      text: moveHistoryStrings[parseInt(idxStr, 10)] || `Ply ${parseInt(idxStr, 10) + 1}`,
      side: moverAt(parseInt(idxStr, 10), initialTurn) === "W" ? "White" : "Black",
    }));

  const handleCopyCurrentFen = async () => {
    try {
      const fen = boardToScanFen(renderBoard, activeTurn);
      await navigator.clipboard.writeText(fen);
      setCopiedFen(true);
      setTimeout(() => setCopiedFen(false), 2000);
      if (setStatusMessage) setStatusMessage("Position FEN copied to clipboard.");
    } catch (e) {
      setStatusMessage?.("Clipboard unavailable. Try the board Export option.");
    }
  };

  const handleLoadCustomFen = () => {
    if (!fenInput.trim() || !setBoard || !setTurn || !setMoveHistory || !setMoveEvaluations) return;
    try {
      const res = parseAnalysisPosition(fenInput);
      if (onLoadPosition) onLoadPosition(res.board, res.turn);
      else { setBoard(res.board); setTurn(res.turn); }
      setMoveHistory([]);
      setMoveEvaluations({});
      if (setLastAnalysisEval) setLastAnalysisEval(null);
      if (setStatusMessage) setStatusMessage("Position loaded from FEN.");
      setShowFenBox(false);
      setFenInput("");
      onClose(); // Seamlessly return to board
    } catch {
      if (setStatusMessage) setStatusMessage("Invalid FEN format.");
    }
  };

  const handleSelectMoveAndReturn = (ply: number) => {
    onHistoryNavigate(ply);
    onClose(); // Automatically close page and return to the board on chosen move
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      size="xl"
      title={
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-amber-400" />
          <span>Smart Lab & Game Analysis</span>
        </div>
      }
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2 text-xs">
            <span className={`px-2 py-1 rounded-lg font-mono font-bold ${
              whiteScore > 50 ? "bg-amber-400/20 text-amber-300" : whiteScore < -50 ? "bg-rose-500/20 text-rose-300" : "bg-slate-800 text-slate-300"
            }`}>
              Eval: {scoreLabel}
            </span>
            <span className="text-slate-400 hidden sm:inline text-[11px]">
              {historyViewIndex === -1 ? "Starting position" : historyViewIndex !== null ? `Ply ${historyViewIndex + 1}` : "Live Position"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {historyViewIndex !== null && onContinueFromHistory && (
              <button
                onClick={() => {
                  onContinueFromHistory();
                  onClose();
                }}
                className="px-3 py-2 bg-emerald-500/20 hover:bg-emerald-500 hover:text-slate-950 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-black transition cursor-pointer"
              >
                Play from this Move
              </button>
            )}

            <button
              onClick={onClose}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow-lg shadow-amber-500/20 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Board</span>
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 text-xs">
        {/* Navigation Tabs */}
        <div className="flex items-center justify-between bg-slate-950/80 p-1.5 rounded-2xl border border-slate-900">
          <div className="flex items-center gap-1 overflow-x-auto w-full">
            <button
              onClick={() => setActiveTab("review")}
              className={`flex-1 min-w-[90px] py-2 px-2.5 rounded-xl font-extrabold text-[11px] transition flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === "review"
                  ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Review</span>
            </button>

            <button
              onClick={() => setActiveTab("coach")}
              className={`flex-1 min-w-[90px] py-2 px-2.5 rounded-xl font-extrabold text-[11px] transition flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === "coach"
                  ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5" />
              <span>Tactical Coach</span>
            </button>

            <button
              onClick={() => setActiveTab("engine")}
              className={`flex-1 min-w-[90px] py-2 px-2.5 rounded-xl font-extrabold text-[11px] transition flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === "engine"
                  ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Engine Lines</span>
            </button>

            <button
              onClick={() => setActiveTab("tools")}
              className={`flex-1 min-w-[90px] py-2 px-2.5 rounded-xl font-extrabold text-[11px] transition flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === "tools"
                  ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>FEN & Setup</span>
            </button>
          </div>
        </div>

        {/* TAB 1: AI GAME REVIEW & ACCURACY */}
        {activeTab === "review" && (
          <div className="space-y-4">
            {/* Top AI Review Trigger Card */}
            <div className="bg-gradient-to-r from-amber-500/10 via-slate-900 to-slate-900 border border-amber-500/30 rounded-2xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-extrabold text-sm text-slate-100">Scan Nigerian AI Game Review</h4>
                  <p className="text-[11px] text-slate-400">
                    Depth 30 move-by-move quality evaluation, blunders, brilliancies, and tactical accuracy.
                  </p>
                </div>
              </div>

              {onRunAIGameReview && moveHistory.length > 0 && (
                <button
                  onClick={onRunAIGameReview}
                  disabled={isReviewing}
                  className="w-full sm:w-auto px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl font-black text-xs transition flex items-center justify-center gap-2 shadow-md shadow-amber-500/25 cursor-pointer disabled:opacity-50"
                >
                  {isReviewing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Depth-30 review ({reviewProgress}%)</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      <span>Run / Resume Depth-30 Review</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {isReviewing && <button type="button" onClick={onCancelReview} className="text-xs text-amber-300 underline">Pause depth-30 review</button>}
            <p className="text-xs text-slate-400">Every game position targets depth 30. Full searches can take several minutes per position on slower devices. Quick timing affects live position analysis only.</p>

            {/* Side-by-side Accuracy Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* White Player */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-slate-200 truncate max-w-[150px]">{whiteName} (White)</span>
                  <span className="text-sm font-black font-mono text-amber-400">
                    {whiteAcc !== null ? `${whiteAcc}% Accuracy` : "Pending Review"}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5 pt-1 text-[10px] font-mono text-center">
                  <div className="bg-slate-950 p-1.5 rounded-lg border border-slate-850">
                    <span className="text-emerald-400 block font-black">★ {whiteCounts.Brilliant}</span>
                    <span className="text-slate-500 text-[9px]">Brilliant</span>
                  </div>
                  <div className="bg-slate-950 p-1.5 rounded-lg border border-slate-850">
                    <span className="text-teal-400 block font-black">✓ {whiteCounts.Best}</span>
                    <span className="text-slate-500 text-[9px]">Best</span>
                  </div>
                  <div className="bg-slate-950 p-1.5 rounded-lg border border-slate-850">
                    <span className="text-amber-400 block font-black">? {whiteCounts.Inaccuracy}</span>
                    <span className="text-slate-500 text-[9px]">Inacc</span>
                  </div>
                  <div className="bg-slate-950 p-1.5 rounded-lg border border-slate-850">
                    <span className="text-rose-400 block font-black">?? {whiteCounts.Blunder}</span>
                    <span className="text-slate-500 text-[9px]">Blunders</span>
                  </div>
                </div>
              </div>

              {/* Black Player */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-slate-200 truncate max-w-[150px]">{blackName} (Black)</span>
                  <span className="text-sm font-black font-mono text-amber-400">
                    {blackAcc !== null ? `${blackAcc}% Accuracy` : "Pending Review"}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5 pt-1 text-[10px] font-mono text-center">
                  <div className="bg-slate-950 p-1.5 rounded-lg border border-slate-850">
                    <span className="text-emerald-400 block font-black">★ {blackCounts.Brilliant}</span>
                    <span className="text-slate-500 text-[9px]">Brilliant</span>
                  </div>
                  <div className="bg-slate-950 p-1.5 rounded-lg border border-slate-850">
                    <span className="text-teal-400 block font-black">✓ {blackCounts.Best}</span>
                    <span className="text-slate-500 text-[9px]">Best</span>
                  </div>
                  <div className="bg-slate-950 p-1.5 rounded-lg border border-slate-850">
                    <span className="text-amber-400 block font-black">? {blackCounts.Inaccuracy}</span>
                    <span className="text-slate-500 text-[9px]">Inacc</span>
                  </div>
                  <div className="bg-slate-950 p-1.5 rounded-lg border border-slate-850">
                    <span className="text-rose-400 block font-black">?? {blackCounts.Blunder}</span>
                    <span className="text-slate-500 text-[9px]">Blunders</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Advantage Flow Graph */}
            <AdvantageFlowChart
              initialTurn={initialTurn}
              moveEvaluations={moveEvaluations}
              count={moveHistoryStrings.length}
              historyViewIndex={historyViewIndex}
              onHistoryNavigate={onHistoryNavigate}
            />

            {/* Critical Turning Points in Game */}
            {criticalMoves.length > 0 && (
              <div className="space-y-2">
                <h5 className="font-extrabold text-slate-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span>Key Critical Moments ({criticalMoves.length})</span>
                </h5>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                  {criticalMoves.map((item) => (
                    <button
                      key={item.ply}
                      onClick={() => handleSelectMoveAndReturn(item.ply)}
                      className="bg-slate-900/90 hover:bg-slate-850 border border-slate-800 hover:border-amber-500/40 rounded-xl p-2.5 flex items-center justify-between text-left transition cursor-pointer group"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                          QUALITY_BADGE_CLASSES[item.eval.quality] || "bg-slate-800 text-slate-300"
                        }`}>
                          {item.eval.quality}
                        </span>
                        <div>
                          <span className="font-mono font-bold text-slate-200 text-xs">
                            {item.side} {item.text}
                          </span>
                          <span className="text-[10px] text-slate-500 block">Ply {item.ply + 1}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-amber-400 font-bold group-hover:translate-x-0.5 transition">
                        <span>Inspect</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Full Clickable Move List */}
            <div className="space-y-2">
              <h5 className="font-extrabold text-slate-300 flex items-center justify-between">
                <span>Move-by-Move Record</span>
                <span className="text-[10px] text-slate-500 font-sans">Tap any move to load onto board</span>
              </h5>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 max-h-48 overflow-y-auto bg-slate-950/80 p-2 rounded-2xl border border-slate-900 font-mono text-[10px]">
                {movePairs.map((pair) => (
                  <div key={pair.index} className="flex items-center gap-1 bg-slate-900/60 p-1.5 rounded-xl border border-slate-800">
                    <span className="text-slate-500 font-bold w-4">{pair.index}.</span>
                    {pair.white && (
                      <button
                        onClick={() => handleSelectMoveAndReturn(pair.white!.ply)}
                        className={`flex-1 text-left px-1.5 py-0.5 rounded cursor-pointer transition truncate ${
                          historyViewIndex === pair.white.ply
                            ? "bg-amber-500 text-slate-950 font-black shadow-sm"
                            : "text-slate-200 hover:bg-slate-800"
                        }`}
                      >
                        {pair.white.text}
                        {moveEvaluations[pair.white.ply] && (
                          <span className={`ml-1 text-[8px] font-black ${
                            QUALITY_BADGE_CLASSES[moveEvaluations[pair.white.ply].quality] || "text-slate-400"
                          }`}>
                            {QUALITY_BADGE_ABBREV[moveEvaluations[pair.white.ply].quality]}
                          </span>
                        )}
                      </button>
                    )}
                    {pair.black && (
                      <button
                        onClick={() => handleSelectMoveAndReturn(pair.black!.ply)}
                        className={`flex-1 text-left px-1.5 py-0.5 rounded cursor-pointer transition truncate ${
                          historyViewIndex === pair.black.ply
                            ? "bg-amber-500 text-slate-950 font-black shadow-sm"
                            : "text-slate-200 hover:bg-slate-800"
                        }`}
                      >
                        {pair.black.text}
                        {moveEvaluations[pair.black.ply] && (
                          <span className={`ml-1 text-[8px] font-black ${
                            QUALITY_BADGE_CLASSES[moveEvaluations[pair.black.ply].quality] || "text-slate-400"
                          }`}>
                            {QUALITY_BADGE_ABBREV[moveEvaluations[pair.black.ply].quality]}
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: TACTICAL COACH */}
        {activeTab === "coach" && (
          <div className="space-y-4">
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                  <Lightbulb className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-extrabold text-sm text-slate-100">Nigerian Draughts Tactical Coach</h4>
                  <p className="text-[11px] text-slate-400">
                    Live positioning analysis based on flying king rules, long diagonal control, and shot threats.
                  </p>
                </div>
              </div>

              {lastAnalysisEval && (
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-850 flex flex-col gap-1">
                  <span className="text-[10px] uppercase font-bold text-amber-400">Last Move Coach Evaluation:</span>
                  <p className="text-slate-200 text-xs">{lastAnalysisEval.comment}</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-850 space-y-1">
                  <span className="font-extrabold text-amber-400 text-xs flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" /> Flying King Strategy
                  </span>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Under Nigerian Draughts rules, Kings have unlimited diagonal range and multi-jump capture freedom. Keep central squares (22, 23, 28, 29) covered.
                  </p>
                </div>

                <div className="bg-slate-950 p-3 rounded-xl border border-slate-850 space-y-1">
                  <span className="font-extrabold text-sky-400 text-xs flex items-center gap-1.5">
                    <Flame className="w-4 h-4" /> Tactical Combinations (Shots)
                  </span>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Look for sacrifice shots: giving 1 or 2 men to capture 3+ opponent pieces and breakthrough directly into king row!
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: ENGINE LINES & CALCULATION */}
        {activeTab === "engine" && (
          <div className="space-y-4">
            {engineEval.terminal && <p role="status" className="text-xs text-amber-300">{scoreLabel}: {engineEval.terminal.reason}</p>}
            <p className="text-xs text-slate-400">Scores use White’s perspective. Engine estimates can change with deeper search.</p>
            <label className="flex items-center justify-between text-xs">Analysis time per position
              <select aria-label="Analysis time per position" value={analysisTimeMs} onChange={e => onAnalysisTimeChange?.(Number(e.target.value))} className="bg-slate-900 p-2 rounded border border-slate-700">
                <option value={0}>Depth 30 · full search</option><option value={1500}>Quick · 1.5 seconds</option><option value={5000}>Deeper · 5 seconds</option><option value={15000}>Deep · 15 seconds</option>
              </select>
            </label>
            {engineEval.error && <p role="alert" className="text-xs text-rose-300">{engineEval.error} <button className="underline" onClick={onRetryAnalysis}>Retry analysis</button></p>}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-amber-400" />
                  <span className="font-extrabold text-sm text-slate-100">Scan Nigerian Engine 3.1</span>
                </div>
                <span className="text-[11px] font-mono text-slate-400">
                  {engineEval.isThinking ? "Analyzing…" : engineEval.error ? "Unavailable" : engineEval.ready ? `Depth ${engineEval.depth}` : "Waiting"}
                </span>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-850 space-y-2">
                <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block">
                  Best Principal Variation:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {pvChips.length === 0 ? (
                    <span className="text-slate-500 italic text-xs">{engineEval.isThinking ? "Analyzing the displayed position…" : engineEval.error || "No engine continuation available."}</span>
                  ) : (
                    pvChips.map((chip, idx) => (
                      <span
                        key={idx}
                        className={`text-xs font-mono px-2.5 py-1 rounded-xl border font-bold ${
                          idx === 0
                            ? "bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm"
                            : "bg-slate-900 text-slate-300 border-slate-800"
                        }`}
                      >
                        {idx === 0 && <span className="text-amber-400 mr-1">★</span>}
                        {chip}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: FEN & TOOLS */}
        {activeTab === "tools" && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Copy Current FEN */}
              <button
                onClick={handleCopyCurrentFen}
                className="p-3.5 bg-slate-900/90 hover:bg-slate-850 border border-slate-800 hover:border-amber-500/40 rounded-2xl flex items-center justify-between text-left transition cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                    {copiedFen ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </div>
                  <div>
                    <span className="font-extrabold text-slate-100 block">
                      {copiedFen ? "Copied to Clipboard!" : "Copy Position FEN"}
                    </span>
                    <span className="text-[10px] text-slate-400">Standard Scan / Nigerian FEN string</span>
                  </div>
                </div>
              </button>

              {/* Import PDN */}
              {onOpenPdnModal && (
                <button
                  onClick={() => {
                    onOpenPdnModal();
                    onClose();
                  }}
                  className="p-3.5 bg-slate-900/90 hover:bg-slate-850 border border-slate-800 hover:border-sky-500/40 rounded-2xl flex items-center justify-between text-left transition cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center">
                      <Download className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="font-extrabold text-slate-100 block">Import Game PDN</span>
                      <span className="text-[10px] text-slate-400">Load portable draughts notation</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-500" />
                </button>
              )}
            </div>

            {/* Paste / Load Custom FEN */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 space-y-2">
              <span className="font-extrabold text-slate-200 block">Load Custom Position from FEN</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={fenInput}
                  onChange={(e) => setFenInput(e.target.value)}
                  placeholder="Paste FEN (e.g. W:W31-50:B1-20 or W:W31,32:B18,19)"
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={handleLoadCustomFen}
                  disabled={!fenInput.trim()}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs transition cursor-pointer disabled:opacity-40"
                >
                  Load & View Board
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
