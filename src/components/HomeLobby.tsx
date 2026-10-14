import React, { useState } from "react";
import { ArrowRight, Bell, BookOpen, Check, ChevronDown, ChevronRight, CirclePlay, Clock3, Compass, Cpu, Crown, Eye, Gamepad2, Globe2, History, LogOut, Medal, MessageCircle, MonitorPlay, Radio, Settings2, Share2, ShieldCheck, Sparkles, Swords, Trophy, Users, Wifi, Zap } from "lucide-react";
import { PlayMode, PlayerStats } from "../types";
import { MatchResultPair } from "./MatchResultPair";
import { uniqueCompletedMatches } from "../lib/completedMatches";
import { KEN_LEVELS } from "../lib/constants";

interface RecentGame { id: string; whitePlayer: string; blackPlayer: string; winner: string; playMode?: string; timestamp?: number }
interface LiveRoom { roomId: string; white: string; black: string; gameTime: number; specialRule: string; spectatorCount: number }
interface HomeLobbyProps {
  username: string; isGuest?: boolean; coinBalance: number; profileStats: PlayerStats; recentGames: RecentGame[];
  onSelectMode: (mode: PlayMode) => void; onOpenStore: () => void; onOpenProfile: () => void;
  liveGames: LiveRoom[]; communityGames: RecentGame[]; onWatchLive: (roomId: string) => void;
  onAnalyzeGame: (game: RecentGame) => void; onOpenAnalysis: () => void; onOpenPlayers: () => void;
  onOpenPastGamesModal?: (filter?: "All" | "AI" | "PvP" | "Tournament") => void;
  kenLevelId: number; setKenLevelId: (id: number) => void; onOpenComputerModal?: () => void;
  onUnlockKenLevel?: (level: number | "all") => void; onSignOut?: () => void;
  onOpenNotifications?: () => void; onOpenKentroTV?: () => void; unreadNotificationCount?: number;
}

/** The main destination is intentionally calm: playing a game takes one clear tap. */
export function HomeLobby({
  username, isGuest = false, coinBalance, profileStats, recentGames, onSelectMode, onOpenStore,
  onOpenProfile, liveGames, communityGames, onWatchLive, onAnalyzeGame, onOpenAnalysis,
  onOpenPlayers, onOpenPastGamesModal, kenLevelId, setKenLevelId, onOpenComputerModal,
  onUnlockKenLevel, onSignOut, onOpenNotifications, onOpenKentroTV, unreadNotificationCount = 0,
}: HomeLobbyProps) {
  const [showAISetup, setShowAISetup] = useState(false);
  const [side, setSide] = useState<"W" | "B">("W");
  const wins = profileStats.wins || 0;
  const played = profileStats.gamesCount || 0;
  const winRate = played ? Math.round(wins / played * 100) : 0;
  const unlocked = profileStats.maxUnlockedKenLevel || 1;
  const level = KEN_LEVELS.find(l => l.id === kenLevelId) || KEN_LEVELS[0];
  const latestGames = uniqueCompletedMatches(recentGames).slice(0, 3);
  const finished = uniqueCompletedMatches(communityGames).filter(g => g.timestamp && Date.now() - Number(g.timestamp) < 900000).slice(0, 2);
  const startAI = () => onSelectMode(side === "W" ? "Human_vs_AI" : "AI_vs_Human");

  return <div className="k-app-home">
    <div className="k-home-shell">
      <header className="k-home-topline">
        <div className="k-greeting">
          <span className="k-overline">YOUR DRAUGHTS HOME</span>
          <h1>Good to see you, <span>{isGuest ? "Guest" : username}</span><span className="k-heading-period">.</span></h1>
          <p>Ready for your next great move?</p>
        </div>
        <div className="k-header-actions">
          <button type="button" className="k-icon-button k-home-icon" onClick={onOpenNotifications} aria-label={`Notifications, ${unreadNotificationCount} unread`} title="Notifications"><Bell size={20}/>{unreadNotificationCount > 0 && <span className="k-dot-count">{unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}</span>}</button>
          <button type="button" className="k-home-avatar" onClick={onOpenProfile} aria-label="Open your profile"><span>{(username || "G").charAt(0).toUpperCase()}</span></button>
        </div>
      </header>

      <section className="k-play-hero" aria-labelledby="k-hero-title">
        <div className="k-hero-copy">
          <div className="k-live-eyebrow"><span className="k-live-point"/> YOUR NEXT MATCH AWAITS</div>
          <h2 id="k-hero-title">The board is yours.</h2>
          <p>Challenge someone online or sharpen your game against Ken. Every champion starts with a move.</p>
          <div className="k-hero-actions">
            <button className="k-button k-button-main" onClick={() => onSelectMode("Multiplayer")}><Swords size={20}/> Play online <ArrowRight size={18}/></button>
            <button className="k-button k-button-outline" onClick={() => setShowAISetup(s => !s)}><Cpu size={19}/> Play vs Ken</button>
          </div>
          <span className="k-hero-footnote"><ShieldCheck size={15}/> Nigerian rules · 10 × 10 board · Fair play</span>
        </div>
        <div className="k-hero-board" aria-hidden="true"><div className="k-hero-board-grid">{Array.from({length:100},(_,i) => { const row = Math.floor(i/10), col = i%10, dark = (row+col)%2 === 1; return <div key={i} className={dark ? "dark" : "light"}>{dark && (row < 4 || row > 5) && <span className={row<4 ? "piece-dark" : "piece-light"}/>}</div> })}</div></div>
      </section>

      {showAISetup && <section className="k-ai-config k-surface" aria-label="AI match setup">
        <div className="k-section-heading"><div><span className="k-overline">PRACTICE YOUR SKILLS</span><h3>Play against Ken</h3><p>Choose your side and difficulty to begin.</p></div><button className="k-icon-button" onClick={() => setShowAISetup(false)} aria-label="Close AI setup"><ChevronDown size={20}/></button></div>
        <div className="k-setup-row"><div className="k-field"><label htmlFor="k-level">Difficulty</label><select id="k-level" value={kenLevelId} onChange={e => { const next=Number(e.target.value); if(next>unlocked){onUnlockKenLevel?.(next);return;} setKenLevelId(next); }}>{KEN_LEVELS.map(l => <option key={l.id} value={l.id}>{l.name}{l.id > unlocked ? " · Locked" : ""}</option>)}</select></div><fieldset className="k-field"><legend>Play as</legend><div className="k-segment"><button className={side === "W" ? "selected" : ""} onClick={() => setSide("W")} type="button"><span className="k-color-dot light"/> Gold</button><button className={side === "B" ? "selected" : ""} onClick={() => setSide("B")} type="button"><span className="k-color-dot dark"/> Black</button></div></fieldset><button className="k-button k-button-main" onClick={startAI}><CirclePlay size={18}/> Start game</button></div>
        <p className="k-footnote">{level.name} · Levels 1–8 · Your progress is saved when signed in.</p>
      </section>}

      <section className="k-destination-grid" aria-label="Ways to play and explore">
        <button className="k-destination" onClick={() => onSelectMode("Puzzles")}><span className="k-destination-icon k-destination-icon-blue"><Sparkles/></span><span className="k-destination-copy"><strong>Weekly puzzles</strong><small>Train your next move</small></span><ChevronRight className="k-destination-arrow" size={18}/></button>
        <button className="k-destination" onClick={() => onSelectMode("OfflineNearby")}><span className="k-destination-icon k-destination-icon-green"><Wifi/></span><span className="k-destination-copy"><strong>Nearby play</strong><small>Wi-Fi and hotspot matches</small></span><ChevronRight className="k-destination-arrow" size={18}/></button>
        <button className="k-destination" onClick={() => onSelectMode("Tournament")}><span className="k-destination-icon k-destination-icon-gold"><Trophy/></span><span className="k-destination-copy"><strong>Tournaments</strong><small>Compete for your place</small></span><ChevronRight className="k-destination-arrow" size={18}/></button>
        <button className="k-destination" onClick={() => onOpenKentroTV ? onOpenKentroTV() : onSelectMode("KentroTV")}><span className="k-destination-icon k-destination-icon-red"><MonitorPlay/></span><span className="k-destination-copy"><strong>Kentro TV</strong><small>Live games and replays</small></span><ChevronRight className="k-destination-arrow" size={18}/></button>
      </section>

      <div className="k-dashboard-columns">
        <section className="k-surface k-dashboard-stats" aria-labelledby="k-stats-title"><div className="k-section-heading"><div><span className="k-overline">YOUR PERFORMANCE</span><h3 id="k-stats-title">Player overview</h3></div><button className="k-text-button" onClick={onOpenProfile}>Profile <ChevronRight size={16}/></button></div>
          <div className="k-stats-grid"><div className="k-stat-major"><span>Current rating</span><strong>{Math.round(profileStats.elo || 1200).toLocaleString()}</strong><small>{isGuest ? "Guest player" : "Rated player"}</small></div><div className="k-stat"><strong>{played}</strong><span>Games</span></div><div className="k-stat"><strong>{winRate}%</strong><span>Win rate</span></div><div className="k-stat"><strong>{wins}</strong><span>Wins</span></div></div>
          <div className="k-stats-bottom"><button className="k-text-button" onClick={() => onOpenPastGamesModal?.("All")}><History size={17}/> Match history <ArrowRight size={15}/></button><button className="k-text-button" onClick={onOpenAnalysis}><Compass size={17}/> Analysis lab <ArrowRight size={15}/></button></div>
        </section>
        <section className="k-surface k-dashboard-live" aria-labelledby="k-live-title"><div className="k-section-heading"><div><span className="k-overline">AROUND THE ARENA</span><h3 id="k-live-title">Live now <span className="k-count-pill">{liveGames.length}</span></h3></div><button className="k-text-button" onClick={() => onOpenKentroTV ? onOpenKentroTV() : onSelectMode("KentroTV")}>Watch all <ChevronRight size={16}/></button></div>
          {liveGames.length === 0 && finished.length === 0 ? <div className="k-empty-state"><span className="k-empty-icon"><Radio size={22}/></span><strong>It's quiet in the arena</strong><p>Live matches will appear here as soon as players start a game.</p><button className="k-text-button" onClick={() => onSelectMode("Multiplayer")}>Find a match <ArrowRight size={15}/></button></div> : <div className="k-live-list">{liveGames.slice(0,3).map(r => <div key={r.roomId} className="k-live-row"><span className="k-live-marker"/><div className="k-live-players"><strong>{r.white} <span>vs</span> {r.black}</strong><small><Clock3 size={13}/> {r.gameTime} min · {r.spectatorCount} watching</small></div><button className="k-small-action" onClick={() => onWatchLive(r.roomId)}><Eye size={15}/> Watch</button></div>)}{finished.map(g => <div className="k-live-row" key={g.id}><div className="k-live-players"><MatchResultPair game={g} compact/></div><button className="k-small-action" onClick={() => onAnalyzeGame(g)}>Review</button></div>)}</div>}
        </section>
      </div>

      <section className="k-surface k-community-strip"><div><span className="k-overline">YOUR COMMUNITY</span><h3>Better together.</h3><p>Connect with fellow players, challenge friends, or solve your next puzzle.</p></div><div className="k-community-actions"><button onClick={() => onSelectMode("Global_Chat")}><MessageCircle size={19}/> Lounge</button><button onClick={onOpenPlayers}><Users size={19}/> Players</button><button onClick={() => onSelectMode("Puzzles")}><Zap size={19}/> Puzzles</button><button onClick={() => onSelectMode("Learn")}><BookOpen size={19}/> Learn</button></div></section>
      {latestGames.length > 0 && <section className="k-surface k-history-section"><div className="k-section-heading"><div><span className="k-overline">CONTINUE IMPROVING</span><h3>Recent results</h3></div><button className="k-text-button" onClick={() => onOpenPastGamesModal?.("All")}>All games <ChevronRight size={16}/></button></div><div className="k-recent-results">{latestGames.map(g => <button className="k-result-row" key={g.id} onClick={() => onAnalyzeGame(g)}><MatchResultPair game={g} compact/><ChevronRight size={17}/></button>)}</div></section>}
      <footer className="k-home-footer"><span>Kentro Draughts · Nigerian draughts, built for everyone</span><div><button onClick={onOpenStore}>Coins · {coinBalance}</button>{onSignOut && <button onClick={onSignOut}><LogOut size={14}/> Sign out</button>}</div></footer>
    </div>
  </div>;
}
