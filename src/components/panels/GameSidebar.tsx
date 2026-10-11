import React from "react";
import { ChevronRight, ChevronLeft, Play, SkipBack, SkipForward, Pause, Compass, Wrench } from "lucide-react";
import { ChessClock } from "../ChessClock";
import { Move } from "../../gameLogic";
import type { ClockSnapshot } from "../../lib/useServerClock";

export interface GameSidebarProps {
  isComputerMode: boolean;
  isEditorMode: boolean;
  /** Clock snapshot (server-authoritative online, local otherwise); ticks inside ChessClock. */
  clock: ClockSnapshot | null;
  turn: "W" | "B";
  clockLimitType: "Blitz" | "Rapid" | "Classical" | "Untimed";
  activePuzzleId: string | null;
  moveHistory: Move[];
  moveHistoryStrings: string[];
  historyViewIndex: number | null;
  onHistoryNavigate: (index: number) => void;
  onContinueFromHistory: () => void;
  onResetHistoryView: () => void;
  onGoBackToAnalysis?: () => void;
  hasResumedAnalysis?: boolean;
}

/**
 * The GAME sidebar: clocks, the scorecard move sheet, and replay controls.
 * Nothing else -- deliberately.
 *
 * Every analysis feature that used to live here (live engine panel, AI Game
 * Review, evaluation graph, move-quality badges, coach commentary, practice
 * toggle, community games) now lives EXCLUSIVELY in AnalysisSidebar, shown
 * only on the dedicated Analysis Board. A game against the AI -- or any
 * other game anywhere in the app -- is a plain game between the two sides.
 */
export function GameSidebar(props: GameSidebarProps) {
  const {
    isComputerMode, isEditorMode, clock, turn, clockLimitType, activePuzzleId,
    moveHistory, moveHistoryStrings,
    historyViewIndex, onHistoryNavigate, onContinueFromHistory, onResetHistoryView,
    onGoBackToAnalysis, hasResumedAnalysis,
  } = props;

  // Playback: step through the game automatically. Interval speed is
  // adjustable. Stops at the final move.
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [speedMs, setSpeedMs] = React.useState(1000);
  const SPEEDS = [
    { label: "0.5x", ms: 2000 },
    { label: "1x", ms: 1000 },
    { label: "2x", ms: 500 },
    { label: "4x", ms: 250 },
  ];
  React.useEffect(() => {
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

  return (
    <div className="flex flex-col gap-4 h-full select-none">
      {/* Game Clocks wrapper (AI matches and Editor mode are untimed and show no clock) */}
      {!isComputerMode && !isEditorMode && (
        <ChessClock
          clock={clock}
          activeColor={activePuzzleId ? null : turn}
          limitType={clockLimitType}
        />
      )}

      {/* Timeless Editor Mode Header */}
      {isEditorMode && (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-2.5 px-3 flex items-center justify-between text-slate-400">
          <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-amber-400">
            <Wrench className="w-3.5 h-3.5" /> Board Editor
          </div>
          <span className="text-[11px] font-mono font-bold text-slate-400 bg-slate-950 px-2 py-0.5 rounded-md border border-slate-800">
            ∞ Timeless
          </span>
        </div>
      )}

      {/* Classic spreadsheet styled clickable move logs */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 flex flex-col gap-2 flex-grow min-h-[160px] max-h-[340px] overflow-hidden shrink-0">
        <span className="text-[10px] text-slate-500 font-extrabold uppercase tracking-wide font-sans block shrink-0">
          Scorecard Move Sheet
        </span>

        {moveHistory.length === 0 ? (
          <div className="flex-grow flex items-center justify-center text-center italic text-slate-500 text-xs font-sans">
            Make moves on the board to populate the logsheet.
          </div>
        ) : (
          <div className="flex-grow overflow-y-auto border border-slate-950 rounded-lg bg-slate-950 divide-y divide-slate-900 font-mono text-[11px] pr-1">
            {Array.from({ length: Math.ceil(moveHistory.length / 2) }).map((_, idx) => {
              const whiteIdx = idx * 2;
              const blackIdx = idx * 2 + 1;

              const whiteMvStr = moveHistoryStrings[whiteIdx];
              const blackMvStr = moveHistoryStrings[blackIdx] || "";

              const isWhiteViewed = historyViewIndex === whiteIdx;
              const isBlackViewed = historyViewIndex === blackIdx;

              return (
                <div key={idx} className="flex items-center text-left py-1 px-3 gap-1">
                  <span className="text-slate-500 font-bold w-7 text-right pr-2 border-r border-slate-900 mr-1 select-none">{idx + 1}.</span>

                  <div className="flex-1 flex items-center justify-between">
                    <button
                      onClick={() => onHistoryNavigate(whiteIdx)}
                      className={`text-left font-bold flex items-center gap-0.5 px-1 py-0.5 rounded transition w-full cursor-pointer ${
                        isWhiteViewed ? "bg-amber-500 text-slate-950" : "text-amber-100 hover:bg-slate-900"
                      }`}
                    >
                      <ChevronRight className={`w-3 h-3 ${isWhiteViewed ? "text-slate-950" : "text-amber-500/50"}`} />
                      {whiteMvStr}
                    </button>
                  </div>

                  {blackMvStr && (
                    <div className="flex-1 flex items-center justify-between">
                      <button
                        onClick={() => onHistoryNavigate(blackIdx)}
                        className={`text-left font-bold flex items-center gap-0.5 px-1 py-0.5 rounded transition w-full cursor-pointer ${
                          isBlackViewed ? "bg-amber-500 text-slate-950" : "text-slate-300 hover:bg-slate-900"
                        }`}
                      >
                        <ChevronRight className={`w-3 h-3 ${isBlackViewed ? "text-slate-950" : "text-slate-500/40"}`} />
                        {blackMvStr}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ---- Playback controls: watch the game like a video ---- */}
        {moveHistory.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-slate-800 pt-2 shrink-0">
            {/* transport row */}
            <div className="flex items-center justify-center gap-1.5">
              <button
                onClick={() => { setIsPlaying(false); onHistoryNavigate(0); }}
                disabled={historyViewIndex === 0}
                className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition cursor-pointer"
                title="First move"
              >
                <SkipBack className="w-4 h-4" />
              </button>
              <button
                onClick={() => { setIsPlaying(false); onHistoryNavigate(historyViewIndex === null ? moveHistory.length - 2 : Math.max(0, historyViewIndex - 1)); }}
                disabled={historyViewIndex === 0}
                className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition cursor-pointer"
                title="Step back"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {/* play / pause -- the big central button */}
              <button
                onClick={() => {
                  const atEnd = historyViewIndex === null || historyViewIndex >= moveHistory.length - 1;
                  if (atEnd) onHistoryNavigate(0);
                  setIsPlaying((p) => !p);
                }}
                className="p-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 transition cursor-pointer shadow-md shadow-amber-500/20"
                title={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </button>
              <button
                onClick={() => { setIsPlaying(false); onHistoryNavigate(historyViewIndex === null ? moveHistory.length - 1 : Math.min(moveHistory.length - 1, historyViewIndex + 1)); }}
                disabled={historyViewIndex === moveHistory.length - 1}
                className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition cursor-pointer"
                title="Step forward"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => { setIsPlaying(false); onHistoryNavigate(moveHistory.length - 1); }}
                disabled={historyViewIndex === moveHistory.length - 1}
                className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition cursor-pointer"
                title="Last move"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>

            {/* speed + position row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-slate-500 font-bold uppercase">Speed</span>
                {SPEEDS.map((sp) => (
                  <button
                    key={sp.label}
                    onClick={() => setSpeedMs(sp.ms)}
                    className={`text-[10px] font-bold px-1.5 py-1 rounded transition cursor-pointer ${speedMs === sp.ms ? "bg-amber-500 text-slate-950" : "bg-slate-950 border border-slate-800 text-slate-400 hover:text-white"}`}
                  >
                    {sp.label}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-slate-500 font-mono">
                {historyViewIndex === null ? moveHistory.length : historyViewIndex + 1}/{moveHistory.length}
              </span>
            </div>

            {historyViewIndex !== null && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => { setIsPlaying(false); onContinueFromHistory(); }}
                  className="flex-1 text-[11px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold px-2.5 py-1.5 rounded-lg hover:bg-emerald-500 hover:text-slate-950 transition cursor-pointer"
                  title="Continue playing from here (Unsaved practice mode)"
                >
                  Resume From Here
                </button>
                <button
                  onClick={() => { setIsPlaying(false); onResetHistoryView(); }}
                  className="flex-1 text-[11px] bg-amber-500/15 border border-amber-500/30 text-amber-400 font-bold px-2.5 py-1.5 rounded-lg hover:bg-amber-500 hover:text-slate-950 transition cursor-pointer"
                >
                  Back to Live
                </button>
              </div>
            )}

            {(hasResumedAnalysis || onGoBackToAnalysis) && (
              <div className="pt-2 border-t border-slate-800/80">
                <button
                  onClick={onGoBackToAnalysis}
                  className="w-full text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-3 py-2 rounded-xl transition flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/20 cursor-pointer"
                >
                  <Compass className="w-4 h-4" /> Go Back to Analysis
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {isEditorMode && (
        <p className="text-[10px] text-slate-600 italic font-sans px-1">
          Position Editor: use the brush panel under the board to set up any position.
        </p>
      )}
    </div>
  );
}
