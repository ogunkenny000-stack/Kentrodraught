import React, { useState, useEffect } from "react";
import {
  Brain, Cpu, Shield, Trophy, Play, RefreshCw, Sparkles, CheckCircle2,
  AlertCircle, Lock, Download, Zap, Database, BarChart3, LineChart, Flame,
  Layers, ArrowRight, ShieldCheck, Target, ChevronRight, BookOpen, Layers3,
  Key, Trash2, RotateCcw, Check
} from "lucide-react";
import {
  Ken8GameLog, GeminiKen8StudyResult, BenchmarkStats,
  getSavedDataset, saveDataset, getSavedGeminiStudy, runGeminiKen8Study,
  getSavedBenchmark, saveBenchmark, simulateKen8SelfPlayGame, runBenchmarkMatch,
  ken8SimManager, getStoredGeminiApiKey, saveStoredGeminiApiKey, resetAllTrainingData
} from "../../lib/geminiKenTrainingLab";
import { Board, createInitialBoard, isKing, ngRcToSq, getCol } from "../../gameLogic";

interface Ken8TrainingLabTabProps {
  myUsername: string;
}

export function Ken8TrainingLabTab({ myUsername }: Ken8TrainingLabTabProps) {
  const isAuthorized =
    myUsername.toLowerCase() === "kennykristkentro" ||
    myUsername.toLowerCase() === "admin" ||
    myUsername.toLowerCase() === "kenny";

  // State
  const [dataset, setDataset] = useState<Ken8GameLog[]>([]);
  const [geminiStudy, setGeminiStudy] = useState<GeminiKen8StudyResult | null>(null);
  const [benchmarkStats, setBenchmarkStats] = useState<BenchmarkStats>({
    totalGames: 100,
    completedGames: 0,
    geminiWins: 0,
    draws: 0,
    kenWins: 0,
    winDrawRate: 0,
    targetMet: false,
    recentMatches: [],
  });

  // API Key & Reset state
  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [keySavedToast, setKeySavedToast] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Action status states
  const [isSimulating, setIsSimulating] = useState(false);
  const [simProgress, setSimProgress] = useState(0);
  const [isStudying, setIsStudying] = useState(false);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [activeBoard, setActiveBoard] = useState<Board>(createInitialBoard());
  const [lastMoveNotation, setLastMoveNotation] = useState<string>("");

  useEffect(() => {
    // Load persisted state on mount and subscribe to background simulation runner
    const syncState = () => {
      const savedData = getSavedDataset();
      setDataset(savedData);
      setIsSimulating(ken8SimManager.getIsSimulating());
      setSimProgress(ken8SimManager.getProgressPercentage());
    };

    syncState();
    const unsubscribe = ken8SimManager.subscribe(syncState);

    const savedStudy = getSavedGeminiStudy();
    if (savedStudy) setGeminiStudy(savedStudy);

    const savedBench = getSavedBenchmark();
    setBenchmarkStats(savedBench);

    setApiKeyInput(getStoredGeminiApiKey());

    return () => {
      unsubscribe();
    };
  }, []);

  const handleSaveApiKey = () => {
    saveStoredGeminiApiKey(apiKeyInput);
    setKeySavedToast(true);
    setTimeout(() => setKeySavedToast(false), 3000);
  };

  const handleResetAllTraining = () => {
    ken8SimManager.stopSimulation();
    resetAllTrainingData();
    setDataset([]);
    setGeminiStudy(null);
    setBenchmarkStats({
      totalGames: 100,
      completedGames: 0,
      geminiWins: 0,
      draws: 0,
      kenWins: 0,
      winDrawRate: 0,
      targetMet: false,
      recentMatches: [],
    });
    setSimProgress(0);
    setActiveBoard(createInitialBoard());
    setLastMoveNotation("");
    setShowResetConfirm(false);
  };

  // Handler: Simulate 1,000 Games Dataset persistently in background
  const handleSimulateDataset = async () => {
    if (ken8SimManager.getIsSimulating()) {
      ken8SimManager.stopSimulation();
    } else {
      ken8SimManager.startSimulation(1000);
    }
  };

  // Handler: Run Gemini Deep Pattern Study
  const handleRunStudy = async () => {
    setIsStudying(true);
    try {
      const studyResult = await runGeminiKen8Study(dataset);
      setGeminiStudy(studyResult);
    } catch (e) {
      console.error("Study failed:", e);
    } finally {
      setIsStudying(false);
    }
  };

  // Handler: Run 100 Benchmark Games vs Ken 8
  const handleRunBenchmark = async () => {
    setIsBenchmarking(true);
    const updatedStats: BenchmarkStats = {
      totalGames: 100,
      completedGames: 0,
      geminiWins: 0,
      draws: 0,
      kenWins: 0,
      winDrawRate: 0,
      targetMet: false,
      recentMatches: [],
    };

    for (let g = 1; g <= 100; g++) {
      const result = await runBenchmarkMatch(g, (board, notation) => {
        setActiveBoard(board);
        setLastMoveNotation(notation);
      });

      updatedStats.completedGames = g;
      if (result.winner === "Gemini") updatedStats.geminiWins++;
      else if (result.winner === "Draw") updatedStats.draws++;
      else updatedStats.kenWins++;

      const winDrawTotal = updatedStats.geminiWins + updatedStats.draws;
      updatedStats.winDrawRate = Math.round((winDrawTotal / g) * 1000) / 10;
      updatedStats.targetMet = updatedStats.winDrawRate >= 90.0;

      updatedStats.recentMatches.unshift({
        gameNumber: g,
        winner: result.winner,
        moves: result.moves,
        summary: result.summary,
      });

      if (updatedStats.recentMatches.length > 20) {
        updatedStats.recentMatches.pop();
      }

      setBenchmarkStats({ ...updatedStats });
      saveBenchmark(updatedStats);

      // Brief delay for UI rendering
      await new Promise((r) => setTimeout(r, 30));
    }

    setIsBenchmarking(false);
  };

  // Handler: Reset Training Data
  const handleResetData = () => {
    if (window.confirm("Are you sure you want to reset all Ken 8 training logs and benchmark records?")) {
      localStorage.removeItem("kentro_ken8_dataset_v1");
      localStorage.removeItem("kentro_ken8_gemini_study_v1");
      localStorage.removeItem("kentro_ken8_benchmark_v1");
      setDataset([]);
      setGeminiStudy(null);
      setBenchmarkStats({
        totalGames: 100,
        completedGames: 0,
        geminiWins: 0,
        draws: 0,
        kenWins: 0,
        winDrawRate: 0,
        targetMet: false,
        recentMatches: [],
      });
      setActiveBoard(createInitialBoard());
    }
  };

  if (!isAuthorized) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center space-y-4 max-w-md mx-auto">
        <div className="w-16 h-16 rounded-3xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
          <Lock className="w-8 h-8" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-extrabold text-white uppercase tracking-wider">Access Restricted</h2>
          <p className="text-xs text-slate-400">
            The Ken Level 8 AI Training & Analysis Lab is strictly restricted to account owner{" "}
            <strong className="text-amber-400">kennykristkentro</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 text-slate-200 text-xs">
      {/* Top Banner Header */}
      <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/40 border border-amber-500/30 rounded-3xl p-4 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-amber-500/5 blur-3xl pointer-events-none" />
        <div className="relative z-10 space-y-2">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-amber-400" />
              RESTRICTED LAB • AUTHORIZED: kennykristkentro
            </span>
            <span className="px-2.5 py-0.5 rounded-md bg-sky-500/20 border border-sky-500/40 text-sky-300 text-[10px] font-bold">
              Gemini 2.5 Engine
            </span>
          </div>

          <h1 className="text-lg sm:text-xl font-black text-white tracking-wide">
            Ken Level 8 Engine Study & Gemini Master Training Lab
          </h1>
          <p className="text-xs text-slate-400 max-w-3xl leading-relaxed">
            Generate 1,000 Ken 8 self-play games, analyze positional weaknesses with Gemini AI, and execute a 100-game benchmark match to achieve a <strong className="text-emerald-400 font-bold">90%+ Win/Draw target</strong> against Ken Level 8.
          </p>
        </div>
      </div>

      {/* Gemini API Key & Training Management Bar */}
      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-3 flex-1">
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
            <Key className="w-5 h-5" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                Gemini API Key Setup
                <span className="text-[10px] font-normal text-slate-400">(Used for Grandmaster Pattern Analysis)</span>
              </label>
              {keySavedToast && (
                <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1 animate-fade-in">
                  <Check className="w-3 h-3" /> Key Saved!
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="password"
                placeholder="Enter AI Studio / Google Gemini API Key (AIzaSy...)"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none transition font-mono"
              />
              <button
                onClick={handleSaveApiKey}
                className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500 border border-amber-500/40 text-amber-300 hover:text-slate-950 text-xs font-bold transition shrink-0 cursor-pointer"
              >
                Save Key
              </button>
            </div>
          </div>
        </div>

        {/* Restart / Reset Training All Over Button */}
        <div className="flex items-center shrink-0 border-t md:border-t-0 md:border-l border-slate-800 pt-3 md:pt-0 md:pl-4">
          <button
            onClick={() => setShowResetConfirm(true)}
            className="w-full md:w-auto py-2 px-3.5 rounded-xl bg-rose-500/10 hover:bg-rose-500 border border-rose-500/30 text-rose-300 hover:text-white text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-sm"
          >
            <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
            <span>Reset All & Restart Training</span>
          </button>
        </div>
      </div>

      {/* Confirmation Modal for Reset */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Restart Training From Scratch?</h3>
                <p className="text-xs text-slate-400">This will wipe all 1,000 game logs, Gemini study cache, and benchmark scores.</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 bg-slate-950 p-3 rounded-xl border border-slate-800">
              Are you sure? Once reset, you can tap <strong className="text-sky-300">"Simulate 1,000 Games"</strong> to begin generating a brand new dataset from 0.
            </p>

            <div className="flex items-center gap-3 justify-end pt-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleResetAllTraining}
                className="py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-extrabold transition cursor-pointer shadow-lg shadow-rose-600/30"
              >
                Yes, Wipe & Restart All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Metric 1: Dataset */}
        <div className="bg-slate-950 border border-slate-850 rounded-2xl p-3.5 space-y-1.5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-wider">Self-Play Dataset</span>
            <Database className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-xl font-black text-white font-mono">
            {dataset.length} <span className="text-xs text-slate-500 font-normal">/ 1,000</span>
          </div>
          <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-sky-500 h-full transition-all duration-300"
              style={{ width: `${Math.min(100, (dataset.length / 1000) * 100)}%` }}
            />
          </div>
        </div>

        {/* Metric 2: Gemini Counter-Book */}
        <div className="bg-slate-950 border border-slate-850 rounded-2xl p-3.5 space-y-1.5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-wider">Gemini Counter-Book</span>
            <Brain className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-sm font-black text-white truncate">
            {geminiStudy ? "Active & Synthesized" : "Pending Study"}
          </div>
          <div className="text-[10px] text-slate-500 flex items-center gap-1">
            {geminiStudy ? (
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Ready for Benchmark
              </span>
            ) : (
              "Run Deep Study to unlock"
            )}
          </div>
        </div>

        {/* Metric 3: Benchmark Progress */}
        <div className="bg-slate-950 border border-slate-850 rounded-2xl p-3.5 space-y-1.5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-wider">Benchmark Progress</span>
            <Trophy className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xl font-black text-white font-mono">
            {benchmarkStats.completedGames} <span className="text-xs text-slate-500 font-normal">/ 100 Games</span>
          </div>
          <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-amber-500 h-full transition-all duration-300"
              style={{ width: `${(benchmarkStats.completedGames / 100) * 100}%` }}
            />
          </div>
        </div>

        {/* Metric 4: Win + Draw Rate vs Ken 8 */}
        <div className="bg-slate-950 border border-slate-850 rounded-2xl p-3.5 space-y-1.5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-wider">Win + Draw Rate</span>
            <Target className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xl font-black font-mono ${benchmarkStats.winDrawRate >= 90 ? "text-emerald-400" : "text-amber-400"}`}>
              {benchmarkStats.winDrawRate}%
            </span>
            {benchmarkStats.completedGames > 0 && (
              <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${benchmarkStats.winDrawRate >= 90 ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "bg-amber-500/20 text-amber-300"}`}>
                {benchmarkStats.winDrawRate >= 90 ? "TARGET MET (≥90%)" : "Target: 90%"}
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-500">
            {benchmarkStats.geminiWins} Wins • {benchmarkStats.draws} Draws • {benchmarkStats.kenWins} Losses
          </div>
        </div>
      </div>

      {/* Primary Action Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
        <button
          onClick={handleSimulateDataset}
          disabled={isBenchmarking}
          className={`py-3 px-4 rounded-xl border font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-md ${
            isSimulating
              ? "bg-sky-500 text-slate-950 border-sky-400 font-extrabold"
              : "bg-sky-500/15 hover:bg-sky-500 border-sky-500/30 text-sky-300 hover:text-slate-950"
          }`}
        >
          <Database className={`w-4 h-4 ${isSimulating ? "animate-spin" : ""}`} />
          <span>
            {isSimulating
              ? `Running in Background (${simProgress}%) • Tap to Pause`
              : dataset.length >= 1000
              ? "Dataset Ready (1,000 Games)"
              : "Simulate 1,000 Games"}
          </span>
        </button>

        <button
          onClick={handleRunStudy}
          disabled={isStudying || isSimulating || isBenchmarking}
          className="py-3 px-4 rounded-xl bg-amber-500/20 hover:bg-amber-500 border border-amber-500/40 hover:border-amber-500 text-amber-300 hover:text-slate-950 font-bold transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-md"
        >
          <Brain className={`w-4 h-4 ${isStudying ? "animate-spin" : ""}`} />
          <span>{isStudying ? "Analyzing with Gemini..." : "Gemini Deep Pattern Study"}</span>
        </button>

        <button
          onClick={handleRunBenchmark}
          disabled={isBenchmarking || isSimulating || isStudying}
          className="py-3 px-4 rounded-xl bg-emerald-500/20 hover:bg-emerald-500 border border-emerald-500/40 hover:border-emerald-500 text-emerald-300 hover:text-slate-950 font-bold transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-md"
        >
          <Play className={`w-4 h-4 ${isBenchmarking ? "animate-pulse" : ""}`} />
          <span>{isBenchmarking ? `Testing (${benchmarkStats.completedGames}/100)` : "Run 100 Benchmark Games"}</span>
        </button>

        <button
          onClick={handleResetData}
          disabled={isSimulating || isBenchmarking || isStudying}
          className="py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white font-bold transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Reset Lab Data</span>
        </button>
      </div>

      {/* Main Analysis & Live Visualizer Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Live 10x10 Board Visualizer & Recent Benchmark Matches */}
        <div className="lg:col-span-5 space-y-4">
          {/* Live Board Canvas */}
          <div className="bg-slate-950 border border-slate-850 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-extrabold text-white flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-amber-400" />
                Live Engine Execution Visualizer
              </span>
              {lastMoveNotation && (
                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 font-mono text-[10px]">
                  Last Move: {lastMoveNotation}
                </span>
              )}
            </div>

            {/* Compact Board Grid */}
            {(() => {
              const lastMoveParts = lastMoveNotation ? lastMoveNotation.split(/[-x]/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) : [];
              const lastMoveFrom = lastMoveParts.length > 0 ? lastMoveParts[0] : null;
              const lastMoveTo = lastMoveParts.length > 1 ? lastMoveParts[lastMoveParts.length - 1] : null;

              return (
                <div className="aspect-square w-full max-w-[280px] mx-auto bg-amber-950/80 p-1.5 rounded-xl border-2 border-amber-900/60 shadow-inner grid grid-cols-10 gap-0.5">
                  {Array.from({ length: 10 }).map((_, rIdx) =>
                    Array.from({ length: 10 }).map((_, cIdx) => {
                      const isDark = (rIdx + cIdx) % 2 === 0;
                      const sq = ngRcToSq(rIdx, cIdx);
                      const cell = sq ? activeBoard[sq] : null;
                      const col = getCol(cell);
                      const isFrom = sq !== null && lastMoveFrom === sq;
                      const isTo = sq !== null && lastMoveTo === sq;

                      return (
                        <div
                          key={`${rIdx}_${cIdx}`}
                          className={`relative aspect-square rounded-[2px] flex items-center justify-center ${
                            isFrom
                              ? "bg-amber-400/50 ring-1 ring-amber-300"
                              : isTo
                              ? "bg-yellow-400/60 ring-1 ring-yellow-300"
                              : isDark
                              ? "bg-[#3e2723]"
                              : "bg-[#d7ccc8]"
                          }`}
                        >
                          {cell && (
                            <div
                              className={`w-4/5 h-4/5 rounded-full border shadow-sm flex items-center justify-center ${
                                col === "W"
                                  ? "bg-amber-100 border-amber-300 text-slate-900"
                                  : "bg-slate-900 border-slate-700 text-amber-400"
                              }`}
                            >
                              {isKing(cell) && <span className="text-[8px] font-black">★</span>}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })()}
            <div className="text-[10px] text-center text-slate-500 font-sans">
              10x10 Nigerian Draughts • Free-Choice Captures • Flying Kings
            </div>
          </div>

          {/* Recent Benchmark Matches List */}
          <div className="bg-slate-950 border border-slate-850 rounded-2xl p-4 space-y-3">
            <div className="font-extrabold text-white text-xs flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" />
              Recent Benchmark Matches ({benchmarkStats.recentMatches.length})
            </div>

            {benchmarkStats.recentMatches.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs italic">
                No benchmark games recorded yet. Tap "Run 100 Benchmark Games" to test Gemini vs Ken 8.
              </div>
            ) : (
              <div className="max-h-[260px] overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                {benchmarkStats.recentMatches.map((m, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-extrabold text-slate-200 text-xs flex items-center gap-1.5">
                        <span>Game #{m.gameNumber}</span>
                        <span
                          className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${
                            m.winner === "Gemini"
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                              : m.winner === "Draw"
                              ? "bg-slate-800 text-slate-300 border-slate-700"
                              : "bg-rose-500/20 text-rose-300 border-rose-500/30"
                          }`}
                        >
                          {m.winner === "Gemini" ? "GEMINI WIN" : m.winner === "Draw" ? "DRAW" : "KEN 8 WIN"}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{m.summary}</div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500 shrink-0">{m.moves} moves</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Gemini Counter-Book & Strategic Blueprint */}
        <div className="lg:col-span-7 space-y-4">
          {geminiStudy ? (
            <div className="space-y-4">
              {/* Executive Summary Card */}
              <div className="bg-slate-950 border border-slate-850 rounded-2xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-amber-400 font-extrabold text-xs">
                  <Brain className="w-4 h-4" />
                  Executive Synthesis: Ken 8 Engine Profile
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{geminiStudy.summary}</p>
                <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 text-[11px] text-slate-400">
                  <strong className="text-amber-300">Style Analysis: </strong> {geminiStudy.ken8StyleAnalysis}
                </div>
              </div>

              {/* Opening Counters Table */}
              <div className="bg-slate-950 border border-slate-850 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-white text-xs flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-sky-400" />
                    Opening Counter-Book Refutations
                  </span>
                  <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    High Win Expectancy
                  </span>
                </div>

                <div className="space-y-2">
                  {geminiStudy.openingCounters?.map((oc, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-amber-300 text-xs">
                          {oc.opening} → <strong className="text-emerald-400">{oc.bestCounter}</strong>
                        </span>
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-300">
                          {oc.winRateBoost}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">{oc.explanation}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tactical Traps & Combinations */}
              <div className="bg-slate-950 border border-slate-850 rounded-2xl p-4 space-y-3">
                <div className="font-extrabold text-white text-xs flex items-center gap-2">
                  <Flame className="w-4 h-4 text-rose-400" />
                  Tactical Traps & Forced Combinations
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {geminiStudy.tacticalTraps?.map((trap, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1"
                    >
                      <div className="font-extrabold text-amber-300 text-xs">{trap.title}</div>
                      <div className="text-[10px] text-slate-400">
                        <strong>Setup:</strong> {trap.setup}
                      </div>
                      <div className="text-[10px] text-emerald-400 font-mono">
                        <strong>Trigger:</strong> {trap.triggerMove}
                      </div>
                      <div className="text-[10px] text-slate-300 italic">
                        <strong>Reward:</strong> {trap.reward}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* King Endgame Blueprint & Rules */}
              <div className="bg-slate-950 border border-slate-850 rounded-2xl p-4 space-y-2.5">
                <div className="font-extrabold text-white text-xs flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  King Endgame Rules & Master Recommendations
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {geminiStudy.kingEndgameBlueprint}
                </p>
                <div className="space-y-1.5 pt-1">
                  {geminiStudy.masterRecommendations?.map((rec, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-slate-300">
                      <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span>{rec}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-950 border border-slate-850 rounded-2xl p-8 text-center space-y-3">
              <Brain className="w-10 h-10 text-slate-700 mx-auto" />
              <div className="text-sm font-bold text-slate-300">No Gemini Study Generated Yet</div>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Tap <strong className="text-amber-400">Gemini Deep Pattern Study</strong> above to synthesize the Ken Level 8 self-play dataset and unlock the Master Opening Counter-Book.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
