import React, { useState } from "react";
import { Trophy, RefreshCw, ArrowLeft, Swords, Compass, Play, Copy, Check, ShieldAlert, Loader2 } from "lucide-react";
import { ModalShell } from "../ui/ModalShell";
import { RematchSeriesData } from "../../types/gameRecords";

export interface GameOverModalProps {
  open?: boolean;
  gameOverInfo?: {
    outcome: "win" | "loss" | "draw";
    isAIGame?: boolean;
    canLevelUp?: boolean;
  } | null;
  statusMessage?: string;
  player1?: string; // e.g. "Kehinde"
  player2?: string; // e.g. "Toyin"
  player1Score?: string; // "1", "0", "½"
  player2Score?: string; // "0", "1", "½"
  finalResult?: string; // "1–0", "0–1", "½–½"
  outcome?: "win" | "loss" | "draw"; // VICTORY / DEFEAT / DRAW
  resultReason?: string; // e.g. "Opponent Resigned", "Draw Agreement", "Timeout", "Normal Win - Opponent has no legal moves"
  gameCode?: string; // e.g. "2690001"
  previousGameCode?: string | null;
  movesCount?: number; // e.g. 47
  durationSeconds?: number; // e.g. 522
  seriesData?: RematchSeriesData | null;
  currentUsername?: string;
  rematchState?: {
    status: "idle" | "waiting" | "requested" | "accepted" | "declined";
    fromUsername?: string;
    message?: string;
    newGameCode?: string;
  };
  onAnalyzeGame?: () => void;
  onViewReplay?: () => void;
  onRematch?: () => void;
  onCancelRematch?: () => void;
  onAcceptRematch?: () => void;
  onDeclineRematch?: () => void;
  onBackToArena?: () => void;
  onBackToLobby?: () => void;
  /** Best-of-N: close the modal and wait for the next game to auto-start (never forfeits). */
  onWaitForNextGame?: () => void;
  onGoBackToAnalysis?: () => void;
  canLevelUp?: boolean;
  onLevelUp?: () => void;
  levelUpPending?: boolean;
  levelUpError?: string | null;
  isUnsavedPracticeGame?: boolean;
  seriesNote?: string | null;
  hideRematch?: boolean;
}

function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function GameOverModal({
  open,
  gameOverInfo,
  statusMessage,
  player1,
  player2,
  player1Score,
  player2Score,
  finalResult,
  outcome,
  resultReason,
  gameCode,
  previousGameCode,
  movesCount = 0,
  durationSeconds = 0,
  seriesData,
  currentUsername,
  rematchState = { status: "idle" },
  onAnalyzeGame,
  onViewReplay,
  onRematch,
  onCancelRematch,
  onAcceptRematch,
  onDeclineRematch,
  onBackToArena,
  onBackToLobby,
  onWaitForNextGame,
  onGoBackToAnalysis,
  canLevelUp,
  onLevelUp,
  levelUpPending = false,
  levelUpError,
  isUnsavedPracticeGame,
  seriesNote,
  hideRematch = false,
}: GameOverModalProps) {
  const [copied, setCopied] = useState(false);

  const isModalOpen = open !== undefined ? open : !!gameOverInfo;
  const resolvedOutcome = outcome || gameOverInfo?.outcome || "draw";
  const resolvedCanLevelUp = canLevelUp !== undefined ? canLevelUp : !!gameOverInfo?.canLevelUp;
  const handleBack = onBackToArena || onBackToLobby || (() => {});
  // While a series is still running, closing the modal must never forfeit:
  // dismissing waits for the next game instead of leaving the room.
  const handleClose = onWaitForNextGame || handleBack;
  const resolvedResultReason = resultReason || (
    statusMessage
      ? statusMessage.includes("resigned")
        ? "Opponent Resigned"
        : statusMessage.includes("mutual agreement") || statusMessage.includes("agreed")
        ? "Draw Agreement"
        : statusMessage.includes("out of time") || statusMessage.includes("timeout")
        ? "Timeout"
        : statusMessage.includes("abandoned") || statusMessage.includes("left")
        ? "Opponent Abandoned"
        : "Normal Win"
      : "Normal Win"
  );

  const handleCopyCode = () => {
    if (!gameCode) return;
    navigator.clipboard?.writeText(gameCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Derive display scores
  let s1 = player1Score;
  let s2 = player2Score;
  if (!s1 || !s2) {
    if (finalResult === "1–0") {
      s1 = "1";
      s2 = "0";
    } else if (finalResult === "0–1") {
      s1 = "0";
      s2 = "1";
    } else if (finalResult === "½–½" || outcome === "draw") {
      s1 = "½";
      s2 = "½";
    } else if (outcome === "win") {
      s1 = "1";
      s2 = "0";
    } else {
      s1 = "0";
      s2 = "1";
    }
  }

  // Calculate series user stats if available
  let myWins = 0;
  let myLosses = 0;
  let seriesDraws = seriesData?.draws || 0;
  if (seriesData && currentUsername) {
    myWins = seriesData.scores[currentUsername] || 0;
    for (const [uname, score] of Object.entries(seriesData.scores)) {
      if (uname !== currentUsername) {
        myLosses = score;
      }
    }
  }

  return (
    <ModalShell open={isModalOpen} onClose={handleClose} size="md" dismissable={false}>
      <div className="flex flex-col gap-4 pb-2 pt-1 text-slate-100">
        {/* Title */}
        <div className="text-center">
          <span className="text-[11px] font-black uppercase tracking-widest text-slate-400 font-mono">
            GAME OVER
          </span>
        </div>

        {/* Players Matchup and Score */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-inner">
          <div className="flex-1 text-left">
            <span className="text-[11px] font-mono uppercase text-slate-500 block">PLAYER 1</span>
            <span className="text-base font-bold text-slate-200 truncate block max-w-[130px] sm:max-w-[160px]">
              {player1 || "Player 1"}
            </span>
          </div>

          <div className="px-4 py-1.5 rounded-xl bg-slate-950/90 border border-slate-700/60 font-mono font-black text-xl text-amber-400 tracking-wider flex items-center gap-2 shadow">
            <span>{s1}</span>
            <span className="text-slate-500 font-normal">—</span>
            <span>{s2}</span>
          </div>

          <div className="flex-1 text-right">
            <span className="text-[11px] font-mono uppercase text-slate-500 block">PLAYER 2</span>
            <span className="text-base font-bold text-slate-200 truncate block max-w-[130px] sm:max-w-[160px]">
              {player2 || "Player 2"}
            </span>
          </div>
        </div>

        {/* Victory / Defeat / Draw Banner */}
        <div className="flex flex-col items-center justify-center text-center py-2">
          {resolvedOutcome === "win" ? (
            <div className="flex items-center gap-2">
              <Trophy className="w-6 h-6 text-amber-400" />
              <h2 className="text-2xl font-black tracking-wider text-amber-400 font-sans uppercase">
                VICTORY
              </h2>
            </div>
          ) : resolvedOutcome === "draw" ? (
            <h2 className="text-2xl font-black tracking-wider text-emerald-400 font-sans uppercase">
              DRAW
            </h2>
          ) : (
            <h2 className="text-2xl font-black tracking-wider text-rose-400 font-sans uppercase">
              DEFEAT
            </h2>
          )}

          {isUnsavedPracticeGame && (
            <span className="text-[11px] text-amber-400/90 font-medium bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full mt-2">
              Practice position complete! (Not saved to match history)
            </span>
          )}
        </div>

        {/* Game Stats Card */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl divide-y divide-slate-800/60 text-xs">
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span className="text-slate-400 font-medium">Result:</span>
            <span className="font-bold text-slate-200">{resolvedResultReason}</span>
          </div>

          <div className="px-4 py-2.5 flex items-center justify-between">
            <span className="text-slate-400 font-medium">Game Code:</span>
            <div className="flex items-center gap-2 font-mono">
              <span className="font-bold text-amber-400 tracking-wider text-sm">{gameCode || "—"}</span>
              {gameCode && (
                <button
                  onClick={handleCopyCode}
                  title="Copy Game Code"
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          </div>

          <div className="px-4 py-2.5 flex items-center justify-between">
            <span className="text-slate-400 font-medium">Moves:</span>
            <span className="font-mono font-bold text-slate-200">{movesCount}</span>
          </div>

          <div className="px-4 py-2.5 flex items-center justify-between">
            <span className="text-slate-400 font-medium">Duration:</span>
            <span className="font-mono font-bold text-slate-200">{formatDuration(durationSeconds)}</span>
          </div>
        </div>

        {/* Series Note / Status */}
        {seriesNote && (
          <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-xl p-3 text-center text-xs text-indigo-200 flex items-center justify-center gap-2">
            <span>{seriesNote}</span>
          </div>
        )}

        {/* Match Series Section (if series exists) */}
        {seriesData && seriesData.seriesGamesCount > 0 && (
          <div className="bg-indigo-950/20 border border-indigo-500/20 rounded-xl p-3.5 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-wider text-indigo-300 font-mono flex items-center gap-1.5">
                <Swords className="w-3.5 h-3.5" /> MATCH SERIES
              </span>
              <span className="text-[11px] font-mono text-indigo-300/80">
                Series Games: {seriesData.seriesGamesCount}
              </span>
            </div>

            {/* List of games in series */}
            <div className="flex flex-col gap-1.5 max-h-32 overflow-y-auto pr-1">
              {seriesData.games.map((g, idx) => (
                <div
                  key={g.gameCode || idx}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-mono border ${
                    g.gameCode === gameCode
                      ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-100 font-bold"
                      : "bg-slate-900/40 border-slate-800 text-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-amber-400 text-[11px]">#{g.gameCode}</span>
                    <span className="truncate">{g.player1} vs {g.player2}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-black text-slate-100">{g.score}</span>
                    <span className="text-[10px] text-slate-400 truncate max-w-[80px]">({g.resultReason})</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Series Summary stats */}
            <div className="grid grid-cols-4 gap-2 pt-1 border-t border-indigo-500/20 text-center font-mono text-[11px]">
              <div>
                <span className="text-slate-400 block text-[10px]">Games</span>
                <span className="font-bold text-slate-200">{seriesData.seriesGamesCount}</span>
              </div>
              <div>
                <span className="text-emerald-400 block text-[10px]">Wins</span>
                <span className="font-bold text-emerald-300">{myWins}</span>
              </div>
              <div>
                <span className="text-rose-400 block text-[10px]">Losses</span>
                <span className="font-bold text-rose-300">{myLosses}</span>
              </div>
              <div>
                <span className="text-amber-400 block text-[10px]">Draws</span>
                <span className="font-bold text-amber-300">{seriesDraws}</span>
              </div>
            </div>
          </div>
        )}

        {/* Rematch States & Alerts */}
        {rematchState.status === "waiting" && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center justify-between gap-3 text-xs text-amber-200">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
              <span>Waiting for your opponent to respond...</span>
            </div>
            {onCancelRematch && (
              <button
                onClick={onCancelRematch}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-[11px] cursor-pointer"
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {rematchState.status === "requested" && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex flex-col gap-2.5 text-xs text-emerald-200">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" />
              <span className="font-semibold">Your opponent wants to rematch.</span>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                id="decline-rematch-btn"
                onClick={onDeclineRematch}
                className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer text-center"
              >
                DECLINE
              </button>
              <button
                id="accept-rematch-btn"
                onClick={onAcceptRematch}
                className="py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer text-center shadow"
              >
                ACCEPT
              </button>
            </div>
          </div>
        )}

        {rematchState.status === "accepted" && (
          <div className="bg-emerald-500/15 border border-emerald-500/40 rounded-xl p-3 text-center text-xs text-emerald-200 flex flex-col items-center gap-1">
            <span className="font-bold text-sm text-emerald-300">Rematch accepted.</span>
            <span className="font-mono text-slate-300 flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
              Moving to Game {rematchState.newGameCode || "next"}...
            </span>
          </div>
        )}

        {rematchState.status === "declined" && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-center text-xs text-rose-300 flex items-center justify-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <span>Your opponent declined the rematch.</span>
          </div>
        )}

        {resolvedCanLevelUp && levelUpError && <p role="alert" className="text-xs text-rose-300">{levelUpError}</p>}

        {/* Action Buttons */}
        <div className="flex flex-col gap-2 pt-1">
          {resolvedCanLevelUp && onLevelUp && (
            <button
              id="game-over-levelup-button"
              disabled={levelUpPending}
              aria-busy={levelUpPending}
              onClick={onLevelUp}
              className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-2.5 rounded-xl transition text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-amber-500/20 uppercase tracking-wider"
            >
              {levelUpPending ? "Saving earned level…" : "Move to Higher Level"}
            </button>
          )}

          {onGoBackToAnalysis && (
            <button
              id="game-over-return-analysis-button"
              onClick={onGoBackToAnalysis}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-xl transition text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-indigo-600/20 uppercase tracking-wider"
            >
              <Compass className="w-4 h-4 text-indigo-200" />
              Return to Analysis Lab
            </button>
          )}

          <div className={`grid ${onAnalyzeGame && onViewReplay ? "grid-cols-2" : "grid-cols-1"} gap-2`}>
            {onAnalyzeGame && <button
              id="game-over-analyze-button"
              onClick={onAnalyzeGame}
              className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2.5 rounded-xl transition text-xs flex items-center justify-center gap-2 cursor-pointer border border-slate-700/60 uppercase tracking-wider"
            >
              <Compass className="w-4 h-4 text-amber-400" />
              ANALYZE GAME
            </button>}

            {onViewReplay && <button
              id="game-over-replay-button"
              onClick={onViewReplay}
              className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2.5 rounded-xl transition text-xs flex items-center justify-center gap-2 cursor-pointer border border-slate-700/60 uppercase tracking-wider"
            >
              <Play className="w-4 h-4 text-sky-400" />
              VIEW REPLAY
            </button>}
          </div>

          {!hideRematch && onRematch && rematchState.status !== "waiting" && rematchState.status !== "accepted" && (
            <button
              id="game-over-rematch-button"
              onClick={onRematch}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold py-3 rounded-xl transition text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-600/25 uppercase tracking-wider"
            >
              <RefreshCw className="w-4 h-4" />
              REMATCH
            </button>
          )}

          {onWaitForNextGame && (
            <button
              id="game-over-wait-next-game-button"
              onClick={onWaitForNextGame}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold py-3 rounded-xl transition text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/25 uppercase tracking-wider"
            >
              <Loader2 className="w-4 h-4 animate-spin text-indigo-200" />
              WAIT FOR NEXT GAME
            </button>
          )}

          <button
            id="game-over-back-to-arena-button"
            onClick={handleBack}
            className="w-full bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 font-bold py-2.5 rounded-xl transition text-xs flex items-center justify-center gap-2 cursor-pointer border border-slate-800 uppercase tracking-wider"
          >
            <ArrowLeft className="w-4 h-4" />
            BACK TO ARENA
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
