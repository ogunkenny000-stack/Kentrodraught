import React from "react";
import { Handshake } from "lucide-react";
import { ModalShell } from "../ui/ModalShell";

interface DrawOfferModalProps {
  open: boolean;
  fromUsername?: string;
  onAccept: () => void;
  onDecline: () => void;
}

export function DrawOfferModal({ open, fromUsername, onAccept, onDecline }: DrawOfferModalProps) {
  return (
    <ModalShell open={open} onClose={onDecline} size="sm" dismissable={false}>
      <div className="flex flex-col items-center text-center p-2 gap-4">
        <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
          <Handshake className="w-6 h-6" />
        </div>

        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-bold text-slate-100">Draw Offer</h3>
          <p className="text-sm text-slate-300">
            {fromUsername ? `${fromUsername} has offered a draw.` : "Your opponent has offered a draw."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 w-full mt-2">
          <button
            id="decline-draw-button"
            onClick={onDecline}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-sm transition cursor-pointer border border-slate-700/60"
          >
            DECLINE
          </button>
          <button
            id="accept-draw-button"
            onClick={onAccept}
            className="w-full py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm transition cursor-pointer shadow-lg shadow-amber-600/20"
          >
            ACCEPT
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
