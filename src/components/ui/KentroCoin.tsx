import React, { useState } from "react";
import coinImage from "../../assets/images/kentro_gold_coin_1787044207657.jpg";
import coinStackImage from "../../assets/images/kentro_coin_stack_1787044217748.jpg";

export type CoinSize = "2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | number;

interface KentroCoinProps {
  size?: CoinSize;
  className?: string;
  animate?: boolean;
  spin?: boolean;
  glow?: boolean;
  interactive?: boolean;
  title?: string;
}

const sizeMap: Record<string, { px: number; text: string; crownSize: number }> = {
  "2xs": { px: 14, text: "text-[8px]", crownSize: 8 },
  xs: { px: 18, text: "text-[10px]", crownSize: 10 },
  sm: { px: 22, text: "text-xs", crownSize: 12 },
  md: { px: 28, text: "text-sm", crownSize: 14 },
  lg: { px: 38, text: "text-lg", crownSize: 18 },
  xl: { px: 52, text: "text-2xl", crownSize: 26 },
  "2xl": { px: 76, text: "text-4xl", crownSize: 38 },
  "3xl": { px: 110, text: "text-6xl", crownSize: 54 },
};

export function KentroCoin({
  size = "sm",
  className = "",
  animate = false,
  spin = false,
  glow = false,
  interactive = false,
  title = "Kentro Coin",
}: KentroCoinProps) {
  const [imgFailed, setImgFailed] = useState(false);

  const dimension = typeof size === "number" ? size : sizeMap[size]?.px ?? 22;

  // Ultra-detailed Vector Fallback in case of asset loading delay
  if (imgFailed) {
    return (
      <span
        title={title}
        style={{ width: dimension, height: dimension }}
        className={`relative inline-flex items-center justify-center shrink-0 rounded-full select-none ${
          glow ? "shadow-[0_0_12px_rgba(245,158,11,0.5)]" : ""
        } ${spin ? "animate-[spin_4s_linear_infinite]" : ""} ${className}`}
      >
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full drop-shadow-md transition-transform duration-300 hover:scale-105"
        >
          <defs>
            <radialGradient id="kcGoldGrad" cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#FFF9D2" />
              <stop offset="25%" stopColor="#FCD34D" />
              <stop offset="55%" stopColor="#F59E0B" />
              <stop offset="85%" stopColor="#B45309" />
              <stop offset="100%" stopColor="#78350F" />
            </radialGradient>
            <linearGradient id="kcRimGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FDE68A" />
              <stop offset="40%" stopColor="#D97706" />
              <stop offset="70%" stopColor="#FEF08A" />
              <stop offset="100%" stopColor="#92400E" />
            </linearGradient>
            <linearGradient id="kcSheenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.7)" />
              <stop offset="35%" stopColor="rgba(255,255,255,0.1)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
          </defs>

          {/* Outer Milled Rim */}
          <circle cx="50" cy="50" r="48" fill="url(#kcRimGrad)" stroke="#78350F" strokeWidth="1.5" />
          
          {/* Ridges pattern along circumference */}
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="#FEF08A"
            strokeWidth="1"
            strokeDasharray="2, 2.5"
            opacity="0.8"
          />

          {/* Main Gold Face with Depth */}
          <circle cx="50" cy="50" r="42" fill="url(#kcGoldGrad)" />

          {/* Inner Inset Ring */}
          <circle
            cx="50"
            cy="50"
            r="36"
            fill="none"
            stroke="#78350F"
            strokeWidth="1.5"
            opacity="0.6"
          />
          <circle
            cx="50"
            cy="50"
            r="35"
            fill="none"
            stroke="#FEF08A"
            strokeWidth="1"
            opacity="0.7"
          />

          {/* Center Crown & Draughts Emblem */}
          <path
            d="M 32 60 L 32 50 L 38 54 L 50 38 L 62 54 L 68 50 L 68 60 Z"
            fill="#78350F"
            opacity="0.4"
          />
          <path
            d="M 33 59 L 33 49 L 39 53 L 50 37 L 61 53 L 67 49 L 67 59 Z"
            fill="#FEF08A"
            stroke="#92400E"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          {/* Crown Jewels */}
          <circle cx="33" cy="47" r="2" fill="#FFFFFF" />
          <circle cx="50" cy="35" r="2.5" fill="#FFFFFF" />
          <circle cx="67" cy="47" r="2" fill="#FFFFFF" />

          {/* Draughts token underneath crown */}
          <ellipse cx="50" cy="65" rx="14" ry="4" fill="#92400E" opacity="0.6" />
          <ellipse cx="50" cy="64" rx="14" ry="4" fill="#FDE68A" stroke="#78350F" strokeWidth="0.8" />
          <ellipse cx="50" cy="63" rx="10" ry="2.5" fill="#F59E0B" />

          {/* Specular curved reflection across top-left */}
          <path
            d="M 18 36 A 42 42 0 0 1 76 18 A 38 38 0 0 0 18 36 Z"
            fill="url(#kcSheenGrad)"
          />
        </svg>
      </span>
    );
  }

  return (
    <span
      title={title}
      style={{ width: dimension, height: dimension }}
      className={`group relative inline-flex items-center justify-center shrink-0 select-none ${
        glow ? "filter drop-shadow-[0_0_10px_rgba(245,158,11,0.65)]" : "filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.45)]"
      } ${interactive ? "transition-all duration-300 hover:scale-110 active:scale-95 cursor-pointer" : ""} ${className}`}
    >
      <img
        src={coinImage}
        alt={title}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className={`w-full h-full object-cover rounded-full pointer-events-none ring-1 ring-amber-300/40 shadow-inner ${
          spin ? "animate-[spin_4s_linear_infinite]" : ""
        } ${animate ? "animate-pulse" : ""}`}
      />
      {/* Dynamic light sheen overlay */}
      <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/20 to-amber-200/40 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      {/* Specular rim sparkle */}
      <span className="absolute top-[8%] left-[14%] w-[20%] h-[20%] rounded-full bg-white/60 blur-[1px] pointer-events-none" />
    </span>
  );
}

/**
 * High-Prestige Coin Stack for store packages & tournament prize pools
 */
export function KentroCoinStack({
  size = "md",
  className = "",
  glow = true,
}: {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  glow?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const pxMap = { sm: 40, md: 58, lg: 84, xl: 110 };
  const dim = pxMap[size] || 58;

  if (failed) {
    return (
      <div className={`flex -space-x-4 items-center justify-center ${className}`}>
        <KentroCoin size={size === "xl" ? "2xl" : size === "lg" ? "xl" : "lg"} glow={glow} />
        <KentroCoin size={size === "xl" ? "2xl" : size === "lg" ? "xl" : "lg"} glow={glow} className="translate-y-1" />
        <KentroCoin size={size === "xl" ? "2xl" : size === "lg" ? "xl" : "lg"} glow={glow} className="translate-y-2" />
      </div>
    );
  }

  return (
    <div
      style={{ width: dim, height: dim }}
      className={`relative flex items-center justify-center shrink-0 ${
        glow ? "filter drop-shadow-[0_0_16px_rgba(245,158,11,0.55)]" : "filter drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)]"
      } ${className}`}
    >
      <img
        src={coinStackImage}
        alt="Kentro Coins Stack"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-full h-full object-contain rounded-2xl pointer-events-none transform transition-transform duration-300 hover:scale-105"
      />
    </div>
  );
}

interface CoinBadgeProps {
  amount: number | string;
  size?: "xs" | "sm" | "md" | "lg";
  onClick?: () => void;
  showPlus?: boolean;
  label?: string;
  className?: string;
  highlight?: boolean;
}

/**
 * Flashy, luxury coin pill with animated metallic gold luster and crisp typography
 */
export function CoinBadge({
  amount,
  size = "md",
  onClick,
  showPlus = false,
  label,
  className = "",
  highlight = false,
}: CoinBadgeProps) {
  const formatted = typeof amount === "number" ? amount.toLocaleString() : amount;

  const sizeClasses = {
    xs: "px-2 py-0.5 text-[11px] gap-1 rounded-lg",
    sm: "px-2.5 py-1 text-xs gap-1.5 rounded-xl",
    md: "px-3 py-1.5 text-sm gap-2 rounded-xl",
    lg: "px-4 py-2 text-base gap-2.5 rounded-2xl",
  };

  const coinSizes: Record<string, CoinSize> = {
    xs: "xs",
    sm: "sm",
    md: "md",
    lg: "lg",
  };

  const isInteractive = typeof onClick === "function";

  const Comp = isInteractive ? "button" : "div";

  return (
    <Comp
      {...(isInteractive ? { onClick, type: "button" } : {})}
      className={`group relative inline-flex items-center font-sans font-extrabold tracking-tight transition-all duration-200 border ${
        isInteractive ? "cursor-pointer active:scale-95" : ""
      } ${
        highlight
          ? "bg-gradient-to-r from-amber-950/80 via-amber-900/60 to-amber-950/80 border-amber-400/60 text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.3)] hover:border-amber-300"
          : "bg-slate-950/90 hover:bg-slate-900/95 border-amber-500/30 hover:border-amber-400/50 text-amber-300 shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
      } ${sizeClasses[size]} ${className}`}
    >
      {/* Shiny ambient sheen sweep background */}
      <span className="absolute inset-0 rounded-inherit bg-gradient-to-r from-transparent via-amber-400/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 pointer-events-none" />

      {/* Real 3D Coin Icon */}
      <KentroCoin size={coinSizes[size]} glow interactive={false} />

      {/* Label and Value */}
      <div className="flex items-baseline gap-1 leading-none">
        {label && (
          <span className="text-[10px] text-amber-400/80 uppercase font-mono tracking-wider font-semibold">
            {label}:
          </span>
        )}
        <span className="font-extrabold text-amber-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] font-sans">
          {formatted}
        </span>
      </div>

      {/* Plus action icon if interactive */}
      {showPlus && (
        <span className="ml-0.5 w-4 h-4 rounded-full bg-amber-500/20 group-hover:bg-amber-500/30 border border-amber-400/40 flex items-center justify-center text-amber-300 text-[11px] leading-none transition-colors">
          +
        </span>
      )}
    </Comp>
  );
}

/**
 * Flashy inline coin price tag for unlock buttons / wager selectors
 */
export function CoinPriceTag({
  amount,
  size = "sm",
  className = "",
}: {
  amount: number | string;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const formatted = typeof amount === "number" ? amount.toLocaleString() : amount;
  return (
    <span
      className={`inline-flex items-center gap-1 font-bold text-amber-300 font-sans tracking-tight bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-0.5 ${
        size === "xs" ? "text-[10px]" : size === "sm" ? "text-xs" : "text-sm"
      } ${className}`}
    >
      <KentroCoin size={size === "xs" ? "2xs" : size === "sm" ? "xs" : "sm"} />
      <span className="font-extrabold text-amber-200">{formatted}</span>
    </span>
  );
}
