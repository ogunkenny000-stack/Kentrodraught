import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Download, X, Share, PlusSquare } from "lucide-react";

// Not in lib.dom.d.ts -- this event is Chromium-only and non-standard.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own (non-standard) flag for "already added to home screen"
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// iOS Safari never fires beforeinstallprompt, and Apple has no programmatic
// install API at all -- still just a pending WebKit standards-positions
// request as of 2026 (github.com/WebKit/standards-positions/issues/619).
// Share -> Add to Home Screen is a manual, physical step nothing can skip.
// Chrome/Firefox/in-app browsers on iOS can't install a PWA at all, even
// manually (Safari-only) -- so only true iOS Safari gets the guide below;
// everything else on iOS has no install path to show.
function isIosSafari(): boolean {
  const ua = window.navigator.userAgent;
  const isIpadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const isIosDevice = /iPad|iPhone|iPod/.test(ua) || isIpadOS;
  if (!isIosDevice) return false;
  const isOtherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram|Twitter|Line\//i.test(ua);
  return !isOtherIosBrowser;
}

// Fixed, persistent install button -- deliberately not dismissible/snoozable.
// Only ever rendered at all once we know there's a real install path
// (native prompt available, or iOS Safari's manual one); otherwise nothing
// mounts, so there's no dead button sitting on screen for visitors who have
// no way to install at all (desktop Firefox, iOS Chrome, in-app browsers).
export default function InstallAppPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // iOS Safari: the event above will never fire -- show the manual-guide
    // version immediately instead of waiting for something that never comes.
    if (isIosSafari()) setVisible(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      // The real, native install prompt -- one tap, no screen of our own first.
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") setVisible(false);
      setDeferredPrompt(null);
      return;
    }
    // No programmatic path exists on iOS Safari -- this is the fastest
    // honest option: two steps, real icons, nothing to read.
    setShowIosSteps(true);
  };

  return (
    <>
      <AnimatePresence>
        {visible && !showIosSteps && (
          <motion.button
            onClick={handleInstallClick}
            initial={{ opacity: 0, y: 24, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.9 }}
            whileTap={{ scale: 0.94 }}
            transition={{ type: "spring", stiffness: 300, damping: 24 }}
            className="fixed z-40 flex items-center gap-2 pl-3 pr-4 py-3 rounded-full bg-gradient-to-r from-amber-500 to-amber-400 text-slate-950 font-black text-xs tracking-tight shadow-[0_6px_28px_-4px_rgba(245,158,11,0.65)] cursor-pointer select-none active:brightness-95"
            style={{
              bottom: "calc(1rem + env(safe-area-inset-bottom))",
              right: "calc(1rem + env(safe-area-inset-right))",
            }}
            aria-label="Download Kentro Draught app"
          >
            <span className="relative flex h-6 w-6 items-center justify-center shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-slate-950/25" />
              <Download className="relative w-4 h-4 stroke-[3]" />
            </span>
            Download App
          </motion.button>
        )}
      </AnimatePresence>

      {/* iOS manual steps -- Apple provides no API for a website to trigger
          installation itself; "Share -> Add to Home Screen" is the only
          path, and it requires the person to do it themselves. This overlay
          makes those two steps as fast and clear as possible, which is the
          honest ceiling of what's automatable on iOS. */}
      <AnimatePresence>
        {showIosSteps && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowIosSteps(false)}
            className="fixed inset-0 bg-slate-950/95 flex items-end sm:items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-5 relative shadow-2xl"
            >
              <button
                onClick={() => setShowIosSteps(false)}
                className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 cursor-pointer"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex flex-col items-center text-center gap-2 pt-2">
                <img src="/icon-192.png" alt="" className="w-14 h-14 rounded-2xl" />
                <h3 className="text-sm font-black text-white uppercase tracking-wide">Add to Home Screen</h3>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 bg-slate-950 border border-slate-800 rounded-xl p-3">
                  <div className="w-7 h-7 rounded-full bg-amber-500 text-slate-950 font-black text-xs flex items-center justify-center shrink-0">1</div>
                  <Share className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-xs text-slate-200">Tap <strong>Share</strong> in Safari's toolbar</span>
                </div>
                <div className="flex items-center gap-3 bg-slate-950 border border-slate-800 rounded-xl p-3">
                  <div className="w-7 h-7 rounded-full bg-amber-500 text-slate-950 font-black text-xs flex items-center justify-center shrink-0">2</div>
                  <PlusSquare className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-xs text-slate-200">Tap <strong>Add to Home Screen</strong></span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
