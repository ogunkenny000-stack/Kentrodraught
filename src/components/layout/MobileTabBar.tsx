import { Home, Swords, Cpu, Tv, MessageCircle } from "lucide-react";
import { PlayMode } from "../../types";
export interface MobileTabBarProps { playMode: PlayMode; unreadLoungeCount: number; onSelectMode: (mode: PlayMode) => void; onPlayVsAI: () => void; }
export function MobileTabBar({playMode, unreadLoungeCount, onSelectMode, onPlayVsAI}: MobileTabBarProps) {
  const items = [
    {label:"Home", icon:Home, active:playMode==="Home", onClick:()=>onSelectMode("Home")},
    {label:"Online", icon:Swords, active:playMode==="Multiplayer", onClick:()=>onSelectMode("Multiplayer")},
    {label:"Play AI", icon:Cpu, active:["Human_vs_AI","AI_vs_Human","AI_vs_AI"].includes(playMode), onClick:onPlayVsAI},
    {label:"Watch", icon:Tv, active:playMode==="KentroTV", onClick:()=>onSelectMode("KentroTV")},
    {label:"Lounge", icon:MessageCircle, active:playMode==="Global_Chat", onClick:()=>onSelectMode("Global_Chat")},
  ];
  return <nav className="k-mobile-tabs" aria-label="Primary navigation">{items.map((item,idx)=>{const Icon=item.icon;return <button key={item.label} type="button" className={`k-mobile-tab ${item.active?"active":""}`} onClick={item.onClick} aria-current={item.active?"page":undefined}><span className="k-mobile-tab-icon"><Icon size={21} strokeWidth={item.active?2.5:1.9}/>{idx===4 && unreadLoungeCount>0 && <i className="k-mobile-tab-badge"/>}</span><span>{item.label}</span></button>})}</nav>;
}
