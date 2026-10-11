import React, { useState, useEffect } from "react";
import { Search, Loader2, Play, Compass, Eye, Share2, Copy, Check, Clock, AlertCircle } from "lucide-react";
import { ModalShell } from "../ui/ModalShell";
import { KentroGameRecord } from "../../types/gameRecords";
import { GameResultDetailModal } from "./GameResultDetailModal";

interface GameSearchModalProps {
  open: boolean;
  onClose: () => void;
  onAnalyzeGame: (game: any) => void;
  onViewReplay: (game: any) => void;
}

export function GameSearchModal({
  open,
  onClose,
  onAnalyzeGame,
  onViewReplay,
}: GameSearchModalProps) {
  const [searchCode, setSearchCode] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [foundGame, setFoundGame] = useState<KentroGameRecord | null>(null);

  const [recentGames, setRecentGames] = useState<KentroGameRecord[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const [selectedResultGame, setSelectedResultGame] = useState<KentroGameRecord | null>(null);

  // Fetch recent games on open
  useEffect(() => {
    if (!open) return;
    setLoadingRecent(true);
    fetch("/api/games/recent?limit=25")
      .then((res) => res.json())
      .then((data) => {
        if (data && data.ok && Array.isArray(data.games)) {
          setRecentGames(data.games);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch recent games:", err);
      })
      .finally(() => {
        setLoadingRecent(false);
      });
  }, [open]);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const code = searchCode.trim();
    if (!code) return;

    setIsSearching(true);
    setSearchError(null);
    setFoundGame(null);

    try {
      const res = await fetch(`/api/games/code/${encodeURIComponent(code)}`);
      const data = await res.json();

      if (res.ok && data.ok && data.game) {
        setFoundGame(data.game);
      } else {
        setSearchError(data.error || `Game #${code} not found. Please verify the 7-digit Game Code.`);
      }
    } catch (err: any) {
      setSearchError("Failed to search game. Please check your connection.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleCopyCode = (code: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  const handleShareCode = (game: KentroGameRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator.share) {
      navigator.share({
        title: `KentroDraught Game #${game.gameCode}`,
        text: `Watch KentroDraught Game #${game.gameCode}: ${game.player1} vs ${game.player2} (${game.finalResult})`,
        url: window.location.href,
      }).catch(() => handleCopyCode(game.gameCode, e));
    } else {
      handleCopyCode(game.gameCode, e);
    }
  };

  return (
    <>
      <ModalShell open={open} onClose={onClose} size="lg">
        <div className="flex flex-col gap-5 text-slate-100 p-1">
          {/* Section: Search Game */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-black uppercase tracking-wider text-amber-400 font-mono">
              SEARCH GAME
            </span>
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={searchCode}
                  onChange={(e) => setSearchCode(e.target.value)}
                  placeholder="Enter Game Code (e.g. 2690001)"
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 font-mono tracking-wide focus:outline-none focus:border-amber-500"
                />
              </div>
              <button
                type="submit"
                disabled={isSearching || !searchCode.trim()}
                className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider transition cursor-pointer flex items-center gap-1.5 shadow-md shadow-amber-500/20"
              >
                {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>SEARCH</span>
              </button>
            </form>

            {searchError && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{searchError}</span>
              </div>
            )}

            {/* Found Game Card */}
            {foundGame && (
              <div className="mt-2 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-mono">
                    <span className="font-black text-amber-400 text-sm">#{foundGame.gameCode}</span>
                    {foundGame.previousGameCode && (
                      <span className="text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
                        Rematch of #{foundGame.previousGameCode}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => handleCopyCode(foundGame.gameCode, e)}
                      className="text-xs text-slate-400 hover:text-amber-300 flex items-center gap-1"
                    >
                      {copiedCode === foundGame.gameCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedCode === foundGame.gameCode ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-slate-100">
                    {foundGame.player1} vs {foundGame.player2}
                  </span>
                  <span className="font-mono font-black text-base text-amber-400">
                    {foundGame.finalResult}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 border-t border-amber-500/20 pt-2">
                  <span>Reason: <strong className="text-slate-200">{foundGame.resultReason}</strong></span>
                  <span>{foundGame.completeMoveHistory?.length || 0} moves</span>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <button
                    onClick={() => {
                      onClose();
                      onViewReplay(foundGame);
                    }}
                    className="py-2 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition"
                  >
                    <Play className="w-3.5 h-3.5" /> Replay
                  </button>
                  <button
                    onClick={() => {
                      onClose();
                      onAnalyzeGame(foundGame);
                    }}
                    className="py-2 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 transition border border-slate-700"
                  >
                    <Compass className="w-3.5 h-3.5 text-amber-400" /> Analyze
                  </button>
                  <button
                    onClick={() => setSelectedResultGame(foundGame)}
                    className="py-2 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 transition border border-slate-700"
                  >
                    <Eye className="w-3.5 h-3.5 text-sky-400" /> Result
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-800/80 my-1" />

          {/* Section: Recent Games */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 font-mono">
                RECENT GAMES
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                {recentGames.length} Games
              </span>
            </div>

            {loadingRecent ? (
              <div className="py-8 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
                <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
                <span>Loading recent games...</span>
              </div>
            ) : recentGames.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                No games recorded yet. Play a match to record games!
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[340px] overflow-y-auto pr-1">
                {recentGames.map((game) => (
                  <div
                    key={game.gameCode}
                    onClick={() => setSelectedResultGame(game)}
                    className="bg-slate-900/80 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 rounded-xl p-3 flex flex-col gap-2 transition cursor-pointer group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-black text-amber-400 text-xs">
                        {game.gameCode}
                      </span>
                      <span className="font-mono font-black text-sm text-slate-200">
                        {game.finalResult}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-200 truncate">
                        {game.player1 || game.whitePlayer} vs {game.player2 || game.blackPlayer}
                      </span>
                      <span className="text-[11px] text-slate-400 truncate max-w-[140px]">
                        {game.resultReason}
                      </span>
                    </div>

                    {/* Quick action buttons row */}
                    <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 text-[11px] text-slate-400">
                      <span className="text-[10px] text-slate-500">
                        {game.durationSeconds ? `${Math.floor(game.durationSeconds / 60)}m ${game.durationSeconds % 60}s` : ""}
                      </span>

                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            onClose();
                            onViewReplay(game);
                          }}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition flex items-center gap-1"
                        >
                          <Play className="w-2.5 h-2.5 text-sky-400" /> Replay
                        </button>
                        <button
                          onClick={() => {
                            onClose();
                            onAnalyzeGame(game);
                          }}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition flex items-center gap-1"
                        >
                          <Compass className="w-2.5 h-2.5 text-amber-400" /> Analyze
                        </button>
                        <button
                          onClick={() => setSelectedResultGame(game)}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition flex items-center gap-1"
                        >
                          <Eye className="w-2.5 h-2.5 text-slate-400" /> Result
                        </button>
                        <button
                          onClick={(e) => handleShareCode(game, e)}
                          title="Share Game Code"
                          className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-amber-400 transition"
                        >
                          {copiedCode === game.gameCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Share2 className="w-3 h-3" />}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </ModalShell>

      {/* Game Result Modal Popup */}
      <GameResultDetailModal
        open={!!selectedResultGame}
        onClose={() => setSelectedResultGame(null)}
        game={selectedResultGame}
        onAnalyze={onAnalyzeGame}
        onViewReplay={onViewReplay}
      />
    </>
  );
}
