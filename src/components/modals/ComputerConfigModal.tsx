import { Cpu, Crown } from "lucide-react";
import { ModalShell } from "../ui/ModalShell";
import { KEN_LEVELS, CoinSettings } from "../../lib/constants";
import { PlayerStats, PlayMode } from "../../types";
import { playClickSound } from "../../lib/audio";
import { KentroCoin, CoinPriceTag } from "../ui/KentroCoin";

interface ComputerConfigModalProps {
  offlinePractice?: boolean;
  open: boolean;
  onClose: () => void;
  coinBalance: number;
  coinsEnabled?: boolean;
  profileStats: PlayerStats;
  coinSettings: CoinSettings | null;
  kenLevelId: number;
  setKenLevelId: (id: number) => void;
  setStatusMessage: (msg: string) => void;
  muted: boolean;
  playMode: PlayMode;
  setPlayMode: (m: PlayMode) => void;
  purchaseSubmitted: boolean;
  onUnlockKenLevel: (level: number | "all") => void;
  onOpenStore: () => void;
  onApplyStart: () => void;
  onOpenPastGamesModal?: (filter?: "All" | "AI" | "PvP" | "Tournament") => void;
}

export function ComputerConfigModal({
  offlinePractice = false, open, onClose, coinBalance, coinsEnabled = false, profileStats, coinSettings, kenLevelId, setKenLevelId,
  setStatusMessage, muted, playMode, setPlayMode, purchaseSubmitted,
  onUnlockKenLevel, onOpenStore, onApplyStart, onOpenPastGamesModal,
}: ComputerConfigModalProps) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      size="sm"
      title={offlinePractice ? "Play vs Ken · Offline" : "VS Computer Settings"}
      icon={<Cpu className="w-5 h-5 text-amber-500 animate-pulse" />}
      footer={
        <button
          onClick={onApplyStart}
          className="w-full bg-amber-500 hover:bg-amber-400 active:scale-[0.99] text-slate-950 font-bold py-3 rounded-xl transition text-center text-xs tracking-wide uppercase cursor-pointer"
        >
          Apply &amp; Start Match ⚔️
        </button>
      }
    >
      <div className="space-y-4 text-xs text-slate-300 pb-1">
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-[11px] text-amber-400/90 leading-relaxed">
          <strong>Untimed Match:</strong> Games against the computer have <strong>no timer</strong>, allowing you to focus on tactical depth, strategy, and calculation. Ken runs the official Nigerian Draughts neural engine (Levels 1–8).
        </div>

        {offlinePractice && <p className="text-xs text-slate-300">Same Ken levels and Nigerian rules, running on your device. Offline practice does not change online ratings, coins or level unlocks.</p>}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="font-bold text-slate-300 font-sans uppercase tracking-wider text-[10px]">Select AI Level:</label>
            {!offlinePractice && <span className="text-[10px] text-amber-300 font-bold flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-800">
              <KentroCoin size="2xs" glow />
              {coinBalance.toLocaleString()}
            </span>}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {KEN_LEVELS.map((lvl) => {
              const maxKen = offlinePractice ? 8 : Math.max(3, profileStats.maxUnlockedKenLevel || 1);
              const isLocked = lvl.id > maxKen;
              return (
                <div
                  key={lvl.id}
                  className={`p-2.5 rounded-xl text-[10px] font-bold text-left transition flex items-center justify-between cursor-pointer ${
                    kenLevelId === lvl.id
                      ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                      : isLocked
                        ? "bg-slate-950/50 border border-slate-900/50 text-slate-600 cursor-not-allowed"
                        : "bg-slate-900/60 border border-slate-800 text-slate-300 hover:bg-slate-800/80"
                  }`}
                >
                  <button
                    type="button"
                    aria-pressed={kenLevelId === lvl.id}
                    aria-disabled={isLocked}
                    className="flex-1 min-w-0 text-left"
                    onClick={() => {
                      if (isLocked) {
                        setStatusMessage(`Level ${lvl.id} locked! Spend Kentro Coins to unlock level ${lvl.id}, or choose a free available level.`);
                        return;
                      }
                      setKenLevelId(lvl.id);
                      playClickSound(muted);
                    }}
                  >
                    <div className="truncate">{lvl.name}</div>
                    <div className={`text-[8px] font-medium font-sans ${kenLevelId === lvl.id ? "text-slate-800" : (isLocked ? "text-slate-700" : "text-slate-500")}`}>
                      Level {lvl.id}
                    </div>
                  </button>
                  {isLocked && coinsEnabled && (
                    <button
                      type="button"
                      aria-label={`Unlock ${lvl.name} for ${(coinSettings?.aiUnlockCostPerLevel ?? 50) * Math.max(1, lvl.id - Math.max(3, maxKen))} coins`}
                      disabled={!coinsEnabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (coinsEnabled) onUnlockKenLevel(lvl.id);
                      }}
                      title={`Unlock with ${(coinSettings?.aiUnlockCostPerLevel ?? 50) * Math.max(1, lvl.id - Math.max(3, maxKen))} coins`}
                      className="text-[9px] font-bold text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 px-1.5 py-0.5 rounded flex items-center gap-1 cursor-pointer transition"
                    >
                      <KentroCoin size="2xs" />
                      {(coinSettings?.aiUnlockCostPerLevel ?? 50) * Math.max(1, lvl.id - Math.max(3, maxKen))}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {!offlinePractice && !coinsEnabled && <p className="text-[10px] text-amber-300">Coin purchases are temporarily disabled until the wallet is ready. Ken 1–3 remain free.</p>}
          {coinsEnabled && (profileStats.maxUnlockedKenLevel || 1) < 8 && (
            <div className="flex gap-1.5 mt-1">
              <button
                onClick={() => onUnlockKenLevel("all")}
                className="flex-1 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-bold hover:bg-amber-500/20 transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Crown size={12} className="text-amber-400" />
                <span>Unlock All</span>
                <span className="flex items-center gap-0.5 font-mono text-amber-200">
                  (<KentroCoin size="2xs" /> {Math.min(coinSettings?.aiUnlockAllCost ?? 250, (coinSettings?.aiUnlockCostPerLevel ?? 50) * (8 - Math.max(3, profileStats.maxUnlockedKenLevel || 1)))})
                </span>
              </button>
              <button
                onClick={onOpenStore}
                className="py-2 px-2.5 rounded-lg bg-slate-800/60 border border-slate-700 hover:border-amber-500/40 text-amber-200 text-[10px] font-bold hover:bg-slate-800 transition cursor-pointer flex items-center gap-1"
              >
                <KentroCoin size="2xs" />
                Buy Coins
              </button>
            </div>
          )}
          {purchaseSubmitted && (
            <p className="mt-1.5 text-[9px] text-emerald-400/80 text-center">
              Receipt submitted — coins will be added once it's confirmed.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5 border-t border-slate-850 pt-3">
          <label className="font-bold text-slate-300 font-sans uppercase tracking-wider text-[10px]">Playing Mode:</label>
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-850">
            <button
              onClick={() => {
                setPlayMode("Human_vs_AI");
                playClickSound(muted);
              }}
              className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition text-center cursor-pointer ${
                playMode === "Human_vs_AI"
                  ? "bg-slate-900 text-amber-400 border border-slate-800 shadow-inner"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              As White
            </button>
            <button
              onClick={() => {
                setPlayMode("AI_vs_Human");
                playClickSound(muted);
              }}
              className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition text-center cursor-pointer ${
                playMode === "AI_vs_Human"
                  ? "bg-slate-900 text-amber-400 border border-slate-800 shadow-inner"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              As Black
            </button>
          </div>
        </div>

        {onOpenPastGamesModal && (
          <div className="pt-1">
            <button
              onClick={() => {
                onClose();
                onOpenPastGamesModal("AI");
              }}
              className="w-full py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-amber-400 font-bold rounded-xl transition text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Cpu className="w-3.5 h-3.5" /> View Past AI Games (Batch 100)
            </button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
