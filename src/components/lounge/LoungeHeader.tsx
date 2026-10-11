import React from "react";
import { ArrowLeft, Crown, Users, Plus, Shield, Search } from "lucide-react";
import type { PlayerStats } from "../../types";
import { getRankBadge } from "./constants";

interface LoungeHeaderProps {
  username: string;
  profileStats?: PlayerStats;
  totalUnreadCount: number;
  onBackToHome?: () => void;
  onOpenMyProfile: () => void;
  onOpenCreateGroup: () => void;
  onOpenNewChat: () => void;
}

export const LoungeHeader: React.FC<LoungeHeaderProps> = ({
  username,
  profileStats,
  totalUnreadCount,
  onBackToHome,
  onOpenMyProfile,
  onOpenCreateGroup,
  onOpenNewChat
}) => {
  const rank = getRankBadge(profileStats?.elo || 1500);

  return (
    <header className="h-16 px-4 bg-slate-950/90 border-b border-amber-500/20 flex items-center justify-between shrink-0 select-none backdrop-blur-md z-20">
      {/* Left: Home Return + Brand Title */}
      <div className="flex items-center gap-3">
        {onBackToHome && (
          <button
            onClick={onBackToHome}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs font-bold text-amber-400 hover:bg-slate-850 hover:text-amber-300 transition cursor-pointer shrink-0"
            title="Return to Main Arena"
          >
            <ArrowLeft className="w-4 h-4 text-amber-400" />
            <span className="hidden sm:inline">Home</span>
          </button>
        )}

        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-900/30 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-inner">
            <Crown className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-black tracking-wider text-white uppercase font-sans">
                Grandmaster Lounge
              </h1>
              {totalUnreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black font-mono animate-pulse">
                  {totalUnreadCount}
                </span>
              )}
            </div>
            <span className="text-[10px] text-amber-400/80 font-mono font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Direct Network Online</span>
            </span>
          </div>
        </div>
      </div>

      {/* Right: Actions & User Profile */}
      <div className="flex items-center gap-2">
        {/* Quick New Group button */}
        <button
          onClick={onOpenCreateGroup}
          className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-amber-500/40 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition cursor-pointer"
          title="Create Tactical Group"
        >
          <Users className="w-3.5 h-3.5 text-amber-400" />
          <span>New Group</span>
        </button>

        {/* Quick New Chat button */}
        <button
          onClick={onOpenNewChat}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs transition cursor-pointer shadow-md shadow-amber-500/10"
          title="Message a Player"
        >
          <Plus className="w-3.5 h-3.5 stroke-[3]" />
          <span className="hidden sm:inline">New Chat</span>
        </button>

        {/* User Profile Mini Badge */}
        <button
          onClick={onOpenMyProfile}
          className="flex items-center gap-2 p-1.5 sm:px-3 sm:py-1.5 bg-slate-900/80 hover:bg-slate-850 border border-slate-800 hover:border-amber-500/30 rounded-xl transition cursor-pointer group"
          title="View My Profile"
        >
          <div className="relative">
            <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center text-xs font-black">
              {username.charAt(0).toUpperCase()}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-slate-950" />
          </div>
          <div className="hidden lg:flex flex-col items-start text-left">
            <span className="text-xs font-bold text-slate-200 group-hover:text-amber-400 transition truncate max-w-[100px]">
              {username}
            </span>
            <span className="text-[9px] text-amber-400/70 font-mono font-semibold">
              ELO {profileStats?.elo || 1500}
            </span>
          </div>
        </button>
      </div>
    </header>
  );
};
