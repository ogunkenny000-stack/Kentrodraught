import React, { useEffect, useState } from "react";
import { Crown, Calendar, Loader2 } from "lucide-react";
import { apiGet, apiPost } from "../../apiClient";
import { Avatar } from "../ui/Avatar";
import { ModalShell } from "../ui/ModalShell";
import { KentroCoin } from "../ui/KentroCoin";

interface AdminUserProfileModalProps {
  username: string;
  /** Admin permissions held by the SIGNED-IN account (not the account being
   * viewed) -- gates which action buttons show, exactly like the Admin
   * Panel's own Users tab. */
  permissions: string[];
  onClose: () => void;
}

interface UserDetail {
  profile: any;
  coinBalance: number;
  recentGames: any[];
  moderationHistory: any[];
}

const fmtDate = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

const fmtDuration = (secs?: number | null) => {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/**
 * The same "full profile" the Admin Panel's Users tab already shows --
 * stats, coin balance, recent games, moderation history, ban/suspend
 * controls -- just launchable as a modal from anywhere a username appears
 * in the app (chat, lobby, tournaments, friends, a live game -- see
 * <AdminTappableName> in lib/adminProfileContext.tsx) instead of only from
 * inside the Admin Panel's own search. Pulls everything from the single
 * /api/admin/user-detail call the Users tab already relies on, so both
 * views can never disagree with each other.
 */
export function AdminUserProfileModal({ username, permissions, onClose }: AdminUserProfileModalProps) {
  const [data, setData] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const has = (perm: string) => permissions.includes(perm);

  const load = () => {
    setError(null);
    apiGet("/api/admin/user-detail", { username })
      .then((d) =>
        setData({
          profile: d.profile,
          coinBalance: d.coinBalance ?? 0,
          recentGames: d.recentGames ?? [],
          moderationHistory: d.moderationHistory ?? [],
        })
      )
      .catch((e: any) => setError(e.message || "Couldn't load that profile."));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [username]);

  const doAction = async (action: string, newValue?: number) => {
    setBusy(true);
    try {
      await apiPost("/api/admin/user-action", { action, targetUsername: username, newValue });
      load(); // refresh in place -- ban badges, suspend attribution, etc.
    } catch (e: any) {
      alert(e.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const profile = data?.profile;

  return (
    <ModalShell
      open
      onClose={onClose}
      size="md"
      icon={<Crown className="w-4 h-4 text-amber-400" />}
      title={profile?.username || username}
    >
      {error ? (
        <p className="text-rose-400 text-xs font-sans text-center py-8">{error}</p>
      ) : !data || !profile ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10">
          <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
          <span className="text-xs text-slate-500 font-sans">Loading profile...</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5 text-xs text-slate-300 pb-1">
          {/* Identity header */}
          <div className="flex items-center gap-3">
            <Avatar name={profile.username} url={profile.avatarUrl} size={52} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-extrabold text-slate-100 text-base truncate">{profile.username}</span>
                {profile.banned && (
                  <span className="text-[9px] bg-rose-500/20 text-rose-400 px-2 py-0.5 rounded-full font-bold">BANNED</span>
                )}
                {profile.suspendedUntil && profile.suspendedUntil > Date.now() && (
                  <span className="text-[9px] bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full font-bold">SUSPENDED</span>
                )}
              </div>
              <div className="flex items-center gap-1 text-[10px] text-slate-500 mt-0.5">
                <Calendar className="w-3 h-3" /> Member since {fmtDate(profile.createdAt)}
              </div>
            </div>
          </div>

          {/* Core stats */}
          <div className="grid grid-cols-2 gap-2 bg-slate-950 border border-slate-800 rounded-xl p-3">
            <span>Elo: <b className="text-slate-100">{Math.round(profile.elo ?? 1500)}</b></span>
            <span>W/L/D: <b className="text-slate-100">{profile.wins ?? 0}/{profile.losses ?? 0}/{profile.draws ?? 0}</b></span>
            <span>Games: <b className="text-slate-100">{profile.gamesCount ?? 0}</b></span>
            <span>Max Ken: <b className="text-slate-100">{profile.maxUnlockedKenLevel || 1}</b></span>
            <span>Total play: <b className="text-slate-100">{fmtDuration(profile.totalPlayTime)}</b></span>
            <span>Avg game: <b className="text-slate-100">{fmtDuration(profile.averageDuration)}</b></span>
            <span className="flex items-center gap-1.5 col-span-2 pt-1.5 mt-0.5 border-t border-slate-900">
              <KentroCoin size="2xs" glow /> Balance: <b className="text-amber-300 font-mono">{data.coinBalance.toLocaleString()}</b>
            </span>
          </div>

          {/* Ban/suspension attribution, only if it applies */}
          {(profile.banned || (profile.suspendedUntil && profile.suspendedUntil > Date.now())) && (
            <div className="text-[10px] text-rose-300/90 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2.5 py-1.5 flex flex-col gap-0.5">
              {profile.banned && <span>Banned by <b>{profile.bannedBy || "unknown"}</b> on {fmtDate(profile.bannedAt)}</span>}
              {profile.suspendedUntil && profile.suspendedUntil > Date.now() && (
                <span>Suspended by <b>{profile.suspendedBy || "unknown"}</b> until {fmtDate(profile.suspendedUntil)}</span>
              )}
            </div>
          )}

          {/* Moderation actions -- same permission gates as the Admin Panel's Users tab */}
          {(has("edit_users") || has("suspend_users") || has("ban_users")) && (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-900">
              {has("edit_users") && (
                <button disabled={busy} onClick={() => doAction("reset_rating")} className="text-[10px] bg-slate-800 hover:bg-slate-700 disabled:opacity-40 px-2.5 py-1 rounded-lg font-bold">
                  Reset Rating
                </button>
              )}
              {has("suspend_users") && !profile.suspendedUntil && (
                <button disabled={busy} onClick={() => doAction("suspend", Date.now() + 24 * 60 * 60 * 1000)} className="text-[10px] bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 disabled:opacity-40 px-2.5 py-1 rounded-lg font-bold">
                  Suspend 24h
                </button>
              )}
              {has("suspend_users") && profile.suspendedUntil && (
                <button disabled={busy} onClick={() => doAction("unsuspend")} className="text-[10px] bg-slate-800 hover:bg-slate-700 disabled:opacity-40 px-2.5 py-1 rounded-lg font-bold">
                  Unsuspend
                </button>
              )}
              {has("ban_users") && !profile.banned && (
                <button disabled={busy} onClick={() => doAction("ban")} className="text-[10px] bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 disabled:opacity-40 px-2.5 py-1 rounded-lg font-bold">
                  Ban
                </button>
              )}
              {has("ban_users") && profile.banned && (
                <button disabled={busy} onClick={() => doAction("unban")} className="text-[10px] bg-slate-800 hover:bg-slate-700 disabled:opacity-40 px-2.5 py-1 rounded-lg font-bold">
                  Unban
                </button>
              )}
            </div>
          )}

          {/* Recent games */}
          <div className="border-t border-slate-900 pt-2">
            <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Recent Games</span>
            {data.recentGames.length === 0 ? (
              <p className="text-slate-600 text-[10px] py-2">No games recorded yet.</p>
            ) : (
              <div className="flex flex-col gap-1 mt-1.5">
                {data.recentGames.map((g: any) => {
                  const isWhite = g.whitePlayer === profile.username;
                  const opponent = isWhite ? g.blackPlayer : g.whitePlayer;
                  const outcome = g.winner === null ? "Draw" : g.winner === (isWhite ? "W" : "B") ? "Won" : "Lost";
                  const color = outcome === "Won" ? "text-emerald-400" : outcome === "Lost" ? "text-rose-400" : "text-slate-400";
                  return (
                    <div key={g.gameId} className="flex items-center justify-between text-[10px] px-2 py-1 bg-slate-950 rounded-lg">
                      <span className="text-slate-400 truncate">vs <b className="text-slate-200">{opponent || "—"}</b></span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className={`font-bold ${color}`}>{outcome}</span>
                        <span className="text-slate-600 font-mono">{fmtDate(g.timestamp)}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Moderation history */}
          {data.moderationHistory.length > 0 && (
            <div className="border-t border-slate-900 pt-2">
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Moderation History</span>
              <div className="flex flex-col gap-1 mt-1.5">
                {data.moderationHistory.map((h: any, i: number) => (
                  <div key={i} className="text-[10px] text-slate-500 px-2 py-1">
                    <b className="text-slate-300">{String(h.action || "").replace("user_", "")}</b> by {h.adminUsername || "unknown"} · {fmtDate(h.timestamp)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}
