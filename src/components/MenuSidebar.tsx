import React, { useState } from "react";
import { PlayMode, BoardTheme, BOARD_THEMES } from "../types";
import { KEN_LEVELS } from "../lib/constants";
import { Trophy, Cpu, User, Compass, Swords, Settings2, Crown, Volume2, VolumeX, BookOpen, Palette, Clock, MessageCircle, Puzzle, GraduationCap, Users, ShoppingBag, Tv2, ChevronDown, LayoutDashboard, Zap, Wifi, ShieldCheck, SlidersHorizontal } from "lucide-react";
interface MenuSidebarProps {
  activeMode: PlayMode; onSelectMode: (mode: PlayMode) => void; onOpenFriends: () => void;
  onOpenProfile: () => void; onOpenStore: () => void; onOpenPlayers: () => void;
  showAdmin?: boolean; onOpenAdmin?: () => void; unreadLoungeCount?: number;
  muted: boolean; onToggleMuted: () => void; onShowRules: () => void;
  boardTheme: BoardTheme; onSelectBoardTheme: (theme: BoardTheme) => void;
  clockLimitType: "Blitz" | "Rapid" | "Classical" | "Untimed";
  onSelectClockLimit: (type: "Blitz" | "Rapid" | "Classical" | "Untimed") => void;
  kenLevelId: number; onSelectKenLevel: (id: number) => void; boardScale: number;
  onSelectBoardScale: (scale: number) => void; className?: string;
}
const primary = [
  {id:"Home", icon:LayoutDashboard, label:"Home"}, {id:"Multiplayer", icon:Swords, label:"Online arena"},
  {id:"Human_vs_AI", icon:Cpu, label:"Play Ken AI"}, {id:"OfflineNearby", icon:Wifi, label:"Nearby offline"},
  {id:"KentroTV", icon:Tv2, label:"Kentro TV"}, {id:"Tournament", icon:Trophy, label:"Tournaments"}
] as const;
const discover = [
  {id:"Puzzles", icon:Puzzle, label:"Puzzles"},{id:"Learn", icon:GraduationCap, label:"Academy"},
  {id:"Global_Chat", icon:MessageCircle, label:"The lounge"},
  {id:"Analysis", icon:Compass, label:"Analysis lab"},{id:"Editor", icon:SlidersHorizontal, label:"Board editor"}
] as const;
export function MenuSidebar({activeMode,onSelectMode,onOpenFriends,onOpenProfile,onOpenStore,onOpenPlayers,showAdmin,onOpenAdmin,unreadLoungeCount=0,muted,onToggleMuted,onShowRules,boardTheme,onSelectBoardTheme,clockLimitType,onSelectClockLimit,kenLevelId,onSelectKenLevel,boardScale,onSelectBoardScale,className}:MenuSidebarProps){
  const [advanced,setAdvanced]=useState(false);
  const button=(item:{id:string,icon:typeof Trophy,label:string}) => {const Icon=item.icon;const active=activeMode===item.id||(item.id==="Human_vs_AI"&&["AI_vs_Human","AI_vs_AI"].includes(activeMode));return <button key={item.id} type="button" onClick={()=>onSelectMode(item.id as PlayMode)} aria-current={active?"page":undefined} className={`k-side-link ${active?"active":""}`}><Icon size={20}/><span>{item.label}</span>{item.id==="Global_Chat" && unreadLoungeCount>0 && <b>{unreadLoungeCount}</b>}</button>};
  return <aside className={`${className || ""} k-sidebar`} aria-label="Main navigation">
    <div className="k-sidebar-group"><span className="k-sidebar-label">PLAY</span>{primary.map(button)}</div>
    <div className="k-sidebar-group"><span className="k-sidebar-label">EXPLORE</span>{discover.map(button)}</div>
    <div className="k-sidebar-group"><span className="k-sidebar-label">YOUR ACCOUNT</span><button className="k-side-link" onClick={onOpenProfile}><User size={19}/> My profile</button><button className="k-side-link" onClick={onOpenFriends}><Users size={19}/> Friends</button><button className="k-side-link" onClick={onOpenStore}><ShoppingBag size={19}/> Wallet & store</button><button className="k-side-link" onClick={onOpenPlayers}><Users size={19}/> Players</button>{showAdmin && <button className="k-side-link" onClick={onOpenAdmin}><ShieldCheck size={19}/> Administration</button>}</div>
    <div className="k-sidebar-group k-side-advanced"><button type="button" className="k-side-advanced-toggle" aria-expanded={advanced} onClick={()=>setAdvanced(!advanced)}><Settings2 size={18}/> Match preferences <ChevronDown size={16} className={advanced?"k-chevron-up":""}/></button>{advanced && <div className="k-side-advanced-panel"><label>Board theme<select value={boardTheme} onChange={e=>onSelectBoardTheme(e.target.value as BoardTheme)}>{(Object.keys(BOARD_THEMES) as BoardTheme[]).map(t=><option value={t} key={t}>{BOARD_THEMES[t].name}</option>)}</select></label><label>Clock style<select value={clockLimitType} onChange={e=>onSelectClockLimit(e.target.value as MenuSidebarProps["clockLimitType"])}>{["Blitz","Rapid","Classical","Untimed"].map(c=><option key={c}>{c}</option>)}</select></label><label>Engine level<select value={kenLevelId} onChange={e=>onSelectKenLevel(Number(e.target.value))}>{KEN_LEVELS.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label><label>Board size<input type="range" min="80" max="130" step="5" value={boardScale} onChange={e=>onSelectBoardScale(Number(e.target.value))}/></label><button onClick={onToggleMuted} className="k-side-link">{muted?<VolumeX size={17}/>:<Volume2 size={17}/>} {muted?"Turn on sound":"Mute sounds"}</button><button onClick={onShowRules} className="k-side-link"><BookOpen size={17}/> Rules of play</button></div>}</div>
    <div className="k-side-footer"><span className="k-live-point"/> Built for Nigerian draughts</div>
  </aside>
}
export {MenuSidebar as default};
