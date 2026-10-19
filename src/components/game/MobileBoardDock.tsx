import { whiteEvaluation, evaluationLabel } from "../../lib/analysisPresentation";
import React, { useState, useEffect, useRef } from "react";
import {
  ListOrdered, Cpu, LineChart, Info, MessageSquare, Check, Sparkles,
  TrendingUp, Award, AlertTriangle, Play, Pause, ChevronRight, Zap,
  Library, Brain, RefreshCw, Loader2, Lightbulb, CheckCircle2, Gauge,
  Swords, Download, Copy, Upload, ArrowRight, ShieldCheck, Flame,
  SkipBack, ChevronLeft, SkipForward, RotateCcw
} from "lucide-react";
import { Board, Move } from "../../gameLogic";
import { EngineEval, MoveEvalResult, PlayMode } from "../../types";
import { QUALITY_BADGE_CLASSES, QUALITY_BADGE_ABBREV } from "../../lib/constants";

export interface MobileBoardDockProps {
  playMode: PlayMode;
  turn: "W" | "B";
  initialTurn?: "W" | "B";
  moveHistory: Move[];
  moveHistoryStrings: string[];
  historyViewIndex: number | null;
  onHistoryNavigate: (index: number) => void;
  onResetHistoryView: () => void;
  onContinueFromHistory?: () => void;
  engineEval: EngineEval;
  moveEvaluations: Record<number, MoveEvalResult>;
  whiteName: string;
  blackName: string;
  isThinking: boolean;
  statusMessage: string;
  kenLevelId: number;
  isComputerMode: boolean;
  renderBoard: Board;
  // Live multiplayer chat props
  multiplayerMessages?: { from: string; text: string }[];
  chatInput?: string;
  setChatInput?: (val: string) => void;
  ws?: WebSocket | null;
  /** Preferred outbound path (socket manager: queue / refuse / reconnect). */
  sendMessage?: (msg: { type: string } & Record<string, unknown>) => boolean;
  spectatorCount?: number;
  roomWagerAmount?: number | null;
  roomId?: string | null;
  yourColor?: "W" | "B" | null;

  // Analysis & Archive Page Triggers
  isReviewing?: boolean;
  reviewProgress?: number;
  onRunAIGameReview?: () => void;
  onOpenAnalysisLabModal?: (tab?: "review" | "coach" | "engine" | "tools") => void;
  onOpenPastGamesModal?: (filter?: "All" | "AI" | "PvP" | "Tournament") => void;
  onOpenPdnModal?: () => void;
  onOpenActionMenu?: () => void;
  isAutoPlaying?: boolean;
  onToggleAutoPlay?: () => void;
}

export function MobileBoardDock({
  playMode,
  turn,
  initialTurn = "W",
  moveHistory,
  moveHistoryStrings,
  historyViewIndex,
  onHistoryNavigate,
  onResetHistoryView,
  onContinueFromHistory,
  engineEval,
  moveEvaluations,
  whiteName,
  blackName,
  isThinking,
  statusMessage,
  kenLevelId,
  isComputerMode,
  multiplayerMessages,
  chatInput,
  setChatInput,
  ws,
  sendMessage,
  isReviewing = false,
  reviewProgress = 0,
  onRunAIGameReview,
  onOpenAnalysisLabModal,
  onOpenPastGamesModal,
  onOpenPdnModal,
  onOpenActionMenu,
  isAutoPlaying = false,
  onToggleAutoPlay,
}: MobileBoardDockProps) {
  const [activeSubView, setActiveSubView] = useState<"moves" | "chat">(
    playMode === "Multiplayer" ? "chat" : "moves"
  );

  const send = (msg: { type: string } & Record<string, unknown>): boolean => {
    if (sendMessage) return sendMessage(msg);
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  };

  // Keep the chat stream pinned to the newest message.
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatCount = multiplayerMessages ? multiplayerMessages.length : 0;
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatCount, activeSubView]);

  const whiteScore = whiteEvaluation(engineEval, turn);
  const scoreLabel = evaluationLabel(engineEval, turn);
  const currentPly = historyViewIndex !== null ? historyViewIndex : moveHistory.length > 0 ? moveHistory.length - 1 : null;

  // Move step controls
  const handleStepBack = () => {
    if (moveHistory.length === 0) return;
    if (historyViewIndex === null) {
      if (moveHistory.length >= 2) onHistoryNavigate(moveHistory.length - 2);
      else onHistoryNavigate(-1);
    } else if (historyViewIndex > -1) {
      onHistoryNavigate(historyViewIndex - 1);
    }
  };

  const handleStepForward = () => {
    if (moveHistory.length === 0 || historyViewIndex === null) return;
    if (historyViewIndex < moveHistory.length - 1) {
      onHistoryNavigate(historyViewIndex + 1);
    } else {
      onResetHistoryView();
    }
  };

  const handleFirstMove = () => {
    if (moveHistory.length > 0) onHistoryNavigate(-1);
  };

  const handleLastMove = () => {
    onResetHistoryView();
  };

  // Group moves into pairs: [Move 1: W, B], [Move 2: W, B]
  const movePairs: { index: number; white?: { text: string; ply: number }; black?: { text: string; ply: number } }[] = [];
  for (let row = 0; row < Math.ceil((moveHistoryStrings.length + (initialTurn === "B" ? 1 : 0)) / 2); row++) {
    const w = initialTurn === "W" ? row * 2 : row * 2 - 1;
    const b = initialTurn === "W" ? row * 2 + 1 : row * 2;
    movePairs.push({ index: row + 1,
      white: w >= 0 && w < moveHistoryStrings.length ? { text: moveHistoryStrings[w], ply: w } : undefined,
      black: b < moveHistoryStrings.length ? { text: moveHistoryStrings[b], ply: b } : undefined });
  }

  return (
    <div className="w-full max-w-[min(96vw,520px)] bg-slate-950/95 border border-slate-800/90 rounded-2xl flex flex-col overflow-hidden shadow-2xl shrink-0 h-[135px] sm:h-[145px] transition-all">
      {/* Top Quick Bar: Live Eval Score & Spacious Page Launcher Buttons */}
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-900/95 border-b border-slate-800/90 shrink-0 gap-1 overflow-x-auto scrollbar-none">
        {/* Turn / Ply Status Badge */}
        <div className="flex items-center gap-1.5 shrink-0">
          {playMode === "Analysis" && (
            <div className={`px-2 py-0.5 rounded-lg text-[10px] font-black font-mono tracking-tight shadow-sm flex items-center gap-1 ${
              whiteScore > 50
                ? "bg-amber-400/20 text-amber-300 border border-amber-400/40"
                : whiteScore < -50
                ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                : "bg-slate-800 text-slate-300 border border-slate-700"
            }`}>
              <span>{scoreLabel}</span>
            </div>
          )}

          <span className="text-[10px] font-extrabold text-slate-300 font-sans truncate max-w-[120px] sm:max-w-[180px]">
            {historyViewIndex !== null
              ? historyViewIndex === -1 ? "Starting position" : `Move #${historyViewIndex + 1}`
              : isThinking
              ? "Ken is thinking..."
              : isComputerMode
              ? `Ken Lvl ${kenLevelId}`
              : `${turn === "W" ? "White" : "Black"} to move`}
          </span>
        </div>

        {/* Spacious Page Triggers -- Clean high-contrast buttons ONLY in Analysis mode */}
        <div className="flex items-center gap-1 shrink-0">
          {playMode === "Analysis" && (
            <>
              {/* ARCHIVE BUTTON: Opens dedicated full-page PastGamesModal */}
              {onOpenPastGamesModal && (
                <button
                  onClick={() => onOpenPastGamesModal("All")}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-sky-500/15 hover:bg-sky-500 text-sky-300 hover:text-slate-950 border border-sky-500/30 transition flex items-center gap-1 cursor-pointer shadow-sm active:scale-95"
                  title="Open Full Archive (100 Games per Page)"
                >
                  <Library className="w-3.5 h-3.5" />
                  <span>Archive</span>
                </button>
              )}

              {/* SMART LAB BUTTON: Opens dedicated full-page AnalysisLabModal */}
              {onOpenAnalysisLabModal && (
                <button
                  onClick={() => onOpenAnalysisLabModal("review")}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/40 transition flex items-center gap-1 cursor-pointer shadow-sm active:scale-95"
                  title="Open Analysis Lab & Full AI Game Review"
                >
                  <Brain className="w-3.5 h-3.5" />
                  <span>Lab</span>
                </button>
              )}

              {/* STATS BUTTON: Opens dedicated full-page Accuracy breakdown */}
              {onOpenAnalysisLabModal && (
                <button
                  onClick={() => onOpenAnalysisLabModal("coach")}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-emerald-500/15 hover:bg-emerald-500 text-emerald-300 hover:text-slate-950 border border-emerald-500/30 transition flex items-center gap-1 cursor-pointer shadow-sm active:scale-95"
                  title="Tactical Coach & Positioning Advice"
                >
                  <Lightbulb className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Coach</span>
                </button>
              )}

              {/* IMPORT PDN / FEN BUTTON */}
              {onOpenPdnModal && (
                <button
                  onClick={onOpenPdnModal}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition flex items-center gap-1 cursor-pointer active:scale-95"
                  title="Import PDN Notation or FEN"
                >
                  <Download className="w-3 h-3" />
                  <span className="hidden sm:inline">Import</span>
                </button>
              )}
            </>
          )}

          {/* MULTIPLAYER CHAT TOGGLE */}
          {playMode === "Multiplayer" && (
            <button
              onClick={() => setActiveSubView(activeSubView === "chat" ? "moves" : "chat")}
              className={`p-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer relative ${
                activeSubView === "chat"
                  ? "bg-amber-500 text-slate-950"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
              title="Toggle Match Chat"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              {multiplayerMessages && multiplayerMessages.length > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 absolute top-1 right-1" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Dock Content Body: Clean Scrollable Move Strip with Step Controls */}
      <div className="flex-1 min-h-0 flex flex-col justify-between p-1.5 text-xs">
        {activeSubView === "moves" ? (
          <div className="h-full flex flex-col justify-between gap-1">
            {/* Scrollable Move Pairs Grid */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 scrollbar-thin">
              {movePairs.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-500 text-[11px] font-sans text-center px-4">
                  {playMode === "Analysis" ? (
                    <>Match moves record here. Tap <strong className="text-amber-400 mx-1">Lab</strong> for full AI analysis or <strong className="text-sky-400 mx-1">Archive</strong> for past matches.</>
                  ) : (
                    "Moves played during this match will appear here."
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 auto-rows-min">
                  {movePairs.map((pair) => (
                    <div
                      key={pair.index}
                      className="flex items-center gap-1 bg-slate-900/70 px-1.5 py-0.5 rounded-lg border border-slate-850 text-[10px] font-mono"
                    >
                      <span className="text-slate-500 w-3.5 font-bold shrink-0 text-right">{pair.index}.</span>
                      {pair.white && (
                        <button
                          onClick={() => onHistoryNavigate(pair.white!.ply)}
                          className={`flex-1 text-left px-1 py-0.5 rounded cursor-pointer transition truncate ${
                            historyViewIndex === pair.white.ply
                              ? "bg-amber-500 text-slate-950 font-black shadow-sm"
                              : "text-slate-200 hover:bg-slate-800"
                          }`}
                        >
                          {pair.white.text}
                          {moveEvaluations[pair.white.ply] && (
                            <span className={`ml-0.5 text-[8px] font-black ${
                              QUALITY_BADGE_CLASSES[moveEvaluations[pair.white.ply].quality] || "text-slate-400"
                            }`}>
                              {QUALITY_BADGE_ABBREV[moveEvaluations[pair.white.ply].quality]}
                            </span>
                          )}
                        </button>
                      )}
                      {pair.black && (
                        <button
                          onClick={() => onHistoryNavigate(pair.black!.ply)}
                          className={`flex-1 text-left px-1 py-0.5 rounded cursor-pointer transition truncate ${
                            historyViewIndex === pair.black.ply
                              ? "bg-amber-500 text-slate-950 font-black shadow-sm"
                              : "text-slate-200 hover:bg-slate-800"
                          }`}
                        >
                          {pair.black.text}
                          {moveEvaluations[pair.black.ply] && (
                            <span className={`ml-0.5 text-[8px] font-black ${
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
              )}
            </div>

            {/* Bottom Quick Step Controls Strip */}
            <div className="flex items-center justify-between pt-1 border-t border-slate-900 text-[10px] shrink-0">
              <div className="flex items-center gap-1">
                <button
                  onClick={handleFirstMove}
                  disabled={moveHistory.length === 0 || historyViewIndex === -1}
                  className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                  title="First move"
                >
                  <SkipBack className="w-3 h-3" />
                </button>
                <button
                  onClick={handleStepBack}
                  disabled={moveHistory.length === 0 || historyViewIndex === -1}
                  className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                  title="Previous move"
                >
                  <ChevronLeft className="w-3 h-3" />
                </button>

                {/* Auto-Play / Pause Button */}
                {onToggleAutoPlay && (
                  <button
                    onClick={onToggleAutoPlay}
                    disabled={moveHistory.length === 0}
                    className={`p-1 rounded transition cursor-pointer ${
                      isAutoPlaying
                        ? "bg-amber-500 text-slate-950 font-black"
                        : "bg-slate-900 hover:bg-slate-800 text-amber-400 hover:text-amber-300 disabled:opacity-30"
                    }`}
                    title={isAutoPlaying ? "Pause Auto-Play" : "Play Move-by-Move"}
                  >
                    {isAutoPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 fill-current" />}
                  </button>
                )}

                <button
                  onClick={handleStepForward}
                  disabled={moveHistory.length === 0 || historyViewIndex === null}
                  className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                  title="Next move"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
                <button
                  onClick={handleLastMove}
                  disabled={moveHistory.length === 0 || historyViewIndex === null}
                  className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                  title="Latest position"
                >
                  <SkipForward className="w-3 h-3" />
                </button>
              </div>

              {historyViewIndex !== null && onContinueFromHistory ? (
                <button
                  onClick={onContinueFromHistory}
                  className="px-2 py-0.5 bg-emerald-500/20 border border-emerald-500/40 hover:bg-emerald-500 hover:text-slate-950 text-emerald-300 font-bold rounded-lg text-[9px] transition cursor-pointer"
                >
                  Play from Here
                </button>
              ) : (
                <span className="text-[9px] text-slate-500 font-mono">
                  {moveHistory.length} moves played
                </span>
              )}
            </div>
          </div>
        ) : (
          /* MULTIPLAYER CHAT VIEW */
          <div className="flex flex-col gap-1 h-full justify-between">
            {/* Quick Reactions */}
            <div className="flex justify-between bg-slate-900/80 px-2 py-0.5 rounded-lg border border-slate-800">
              {["😂", "🔥", "👍", "👑", "💥", "🧠"].map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => { send({ type: "emoji-reaction", emoji }); }}
                  className="text-xs hover:scale-125 transition cursor-pointer"
                >
                  {emoji}
                </button>
              ))}
            </div>

            {/* Chat Stream */}
            <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-y-auto bg-slate-900/40 p-1 rounded-lg border border-slate-850 flex flex-col gap-0.5 text-[9px]">
              {(!multiplayerMessages || multiplayerMessages.length === 0) ? (
                <div className="text-slate-500 italic text-center py-1 text-[9px]">
                  No messages yet. Send a quick chat or emoji!
                </div>
              ) : (
                multiplayerMessages.map((msg, idx) => (
                  <div key={idx} className="flex items-center gap-1">
                    <span className="font-bold text-amber-400">{msg.from}:</span>
                    <span className="text-slate-200">{msg.text}</span>
                  </div>
                ))
              )}
            </div>

            {/* Chat Input */}
            {setChatInput && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (chatInput && chatInput.trim() !== "") {
                    if (send({ type: "chat", text: chatInput.trim() })) setChatInput("");
                  }
                }}
                className="flex gap-1 pt-0.5"
              >
                <input
                  type="text"
                  value={chatInput || ""}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Chat..."
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2 py-0.5 text-[9px] text-white focus:outline-none focus:border-amber-500"
                />
                <button
                  type="submit"
                  disabled={!chatInput || chatInput.trim() === ""}
                  className="px-2 py-0.5 bg-amber-500 text-slate-950 font-black rounded-lg text-[9px] disabled:opacity-40 cursor-pointer"
                >
                  Send
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
