import { useEffect, useState } from "react";
import { Megaphone, Trash2, RefreshCw, Search, Wrench, AlertTriangle } from "lucide-react";
import { apiGet, apiPost } from "../../apiClient";

interface ChatRow {
  id: string;
  text: string;
  sender: string;
  timestamp: string;
}

/**
 * Moderation tools: site-wide announcements, maintenance mode, and global
 * chat clean-up. Announcements need manage_announcements, maintenance needs
 * manage_admins, and chat needs manage_reports -- each endpoint re-checks
 * server-side, so hiding a control here is convenience, not security.
 */
export function ModerationTab({ canAnnounce, canMaintain, canModerateChat }: {
  canAnnounce: boolean;
  canMaintain: boolean;
  canModerateChat: boolean;
}) {
  const [text, setText] = useState("");
  const [tone, setTone] = useState<"info" | "warning" | "success">("info");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [maintOn, setMaintOn] = useState(false);
  const [maintMsg, setMaintMsg] = useState("");

  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [chatQuery, setChatQuery] = useState("");
  const [loadingChat, setLoadingChat] = useState(false);

  // Load whatever is currently live so the forms reflect reality.
  useEffect(() => {
    apiGet("/api/site-config")
      .then((cfg) => {
        if (cfg?.announcement) { setText(cfg.announcement.text || ""); setTone(cfg.announcement.tone || "info"); }
        if (cfg?.maintenance) { setMaintOn(true); setMaintMsg(cfg.maintenance.message || ""); }
      })
      .catch(() => {});
  }, []);

  const loadChat = async (q?: string) => {
    setLoadingChat(true);
    try {
      const r = await apiGet("/api/admin/chat", q ? { q } : {});
      setMessages(r.messages || []);
    } catch (e: any) {
      setStatus(e?.message || "Couldn't load chat");
    } finally {
      setLoadingChat(false);
    }
  };
  useEffect(() => { if (canModerateChat) loadChat(); }, [canModerateChat]);

  const saveAnnouncement = async (active: boolean) => {
    setBusy(true); setStatus(null);
    try {
      await apiPost("/api/admin/announcement", { active, text, tone });
      setStatus(active ? "Announcement is now live for every player." : "Announcement cleared.");
      if (!active) setText("");
    } catch (e: any) {
      setStatus(e?.message || "Failed to save announcement");
    } finally { setBusy(false); }
  };

  const saveMaintenance = async (enabled: boolean) => {
    if (enabled && !confirm("Turn on maintenance mode? Every player will see a maintenance notice.")) return;
    setBusy(true); setStatus(null);
    try {
      await apiPost("/api/admin/maintenance", { enabled, message: maintMsg });
      setMaintOn(enabled);
      setStatus(enabled ? "Maintenance mode is ON." : "Maintenance mode is off — the app is live again.");
    } catch (e: any) {
      setStatus(e?.message || "Failed to update maintenance mode");
    } finally { setBusy(false); }
  };

  const deleteMessage = async (m: ChatRow) => {
    if (!confirm(`Delete this message from ${m.sender}?\n\n"${m.text}"`)) return;
    try {
      await apiPost("/api/admin/chat/delete", { id: m.id });
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
    } catch (e: any) {
      setStatus(e?.message || "Delete failed");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {status && (
        <div className="text-[11px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
          {status}
        </div>
      )}

      {/* ---------- Announcement ---------- */}
      {canAnnounce && (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="text-[10px] font-extrabold text-amber-500 uppercase tracking-widest">Announcement banner</span>
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Shown at the top of the app to every player — use it for tournaments, downtime warnings, or new features.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            maxLength={400}
            placeholder="e.g. Weekend tournament starts Saturday 6pm — 5,000 coin prize pool!"
            className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500/50 resize-none"
          />
          <div className="flex items-center gap-1.5">
            {(["info", "success", "warning"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTone(t)}
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold capitalize border transition cursor-pointer ${
                  tone === t ? "bg-amber-500 border-amber-500 text-slate-950" : "bg-slate-900 border-slate-800 text-slate-400"
                }`}
              >
                {t}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={() => saveAnnouncement(false)}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
            >Clear</button>
            <button
              onClick={() => saveAnnouncement(true)}
              disabled={busy || !text.trim()}
              className="px-3 py-1.5 rounded-lg text-[10px] font-extrabold bg-amber-500 hover:bg-amber-400 text-slate-950 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >Publish</button>
          </div>
        </div>
      )}

      {/* ---------- Maintenance mode ---------- */}
      {canMaintain && (
        <div className={`border rounded-2xl p-3 flex flex-col gap-2.5 ${maintOn ? "border-rose-500/40 bg-rose-500/5" : "border-slate-800 bg-slate-950"}`}>
          <div className="flex items-center gap-2">
            <Wrench className={`w-4 h-4 shrink-0 ${maintOn ? "text-rose-400" : "text-slate-400"}`} />
            <span className={`text-[10px] font-extrabold uppercase tracking-widest ${maintOn ? "text-rose-300" : "text-slate-400"}`}>
              Maintenance mode {maintOn ? "— ON" : ""}
            </span>
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Shows a full notice to players while you deploy or fix something. Matches in progress aren't interrupted.
          </p>
          <input
            value={maintMsg}
            onChange={(e) => setMaintMsg(e.target.value)}
            maxLength={400}
            placeholder="Back in 15 minutes — upgrading the servers."
            className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500/50"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => saveMaintenance(!maintOn)}
              disabled={busy}
              className={`flex-1 px-3 py-2 rounded-xl text-[11px] font-extrabold transition cursor-pointer disabled:opacity-40 ${
                maintOn ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-rose-600 hover:bg-rose-500 text-white"
              }`}
            >
              {maintOn ? "Turn OFF — go live" : "Turn ON maintenance"}
            </button>
          </div>
        </div>
      )}

      {/* ---------- Chat moderation ---------- */}
      {canModerateChat && (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="text-[10px] font-extrabold text-amber-500 uppercase tracking-widest">Chat moderation</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2">
              <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <input
                value={chatQuery}
                onChange={(e) => setChatQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") loadChat(chatQuery.trim() || undefined); }}
                placeholder="Search sender or message…"
                className="bg-transparent outline-none text-xs text-slate-200 w-full placeholder:text-slate-600"
              />
            </div>
            <button
              onClick={() => loadChat(chatQuery.trim() || undefined)}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-amber-400 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loadingChat ? "animate-spin" : ""}`} />
            </button>
          </div>
          <div className="flex flex-col gap-1.5 max-h-[38vh] overflow-y-auto pr-1">
            {!loadingChat && messages.length === 0 && (
              <div className="text-[11px] text-slate-500 py-4 text-center">No messages found.</div>
            )}
            {messages.map((m) => (
              <div key={m.id} className="flex items-start gap-2 bg-slate-900/70 border border-slate-800 rounded-xl px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-extrabold text-amber-400">{m.sender}</div>
                  <div className="text-[11px] text-slate-200 break-words">{m.text}</div>
                  <div className="text-[9px] text-slate-600">{new Date(m.timestamp).toLocaleString()}</div>
                </div>
                <button
                  onClick={() => deleteMessage(m)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer shrink-0"
                  title="Delete message"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
