import React, { useEffect, useState } from "react";
import { Check, Eye, Focus, Grid2X2, Hand, Monitor, RotateCcw, Settings2, Volume2, VolumeX } from "lucide-react";
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
  focusMode: boolean;
  setFocusMode: (v: boolean) => void;
  reducedMotion: boolean;
  setReducedMotion: (v: boolean) => void;
  onReplaySplash?: () => void;
}

type Section = "board" | "game" | "comfort";
const boardOptions: { id: BoardTheme; name: string; dark: string; light: string }[] = [
  { id: "wood", name: "Royal Wood", dark: "#86502e", light: "#e9c597" },
  { id: "slate", name: "Slate", dark: "#334155", light: "#cbd5e1" },
  { id: "green", name: "Forest", dark: "#2d6a4f", light: "#d8f3dc" },
  { id: "vinyl", name: "Classic", dark: "#422006", light: "#fef08a" },
  { id: "custom", name: "Custom", dark: "#34445c", light: "#f8fafc" },
];

function ToggleRow({ title, description, checked, onChange, icon }: {
  title: string; description: string; checked: boolean; onChange: (v: boolean) => void; icon: React.ReactNode;
}) {
  return <div className="k-pref-row">
    <span className="k-pref-row-icon" aria-hidden="true">{icon}</span>
    <div className="k-pref-row-copy"><strong>{title}</strong><p>{description}</p></div>
    <button type="button" role="switch" aria-label={title} aria-checked={checked} onClick={() => onChange(!checked)} className={`k-pref-switch ${checked ? "on" : ""}`}>
      <span />
    </button>
  </div>;
}

export function SettingsModal({
  open, onClose, muted, setMuted, showSquareNumbers, setShowSquareNumbers, boardTheme, setBoardTheme,
  customLightSquare, setCustomLightSquare, customDarkSquare, setCustomDarkSquare,
  customBorder, setCustomBorder, boardScale, setBoardScale, focusMode, setFocusMode,
  reducedMotion, setReducedMotion, onReplaySplash,
}: SettingsModalProps) {
  const [section, setSection] = useState<Section>("board");
  useEffect(() => { if (open) setSection("board"); }, [open]);
  const colors = boardOptions.find(theme => theme.id === boardTheme) || boardOptions[0];
  const dark = boardTheme === "custom" ? customDarkSquare : colors.dark;
  const light = boardTheme === "custom" ? customLightSquare : colors.light;
  const sections: Section[] = ["board", "game", "comfort"];
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!offset && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : (sections.indexOf(section) + offset + sections.length) % sections.length;
    setSection(sections[next]);
    document.getElementById(`k-settings-${sections[next]}-tab`)?.focus();
  };

  return <ModalShell open={open} onClose={onClose} size="lg" title="Settings" icon={<Settings2 className="w-5 h-5 text-amber-400" />}>
    <div className="k-preferences">
      <p className="k-pref-intro">Make Kentro comfortable for the way you play. Changes save automatically on this device.</p>
      <div className="k-pref-tabs" role="tablist" aria-label="Settings categories">
        <button id="k-settings-board-tab" type="button" role="tab" aria-controls="k-settings-board-panel" aria-selected={section === "board"} tabIndex={section === "board" ? 0 : -1} onKeyDown={onTabKeyDown} className={section === "board" ? "active" : ""} onClick={() => setSection("board")}><Grid2X2 size={17}/> Board</button>
        <button id="k-settings-game-tab" type="button" role="tab" aria-controls="k-settings-game-panel" aria-selected={section === "game"} tabIndex={section === "game" ? 0 : -1} onKeyDown={onTabKeyDown} className={section === "game" ? "active" : ""} onClick={() => setSection("game")}><Hand size={17}/> Gameplay</button>
        <button id="k-settings-comfort-tab" type="button" role="tab" aria-controls="k-settings-comfort-panel" aria-selected={section === "comfort"} tabIndex={section === "comfort" ? 0 : -1} onKeyDown={onTabKeyDown} className={section === "comfort" ? "active" : ""} onClick={() => setSection("comfort")}><Eye size={17}/> Comfort</button>
      </div>
      {section === "board" && <div id="k-settings-board-panel" role="tabpanel" aria-labelledby="k-settings-board-tab" className="k-pref-content">
        <div className="k-pref-heading"><h4>Board appearance</h4><p>Large, clear pieces and a readable playing surface.</p></div>
        <div className="k-pref-board-preview" aria-label={`Preview of ${colors.name} board`}>
          <div className="k-pref-preview-grid" aria-hidden="true">{Array.from({ length: 100 }, (_, i) => {
            const row = Math.floor(i / 10), col = i % 10, isDark = (row + col) % 2 === 1;
            return <span key={i} style={{ background: isDark ? dark : light }}>{isDark && (row < 4 || row > 5) && <i className={row < 4 ? "black" : "gold"} />}</span>;
          })}</div>
          <div className="k-pref-preview-meta"><strong>{colors.name}</strong><small>10 × 10 · Nigerian draughts</small></div>
        </div>
        <div className="k-pref-heading"><h4>Board theme</h4><p>Choose the surface that suits you.</p></div>
        <div className="k-pref-theme-grid" role="group" aria-label="Board theme">
          {boardOptions.map(option => <button key={option.id} type="button" aria-pressed={boardTheme === option.id} className={boardTheme === option.id ? "selected" : ""} onClick={() => setBoardTheme(option.id)}>
            <span className="k-pref-swatch" style={{ background: `conic-gradient(${option.light} 0 25%,${option.dark} 0 50%,${option.light} 0 75%,${option.dark} 0)` }} />
            <span>{option.name}</span>{boardTheme === option.id && <Check size={14} aria-hidden="true" />}
          </button>)}
        </div>
        {boardTheme === "custom" && <div className="k-pref-custom-colors">
          {([ ["Light squares", customLightSquare, setCustomLightSquare], ["Dark squares", customDarkSquare, setCustomDarkSquare], ["Frame", customBorder, setCustomBorder] ] as const).map(([name, value, update]) => <label key={name}><span>{name}</span><input type="color" value={value} onChange={e => update(e.target.value)} aria-label={name}/></label>)}
        </div>}
        <label className="k-pref-slider-label" htmlFor="k-pref-board-size"><span><strong>Board size</strong><small>Desktop screens</small></span><output htmlFor="k-pref-board-size">{boardScale}%</output></label>
        <input id="k-pref-board-size" type="range" min="80" max="130" step="5" value={boardScale} onChange={e => setBoardScale(Number(e.target.value))} />
        <button type="button" className="k-pref-restore" onClick={() => { setBoardTheme("wood"); setBoardScale(112); setCustomLightSquare("#eac494"); setCustomDarkSquare("#7c4c24"); setCustomBorder("#4a2e16"); }}><RotateCcw size={16}/> Restore default board</button>
      </div>}
      {section === "game" && <div id="k-settings-game-panel" role="tabpanel" aria-labelledby="k-settings-game-tab" className="k-pref-content">
        <div className="k-pref-heading"><h4>During a match</h4><p>Keep your attention on the board.</p></div>
        <ToggleRow title="Focus mode" description="Hide the navigation and side panels while playing. The board, clocks, and game controls stay visible." checked={focusMode} onChange={setFocusMode} icon={<Focus size={20} />}/>
        <ToggleRow title="Square numbers" description="Show square numbers on the Nigerian draughts board." checked={showSquareNumbers} onChange={setShowSquareNumbers} icon={<Grid2X2 size={20} />}/>
        <div className="k-pref-help"><strong>Quick tip</strong><p>While on the game board, press <kbd>Z</kbd> to toggle Focus mode. You can also switch it from the board’s Options menu.</p></div>
      </div>}
      {section === "comfort" && <div id="k-settings-comfort-panel" role="tabpanel" aria-labelledby="k-settings-comfort-tab" className="k-pref-content">
        <div className="k-pref-heading"><h4>Sound and accessibility</h4><p>Simple controls that help you stay comfortable during long matches.</p></div>
        <ToggleRow title="Move and capture sounds" description="Play feedback sounds when you make a move, capture, or promote." checked={!muted} onChange={v => setMuted(!v)} icon={muted ? <VolumeX size={20}/> : <Volume2 size={20}/>}/>
        <ToggleRow title="Reduce motion" description="Turn off decorative transitions and pulsing effects in the app." checked={reducedMotion} onChange={setReducedMotion} icon={<Monitor size={20} />}/>
        {onReplaySplash && <button type="button" className="k-pref-restore" onClick={() => {onClose();onReplaySplash();}}><RotateCcw size={16}/> Replay welcome animation</button>}
      </div>}
      <div className="k-pref-finish"><span><Check size={15}/> Settings save automatically</span><button type="button" onClick={onClose}>Done</button></div>
    </div>
  </ModalShell>;
}
