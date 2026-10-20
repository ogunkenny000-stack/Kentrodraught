import React, { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../apiClient';
import { BoardReplay } from './TVBoard';
import { TVCommunity } from './TVCommunity';
const clock = (v: number) => Number.isFinite(v) ? `${Math.floor(Math.max(0, v) / 60)}:${String(Math.floor(Math.max(0, v)) % 60).padStart(2, '0')}` : '—';
export function TVLive({ lowData, initialRoom, onReplay, refreshSerial = 0 }: {
    refreshSerial?: number;
    lowData: boolean;
    initialRoom?: string;
    onReplay: (code: string) => void;
}) {
    const [followName, setFollowName] = useState('');
    const [rooms, setRooms] = useState<any[]>([]), [roomId, setRoomId] = useState(initialRoom || ''), [follows, setFollows] = useState<string[]>([]), [message, setMessage] = useState(''), [loading, setLoading] = useState(true), [delay, setDelay] = useState(30), [arrows, setArrows] = useState<number[][]>([]), [drawing, setDrawing] = useState(false), [origin, setOrigin] = useState<number | null>(null);
    useEffect(() => { let active = true, inFlight = false; const load = async () => { if (inFlight || document.hidden)
        return; inFlight = true; try {
        const d = await apiGet('/api/tv/live');
        if (active) {
            setRooms(d.rooms || []);
            setDelay(d.delaySeconds || 30);
            setMessage('');
        }
    }
    catch (e) {
        if (active)
            setMessage(e instanceof Error ? e.message : 'Live feed unavailable.');
    }
    finally {
        inFlight = false;
        if (active)
            setLoading(false);
    } }; void load(); void apiGet('/api/tv/follows').then(d => { if (active)
        setFollows((d.follows || []).map((f: any) => f.player_name)); }).catch(() => { }); const timer = setInterval(() => void load(), lowData ? 30000 : 5000); return () => { active = false; clearInterval(timer); }; }, [lowData, refreshSerial]);
    useEffect(() => { setArrows([]); setDrawing(false); setOrigin(null); }, [roomId]);
    const follow = async (player: string) => { try {
        const name = player.toLowerCase(), following = !follows.includes(name);
        await apiPost('/api/tv/follows', { player, following });
        setFollows(previous => following ? [...previous, name] : previous.filter(p => p !== name));
        setMessage(following ? 'Following. You’ll receive a notification when this player starts a public broadcast.' : 'Player unfollowed.');
    }
    catch (e) {
        setMessage(e instanceof Error ? e.message : 'Could not update follows.');
    } };
    const room = rooms.find(r => r.roomId === roomId), snapshot = room?.snapshot;
    useEffect(() => { setArrows([]); setDrawing(false); setOrigin(null); }, [roomId, snapshot?.ply]);
    return <div className="space-y-4"><p className="text-xs text-slate-400">Public board broadcasts · {delay}s server delay · {lowData ? 'Low data: updates every 30s' : 'Updates every 5s'} · No live engine suggestions</p>{message && <p role="status" className="text-sm text-amber-200">{message}</p>}
 <form className="flex flex-wrap gap-2 items-center" onSubmit={e => { e.preventDefault(); const name = followName.trim(); if (!name)
        return; if (follows.includes(name.toLowerCase())) {
        setMessage('You already follow this player.');
        return;
    } void follow(name); setFollowName(''); }}><label htmlFor="tv-follow-name" className="text-xs">Follow a player</label><input id="tv-follow-name" placeholder="Registered username" value={followName} onChange={e => setFollowName(e.target.value)} maxLength={60} className="min-w-0 rounded-xl bg-slate-900 border border-slate-700 p-2 text-sm"/><button className="text-xs underline" disabled={!followName.trim()}>Follow</button></form>
 {roomId && (!room || !snapshot) && <div className="rounded-2xl border border-slate-700 p-5"><p>{room ? 'The broadcast is warming up. The first delayed position will appear shortly.' : 'This public broadcast has ended or is unavailable.'}</p>{room && <button className="underline text-xs mt-3" onClick={() => onReplay(room.gameCode)}>Check completed replay</button>}<button className="underline text-xs ml-4" onClick={() => setRoomId('')}>All broadcasts</button></div>}
 {snapshot && <section className="space-y-3"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-bold">{room.white} ({room.whiteRating ?? 'unrated'}) vs {room.black} ({room.blackRating ?? 'unrated'})</h2><button className="text-xs underline" onClick={() => setRoomId('')}>All broadcasts</button></div><div className="flex justify-between text-sm font-mono"><span>{room.white}: {snapshot.timed===false?'Untimed':clock(snapshot.whiteTime)}</span><span>{room.black}: {snapshot.timed===false?'Untimed':clock(snapshot.blackTime)}</span></div><p className="text-xs text-slate-400">{snapshot.capturedAt?`Broadcast sample: ${new Date(snapshot.capturedAt).toLocaleTimeString()}`:"Delayed board sample"}</p><p className="text-xs">{snapshot.phase} · {snapshot.spectatorCount} arena spectators · {room.white} {snapshot.score?.[room.white] || 0}–{snapshot.score?.[room.black] || 0} {room.black} · Move {Math.ceil(snapshot.ply / 2)}</p><div className="mx-auto max-w-[540px]"><BoardReplay board={snapshot.board} lastMove={snapshot.lastMove} arrows={arrows} onSquare={drawing ? sq => { if (origin === null)
        setOrigin(sq);
    else {
        if (origin !== sq)
            setArrows(a => [...a, [origin, sq]].slice(-6));
        setOrigin(null);
    } } : undefined}/></div>{drawing && <p className="text-xs text-amber-300">Tap the start and end squares for an arrow.</p>}<TVCommunity key={room.gameCode} gameKey={room.gameCode} ply={snapshot.ply} live arrows={arrows} onDraw={() => setDrawing(v => !v)} onShowArrows={setArrows} onClear={() => { setArrows([]); setDrawing(false); setOrigin(null); }}/><button className="text-xs underline" onClick={() => onReplay(room.gameCode)}>Open completed replay when available</button></section>}
 <div className="grid gap-3 md:grid-cols-2">{rooms.map(r => <article key={r.roomId} className="rounded-2xl border border-slate-700 bg-slate-900 p-4 space-y-3"><p className="text-xs text-red-300">● ON AIR · {r.delaySeconds}s delay {r.tournamentId ? '· Tournament' : ''}</p><h3 className="font-bold break-words">{r.white} ({r.whiteRating ?? 'unrated'}) vs {r.black} ({r.blackRating ?? 'unrated'})</h3><div className="flex flex-wrap gap-3 text-xs">{[r.white, r.black].map((p: string) => <button key={p} onClick={() => void follow(p)} className="underline">{follows.includes(p.toLowerCase()) ? 'Unfollow' : 'Follow'} {p}</button>)}</div><button className="rounded-xl bg-amber-500 text-slate-950 font-bold px-4 py-2 text-sm" onClick={() => { setRoomId(r.roomId); window.history.replaceState(null, '', `?tvRoom=${encodeURIComponent(r.roomId)}`); }}>Watch delayed broadcast</button></article>)}</div>
 {!rooms.length && !roomId && <p className="rounded-2xl border border-dashed border-slate-700 p-8 text-center">{loading ? 'Loading broadcasts…' : 'No public broadcasts right now. Try a replay or return later.'}</p>}{follows.length > 0 && <details className="text-xs"><summary>Following {follows.length} players</summary><div className="flex flex-wrap gap-3 mt-2">{follows.map(p => <button key={p} onClick={() => void follow(p)}>Unfollow {p}</button>)}</div></details>}
 </div>;
}
