import { motion } from "motion/react";
import { Settings as SettingsIcon, Volume2, VolumeX } from "lucide-react";
import { ModalShell } from "../ui/ModalShell";
import { BoardTheme } from "../../types";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  muted: boolean;
  setMuted: (v: boolean) => void;
  showSquareNumbers: boolean;
  setShowSquareNumbers: (v: boolean) => void;
  boardTheme: BoardTheme;
  setBoardTheme: (t: BoardTheme) => void;
  customLightSquare: string;
  setCustomLightSquare: (v: string) => void;
  customDarkSquare: string;
  setCustomDarkSquare: (v: string) => void;
  customBorder: string;
  setCustomBorder: (v: string) => void;
  boardScale: number;
  setBoardScale: (v: number) => void;
  onReplaySplash?: () => void;
}

export function SettingsModal({
  open,
  onClose,
  muted,
  setMuted,
  showSquareNumbers,
  setShowSquareNumbers,
  boardTheme,
  setBoardTheme,
  customLightSquare,
  setCustomLightSquare,
  customDarkSquare,
  setCustomDarkSquare,
  customBorder,
  setCustomBorder,
  boardScale,
  setBoardScale,
  onReplaySplash,
}: SettingsModalProps) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Settings & Customization"
      icon={<SettingsIcon className="w-5 h-5 text-amber-500" />}
      footer={
        <button
          onClick={onClose}
          className="w-full bg-amber-500 hover:bg-amber-400 active:scale-[0.99] text-slate-950 font-bold py-3 rounded-xl transition text-center text-xs tracking-wide cursor-pointer"
        >
          APPLY & SAVE
        </button>
      }
    >
      <div className="space-y-5 text-xs text-slate-300 pb-1">
        {/* Sound Settings */}
        <div className="bg-slate-950/40 p-3.5 rounded-2xl border border-slate-900 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-slate-900 rounded-xl border border-slate-800 shrink-0">
              {!muted ? <Volume2 className="w-4 h-4 text-amber-500" /> : <VolumeX className="w-4 h-4 text-rose-400" />}
            </div>
            <div className="min-w-0">
              <h4 className="font-bold text-white mb-0.5">App Sound Effects</h4>
              <p className="text-[10px] text-slate-500">Enable/disable move and capture audio.</p>
            </div>
          </div>
          <button
            onClick={() => {
              setMuted(!muted);
            }}
            className={`px-3 py-2 rounded-xl font-bold transition text-[10px] uppercase tracking-wider cursor-pointer shrink-0 ${
              !muted
                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                : "bg-slate-900 text-slate-500 border border-slate-800"
            }`}
          >
            {!muted ? "ON" : "OFF"}
          </button>
        </div>

        {/* Square Numbers Toggle */}
        <div className="bg-slate-950/40 p-3.5 rounded-2xl border border-slate-900 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h4 className="font-bold text-white mb-0.5">Show Board Square Numbers</h4>
            <p className="text-[10px] text-slate-500">Display numeric labels on active cells.</p>
          </div>
          <button
            onClick={() => setShowSquareNumbers(!showSquareNumbers)}
            className={`px-3 py-2 rounded-xl font-bold transition text-[10px] uppercase tracking-wider cursor-pointer shrink-0 ${
              showSquareNumbers
                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                : "bg-slate-900 text-slate-500 border border-slate-800"
            }`}
          >
            {showSquareNumbers ? "SHOWN" : "HIDDEN"}
          </button>
        </div>

        {/* Board Theme Selection */}
        <div className="bg-slate-950/40 p-3.5 rounded-2xl border border-slate-900 space-y-3">
          <div>
            <h4 className="font-bold text-white mb-0.5">Board Theme</h4>
            <p className="text-[10px] text-slate-500">Choose a default aesthetic or craft your own.</p>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {(["wood", "slate", "green", "vinyl", "custom"] as BoardTheme[]).map((t) => (
              <button
                key={t}
                onClick={() => setBoardTheme(t)}
                className={`py-2 rounded-lg text-[9px] font-black uppercase tracking-wider transition border cursor-pointer ${
                  boardTheme === t
                    ? "bg-amber-500 text-slate-950 border-amber-400"
                    : "bg-slate-900 text-slate-400 border-slate-850 hover:text-slate-200"
                }`}
              >
                {t === "custom" ? "Custom" : t}
              </button>
            ))}
          </div>

          {/* Dynamic Color Pickers for Custom Theme */}
          {boardTheme === "custom" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="pt-2.5 border-t border-slate-900 space-y-3"
            >
              <h5 className="text-[10px] font-bold uppercase tracking-wider text-amber-500">
                Bespoke Theme Creator
              </h5>

              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col items-center">
                  <label className="text-[9px] font-bold text-slate-400 mb-1">Light Squares</label>
                  <div className="relative w-10 h-10 rounded-xl overflow-hidden border border-slate-800">
                    <input
                      type="color"
                      value={customLightSquare}
                      onChange={(e) => setCustomLightSquare(e.target.value)}
                      className="absolute inset-0 w-full h-full p-0 border-0 cursor-pointer scale-150"
                    />
                  </div>
                </div>

                <div className="flex flex-col items-center">
                  <label className="text-[9px] font-bold text-slate-400 mb-1">Dark Squares</label>
                  <div className="relative w-10 h-10 rounded-xl overflow-hidden border border-slate-800">
                    <input
                      type="color"
                      value={customDarkSquare}
                      onChange={(e) => setCustomDarkSquare(e.target.value)}
                      className="absolute inset-0 w-full h-full p-0 border-0 cursor-pointer scale-150"
                    />
                  </div>
                </div>

                <div className="flex flex-col items-center">
                  <label className="text-[9px] font-bold text-slate-400 mb-1">Board Border</label>
                  <div className="relative w-10 h-10 rounded-xl overflow-hidden border border-slate-800">
                    <input
                      type="color"
                      value={customBorder}
                      onChange={(e) => setCustomBorder(e.target.value)}
                      className="absolute inset-0 w-full h-full p-0 border-0 cursor-pointer scale-150"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setCustomLightSquare("#eae9d2");
                    setCustomDarkSquare("#4b7399");
                    setCustomBorder("#2a3d52");
                  }}
                  className="flex-1 py-2 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-850 hover:text-white transition text-[9px] font-semibold uppercase cursor-pointer"
                >
                  Reset to Blue Slate
                </button>
                <button
                  onClick={() => {
                    setCustomLightSquare("#fef08a");
                    setCustomDarkSquare("#7c2d12");
                    setCustomBorder("#431407");
                  }}
                  className="flex-1 py-2 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-850 hover:text-white transition text-[9px] font-semibold uppercase cursor-pointer"
                >
                  Reset to Warm Gold
                </button>
              </div>
            </motion.div>
          )}
        </div>

        {/* Board Scale Slider */}
        <div className="bg-slate-950/40 p-3.5 rounded-2xl border border-slate-900 space-y-2">
          <div className="flex justify-between items-center">
            <h4 className="font-bold text-white">Board Dimensions / Scale</h4>
            <span className="text-[10px] font-mono text-amber-500 font-bold">{boardScale}%</span>
          </div>
          <input
            type="range"
            min="80"
            max="130"
            value={boardScale}
            onChange={(e) => setBoardScale(parseInt(e.target.value, 10))}
            className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
          />
          <p className="text-[9px] text-slate-500 leading-normal">
            Adjust to perfectly fit your device size (only applied on desktop views).
          </p>
        </div>

        {/* Splash Screen Replay */}
        {onReplaySplash && (
          <div className="bg-slate-950/40 p-3.5 rounded-2xl border border-slate-900 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h4 className="font-bold text-white mb-0.5">Splash Screen</h4>
              <p className="text-[10px] text-slate-500">Replay the Kentro Draught splash screen.</p>
            </div>
            <button
              onClick={() => {
                onClose();
                onReplaySplash();
              }}
              className="px-3 py-2 rounded-xl font-bold transition text-[10px] uppercase tracking-wider cursor-pointer bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 shrink-0"
            >
              REPLAY
            </button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
