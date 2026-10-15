import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Copy, Eye, Film, Pause, Play, Radio, RefreshCw, Share2, SkipBack, SkipForward, Tv2, Trophy, Zap } from "lucide-react";
import { ngRcToSq } from "../gameLogic";
import type { KentroGameRecord } from "../types/gameRecords";
import { MatchResultPair } from "./MatchResultPair";
import { uniqueCompletedMatches } from "../lib/completedMatches";
import { buildReplayFrames, replayBounds, replayLink, selectHighlights } from "../lib/kentroTv";
import { renderHighlightVideo } from "../lib/highlightVideo";

interface LiveRoom { roomId: string; white: string; black: string; gameTime: number; spectatorCount: number }
interface Props {
  liveRooms: LiveRoom[];
  onRefresh: () => void;
  onWatch: (roomId: string) => void;
  onBack: () => void;
  initialReplay?: { gameCode: string; ply: number; clipEnd?: number } | null;
}

const primary = "rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-extrabold text-slate-950 hover:bg-amber-400 disabled:opacity-40";
const secondary = "rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 hover:border-amber-500/50 disabled:opacity-40";

function BoardReplay({ board, lastMove }: { board: Record<number, string | null>; lastMove: { from: number; to: number } | null }) {
  return <div className="aspect-square w-full max-w-[680px] kentro-royal-frame" role="img" aria-label="10 by 10 Nigerian Draughts replay board">
    <div className="grid grid-cols-10 w-full h-full overflow-hidden kentro-royal-grid">
    {Array.from({ length: 100 }, (_, idx) => {
      const row = Math.floor(idx / 10), col = idx % 10;
      const sq = ngRcToSq(row, col);
      const piece = sq === null ? null : board[sq];
      return <div key={idx} className={`relative flex items-center justify-center ${sq === null ? "kentro-wood-light" : "kentro-wood-dark"} ${sq !== null && (lastMove?.from === sq || lastMove?.to === sq) ? "ring-2 ring-inset ring-amber-300" : ""}`}>
        {piece && <span className={`kentro-royal-piece ${piece.toLowerCase() === "w" ? "kentro-royal-piece--gold" : "kentro-royal-piece--black"}`}>
          {(piece === "W" || piece === "B") && <span className="kentro-royal-king-mark" aria-label="King">♛</span>}
        </span>}
      </div>;
    })}
    </div>
  </div>;
}

export function KentroTV({ liveRooms, onRefresh, onWatch, onBack, initialReplay }: Props) {
  const [tab, setTab] = useState<"live" | "replays">(initialReplay ? "replays" : "live");
  const [games, setGames] = useState<KentroGameRecord[]>([]);
  const [selected, setSelected] = useState<KentroGameRecord | null>(null);
  const [ply, setPly] = useState(initialReplay?.ply || 0);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const [exportingVideo, setExportingVideo] = useState(false);
  const frames = useMemo(() => { if (!selected) return []; try { return buildReplayFrames(selected); } catch { return []; } }, [selected]);
  const highlights = useMemo(() => selectHighlights(frames), [frames]);
  const boundedPly = replayBounds(frames.length, ply).ply;
  const current = frames[boundedPly];

  const loadRecent = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/games/recent?limit=60", { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load game records.");
      const payload = await res.json();
      setGames(uniqueCompletedMatches((payload.games || []).filter((g: KentroGameRecord) => g.completeMoveHistory?.length)));
      setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "Game records unavailable"); }
    finally { setLoading(false); }
  };

  useEffect(() => { onRefresh(); void loadRecent(); }, []);
  useEffect(() => {
    if (!initialReplay?.gameCode) return;
    let cancelled = false;
    fetch(`/api/games/code/${encodeURIComponent(initialReplay.gameCode)}`, { cache: "no-store" })
      .then(async r => { if (!r.ok) throw new Error("This replay is unavailable."); return r.json(); })
      .then(data => {
        if (!cancelled) {
          const verified = buildReplayFrames(data.game);
          const bounds = replayBounds(verified.length, initialReplay.ply, initialReplay.clipEnd);
          setSelected(data.game); setPly(bounds.ply); setRange(bounds.range);
          setPlaying(!!bounds.range); setError(""); setTab("replays");
        }
      })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [initialReplay?.gameCode, initialReplay?.ply, initialReplay?.clipEnd]);
  useEffect(() => {
    if (!playing || !frames.length) return;
    const timer = window.setInterval(() => setPly(p => {
      const last = Math.min(range?.to ?? frames.length - 1, frames.length - 1);
      if (p >= last) { setPlaying(false); return p; }
      return p + 1;
    }), 850);
    return () => clearInterval(timer);
  }, [playing, frames.length, range?.to]);
  useEffect(() => { if (selected && frames.length === 0) setError("This game record has no verifiable replay moves."); }, [selected, frames.length]);

  const share = async (clip = false) => {
    if (!selected) return;
    const target = replayLink(window.location.origin, selected.gameCode, clip && range ? range.from : boundedPly, clip && range ? range.to : undefined);
    const message = clip ? `Watch this Nigerian Draughts highlight on Kentro TV: ${target}` : `Watch this Kentro Draughts replay: ${target}`;
    try {
      if (navigator.share) await navigator.share({ title: "Kentro TV", text: message, url: target });
      else { await navigator.clipboard.writeText(message); setCopied(true); window.setTimeout(() => setCopied(false), 2500); }
    } catch (err) { if ((err as Error).name !== "AbortError") setError("Sharing failed. Try copying the link instead."); }
  };
  const shareWhatsApp = (clip = false) => {
    if (!selected) return;
    const link = replayLink(window.location.origin, selected.gameCode, clip && range ? range.from : boundedPly, clip && range ? range.to : undefined);
    const message = `Watch ${selected.whitePlayer} vs ${selected.blackPlayer} on Kentro TV! ${clip ? 'Here is a highlight: ' : ''}${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  };
  const copyLink = async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(replayLink(window.location.origin, selected.gameCode, boundedPly)); setCopied(true); window.setTimeout(() => setCopied(false), 2500); }
    catch { setError("Clipboard access is unavailable on this device."); }
  };
  const exportVideo = async () => {
    if (!selected || !range || exportingVideo) return;
    setExportingVideo(true);setError("");
    try {
      const result = await renderHighlightVideo(frames, range.from, range.to, `${selected.whitePlayer} vs ${selected.blackPlayer}`);
      const file = new File([result.blob], `kentro-highlight-${selected.gameCode}.${result.extension}`,{type:result.blob.type});
      if (navigator.canShare?.({files:[file]}) && navigator.share) {
        try { await navigator.share({files:[file],title:"Kentro TV game highlight"}); return; }
        catch (err) { if ((err as Error).name === "AbortError") return; }
      }
      const href=URL.createObjectURL(result.blob);
      const a=document.createElement("a");a.href=href;a.download=file.name;document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(href),60000);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not export this highlight."); }
    finally { setExportingVideo(false); }
  };
  const pickGame = (game: KentroGameRecord) => { setSelected(game); setPly(0); setRange(null); setPlaying(false); setError(""); };
  const visibleGames = games.filter(g => `${g.whitePlayer} ${g.blackPlayer} ${g.gameCode}`.toLowerCase().includes(search.trim().toLowerCase()));

  return <section className="k-tv-hub w-full min-h-full p-4 sm:p-6 text-white">
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="k-tv-header">
        <div className="k-tv-header-left"><button onClick={onBack} className="k-icon-button" aria-label="Return to lobby"><ArrowLeft size={19}/></button>
          <div><span className="k-overline">WATCH AND LEARN</span><h1><Tv2 size={23}/> Kentro TV</h1><p>Live matches, unforgettable moves, and a library of great games.</p></div>
        </div>
        <button className="k-tv-refresh" onClick={() => {onRefresh();void loadRecent();}} disabled={loading}><RefreshCw size={17} className={loading?"animate-spin":""}/> Refresh</button>
      </div>
      <div className="k-tv-tabs" role="tablist" aria-label="TV section"><button role="tab" aria-selected={tab==="live"} className={tab==="live"?"active":""} onClick={() => setTab("live")}><Radio size={18}/> Live games <span>{liveRooms.length}</span></button><button role="tab" aria-selected={tab==="replays"} className={tab==="replays"?"active":""} onClick={() => setTab("replays")}><Film size={18}/> Match replays</button></div>
      {error && <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{error} <button onClick={() => setError("")} className="ml-2 underline">Dismiss</button></div>}
      {tab === "live" ? <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-slate-400"><span className="h-2 w-2 rounded-full bg-red-500 animate-pulse"/> Games currently in progress. Tap to watch the live board and clock.</div>
        {liveRooms.length ? <div className="grid gap-3 md:grid-cols-2">{liveRooms.map(room => <article key={room.roomId} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3">
          <div className="flex justify-between"><span className="text-[10px] font-black tracking-wider text-red-400">● LIVE · {room.gameTime || "UNTIMED"}{room.gameTime ? " MIN" : ""}</span><span className="text-[10px] text-slate-400"><Eye className="inline w-3 h-3"/> {room.spectatorCount} watching</span></div>
          <div className="text-lg font-extrabold break-words">{room.white} <span className="text-slate-500">vs</span> {room.black}</div>
          <button className={`${primary} w-full`} onClick={() => onWatch(room.roomId)}><Eye className="inline w-4 h-4 mr-1"/> Watch Match</button>
        </article>)}</div> : <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center"><Radio className="h-8 w-8 text-slate-500 mx-auto mb-3"/><p className="font-bold">No live matches right now</p><p className="text-xs text-slate-400 mt-1">Watch a replay below or refresh when another match starts.</p><button onClick={() => setTab("replays")} className={`${secondary} mt-4`}>Browse Replays</button></div>}
      </div> : <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3 min-w-0">
          {selected && current ? <>
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-black text-base">{selected.whitePlayer} vs {selected.blackPlayer}</h2><p className="text-[11px] text-slate-400">{selected.finalResult} · {selected.timeControl} · Game {selected.gameCode}</p></div><button className={secondary} onClick={() => {setSelected(null);setPlaying(false);}}><ArrowLeft className="inline h-3.5 w-3.5 mr-1"/> All replays</button></div>
            <div className="mx-auto max-w-[540px]"><BoardReplay board={current.board} lastMove={current.move}/></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 sm:p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 text-xs"><span className="text-slate-400">Move {Math.ceil(boundedPly / 2)} · {boundedPly} / {frames.length - 1} plies</span><span className="text-amber-400 font-semibold">{current.move ? `${current.move.from}${current.move.caps.length ? "×" : "–"}${current.move.to}` : "Starting position"}</span></div>
              <input className="w-full accent-amber-400" aria-label="Replay position" type="range" min={0} max={frames.length - 1} value={boundedPly} onChange={e => { setPlaying(false);setPly(Number(e.target.value));setRange(null); }}/>
              <div className="flex items-center justify-center gap-2"><button className={secondary} onClick={() => {setPlaying(false);setPly(0);}} aria-label="First move"><SkipBack className="w-4 h-4"/></button><button className={secondary} onClick={() => {setPlaying(false);setPly(p=>Math.max(0,p-1));}} aria-label="Previous move"><ChevronLeft className="w-4 h-4"/></button><button className={primary} aria-label={playing ? "Pause replay" : "Play replay"} onClick={() => { if (boundedPly >= (range?.to ?? frames.length-1)) setPly(range?.from ?? 0); setPlaying(v=>!v); }}>{playing ? <Pause className="w-4 h-4"/> : <Play className="w-4 h-4"/>}</button><button className={secondary} onClick={() => {setPlaying(false);setPly(p=>Math.min(frames.length-1,p+1));}} aria-label="Next move"><ChevronRight className="w-4 h-4"/></button><button className={secondary} onClick={() => {setPlaying(false);setPly(frames.length-1);}} aria-label="Last move"><SkipForward className="w-4 h-4"/></button></div>
              <div className="flex flex-wrap gap-2"><button className={secondary} onClick={copyLink}>{copied ? <Check className="inline w-3 h-3"/> : <Copy className="inline w-3 h-3"/>} {copied ? "Copied" : "Copy Replay Link"}</button><button className={secondary} onClick={() => shareWhatsApp()}><Share2 className="inline w-3 h-3"/> WhatsApp</button><button className={secondary} onClick={() => void share()}><Share2 className="inline w-3 h-3"/> More Share Options</button></div>
            </div>
            <div className="rounded-xl bg-slate-900/70 p-4 space-y-2"><h3 className="font-black text-sm text-amber-400 flex gap-2 items-center"><Zap className="w-4 h-4"/> Game Highlights</h3><p className="text-[11px] text-slate-400">Auto-detected captures, promotions, and final moves. Tap to replay a short animated sequence in Kentro TV.</p>
              {highlights.length ? highlights.map((h, i) => <button key={`${h.from}-${i}`} className="w-full rounded-xl border border-slate-800 px-3 py-2.5 flex items-center justify-between gap-3 text-left hover:border-amber-500/50" onClick={() => {setRange({from:h.from,to:h.to});setPly(h.from);setPlaying(true);}}><span><span className="block text-xs font-bold">{h.title}</span><span className="text-[10px] text-slate-500">Moves {h.from}–{h.to}</span></span><Play className="w-4 h-4 text-amber-400"/></button>) : <p className="text-xs text-slate-500">No highlight-worthy moves detected.</p>}
              {range && <div className="flex flex-wrap gap-2"><button className={secondary} onClick={() => shareWhatsApp(true)}><Share2 className="inline h-3.5 w-3.5"/> Highlight to WhatsApp</button><button className={secondary} onClick={() => void share(true)}>Share Animated Link</button><button disabled={exportingVideo} className={secondary} onClick={() => void exportVideo()}>{exportingVideo ? "Recording clip…" : "Export Short Video"}</button></div>}
            </div>
          </> : <div className="rounded-2xl border border-slate-800 p-8 text-center"><Film className="w-9 h-9 mx-auto text-amber-500"/><h2 className="text-base font-black mt-3">Choose a game to replay</h2><p className="text-xs text-slate-400 mt-1">Review every move, watch capture sequences and send a replay to friends.</p></div>}
        </div>
        <aside className="space-y-3"><h3 className="text-xs font-black uppercase tracking-wider text-slate-400">Game library</h3><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search player or game code" className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs outline-none focus:border-amber-500" aria-label="Search saved games"/>
          <div className="space-y-2 max-h-[68vh] overflow-auto">{visibleGames.length ? visibleGames.map(game => <button key={game.gameCode} className={`w-full rounded-xl border p-3 text-left ${selected?.gameCode===game.gameCode ? "border-amber-500 bg-amber-500/10" : "border-slate-800 bg-slate-900 hover:border-slate-600"}`} onClick={()=>pickGame(game)}><MatchResultPair game={game} compact /><span className="block text-[10px] text-slate-400 mt-1 text-center">{game.completeMoveHistory.length} moves · {game.gameCode}</span></button>) : <div className="rounded-xl border border-slate-800 p-4 text-xs text-slate-400">{loading ? "Loading games..." : "No replay-ready games found."}</div>}</div>
        </aside>
      </div>}
    </div>
  </section>;
}
