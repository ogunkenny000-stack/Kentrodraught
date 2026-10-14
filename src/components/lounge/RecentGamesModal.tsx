import React, { useState, useEffect } from "react";
import { X, Gamepad2, Share2, Trophy, Clock, Search } from "lucide-react";
import { matchOutcome, uniqueCompletedMatches } from "../../lib/completedMatches";
import { MatchResultPair } from "../MatchResultPair";
import type { GameShareData } from "./types";

interface RecentGamesModalProps {
  isOpen: boolean;
  onClose: () => void;
  username: string;
  myGamesList?: any[];
  onShareGame: (gameData: GameShareData) => void;
  fetchMyGames?: () => void;
}

export const RecentGamesModal: React.FC<RecentGamesModalProps> = ({
  isOpen,
  onClose,
  username,
  myGamesList = [],
  onShareGame,
  fetchMyGames
}) => {
  const games = uniqueCompletedMatches(myGamesList);
  const [filter, setFilter] = useState<string>("");


  useEffect(() => {
    if (isOpen) fetchMyGames?.();
    // Refresh on opening only; data flows reactively from the shared App archive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, username]);

  if (!isOpen) return null;

  const filteredGames = games.filter((g) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    const white = (g.white_player || g.whitePlayer || "").toLowerCase();
    const black = (g.black_player || g.blackPlayer || "").toLowerCase();
    const res = String(g.winner || g.result || "").toLowerCase();
    return white.includes(q) || black.includes(q) || res.includes(q);
  });

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-lg bg-[#090b16] border border-amber-500/20 rounded-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-900 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Gamepad2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider font-sans">
                Share KentroDraught Match
              </h3>
              <p className="text-[10px] text-slate-400">
                Pick a completed game to share into this chat thread
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter input */}
        <div className="p-3 border-b border-slate-900 bg-slate-950/30">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter by opponent or result..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full bg-slate-900/90 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-amber-500/40"
            />
          </div>
        </div>

        {/* List of games */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5 scrollbar-thin">
          {filteredGames.length === 0 ? (
            <div className="text-center py-12 text-slate-500 flex flex-col items-center gap-2">
              <Trophy className="w-8 h-8 text-slate-600" />
              <span className="text-xs font-bold text-slate-400">No completed matches found</span>
              <span className="text-[10px] text-slate-500">
                Play a multiplayer or computer match to review and share it here!
              </span>
            </div>
          ) : (
            filteredGames.map((game, i) => {
              const white = game.white_player || game.whitePlayer || "Player 1";
              const black = game.black_player || game.blackPlayer || "Player 2";
              const code = game.gameId || game.room_id || game.id || "Unknown";
              const whiteOutcome = matchOutcome(game, "white");
              const result = whiteOutcome === "Won" ? `${white} Won` : whiteOutcome === "Loss" ? `${black} Won` : whiteOutcome === "Draw" ? "Draw" : "Match Concluded";
              const movesCount = Array.isArray(game.moveHistory) ? game.moveHistory.length : 0;

              return (
                <div
                  key={code}
                  className="p-3 bg-slate-950/60 border border-slate-900 hover:border-amber-500/40 rounded-2xl flex items-center justify-between gap-3 transition"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <MatchResultPair game={game} compact />

                    <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                      <span>Code: #{code}</span>
                      <span>•</span>
                      <span>{movesCount} Moves</span>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      onShareGame({
                        gameCode: String(code),
                        whitePlayer: white,
                        blackPlayer: black,
                        result: result,
                        movesCount: movesCount,
                        timeControl: game.time_control || "Rapid",
                        gameData: game
                      });
                      onClose();
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-black uppercase transition shrink-0 cursor-pointer shadow-md shadow-amber-500/10"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Share</span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
