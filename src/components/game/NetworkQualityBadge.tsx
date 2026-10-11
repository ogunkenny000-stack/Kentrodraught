import React, { useState } from "react";
import { Activity, WifiOff } from "lucide-react";
import type { NetworkQualityStats } from "../../lib/useWebRTCCall";

export interface NetworkQualityBadgeProps {
  networkQuality?: NetworkQualityStats;
  compact?: boolean;
}

const DEFAULT_QUALITY: NetworkQualityStats = {
  iceState: "new",
  rttMs: null,
  level: "checking",
};

export const NetworkQualityBadge: React.FC<NetworkQualityBadgeProps> = ({
  networkQuality = DEFAULT_QUALITY,
  compact = false,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const { iceState, rttMs, level, candidateType, packetLossPercent } = networkQuality;

  // Compute number of active signal bars (1-4)
  const activeBars =
    level === "excellent"
      ? 4
      : level === "good"
      ? 3
      : level === "fair"
      ? 2
      : level === "poor"
      ? 1
      : 0;

  const barColor =
    level === "excellent"
      ? "bg-emerald-400"
      : level === "good"
      ? "bg-teal-400"
      : level === "fair"
      ? "bg-amber-400"
      : level === "poor"
      ? "bg-rose-400"
      : "bg-slate-600";

  const textColor =
    level === "excellent"
      ? "text-emerald-400"
      : level === "good"
      ? "text-teal-400"
      : level === "fair"
      ? "text-amber-400"
      : level === "poor"
      ? "text-rose-400"
      : "text-slate-400";

  const borderColor =
    level === "excellent"
      ? "border-emerald-500/30 bg-emerald-500/10"
      : level === "good"
      ? "border-teal-500/30 bg-teal-500/10"
      : level === "fair"
      ? "border-amber-500/30 bg-amber-500/10"
      : level === "poor"
      ? "border-rose-500/30 bg-rose-500/10"
      : "border-slate-700 bg-slate-900/60";

  const levelLabel =
    level === "excellent"
      ? "Excellent"
      : level === "good"
      ? "Good"
      : level === "fair"
      ? "Fair"
      : level === "poor"
      ? "Poor"
      : level === "disconnected"
      ? "Disconnected"
      : "Checking...";

  const tooltipSummary =
    level === "excellent"
      ? "Ultra-low latency, optimal streaming quality"
      : level === "good"
      ? "Stable connection, low jitter"
      : level === "fair"
      ? "Moderate latency, calls remain clear"
      : level === "poor"
      ? "High latency or packet loss detected"
      : level === "disconnected"
      ? "Connection interrupted — restarting the network path automatically"
      : iceState === "unknown" || iceState === "new"
      ? "Waiting for the peer connection to start..."
      : "Analyzing WebRTC connection path...";

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={() => setShowTooltip((v) => !v)}
    >
      <button
        type="button"
        className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded border transition-all cursor-pointer select-none ${borderColor} hover:brightness-110`}
        title={`Network: ${levelLabel} (${rttMs !== null ? `${rttMs}ms` : iceState})`}
      >
        {/* Signal Bars or Disconnected / Checking Icon */}
        {level === "disconnected" ? (
          <WifiOff className="w-3 h-3 text-rose-400 animate-pulse shrink-0" />
        ) : level === "checking" && rttMs === null ? (
          <Activity className="w-3 h-3 text-amber-400 animate-pulse shrink-0" />
        ) : (
          <div className="flex items-end gap-[1.5px] h-3 px-0.5 shrink-0" aria-hidden="true">
            <span
              className={`w-[2.5px] rounded-t-[1px] transition-all duration-300 ${
                activeBars >= 1 ? barColor : "bg-slate-700/60"
              } h-[3px]`}
            />
            <span
              className={`w-[2.5px] rounded-t-[1px] transition-all duration-300 ${
                activeBars >= 2 ? barColor : "bg-slate-700/60"
              } h-[6px]`}
            />
            <span
              className={`w-[2.5px] rounded-t-[1px] transition-all duration-300 ${
                activeBars >= 3 ? barColor : "bg-slate-700/60"
              } h-[9px]`}
            />
            <span
              className={`w-[2.5px] rounded-t-[1px] transition-all duration-300 ${
                activeBars >= 4 ? barColor : "bg-slate-700/60"
              } h-[12px]`}
            />
          </div>
        )}

        {/* Latency / Ping Number in standard view */}
        {!compact && (
          <span className={`text-[9px] font-mono font-bold leading-none ${textColor}`}>
            {rttMs !== null ? `${rttMs}ms` : iceState === "connected" || iceState === "completed" ? "OK" : "~ms"}
          </span>
        )}
      </button>

      {/* Floating Detailed Popover Tooltip */}
      {showTooltip && (
        <div className="absolute top-full left-0 mt-1.5 z-50 w-52 p-2.5 bg-slate-900/95 border border-slate-700/80 rounded-xl shadow-2xl backdrop-blur-xl text-left pointer-events-auto select-none animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${barColor}`} />
              Network Quality
            </span>
            <span className={`text-[10px] font-bold ${textColor}`}>{levelLabel}</span>
          </div>

          <div className="space-y-1 text-[10px] font-mono text-slate-300">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Round-Trip:</span>
              <span className={`font-bold ${textColor}`}>
                {rttMs !== null ? `${rttMs} ms` : "Calculating..."}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">ICE State:</span>
              <span className="text-slate-200 capitalize font-medium">{iceState}</span>
            </div>
            {candidateType && (
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Path:</span>
                <span className="text-slate-200 uppercase font-medium text-[9px]">
                  {candidateType === "relay" ? "TURN Relay" : `${candidateType} (P2P)`}
                </span>
              </div>
            )}
            {packetLossPercent !== null && packetLossPercent !== undefined && (
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Packet Loss:</span>
                <span className={packetLossPercent > 5 ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>
                  {packetLossPercent}%
                </span>
              </div>
            )}
          </div>

          <p className="mt-2 pt-1.5 border-t border-slate-800/80 text-[9px] text-slate-400 leading-tight">
            {tooltipSummary}
          </p>
        </div>
      )}
    </div>
  );
};
