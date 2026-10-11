import React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X, Play, Wrench, Puzzle, Cpu, RefreshCw,
  BookOpen, Copy, Check, Download,
  Library, Brain, Sparkles, Sliders
} from "lucide-react";
import { PlayMode } from "../../types";

export interface ActionMenuSheetProps {
  isOpen: boolean;
  onClose: () => void;
  playMode: PlayMode;
  onSelectMode: (mode: PlayMode) => void;
  onOpenShareModal?: () => void;
  onContinueFromHere?: () => void;
  onOpenBoardEditor?: () => void;
  onOpenPuzzles?: () => void;
  onPracticeWithKen?: () => void;
  onToggleShowThreat?: () => void;
  showThreat?: boolean;
  onFlipBoard: () => void;
  onOpenRules: () => void;
  onOpenAppGuide: () => void;
  onCopyFen?: () => void;
  onCopyPdn?: () => void;
  copiedFen?: boolean;
  copiedPdn?: boolean;
  isComputerMode?: boolean;
  onOpenComputerConfig?: () => void;
  onOpenPastGamesModal?: (filter?: "All" | "AI" | "PvP" | "Tournament") => void;
  onOpenAnalysisBoard?: () => void;
  onOpenAnalysisLabModal?: (tab?: "review" | "coach" | "engine" | "tools") => void;
  onOpenPdnModal?: () => void;
}

export function ActionMenuSheet({
  isOpen,
  onClose,
  playMode,
  onContinueFromHere,
  onOpenBoardEditor,
  onOpenPuzzles,
  onPracticeWithKen,
  onToggleShowThreat,
  showThreat = false,
  onFlipBoard,
  onOpenRules,
  onCopyFen,
  onCopyPdn,
  copiedFen = false,
  copiedPdn = false,
  isComputerMode = false,
  onOpenComputerConfig,
  onOpenPastGamesModal,
  onOpenAnalysisBoard,
  onOpenAnalysisLabModal,
  onOpenPdnModal,
}: ActionMenuSheetProps) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div 
        className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/90 isolate overflow-hidden" 
        onClick={onClose}
      >
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 26, stiffness: 320 }}
          className="w-full max-w-lg bg-slate-900 border-t border-slate-800 rounded-t-3xl p-4 pb-8 flex flex-col gap-3.5 shadow-2xl select-none max-h-[85vh] overflow-y-auto touch-pan-y"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag Handle & Header */}
          <div className="flex flex-col items-center gap-2 pb-3 border-b border-slate-800 shrink-0">
            <div className="w-12 h-1.5 rounded-full bg-slate-700/80" />
            <div className="w-full flex items-center justify-between px-1">
              <span className="text-xs font-black uppercase tracking-wider text-amber-400 font-mono truncate">
                Game Options & Archive
              </span>
              <button
                onClick={onClose}
                className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer active:scale-95"
                aria-label="Close menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Actions Grid */}
          <div className="grid grid-cols-2 gap-2 shrink-0">
            {onCopyFen && (
              <button
                onClick={onCopyFen}
                className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl bg-slate-800/80 border border-slate-700/80 hover:border-amber-500/50 text-slate-200 hover:text-white transition text-xs font-bold cursor-pointer active:scale-[0.98] truncate"
              >
                {copiedFen ? <Check className="w-4 h-4 text-emerald-400 shrink-0" /> : <Copy className="w-4 h-4 text-amber-400 shrink-0" />}
                <span className="truncate">{copiedFen ? "FEN Copied!" : "Copy FEN"}</span>
              </button>
            )}

            {onCopyPdn && (
              <button
                onClick={onCopyPdn}
                className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl bg-slate-800/80 border border-slate-700/80 hover:border-amber-500/50 text-slate-200 hover:text-white transition text-xs font-bold cursor-pointer active:scale-[0.98] truncate"
              >
                {copiedPdn ? <Check className="w-4 h-4 text-emerald-400 shrink-0" /> : <Download className="w-4 h-4 text-amber-400 shrink-0" />}
                <span className="truncate">{copiedPdn ? "PDN Copied!" : "Export Moves"}</span>
              </button>
            )}
          </div>

          {/* Feature List Items */}
          <div className="flex flex-col gap-2 text-slate-200">
            {/* Match Archive & Library */}
            {onOpenPastGamesModal && (
              <button
                onClick={() => {
                  onOpenPastGamesModal("All");
                  onClose();
                }}
                className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-slate-800/90 border border-amber-500/30 hover:border-amber-400 text-slate-100 transition cursor-pointer active:scale-[0.99] group text-left"
              >
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 shrink-0 group-hover:bg-amber-500/20">
                  <Library className="w-5 h-5" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-black text-amber-300 truncate">My Match Archive & Library</span>
                  <span className="text-[11px] text-slate-400 truncate">View all past games (AI, PvP, Tournaments)</span>
                </div>
              </button>
            )}

            {/* Smart Lab & AI Game Review Modal (Analysis mode) */}
            {playMode === "Analysis" && onOpenAnalysisLabModal && (
              <button
                onClick={() => {
                  onOpenAnalysisLabModal("review");
                  onClose();
                }}
                className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-slate-800/90 border border-amber-500/30 hover:border-amber-400 text-slate-100 transition cursor-pointer active:scale-[0.99] group text-left"
              >
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 shrink-0 group-hover:bg-amber-500/20">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-black text-amber-300 truncate">Smart Lab & AI Game Review</span>
                  <span className="text-[11px] text-slate-400 truncate">Full move quality grading, blunder alerts & coach</span>
                </div>
              </button>
            )}

            {/* Analysis Board (Only in Analysis Mode) */}
            {playMode === "Analysis" && onOpenAnalysisBoard && (
              <button
                onClick={() => {
                  onOpenAnalysisBoard();
                  onClose();
                }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-slate-500 text-slate-100 transition cursor-pointer active:scale-[0.99] text-left"
              >
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                  <Brain className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-bold text-slate-100 truncate">Switch to Analysis Board Mode</span>
                  <span className="text-[11px] text-slate-400 truncate">Sandbox freely, try alternate lines & engine depth</span>
                </div>
              </button>
            )}

            {/* Import PDN / FEN (Analysis Mode) */}
            {playMode === "Analysis" && onOpenPdnModal && (
              <button
                onClick={() => {
                  onOpenPdnModal();
                  onClose();
                }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-slate-500 text-slate-100 transition cursor-pointer active:scale-[0.99] text-left"
              >
                <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400 shrink-0">
                  <Download className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-bold text-slate-100 truncate">Import PDN / Notation</span>
                  <span className="text-[11px] text-slate-400 truncate">Paste game notation to analyze step-by-step</span>
                </div>
              </button>
            )}

            {/* Continue from here (Analysis Mode) */}
            {playMode === "Analysis" && onContinueFromHere && (
              <button
                onClick={() => {
                  onContinueFromHere();
                  onClose();
                }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-slate-500 text-slate-100 transition cursor-pointer active:scale-[0.99] text-left"
              >
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                  <Play className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-bold text-slate-100 truncate">Continue from here</span>
                  <span className="text-[11px] text-slate-400 truncate">Play out current reviewed position</span>
                </div>
              </button>
            )}

            {/* Practice with computer (Analysis Mode) */}
            {playMode === "Analysis" && onPracticeWithKen && (
              <button
                onClick={() => {
                  onPracticeWithKen();
                  onClose();
                }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-slate-500 text-slate-100 transition cursor-pointer active:scale-[0.99] text-left"
              >
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
                  <Cpu className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-bold text-slate-100 truncate">Practice with Ken AI</span>
                  <span className="text-[11px] text-slate-400 truncate">Challenge Nigerian Draughts Engine</span>
                </div>
              </button>
            )}

            {/* Board Editor (Analysis Mode) */}
            {playMode === "Analysis" && onOpenBoardEditor && (
              <button
                onClick={() => {
                  onOpenBoardEditor();
                  onClose();
                }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-slate-500 text-slate-100 transition cursor-pointer active:scale-[0.99] text-left"
              >
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 shrink-0">
                  <Wrench className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-bold text-slate-100 truncate">Board Editor</span>
                  <span className="text-[11px] text-slate-400 truncate">Setup custom positions & endgames</span>
                </div>
              </button>
            )}

            {/* Weekly Puzzles */}
            {onOpenPuzzles && (
              <button
                onClick={() => {
                  onOpenPuzzles();
                  onClose();
                }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-slate-500 text-slate-100 transition cursor-pointer active:scale-[0.99] text-left"
              >
                <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 shrink-0">
                  <Puzzle className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-bold text-slate-100 truncate">Tactics & Puzzles</span>
                  <span className="text-[11px] text-slate-400 truncate">Solve endgame & combo problems</span>
                </div>
              </button>
            )}

            {/* Show Hint / Best Move Arrow */}
            {onToggleShowThreat && (
              <button
                onClick={() => {
                  onToggleShowThreat();
                  onClose();
                }}
                className="flex items-center justify-between px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-slate-500 text-slate-100 transition cursor-pointer active:scale-[0.99] text-left"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                  <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs font-bold text-slate-100 truncate">Show Threat & Best Move Arrow</span>
                    <span className="text-[11px] text-slate-400 truncate">Overlay engine tactical suggestion</span>
                  </div>
                </div>
                <span className={`text-[10px] font-black px-2.5 py-1 rounded-md shrink-0 ${showThreat ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "bg-slate-700/80 text-slate-400 border border-slate-600/50"}`}>
                  {showThreat ? "ON" : "OFF"}
                </span>
              </button>
            )}

            {/* Change AI Difficulty (if in computer mode) */}
            {isComputerMode && onOpenComputerConfig && (
              <button
                onClick={() => {
                  onOpenComputerConfig();
                  onClose();
                }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-slate-500 text-slate-100 transition cursor-pointer active:scale-[0.99] text-left"
              >
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
                  <Sliders className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-bold text-slate-100 truncate">Change AI Engine Level</span>
                  <span className="text-[11px] text-slate-400 truncate">Adjust Ken strength (Levels 1 - 8)</span>
                </div>
              </button>
            )}

            {/* Rules and Flip Board */}
            <div className="grid grid-cols-2 gap-2 mt-1 shrink-0">
              <button
                onClick={() => {
                  onOpenRules();
                  onClose();
                }}
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white transition text-xs font-bold cursor-pointer active:scale-[0.98] truncate"
              >
                <BookOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">Nigerian Rules</span>
              </button>

              <button
                onClick={() => {
                  onFlipBoard();
                  onClose();
                }}
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white transition text-xs font-bold cursor-pointer active:scale-[0.98] truncate"
              >
                <RefreshCw className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="truncate">Flip Board</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
