import React, { useEffect, useState, useRef } from "react";
import { Crown, Sparkles } from "lucide-react";

interface KentroSplashScreenProps {
  onComplete: () => void;
  canSkip?: boolean;
}

export function KentroSplashScreen({
  onComplete,
  canSkip = true,
}: KentroSplashScreenProps) {
  const [progress, setProgress] = useState(0);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const completedRef = useRef(false);

  const handleFinish = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    setIsFadingOut(true);
    setTimeout(() => {
      onComplete();
    }, 160);
  };

  useEffect(() => {
    // Snappy progress progression from 0 to 100% over 400ms for swift app loading
    const startTime = performance.now();
    const duration = 400; // ms

    let animId: number;
    const updateProgress = (now: number) => {
      const elapsed = now - startTime;
      const pct = Math.min(100, Math.round((elapsed / duration) * 100));
      setProgress(pct);

      if (elapsed < duration) {
        animId = requestAnimationFrame(updateProgress);
      } else {
        setTimeout(handleFinish, 60);
      }
    };

    animId = requestAnimationFrame(updateProgress);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <div
      id="kentro-splash-screen"
      onClick={canSkip ? handleFinish : undefined}
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#0A0D17] text-white select-none overflow-hidden transition-opacity duration-300 ease-out ${
        isFadingOut ? "opacity-0 pointer-events-none" : "opacity-100"
      } ${canSkip ? "cursor-pointer" : ""}`}
    >
      {/* Ambient board-square background pattern */}
      <div
        className="absolute inset-0 opacity-[0.035] pointer-events-none"
        style={{
          backgroundImage:
            "repeating-conic-gradient(#d4a017 0% 25%, transparent 0% 50%)",
          backgroundSize: "80px 80px",
        }}
      />

      {/* Radial golden glow in center */}
      <div className="absolute w-96 h-96 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />

      {/* Content Container */}
      <div className="relative z-10 flex flex-col items-center max-w-sm px-6 text-center">
        {/* Golden Crown Emblem */}
        <div className="relative mb-6 flex items-center justify-center">
          {/* Pulsing halo */}
          <div className="absolute w-24 h-24 rounded-3xl bg-amber-500/20 blur-xl animate-pulse" />

          {/* Badge */}
          <div className="relative w-20 h-20 sm:w-22 sm:h-22 rounded-2xl bg-gradient-to-tr from-amber-600 via-amber-500 to-amber-400 p-[2px] shadow-xl shadow-amber-500/20 flex items-center justify-center">
            <div className="w-full h-full rounded-[14px] bg-slate-950 flex items-center justify-center">
              <Crown className="w-10 h-10 text-amber-400 stroke-[2.4] drop-shadow-[0_2px_10px_rgba(245,158,11,0.5)]" />
            </div>
          </div>

          <Sparkles className="absolute -top-1 -right-1 w-5 h-5 text-amber-300 animate-spin [animation-duration:8s]" />
        </div>

        {/* Title */}
        <h1 className="text-3xl sm:text-4xl font-extrabold uppercase tracking-tight text-white font-sans drop-shadow-md">
          Kentro Draught
        </h1>

        {/* Tagline */}
        <p className="text-xs sm:text-sm text-amber-400/90 font-sans tracking-[0.22em] uppercase mt-2 font-medium">
          Play. Learn. Analyze. Win.
        </p>

        {/* Tournament Badge */}
        <div className="mt-4 px-3.5 py-1 rounded-full bg-slate-900/90 border border-amber-500/30 text-[10px] sm:text-xs font-mono tracking-widest text-amber-300/90 shadow-sm">
          NIGERIAN 10×10 CHAMPIONSHIP
        </div>

        {/* Loading Bar */}
        <div className="w-48 sm:w-56 mt-8 flex flex-col items-center gap-2">
          <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-amber-600 to-amber-400 rounded-full transition-all duration-75 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between w-full text-[10px] font-mono text-slate-400">
            <span>Loading arena...</span>
            <span>{progress}%</span>
          </div>
        </div>

        {/* Tap to skip hint */}
        {canSkip && (
          <span className="mt-6 text-[10px] font-mono tracking-wider text-slate-400 uppercase">
            Tap anywhere to skip
          </span>
        )}
      </div>
    </div>
  );
}
