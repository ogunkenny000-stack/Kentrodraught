import { useEffect, useState } from "react";
import { Trash2, RefreshCw, Search, AlertTriangle } from "lucide-react";
import { apiGet, apiPost } from "../../apiClient";

interface AdminGameRow {
  gameId: string;
  whitePlayer: string;
  blackPlayer: string;
  winner: string | null;
  timestamp: number;
  playMode: string;
  moveCount: number;
}

/**
 * Admin "Games" tab: browse the completed_games database (every player's
 * games, searchable by name), delete a single game, or -- behind a typed
 * confirmation -- wipe the whole table. Viewing needs the view_games
 * permission; deleting needs manage_admins (the owner has both).
 */
export function GamesTab() {
  const [games, setGames] = useState<AdminGameRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [wiping, setWiping] = useState(false);

  const load = async (player?: string) => {
    setLoading(true);
    setStatus(null);
    try {
      const data = await apiGet("/api/admin/games", player ? { player } : {});
      setGames(data.games || []);
    } catch (e: any) {
      setStatus(e?.message || "Failed to load games");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const deleteOne = async (g: AdminGameRow) => {
    if (!confirm(`Delete this game permanently?\n\n${g.whitePlayer} vs ${g.blackPlayer} (${g.moveCount} moves)`)) return;
    try {
      await apiPost("/api/admin/games/delete", { gameId: g.gameId });
      setGames((prev) => prev.filter((x) => x.gameId !== g.gameId));
      setStatus("Game deleted.");
    } catch (e: any) {
      setStatus(e?.message || "Delete failed");
    }
  };

  const wipeAll = async () => {
    if (confirmText !== "DELETE ALL GAMES") return;
    setWiping(true);
    setStatus(null);
    try {
      const r = await apiPost("/api/admin/games/delete-all", { confirm: confirmText });
      setStatus(`Wiped the games database — ${r.deleted} game${r.deleted === 1 ? "" : "s"} deleted.`);
      setConfirmText("");
      setGames([]);
    } catch (e: any) {
      setStatus(e?.message || "Wipe failed");
    } finally {
      setWiping(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Search + refresh */}
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2">
          <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") load(search.trim() || undefined); }}
            placeholder="Filter by player name…"
            className="bg-transparent outline-none text-xs text-slate-200 w-full placeholder:text-slate-600"
          />
        </div>
        <button
          onClick={() => load(search.trim() || undefined)}
          className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-amber-500/50 text-slate-400 hover:text-amber-400 transition cursor-pointer"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {status && (
        <div className="text-[11px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
          {status}
        </div>
      )}

      {/* Games list */}
      <div className="flex flex-col gap-1.5 max-h-[46vh] overflow-y-auto pr-1">
        {loading && games.length === 0 && (
          <div className="text-[11px] text-slate-500 py-6 text-center">Loading games…</div>
        )}
        {!loading && games.length === 0 && (
          <div className="text-[11px] text-slate-500 py-6 text-center">No games found.</div>
        )}
        {games.map((g) => (
          <div key={g.gameId} className="flex items-center gap-2 bg-slate-900/70 border border-slate-800 rounded-xl px-3 py-2">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-extrabold text-slate-200 truncate">
                {g.whitePlayer} <span className="text-slate-500 font-bold">vs</span> {g.blackPlayer}
              </div>
              <div className="text-[9px] text-slate-500 font-bold">
                {new Date(g.timestamp).toLocaleString()} · {g.moveCount} moves · {g.playMode}
                {g.winner ? ` · ${g.winner === "W" ? "White" : g.winner === "B" ? "Black" : g.winner} won` : " · draw/unfinished"}
              </div>
            </div>
            <button
              onClick={() => deleteOne(g)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer shrink-0"
              title="Delete this game"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Danger zone: wipe everything */}
      <div className="border border-rose-500/30 bg-rose-500/5 rounded-2xl p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span className="text-[11px] font-extrabold text-rose-300 uppercase tracking-wide">Danger zone — wipe games database</span>
        </div>
        <p className="text-[10px] text-slate-400 leading-relaxed">
          Permanently deletes <strong className="text-rose-300">every game from every player</strong> — history,
          saved analyses of those games, and the community feed all empty out. This cannot be undone.
          Type <span className="font-mono font-bold text-rose-300">DELETE ALL GAMES</span> to arm the button.
        </p>
        <div className="flex items-center gap-2">
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE ALL GAMES"
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-rose-300 outline-none focus:border-rose-500/60 placeholder:text-slate-700"
          />
          <button
            onClick={wipeAll}
            disabled={confirmText !== "DELETE ALL GAMES" || wiping}
            className="px-3 py-2 rounded-xl text-[11px] font-extrabold transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed bg-rose-600 hover:bg-rose-500 text-white"
          >
            {wiping ? "Wiping…" : "Delete ALL"}
          </button>
        </div>
      </div>
    </div>
  );
}
