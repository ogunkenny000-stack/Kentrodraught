import React from "react";
import { motion } from "motion/react";

interface EvaluationBarProps {
  score: number; // in centipawns
  isFlipped: boolean;
  visible: boolean;
  available?: boolean;
}

function EvaluationBarImpl({ score, isFlipped, visible, available = true }: EvaluationBarProps) {
  if (!visible) return null;

  // Clamp score between -1000 (Black is winning) and +1000 (White is winning)
  if (!available) score = 0;
  const cappedScore = Math.max(-1000, Math.min(1000, score));
  
  // Convert centipawns to decimal score (e.g. +1.2)
  const decimalScore = (Math.abs(score) / 100).toFixed(1);
  const formattedScore = score === 0 ? "0.0" : score > 0 ? `+${decimalScore}` : `-${decimalScore}`;

  // White occupies 0% to 100% of the bar height
  const rawPercentage = ((cappedScore + 1000) / 2000) * 100;
  
  // If board is flipped, Black is at the bottom and White is at the top
  const whitePercentage = rawPercentage;

  return (
    <div
      className="w-7 sm:w-8 h-full bg-slate-950 border-2 border-slate-800 rounded-xl overflow-hidden flex flex-col relative shrink-0 select-none shadow-xl"
      title={available ? `Engine estimate from White’s perspective: ${formattedScore}` : "No completed evaluation for this position"}
    >
      {/* Black Zone (top in standard view) */}
      <div className="absolute inset-0 bg-neutral-900" />

      {/* White Zone (smooth animated height) */}
      <motion.div
        className={`absolute ${isFlipped ? 'top-0' : 'bottom-0'} left-0 right-0 bg-slate-100`}
        initial={{ height: "50%" }}
        animate={{ height: `${whitePercentage}%` }}
        transition={{ type: "spring", stiffness: 90, damping: 22 }}
      />

      {/* 50% Equilibrium Baseline Mark */}
      <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-amber-500/60 z-10 pointer-events-none -translate-y-1/2" />

      {/* Numeric Indicator */}
      <div
        className={`absolute left-0 right-0 text-center font-mono text-[9px] sm:text-[10px] font-black pointer-events-none z-20 flex justify-center items-center ${
          isFlipped ? "top-1.5 text-slate-950" : "bottom-1.5 text-slate-950"
        }`}
      >
        {available ? formattedScore : "—"}
      </div>
    </div>
  );
}

export const EvaluationBar = React.memo(EvaluationBarImpl);
