import React, { useEffect, useId, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { trapDialogFocus } from "../../lib/dialogFocus";

/**
 * ModalShell -- the one responsive dialog container used by every popup in
 * the app. On phones it renders as a full-width bottom sheet (slides up,
 * rounded top corners, drag-handle bar, safe-area padding for Android/iOS
 * gesture bars). On sm+ screens it renders as a classic centered dialog.
 *
 * This replaces the ~10 hand-rolled `fixed inset-0 ...` wrappers that used
 * to live inline in App.tsx, each with slightly different sizing -- several
 * of which could overflow off-screen on short phones with no way to scroll.
 * Body content here is always scrollable and capped at 88dvh.
 */
export function ModalShell({
  open,
  onClose,
  title,
  icon,
  size = "md",
  children,
  footer,
  dismissable = true,
  headerAccent,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  icon?: React.ReactNode;
  /** max width on desktop */
  size?: "sm" | "md" | "lg" | "xl";
  children: React.ReactNode;
  /** optional sticky footer (action buttons) */
  footer?: React.ReactNode;
  /** allow closing via backdrop tap / X button */
  dismissable?: boolean;
  /** optional class applied to the title row (e.g. celebratory colors) */
  headerAccent?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const panel = dialogRef.current;
    if (!panel) return;
    return trapDialogFocus(panel, dismissable ? () => closeRef.current() : undefined);
  }, [open, dismissable]);
  const maxW =
    size === "sm" ? "sm:max-w-sm" : size === "md" ? "sm:max-w-md" : size === "lg" ? "sm:max-w-lg" : "sm:max-w-2xl";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[70] bg-slate-950/90 flex items-end sm:items-center justify-center sm:p-4"
          onClick={dismissable ? onClose : undefined}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? headingId : undefined}
            aria-label={!title ? "Dialog" : undefined}
            tabIndex={-1}
            initial={{ y: 48, scale: 1, opacity: 0.6 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 48, opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 360 }}
            onClick={(e) => e.stopPropagation()}
            className={`k-modal-dialog relative w-full ${maxW} bg-[#0b0e17] border border-slate-800 sm:rounded-3xl rounded-t-3xl shadow-2xl shadow-black/60 flex flex-col max-h-[88dvh] overflow-hidden`}
          >
            {/* Mobile drag-handle affordance */}
            <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0">
              <div className="w-10 h-1 rounded-full bg-slate-700/80" />
            </div>

            {(title || dismissable) && (
              <div className="flex items-center justify-between gap-3 px-5 pt-2 sm:pt-5 pb-3 shrink-0">
                <h3 id={headingId} className={`text-sm sm:text-base font-extrabold flex items-center gap-2.5 min-w-0 ${headerAccent || "text-white"}`}>
                  {icon}
                  <span className="truncate">{title}</span>
                </h3>
                {dismissable && (
                  <button
                    onClick={onClose}
                    className="p-2 -mr-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer shrink-0"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}

            {/* Scrollable body -- pb includes safe-area so content never hides
                behind Android gesture bars in the installed PWA */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              {children}
            </div>

            {footer && (
              <div className="shrink-0 px-5 py-3 border-t border-slate-900 bg-slate-950/60 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
