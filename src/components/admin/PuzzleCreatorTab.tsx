import React, { useState } from "react";
import { 
  Puzzle, Plus, Trash2, Check, RefreshCw, ArrowLeft, Play, ShieldAlert, Sparkles, AlertCircle, FileText, Upload 
} from "lucide-react";
import { 
  Board, Piece, createInitialBoard, generateLegalMoves, applyMove, 
  boardToScanFen, scanFenToBoard, verifyPuzzleLine, ngSqToRc, ngRcToSq, Move 
} from "../../gameLogic";
import { apiPost } from "../../apiClient";

export function PuzzleCreatorTab() {
  const [board, setBoard] = useState<Board>(createInitialBoard());
  const [solverColor, setSolverColor] = useState<"W" | "B">("W");
  const [currentTurn, setCurrentTurn] = useState<"W" | "B">("W");
  
  // Metadata
  const [title, setTitle] = useState("");
  const [difficulty, setDifficulty] = useState<"Easy" | "Medium" | "Hard">("Medium");
  const [theme, setTheme] = useState("Tactics");
  const [description, setDescription] = useState("");
  const [explanation, setExplanation] = useState("");

  // Bulk import state
  const [bulkText, setBulkText] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResultMsg, setBulkResultMsg] = useState<string | null>(null);

  const handleBulkImport = async () => {
    if (!bulkText.trim()) {
      setBulkResultMsg("Please paste JSON puzzles data.");
      return;
    }
    setBulkImporting(true);
    setBulkResultMsg(null);
    try {
      let parsedPuzzles: any[] = [];
      const trimmed = bulkText.trim();
      if (trimmed.startsWith("[")) {
        parsedPuzzles = JSON.parse(trimmed);
      } else {
        try {
          parsedPuzzles = JSON.parse(`[${trimmed}]`);
        } catch {
          const lines = trimmed.split("\n");
          for (const line of lines) {
            try {
              const obj = JSON.parse(line.replace(/,$/, ""));
              if (obj && obj.fen) parsedPuzzles.push(obj);
            } catch {}
          }
        }
      }

      if (parsedPuzzles.length === 0) {
        throw new Error("No valid puzzle JSON objects found. Please paste a JSON array: [{ title, fen, solution: [...] }, ...]");
      }

      const res = await apiPost("/api/admin/puzzles/bulk", { puzzles: parsedPuzzles });
      setBulkResultMsg(`Successfully imported ${res.importedCount} puzzles! (${res.errorsCount} errors).`);
      setBulkText("");
    } catch (err: any) {
      setBulkResultMsg(`Bulk import error: ${err?.message || "Invalid format"}`);
    } finally {
      setBulkImporting(false);
    }
  };

  const [deletingBulk, setDeletingBulk] = useState(false);

  const handleDeleteBulkPuzzles = async (targetSource: "bulk_or_sql" | "all") => {
    const label = targetSource === "all" ? "ALL puzzles in the database" : "all bulk/SQL imported puzzles";
    if (!window.confirm(`Are you sure you want to delete ${label}? This cannot be undone.`)) return;
    
    setDeletingBulk(true);
    setBulkResultMsg(null);
    try {
      const res = await apiPost("/api/admin/puzzles/bulk-delete", { source: targetSource });
      setBulkResultMsg(`Successfully deleted ${res.deletedCount ?? "all"} puzzles!`);
    } catch (err: any) {
      setBulkResultMsg(`Delete error: ${err?.message || "Failed to delete puzzles"}`);
    } finally {
      setDeletingBulk(false);
    }
  };

  const handleSqlFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkImporting(true);
    setBulkResultMsg(null);
    try {
      const text = await file.text();
      const res = await apiPost("/api/admin/puzzles/sql-file", { sqlText: text });
      setBulkResultMsg(`Successfully imported ${res.importedCount} puzzles from SQL file! (${res.errorsCount} errors).`);
    } catch (err: any) {
      setBulkResultMsg(`SQL file import error: ${err?.message || "Failed to process SQL file"}`);
    } finally {
      setBulkImporting(false);
      if (e.target) e.target.value = "";
    }
  };

  // Step: "setup" | "recording"
  const [step, setStep] = useState<"setup" | "recording">("setup");
  
  // Selected piece for setup mode
  const [setupPiece, setSetupPiece] = useState<Piece>("w");
  
  // Solution recording state
  const [solutionMoves, setSolutionMoves] = useState<(Move & { role: "solver" | "reply"; text?: string })[]>([]);
  const [selectedSq, setSelectedSq] = useState<number | null>(null);
  
  // Status / feedback
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<"success" | "error" | "info">("info");
  const [submitting, setSubmitting] = useState(false);

  // History stack for recording rollback
  const [historyStack, setHistoryStack] = useState<{ board: Board; turn: "W" | "B"; moves: any[] }[]>([]);

  const handleSquareClick = (sq: number) => {
    if (step === "setup") {
      setBoard(prev => ({ ...prev, [sq]: setupPiece }));
      return;
    }

    if (step === "recording") {
      const piece = board[sq];
      const isMyTurnPiece = piece && (currentTurn === "W" ? piece === "w" || piece === "W" : piece === "b" || piece === "B");

      if (selectedSq === null) {
        if (isMyTurnPiece) {
          setSelectedSq(sq);
        }
      } else {
        if (selectedSq === sq) {
          setSelectedSq(null);
          return;
        }
        if (isMyTurnPiece) {
          setSelectedSq(sq);
          return;
        }

        // Try to make a move from selectedSq to sq
        const legals = generateLegalMoves(board, currentTurn);
        const matchingMove = legals.find(m => m.from === selectedSq && m.to === sq);

        if (matchingMove) {
          // Record move
          const role: "solver" | "reply" = currentTurn === solverColor ? "solver" : "reply";
          const newMove = { ...matchingMove, role };

          setHistoryStack(prev => [...prev, { board: { ...board }, turn: currentTurn, moves: [...solutionMoves] }]);

          const res = applyMove(board, matchingMove);
          const nextTurn = currentTurn === "W" ? "B" : "W";
          setBoard(res.board);
          setCurrentTurn(nextTurn);
          setSolutionMoves(prev => [...prev, newMove]);
          setSelectedSq(null);
          setStatusMsg(null);
        } else {
          setStatusMsg("Not a legal move in this position.");
          setStatusType("error");
          setSelectedSq(null);
        }
      }
    }
  };

  const handleUndoMove = () => {
    if (historyStack.length === 0) return;
    const lastState = historyStack[historyStack.length - 1];
    setBoard(lastState.board);
    setCurrentTurn(lastState.turn);
    setSolutionMoves(lastState.moves);
    setHistoryStack(prev => prev.slice(0, prev.length - 1));
    setSelectedSq(null);
    setStatusMsg(null);
  };

  const handleResetSolution = () => {
    // Reset back to initial setup position
    const startPos = scanFenToBoard(boardToScanFen(board, solverColor)); // wait, reset to setup board & solver color turn
    // Re-initialize from setup board
    setBoard(initialSetupBoard);
    setCurrentTurn(solverColor);
    setSolutionMoves([]);
    setHistoryStack([]);
    setSelectedSq(null);
    setStatusMsg(null);
  };

  const [initialSetupBoard, setInitialSetupBoard] = useState<Board>(createInitialBoard());

  const startRecording = () => {
    if (!title.trim()) {
      setStatusMsg("Please enter a title for the puzzle.");
      setStatusType("error");
      return;
    }
    setInitialSetupBoard({ ...board });
    setCurrentTurn(solverColor);
    setSolutionMoves([]);
    setHistoryStack([]);
    setStep("recording");
    setStatusMsg("Solution recording started. Make the solver's first move!");
    setStatusType("success");
  };

  const handlePublish = async () => {
    if (solutionMoves.length === 0) {
      setStatusMsg("Record at least one solution move.");
      setStatusType("error");
      return;
    }

    const fen = boardToScanFen(initialSetupBoard, solverColor);

    // Verify line locally first
    const lineCheck = verifyPuzzleLine(initialSetupBoard, solverColor, solutionMoves);
    if (!lineCheck.ok) {
      setStatusMsg(`Solution check failed: ${lineCheck.error}`);
      setStatusType("error");
      return;
    }

    setSubmitting(true);
    setStatusMsg(null);
    try {
      const res = await apiPost("/api/admin/puzzles", {
        title: title.trim(),
        difficulty,
        theme,
        description: description.trim(),
        fen,
        solution: solutionMoves,
        explanation: explanation.trim(),
      });

      setStatusMsg(`Puzzle published successfully! ID: ${res.id}`);
      setStatusType("success");
      // Reset form
      setTitle("");
      setDescription("");
      setExplanation("");
      setSolutionMoves([]);
      setHistoryStack([]);
      setStep("setup");
      setBoard(createInitialBoard());
    } catch (e: any) {
      setStatusMsg(e?.message || "Failed to publish puzzle.");
      setStatusType("error");
    } finally {
      setSubmitting(false);
    }
  };

  // Render 10x10 Board
  const renderBoardGrid = () => {
    const squares = [];
    const legals = step === "recording" && selectedSq !== null ? generateLegalMoves(board, currentTurn) : [];
    const validDestinations = new Set(legals.filter(m => m.from === selectedSq).map(m => m.to));

    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        const isDark = (r + c) % 2 === 0;
        const sq = isDark ? ngRcToSq(r, c) : null;
        const piece = sq !== null ? board[sq] : null;
        const isSelected = sq === selectedSq;
        const isDestination = sq !== null && validDestinations.has(sq);

        squares.push(
          <div
            key={`${r}-${c}`}
            onClick={() => sq !== null && handleSquareClick(sq)}
            className={`relative flex items-center justify-center aspect-square select-none transition-colors ${
              !isDark
                ? "bg-amber-100/10"
                : isSelected
                ? "bg-amber-500/50 ring-2 ring-amber-400"
                : isDestination
                ? "bg-emerald-500/40 ring-2 ring-emerald-400 cursor-pointer"
                : "bg-slate-900 border border-slate-800/80 hover:bg-slate-800/80 cursor-pointer"
            }`}
          >
            {sq !== null && (
              <>
                <span className="absolute top-0.5 left-1 text-[8px] font-mono text-slate-500/60 pointer-events-none">
                  {sq}
                </span>
                {piece && (
                  <div
                    className={`w-4/5 h-4/5 rounded-full flex items-center justify-center shadow-md font-bold text-xs transition-transform transform active:scale-95 ${
                      piece === "w"
                        ? "bg-gradient-to-tr from-slate-200 to-white text-slate-950 border-2 border-slate-300 shadow-slate-950/40"
                        : piece === "W"
                        ? "bg-gradient-to-tr from-amber-200 via-white to-amber-300 text-slate-950 border-2 border-amber-400 shadow-amber-500/50 ring-2 ring-amber-400/50"
                        : piece === "b"
                        ? "bg-gradient-to-tr from-slate-900 to-slate-800 text-slate-200 border-2 border-slate-700 shadow-black"
                        : "bg-gradient-to-tr from-amber-700 via-slate-900 to-amber-600 text-amber-200 border-2 border-amber-500 shadow-amber-950/80 ring-2 ring-amber-500/50"
                    }`}
                  >
                    {piece.toUpperCase() === "W" && piece === piece.toUpperCase() ? "👑" : ""}
                  </div>
                )}
              </>
            )}
          </div>
        );
      }
    }
    return squares;
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full pb-12">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 bg-slate-900/60 border border-slate-800 p-4 rounded-2xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Puzzle className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-100">Puzzle & Trap Creator</h2>
            <p className="text-xs text-slate-400">Design tactical positions and record verified multi-move solutions</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {step === "recording" && (
            <button
              onClick={() => setStep("setup")}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition cursor-pointer flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Setup</span>
            </button>
          )}
          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${step === "setup" ? "bg-amber-500/10 text-amber-400 border-amber-500/30" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"}`}>
            {step === "setup" ? "Phase 1: Position Setup" : "Phase 2: Recording Solution"}
          </span>
        </div>
      </div>

      {statusMsg && (
        <div className={`p-3 rounded-xl border text-xs font-bold flex items-center gap-2 ${
          statusType === "success" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" :
          statusType === "error" ? "bg-rose-500/10 border-rose-500/30 text-rose-400" :
          "bg-sky-500/10 border-sky-500/30 text-sky-400"
        }`}>
          {statusType === "error" ? <AlertCircle className="w-4 h-4 shrink-0" /> : <Sparkles className="w-4 h-4 shrink-0" />}
          <span>{statusMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Board Editor / Interactive Board */}
        <div className="lg:col-span-7 flex flex-col items-center gap-4 bg-slate-900/40 border border-slate-800 p-4 rounded-2xl">
          <div className="w-full flex items-center justify-between text-xs font-bold text-slate-300 px-1">
            <span>{step === "setup" ? "Click squares to place/change pieces" : `Turn: ${currentTurn === "W" ? "White" : "Black"} (${currentTurn === solverColor ? "Solver" : "Defender"})`}</span>
            {step === "setup" && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setBoard(createInitialBoard())}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-amber-400 transition cursor-pointer"
                >
                  Standard Start
                </button>
                <button
                  onClick={() => {
                    const empty: Board = {};
                    for (let i = 1; i <= 50; i++) empty[i] = null;
                    setBoard(empty);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-rose-400 transition cursor-pointer"
                >
                  Clear Board
                </button>
              </div>
            )}
          </div>

          <div className="w-full max-w-[420px] aspect-square bg-slate-950 p-2 rounded-2xl border-2 border-slate-800 grid grid-cols-10 gap-0.5 shadow-xl">
            {renderBoardGrid()}
          </div>

          {/* Setup Piece Palette */}
          {step === "setup" && (
            <div className="flex items-center justify-center gap-2 flex-wrap pt-2">
              <span className="text-[11px] font-bold text-slate-400 mr-2">Piece Palette:</span>
              {[
                { piece: "w", label: "White Man", bg: "bg-slate-200 text-slate-950" },
                { piece: "W", label: "White King", bg: "bg-amber-300 text-slate-950" },
                { piece: "b", label: "Black Man", bg: "bg-slate-800 text-slate-200" },
                { piece: "B", label: "Black King", bg: "bg-amber-700 text-amber-200" },
                { piece: null, label: "Erase", bg: "bg-slate-800 text-rose-400" },
              ].map(item => (
                <button
                  key={String(item.piece)}
                  onClick={() => setSetupPiece(item.piece as Piece)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer flex items-center gap-1.5 ${
                    setupPiece === item.piece ? "border-amber-400 bg-amber-500/20 text-amber-300" : "border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  <span className={`w-3 h-3 rounded-full ${item.bg} inline-block`} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Metadata & Solution Manager */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {step === "setup" ? (
            <div className="flex flex-col gap-4 bg-slate-900/40 border border-slate-800 p-5 rounded-2xl">
              <h3 className="text-sm font-extrabold text-slate-200">1. Puzzle Properties</h3>
              
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-400">Puzzle Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Brilliant King Trap in Corner"
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-400">Difficulty</label>
                  <select
                    value={difficulty}
                    onChange={e => setDifficulty(e.target.value as any)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="Easy">Easy</option>
                    <option value="Medium">Medium</option>
                    <option value="Hard">Hard</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-400">Color to Solve</label>
                  <select
                    value={solverColor}
                    onChange={e => setSolverColor(e.target.value as any)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="W">White (W)</option>
                    <option value="B">Black (B)</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-400">Theme</label>
                <input
                  type="text"
                  value={theme}
                  onChange={e => setTheme(e.target.value)}
                  placeholder="e.g. Trap, Tactics, Endgame"
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-400">Description / Prompt</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="What is the objective? e.g. White to move and win."
                  rows={2}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 resize-none"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-400">Explanation / Educational Note</label>
                <textarea
                  value={explanation}
                  onChange={e => setExplanation(e.target.value)}
                  placeholder="Why does this solution work? Explained after solving."
                  rows={2}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 resize-none"
                />
              </div>

              <button
                onClick={startRecording}
                className="mt-2 w-full py-3 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 text-slate-950 font-extrabold text-xs shadow-lg shadow-amber-500/20 hover:from-amber-500 hover:to-amber-400 transition cursor-pointer flex items-center justify-center gap-2"
              >
                <span>Proceed to Record Solution</span>
                <Play className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4 bg-slate-900/40 border border-slate-800 p-5 rounded-2xl">
              <h3 className="text-sm font-extrabold text-slate-200">2. Solution Line</h3>
              <p className="text-[11px] text-slate-400">
                Play the solution moves on the board. Alternates between Solver ({solverColor}) and Defender.
              </p>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 min-h-[140px] max-h-[220px] overflow-y-auto flex flex-col gap-1.5">
                {solutionMoves.length === 0 ? (
                  <span className="text-xs text-slate-500 italic my-auto text-center">No moves recorded yet. Click pieces on the board to play.</span>
                ) : (
                  solutionMoves.map((m, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 font-mono text-[10px]">{Math.floor(idx / 2) + 1}.</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${m.role === "solver" ? "bg-amber-500/20 text-amber-300" : "bg-slate-800 text-slate-400"}`}>
                          {m.role === "solver" ? "Solver" : "Reply"}
                        </span>
                        <span className="font-mono font-bold text-slate-200">{m.from}{m.caps?.length ? "x" : "-"}{m.to}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleUndoMove}
                  disabled={solutionMoves.length === 0}
                  className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-bold text-slate-300 transition cursor-pointer"
                >
                  Undo Move
                </button>
                <button
                  onClick={handleResetSolution}
                  className="flex-1 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-xs font-bold text-rose-400 border border-rose-500/30 transition cursor-pointer"
                >
                  Reset Line
                </button>
              </div>

              <button
                onClick={handlePublish}
                disabled={submitting || solutionMoves.length === 0}
                className="mt-2 w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-extrabold text-xs shadow-lg shadow-emerald-500/20 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-50 transition cursor-pointer flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                <span>{submitting ? "Publishing..." : "Publish Puzzle to Arena"}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bulk Import Section for massive puzzle sets (e.g. 2,604 puzzles) */}
      <div className="mt-8 bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <h3 className="text-sm font-black text-amber-400 uppercase tracking-wider mb-2">
          📦 Bulk Import Puzzles (Massive Dataset / 2,604 Puzzles)
        </h3>
        <p className="text-xs text-slate-400 mb-4 leading-relaxed">
          Paste your JSON array of puzzles below (e.g. <code>[{"{"} "title": "...", "fen": "...", "solution": [...] {"}"}]</code>). The server automatically processes and inserts them in robust batches to bypass size limits.
        </p>
        <textarea
          value={bulkText}
          onChange={e => setBulkText(e.target.value)}
          placeholder="Paste massive JSON puzzle array here..."
          rows={6}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-500 mb-3 resize-y"
        />
        {bulkResultMsg && (
          <div className={`p-3 rounded-xl text-xs font-semibold mb-3 ${bulkResultMsg.includes("Successfully") ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300" : "bg-rose-500/10 border border-rose-500/30 text-rose-300"}`}>
            {bulkResultMsg}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleBulkImport}
            disabled={bulkImporting || !bulkText.trim()}
            className="px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs shadow-lg transition disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            <span>{bulkImporting ? "Importing Puzzles..." : "Import Puzzles Dataset"}</span>
          </button>

          <label className="px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 border border-amber-500/30 font-extrabold text-xs shadow-lg transition cursor-pointer flex items-center justify-center gap-2">
            <Upload className="w-4 h-4" />
            <span>{bulkImporting ? "Processing SQL..." : "Upload .SQL File"}</span>
            <input
              type="file"
              accept=".sql,.txt"
              onChange={handleSqlFileUpload}
              disabled={bulkImporting}
              className="hidden"
            />
          </label>

          <button
            onClick={() => handleDeleteBulkPuzzles("bulk_or_sql")}
            disabled={deletingBulk}
            className="px-4 py-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 font-extrabold text-xs shadow-lg transition disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2 ml-auto"
          >
            <Trash2 className="w-4 h-4" />
            <span>{deletingBulk ? "Removing..." : "Remove Bulk / SQL Puzzles"}</span>
          </button>

          <button
            onClick={() => handleDeleteBulkPuzzles("all")}
            disabled={deletingBulk}
            className="px-4 py-3 rounded-xl bg-rose-700/40 hover:bg-rose-700/60 text-rose-200 border border-rose-600/50 font-extrabold text-xs shadow-lg transition disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            <span>{deletingBulk ? "Removing..." : "Delete ALL Puzzles"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
