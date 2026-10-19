import React, { useState, useMemo } from "react";
import {
  History, Cpu, Swords, Trophy, Search, ChevronLeft, ChevronRight,
  RefreshCw, BarChart2, Calendar, Play, Sparkles, X, Filter, User
} from "lucide-react";
import { ModalShell } from "../ui/ModalShell";
import { MatchResultPair } from "../MatchResultPair";
import { uniqueCompletedMatches } from "../../lib/completedMatches";

interface PastGamesModalProps {
  open: boolean;
  onClose: () => void;
  username: string;
  myGamesList: any[];
  savedGamesList?: any[];
  onAnalyzeGame?: (game: any) => void;
  onLoadSavedGame?: (game: any) => void;
  initialFilter?: "All" | "AI" | "PvP" | "Tournament";
  fetchMyGames?: () => void;
  isLoading?: boolean;
}

export function PastGamesModal({
  open,
  onClose,
  username,
  myGamesList = [],
  savedGamesList = [],
  onAnalyzeGame,
  onLoadSavedGame,
  initialFilter = "All",
  fetchMyGames,
  isLoading = false,
}: PastGamesModalProps) {
  const [activeCategory, setActiveCategory] = useState<"All" | "AI" | "PvP" | "Tournament">(initialFilter);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const BATCH_SIZE = 50;

  // Reset page when filter or search changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [activeCategory, searchQuery]);

  React.useEffect(() => {
    if (open) {
      setActiveCategory(initialFilter);
      if (fetchMyGames) fetchMyGames();
    }
  }, [open, initialFilter]);

  // Helper to identify game mode type
  const isAIGame = (game: any) => {
    const mode = String(game.playMode || "").toLowerCase();
    const white = String(game.whitePlayer || "").toLowerCase();
    const black = String(game.blackPlayer || "").toLowerCase();
    return (
      mode.includes("human_vs_ai") ||
      mode.includes("ai_vs_human") ||
      mode.includes("ai_vs_ai") ||
      mode.includes("training") ||
      white.includes("ken") ||
      black.includes("ken") ||
      white.includes("computer") ||
      black.includes("computer") ||
      white.includes("ai") ||
      black.includes("ai")
    );
  };

  const isTournamentGame = (game: any) => {
    const mode = String(game.playMode || "").toLowerCase();
    return mode.includes("tournament");
  };

  const isPvPGame = (game: any) => {
    return !isAIGame(game) && !isTournamentGame(game);
  };

  const allCombinedGames = useMemo(() => {
    const map = new Map<string, any>();
    for (const g of myGamesList) {
      const key = g.gameId || g.id;
      if (key) map.set(key, g);
    }
    for (const g of savedGamesList) {
      const key = g.gameId || g.id;
      if (key && !map.has(key)) map.set(key, g);
    }
    return uniqueCompletedMatches(Array.from(map.values()));
  }, [myGamesList, savedGamesList]);

  // Counts for each category tab
  const categoryCounts = useMemo(() => {
    return {
      all: allCombinedGames.length,
      ai: allCombinedGames.filter(isAIGame).length,
      pvp: allCombinedGames.filter(isPvPGame).length,
      tournament: allCombinedGames.filter(isTournamentGame).length,
    };
  }, [allCombinedGames]);

  // Filter games based on selected category and search query
  const filteredGames = useMemo(() => {
    return allCombinedGames.filter((game) => {
      // Category filter
      if (activeCategory === "AI" && !isAIGame(game)) return false;
      if (activeCategory === "PvP" && !isPvPGame(game)) return false;
      if (activeCategory === "Tournament" && !isTournamentGame(game)) return false;

      // Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const white = String(game.whitePlayer || "").toLowerCase();
        const black = String(game.blackPlayer || "").toLowerCase();
        const id = String(game.gameId || game.id || "").toLowerCase();
        return white.includes(query) || black.includes(query) || id.includes(query);
      }

      return true;
    });
  }, [allCombinedGames, activeCategory, searchQuery]);

  const totalGamesCount = filteredGames.length;
  const totalPages = Math.max(1, Math.ceil(totalGamesCount / BATCH_SIZE));

  const currentBatchGames = useMemo(() => {
    const startIdx = (currentPage - 1) * BATCH_SIZE;
    return filteredGames.slice(startIdx, startIdx + BATCH_SIZE);
  }, [filteredGames, currentPage]);

  const handleSelectGame = (game: any) => {
    if (onAnalyzeGame) onAnalyzeGame(game);
    else if (onLoadSavedGame) onLoadSavedGame(game);
    onClose();
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      size="xl"
      title={
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <History className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-extrabold text-white">Match Archive & History</div>
            <div className="text-[11px] font-normal text-slate-400">Review, replay, and analyze past games</div>
          </div>
        </div>
      }
      footer={
        <div className="flex items-center justify-between w-full text-xs text-slate-400">
          <div className="font-sans text-[11px]">
            Showing <strong className="text-amber-400">
              {totalGamesCount > 0 ? (currentPage - 1) * BATCH_SIZE + 1 : 0}–{Math.min(currentPage * BATCH_SIZE, totalGamesCount)}
            </strong> of <strong className="text-slate-200">{totalGamesCount}</strong>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="px-2.5 py-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed font-bold text-slate-300 flex items-center gap-1 cursor-pointer transition text-xs"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Prev
            </button>
            <span className="font-mono text-[11px] text-slate-400 px-1">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="px-2.5 py-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed font-bold text-slate-300 flex items-center gap-1 cursor-pointer transition text-xs"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3.5 text-xs py-1">
        {/* Category Pill Switcher */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-slate-950/90 rounded-2xl border border-slate-850">
          <button
            onClick={() => setActiveCategory("All")}
            className={`py-2 px-2.5 rounded-xl text-xs font-black transition cursor-pointer flex items-center justify-center gap-1.5 ${
              activeCategory === "All"
                ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
            }`}
          >
            <History className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">All ({categoryCounts.all})</span>
          </button>

          <button
            onClick={() => setActiveCategory("AI")}
            className={`py-2 px-2.5 rounded-xl text-xs font-black transition cursor-pointer flex items-center justify-center gap-1.5 ${
              activeCategory === "AI"
                ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
            }`}
          >
            <Cpu className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">vs AI ({categoryCounts.ai})</span>
          </button>

          <button
            onClick={() => setActiveCategory("PvP")}
            className={`py-2 px-2.5 rounded-xl text-xs font-black transition cursor-pointer flex items-center justify-center gap-1.5 ${
              activeCategory === "PvP"
                ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
            }`}
          >
            <Swords className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">PvP ({categoryCounts.pvp})</span>
          </button>

          <button
            onClick={() => setActiveCategory("Tournament")}
            className={`py-2 px-2.5 rounded-xl text-xs font-black transition cursor-pointer flex items-center justify-center gap-1.5 ${
              activeCategory === "Tournament"
                ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
            }`}
          >
            <Trophy className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Tourney ({categoryCounts.tournament})</span>
          </button>
        </div>

        {/* Search & Refresh Toolbar */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Filter by opponent name or match ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950/90 border border-slate-800 rounded-xl pl-9 pr-8 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {fetchMyGames && (
            <button
              onClick={fetchMyGames}
              disabled={isLoading}
              className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
              title="Refresh game list"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          )}
        </div>

        {/* Games Cards List */}
        {isLoading ? (
          <div className="py-16 text-center text-slate-500 text-xs italic flex flex-col items-center justify-center gap-2">
            <RefreshCw className="w-6 h-6 animate-spin text-amber-400" />
            <span>Loading match archive...</span>
          </div>
        ) : currentBatchGames.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-xs italic flex flex-col items-center justify-center gap-2.5 bg-slate-950/40 rounded-2xl border border-slate-900 p-6">
            <History className="w-8 h-8 text-slate-700" />
            <div className="font-bold text-slate-400">No games found</div>
            <p className="text-[11px] text-slate-600 max-w-xs">
              {searchQuery ? "Try searching for a different name or clear the filter." : "Play a match vs Ken AI or in PvP Arena to save games here automatically!"}
            </p>
          </div>
        ) : (
          <div className="max-h-[50dvh] sm:max-h-[380px] overflow-y-auto space-y-2 pr-1 scrollbar-thin">
            {currentBatchGames.map((game, idx) => {
              const gameNum = (currentPage - 1) * BATCH_SIZE + idx + 1;
              const formattedDate = game.timestamp
                ? new Date(game.timestamp).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "Saved";

              const moveCount = Array.isArray(game.moveHistory) ? game.moveHistory.length : 0;
              const hasDeepEval = game.moveEvaluations && Object.keys(game.moveEvaluations).length > 0;
              const gameTypeLabel = isAIGame(game) ? "VS AI" : isTournamentGame(game) ? "Tourney" : "PvP Arena";

              return (
                <div
                  key={game.gameId || game.id || idx}
                  onClick={() => handleSelectGame(game)}
                  className="bg-slate-950/90 hover:bg-slate-900/90 border border-slate-850 hover:border-amber-500/40 rounded-2xl p-3 transition flex flex-col gap-2.5 cursor-pointer shadow-sm group active:scale-[0.99]"
                >
                  {/* One match card: show BOTH players and their outcomes. */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono text-slate-500 font-bold shrink-0">#{gameNum}</span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-400 rounded-md">{gameTypeLabel}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSelectGame(game); }}
                      className="px-2.5 py-1.5 bg-amber-500/15 hover:bg-amber-500 border border-amber-500/30 hover:border-amber-500 text-amber-300 hover:text-slate-950 text-[11px] font-black rounded-xl transition flex items-center gap-1 cursor-pointer"
                    ><Play className="w-3 h-3"/> Analyze</button>
                  </div>
                  <MatchResultPair game={game} />

                  {/* Bottom Row: Date, Move count & Analysis Badge (Cleanly separated!) */}
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-sans pt-1 border-t border-slate-900/80">
                    <div className="flex items-center gap-2 text-slate-400">
                      <span className="flex items-center gap-1 text-slate-400">
                        <Calendar className="w-3 h-3 text-slate-500" />
                        {formattedDate}
                      </span>
                      <span>•</span>
                      <span className="font-mono text-slate-300">{moveCount} moves</span>
                    </div>

                    {hasDeepEval ? (
                      <span className="text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md font-bold flex items-center gap-1 text-[9px]">
                        <Sparkles className="w-3 h-3 text-emerald-400" />
                        Depth 30 Analyzed
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[9px]">Tap to review</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
