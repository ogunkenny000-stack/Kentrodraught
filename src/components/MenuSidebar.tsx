import React from "react";
import { PlayMode, BoardTheme, BOARD_THEMES } from "../types";
import { KEN_LEVELS } from "../lib/constants";
import { 
  Trophy, Cpu, User, Compass, Swords, Settings, Crown,
  Volume2, VolumeX, BookOpen, Palette, Clock, Check, MessageSquare,
  PuzzleIcon, GraduationCap, Users, ShoppingBag, UsersRound
} from "lucide-react";

interface MenuSidebarProps {
  activeMode: PlayMode;
  onSelectMode: (mode: PlayMode) => void;
  onOpenFriends: () => void;
  onOpenProfile: () => void;
  onOpenStore: () => void;
  onOpenPlayers: () => void;
  /** whoami says this signed-in account is an admin -> show the button. */
  showAdmin?: boolean;
  onOpenAdmin?: () => void;
  unreadLoungeCount?: number;
  muted: boolean;
  onToggleMuted: () => void;
  onShowRules: () => void;
  boardTheme: BoardTheme;
  onSelectBoardTheme: (theme: BoardTheme) => void;
  clockLimitType: "Blitz" | "Rapid" | "Classical" | "Untimed";
  onSelectClockLimit: (type: "Blitz" | "Rapid" | "Classical" | "Untimed") => void;
  kenLevelId: number;
  onSelectKenLevel: (id: number) => void;
  boardScale: number;
  onSelectBoardScale: (scale: number) => void;
  className?: string;
}

function MenuSidebarImpl({
  activeMode,
  onSelectMode,
  onOpenFriends,
  onOpenProfile,
  onOpenStore,
  onOpenPlayers,
  showAdmin = false,
  onOpenAdmin,
  unreadLoungeCount = 0,
  muted,
  onToggleMuted,
  onShowRules,
  boardTheme,
  onSelectBoardTheme,
  clockLimitType,
  onSelectClockLimit,
  kenLevelId,
  onSelectKenLevel,
  boardScale,
  onSelectBoardScale,
  className
}: MenuSidebarProps) {
  const modesList = [
    { id: "Home" as PlayMode, label: "Lobby", icon: Crown, desc: "Your dashboard, stats, and quick play" },
    { id: "Human_vs_AI" as PlayMode, label: "Play vs Computer", icon: Cpu, desc: "Slay Ken levels 1 to 8" },
    { id: "Multiplayer" as PlayMode, label: "Online Arena", icon: Swords, desc: "Play real-time room matches" },
    { id: "Learn" as PlayMode, label: "Learn", icon: GraduationCap, desc: "Lessons and guided tactics" },
    { id: "Analysis" as PlayMode, label: "Analysis Board", icon: Compass, desc: "Free exploration & live C++ engine" },
    { id: "Tournament" as PlayMode, label: "Tournament Hub", icon: Trophy, desc: "Compete in official tournaments" },
    { id: "Puzzles" as PlayMode, label: "Puzzles", icon: PuzzleIcon, desc: "Daily tactics challenges" },
    { id: "Global_Chat" as PlayMode, label: "The Grandmaster's Lounge", icon: MessageSquare, desc: "Global chat & messages" },
    { id: "Editor" as PlayMode, label: "Position Editor", icon: Settings, desc: "Design custom board layouts" }
  ];

  return (
    <aside className={className || "w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-slate-800/80 bg-slate-950 flex flex-col p-4 shrink-0 overflow-y-auto select-none gap-4"}>
      {/* Brand Header */}
      <div className="flex items-center space-x-2.5 mb-2 shrink-0">
        <div className="p-2 bg-gradient-to-tr from-amber-600 to-amber-500 rounded-xl shadow-lg shadow-amber-500/10">
          <Crown className="w-5 h-5 text-slate-950 stroke-[2.5]" />
        </div>
        <div>
          <h2 className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5 font-sans uppercase">
            Kentro Draught
          </h2>
          <p className="text-[10px] text-slate-500 font-medium font-sans">Nigerian 10x10 Platform</p>
        </div>
      </div>

      {/* Modes Selection */}
      <div className="flex flex-col gap-1 shrink-0">
        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider font-sans mb-1 block px-1">
          Game Modes
        </span>
        {modesList.map((m) => {
          const Icon = m.icon;
          const isSelected = activeMode === m.id || 
            (m.id === "Human_vs_AI" && (activeMode === "Human_vs_AI" || activeMode === "AI_vs_Human" || activeMode === "AI_vs_AI"));
          return (
            <button
              key={m.id}
              onClick={() => onSelectMode(m.id)}
              className={`flex items-start gap-3 p-2.5 rounded-xl border text-left transition ${
                isSelected
                  ? "bg-amber-500 border-amber-400 text-slate-950 shadow-lg shadow-amber-500/5 font-bold"
                  : "bg-slate-900/40 border-slate-900 hover:bg-slate-900 hover:border-slate-800 text-slate-300"
              }`}
            >
              <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${isSelected ? "text-slate-950" : "text-amber-500"}`} />
              <div className="flex flex-col flex-1">
                <span className="text-xs font-bold leading-tight font-sans flex items-center gap-1.5">
                  {m.label}
                  {m.id === "Global_Chat" && unreadLoungeCount > 0 && (
                    <span className="bg-rose-500 text-white text-[9px] font-black rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                      {unreadLoungeCount > 9 ? "9+" : unreadLoungeCount}
                    </span>
                  )}
                </span>
                <span className={`text-[9px] mt-0.5 font-sans ${isSelected ? "text-slate-950/70" : "text-slate-500"}`}>
                  {m.desc}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Friends / Profile / Store / Players -- overlays and shortcuts, not full-screen panes */}
      <div className="grid grid-cols-4 gap-1.5 shrink-0">
        <button
          onClick={onOpenFriends}
          className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-slate-900/40 border border-slate-900 hover:bg-slate-900 hover:border-slate-800 text-slate-400 hover:text-white transition"
        >
          <Users className="w-4 h-4 text-amber-500" />
          <span className="text-[9px] font-bold font-sans">Friends</span>
        </button>
        <button
          onClick={onOpenProfile}
          className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-slate-900/40 border border-slate-900 hover:bg-slate-900 hover:border-slate-800 text-slate-400 hover:text-white transition"
        >
          <User className="w-4 h-4 text-amber-500" />
          <span className="text-[9px] font-bold font-sans">Profile</span>
        </button>
        <button
          onClick={onOpenStore}
          className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-slate-900/40 border border-slate-900 hover:bg-slate-900 hover:border-slate-800 text-slate-400 hover:text-white transition"
        >
          <ShoppingBag className="w-4 h-4 text-amber-500" />
          <span className="text-[9px] font-bold font-sans">Store</span>
        </button>
        <button
          onClick={onOpenPlayers}
          className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-slate-900/40 border border-slate-900 hover:bg-slate-900 hover:border-slate-800 text-slate-400 hover:text-white transition"
        >
          <UsersRound className="w-4 h-4 text-amber-500" />
          <span className="text-[9px] font-bold font-sans">Players</span>
        </button>
        {showAdmin && (
          <button
            onClick={onOpenAdmin}
            className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/40 hover:bg-amber-500/20 text-amber-400 transition"
            title="Admin Panel"
          >
            <Crown className="w-4 h-4 text-amber-400" />
            <span className="text-[9px] font-bold font-sans">Admin</span>
          </button>
        )}
      </div>

      {/* AI Difficulty Selector */}
      {(activeMode === "Human_vs_AI" || activeMode === "AI_vs_Human") && (
        <div className="flex flex-col gap-1.5 border-t border-slate-900 pt-3.5 shrink-0">
          <div className="flex justify-between items-center text-[10px] text-slate-500 font-bold px-1 uppercase font-sans">
            <span>AI Opponent</span>
            <span className="text-amber-400 font-mono">Ken {kenLevelId}</span>
          </div>
          <select
            value={kenLevelId}
            onChange={(e) => onSelectKenLevel(parseInt(e.target.value, 10))}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-amber-500 transition font-sans"
          >
            {KEN_LEVELS.map((level) => (
              <option key={level.id} value={level.id}>
                {level.name} ({level.depth ? `Depth ${level.depth}` : `1.2s`})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Board Visual Theme Selector */}
      <div className="flex flex-col gap-1.5 border-t border-slate-900 pt-3.5 shrink-0">
        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider font-sans px-1 block">
          Board Theme
        </span>
        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          {(Object.keys(BOARD_THEMES) as BoardTheme[]).map((thm) => {
            const colors = BOARD_THEMES[thm];
            const isSelected = boardTheme === thm;
            return (
              <button
                key={thm}
                onClick={() => onSelectBoardTheme(thm)}
                className={`py-1.5 px-2 rounded-lg border font-bold flex items-center gap-1.5 transition ${
                  isSelected
                    ? "bg-amber-500/15 border-amber-500 text-amber-400"
                    : "bg-slate-900/40 border-slate-900 text-slate-400 hover:text-white hover:border-slate-800"
                }`}
              >
                <div className={`w-3 h-3 rounded-sm ${colors.darkSquare}`} />
                <span className="font-sans truncate">{colors.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Board Size / Scale */}
      <div className="flex flex-col gap-1.5 border-t border-slate-900 pt-3.5 shrink-0 hidden lg:flex">
        <div className="flex justify-between items-center px-1">
          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider font-sans">
            Board Size
          </span>
          <span className="text-[10px] text-amber-500 font-bold font-mono">
            {boardScale}%
          </span>
        </div>
        <input
          type="range"
          min="50"
          max="200"
          value={boardScale}
          onChange={(e) => onSelectBoardScale(parseInt(e.target.value, 10))}
          className="w-full h-1.5 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-amber-500"
        />
      </div>

      {/* Floating Tactical Controls / Extra Actions */}
      <div className="flex-grow flex flex-col justify-end gap-1.5 border-t border-slate-900 pt-3.5 mt-auto">
        <button
          onClick={onShowRules}
          className="w-full py-2 px-3 bg-slate-900/40 border border-slate-900 hover:bg-slate-900 hover:border-slate-800 rounded-xl text-[11px] font-bold text-slate-400 hover:text-white transition flex items-center gap-2"
        >
          <BookOpen className="w-3.5 h-3.5 text-amber-500" />
          <span className="font-sans">Rules of Draughts</span>
        </button>

        <button
          onClick={onToggleMuted}
          className="w-full py-2 px-3 bg-slate-900/40 border border-slate-900 hover:bg-slate-900 hover:border-slate-800 rounded-xl text-[11px] font-bold text-slate-400 hover:text-white transition flex items-center gap-2"
        >
          {muted ? (
            <>
              <VolumeX className="w-3.5 h-3.5 text-rose-500" />
              <span className="font-sans">Sound: Muted</span>
            </>
          ) : (
            <>
              <Volume2 className="w-3.5 h-3.5 text-emerald-500" />
              <span className="font-sans">Sound: Enabled</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

export const MenuSidebar = React.memo(MenuSidebarImpl);
