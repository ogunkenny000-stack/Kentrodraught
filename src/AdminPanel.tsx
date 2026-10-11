import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { supabase } from "./supabase";
import { apiGet, apiPost } from "./apiClient";
import { X, Crown, Shield, Users, Coins, Receipt, ScrollText, LayoutDashboard, Database, ArrowLeft, Menu, Megaphone, Trophy, Puzzle, Brain } from "lucide-react";
import { KentroCoin } from "./components/ui/KentroCoin";
import { TournamentsTab } from "./components/admin/TournamentsTab";
import { GamesTab } from "./components/admin/GamesTab";
import { ModerationTab } from "./components/admin/ModerationTab";
import { PuzzleCreatorTab } from "./components/admin/PuzzleCreatorTab";
import { Ken8TrainingLabTab } from "./components/admin/Ken8TrainingLabTab";

interface AdminPanelProps {
  onClose: () => void;
}

const PERMISSION_LABELS: Record<string, string> = {
  manage_admins: "Manage Admins",
  view_users: "View Users",
  edit_users: "Edit Users",
  suspend_users: "Suspend Users",
  ban_users: "Ban Users",
  view_games: "View Games",
  manage_tournaments: "Manage Tournaments",
  manage_reports: "Manage Reports",
  manage_payments: "Manage Payments",
  manage_coin_settings: "Manage Pricing",
  credit_coins: "Credit/Adjust Coins",
  view_analytics: "View Analytics",
  manage_announcements: "Manage Announcements",
  view_audit_log: "View Audit Log",
  manage_puzzles: "Manage Puzzles",
};

type Tab = "dashboard" | "users" | "purchases" | "admins" | "coins" | "audit" | "games" | "moderation" | "tournaments" | "puzzle_creator" | "ken8_lab";

export default function AdminPanel({ onClose }: AdminPanelProps) {
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [myPermissions, setMyPermissions] = useState<string[]>([]);
  const [myUsername, setMyUsername] = useState("");
  // null = show the full-page menu of admin controls; a Tab = show that page.
  // Opening the panel lands on the menu so every section gets the full width.
  const [tab, setTab] = useState<Tab | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiPost("/api/admin/whoami", {});
        setIsAdmin(!!res.isAdmin);
        setMyPermissions(res.permissions || []);
        setMyUsername(res.username || "");
      } catch {
        setIsAdmin(false);
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  const has = (perm: string) => myPermissions.includes(perm);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[100] bg-slate-950 flex flex-col overflow-hidden"
    >
        <div
          className="flex items-center justify-between px-4 py-3.5 border-b border-slate-800 shrink-0 bg-gradient-to-r from-slate-900 to-slate-900/60"
          style={{ paddingTop: "max(0.875rem, env(safe-area-inset-top))" }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => { if (tab !== null) { setTab(null); } else { onClose(); } }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 -ml-1 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0"
              title={tab !== null ? "Back to menu" : "Back to app"}
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-[11px] font-bold hidden sm:inline">{tab !== null ? "Menu" : "Exit"}</span>
            </button>
            {/* Hamburger: opens the slide-in list of admin controls from anywhere. */}
            <button
              onClick={() => setMenuOpen(true)}
              className="flex items-center justify-center w-9 h-9 rounded-xl text-slate-200 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0"
              title="Admin controls"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center shadow-md shadow-amber-500/20 shrink-0">
              <Crown className="w-4 h-4 text-slate-950 stroke-[2.5]" />
            </div>
            <span className="text-sm font-extrabold text-slate-100 uppercase tracking-widest font-sans truncate">
              {tab !== null ? TAB_LABELS[tab] : "Admin Controls"}
            </span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 cursor-pointer transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {checking ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <Crown className="w-8 h-8 text-amber-500 animate-pulse" />
            <span className="text-xs text-slate-500 font-sans">Checking access...</span>
          </div>
        ) : !isAdmin ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500 text-sm px-8 text-center font-sans">
            <Shield className="w-8 h-8 text-slate-700" />
            This browser's session isn't registered as an admin. If you're Kenny, use the bootstrap step in the deployment notes to register your first admin account.
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden relative">
            {tab === null ? (
              // ---- FULL-PAGE MENU of admin controls (opening screen) ----
              <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                <p className="text-[11px] text-slate-500 font-sans mb-4">Choose a section. Tap ☰ any time to switch.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-2xl">
                  {ADMIN_SECTIONS.filter(t => has(t.perm)).map(t => (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className="flex items-center gap-3 px-4 py-4 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-amber-500/40 hover:bg-slate-900 transition cursor-pointer text-left"
                    >
                      <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                        <t.icon className="w-5 h-5 text-amber-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold text-slate-100">{t.label}</div>
                        <div className="text-[10px] text-slate-500 truncate">{t.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
                {myPermissions.length === 0 && (
                  <p className="text-[10px] text-slate-600 p-2 mt-4 font-sans">You're an admin, but have no permissions assigned yet.</p>
                )}
              </div>
            ) : (
              // ---- FULL-WIDTH content for the chosen section ----
              <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                {tab === "dashboard" && has("view_analytics") && <DashboardTab />}
                {tab === "users" && has("view_users") && <UsersTab canEdit={has("edit_users")} canSuspend={has("suspend_users")} canBan={has("ban_users")} canCreditCoins={has("credit_coins")} />}
                {tab === "purchases" && has("manage_payments") && <PurchasesTab />}
                {tab === "coins" && has("manage_coin_settings") && <CoinSettingsTab />}
                {tab === "tournaments" && has("manage_tournaments") && <TournamentsTab />}
                {tab === "games" && has("view_games") && <GamesTab />}
                {tab === "moderation" && (
                  <ModerationTab
                    canAnnounce={has("manage_announcements")}
                    canMaintain={has("manage_admins")}
                    canModerateChat={has("manage_reports")}
                  />
                )}
                {tab === "admins" && has("manage_admins") && <AdminsTab />}
                {tab === "audit" && has("view_audit_log") && <AuditLogTab />}
                {tab === "puzzle_creator" && has("manage_puzzles") && <PuzzleCreatorTab />}
                {tab === "ken8_lab" && <Ken8TrainingLabTab myUsername={myUsername} />}
              </div>
            )}

            {/* ---- Slide-in controls drawer (the ☰ target), overlays content ---- */}
            {menuOpen && (
              <>
                <div className="absolute inset-0 bg-black/50 z-10" onClick={() => setMenuOpen(false)} />
                <motion.nav
                  initial={{ x: -260 }}
                  animate={{ x: 0 }}
                  exit={{ x: -260 }}
                  transition={{ type: "spring", damping: 30, stiffness: 340 }}
                  className="absolute left-0 top-0 bottom-0 w-60 z-20 bg-slate-950 border-r border-slate-800 flex flex-col p-2 gap-1 overflow-y-auto"
                >
                  <div className="flex items-center justify-between px-2 py-2">
                    <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Admin Controls</span>
                    <button onClick={() => setMenuOpen(false)} className="text-slate-500 hover:text-slate-200 cursor-pointer"><X className="w-4 h-4" /></button>
                  </div>
                  <button
                    onClick={() => { setTab(null); setMenuOpen(false); }}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-bold text-left transition ${tab === null ? "bg-amber-500/10 text-amber-400" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"}`}
                  >
                    <LayoutDashboard className="w-4 h-4" /> Menu (all sections)
                  </button>
                  <div className="h-px bg-slate-800 my-1" />
                  {ADMIN_SECTIONS.filter(t => has(t.perm)).map(t => (
                    <button
                      key={t.id}
                      onClick={() => { setTab(t.id); setMenuOpen(false); }}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-bold text-left transition ${tab === t.id ? "bg-amber-500/10 text-amber-400" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"}`}
                    >
                      <t.icon className="w-4 h-4" /> {t.label}
                    </button>
                  ))}
                </motion.nav>
              </>
            )}
          </div>
        )}
    </motion.div>
  );
}

// One source of truth for the admin sections: used by both the full-page
// menu and the slide-in drawer, so they never drift apart.
const ADMIN_SECTIONS = [
  { id: "dashboard" as Tab, label: "Dashboard", desc: "Key numbers at a glance", icon: LayoutDashboard, perm: "view_analytics" },
  { id: "users" as Tab, label: "Users", desc: "Search, edit, suspend players", icon: Users, perm: "view_users" },
  { id: "purchases" as Tab, label: "Purchases", desc: "Approve coin purchases", icon: Receipt, perm: "manage_payments" },
  { id: "coins" as Tab, label: "Coins & Pricing", desc: "Prices, rake, revenue", icon: Coins, perm: "manage_coin_settings" },
  { id: "games" as Tab, label: "Games", desc: "Browse & manage all games", icon: Database, perm: "view_games" },
  { id: "tournaments" as Tab, label: "Tournaments", desc: "Create & manage tournaments", icon: Trophy, perm: "manage_tournaments" },
  { id: "moderation" as Tab, label: "Moderation", desc: "Announcements, chat, maintenance", icon: Megaphone, perm: "manage_reports" },
  { id: "admins" as Tab, label: "Admins", desc: "Grant or revoke admins", icon: Shield, perm: "manage_admins" },
  { id: "audit" as Tab, label: "Audit Log", desc: "Every admin action", icon: ScrollText, perm: "view_audit_log" },
  { id: "puzzle_creator" as Tab, label: "Puzzle Creator", desc: "Build & publish custom tactical puzzles", icon: Puzzle, perm: "manage_puzzles" },
  { id: "ken8_lab" as Tab, label: "Ken 8 AI Training Lab", desc: "1000-game dataset & Gemini 90%+ benchmark vs Ken 8", icon: Brain, perm: "view_analytics" },
];
const TAB_LABELS: Record<string, string> = Object.fromEntries(ADMIN_SECTIONS.map(s => [s.id, s.label]));

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-3 text-xs text-slate-300">{children}</div>;
}

function DashboardTab() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet("/api/admin/dashboard").then(setData).catch((e) => setErr(e.message));
  }, []);

  if (err) return <Panel><p className="text-rose-400 font-sans">{err}</p></Panel>;
  if (!data) return <Panel><p className="text-slate-500 font-sans">Loading...</p></Panel>;

  const cards = [
    { label: "Total Users", value: data.totalUsers, icon: Users },
    { label: "Online Now", value: data.onlineNow, icon: LayoutDashboard },
    { label: "Active Tournaments", value: data.activeTournaments, icon: Shield },
    { label: "Open Reports", value: data.openReports, icon: ScrollText },
    { label: "Pending Purchases", value: data.pendingPurchases, icon: Receipt },
  ];

  return (
    <Panel>
      <div className="grid grid-cols-3 gap-3">
        {cards.map(c => (
          <div key={c.label} className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col gap-1.5">
            <c.icon className="w-3.5 h-3.5 text-amber-500/70" />
            <span className="text-[9px] text-slate-500 uppercase tracking-wider font-bold font-sans">{c.label}</span>
            <span className="text-xl font-extrabold text-slate-100 font-sans">{c.value}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-600 mt-2 font-sans">
        Server CPU/memory/storage monitoring, backups, and ads management aren't wired up here yet -- they need real hosting infra this build doesn't have access to.
      </p>
    </Panel>
  );
}

function UsersTab({ canEdit, canSuspend, canBan, canCreditCoins }: { canEdit: boolean; canSuspend: boolean; canBan: boolean; canCreditCoins?: boolean }) {
  const [search, setSearch] = useState("");
  const [user, setUser] = useState<any>(null);
  const [detail, setDetail] = useState<{ coinBalance: number; recentGames: any[]; moderationHistory: any[] } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  // EVERY registered player, listed up front -- the search box just
  // filters this list live (no more typing an exact username into the
  // void to find anyone).
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  const loadAllUsers = async () => {
    setLoadingList(true);
    try {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .order("elo", { ascending: false })
        .limit(500);
      setAllUsers(data ?? []);
    } catch (e) {
      console.error("Failed to load users list:", e);
    } finally {
      setLoadingList(false);
    }
  };
  useEffect(() => { loadAllUsers(); }, []);

  const filteredUsers = allUsers.filter(
    (u) => !search.trim() || String(u.username || "").toLowerCase().includes(search.toLowerCase().trim())
  );

  // The basic profile row renders immediately (it's already in hand from
  // the list/search), then the fuller picture -- coin balance, recent
  // games, moderation trail -- streams in right after from one bundled
  // call, rather than blocking the tap on all of it at once.
  const loadDetail = async (uname: string) => {
    setLoadingDetail(true);
    setDetail(null);
    try {
      const d = await apiGet("/api/admin/user-detail", { username: uname });
      setDetail({ coinBalance: d.coinBalance ?? 0, recentGames: d.recentGames ?? [], moderationHistory: d.moderationHistory ?? [] });
    } catch (e) {
      console.error("Failed to load full profile:", e);
    } finally {
      setLoadingDetail(false);
    }
  };

  const openUser = (row: any) => {
    setNotFound(false);
    const uname = String(row.usernameLower || row.username || "").toLowerCase();
    setUser({ id: uname, ...row });
    loadDetail(uname);
  };

  const lookup = async () => {
    setNotFound(false);
    setUser(null);
    setDetail(null);
    const uname = search.toLowerCase().trim();
    if (!uname) return;
    const { data } = await supabase.from("profiles").select("*").eq("usernameLower", uname).maybeSingle();
    if (data) { setUser({ id: uname, ...data }); loadDetail(uname); }
    else setNotFound(true);
  };

  const doAction = async (action: string, newValue?: number) => {
    if (!user) return;
    setBusy(true);
    try {
      await apiPost("/api/admin/user-action", { action, targetUsername: user.id, newValue });
      if (action === "delete") {
        setUser(null);
        setDetail(null);
      } else {
        const { data } = await supabase.from("profiles").select("*").eq("usernameLower", user.id).maybeSingle();
        if (data) setUser({ id: user.id, ...data });
        loadDetail(user.id); // moderation trail changed too, not just the profile row
      }
      loadAllUsers();
    } catch (e: any) {
      alert(e.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const fmtDate = (ms?: number | null) => ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
  const fmtDuration = (secs?: number | null) => {
    if (!secs) return "—";
    const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <Panel>
      <div className="flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && lookup()}
          placeholder="Filter players by name…"
          className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100"
        />
        <button onClick={lookup} className="bg-amber-500 hover:bg-amber-400 px-4 rounded-lg font-bold text-slate-950 text-xs transition">Exact</button>
      </div>
      {notFound && <p className="text-slate-500">No user found with that exact username.</p>}

      {/* All registered players, always visible -- tap one to see their full profile. */}
      {!user && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">
              All players ({filteredUsers.length}{allUsers.length >= 500 ? " of first 500 by rating" : ""})
            </span>
            <button onClick={loadAllUsers} disabled={loadingList} className="text-[9px] text-amber-400 hover:text-amber-300 font-bold cursor-pointer disabled:opacity-45">
              {loadingList ? "Loading…" : "Refresh"}
            </button>
          </div>
          {loadingList && allUsers.length === 0 ? (
            <p className="text-slate-500 text-center py-6">Loading players…</p>
          ) : filteredUsers.length === 0 ? (
            <p className="text-slate-500 text-center py-6">No players match that filter.</p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto border border-slate-900 bg-slate-950/60 rounded-xl divide-y divide-slate-900">
              {filteredUsers.map((u) => (
                <button
                  key={u.usernameLower || u.username}
                  onClick={() => openUser(u)}
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-900/70 transition cursor-pointer text-left"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 font-black text-[11px] shrink-0 overflow-hidden">
                      {u.avatarUrl ? <img src={u.avatarUrl} alt="" className="w-full h-full object-cover" /> : String(u.username || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-slate-200 truncate block">{u.username}</span>
                      <span className="text-[9px] text-slate-500 font-mono">{u.gamesCount ?? 0} games · {u.wins ?? 0}W {u.losses ?? 0}L {u.draws ?? 0}D</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {u.banned && <span className="text-[8px] bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded-full font-bold">BANNED</span>}
                    {u.suspendedUntil && u.suspendedUntil > Date.now() && <span className="text-[8px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded-full font-bold">SUSP</span>}
                    <span className="text-[10px] font-mono text-amber-400 font-bold">{Math.round(u.elo ?? 1500)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {user && (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col gap-3">
          {/* Identity header */}
          <div className="flex items-center justify-between">
            <button onClick={() => { setUser(null); setDetail(null); }} className="text-slate-500 hover:text-white cursor-pointer text-[10px] font-black uppercase">← All</button>
            <div className="flex items-center gap-1.5">
              {user.banned && <span className="text-[9px] bg-rose-500/20 text-rose-400 px-2 py-0.5 rounded-full font-bold">BANNED</span>}
              {user.suspendedUntil && user.suspendedUntil > Date.now() && <span className="text-[9px] bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full font-bold">SUSPENDED</span>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 font-black text-xl shrink-0 overflow-hidden border border-slate-800">
              {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" /> : String(user.username || user.id || "?").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="font-bold text-slate-100 text-base truncate">{user.username || user.id}</div>
              <div className="text-[10px] text-slate-500">Member since {fmtDate(user.createdAt)}</div>
            </div>
          </div>

          {/* Core stats */}
          <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-400">
            <span>Elo: <b className="text-slate-200">{Math.round(user.elo ?? 1500)}</b></span>
            <span>W/L/D: <b className="text-slate-200">{user.wins ?? 0}/{user.losses ?? 0}/{user.draws ?? 0}</b></span>
            <span>Games: <b className="text-slate-200">{user.gamesCount ?? 0}</b></span>
            <span>Max Ken: <b className="text-slate-200">{user.maxUnlockedKenLevel || 1}</b></span>
            <span>Total play: <b className="text-slate-200">{fmtDuration(user.totalPlayTime)}</b></span>
            <span>Avg game: <b className="text-slate-200">{fmtDuration(user.averageDuration)}</b></span>
            <span className="flex items-center gap-1 font-mono">
              <KentroCoin size="2xs" glow />
              <b className="text-amber-300">{loadingDetail ? "…" : (detail?.coinBalance ?? 0).toLocaleString()}</b>
            </span>
          </div>

          {/* Ban/suspension attribution, only if it applies */}
          {(user.banned || (user.suspendedUntil && user.suspendedUntil > Date.now())) && (
            <div className="text-[10px] text-rose-300/90 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2.5 py-1.5 flex flex-col gap-0.5">
              {user.banned && <span>Banned by <b>{user.bannedBy || "unknown"}</b> on {fmtDate(user.bannedAt)}</span>}
              {user.suspendedUntil && user.suspendedUntil > Date.now() && (
                <span>Suspended by <b>{user.suspendedBy || "unknown"}</b> until {fmtDate(user.suspendedUntil)}</span>
              )}
            </div>
          )}

          {/* Moderation actions */}
          <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-900">
            {canEdit && <button disabled={busy} onClick={() => doAction("reset_rating")} className="text-[10px] bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded-lg font-bold">Reset Rating</button>}
            {canCreditCoins && (
              <button
                disabled={busy}
                onClick={async () => {
                  const amtStr = window.prompt(`How many coins to send to ${user.username}?`);
                  if (!amtStr) return;
                  const amt = parseInt(amtStr, 10);
                  if (isNaN(amt) || amt <= 0) {
                    alert("Invalid amount");
                    return;
                  }
                  setBusy(true);
                  try {
                    const res = await apiPost("/api/admin/adjust-coins", {
                      targetUsername: user.username,
                      amount: amt,
                      direction: "credit",
                      reason: "Admin manual credit"
                    });
                    if (res.ok) {
                      setDetail(prev => prev ? { ...prev, coinBalance: res.balance } : prev);
                    }
                  } catch (e: any) {
                    alert("Failed to send coins: " + e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="text-[10px] bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 px-2.5 py-1 rounded-lg font-bold"
              >
                Send Coins
              </button>
            )}
            {canSuspend && !user.suspendedUntil && <button disabled={busy} onClick={() => doAction("suspend", Date.now() + 24 * 60 * 60 * 1000)} className="text-[10px] bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 px-2.5 py-1 rounded-lg font-bold">Suspend 24h</button>}
            {canSuspend && user.suspendedUntil && <button disabled={busy} onClick={() => doAction("unsuspend")} className="text-[10px] bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded-lg font-bold">Unsuspend</button>}
            {canBan && !user.banned && <button disabled={busy} onClick={() => doAction("ban")} className="text-[10px] bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 px-2.5 py-1 rounded-lg font-bold">Ban</button>}
            {canBan && user.banned && <button disabled={busy} onClick={() => doAction("unban")} className="text-[10px] bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded-lg font-bold">Unban</button>}
            {canBan && (
              <button
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Are you sure you want to completely delete user "${user.username}"? This will delete their profile and Supabase account entirely.`)) {
                    doAction("delete");
                  }
                }}
                className="text-[10px] bg-rose-600 text-white hover:bg-rose-500 px-2.5 py-1 rounded-lg font-bold ml-auto"
              >
                Delete User
              </button>
            )}
          </div>

          {/* Recent games */}
          <div className="border-t border-slate-900 pt-2">
            <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Recent Games</span>
            {loadingDetail ? (
              <p className="text-slate-600 text-[10px] py-2">Loading…</p>
            ) : !detail || detail.recentGames.length === 0 ? (
              <p className="text-slate-600 text-[10px] py-2">No games recorded yet.</p>
            ) : (
              <div className="flex flex-col gap-1 mt-1.5">
                {detail.recentGames.map((g) => {
                  const isWhite = g.whitePlayer === user.username;
                  const opponent = isWhite ? g.blackPlayer : g.whitePlayer;
                  const outcome = g.winner === null ? "Draw" : (g.winner === (isWhite ? "W" : "B") ? "Won" : "Lost");
                  const color = outcome === "Won" ? "text-emerald-400" : outcome === "Lost" ? "text-rose-400" : "text-slate-400";
                  return (
                    <div key={g.gameId} className="flex items-center justify-between text-[10px] px-2 py-1 bg-slate-900/50 rounded-lg">
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
          {detail && detail.moderationHistory.length > 0 && (
            <div className="border-t border-slate-900 pt-2">
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Moderation History</span>
              <div className="flex flex-col gap-1 mt-1.5">
                {detail.moderationHistory.map((h, i) => (
                  <div key={i} className="text-[10px] text-slate-500 px-2 py-1">
                    <b className="text-slate-300">{String(h.action || "").replace("user_", "")}</b> by {h.adminUsername || "unknown"} · {fmtDate(h.timestamp)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function PurchasesTab() {
  const [requests, setRequests] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    apiGet("/api/admin/pending-purchases")
      .then(d => setRequests(d.requests || []))
      .catch((e: any) => setErr(e.message || "Failed to load purchase requests."));
  };
  useEffect(() => { load(); }, []);

  const resolve = async (id: string, approve: boolean) => {
    setBusy(id);
    try {
      await apiPost("/api/admin/resolve-purchase", { requestId: id, approve });
      await load();
    } catch (e: any) {
      alert(e.message || "Failed to resolve");
    } finally {
      setBusy(null);
    }
  };

  if (err) return <Panel><p className="text-amber-400 font-sans text-[11px]">{err}</p></Panel>;
  if (requests.length === 0) return <Panel><p className="text-slate-500">No pending purchase requests.</p></Panel>;

  return (
    <Panel>
      {requests.map(r => (
        <div key={r.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-bold text-slate-100">{r.username}</span>
            <span className="text-[10px] text-slate-500">
              {r.coins} coins · ₦{r.amountNaira} · ref: <span className="font-mono">{r.receiptRef}</span>
            </span>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button disabled={busy === r.id} onClick={() => resolve(r.id, true)} className="text-[10px] bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 px-2.5 py-1.5 rounded-lg font-bold">Approve</button>
            <button disabled={busy === r.id} onClick={() => resolve(r.id, false)} className="text-[10px] bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 px-2.5 py-1.5 rounded-lg font-bold">Reject</button>
          </div>
        </div>
      ))}
    </Panel>
  );
}

/**
 * Admin-set pricing for EVERYTHING monetized in the app: match entry fees
 * (per time-control category), tournament entry fee, AI level unlock costs,
 * and the Kentro Coin packages sold via bank transfer. Every price the app
 * charges anywhere comes from this one app_config row (id="coinSettings")
 * -- nothing is hardcoded in the client or in server.ts beyond the
 * defaults used the very first time this row doesn't exist yet.
 */
function CoinSettingsTab() {
  const [settings, setSettings] = useState<any>(null);
  const [coinsEnabled, setCoinsEnabled] = useState<boolean>(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [revenue, setRevenue] = useState<any>(null);

  useEffect(() => {
    apiGet("/api/admin/house-revenue").then(setRevenue).catch(() => setRevenue({ error: true }));
  }, []);

  useEffect(() => {
    fetch("/api/coins/settings").then(r => r.json()).then((data) => {
      setSettings(data);
      setCoinsEnabled(data.coinsEnabled !== false);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await apiPost("/api/admin/coin-settings", { settings });
      setSaved(true);
    } catch (e: any) {
      alert(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <Panel><p className="text-slate-500">Loading...</p></Panel>;

  const field = (label: string, value: number, onChange: (v: number) => void) => (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => { onChange(Number(e.target.value) || 0); setSaved(false); }}
        className="w-24 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-right text-slate-100"
      />
    </div>
  );

  return (
    <Panel>
      {!coinsEnabled && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2.5 text-[11px] text-amber-400 font-sans">
          Kentro Coins are currently disabled app-wide. You can still view and edit pricing below, but changes won't take effect until coins are re-enabled in server.ts.
        </div>
      )}
      {/* ---------------- Platform revenue (the house wallet) ---------------- */}
      <div className="bg-gradient-to-br from-amber-500/10 to-slate-950 border border-amber-500/30 rounded-xl p-3 flex flex-col gap-2">
        <span className="text-[10px] text-amber-500 font-bold uppercase tracking-wider font-sans">Platform Revenue — house wallet</span>
        {!revenue && <span className="text-[11px] text-slate-500">Loading…</span>}
        {revenue?.error && <span className="text-[11px] text-rose-400">Could not load revenue.</span>}
        {revenue && !revenue.error && (
          <>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-black text-amber-400">{revenue.balance?.toLocaleString?.() ?? revenue.balance}</span>
              <span className="text-[10px] text-slate-400 font-bold pb-1">coins held by <span className="font-mono">{revenue.houseWallet}</span></span>
            </div>
            <div className="text-[10px] text-slate-400 leading-relaxed">
              Collected from <strong className="text-slate-200">{revenue.rakeCount}</strong> raked matches
              {revenue.totals?.rake ? <> — match rake <strong className="text-slate-200">{revenue.totals.rake.toLocaleString()}</strong> coins</> : null}
              {revenue.totals?.tournament_prize ? <>, tournament rake <strong className="text-slate-200">{revenue.totals.tournament_prize.toLocaleString()}</strong></> : null}.
              At the current sell price these convert at ≈ ₦10 per coin; the buy/withdraw spread earns on top of this, at cash-out time.
            </div>
          </>
        )}
      </div>

      {/* ---------------- House rake controls ---------------- */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
        <span className="text-[10px] text-amber-500 font-bold uppercase tracking-wider font-sans">House Rake (% of pot)</span>
        {field("Match rake %  (0–50)", Math.round(((settings.matchRakePercent ?? 0.10) * 100)), v => setSettings({ ...settings, matchRakePercent: Math.min(50, Math.max(0, v)) / 100 }))}
        {field("Tournament rake %  (0–50)", Math.round(((settings.tournamentRakePercent ?? 0.20) * 100)), v => setSettings({ ...settings, tournamentRakePercent: Math.min(50, Math.max(0, v)) / 100 }))}
        <p className="text-[9px] text-slate-500 leading-relaxed">
          Rake is taken only from <strong className="text-slate-400">decisive</strong> results — draws refund both entry fees in
          full. The winner receives the pot minus rake (rounded in the winner's favor); the rake is credited to the
          house wallet above, every take individually recorded in the coin ledger.
        </p>
      </div>

      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
        <span className="text-[10px] text-amber-500 font-bold uppercase tracking-wider font-sans">Match Entry Fees (Kentro Coins)</span>
        {field("Blitz (<8 min)", settings.matchEntryFee.blitz, v => setSettings({ ...settings, matchEntryFee: { ...settings.matchEntryFee, blitz: v } }))}
        {field("Rapid (8-14 min)", settings.matchEntryFee.rapid, v => setSettings({ ...settings, matchEntryFee: { ...settings.matchEntryFee, rapid: v } }))}
        {field("Classical (15+ min)", settings.matchEntryFee.classical, v => setSettings({ ...settings, matchEntryFee: { ...settings.matchEntryFee, classical: v } }))}
      </div>
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
        <span className="text-[10px] text-amber-500 font-bold uppercase tracking-wider font-sans">Tournament & AI Unlock (Kentro Coins)</span>
        {field("Default Tournament Entry", settings.tournamentEntryFeeDefault, v => setSettings({ ...settings, tournamentEntryFeeDefault: v }))}
        {field("Per AI Level Unlock", settings.aiUnlockCostPerLevel, v => setSettings({ ...settings, aiUnlockCostPerLevel: v }))}
        {field("Unlock All AI Levels", settings.aiUnlockAllCost, v => setSettings({ ...settings, aiUnlockAllCost: v }))}
      </div>
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
        <span className="text-[10px] text-amber-500 font-bold uppercase tracking-wider font-sans">Coin Packages (real money, via bank transfer)</span>
        {settings.coinPackages.map((pkg: any, i: number) => (
          <div key={pkg.id} className="flex items-center gap-2">
            <span className="w-16 text-slate-500 shrink-0">{pkg.id}</span>
            <input type="number" value={pkg.coins} onChange={(e) => {
              const next = [...settings.coinPackages];
              next[i] = { ...pkg, coins: Number(e.target.value) || 0 };
              setSettings({ ...settings, coinPackages: next });
              setSaved(false);
            }} className="w-20 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-slate-100" />
            <span className="text-slate-600 shrink-0">coins for ₦</span>
            <input type="number" value={pkg.priceNaira} onChange={(e) => {
              const next = [...settings.coinPackages];
              next[i] = { ...pkg, priceNaira: Number(e.target.value) || 0 };
              setSettings({ ...settings, coinPackages: next });
              setSaved(false);
            }} className="w-20 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-slate-100" />
          </div>
        ))}
      </div>
      <button onClick={save} disabled={saving || !coinsEnabled} className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold py-2 rounded-lg transition">
        {!coinsEnabled ? "Coins Disabled" : saving ? "Saving..." : saved ? "Saved ✓" : "Save Pricing"}
      </button>
      <p className="text-[9px] text-slate-600">
        Takes effect for new matches/purchases within ~30 seconds (server caches pricing briefly).
      </p>
    </Panel>
  );
}

function AdminsTab() {
  const [admins, setAdmins] = useState<any[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => apiGet("/api/admin/list-admins").then(d => setAdmins(d.admins || []));
  useEffect(() => { load(); }, []);

  const togglePerm = (p: string) => setSelectedPerms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  const addOrUpdate = async () => {
    setErr(null);
    const uname = newUsername.toLowerCase().trim();
    if (!uname) return;
    setBusy(true);
    try {
      const { data: profile } = await supabase.from("profiles").select("ownerId").eq("usernameLower", uname).maybeSingle();
      if (!profile?.ownerId) {
        setErr(`"${uname}" hasn't played a game yet (no profile / device identity found to bind admin access to).`);
        return;
      }
      await apiPost("/api/admin/set-admin", {
        targetUsername: uname,
        targetUid: profile.ownerId,
        permissions: selectedPerms,
      });
      setNewUsername("");
      setSelectedPerms([]);
      await load();
    } catch (e: any) {
      setErr(e.message || "Failed to save admin");
    } finally {
      setBusy(false);
    }
  };

  const editExisting = (a: any) => {
    setNewUsername(a.username);
    setSelectedPerms(a.permissions || []);
  };

  const remove = async (uname: string) => {
    if (!confirm(`Remove admin access for ${uname}?`)) return;
    await apiPost("/api/admin/remove-admin", { targetUsername: uname });
    await load();
  };

  return (
    <Panel>
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
        <span className="text-[10px] text-amber-500 font-bold uppercase tracking-wider font-sans">Add / Update Admin</span>
        <input
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          placeholder="Username (must have played at least one game)"
          className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
        />
        <div className="grid grid-cols-2 gap-1">
          {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer">
              <input type="checkbox" checked={selectedPerms.includes(key)} onChange={() => togglePerm(key)} className="accent-amber-500" />
              {label}
            </label>
          ))}
        </div>
        {err && <p className="text-rose-400 text-[10px]">{err}</p>}
        <button onClick={addOrUpdate} disabled={busy || !newUsername.trim()} className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold py-2 rounded-lg transition">
          {busy ? "Saving..." : "Grant / Update Access"}
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {admins.map((a) => (
          <div key={a.username} className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between">
            <button onClick={() => editExisting(a)} className="flex flex-col items-start text-left">
              <span className="font-bold text-slate-100">{a.username}</span>
              <span className="text-[9px] text-slate-500">{a.permissions.length} permission{a.permissions.length !== 1 ? "s" : ""} — click to edit</span>
            </button>
            <button onClick={() => remove(a.username)} className="text-[10px] bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 px-2.5 py-1 rounded-lg font-bold">Remove</button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AuditLogTab() {
  const [logs, setLogs] = useState<any[]>([]);
  useEffect(() => { apiGet("/api/admin/audit-log").then(d => setLogs(d.logs || [])); }, []);

  return (
    <Panel>
      {logs.map((log) => (
        <div key={log.id} className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 flex items-center justify-between text-[10px]">
          <span className="text-slate-300"><b>{log.adminUsername}</b> — {log.action} {log.target ? `→ ${log.target}` : ""}</span>
          <span className="text-slate-600">{new Date(log.timestamp).toLocaleString()}</span>
        </div>
      ))}
      {logs.length === 0 && <p className="text-slate-500">No actions logged yet.</p>}
    </Panel>
  );
}
