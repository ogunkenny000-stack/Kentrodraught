import { useEffect, useState } from 'react';
import { Download, CheckCircle2, WifiOff, Cpu } from 'lucide-react';
import { readOfflineStatus, prepareOfflineFiles, type OfflineStatus } from '../lib/offlineReadiness';
export function OfflineReadyCard({ onPlay }: { onPlay?: () => void }) {
  const [state, setState] = useState<OfflineStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    let active = true, checking = false, nextCheck = 0;
    const check = async () => {
      if (checking || document.hidden || Date.now() < nextCheck) return;
      checking = true;
      try { const next = await readOfflineStatus(); if (active) { setState(old => old?.ready === next.ready && old?.missing === next.missing && old?.preparing === next.preparing ? old : next); setError(''); nextCheck = Date.now() + (next.ready ? 60_000 : 5_000); } }
      catch (e) { if (active) setError(e instanceof Error ? e.message : 'Offline files are not ready.'); }
      finally { checking = false; }
    };
    const connection = () => { nextCheck = 0; setOnline(navigator.onLine); void check(); };
    void check();
    const timer = setInterval(() => void check(), 5_000);
    navigator.serviceWorker?.addEventListener('controllerchange', connection);
    window.addEventListener('online', connection); window.addEventListener('offline', connection);
    return () => { active = false; clearInterval(timer); navigator.serviceWorker?.removeEventListener('controllerchange', connection); window.removeEventListener('online', connection); window.removeEventListener('offline', connection); };
  }, []);
  const prepare = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { const next = await prepareOfflineFiles(); setState(next); if (!next.ready && !next.preparing) setError('Some files are still missing. Check your connection and storage, then retry.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save offline files.'); }
    finally { setBusy(false); }
  };
  return <section className="rounded-2xl border border-slate-700 bg-slate-900 p-4 flex flex-wrap items-center gap-3" aria-label="Offline engine readiness">
    {state?.ready ? <CheckCircle2 className="text-emerald-300 shrink-0" size={20}/> : <WifiOff className="text-amber-300 shrink-0" size={20}/>}
    <div className="flex-1 min-w-0"><strong className="block text-sm text-slate-100" role="status">{state?.ready ? 'Offline engine files ready' : busy ? 'Downloading offline files…' : 'Prepare Ken for offline play'}</strong>
    <p className="text-xs text-slate-300 mt-1">{error || (state?.ready ? 'Ken runs on this device. No internet is needed for offline practice.' : !online ? 'Reconnect once to finish saving the offline files.' : state?.preparing ? 'Offline support is starting. Keep the app open while files download.' : state?.missing ? `${state.missing} ${state.missing === 1 ? "file still needs" : "files still need"} to download. Keep this page open.` : 'Download the game and engine before disconnecting.')}</p></div>
    {!state?.ready && <button type="button" disabled={busy || !online} onClick={() => void prepare()} className="rounded-xl border border-amber-500/40 px-3 py-2 text-xs font-bold text-amber-300 disabled:opacity-50 inline-flex items-center gap-2"><Download size={15}/>{busy ? 'Downloading…' : 'Prepare offline play'}</button>}
    {onPlay && <button type="button" onClick={onPlay} className="rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-slate-950 inline-flex items-center gap-2"><Cpu size={15}/>Play Ken Offline</button>}
  </section>;
}
