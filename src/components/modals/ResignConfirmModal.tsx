import React from "react";
import { Flag, X, AlertTriangle } from "lucide-react";
import { ModalShell } from "../ui/ModalShell";

interface ResignConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirmResign: () => void;
}

export function ResignConfirmModal({ open, onClose, onConfirmResign }: ResignConfirmModalProps) {
  return (
    <ModalShell open={open} onClose={onClose} size="sm">
      <div className="flex flex-col items-center text-center p-2 gap-4">
        <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
          <Flag className="w-6 h-6" />
        </div>

        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-bold text-slate-100">Resign Game?</h3>
          <p className="text-sm text-slate-400">Are you sure you want to resign?</p>
        </div>

        <div className="grid grid-cols-2 gap-3 w-full mt-2">
          <button
            id="cancel-resign-button"
            onClick={onClose}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-sm transition cursor-pointer border border-slate-700/60"
          >
            CANCEL
          </button>
          <button
            id="confirm-resign-button"
            onClick={onConfirmResign}
            className="w-full py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm transition cursor-pointer shadow-lg shadow-rose-600/20"
          >
            RESIGN
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
