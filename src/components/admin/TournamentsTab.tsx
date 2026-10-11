import { useEffect, useState } from "react";
import { Trophy, Plus, Trash2, RefreshCw, Copy, Check } from "lucide-react";
import { apiGet, apiPost } from "../../apiClient";
import { KentroCoin } from "../ui/KentroCoin";

interface AdminTournamentRow {
  id: string;
  name: string;
  type: string;
  visibility: string;
  inviteCode?: string;
  status: string;
  maxPlayers: number;
  timeControl: string;
  prize: string;
  prizePool: number;
  prizePaid: boolean;
  playerCount: number;
  createdAt?: string;
}

const TYPES = ["Swiss System", "Knockout Bracket", "Round Robin", "Arena Blitz"];
const TIME_CONTROLS = ["Blitz 5m", "Rapid 10m", "Classical 20m", "Untimed"];
const HANDICAPS = ["None", "Short One", "Short Two", "Short Three", "Crown Crown"];
const TIE_BREAKS = ["Buchholz Score", "Head-to-Head", "Most Wins", "Sonneborn-Berger"];

const STATUS_BADGE: Record<string, string> = {
  registration: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  completed: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

/**
 * Admin Panel -> Tournaments: create official tournaments (server-side,
 * service-role -- works for any admin holding manage_tournaments, with no
 * dependence on the client RLS path), see every tournament with its
 * player count and prize-pool state, and delete finished/abandoned ones.
 * Ken 5, the house AI, is seeded into every tournament automatically,
 * exactly like player-created tournaments.
 */
export function TournamentsTab() {
  const [list, setList] = useState<AdminTournamentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Create form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState(TYPES[0]);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [timeControl, setTimeControl] = useState(TIME_CONTROLS[0]);
  const [handicap, setHandicap] = useState(HANDICAPS[0]);
  const [tieBreak, setTieBreak] = useState(TIE_BREAKS[0]);
  const [prize, setPrize] = useState("Bragging rights + trophy 🏆");

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiGet("/api/admin/tournaments");
      setList(res.tournaments || []);
    } catch (e: any) {
      setNotice(e?.message || "Failed to load tournaments.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const createTournament = async () => {
    if (!name.trim()) { setNotice("Give the tournament a name."); return; }
    setCreating(true);
    setNotice(null);
    try {
      const res = await apiPost("/api/admin/tournaments", {
        name: name.trim(), description: description.trim(), type, visibility,
        maxPlayers, timeControl, handicap, tieBreak, prize: prize.trim(),
      });
      setNotice(
        visibility === "private" && res.inviteCode
          ? `Tournament created! Private invite code: ${res.inviteCode}`
          : "Tournament created! It's open for registration in the Tournaments arena."
      );
      setShowCreate(false);
      setName(""); setDescription("");
      load();
    } catch (e: any) {
      setNotice(e?.message || "Failed to create tournament.");
    } finally {
      setCreating(false);
    }
  };

  const deleteTournament = async (id: string) => {
    setDeletingId(id);
    setNotice(null);
    try {
      await apiPost("/api/admin/tournaments/delete", { tournamentId: id });
      setNotice("Tournament deleted.");
      setConfirmDeleteId(null);
      load();
    } catch (e: any) {
      setNotice(e?.message || "Failed to delete tournament.");
    } finally {
      setDeletingId(null);
    }
  };

  const copyInvite = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 1400);
    } catch {}
  };

  const inputCls = "w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 select-text";
  const labelCls = "text-[9px] font-black uppercase tracking-wider text-slate-500";

  return (
    <div className="flex flex-col gap-3 text-xs text-slate-300">
      {notice && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] font-semibold rounded-xl px-3 py-2.5">
          {notice}
        </div>
      )}

      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <Trophy className="w-3.5 h-3.5 text-amber-400" /> Official Tournaments ({list.length})
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="text-[9px] text-amber-400 hover:text-amber-300 transition flex items-center gap-1 font-bold cursor-pointer disabled:opacity-45"
          >
            <RefreshCw className={`w-2.5 h-2.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button
            onClick={() => setShowCreate((s) => !s)}
            className={`text-[10px] font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer ${
              showCreate ? "bg-slate-800 text-slate-300" : "bg-amber-500 hover:bg-amber-400 text-slate-950"
            }`}
          >
            <Plus className="w-3 h-3" /> {showCreate ? "Close form" : "Create tournament"}
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <span className={labelCls}>Tournament name *</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kentro Grand Championship" className={inputCls} maxLength={80} />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <span className={labelCls}>Description</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown on the tournament card" className={inputCls} maxLength={200} />
            </div>
            <div className="flex flex-col gap-1">
              <span className={labelCls}>Format</span>
              <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className={labelCls}>Time control</span>
              <select value={timeControl} onChange={(e) => setTimeControl(e.target.value)} className={inputCls}>
                {TIME_CONTROLS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className={labelCls}>Visibility</span>
              <select value={visibility} onChange={(e) => setVisibility(e.target.value as any)} className={inputCls}>
                <option value="public">Public — anyone can register</option>
                <option value="private">Private — invite code only</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className={labelCls}>Max players (2–64)</span>
              <input type="number" min={2} max={64} value={maxPlayers}
                onChange={(e) => setMaxPlayers(Math.max(2, Math.min(64, parseInt(e.target.value, 10) || 8)))}
                className={inputCls} />
            </div>
            <div className="flex flex-col gap-1">
              <span className={labelCls}>Handicap rule</span>
              <select value={handicap} onChange={(e) => setHandicap(e.target.value)} className={inputCls}>
                {HANDICAPS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className={labelCls}>Tie-break</span>
              <select value={tieBreak} onChange={(e) => setTieBreak(e.target.value)} className={inputCls}>
                {TIE_BREAKS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <span className={labelCls}>Prize</span>
              <input value={prize} onChange={(e) => setPrize(e.target.value)} className={inputCls} maxLength={160} />
            </div>
          </div>
          <p className="text-[10px] text-slate-500 leading-normal">
            Ken 5 (the house AI, rated 2380) is seeded into the tournament automatically. Entry fees, prize pools and payouts are handled from Coins &amp; Pricing.
          </p>
          <button
            onClick={createTournament}
            disabled={creating || !name.trim()}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold py-2.5 rounded-xl transition text-xs flex items-center justify-center gap-2 cursor-pointer"
          >
            <Trophy className="w-3.5 h-3.5" />
            {creating ? "Creating…" : "Create tournament"}
          </button>
        </div>
      )}

      {/* List */}
      {loading && list.length === 0 ? (
        <div className="text-center py-6 text-slate-500 italic">Loading tournaments…</div>
      ) : list.length === 0 ? (
        <div className="text-center py-6 text-slate-500 italic">No tournaments yet — create the first one above.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((t) => (
            <div key={t.id} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-100 truncate">{t.name}</span>
                    <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded border ${STATUS_BADGE[t.status] || STATUS_BADGE.completed}`}>
                      {t.status}
                    </span>
                    {t.visibility === "private" && t.inviteCode && (
                      <button
                        onClick={() => copyInvite(t.inviteCode!)}
                        className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 flex items-center gap-1 cursor-pointer"
                        title="Copy invite code"
                      >
                        {copiedCode === t.inviteCode ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                        {t.inviteCode}
                      </button>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span>{t.type} · {t.timeControl} · {t.playerCount}/{t.maxPlayers} players</span>
                    {t.prizePool > 0 && (
                      <span className="inline-flex items-center gap-1 text-amber-400 font-bold">
                        · <KentroCoin size="2xs" /> {t.prizePool.toLocaleString()} pool{t.prizePaid ? " (paid)" : " (unpaid)"}
                      </span>
                    )}
                  </div>
                </div>
                <div className="shrink-0">
                  {confirmDeleteId === t.id ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => deleteTournament(t.id)}
                        disabled={deletingId === t.id}
                        className="text-[9px] font-bold px-2 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition cursor-pointer disabled:opacity-50"
                      >
                        {deletingId === t.id ? "Deleting…" : "Confirm delete"}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-[9px] font-bold px-2 py-1.5 rounded-lg bg-slate-800 text-slate-300 transition cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(t.id)}
                      className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-500 hover:text-rose-400 hover:border-rose-500/40 transition cursor-pointer"
                      title="Delete tournament"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="text-[10px] text-slate-500 truncate">Prize: {t.prize}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
