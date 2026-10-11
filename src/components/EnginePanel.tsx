import React from "react";
import { Cpu, Loader2, Gauge, TrendingUp } from "lucide-react";

interface EnginePanelProps {
  score: number; // in centipawns
  depth: number;
  pv: string;
  isThinking: boolean;
  visible: boolean;
}

function EnginePanelImpl({ score, depth, pv, isThinking, visible }: EnginePanelProps) {
  if (!visible) return null;

  // Convert SCAN PV string (e.g. "35-30 20-25") to Nigerian coordinates
  const translatePvToNigerian = (pvStr: string): string => {
    if (!pvStr) return "Calculating...";
    
    // Replace all numbers in the PV string (self-inverse SCAN -> NG mapping)
    return pvStr.replace(/\d+/g, (m) => {
      const n = parseInt(m, 10);
      const rb = Math.floor((n - 1) / 5) * 5 + 1;
      const ngSq = 2 * rb + 4 - n;
      return String(ngSq);
    });
  };

  const decimalScore = (score / 100).toFixed(2);
  const formattedScore = score >= 0 ? `+${decimalScore}` : decimalScore;

  return (
    <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3.5 flex flex-col gap-2.5 select-none shrink-0">
      <div className="flex items-center justify-between border-b border-slate-850 pb-2">
        <div className="flex items-center gap-1.5">
          <Cpu className={`w-4 h-4 ${isThinking ? "text-amber-400 animate-spin" : "text-amber-500"}`} />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 font-sans">
            Ken Live Engine
          </span>
        </div>
        {isThinking ? (
          <span className="text-[9px] bg-amber-500/15 text-amber-400 border border-amber-500/25 px-1.5 py-0.5 rounded font-bold animate-pulse flex items-center gap-1">
            <Loader2 className="w-2.5 h-2.5 animate-spin" /> Thinking
          </span>
        ) : (
          <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-bold">
            Ready
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
        {/* Score Card */}
        <div className="bg-slate-950/40 border border-slate-850 rounded-lg p-2 flex items-center justify-between">
          <span className="text-slate-500 text-[10px] uppercase font-bold flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-emerald-400" /> Eval
          </span>
          <span className={`font-bold ${score >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {formattedScore}
          </span>
        </div>

        {/* Depth Card */}
        <div className="bg-slate-950/40 border border-slate-850 rounded-lg p-2 flex items-center justify-between">
          <span className="text-slate-500 text-[10px] uppercase font-bold flex items-center gap-1">
            <Gauge className="w-3 h-3 text-indigo-400" /> Depth
          </span>
          <span className="font-bold text-indigo-300">
            {depth > 0 ? `${depth}/20` : "—"}
          </span>
        </div>
      </div>

      {/* PV line */}
      <div className="bg-slate-950/50 rounded-lg p-2.5 border border-slate-850 flex flex-col gap-1.5">
        <span className="text-[9px] text-slate-500 uppercase font-bold font-sans tracking-wide block">
          Calculated Line (Best Moves)
        </span>
        <p className="font-mono text-[11px] text-amber-200/90 leading-relaxed break-all bg-slate-900/60 p-1.5 rounded border border-slate-850/60">
          {translatePvToNigerian(pv)}
        </p>
      </div>
    </div>
  );
}

export const EnginePanel = React.memo(EnginePanelImpl);
