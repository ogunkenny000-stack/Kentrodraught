import React from "react";
import { Clock, Hourglass } from "lucide-react";
import { ClockSnapshot, useClockTicker, formatClockMs } from "../lib/useServerClock";

interface ChessClockProps {
  /**
   * Clock snapshot: the server's authoritative ClockState (+ offset) in
   * multiplayer, or the local snapshot for timed games vs Ken. The clock
   * ticks ITSELF from this -- App never holds per-second state.
   */
  clock: ClockSnapshot | null;
  activeColor: "W" | "B" | null;
  limitType: "Blitz" | "Rapid" | "Classical" | "Untimed";
  whiteLabel?: string;
  blackLabel?: string;
}

/** Nominal starting time for a control, shown before any snapshot exists. */
export function nominalClockMs(limitType: "Blitz" | "Rapid" | "Classical" | "Untimed"): number {
  if (limitType === "Rapid") return 600_000;
  if (limitType === "Classical") return 1_200_000;
  if (limitType === "Blitz") return 300_000;
  return 0;
}

function ChessClockImpl({ clock, activeColor, limitType, whiteLabel = "White (You)", blackLabel = "Black (Opponent)" }: ChessClockProps) {
  const reading = useClockTicker(clock);
  const whiteMs = clock ? reading.whiteMs : nominalClockMs(limitType);
  const blackMs = clock ? reading.blackMs : nominalClockMs(limitType);

  const isWhiteActive = activeColor === "W";
  const isBlackActive = activeColor === "B";

  if (limitType === "Untimed") {
    return (
      <div className="flex gap-2 w-full select-none">
        <div className="flex-1 bg-slate-900/40 border border-slate-800/80 rounded-xl p-2 px-3 flex items-center justify-between text-slate-400">
          <span className="text-[10px] font-bold uppercase tracking-wider font-sans">White</span>
          <span className="text-xs font-mono font-bold flex items-center gap-1">
            <Hourglass className="w-3.5 h-3.5 text-slate-500" /> Untimed
          </span>
        </div>
        <div className="flex-1 bg-slate-900/40 border border-slate-800/80 rounded-xl p-2 px-3 flex items-center justify-between text-slate-400">
          <span className="text-[10px] font-bold uppercase tracking-wider font-sans">Black</span>
          <span className="text-xs font-mono font-bold flex items-center gap-1">
            <Hourglass className="w-3.5 h-3.5 text-slate-500" /> Untimed
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5 w-full select-none">
      {/* White Clock */}
      <div className={`flex-1 rounded-xl p-3 border transition-all duration-300 flex flex-col ${
        isWhiteActive
          ? "bg-amber-500/10 border-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.15)] ring-1 ring-amber-500/30"
          : "bg-slate-900/40 border-slate-800/80 text-slate-400"
      }`}>
        <div className="flex justify-between items-center mb-1">
          <span className={`text-[9px] font-bold uppercase tracking-wider font-sans ${isWhiteActive ? "text-amber-400" : "text-slate-500"}`}>
            {whiteLabel}
          </span>
          {isWhiteActive && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping shrink-0" />}
        </div>
        <div className={`text-2xl font-bold font-mono tracking-tight flex items-center justify-between ${
          isWhiteActive ? "text-amber-400" : "text-slate-300"
        }`}>
          <Clock className={`w-4 h-4 ${isWhiteActive ? "text-amber-400" : "text-slate-500"}`} />
          <span>{formatClockMs(whiteMs)}</span>
        </div>
      </div>

      {/* Black Clock */}
      <div className={`flex-1 rounded-xl p-3 border transition-all duration-300 flex flex-col ${
        isBlackActive
          ? "bg-amber-500/10 border-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.15)] ring-1 ring-amber-500/30"
          : "bg-slate-900/40 border-slate-800/80 text-slate-400"
      }`}>
        <div className="flex justify-between items-center mb-1">
          <span className={`text-[9px] font-bold uppercase tracking-wider font-sans ${isBlackActive ? "text-amber-400" : "text-slate-500"}`}>
            {blackLabel}
          </span>
          {isBlackActive && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping shrink-0" />}
        </div>
        <div className={`text-2xl font-bold font-mono tracking-tight flex items-center justify-between ${
          isBlackActive ? "text-amber-400" : "text-slate-300"
        }`}>
          <Clock className={`w-4 h-4 ${isBlackActive ? "text-amber-400" : "text-slate-500"}`} />
          <span>{formatClockMs(blackMs)}</span>
        </div>
      </div>
    </div>
  );
}

// Memoized: its props only change when a NEW snapshot arrives (per move /
// per server event). The per-second re-render happens inside, driven by
// useClockTicker, and never reaches App.
export const ChessClock = React.memo(ChessClockImpl);

/** Just the time text for one side. Ticks itself; drop it into any pill. */
export const ClockText = React.memo(function ClockText({
  clock,
  color,
  limitType = "Blitz",
  className,
}: {
  clock: ClockSnapshot | null;
  color: "W" | "B";
  limitType?: "Blitz" | "Rapid" | "Classical" | "Untimed";
  className?: string;
}) {
  const reading = useClockTicker(clock);
  const ms = clock ? (color === "W" ? reading.whiteMs : reading.blackMs) : nominalClockMs(limitType);
  return <span className={className}>{formatClockMs(ms)}</span>;
});
