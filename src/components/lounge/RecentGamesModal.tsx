import React, { useState, useEffect } from "react";
import { X, Gamepad2, Share2, Trophy, Clock, Search } from "lucide-react";
import { supabase } from "../../supabase";
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
  const [games, setGames] = useState<any[]>(myGamesList);
  const [filter, setFilter] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    if (fetchMyGames) fetchMyGames();

    const loadGames = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("completed_games")
          .select("*")
          .or(`white_player.eq.${username},black_player.eq.${username}`)
          .order("created_at", { ascending: false })
          .limit(25);

        if (!error && data && data.length > 0) {
          setGames(data);
        } else if (myGamesList && myGamesList.length > 0) {
          setGames(myGamesList);
        }
      } catch (err) {
        if (myGamesList) setGames(myGamesList);
      } finally {
        setLoading(false);
      }
    };

    loadGames();
  }, [isOpen, username, myGamesList, fetchMyGames]);

  if (!isOpen) return null;

  const filteredGames = games.filter((g) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    const white = (g.white_player || g.whitePlayer || "").toLowerCase();
    const black = (g.black_player || g.blackPlayer || "").toLowerCase();
    const res = (g.result || "").toLowerCase();
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
          {loading ? (
            <div className="text-center py-12 text-xs text-slate-500">
              Loading recent Draughts matches...
            </div>
          ) : filteredGames.length === 0 ? (
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
              const code = game.room_id || game.id || `KNT-${Math.floor(10000 + Math.random() * 90000)}`;
              const result = game.result || (game.winner ? `${game.winner} Won` : "Match Concluded");
              const movesCount = game.total_moves || game.moves?.length || 24;

              const isMeWhite = white.toLowerCase() === username.toLowerCase();
              const myOutcome =
                result.toLowerCase().includes("draw")
                  ? "Draw 🤝"
                  : result.toLowerCase().includes(username.toLowerCase()) ||
                    (result.toLowerCase().includes("white") && isMeWhite) ||
                    (result.toLowerCase().includes("black") && !isMeWhite)
                  ? "Victory 🏆"
                  : "Defeat 💔";

              return (
                <div
                  key={game.id || i}
                  className="p-3 bg-slate-950/60 border border-slate-900 hover:border-amber-500/40 rounded-2xl flex items-center justify-between gap-3 transition"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-extrabold text-white truncate">
                        {white} vs {black}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                        myOutcome.includes("Victory")
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                          : myOutcome.includes("Draw")
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                          : "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                      }`}>
                        {myOutcome}
                      </span>
                    </div>

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
