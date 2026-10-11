import { Component, ReactNode } from "react";
import { RefreshCw, AlertTriangle, Plus } from "lucide-react";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

/**
 * Last line of defense: any uncaught render/runtime error anywhere in the
 * tree lands here instead of a silent white screen. The player gets a
 * clear card and a one-tap reload; the error is logged for diagnosis.
 * Game state that matters (AI games, tournaments) is already persisted to
 * localStorage by the app, so a reload resumes rather than loses the game.
 *
 * BUT: if the crash was actually CAUSED by that persisted state (a
 * corrupted/desynced saved AI game, say), "Reload app" alone resumes the
 * exact same broken state and immediately re-throws -- an unrecoverable
 * loop for that player, no matter how many times they reload. "New Game"
 * clears the auto-resume flags first, so a reload lands on a clean slate
 * instead of walking straight back into the same error.
 */
export class ErrorBoundary extends Component<Props, State> {
  // This project intentionally runs React untyped (allowJs, no @types/react),
  // so the Component base class is opaque to tsc -- declare the two members
  // this class actually uses. Zero runtime cost; React provides both.
  declare readonly props: Props;
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("Uncaught UI error:", error, info?.componentStack);
  }

  reloadApp = async () => {
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch {
      // ignore
    }
    window.location.reload();
  };

  startNewGame = async () => {
    try {
      // Same keys the app itself uses to auto-resume on load/mode-change
      // (see AI_GAME_STORAGE_KEY and the tournament-resume flags in
      // App.tsx) -- clearing them means the next load can't walk straight
      // back into whatever state just crashed it. Tournament round/points/
      // history are left alone; only the "there's a game to resume" flags
      // get cleared, so no progress is lost, just the stuck resume.
      localStorage.removeItem("kentro_ai_game_in_progress");
      localStorage.setItem("lidraughts_tournament_game_in_progress", "false");
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch {
      // Same private-browsing/quota caveat as everywhere else this is used.
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-rose-400" />
          </div>
          <div>
            <div className="text-slate-100 font-extrabold text-base">Something went wrong</div>
            <p className="text-slate-400 text-xs mt-1 leading-relaxed">
              An unexpected error interrupted the app. Your games are saved —
              reloading will pick up where you left off.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full">
            <button
              onClick={this.reloadApp}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm transition cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" /> Reload app
            </button>
            <button
              onClick={this.startNewGame}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-extrabold text-sm transition cursor-pointer"
            >
              <Plus className="w-4 h-4" /> New Game
            </button>
          </div>
          <p className="text-[10px] text-slate-500 -mt-1">
            Still stuck after reloading? New Game clears the saved-in-progress game and starts clean.
          </p>
          <div className="text-[9px] text-slate-600 font-mono break-all">{String(this.state.error?.message || this.state.error)}</div>
        </div>
      </div>
    );
  }
}
