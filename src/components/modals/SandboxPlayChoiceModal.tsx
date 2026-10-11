import { useEffect, useState } from "react";
import { Cpu, Swords, ArrowLeft } from "lucide-react";
import { ModalShell } from "../ui/ModalShell";

interface SandboxPlayChoiceModalProps {
  open: boolean;
  onClose: () => void;
  onPlayVsAI: () => void;
  onPlayVsHuman: () => void;
  editorTurn: "W" | "B";
  setEditorTurn: (t: "W" | "B") => void;
}

/**
 * Two-step launcher for a position built in the editor:
 *   1) Who is the opponent? (Ken AI / another player)
 *   2) Who moves first? (White / Black)
 * Works with any number of pieces on the board -- 5 or 20, no minimum.
 */
export function SandboxPlayChoiceModal({ open, onClose, onPlayVsAI, onPlayVsHuman, editorTurn, setEditorTurn }: SandboxPlayChoiceModalProps) {
  const [opponent, setOpponent] = useState<"ai" | "human" | null>(null);

  useEffect(() => {
    if (open) setOpponent(null); // fresh flow every time it opens
  }, [open]);

  return (
    <ModalShell open={open} onClose={onClose} size="sm" title="Play This Position">
      {opponent === null ? (
        <>
          <p className="text-[11px] text-slate-500 text-center -mt-2 mb-4">Step 1 of 2 — who do you want to play against?</p>
          <div className="flex flex-col gap-3 pb-1">
            <button
              onClick={() => setOpponent("ai")}
              className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-3.5 rounded-xl transition text-xs uppercase tracking-wide cursor-pointer flex items-center justify-center gap-2"
            >
              <Cpu className="w-4 h-4" /> Play vs AI
            </button>
            <button
              onClick={() => setOpponent("human")}
              className="w-full bg-slate-800 hover:bg-slate-750 text-white font-bold py-3.5 rounded-xl transition text-xs uppercase tracking-wide cursor-pointer flex items-center justify-center gap-2"
            >
              <Swords className="w-4 h-4" /> Play vs Another Player
            </button>
            <button
              onClick={onClose}
              className="text-[11px] text-slate-500 hover:text-slate-300 text-center mt-1 cursor-pointer py-2"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[11px] text-slate-500 text-center -mt-2 mb-4">Step 2 of 2 — who makes the first move?</p>
          <div className="flex flex-col gap-3 pb-1">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setEditorTurn("W")}
                className={`py-4 rounded-xl border font-bold text-xs uppercase tracking-wide transition cursor-pointer flex flex-col items-center gap-2 ${
                  editorTurn === "W"
                    ? "bg-amber-500/10 border-amber-500 text-amber-300"
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                <span className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-50 to-amber-200 border border-amber-300" />
                White first
              </button>
              <button
                onClick={() => setEditorTurn("B")}
                className={`py-4 rounded-xl border font-bold text-xs uppercase tracking-wide transition cursor-pointer flex flex-col items-center gap-2 ${
                  editorTurn === "B"
                    ? "bg-amber-500/10 border-amber-500 text-amber-300"
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                <span className="w-6 h-6 rounded-full bg-gradient-to-br from-neutral-800 to-neutral-950 border border-neutral-700" />
                Black first
              </button>
            </div>

            <button
              onClick={() => (opponent === "ai" ? onPlayVsAI() : onPlayVsHuman())}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 rounded-xl transition text-xs uppercase tracking-wide cursor-pointer flex items-center justify-center gap-2"
            >
              {opponent === "ai" ? <Cpu className="w-4 h-4" /> : <Swords className="w-4 h-4" />}
              Start Match — {editorTurn === "W" ? "White" : "Black"} plays first
            </button>

            <button
              onClick={() => setOpponent(null)}
              className="text-[11px] text-slate-500 hover:text-slate-300 text-center cursor-pointer py-2 flex items-center justify-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" /> Back
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
