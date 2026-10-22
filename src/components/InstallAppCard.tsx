import React, { useSyncExternalStore, useState } from 'react';
import { Download, Smartphone } from 'lucide-react';
import { getInstallState, subscribeInstall, requestPwaInstall, installPlatform } from '../lib/pwaInstall';
import { ModalShell } from './ui/ModalShell';
export function InstallAppCard({ variant = 'card' }: { variant?: 'card' | 'menu' | 'compact' }) {
  const state = useSyncExternalStore(subscribeInstall, getInstallState, getInstallState);
  const [help, setHelp] = useState(false);
  if (state.hidden) return null;
  const install = async () => { if (await requestPwaInstall() === 'help') setHelp(true); };
  const platform = installPlatform();
  const button = <button type="button" disabled={state.busy} onClick={() => void install()} aria-label="Install Kentro app"
    className={`inline-flex items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/15 text-amber-300 font-bold text-xs px-3 py-2.5 shrink-0 ${variant === 'menu' ? 'w-full' : ''}`}>
    <Download size={16} aria-hidden="true"/>{state.busy ? 'Opening…' : 'Install App'}
  </button>;
  return <>{variant === 'card' ? <div className="rounded-2xl border border-amber-500/25 bg-slate-900 p-4 flex flex-wrap items-center gap-3">
    <Smartphone size={22} className="text-amber-400" aria-hidden="true"/><div className="flex-1 min-w-0"><strong className="block text-sm text-slate-100">Kentro on your home screen</strong><p className="text-xs text-slate-300">Open the app directly, without searching for the website.</p></div>{button}</div> : button}
    <ModalShell open={help} onClose={() => setHelp(false)} title="Install Kentro" size="sm">
      {platform === 'ios' ? <ol className="list-decimal pl-5 space-y-3 text-sm text-slate-200"><li>Open this website in Safari if your browser has no install option.</li><li>Tap Share, then Add to Home Screen.</li><li>Keep Open as Web App enabled if shown, then tap Add.</li></ol>
      : platform === 'android' ? <ol className="list-decimal pl-5 space-y-3 text-sm text-slate-200"><li>Open this website in Chrome.</li><li>Open the browser menu (⋮).</li><li>Choose Install app or Add to Home screen, then confirm.</li></ol>
      : <p className="text-sm text-slate-200">In Chrome or Edge, open the browser menu and look for Install Kentro or Install this page as an app. If your browser does not offer installation, open this website in Chrome or Edge.</p>}
      <p className="mt-4 text-xs text-slate-300">Offline play needs its game files downloaded too. Check the offline status before disconnecting.</p>
    </ModalShell>
  </>;
}
