import React, { useEffect, useState } from "react";
import { LucideIcon, ArrowLeft } from "lucide-react";

interface ComingSoonPaneProps {
  icon: LucideIcon;
  title: string;
  description: string;
  featureKey: string;
  onBackToHome?: () => void;
}

function useComingSoonCountdown(key: string) {
  const [remaining, setRemaining] = useState("");
  useEffect(() => {
    const storageKey = `kentro_coming_soon_v10_${key}`;
    let target = localStorage.getItem(storageKey);
    if (!target) {
      target = String(Date.now() + 10 * 24 * 60 * 60 * 1000);
      localStorage.setItem(storageKey, target);
    }
    const targetMs = parseInt(target, 10);
    const tick = () => {
      const diff = Math.max(0, targetMs - Date.now());
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      setRemaining(diff <= 0 ? "Coming very soon" : `${days}d ${hours}h ${mins}m`);
    };
    tick();
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, [key]);
  return remaining;
}

export function ComingSoonPane({ icon: Icon, title, description, featureKey, onBackToHome }: ComingSoonPaneProps) {
  const countdown = useComingSoonCountdown(featureKey);
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#070913] p-6 relative">
      {onBackToHome && (
        <button
          onClick={onBackToHome}
          className="absolute top-6 left-6 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold text-amber-400 hover:bg-slate-800 transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 text-amber-400" />
          <span>Back to Home</span>
        </button>
      )}
      <div className="flex flex-col items-center text-center max-w-xs gap-3">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-600/20 to-amber-500/5 border border-amber-500/30 flex items-center justify-center mb-1">
          <Icon className="w-7 h-7 text-amber-400" />
        </div>
        <h2 className="text-lg font-extrabold text-white font-sans">{title}</h2>
        <p className="text-xs text-slate-500 font-sans leading-relaxed">{description}</p>
        <div className="mt-2 bg-slate-900 border border-amber-500/30 rounded-full px-4 py-1.5 text-xs font-bold text-amber-400 font-sans">
          {countdown}
        </div>
        {onBackToHome && (
          <button
            onClick={onBackToHome}
            className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs font-bold text-amber-400 hover:bg-amber-500/20 transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Home</span>
          </button>
        )}
      </div>
    </div>
  );
}
