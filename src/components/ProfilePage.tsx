import React, { useEffect, useRef, useState } from "react";
import { X, Crown, TrendingUp, Calendar, Award, Banknote, Camera, LogOut } from "lucide-react";
import { PlayerStats } from "../types";
import { apiGet } from "../apiClient";
import { KentroCoin, CoinBadge } from "./ui/KentroCoin";

interface ProfilePageProps {
  username: string;
  profileStats: PlayerStats;
  coinBalance: number;
  memberSince: string | null; // creation timestamp string from the Supabase Auth user, or null if unavailable
  onClose: () => void;
  /** Persist a new avatar (small data-URL); rejects on failure. */
  onSaveAvatar: (dataUrl: string) => Promise<void>;
  onSignOut?: () => void;
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
      setRemaining(diff <= 0 ? "Coming very soon" : `${days}d ${hours}h`);
    };
    tick();
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, [key]);
  return remaining;
}

export function ProfilePage({ username, profileStats, coinBalance, memberSince, onClose, onSaveAvatar, onSignOut }: ProfilePageProps) {
  const [lifetimeCoinsPurchased, setLifetimeCoinsPurchased] = useState<number | null>(null);
  const [loadingWallet, setLoadingWallet] = useState(true);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // Downscale the chosen photo to a tiny square JPEG data-URL (~10-20KB)
  // client-side, then hand it to the app to persist on the profile row.
  const handleAvatarFile = async (file: File) => {
    setAvatarError(null);
    if (!file.type.startsWith("image/")) { setAvatarError("Pick an image file."); return; }
    setAvatarBusy(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          try {
            const SIZE = 128;
            const canvas = document.createElement("canvas");
            canvas.width = SIZE;
            canvas.height = SIZE;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Canvas unavailable");
            // Cover-crop to a centered square before scaling down.
            const side = Math.min(img.width, img.height);
            const sx = (img.width - side) / 2;
            const sy = (img.height - side) / 2;
            ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
            resolve(canvas.toDataURL("image/jpeg", 0.82));
          } catch (err) {
            reject(err);
          } finally {
            URL.revokeObjectURL(url);
          }
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image.")); };
        img.src = url;
      });
      if (dataUrl.length > 120_000) throw new Error("That image compressed unusually large -- try a different one.");
      await onSaveAvatar(dataUrl);
    } catch (e: any) {
      setAvatarError(e?.message || "Could not save your photo. Try again.");
    } finally {
      setAvatarBusy(false);
    }
  };
  const withdrawCountdown = useComingSoonCountdown("withdrawals");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet(`/api/coins/wallet/${encodeURIComponent(username.toLowerCase().trim())}`);
        if (!cancelled) setLifetimeCoinsPurchased(data.lifetimeCoinsPurchased ?? 0);
      } catch {
        if (!cancelled) setLifetimeCoinsPurchased(null); // shown as "--" below rather than a possibly-wrong 0
      } finally {
        if (!cancelled) setLoadingWallet(false);
      }
    })();
    return () => { cancelled = true; };
  }, [username]);

  const winRate = profileStats.gamesCount > 0 ? Math.round((profileStats.wins / profileStats.gamesCount) * 100) : 0;
  const joinedLabel = memberSince
    ? new Date(memberSince).toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : null;

  return (
    <div className="fixed inset-0 bg-slate-950/95 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 relative my-4">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 transition">
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => avatarInputRef.current?.click()}
            disabled={avatarBusy}
            title="Change your profile photo"
            className="relative w-14 h-14 rounded-2xl shrink-0 cursor-pointer group disabled:opacity-60"
          >
            {profileStats.avatarUrl ? (
              <img src={profileStats.avatarUrl} alt="" className="w-14 h-14 rounded-2xl object-cover border-2 border-amber-500/40" />
            ) : (
              <span className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center shadow-lg shadow-amber-500/20">
                <Crown className="w-7 h-7 text-slate-950 stroke-[2.5]" />
              </span>
            )}
            <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg bg-slate-950 border border-slate-700 flex items-center justify-center group-hover:border-amber-500/60 transition">
              <Camera className={`w-3 h-3 ${avatarBusy ? "animate-pulse text-amber-400" : "text-slate-300"}`} />
            </span>
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleAvatarFile(f);
              e.target.value = "";
            }}
          />
          <div>
            <h2 className="text-lg font-extrabold text-white font-sans">{username}</h2>
            {joinedLabel && (
              <div className="flex items-center gap-1 text-[11px] text-slate-500 font-sans mt-0.5">
                <Calendar className="w-3 h-3" /> Member since {joinedLabel}
              </div>
            )}
          </div>
        </div>
        {avatarError && (
          <p className="text-[10px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-1.5 -mt-4 mb-4">{avatarError}</p>
        )}

        {/* Core stats grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase font-bold font-sans mb-1">
              <TrendingUp className="w-3 h-3" /> Elo Rating
            </div>
            <div className="text-xl font-extrabold text-white font-sans">{Math.round(profileStats.elo)}</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase font-bold font-sans mb-1">
              <Award className="w-3 h-3" /> Games Played
            </div>
            <div className="text-xl font-extrabold text-white font-sans">{profileStats.gamesCount}</div>
          </div>
        </div>

        {/* W/D/L + win rate */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 mb-4">
          <div className="flex items-center justify-between text-xs font-sans mb-2">
            <span className="text-emerald-400 font-bold">{profileStats.wins} Wins</span>
            <span className="text-slate-400 font-bold">{profileStats.draws} Draws</span>
            <span className="text-rose-400 font-bold">{profileStats.losses} Losses</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden flex">
            <div className="bg-emerald-500 h-full" style={{ width: `${winRate}%` }} />
            <div className="bg-slate-600 h-full" style={{ width: `${profileStats.gamesCount > 0 ? (profileStats.draws / profileStats.gamesCount) * 100 : 0}%` }} />
            <div className="bg-rose-500 h-full flex-1" />
          </div>
          <div className="text-[10px] text-slate-500 font-sans mt-1.5 text-right">{winRate}% win rate</div>
        </div>

        {/* Coins */}
        <div className="bg-gradient-to-r from-amber-950/40 via-slate-950 to-amber-950/30 border border-amber-500/30 rounded-2xl p-4 mb-4 flex flex-col gap-3 shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs text-amber-300 font-sans font-bold flex items-center gap-2">
              <KentroCoin size="xs" glow /> Kentro Wallet Balance
            </span>
            <span className="text-base font-extrabold text-amber-300 font-sans flex items-center gap-1">
              <KentroCoin size="2xs" /> {coinBalance.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-slate-800/80 pt-2.5">
            <span className="text-[11px] text-slate-400 font-sans">Total Coins Bought</span>
            <span className="text-xs font-bold text-white font-sans flex items-center gap-1">
              {loadingWallet ? "..." : lifetimeCoinsPurchased === null ? "--" : (
                <>
                  <KentroCoin size="2xs" />
                  {lifetimeCoinsPurchased.toLocaleString()}
                </>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400 font-sans flex items-center gap-1.5">
              <Banknote className="w-3.5 h-3.5 text-slate-500" /> Total Withdrawn
            </span>
            <span className="text-[10px] font-bold text-amber-400 font-sans">Instant Transfers</span>
          </div>
        </div>

        <p className="text-[10px] text-slate-600 font-sans text-center leading-relaxed mb-4">
          Withdrawals aren't live yet -- coins currently spend on matches, tournaments, and AI levels only.
        </p>

        {onSignOut && (
          <button
            onClick={() => {
              onClose();
              onSignOut();
            }}
            className="w-full py-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl font-bold uppercase text-xs tracking-wider transition flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Log Out</span>
          </button>
        )}
      </div>
    </div>
  );
}
