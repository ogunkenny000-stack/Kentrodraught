import { useEffect, useMemo, useState } from "react";
import { PuzzleIcon, RefreshCw, Check, Clock, Swords, ArrowLeft } from "lucide-react";
import { Puzzle } from "../../types";
import { getSolvedPuzzleIds, msUntilPuzzleReset } from "../../lib/puzzles";

export interface PuzzlesPaneProps {
  onStartPuzzle: (puzzle: Puzzle & { source?: string }) => void;
  /** bump to re-read solved-state after a puzzle is completed */
  solvedVersion: number;
  onBackToHome?: () => void;
}

const DIFF_STYLE: Record<string, string> = {
  Easy: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  Medium: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  Hard: "bg-rose-500/15 text-rose-400 border-rose-500/25",
};

/**
 * The weekly puzzle arena: admin-built traps plus tactics mined from real
 * community games. Progress restarts every 7 days (ISO week).
 */
export function PuzzlesPane({ onStartPuzzle, solvedVersion, onBackToHome }: PuzzlesPaneProps) {
  const [puzzles, setPuzzles] = useState<(Puzzle & { source?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const solved = useMemo(() => getSolvedPuzzleIds(), [solvedVersion]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/puzzles");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load");
      setPuzzles(Array.isArray(data.puzzles) ? data.puzzles : []);
    } catch (e: any) {
      setError(e?.message || "Could not load puzzles.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const daysLeft = Math.max(1, Math.ceil(msUntilPuzzleReset() / 86400000));
  const solvedCount = puzzles.filter((p) => solved.has(p.id)).length;

  return (
    <div className="k-puzzles-page w-full min-h-full bg-[#070913]">
      <div className="max-w-3xl mx-auto p-4 md:p-6 flex flex-col gap-5 pb-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            {onBackToHome && (
              <button
                onClick={onBackToHome}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold text-amber-400 hover:bg-slate-800 transition cursor-pointer shrink-0"
                title="Return to Home Dashboard"
              >
                <ArrowLeft className="w-4 h-4 text-amber-400" />
                <span>Home</span>
              </button>
            )}
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center shadow-lg shadow-amber-500/20 shrink-0">
              <PuzzleIcon className="w-6 h-6 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-white font-sans uppercase tracking-tight leading-none">Weekly Puzzles</h1>
              <p className="text-[10px] text-amber-500/70 font-sans tracking-[0.12em] uppercase mt-0.5">
                Traps &amp; tactics from real games
              </p>
            </div>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-xl hover:bg-amber-500/20 transition cursor-pointer disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Weekly progress strip */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold text-slate-200">
              Solved this week: <span className="text-amber-400">{solvedCount}</span> / {puzzles.length}
            </span>
            <div className="w-44 h-1.5 rounded-full bg-slate-950 overflow-hidden">
              <div
                className="h-full bg-amber-500 transition-all"
                style={{ width: puzzles.length ? `${(solvedCount / puzzles.length) * 100}%` : "0%" }}
              />
            </div>
          </div>
          <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 font-mono bg-slate-950/70 border border-slate-900 px-2.5 py-1.5 rounded-lg">
            <Clock className="w-3.5 h-3.5 text-amber-500" />
            Resets in {daysLeft} day{daysLeft === 1 ? "" : "s"}
          </span>
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center text-xs text-slate-500 italic py-12">Loading this week's puzzles...</div>
        ) : error ? (
          <div className="text-center text-xs text-rose-400 py-12">{error}</div>
        ) : puzzles.length === 0 ? (
          <div className="text-center text-xs text-slate-500 italic py-12">
            No puzzles published yet. An admin can mine tactics from recent games in the Admin Panel.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {puzzles.map((p) => {
              const isSolved = solved.has(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => onStartPuzzle(p)}
                  className={`relative text-left rounded-2xl border p-4 transition cursor-pointer flex flex-col gap-2 ${
                    isSolved
                      ? "bg-emerald-500/5 border-emerald-500/25 hover:border-emerald-500/40"
                      : "bg-slate-900/60 border-slate-800/80 hover:border-amber-500/40 hover:bg-slate-900"
                  }`}
                >
                  {isSolved && (
                    <span className="absolute top-3 right-3 w-6 h-6 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                      <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                    </span>
                  )}
                  <div className="flex items-center gap-2 pr-8">
                    <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${DIFF_STYLE[p.difficulty] || DIFF_STYLE.Medium}`}>
                      {p.difficulty}
                    </span>
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider truncate">{p.theme}</span>
                  </div>
                  <span className="text-sm font-extrabold text-slate-100 leading-snug">{p.title}</span>
                  {p.description && <span className="text-[11px] text-slate-400 leading-snug">{p.description}</span>}
                  <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 mt-auto pt-1">
                    <Swords className="w-3 h-3" /> {isSolved ? "Solve again" : "Solve it"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
