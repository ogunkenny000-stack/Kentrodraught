import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, CheckCheck, ChevronRight, CircleHelp, Clock, Link2, MessageSquare, Settings2, Shield, Swords, Trophy, X } from "lucide-react";
import { supabase } from "../supabase";
import { DEFAULT_NOTIFICATION_PREFERENCES, KentroNotification, NotificationCategory, NotificationPreferences, loadNotificationPreferences, notificationStorageKey, unreadCount, validNotificationPath } from "../lib/smartNotifications";
import { enableBackgroundPush, disableBackgroundPush, refreshBackgroundCategories } from "../lib/pushSubscription";

const categories: Array<{ id: NotificationCategory; label: string; desc: string }> = [
  { id: "challenge", label: "Match challenges", desc: "Direct invites from your friends" },
  { id: "friend", label: "Friends", desc: "New connections" },
  { id: "tournament", label: "Tournaments", desc: "Round starts and tournament results" },
  { id: "result", label: "Game results", desc: "Completed online matches and replay links" },
  { id: "system", label: "Important updates", desc: "Account and platform notices" },
];
const iconFor: Record<NotificationCategory, typeof Bell> = { challenge: Swords, friend: MessageSquare, tournament: Trophy, result: CheckCheck, system: Shield };

export function useKentroNotifications(userId: string | null, enabled: boolean) {
  const [items, setItems] = useState<KentroNotification[]>([]);
  const [prefs, setPrefs] = useState<NotificationPreferences>(() => userId ? loadNotificationPreferences(userId) : { ...DEFAULT_NOTIFICATION_PREFERENCES });
  const [error, setError] = useState("");
  const knownIds = useRef(new Set<string>());
  const seeded = useRef(false);
  const activeAccount = useRef({ userId, enabled });
  activeAccount.current = { userId, enabled };
  const loadVersion = useRef(0);

  useEffect(() => {
    setItems([]); setError(""); knownIds.current = new Set(); seeded.current = false;
    setPrefs(userId ? loadNotificationPreferences(userId) : { ...DEFAULT_NOTIFICATION_PREFERENCES });
  }, [userId]);
  const reload = useCallback(async () => {
    if (!userId || !enabled) return;
    const version = ++loadVersion.current;
    const { data, error: queryError } = await supabase.from("kentro_notifications").select("id,recipient_id,category,title,body,target_path,created_at,read_at").eq("recipient_id", userId).order("created_at", { ascending: false }).limit(80);
    // Signing out/switching accounts must invalidate every outstanding query.
    if (version !== loadVersion.current || activeAccount.current.userId !== userId || !activeAccount.current.enabled) return;
    if (queryError) { setError("Notifications unavailable. Run the Kentro notifications SQL migration if this is a new deployment."); return; }
    const next = (data || []) as KentroNotification[];
    setItems(next); setError("");
    if (seeded.current && prefs.browserAlerts && typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState === "hidden") {
      for (const alert of next.slice(0, 5).reverse()) {
        if (!knownIds.current.has(alert.id) && !alert.read_at && prefs[alert.category]) {
          try { new Notification(alert.title, { body: alert.body, icon: "/icon-192.png", tag: alert.id }); } catch {}
        }
      }
    }
    for (const alert of next) knownIds.current.add(alert.id);
    seeded.current = true;
  }, [userId, enabled, prefs]);

  useEffect(() => {
    if (!userId || !enabled) return;
    void reload();
    const timer = window.setInterval(() => void reload(), 35_000);
    const focus = () => void reload();
    window.addEventListener("focus", focus);
    const chan = supabase.channel(`kd-notification-${userId}`).on("postgres_changes", { event: "*", schema: "public", table: "kentro_notifications", filter: `recipient_id=eq.${userId}` }, () => void reload()).subscribe();
    return () => { clearInterval(timer); window.removeEventListener("focus", focus); void supabase.removeChannel(chan); };
  }, [userId, enabled, reload]);

  const changePreference = useCallback((key: keyof NotificationPreferences, value: boolean) => {
    setPrefs(prev => {
      const next = { ...prev, [key]: value };
      if (userId) try { localStorage.setItem(notificationStorageKey(userId), JSON.stringify(next)); } catch {}
      return next;
    });
  }, [userId]);
  const markRead = useCallback(async (ids: string[]) => {
    if (!userId || !ids.length) return;
    const at = new Date().toISOString();
    const { error: updateError } = await supabase.from("kentro_notifications").update({ read_at: at }).in("id", ids).eq("recipient_id", userId);
    if (activeAccount.current.userId !== userId) return;
    if (updateError) { setError("Could not mark notifications read."); return; }
    setItems(prev => prev.map(n => ids.includes(n.id) ? { ...n, read_at: at } : n));
  }, [userId]);

  return { items, prefs, error, reload, changePreference, markRead, unread: unreadCount(items, prefs) };
}

interface Props {
  userId: string | null;
  open: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
  manager: ReturnType<typeof useKentroNotifications>;
}
export function NotificationCenter({ userId, open, onClose, onNavigate, manager }: Props) {
  const [settings, setSettings] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState("");
  const [pushMode, setPushMode] = useState<"background" | "foreground" | null>(null);
  const { items, prefs, unread, markRead, changePreference, error, reload } = manager;
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current as HTMLElement | null;
      if (!panel) return;
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)'))
        .filter(el => el.getClientRects().length > 0);
      if (!controls.length) { event.preventDefault(); panelRef.current.focus(); return; }
      if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === panelRef.current)) {
        event.preventDefault(); controls[controls.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
        event.preventDefault(); controls[0].focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", onKeyDown); previousFocus?.focus(); };
  }, [open]);
  useEffect(() => { if (open) { void reload(); setSettings(false); } }, [open]);
  useEffect(() => {
    if (!open || !userId || !prefs.browserAlerts) return;
    void refreshBackgroundCategories(prefs).catch(()=>setPermissionMessage("Could not sync alert preferences to this device."));
  }, [open, userId, prefs]);
  if (!open) return null;
  const enableBrowserAlerts = async () => {
    try {
      const mode = await enableBackgroundPush({ ...prefs, browserAlerts: true });
      changePreference("browserAlerts", true);
      setPushMode(mode);
      setPermissionMessage(mode === "background"
        ? "Background notifications enabled on this device, even when the app is closed (subject to phone/browser notification settings)."
        : "Alerts enabled while the app is open. Background push is not available or not configured on this device.");
    } catch (e) { setPermissionMessage(e instanceof Error ? e.message : "Could not enable alerts."); }
  };
  const turnOffBrowserAlerts = async () => {
    try {
      await disableBackgroundPush();
      changePreference("browserAlerts",false);
      setPushMode(null);
      setPermissionMessage("Browser alerts turned off for this device.");
    } catch (e) {setPermissionMessage(e instanceof Error ? e.message : "Could not turn off alerts.");}
  };
  return <div role="presentation" className="fixed inset-0 z-[140] bg-black/70 flex justify-end" onClick={onClose}>
    <aside ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Kentro notifications" className="k-notification-panel h-full w-full max-w-md overflow-y-auto border-l border-slate-800 bg-[#090d18] text-white shadow-2xl" onClick={e => e.stopPropagation()}>
      <div className="sticky top-0 bg-[#090d18]/95 backdrop-blur z-10 flex items-center justify-between p-4 border-b border-slate-800">
        <div className="flex gap-2 items-center"><Bell className="text-amber-400 w-5 h-5"/><div><h2 className="font-black text-lg">Notifications</h2><span className="text-[11px] text-slate-400">{unread} unread · Your updates in one place</span></div></div>
        <div className="flex gap-1"><button aria-label="Notification preferences" onClick={()=>setSettings(!settings)} className="p-2 rounded-lg hover:bg-slate-800"><Settings2 className="w-5 h-5"/></button><button aria-label="Close notifications" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800"><X className="w-5 h-5"/></button></div>
      </div>
      {!userId ? <div className="text-center px-6 py-16 space-y-2"><BellOff className="h-10 w-10 mx-auto text-slate-500"/><h3 className="font-bold">Sign in for notifications</h3><p className="text-sm text-slate-400">Guests can browse Kentro TV. Create an account to receive friend challenges, tournament updates and results.</p></div>
      : settings ? <div className="p-4 space-y-4"><h3 className="text-sm font-black uppercase text-amber-400">Notification preferences</h3>
        {categories.map(c => <label key={c.id} className="flex gap-3 justify-between items-center rounded-xl border border-slate-800 bg-slate-900/50 p-3 cursor-pointer"><span><span className="block text-sm font-bold">{c.label}</span><span className="text-[11px] text-slate-400">{c.desc}</span></span><input className="h-5 w-5 accent-amber-400" type="checkbox" checked={prefs[c.id]} onChange={e=>changePreference(c.id,e.target.checked)}/></label>)}
        <div className="rounded-xl border border-slate-800 p-4 space-y-2"><h4 className="font-bold text-sm">Browser alerts (optional)</h4><p className="text-xs text-slate-400">Allow alerts on this device. Supported HTTPS browsers can receive push in the background when the server is configured; otherwise alerts work while the app is open. You can disable them anytime.</p><button onClick={prefs.browserAlerts ? () => void turnOffBrowserAlerts() : () => void enableBrowserAlerts()} className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-black text-slate-950">{prefs.browserAlerts ? "Turn off browser alerts" : "Enable notifications"}</button>{permissionMessage && <p role="status" className="text-xs text-amber-200">{permissionMessage}</p>}</div>
      </div> : <div className="p-4 space-y-3">
        {unread > 0 && <button className="text-xs text-amber-400 font-bold flex items-center gap-1" onClick={()=>void markRead(items.filter(i=>!i.read_at).map(i=>i.id))}><CheckCheck className="w-4 h-4"/> Mark all as read</button>}
        {error && <p role="alert" className="text-xs rounded-lg bg-rose-500/10 p-3 text-rose-300">{error}</p>}
        {items.filter(i=>prefs[i.category]).length ? items.filter(i=>prefs[i.category]).map(item=>{
          const Icon = iconFor[item.category] || Bell;
          return <button key={item.id} onClick={()=>{ void markRead([item.id]); onNavigate(validNotificationPath(item.target_path)); onClose(); }} className={`w-full rounded-xl border p-3 flex gap-3 text-left hover:border-amber-500/40 ${item.read_at ? "bg-slate-900/30 border-slate-900" : "bg-slate-900 border-amber-500/20"}`}>
            <span className="rounded-xl bg-amber-500/10 p-2 h-fit"><Icon className="w-4 h-4 text-amber-400"/></span><span className="flex-1 min-w-0"><span className="flex justify-between gap-2"><span className="text-sm font-bold">{item.title}</span>{!item.read_at && <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0 mt-1"/>}</span><span className="block text-xs text-slate-400 mt-1 break-words">{item.body}</span><span className="block text-[10px] text-slate-500 mt-2">{new Date(item.created_at).toLocaleString()}</span></span><ChevronRight className="w-4 h-4 text-slate-500 mt-2"/></button>;
        }) : <div className="text-center py-14"><Bell className="w-8 h-8 mx-auto text-slate-600"/><h3 className="text-sm font-bold mt-3">All caught up</h3><p className="text-xs text-slate-500 mt-1">Challenges, matches and tournament updates will appear here.</p></div>}
      </div>}
    </aside>
  </div>;
}
