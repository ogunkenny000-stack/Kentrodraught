import React, { useState } from "react";
import { Trophy, Compass, Play, Copy, Check, Share2, Calendar, Clock, Swords } from "lucide-react";
import { ModalShell } from "../ui/ModalShell";
import { KentroGameRecord } from "../../types/gameRecords";

interface GameResultDetailModalProps {
  open: boolean;
  onClose: () => void;
  game: KentroGameRecord | null;
  onAnalyze?: (game: any) => void;
  onViewReplay?: (game: any) => void;
}

function formatDuration(totalSeconds: number): string {
  if (!totalSeconds) return "00:00";
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function GameResultDetailModal({
  open,
  onClose,
  game,
  onAnalyze,
  onViewReplay,
}: GameResultDetailModalProps) {
  const [copied, setCopied] = useState(false);

  if (!game) return null;

  const handleCopyCode = () => {
    navigator.clipboard?.writeText(game.gameCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: `KentroDraught Game #${game.gameCode}`,
        text: `Check out KentroDraught Game #${game.gameCode}: ${game.player1} vs ${game.player2} (${game.finalResult}, ${game.resultReason})`,
        url: window.location.href,
      }).catch(() => handleCopyCode());
    } else {
      handleCopyCode();
    }
  };

  const formattedDate = game.gameEndTime
    ? new Date(game.gameEndTime).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Recent";

  return (
    <ModalShell open={open} onClose={onClose} size="md">
      <div className="flex flex-col gap-4 text-slate-100 p-1">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-black text-amber-400">
              GAME #{game.gameCode}
            </span>
            {game.previousGameCode && (
              <span className="text-[10px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-full">
                Rematch of #{game.previousGameCode}
              </span>
            )}
          </div>
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-amber-400 transition cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
            <span>{copied ? "Copied!" : "Share Code"}</span>
          </button>
        </div>

        {/* Matchup and Score Banner */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
          <div className="flex-1 text-left">
            <span className="text-[10px] font-mono uppercase text-slate-500 block">WHITE</span>
            <span className="text-sm sm:text-base font-bold text-slate-100 truncate block">
              {game.player1 || game.whitePlayer}
            </span>
          </div>

          <div className="px-3.5 py-1 rounded-xl bg-slate-950 border border-slate-700/60 font-mono font-black text-lg text-amber-400 tracking-wider">
            {game.finalResult}
          </div>

          <div className="flex-1 text-right">
            <span className="text-[10px] font-mono uppercase text-slate-500 block">BLACK</span>
            <span className="text-sm sm:text-base font-bold text-slate-100 truncate block">
              {game.player2 || game.blackPlayer}
            </span>
          </div>
        </div>

        {/* Outcome Badge */}
        <div className="text-center py-1">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${
            game.isDraw
              ? "bg-slate-800 text-slate-300 border border-slate-700"
              : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
          }`}>
            <Trophy className="w-3.5 h-3.5" />
            {game.isDraw ? "DRAW" : `${game.winner || "Winner"} WON`}
          </span>
        </div>

        {/* Details Table */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl divide-y divide-slate-800/60 text-xs">
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span className="text-slate-400">Result Reason:</span>
            <span className="font-semibold text-slate-200">{game.resultReason}</span>
          </div>
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span className="text-slate-400">Game Code:</span>
            <div className="flex items-center gap-2 font-mono">
              <span className="font-bold text-amber-400">{game.gameCode}</span>
              <button
                onClick={handleCopyCode}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          </div>
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span className="text-slate-400">Moves:</span>
            <span className="font-mono font-semibold text-slate-200">
              {game.completeMoveHistory?.length || game.moveHistoryStrings?.length || 0}
            </span>
          </div>
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span className="text-slate-400">Duration:</span>
            <span className="font-mono font-semibold text-slate-200">
              {formatDuration(game.durationSeconds)}
            </span>
          </div>
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span className="text-slate-400">Date Played:</span>
            <span className="text-slate-300">{formattedDate}</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2 pt-2">
          {onAnalyze && (
            <button
              onClick={() => {
                onClose();
                onAnalyze(game);
              }}
              className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2.5 rounded-xl transition text-xs flex items-center justify-center gap-2 cursor-pointer border border-slate-700/60 uppercase tracking-wider"
            >
              <Compass className="w-4 h-4 text-amber-400" />
              ANALYZE
            </button>
          )}

          {onViewReplay && (
            <button
              onClick={() => {
                onClose();
                onViewReplay(game);
              }}
              className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-2.5 rounded-xl transition text-xs flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider shadow-md shadow-amber-500/20"
            >
              <Play className="w-4 h-4" />
              VIEW REPLAY
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
