import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { MenuSidebar } from "../MenuSidebar";
import { PlayMode, BoardTheme } from "../../types";
import { isTopmostDialog } from "../../lib/dialogFocus";

function useDrawerFocus(open: boolean, ref: { current: HTMLDivElement | null }) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => ref.current?.focus());
    const onTab = (event: KeyboardEvent) => {
      const panel = ref.current;
      if (!panel || event.key !== "Tab") return;
      if (!isTopmostDialog(panel)) return;
      const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])'))
        .filter(element => element.getClientRects().length > 0 && element.tabIndex >= 0);
      if (!controls.length) { event.preventDefault(); panel.focus(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onTab);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", onTab); previous?.focus(); };
  }, [open, ref]);
}

export interface MobileDrawersProps {
  isLeftDrawerOpen: boolean;
  setIsLeftDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isRightDrawerOpen: boolean;
  setIsRightDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  playMode: PlayMode;
  handleModeChange: (mode: PlayMode) => void;
  onOpenFriends: () => void;
  onOpenProfile: () => void;
  onOpenStore: () => void;
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
  onSelectKenLevel?: (id: number) => void;
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
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  useDrawerFocus(props.isLeftDrawerOpen, leftRef);
  useDrawerFocus(props.isRightDrawerOpen, rightRef);
  const {
    isLeftDrawerOpen, setIsLeftDrawerOpen, isRightDrawerOpen, setIsRightDrawerOpen,
    playMode, handleModeChange, onOpenFriends, onOpenProfile,
    onOpenStore, setShowPlayerDirectory, fetchPlayersDirectory,
    unreadLoungeCount, muted, setMuted, setShowRules,
    boardTheme, setBoardTheme, clockLimitType, setClockLimitType,
    kenLevelId, setKenLevelId, onSelectKenLevel, boardScale, setBoardScale, sidebarContent,
  } = props;

  useEffect(() => {
    if (!isLeftDrawerOpen && !isRightDrawerOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (leftRef.current && isTopmostDialog(leftRef.current)) setIsLeftDrawerOpen(false);
      else if (rightRef.current && isTopmostDialog(rightRef.current)) setIsRightDrawerOpen(false);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [isLeftDrawerOpen, isRightDrawerOpen, setIsLeftDrawerOpen, setIsRightDrawerOpen]);

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
              ref={leftRef}
              tabIndex={-1}
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              role="dialog" aria-modal="true" aria-label="Navigation menu"
              className="k-drawer-panel w-80 max-w-[85vw] h-full bg-[#070913] border-r border-slate-800 flex flex-col shadow-2xl relative"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer header close button */}
              <div className="flex justify-between items-center p-4 pt-[max(1rem,env(safe-area-inset-top))] border-b border-slate-900 shrink-0 bg-slate-950/50">
                <span className="text-xs font-black uppercase tracking-wider text-slate-300">Navigation</span>
                <button
                  onClick={() => setIsLeftDrawerOpen(false)}
                  aria-label="Close navigation"
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
                  onOpenFriends={() => { onOpenFriends(); setIsLeftDrawerOpen(false); }}
                  onOpenProfile={() => { onOpenProfile(); setIsLeftDrawerOpen(false); }}
                  onOpenStore={() => { onOpenStore(); setIsLeftDrawerOpen(false); }}
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
                  onSelectKenLevel={onSelectKenLevel || setKenLevelId}
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
              ref={rightRef}
              tabIndex={-1}
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              role="dialog" aria-modal="true" aria-label="Match details"
              className="k-drawer-panel w-80 max-w-[85vw] h-full bg-[#070913] border-l border-slate-800 flex flex-col shadow-2xl ml-auto relative"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer header close button */}
              <div className="flex justify-between items-center p-4 pt-[max(1rem,env(safe-area-inset-top))] border-b border-slate-900 shrink-0 bg-slate-950/50">
                <span className="text-xs font-black uppercase tracking-wider text-slate-300">Match details</span>
                <button
                  onClick={() => setIsRightDrawerOpen(false)}
                  aria-label="Close match details"
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
