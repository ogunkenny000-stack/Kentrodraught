import React from "react";
import { ArrowLeft, BookOpen, Crown, Menu, Settings2, Volume2, VolumeX, ChartNoAxesCombined, Shield } from "lucide-react";
import { PlayMode } from "../../types";
import { Move } from "../../gameLogic";

export interface TopNavProps {
  isMobile: boolean; playMode: PlayMode; isGameActive?: boolean; unreadLoungeCount: number; moveHistory: Move[];
  muted: boolean; setMuted: React.Dispatch<React.SetStateAction<boolean>>;
  handleModeChange: (mode: PlayMode) => void;
  setIsLeftDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showAdmin?: boolean; onOpenAdmin?: () => void;
  setIsRightDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShowAppGuideModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowSettingsModal: React.Dispatch<React.SetStateAction<boolean>>;
  showMobileDeskButton: boolean;
}
const names: Partial<Record<PlayMode,string>> = {
  Home: "Home", Multiplayer: "Online arena", OfflineNearby: "Nearby play", KentroTV: "Kentro TV",
  Human_vs_AI: "Play vs Ken", AI_vs_Human: "Play vs Ken", AI_vs_AI: "Engine match",
  Tournament: "Tournaments", Analysis: "Analysis lab", Training: "Training", Editor: "Board editor",
  Puzzles: "Puzzles", Learn: "Academy", Global_Chat: "Community",
};
export function TopNav({isMobile, playMode, isGameActive = false, moveHistory, muted, setMuted, handleModeChange, setIsLeftDrawerOpen, showAdmin, onOpenAdmin, setIsRightDrawerOpen, setShowAppGuideModal, setShowSettingsModal, showMobileDeskButton}:TopNavProps) {
  const isBoard = isGameActive || ["Human_vs_AI", "AI_vs_Human", "AI_vs_AI", "Analysis", "Training", "Editor", "Puzzles"].includes(playMode);
  return <header className={`k-global-topnav ${isBoard ? "k-global-topnav--game" : ""}`}>
    <div className="k-global-left">
      <button type="button" className="k-nav-icon k-nav-menu" aria-label="Open navigation" onClick={() => setIsLeftDrawerOpen(true)}><Menu size={21}/></button>
      {!isMobile && <button type="button" className="k-brand" onClick={() => handleModeChange("Home")} aria-label="Kentro Draughts home"><span className="k-brand-symbol"><Crown size={20}/></span><span>KENTRO<span className="k-brand-light"> DRAUGHTS</span></span></button>}
      {isMobile && <button type="button" onClick={() => handleModeChange("Home")} className="k-brand-mobile"><span className="k-brand-symbol"><Crown size={20}/></span> Kentro</button>}
      {playMode !== "Home" && <span className="k-current-location"><span className="k-location-slash">/</span> {names[playMode] || "Play"}</span>}
    </div>
    <div className="k-global-right">
      {showAdmin && <button type="button" className="k-nav-icon k-admin-icon" aria-label="Admin panel" onClick={onOpenAdmin}><Shield size={19}/></button>}
      {!isBoard && <button type="button" className="k-nav-icon k-help-icon" aria-label="How to play" onClick={() => setShowAppGuideModal(true)}><BookOpen size={19}/></button>}
      <button type="button" className="k-nav-icon k-nav-sound" onClick={() => setMuted(!muted)} aria-label={muted ? "Enable sound" : "Mute sound"}>{muted ? <VolumeX size={19}/> : <Volume2 size={19}/>}</button>
      <button type="button" className="k-nav-icon" onClick={() => setShowSettingsModal(true)} aria-label="Settings"><Settings2 size={19}/></button>
      {isMobile && showMobileDeskButton && <button type="button" className="k-nav-icon" onClick={() => setIsRightDrawerOpen(true)} aria-label="Match statistics"><ChartNoAxesCombined size={19}/>{moveHistory.length > 0 && <span className="k-mini-dot"/>}</button>}
    </div>
  </header>;
}
