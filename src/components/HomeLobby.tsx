import React, { useState, useEffect } from "react";
import { Crown, Trophy, Bell, Gem, Users, Cpu, ChevronRight, ArrowRight, User as UserIcon, Radio, Eye, Microscope, Swords, Clock, Puzzle as PuzzleIcon, Settings, Play, Lock, Zap, MessageCircle, Share2, ExternalLink, LogOut } from "lucide-react";
import { CoinBadge } from "./ui/KentroCoin";
import { InstallAppCard } from "./InstallAppCard";
import { PlayMode, PlayerStats } from "../types";
import { AdminTappableName } from "../lib/adminProfileContext";
import { KEN_LEVELS } from "../lib/constants";

interface RecentGame {
  id: string;
  whitePlayer: string;
  blackPlayer: string;
  winner: string;
  playMode?: string;
  timestamp?: number;
}

interface LiveRoom {
  roomId: string;
  white: string;
  black: string;
  gameTime: number;
  specialRule: string;
  spectatorCount: number;
}

interface HomeLobbyProps {
  username: string;
  coinBalance: number;
  profileStats: PlayerStats;
  recentGames: RecentGame[];
  onSelectMode: (mode: PlayMode) => void;
  onOpenStore: () => void;
  onOpenProfile: () => void;
  /** Rooms with a game in progress right now (auto-refreshed every 10s). */
  liveGames: LiveRoom[];
  /** Community-wide finished games (newest first) -- used for the "just finished" strip. */
  communityGames: RecentGame[];
  onWatchLive: (roomId: string) => void;
  onAnalyzeGame: (game: RecentGame) => void;
  onOpenAnalysis: () => void;
  onOpenPlayers: () => void;
  onOpenPastGamesModal?: (filter?: "All" | "AI" | "PvP" | "Tournament") => void;
  kenLevelId: number;
  setKenLevelId: (id: number) => void;
  onOpenComputerModal?: () => void;
  onUnlockKenLevel?: (level: number | "all") => void;
  onSignOut?: () => void;
}

/**
 * Countdown to a fixed "coming soon" target, used for any nav destination or
 * card that doesn't have a working feature behind it yet. 10 days out from
 * whenever this component is first shown to a given browser (persisted so
 * the countdown doesn't reset every reload).
 */
function useComingSoonCountdown(key: string) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const storageKey = `kentro_coming_soon_v10_${key}`;
    const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
    let target = localStorage.getItem(storageKey);
    if (!target) {
      target = String(Date.now() + TEN_DAYS_MS);
      localStorage.setItem(storageKey, target);
    }
    let targetMs = parseInt(target, 10);

    const tick = () => {
      let diff = targetMs - Date.now();
      if (diff <= 0) {
        // Restart for another 7 days rather than sitting at "Coming very
        // soon" forever once the countdown runs out.
        targetMs = Date.now() + TEN_DAYS_MS;
        localStorage.setItem(storageKey, String(targetMs));
        diff = TEN_DAYS_MS;
      }
      const days = Math.floor(diff / (24 * 60 * 60 * 1000));
      const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
      const mins = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
      setRemaining(`${days}d ${hours}h ${mins}m`);
    };
    tick();
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, [key]);

  return remaining;
}

function ComingSoonBadge({ featureKey }: { featureKey: string }) {
  const countdown = useComingSoonCountdown(featureKey);
  return (
    <div className="absolute top-2 right-2 bg-slate-950/90 border border-amber-500/30 rounded-full px-2 py-0.5 text-[9px] font-bold text-amber-400 font-sans">
      {countdown}
    </div>
  );
}

export function HomeLobby({
  username, coinBalance, profileStats, recentGames, onSelectMode, onOpenStore, onOpenProfile,
  liveGames, communityGames, onWatchLive, onAnalyzeGame, onOpenAnalysis, onOpenPlayers, onOpenPastGamesModal,
  kenLevelId, setKenLevelId, onOpenComputerModal, onUnlockKenLevel, onSignOut,
}: HomeLobbyProps) {
  const [selectedSide, setSelectedSide] = useState<"W" | "B">("W");
  const winRate = profileStats.gamesCount > 0 ? Math.round((profileStats.wins / profileStats.gamesCount) * 100) : 0;
  const maxKenUnlocked = profileStats.maxUnlockedKenLevel || 1;

  // "Live" also includes games that FINISHED within the last 15 minutes --
  // fresh results people can jump into analysing right away.
  const FIFTEEN_MIN = 15 * 60 * 1000;
  const justFinished = communityGames
    .filter((g) => g.timestamp && Date.now() - g.timestamp < FIFTEEN_MIN)
    .slice(0, 4);

  const [showAiLevelSelector, setShowAiLevelSelector] = useState(false);
  const selectedKenLvl = KEN_LEVELS.find((l) => l.id === kenLevelId) || KEN_LEVELS[0];

  const handleStartAIGame = () => {
    const targetMode: PlayMode = selectedSide === "W" ? "Human_vs_AI" : "AI_vs_Human";
    onSelectMode(targetMode);
  };

  return (
    <div className="w-full min-h-full bg-[#070913]">
      <div className="max-w-6xl mx-auto p-4 md:p-6 flex flex-col gap-6">
        {/* ---- Top bar: brand + wallet + notifications + player ---- */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/20 shrink-0">
              <Crown className="w-6 h-6 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-white font-sans uppercase tracking-tight leading-none">Kentro Draught</h1>
              <p className="text-[10px] text-amber-500/70 font-sans tracking-[0.15em] uppercase mt-0.5">Play. Learn. Analyze. Win.</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <CoinBadge
              amount={coinBalance}
              size="md"
              onClick={onOpenStore}
              showPlus
              highlight
            />

            <div className="relative">
              <button className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center hover:border-amber-500/40 transition cursor-pointer">
                <Bell className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <button
              onClick={onOpenProfile}
              className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl pl-1.5 pr-3 py-1.5 hover:border-amber-500/40 transition cursor-pointer"
            >
              <div className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center">
                <UserIcon className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <span className="text-xs font-bold text-white font-sans">{username}</span>
            </button>

            {onSignOut && (
              <button
                onClick={onSignOut}
                title="Log Out"
                className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center hover:border-rose-500/40 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 transition cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* ---- Install as an app ---- */}
        <InstallAppCard variant="card" />

        {/* ---- WHATSAPP COMMUNITY & INVITE FRIENDS CARD ---- */}
        <div className="bg-gradient-to-r from-emerald-950/80 via-slate-900 to-teal-950/80 border border-emerald-500/30 rounded-2xl p-4 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 shadow-md">
              <MessageCircle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold text-white font-sans">
                  Draught.com WhatsApp Community
                </span>
                <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase font-sans">
                  Official Group
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-sans mt-0.5">
                Join our 1,000+ Nigerian &amp; Global players group for tournaments, challenge links &amp; game banter!
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center w-full sm:w-auto">
            <a
              href="https://chat.whatsapp.com/invite/draughts-community"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs px-3.5 py-2 rounded-xl transition cursor-pointer shadow-md font-sans"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Join Group
            </a>
            <button
              onClick={() => {
                const text = encodeURIComponent("Hey! Join me for a live match on Draught.com 🎲 Play online, solve puzzles, or challenge Engine Ken! https://draught.com");
                if (navigator.share) {
                  navigator.share({
                    title: "Draught.com Online",
                    text: "Join me for a live draughts match!",
                    url: "https://draught.com",
                  }).catch(() => {
                    window.open(`https://api.whatsapp.com/send?text=${text}`, "_blank");
                  });
                } else {
                  window.open(`https://api.whatsapp.com/send?text=${text}`, "_blank");
                }
              }}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-slate-950 hover:bg-slate-800 border border-emerald-500/30 text-emerald-300 font-bold text-xs px-3.5 py-2 rounded-xl transition cursor-pointer font-sans"
            >
              <Share2 className="w-3.5 h-3.5" />
              Invite Friends
            </button>
          </div>
        </div>

        {/* ---- PLAY NOW: 3 Main Mode Cards Grid ---- */}
        <div>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-[0.15em] font-sans mb-3">
            Play Now
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. VS AI Card */}
            <div
              className={`bg-slate-900 border transition rounded-2xl p-4 flex flex-col justify-between gap-3 relative overflow-hidden ${
                showAiLevelSelector ? "border-emerald-400/80 bg-slate-900/95 ring-1 ring-emerald-500/30" : "border-emerald-500/30 hover:border-emerald-400/60"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <Cpu className="w-5 h-5" />
                </div>
                <button
                  onClick={() => setShowAiLevelSelector(!showAiLevelSelector)}
                  className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500 hover:text-slate-950 transition cursor-pointer flex items-center gap-1 font-sans"
                >
                  <Settings className="w-3 h-3" />
                  Lvl {kenLevelId} ({selectedKenLvl.name.replace("Ken ", "")})
                </button>
              </div>

              <div>
                <div className="text-sm font-extrabold text-white font-sans flex items-center justify-between">
                  VS AI Engine
                  <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    Levels 1–8
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 font-sans mt-0.5">
                  Train against Ken offline on your device with no timers.
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleStartAIGame}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs px-3.5 py-2.5 rounded-xl shadow-lg shadow-emerald-500/20 transition cursor-pointer active:scale-95 uppercase tracking-wide font-sans"
                >
                  <Swords className="w-3.5 h-3.5" />
                  Play Lvl {kenLevelId}
                </button>
                <button
                  onClick={() => setShowAiLevelSelector(!showAiLevelSelector)}
                  className="bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-bold px-3 py-2.5 rounded-xl transition cursor-pointer flex items-center justify-center"
                  title="Change Level & Colors"
                >
                  <Settings className="w-3.5 h-3.5 text-amber-400" />
                </button>
              </div>
            </div>

            {/* 2. Head to Head (Online Play) */}
            <div className="bg-slate-900 border border-sky-500/30 hover:border-sky-400/60 transition rounded-2xl p-4 flex flex-col justify-between gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                  <Users className="w-5 h-5" />
                </div>
                <span className="text-[10px] text-sky-400 font-bold bg-sky-500/10 px-2.5 py-1 rounded-lg border border-sky-500/20 font-sans">
                  Play PvP
                </span>
              </div>

              <div>
                <div className="text-sm font-extrabold text-white font-sans">Online Arena</div>
                <div className="text-[11px] text-slate-400 font-sans mt-0.5">
                  Play your own game: host custom rooms, enter codes, or find opponents.
                </div>
              </div>

              <button
                onClick={() => onSelectMode("Multiplayer")}
                className="w-full flex items-center justify-center gap-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-xs px-3.5 py-2.5 rounded-xl shadow-lg shadow-sky-500/20 transition cursor-pointer active:scale-95 uppercase tracking-wide font-sans"
              >
                Play Online Game <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 3. Tactical Puzzles */}
            <div className="bg-slate-900 border border-amber-500/30 hover:border-amber-400/60 transition rounded-2xl p-4 flex flex-col justify-between gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                  <PuzzleIcon className="w-5 h-5" />
                </div>
                <span className="text-[10px] text-amber-400 font-bold bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20 font-sans">
                  Tactics
                </span>
              </div>

              <div>
                <div className="text-sm font-extrabold text-white font-sans">Tactical Puzzles</div>
                <div className="text-[11px] text-slate-400 font-sans mt-0.5">
                  Master combinations, forced jumps &amp; endgame puzzle challenges.
                </div>
              </div>

              <button
                onClick={() => onSelectMode("Puzzles")}
                className="w-full flex items-center justify-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs px-3.5 py-2.5 rounded-xl shadow-lg shadow-amber-500/20 transition cursor-pointer active:scale-95 uppercase tracking-wide font-sans"
              >
                Solve Puzzles <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Expanded AI Level & Settings Panel (When user taps Level or AI settings) */}
          {showAiLevelSelector && (
            <div className="mt-4 bg-gradient-to-br from-slate-900 via-slate-900/95 to-[#0d1222] border border-emerald-500/50 rounded-2xl p-4 md:p-5 shadow-2xl flex flex-col gap-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-black text-white uppercase tracking-tight font-sans">
                    Configure AI Game (Engine Ken)
                  </span>
                </div>
                <button
                  onClick={() => setShowAiLevelSelector(false)}
                  className="text-[10px] font-bold text-slate-400 hover:text-white px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer font-sans"
                >
                  Close Panel
                </button>
              </div>

              {/* Level selector grid */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-slate-400 font-sans uppercase">
                    Select Level (1 to 8):
                  </span>
                  <span className="text-[10px] text-amber-400 font-bold font-sans">
                    Unlocked up to Lvl {maxKenUnlocked}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {KEN_LEVELS.map((lvl) => {
                    const isLocked = lvl.id > maxKenUnlocked;
                    const isSelected = lvl.id === kenLevelId;
                    return (
                      <button
                        key={lvl.id}
                        onClick={() => {
                          if (isLocked) {
                            if (onUnlockKenLevel) onUnlockKenLevel(lvl.id);
                            return;
                          }
                          setKenLevelId(lvl.id);
                        }}
                        className={`p-2 rounded-xl text-left transition flex items-center justify-between cursor-pointer border ${
                          isSelected
                            ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-black border-emerald-300 shadow-md scale-[1.01]"
                            : isLocked
                              ? "bg-slate-950/60 border-slate-900 text-slate-500 hover:border-amber-500/30"
                              : "bg-slate-950 border-slate-800 text-slate-200 hover:border-emerald-500/40 hover:bg-slate-900"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-extrabold truncate">
                            {lvl.name.replace("Ken ", "Lvl ")}
                          </div>
                          <div className={`text-[9px] font-mono mt-0.5 ${isSelected ? "text-slate-950/80" : "text-slate-500"}`}>
                            Level {lvl.id}
                          </div>
                        </div>
                        {isLocked && <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0 ml-1" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Color selection & Launch */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-950/90 border border-slate-800 p-3 rounded-xl">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 font-sans uppercase shrink-0">Your Side:</span>
                  <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800">
                    <button
                      onClick={() => setSelectedSide("W")}
                      className={`px-3 py-1 rounded-lg text-xs font-bold font-sans transition cursor-pointer flex items-center gap-1.5 ${
                        selectedSide === "W" ? "bg-amber-500 text-slate-950 shadow" : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-100 border border-amber-900 inline-block" />
                      White (1st)
                    </button>
                    <button
                      onClick={() => setSelectedSide("B")}
                      className={`px-3 py-1 rounded-lg text-xs font-bold font-sans transition cursor-pointer flex items-center gap-1.5 ${
                        selectedSide === "B" ? "bg-slate-800 text-amber-400 border border-amber-500/40 shadow" : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-950 border border-slate-600 inline-block" />
                      Black (2nd)
                    </button>
                  </div>
                </div>

                <button
                  onClick={handleStartAIGame}
                  className="flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs px-5 py-2.5 rounded-xl shadow-lg transition cursor-pointer uppercase font-sans tracking-wide"
                >
                  <Swords className="w-3.5 h-3.5" />
                  Start vs {selectedKenLvl.name}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ---- Live Games: playing right now, or finished in the last 15 min ---- */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-[0.15em] font-sans flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-rose-400 animate-pulse" /> Live Games (Watch)
            </h2>
            <span className="text-[10px] text-rose-400/80 font-mono flex items-center gap-1">
              <Eye className="w-3 h-3" /> Spectate live matches
            </span>
          </div>

          {liveGames.length === 0 && justFinished.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-[11px] text-slate-500 font-sans italic">
              No live games at the moment — host a match in Online Play and it will appear here for everyone to watch.
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {liveGames.slice(0, 5).map((room) => (
                <div key={room.roomId} className="flex items-center justify-between bg-slate-900 border border-rose-500/25 rounded-2xl px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                      <span className="text-xs font-bold text-slate-100 font-sans truncate">
                        {room.white} <span className="text-slate-500 font-normal">vs</span> {room.black}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 font-sans mt-0.5 flex items-center gap-2">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {room.gameTime}m</span>
                      {room.specialRule && room.specialRule !== "none" && <span className="text-amber-400/80">{room.specialRule.replace("-", " ")}</span>}
                      <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {room.spectatorCount} watching</span>
                    </div>
                  </div>
                  <button
                    onClick={() => onWatchLive(room.roomId)}
                    className="shrink-0 flex items-center gap-1.5 bg-rose-500 hover:bg-rose-400 text-white text-[11px] font-black px-3.5 py-2 rounded-xl transition cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" /> Watch
                  </button>
                </div>
              ))}

              {justFinished.map((g) => {
                const mins = g.timestamp ? Math.max(1, Math.round((Date.now() - g.timestamp) / 60000)) : 1;
                return (
                  <div key={g.id} className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-bold text-slate-200 font-sans truncate block">
                        {g.whitePlayer} <span className="text-slate-500 font-normal">vs</span> {g.blackPlayer}
                      </span>
                      <span className="text-[10px] text-slate-500 font-sans">
                        {g.winner === "Draw" ? "Drawn" : `${g.winner} won`} · finished {mins}m ago
                      </span>
                    </div>
                    <button
                      onClick={() => onAnalyzeGame(g)}
                      className="shrink-0 flex items-center gap-1.5 bg-slate-950 border border-amber-500/30 text-amber-400 hover:bg-amber-500 hover:text-slate-950 text-[11px] font-black px-3.5 py-2 rounded-xl transition cursor-pointer"
                    >
                      <Microscope className="w-3.5 h-3.5" /> Analyse
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ---- Stats + Recent Games + Coming Soon rail ---- */}
        <div className="grid md:grid-cols-3 gap-4">
          {/* Player stats */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wide font-sans">Player Stats</h3>
              <button onClick={onOpenProfile} className="text-[10px] text-slate-500 hover:text-slate-300 font-sans flex items-center gap-0.5">
                View Profile <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div>
                <div className="text-xl font-extrabold text-white font-sans">{Math.round(profileStats.elo)}</div>
                <div className="text-[9px] text-slate-500 uppercase font-sans">Rating</div>
              </div>
              <div>
                <div className="text-xl font-extrabold text-white font-sans">{profileStats.gamesCount}</div>
                <div className="text-[9px] text-slate-500 uppercase font-sans">Games</div>
              </div>
              <div>
                <div className="text-lg font-bold text-emerald-400 font-sans">{profileStats.wins}W</div>
                <div className="text-lg font-bold text-slate-400 font-sans">{profileStats.draws}D</div>
              </div>
              <div>
                <div className="text-lg font-bold text-rose-400 font-sans">{profileStats.losses}L</div>
                <div className="text-[9px] text-slate-500 uppercase font-sans">{winRate}% win rate</div>
              </div>
            </div>
          </div>

          {/* Your past games -- every finished game (AI matches included)
              is saved and can be opened straight onto the Analysis board. */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wide font-sans">Your Past Games</h3>
              <button
                onClick={() => onOpenPastGamesModal ? onOpenPastGamesModal("All") : onOpenAnalysis()}
                className="text-[10px] text-amber-400 hover:text-amber-300 font-bold font-sans flex items-center gap-0.5 cursor-pointer bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md transition"
              >
                Archive (Batch 100) <ChevronRight className="w-3 h-3" />
              </button>
            </div>

            {/* Quick Mode Filters */}
            <div className="flex items-center gap-1 mb-3 overflow-x-auto py-1">
              <button
                onClick={() => onOpenPastGamesModal && onOpenPastGamesModal("AI")}
                className="text-[9px] font-bold px-2 py-1 rounded-md bg-slate-950 border border-slate-800 text-slate-300 hover:text-amber-400 hover:border-amber-500/30 transition cursor-pointer flex items-center gap-1 shrink-0"
              >
                <Cpu className="w-2.5 h-2.5 text-amber-400" /> VS Computer
              </button>
              <button
                onClick={() => onOpenPastGamesModal && onOpenPastGamesModal("PvP")}
                className="text-[9px] font-bold px-2 py-1 rounded-md bg-slate-950 border border-slate-800 text-slate-300 hover:text-amber-400 hover:border-amber-500/30 transition cursor-pointer flex items-center gap-1 shrink-0"
              >
                <Swords className="w-2.5 h-2.5 text-sky-400" /> PvP Arena
              </button>
              <button
                onClick={() => onOpenPastGamesModal && onOpenPastGamesModal("Tournament")}
                className="text-[9px] font-bold px-2 py-1 rounded-md bg-slate-950 border border-slate-800 text-slate-300 hover:text-amber-400 hover:border-amber-500/30 transition cursor-pointer flex items-center gap-1 shrink-0"
              >
                <Trophy className="w-2.5 h-2.5 text-emerald-400" /> Tournaments
              </button>
            </div>

            {recentGames.length === 0 ? (
              <p className="text-[11px] text-slate-500 font-sans italic">No games yet -- play your first match above.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {recentGames.slice(0, 4).map((g) => {
                  const opponent = g.whitePlayer === username ? g.blackPlayer : g.whitePlayer;
                  const result = g.winner === "Draw" ? "Draw" : (g.winner === username ? "Win" : "Loss");
                  const resultColor = result === "Win" ? "text-emerald-400" : result === "Loss" ? "text-rose-400" : "text-slate-400";
                  return (
                    <div key={g.id} className="flex items-center justify-between text-xs font-sans gap-2">
                      <span className="text-slate-300 truncate flex-1 min-w-0">vs <AdminTappableName username={opponent} /></span>
                      <span className={`font-bold shrink-0 ${resultColor}`}>{result}</span>
                      <button
                        onClick={() => onAnalyzeGame(g)}
                        title="Open on the Analysis board with full Ken depth 30 analysis"
                        className="shrink-0 text-[9px] font-black text-amber-400 border border-amber-500/30 hover:bg-amber-500 hover:text-slate-950 px-2 py-1 rounded-lg transition cursor-pointer"
                      >
                        Analyse
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Players directory + head-to-head records */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col">
            <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wide font-sans mb-2 flex items-center gap-1.5">
              <Swords className="w-3.5 h-3.5" /> Players &amp; Head-to-Head
            </h3>
            <p className="text-[11px] text-slate-500 font-sans leading-relaxed flex-1">
              Browse every registered player, open their full profile and match history, and see your personal head-to-head record against anyone you've faced.
            </p>
            <button
              onClick={onOpenPlayers}
              className="mt-3 w-full flex items-center justify-center gap-1.5 bg-slate-950 border border-sky-500/30 text-sky-400 hover:bg-sky-500 hover:text-slate-950 text-[11px] font-black px-3 py-2.5 rounded-xl transition cursor-pointer"
            >
              <Users className="w-3.5 h-3.5" /> Open Player Directory
            </button>
          </div>

          {/* Puzzles -- live: weekly rotating tactics set */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col">
            <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wide font-sans mb-2">Tactics Puzzles</h3>
            <p className="text-[11px] text-slate-500 font-sans leading-relaxed flex-1">
              This week's curated traps and combinations -- solve the winning line under real game rules and sharpen your eye.
            </p>
            <button
              onClick={() => onSelectMode("Puzzles")}
              className="mt-3 w-full flex items-center justify-center gap-1.5 bg-slate-950 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500 hover:text-slate-950 text-[11px] font-black px-3 py-2.5 rounded-xl transition cursor-pointer"
            >
              Solve Puzzles <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* ---- Tournament promo ---- */}
        <button
          onClick={() => onSelectMode("Tournament")}
          className="flex items-center justify-between bg-slate-900 border border-amber-500/40 rounded-2xl p-5 hover:border-amber-400 transition"
        >
          <div className="flex items-center gap-3">
            <Trophy className="w-8 h-8 text-amber-400" />
            <div className="text-left">
              <div className="text-sm font-extrabold text-white font-sans uppercase">Kentro Draught Tournament</div>
              <div className="text-[11px] text-slate-400 font-sans">Big prizes. Real glory.</div>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs font-bold text-amber-400 font-sans">
            Join <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </button>
      </div>
    </div>
  );
}
