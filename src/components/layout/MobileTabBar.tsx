import { Home, Swords, Cpu, Trophy, MessagesSquare } from "lucide-react";
import { PlayMode } from "../../types";

export interface MobileTabBarProps {
  playMode: PlayMode;
  unreadLoungeCount: number;
  onSelectMode: (mode: PlayMode) => void;
  /** Center action: jump straight into a game vs the Ken engine */
  onPlayVsAI: () => void;
}

const TAB_BASE =
  "flex-1 h-full flex flex-col items-center justify-center gap-0.5 text-[9px] font-bold transition cursor-pointer select-none";

/**
 * Native-app style bottom navigation for phones. Gives the five main
 * destinations a permanent, thumb-reachable home (previously everything
 * lived behind the hamburger drawer). Rendered in normal layout flow (not
 * fixed) so it can never cover the board, and hidden entirely during live
 * board play where vertical space matters most.
 */
export function MobileTabBar({ playMode, unreadLoungeCount, onSelectMode, onPlayVsAI }: MobileTabBarProps) {
  const isPlayModeAI = playMode === "Human_vs_AI" || playMode === "AI_vs_Human" || playMode === "AI_vs_AI";

  return (
    <nav className="lg:hidden shrink-0 z-40 bg-slate-950/95 backdrop-blur-lg border-t border-slate-900/90 h-[3.6rem] pb-[env(safe-area-inset-bottom)] box-content flex items-stretch shadow-[0_-8px_24px_rgba(0,0,0,0.5)]">
      <button
        onClick={() => onSelectMode("Home")}
        className={`${TAB_BASE} ${playMode === "Home" ? "text-amber-400 font-extrabold" : "text-slate-400 hover:text-slate-200"}`}
      >
        <Home className={`w-5 h-5 transition-transform ${playMode === "Home" ? "scale-110 text-amber-400" : ""}`} />
        <span className="font-sans text-[9px] tracking-tight">Home</span>
      </button>

      <button
        onClick={() => onSelectMode("Multiplayer")}
        className={`${TAB_BASE} ${playMode === "Multiplayer" ? "text-amber-400 font-extrabold" : "text-slate-400 hover:text-slate-200"}`}
      >
        <Swords className={`w-5 h-5 transition-transform ${playMode === "Multiplayer" ? "scale-110 text-amber-400" : ""}`} />
        <span className="font-sans text-[9px] tracking-tight">Arena</span>
      </button>

      {/* Prominent center Play action */}
      <button onClick={onPlayVsAI} className={`${TAB_BASE} relative`} aria-label="Play vs AI">
        <span
          className={`w-11 h-11 -mt-5 rounded-2xl flex items-center justify-center shadow-xl border transition-all ${
            isPlayModeAI
              ? "bg-amber-400 border-amber-300 text-slate-950 shadow-amber-500/40 scale-105"
              : "bg-gradient-to-tr from-amber-500 to-amber-400 border-amber-300 text-slate-950 shadow-amber-500/30 active:scale-95 hover:scale-105"
          }`}
        >
          <Cpu className="w-5 h-5 stroke-[2.5]" />
        </span>
        <span className={`font-sans text-[9px] font-black tracking-tight ${isPlayModeAI ? "text-amber-400" : "text-slate-400"}`}>
          VS AI
        </span>
      </button>

      <button
        onClick={() => onSelectMode("Tournament")}
        className={`${TAB_BASE} ${playMode === "Tournament" ? "text-amber-400 font-extrabold" : "text-slate-400 hover:text-slate-200"}`}
      >
        <Trophy className={`w-5 h-5 transition-transform ${playMode === "Tournament" ? "scale-110 text-amber-400" : ""}`} />
        <span className="font-sans text-[9px] tracking-tight">Events</span>
      </button>

      <button
        onClick={() => onSelectMode("Global_Chat")}
        className={`${TAB_BASE} relative ${playMode === "Global_Chat" ? "text-amber-400 font-extrabold" : "text-slate-400 hover:text-slate-200"}`}
      >
        <span className="relative">
          <MessagesSquare className={`w-5 h-5 transition-transform ${playMode === "Global_Chat" ? "scale-110 text-amber-400" : ""}`} />
          {unreadLoungeCount > 0 && (
            <span className="absolute -top-1 -right-2 min-w-3.5 h-3.5 px-1 rounded-full bg-rose-500 text-white text-[8px] font-black flex items-center justify-center border border-slate-950 shadow-sm animate-pulse">
              {unreadLoungeCount > 9 ? "9+" : unreadLoungeCount}
            </span>
          )}
        </span>
        <span className="font-sans text-[9px] tracking-tight">Lounge</span>
      </button>
    </nav>
  );
}
