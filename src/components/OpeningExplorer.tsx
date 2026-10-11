import React from "react";
import { Book, Compass, Sparkles } from "lucide-react";

interface Opening {
  name: string;
  movesPrefix: string[]; // sequence of moves like "32-28", "18-23"
  description: string;
  continuations: { move: string; name: string }[];
}

const OPENINGS_DATABASE: Opening[] = [
  {
    name: "Standard Central Opening",
    movesPrefix: ["32-28"],
    description: "The most popular opening move in professional Nigerian Draughts. White immediately establishes a presence in the critical central columns, preparing to lock the d-line and pivot to either wing.",
    continuations: [
      { move: "18-23", name: "Syd's Crossing (Highly Tactical)" },
      { move: "19-23", name: "Modern Exchange (Symmetrical)" },
      { move: "17-21", name: "Flank Defense (Passive-Solid)" }
    ]
  },
  {
    name: "Syd's Crossing Attack",
    movesPrefix: ["32-28", "18-23"],
    description: "A legendary response. Black aggressively challenges White's central grip. This line is famous in local clubs for producing rapid, sharp multi-capture combinations and tactical 'delayed-removal' tactical lines.",
    continuations: [
      { move: "38-32", name: "Classical Consolidation" },
      { move: "37-32", name: "Aggressive Center Lock" },
      { move: "33-29", name: "The Center Counter-Thrust" }
    ]
  },
  {
    name: "Nigerian Standard Defense",
    movesPrefix: ["32-28", "19-23", "37-32"],
    description: "The quintessential tournament line. White shores up their central pillar at 28 while Black occupies 23, creating a balanced, strategic layout that values solid backing over early gambits.",
    continuations: [
      { move: "14-19", name: "Wing Build-up" },
      { move: "23x32", name: "Instant Trade Line" }
    ]
  },
  {
    name: "Geller Flank Attack",
    movesPrefix: ["34-30"],
    description: "A sharp, modern flank attack. White bypasses the crowded center-left columns to apply pressure on Black's double-corner side. Leads to asymmetric pawn structures and wide-open endgame boards.",
    continuations: [
      { move: "20-25", name: "Instant Wing Block" },
      { move: "18-23", name: "Center Counterplay" }
    ]
  },
  {
    name: "Double Corner Gambit",
    movesPrefix: ["35-30"],
    description: "An hyper-aggressive flank attack from the bottom corner. White invites Black to contest the outer rim. It is highly valued in blitz play for setting early promotion opportunities.",
    continuations: [
      { move: "20-25", name: "Flank Lock" },
      { move: "17-21", name: "Wing Counter-Thrust" }
    ]
  },
  {
    name: "The Cross Opening",
    movesPrefix: ["34-29"],
    description: "An elegant, classical line. White pushes the man to 29, cutting the board diagonally. This allows rapid development of the back rank and limits Black's central jumping diagonals.",
    continuations: [
      { move: "18-23", name: "Central Collision" },
      { move: "17-22", name: "The Diagonal Block" }
    ]
  },
  {
    name: "The Wing Thrust Opening",
    movesPrefix: ["31-27"],
    description: "A cautious, outer-line approach. White plays to the wing, aiming to build a secure wall on the left column. Ideal for players who prefer long-term endgame grinds over immediate tactical fireworks.",
    continuations: [
      { move: "17-21", name: "Symmetrical Wing Lock" },
      { move: "18-22", name: "Center Attack" }
    ]
  },
  {
    name: "Double Corner Gambit Trade",
    movesPrefix: ["35-30", "20-25", "40-35"],
    description: "White double-covers the flank at 30. A classic sacrifice/trade line that opens wide lanes for flying kings.",
    continuations: [
      { move: "15-20", name: "Rear Support" },
      { move: "25x34", name: "Obligatory Swap" }
    ]
  }
];

interface OpeningExplorerProps {
  moveHistoryStrings: string[]; // e.g. ["32-28", "18-23", ...]
  onApplyHint: (moveStr: string) => void;
}

function OpeningExplorerImpl({ moveHistoryStrings, onApplyHint }: OpeningExplorerProps) {
  // Find current matching opening by prefix match
  const findMatchingOpening = (): Opening | null => {
    if (moveHistoryStrings.length === 0) return null;

    // Search from longest prefix to shortest for best match
    for (let i = moveHistoryStrings.length; i > 0; i--) {
      const prefix = moveHistoryStrings.slice(0, i);
      const matched = OPENINGS_DATABASE.find((op) => {
        if (op.movesPrefix.length !== prefix.length) return false;
        return op.movesPrefix.every((mv, idx) => mv === prefix[idx]);
      });
      if (matched) return matched;
    }
    return null;
  };

  const matched = findMatchingOpening();

  return (
    <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3.5 flex flex-col gap-3 select-none flex-grow">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 font-sans">
          <Book className="w-4 h-4 text-amber-500" />
          <span>Opening Book Explorer</span>
        </h3>
        <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/25 px-1.5 py-0.5 rounded font-bold font-mono">
          NIGERIA 10x10
        </span>
      </div>

      {matched ? (
        <div className="flex flex-col gap-2.5">
          <div>
            <h4 className="text-sm font-bold text-white flex items-center gap-1 font-sans">
              <Compass className="w-4 h-4 text-emerald-400 shrink-0" />
              {matched.name}
            </h4>
            <p className="text-[11px] text-slate-300 leading-relaxed font-sans mt-1 bg-slate-950/40 p-2.5 rounded border border-slate-800/40">
              {matched.description}
            </p>
          </div>

          {matched.continuations.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] text-slate-500 font-bold uppercase font-sans tracking-wide block">
                Recommended Continuations
              </span>
              <div className="flex flex-col gap-1">
                {matched.continuations.map((cont, idx) => (
                  <button
                    key={idx}
                    onClick={() => onApplyHint(cont.move)}
                    className="flex items-center justify-between text-left p-2 rounded-lg bg-slate-950/40 border border-slate-850 hover:bg-slate-800 hover:border-slate-700 transition group text-[11px]"
                  >
                    <span className="font-semibold text-slate-300 group-hover:text-white">
                      {cont.name}
                    </span>
                    <span className="font-mono text-xs text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 group-hover:bg-amber-500 group-hover:text-slate-950 transition-colors">
                      {cont.move}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <Sparkles className="w-6 h-6 text-slate-600 mb-2 animate-pulse" />
          <p className="text-xs text-slate-400 font-sans max-w-[240px]">
            {moveHistoryStrings.length === 0 
              ? "Make your first move to open the Nigerian opening book database!" 
              : "Uncharted territory! You are playing a creative custom continuation."}
          </p>
        </div>
      )}
    </div>
  );
}

export const OpeningExplorer = React.memo(OpeningExplorerImpl);
