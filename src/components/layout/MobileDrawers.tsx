import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { MenuSidebar } from "../MenuSidebar";
import { PlayMode, BoardTheme } from "../../types";

export interface MobileDrawersProps {
  isLeftDrawerOpen: boolean;
  setIsLeftDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isRightDrawerOpen: boolean;
  setIsRightDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  playMode: PlayMode;
  handleModeChange: (mode: PlayMode) => void;
  setShowFriendsPage: React.Dispatch<React.SetStateAction<boolean>>;
  setShowProfilePage: React.Dispatch<React.SetStateAction<boolean>>;
  setShowPurchaseModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowPlayerDirectory: React.Dispatch<React.SetStateAction<boolean>>;
  fetchPlayersDirectory: () => void;
  unreadLoungeCount: number;
  muted: boolean;
  setMuted: React.Dispatch<React.SetStateAction<boolean>>;
  setShowRules: React.Dispatch<React.SetStateAction<boolean>>;
  boardTheme: BoardTheme;
  setBoardTheme: React.Dispatch<React.SetStateAction<BoardTheme>>;
  clockLimitType: "Blitz" | "Rapid" | "Classical" | "Untimed";
  setClockLimitType: React.Dispatch<React.SetStateAction<"Blitz" | "Rapid" | "Classical" | "Untimed">>;
  kenLevelId: number;
  setKenLevelId: React.Dispatch<React.SetStateAction<number>>;
  boardScale: number;
  setBoardScale: React.Dispatch<React.SetStateAction<number>>;
  /** Arena Desk content for the right drawer */
  sidebarContent: React.ReactNode;
}

/**
 * The two mobile slide-out drawers: game controls / menu on the left,
 * "Desk & Scorecard" on the right. Ported from App.tsx; both now respect
 * device safe areas so nothing hides behind Android gesture bars.
 */
export function MobileDrawers(props: MobileDrawersProps) {
  const {
    isLeftDrawerOpen, setIsLeftDrawerOpen, isRightDrawerOpen, setIsRightDrawerOpen,
    playMode, handleModeChange, setShowFriendsPage, setShowProfilePage,
    setShowPurchaseModal, setShowPlayerDirectory, fetchPlayersDirectory,
    unreadLoungeCount, muted, setMuted, setShowRules,
    boardTheme, setBoardTheme, clockLimitType, setClockLimitType,
    kenLevelId, setKenLevelId, boardScale, setBoardScale, sidebarContent,
  } = props;

  return (
    <>
      {/* Left Menu Sliding Drawer Overlay (Mobile Only) */}
      <AnimatePresence>
        {isLeftDrawerOpen && (
          <div
            className="fixed inset-0 bg-slate-950/90 z-50 lg:hidden flex justify-start"
            onClick={() => setIsLeftDrawerOpen(false)}
          >
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="w-80 max-w-[85vw] h-full bg-[#070913] border-r border-slate-800 flex flex-col shadow-2xl relative"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer header close button */}
              <div className="flex justify-between items-center p-4 pt-[max(1rem,env(safe-area-inset-top))] border-b border-slate-900 shrink-0 bg-slate-950/50">
                <span className="text-xs font-black uppercase tracking-wider text-slate-300">Game Controls</span>
                <button
                  onClick={() => setIsLeftDrawerOpen(false)}
                  className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Sidebar content */}
              <div className="flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
                <MenuSidebar
                  className="flex flex-col p-4 gap-4 h-full select-none"
                  activeMode={playMode}
                  onSelectMode={(mode) => {
                    handleModeChange(mode);
                    setIsLeftDrawerOpen(false); // Auto-close on selection
                  }}
                  onOpenFriends={() => { setShowFriendsPage(true); setIsLeftDrawerOpen(false); }}
                  onOpenProfile={() => { setShowProfilePage(true); setIsLeftDrawerOpen(false); }}
                  onOpenStore={() => { setShowPurchaseModal(true); setIsLeftDrawerOpen(false); }}
                  onOpenPlayers={() => { setShowPlayerDirectory(true); fetchPlayersDirectory(); setIsLeftDrawerOpen(false); }}
                  unreadLoungeCount={unreadLoungeCount}
                  muted={muted}
                  onToggleMuted={() => setMuted(!muted)}
                  onShowRules={() => {
                    setShowRules(true);
                    setIsLeftDrawerOpen(false);
                  }}
                  boardTheme={boardTheme}
                  onSelectBoardTheme={setBoardTheme}
                  clockLimitType={clockLimitType}
                  onSelectClockLimit={setClockLimitType}
                  kenLevelId={kenLevelId}
                  onSelectKenLevel={setKenLevelId}
                  boardScale={boardScale}
                  onSelectBoardScale={setBoardScale}
                />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Right Scorecard Sliding Drawer Overlay (Mobile Only) */}
      <AnimatePresence>
        {isRightDrawerOpen && (
          <div
            className="fixed inset-0 bg-slate-950/90 z-50 lg:hidden flex justify-end"
            onClick={() => setIsRightDrawerOpen(false)}
          >
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="w-80 max-w-[85vw] h-full bg-[#070913] border-l border-slate-800 flex flex-col shadow-2xl ml-auto relative"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer header close button */}
              <div className="flex justify-between items-center p-4 pt-[max(1rem,env(safe-area-inset-top))] border-b border-slate-900 shrink-0 bg-slate-950/50">
                <span className="text-xs font-black uppercase tracking-wider text-slate-300">Desk & Scorecard</span>
                <button
                  onClick={() => setIsRightDrawerOpen(false)}
                  className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Drawer content */}
              <div className="flex-grow overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-slate-950/60">
                {sidebarContent}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
