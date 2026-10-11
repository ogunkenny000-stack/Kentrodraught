import React from "react";
import { Download, Share, PlusSquare, X, Check, Smartphone } from "lucide-react";

/**
 * "Install App" control. Chrome on Android rarely volunteers its install
 * banner on its own, so this surfaces the captured `beforeinstallprompt`
 * event (stashed by main.tsx before React even mounted) behind an explicit
 * button. Where no prompt is available (iOS Safari, or Chrome hasn't
 * offered one), it opens step-by-step Add-to-Home-Screen instructions
 * instead, so EVERY platform has a working path to installing the app.
 *
 * Hidden entirely when already running installed (standalone display).
 */
export function InstallAppCard({ variant = "card" }: { variant?: "card" | "menu" }) {
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches || (window.navigator as any).standalone === true);

  const [promptReady, setPromptReady] = React.useState<boolean>(() => !!(window as any).__kentroInstallPrompt);
  const [installed, setInstalled] = React.useState(false);
  const [showHelp, setShowHelp] = React.useState(false);

  React.useEffect(() => {
    const onReady = () => setPromptReady(true);
    const onDone = () => { setInstalled(true); setPromptReady(false); };
    window.addEventListener("kentro-install-ready", onReady);
    window.addEventListener("kentro-install-done", onDone);
    return () => {
      window.removeEventListener("kentro-install-ready", onReady);
      window.removeEventListener("kentro-install-done", onDone);
    };
  }, []);

  if (isStandalone || installed) return null;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  const handleInstall = async () => {
    const deferred = (window as any).__kentroInstallPrompt;
    if (deferred) {
      try {
        deferred.prompt();
        const choice = await deferred.userChoice;
        if (choice?.outcome === "accepted") setInstalled(true);
        (window as any).__kentroInstallPrompt = undefined;
        setPromptReady(false);
        return;
      } catch {
        // fall through to instructions
      }
    }
    setShowHelp(true);
  };

  const helpModal = showHelp && (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-slate-950/90" onClick={() => setShowHelp(false)}>
      <div
        className="w-full max-w-sm bg-gradient-to-b from-[#0b0e17] to-[#060810] border border-amber-500/25 rounded-3xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-black text-white uppercase tracking-wide flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-amber-400" /> Install the App
          </span>
          <button onClick={() => setShowHelp(false)} className="text-slate-500 hover:text-white transition cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        {isIOS ? (
          <ol className="flex flex-col gap-2.5 text-[12px] text-slate-300 leading-relaxed">
            <li className="flex items-start gap-2">
              <Share className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <span>Tap the <b>Share</b> button in Safari's toolbar.</span>
            </li>
            <li className="flex items-start gap-2">
              <PlusSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>Scroll down and tap <b>Add to Home Screen</b>.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>Tap <b>Add</b> — the app appears on your home screen and opens full-screen like a native app.</span>
            </li>
          </ol>
        ) : (
          <ol className="flex flex-col gap-2.5 text-[12px] text-slate-300 leading-relaxed">
            <li className="flex items-start gap-2">
              <span className="w-4 h-4 rounded bg-slate-800 text-slate-300 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">⋮</span>
              <span>Open your browser's <b>menu</b> (the ⋮ button, top right).</span>
            </li>
            <li className="flex items-start gap-2">
              <Download className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>Tap <b>Install app</b> (or <b>Add to Home screen</b>).</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>Confirm — Draught.com installs and opens full-screen with its own icon, like any other app.</span>
            </li>
          </ol>
        )}
      </div>
    </div>
  );

  if (variant === "menu") {
    return (
      <>
        <button
          onClick={handleInstall}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[11px] font-bold bg-amber-500/10 border border-amber-500/25 text-amber-400 hover:bg-amber-500 hover:text-slate-950 transition cursor-pointer"
        >
          <Download className="w-4 h-4" />
          Install App on this device
        </button>
        {helpModal}
      </>
    );
  }

  return (
    <>
      <div className="bg-gradient-to-r from-amber-500/15 to-slate-950 border border-amber-500/30 rounded-2xl p-3.5 flex items-center gap-3">
        <div className="p-2.5 bg-amber-500/15 rounded-xl shrink-0">
          <Smartphone className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[12px] font-black text-slate-100 block">Get the app</span>
          <span className="text-[10px] text-slate-400 leading-snug block">
            {promptReady ? "One tap installs Draught.com on your home screen." : "Add Draught.com to your home screen — plays full-screen, loads instantly."}
          </span>
        </div>
        <button
          onClick={handleInstall}
          className="shrink-0 bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-black px-3.5 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5" /> Install
        </button>
      </div>
      {helpModal}
    </>
  );
}
