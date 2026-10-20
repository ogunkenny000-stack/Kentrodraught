import React, { useEffect, useState } from 'react';
import { apiGet } from '../apiClient';
export function TVTournaments({ onWatch, onReplay, refreshSerial = 0 }: {
    refreshSerial?: number;
    onWatch: (room: string) => void;
    onReplay: (code: string) => void;
}) {
    const [tournaments, setTournaments] = useState<any[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
    useEffect(() => { let active = true; const load = async () => { try {
        const d = await apiGet('/api/tv/tournaments');
        if (active) {
            setTournaments(d.tournaments || []);
            setError('');
        }
    }
    catch (e) {
        if (active)
            setError(e instanceof Error ? e.message : 'Tournament feed unavailable.');
    }
    finally {
        if (active)
            setLoading(false);
    } }; void load(); const timer = setInterval(() => { if (!document.hidden)
        void load(); }, 30000); return () => { active = false; clearInterval(timer); }; }, [refreshSerial]);
    return <div className="space-y-4">{error && <p role="alert">{error}</p>}{!tournaments.length && <p className="p-8 text-center">{loading ? 'Loading tournaments…' : 'No public tournament broadcasts yet.'}</p>}{tournaments.map(t => <article key={t.id} className="rounded-2xl border border-slate-700 bg-slate-900 p-4 space-y-3"><h2 className="font-bold">{t.name} <span className="text-xs text-amber-300">{t.status}</span></h2><div className="grid gap-4 md:grid-cols-2"><div><h3 className="text-sm font-bold mb-2">Standings</h3><ol className="space-y-1 text-sm">{t.standings.slice(0, 30).map((p: any, i: number) => <li className="flex justify-between" key={p.username}><span>{i + 1}. {p.username}</span><span>{p.points} points</span></li>)}</ol>{!t.standings.length && <p className="text-xs text-slate-400">Standings appear when play starts.</p>}</div><div><h3 className="text-sm font-bold mb-2">Fixtures & results</h3><div className="space-y-2 max-h-80 overflow-auto">{t.matches.map((m: any) => <div key={m.id} className="rounded-lg bg-slate-950 p-2 text-xs"><p>Round {m.round}: {m.white} vs {m.black}</p><p>{m.status}{m.winner ? ` · ${m.winner === 'D' ? 'Draw' : m.winner === 'W' ? m.white : m.black}` : ''}</p>{m.status === 'playing' && m.roomId && <button className="underline mt-1" onClick={() => onWatch(m.roomId)}>Watch featured board</button>}{m.status === 'completed' && m.gameCode && <button className="underline mt-1" onClick={() => onReplay(m.gameCode)}>Replay match</button>}</div>)}</div></div></div></article>)}</div>;
}
