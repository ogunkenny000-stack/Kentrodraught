import React from "react";
import {
  Menu, Sparkles, ArrowLeft, BookOpen, Trophy, Crown, Settings as SettingsIcon,
  Volume2, VolumeX, TrendingUp, Puzzle as PuzzleIcon,
} from "lucide-react";
import { PlayMode } from "../../types";
import { Move } from "../../gameLogic";

export interface TopNavProps {
  isMobile: boolean;
  playMode: PlayMode;
  unreadLoungeCount: number;
  moveHistory: Move[];
  muted: boolean;
  setMuted: React.Dispatch<React.SetStateAction<boolean>>;
  handleModeChange: (mode: PlayMode) => void;
  setIsLeftDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showAdmin?: boolean;
  onOpenAdmin?: () => void;
  setIsRightDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShowAppGuideModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowSettingsModal: React.Dispatch<React.SetStateAction<boolean>>;
  /** mobile scorecard drawer opener is hidden in these modes */
  showMobileDeskButton: boolean;
}

/** Global top navigation bar (logo, mode badge, quick actions). */
export function TopNav({
  isMobile, playMode, unreadLoungeCount, moveHistory, muted, setMuted,
  handleModeChange, setIsLeftDrawerOpen,
  showAdmin = false,
  onOpenAdmin, setIsRightDrawerOpen,
  setShowAppGuideModal, setShowSettingsModal, showMobileDeskButton,
}: TopNavProps) {
  return (
    <header className="w-full flex items-center justify-between border-b border-slate-900/90 bg-slate-950/95 px-3 sm:px-5 py-2.5 sm:py-3.5 pt-[max(0.6rem,env(safe-area-inset-top))] shrink-0 select-none z-40 transition-all overflow-hidden">
      <div className="flex items-center gap-2 min-w-0 shrink">
        {/* Menu Drawer Button for Mobile */}
        {isMobile && (
          <button
            onClick={() => setIsLeftDrawerOpen(true)}
            className="relative p-2 -ml-0.5 hover:bg-slate-900 active:scale-95 rounded-xl text-slate-300 hover:text-white transition cursor-pointer shrink-0 border border-slate-800/80"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5 text-amber-500" />
            {unreadLoungeCount > 0 && (
              <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-slate-950 animate-pulse" />
            )}
          </button>
        )}

        {/* Logo Wordmark */}
        <button
          onClick={() => handleModeChange("Home")}
          className="text-xs sm:text-sm font-black tracking-widest text-slate-100 uppercase flex items-center gap-1.5 shrink-0 cursor-pointer hover:opacity-90 transition active:scale-95 whitespace-nowrap"
        >
          <Sparkles className="w-4 h-4 text-amber-500 animate-pulse shrink-0" />
          <span className="font-sans">draught<span className="text-amber-500">.com</span></span>
        </button>

        {/* Current PlayMode Badge */}
        <span className="hidden md:inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 truncate font-sans">
          {playMode === "Human_vs_AI" ? "Play vs AI" :
           playMode === "AI_vs_Human" ? "Play vs AI (Black)" :
           playMode === "AI_vs_AI" ? "AI Duel" :
           playMode === "Analysis" ? "Analysis Board" : playMode === "Training" ? "Training Game" :
           playMode === "Editor" ? "Position Editor" :
           playMode === "Global_Chat" ? "Grandmaster's Lounge" :
           playMode === "Tournament" ? "🏆 Tournament" :
           playMode === "Puzzles" ? "🧩 Weekly Puzzles" :
           playMode === "Home" ? "Home" :
           "Online Arena"}
        </span>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Back to Home Button (Only on desktop screens, since GameScreen on mobile has its own back button) */}
        {!isMobile && playMode !== "Home" && (
          <button
            onClick={() => handleModeChange("Home")}
            className="flex items-center gap-1 px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-xl text-xs font-extrabold text-amber-400 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 active:scale-95 transition cursor-pointer shrink-0 shadow-sm font-sans"
            title="Return to Home Dashboard"
          >
            <ArrowLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400" />
            <span className="text-[11px] sm:text-xs font-bold whitespace-nowrap">Back</span>
          </button>
        )}

        {/* App Guide Button */}
        <button
          onClick={() => setShowAppGuideModal(true)}
          className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 transition cursor-pointer font-sans"
          title="App Guide: Shows everything the app entails"
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Guide</span>
        </button>

        {/* Puzzles Mode Button */}
        <button
          onClick={() => handleModeChange("Puzzles")}
          className={`hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition cursor-pointer font-sans ${
            playMode === "Puzzles"
              ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
              : "text-slate-300 bg-slate-900 border border-slate-800 hover:text-white hover:bg-slate-800"
          }`}
        >
          <PuzzleIcon className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden sm:inline">Puzzles</span>
        </button>

        {/* Tournament Mode Button */}
        <button
          onClick={() => handleModeChange("Tournament")}
          className={`hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition cursor-pointer font-sans ${
            playMode === "Tournament"
              ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
              : "text-slate-300 bg-slate-900 border border-slate-800 hover:text-white hover:bg-slate-800"
          }`}
        >
          <Trophy className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Tournament</span>
        </button>

        {showAdmin && (
          <button
            onClick={onOpenAdmin}
            className="p-1.5 sm:p-2 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-400 hover:bg-amber-500/20 active:scale-95 transition cursor-pointer"
            title="Admin Panel"
          >
            <Crown className="w-4 h-4" />
          </button>
        )}
        {/* Settings Button */}
        <button
          onClick={() => setShowSettingsModal(true)}
          className="flex items-center justify-center p-1.5 sm:p-2 rounded-xl text-slate-300 bg-slate-900 border border-slate-800/80 hover:text-white hover:bg-slate-800 active:scale-95 transition cursor-pointer"
          title="Custom Themes & Settings"
        >
          <SettingsIcon className="w-4 h-4" />
        </button>

        {/* Sound Effects Quick Toggle */}
        <button
          onClick={() => setMuted(!muted)}
          className={`flex items-center justify-center p-1.5 sm:p-2 rounded-xl transition cursor-pointer border active:scale-95 ${
            !muted
              ? "text-amber-400 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20"
              : "text-slate-400 bg-slate-900 border-slate-800 hover:text-white hover:bg-slate-800"
          }`}
          title={!muted ? "Silence Sound Effects" : "Enable Sound Effects"}
        >
          {!muted ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-rose-400" />}
        </button>

        {/* Right Drawer Toggle for Mobile (Stats and Move Log) */}
        {isMobile && showMobileDeskButton && (
          <button
            onClick={() => setIsRightDrawerOpen(true)}
            className="p-1.5 sm:p-2 hover:bg-slate-900/80 active:scale-95 rounded-xl text-slate-300 hover:text-white transition relative cursor-pointer border border-slate-800/50"
            aria-label="Open scorecard"
          >
            <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500" />
            {moveHistory.length > 0 && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-500" />
            )}
          </button>
        )}
      </div>
    </header>
  );
}
