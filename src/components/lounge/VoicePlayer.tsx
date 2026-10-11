import React, { useState, useRef, useEffect } from "react";
import { Play, Pause, Volume2 } from "lucide-react";

interface VoicePlayerProps {
  src: string;
  duration?: number;
  isOutgoing?: boolean;
}

export const VoicePlayer: React.FC<VoicePlayerProps> = React.memo(({ src, duration = 1, isOutgoing = false }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [simulatedDuration, setSimulatedDuration] = useState(duration);

  // Generate pseudo waveform bars based on a stable hash of src or random sequence
  const bars = useRef<number[]>(
    Array.from({ length: 28 }, (_, i) => {
      const v = Math.sin(i * 0.7) * 35 + Math.cos(i * 1.3) * 25 + 40;
      return Math.max(15, Math.min(95, Math.round(v)));
    })
  ).current;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration && !isNaN(audio.duration) && audio.duration !== Infinity) {
        setSimulatedDuration(audio.duration);
      }
    };
    const onLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && audio.duration !== Infinity) {
        setSimulatedDuration(audio.duration);
      }
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, []);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch((err) => {
        console.warn("Audio playback interrupted:", err);
      });
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const progress = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = progress * (simulatedDuration || 1);
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const cyclePlaybackRate = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rates = [1, 1.5, 2];
    const nextRate = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const formatSecs = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const progressPercent = Math.min(100, Math.max(0, (currentTime / (simulatedDuration || 1)) * 100));

  return (
    <div className={`flex items-center gap-2.5 p-2 rounded-xl border select-none transition-all ${
      isOutgoing 
        ? "bg-amber-950/20 border-amber-600/30 text-amber-200" 
        : "bg-slate-950/60 border-slate-800 text-slate-200"
    }`}>
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Play/Pause circular button */}
      <button
        type="button"
        onClick={togglePlay}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-md transition-transform active:scale-95 cursor-pointer ${
          isOutgoing
            ? "bg-amber-500 hover:bg-amber-400 text-slate-950"
            : "bg-emerald-500 hover:bg-emerald-400 text-slate-950"
        }`}
        title={isPlaying ? "Pause" : "Play Voice Note"}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4 fill-current" />
        ) : (
          <Play className="w-4 h-4 fill-current ml-0.5" />
        )}
      </button>

      {/* Waveform track */}
      <div 
        className="flex-1 flex flex-col gap-1 cursor-pointer py-1"
        onClick={handleSeek}
      >
        <div className="flex items-center gap-[2.5px] h-6 w-full">
          {bars.map((heightPercent, idx) => {
            const barProgress = (idx / bars.length) * 100;
            const hasPlayed = barProgress <= progressPercent;

            return (
              <div
                key={idx}
                className={`flex-1 rounded-full transition-colors duration-100 ${
                  hasPlayed
                    ? isOutgoing
                      ? "bg-amber-400"
                      : "bg-emerald-400"
                    : isOutgoing
                    ? "bg-amber-900/40"
                    : "bg-slate-800"
                }`}
                style={{ height: `${heightPercent}%` }}
              />
            );
          })}
        </div>

        {/* Time info and playback speed */}
        <div className="flex items-center justify-between text-[9px] font-mono font-semibold tracking-wider opacity-85">
          <span>{formatSecs(isPlaying ? currentTime : simulatedDuration)}</span>
          <span className="flex items-center gap-1 opacity-70">
            <Volume2 className="w-2.5 h-2.5" />
            <span>Voice Note</span>
          </span>
        </div>
      </div>

      {/* Playback speed toggle */}
      <button
        type="button"
        onClick={cyclePlaybackRate}
        className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border transition shrink-0 cursor-pointer ${
          isOutgoing
            ? "bg-amber-500/20 hover:bg-amber-500/30 border-amber-500/40 text-amber-300"
            : "bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300"
        }`}
        title="Toggle playback speed"
      >
        {playbackRate}x
      </button>
    </div>
  );
});
