import React, { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../apiClient';
export function TVCommunity({ gameKey, ply, live, arrows, onDraw, onShowArrows, onClear }: {
    gameKey: string;
    ply: number;
    live: boolean;
    arrows: number[][];
    onDraw: () => void;
    onShowArrows: (a: number[][], ply: number) => void;
    onClear: () => void;
}) {
    const [comments, setComments] = useState<any[]>([]), [me, setMe] = useState({ signedIn: false, canCommentate: false, canModerate: false }), [body, setBody] = useState(''), [message, setMessage] = useState(''), [muted, setMuted] = useState<string[]>([]), [reports, setReports] = useState<any[]>([]), [report, setReport] = useState<{
        id?: string;
    } | null>(null), [reason, setReason] = useState(''), [busy, setBusy] = useState(false);
    const load = async () => { try {
        const data = await apiGet(`/api/tv/feed/${encodeURIComponent(gameKey)}`);
        setComments(data.comments || []);
    }
    catch {
        setMessage('Discussion is unavailable. The board and replay still work.');
    } };
    useEffect(() => { let active = true; setComments([]); setMessage(''); void apiGet('/api/tv/me').then(m => { if (active)
        setMe(m); }).catch(() => { }); void load(); const timer = setInterval(() => { if (!document.hidden)
        void load(); }, 15000); return () => { active = false; clearInterval(timer); }; }, [gameKey]);
    const act = async (fn: () => Promise<unknown>, success: string) => { if (busy)
        return; setBusy(true); try {
        await fn();
        setMessage(success);
    }
    catch (e) {
        setMessage(e instanceof Error ? e.message : 'Please retry.');
    }
    finally {
        setBusy(false);
    } };
    const moderation = async () => { const d = await apiGet('/api/tv/reports'); setReports(d.reports || []); };
    return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3" aria-label="Broadcast discussion"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-bold">Commentary & discussion</h3><button className="text-xs underline" onClick={() => { setReport({}); setReason(''); }}>Report broadcast</button></div>
 {message && <p role="status" className="text-xs text-amber-200">{message}</p>}
 <div className="space-y-2 max-h-64 overflow-auto">{comments.filter(c => (live || c.ply <= ply) && !muted.includes(c.author)).map(c => <article className="rounded-xl bg-slate-950 p-3 text-xs" key={c.id}><div className="flex justify-between gap-2"><strong>{c.author}{c.caster ? ' · Commentator' : ''}</strong><span>Move {Math.ceil(c.ply / 2)}</span></div><p className="mt-1 break-words whitespace-pre-wrap">{c.body}</p><div className="flex gap-3 mt-2 text-slate-400">{c.caster && c.arrows?.length > 0 && (!live || c.ply === ply) && <button onClick={() => onShowArrows(c.arrows, c.ply)}>Show arrows</button>}<button onClick={() => setMuted(m => [...m, c.author])}>Mute locally</button><button onClick={() => { setReport({ id: c.id }); setReason(''); }}>Report</button></div></article>)}{!comments.length && <p className="text-xs text-slate-400">No commentary yet. Keep the discussion respectful.</p>}</div>
 {muted.length > 0 && <button className="text-xs underline" onClick={() => setMuted([])}>Reset local mutes</button>}
 {me.signedIn ? <form onSubmit={e => { e.preventDefault(); void act(async () => { await apiPost(`/api/tv/feed/${encodeURIComponent(gameKey)}`, { body, ply, arrows }); setBody(''); onClear(); await load(); }, 'Posted.'); }} className="space-y-2"><label className="block text-xs" htmlFor="tv-comment">Your comment {me.canCommentate ? '· approved commentator' : ''}</label><textarea id="tv-comment" value={body} onChange={e => setBody(e.target.value)} maxLength={500} rows={2} className="w-full rounded-xl bg-slate-950 border border-slate-700 p-2 text-sm"/><div className="flex flex-wrap gap-2">{me.canCommentate && <button type="button" onClick={onDraw} className="text-xs underline">Draw arrows on board ({arrows.length}/6)</button>}<button disabled={busy || !body.trim()} className="rounded-lg bg-amber-500 text-slate-950 px-3 py-2 text-xs font-bold">Post</button><button type="button" className="text-xs underline" onClick={onClear}>Clear arrows</button></div></form> : <p className="text-xs text-slate-400">Sign in to comment, follow players or submit reports.</p>}
 {report && <form className="space-y-2" onSubmit={e => { e.preventDefault(); void act(async () => { await apiPost('/api/tv/reports', { key: gameKey, commentId: report.id, reason }); setReport(null); }, 'Report sent to moderators.'); }}><label className="block text-xs" htmlFor="tv-report">Describe the issue</label><input id="tv-report" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} className="w-full rounded-lg bg-slate-950 border border-slate-700 p-2"/><button disabled={busy || reason.trim().length < 3} className="text-xs underline mr-3">Send report</button><button type="button" className="text-xs underline" onClick={() => setReport(null)}>Cancel</button></form>}
 {me.canModerate && <div className="space-y-2"><button className="text-xs underline" onClick={() => void act(moderation, 'Reports loaded.')}>Moderator reports</button>{reports.map(r => <article className="text-xs rounded-lg bg-slate-950 p-2" key={r.id}><p>{r.broadcast_key}: {r.reason}</p><div className="flex flex-wrap gap-3 mt-2">{(r.comment_id ? ['hide', 'mute', 'resolve'] : ['resolve']).map(action => <button key={action} disabled={busy} onClick={() => void act(async () => { await apiPost('/api/tv/moderate', { reportId: r.id, action }); await moderation(); await load(); }, 'Moderation saved.')}>{action === 'mute' ? 'Hide & mute 24h' : action}</button>)}</div></article>)}</div>}
 </section>;
}
