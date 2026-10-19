import { describe, it, expect, vi, beforeEach } from "vitest";
import { createInitialBoard, generateLegalMoves, applyMove, type Board } from "../gameLogic";
vi.mock("../engine/offlineKen", () => ({ offlineKenMove: vi.fn() }));
import { offlineKenMove } from "../engine/offlineKen";
import { evaluatePosition, classifyMove, analyzeMoveHistory } from "./analysis";
import { replayForAnalysis } from "./analysisReplay";
beforeEach(() => { vi.mocked(offlineKenMove).mockReset(); });
describe("analysis correctness", () => {
  it("recognizes a no-move position without a network request", async () => {
    const board = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i + 1, null]));
    expect(await evaluatePosition(board, "B", 0.5)).toEqual({ score: -10000, bestMove: null });
    expect(offlineKenMove).not.toHaveBeenCalled();
  });
  it("does not cache an unavailable engine as a drawn evaluation", async () => {
    vi.mocked(offlineKenMove).mockRejectedValue(new Error("offline"));
    await expect(evaluatePosition(createInitialBoard(), "W", 0.5)).rejects.toThrow("offline");
  });
  it("does not label the winning last capture a missed win", async () => {
    const board = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i + 1, null]));
    board[23] = "W"; board[17] = "b";
    const move = generateLegalMoves(board, "W")[0];
    const after = await evaluatePosition(applyMove(board, move).board, "B", 0.5);
    expect(classifyMove(board, "W", move, { score: 500, bestMove: move }, after).quality).not.toBe("Missed Win");
  });
  it("finishes a batch at 100%", async () => {
    const move = generateLegalMoves(createInitialBoard(), "W")[0];
    vi.mocked(offlineKenMove).mockResolvedValue({ move, score: 0, depth: 30, nodes: 1, pv: "" });
    const progress: number[] = [];
    const result = await analyzeMoveHistory([move], (pct) => progress.push(pct));
    expect(result[0]).toBeDefined(); expect(progress.at(-1)).toBe(100);
  });
  it("reviews the actual custom starting board and Black first mover", async () => {
    const start: Board = { 23: "W", 40: "B" };
    const move = generateLegalMoves(start, "B")[0];
    vi.mocked(offlineKenMove).mockImplementation(async (board, turn) => ({ move: generateLegalMoves(board, turn)[0], score: 0, depth: 30, nodes: 1, pv: "" }));
    const result = await analyzeMoveHistory([move], undefined, start, "B");
    expect(result[0]).toBeDefined();
    expect(offlineKenMove).toHaveBeenNthCalledWith(1, expect.objectContaining(start), "B", 0, 30, false, undefined);
    expect(offlineKenMove).toHaveBeenNthCalledWith(2, applyMove(replayForAnalysis([], start, "B").boards[0], move).board, "W", 0, 30, false, undefined);
    expect(start).toEqual({ 23: "W", 40: "B" });
  });
  it("rejects an illegal recorded move before requesting any evaluations", async () => {
    await expect(analyzeMoveHistory([{ from: 1, to: 50, caps: [] }])).rejects.toThrow("Illegal recorded move at ply 1");
    expect(offlineKenMove).not.toHaveBeenCalled();
  });
  it.each([{ 0: "w" }, { 51: "b" }, { 12: "invalid" }, []])("rejects invalid review starting positions", (start) => {
    expect(() => replayForAnalysis([], start as Board)).toThrow("starting position");
  });
  it("keeps a failed review pending instead of inventing a zero score", async () => {
    vi.mocked(offlineKenMove).mockRejectedValue(new Error("engine unavailable"));
    const move = generateLegalMoves(createInitialBoard(), "W")[0];
    await expect(analyzeMoveHistory([move])).rejects.toThrow("engine unavailable");
  });
  it('does not grade a superseded review after its engine request completes', async () => {
    const controller = new AbortController(); controller.abort();
    const onMove = vi.fn();
    const move = generateLegalMoves(createInitialBoard(), 'W')[0];
    await expect(analyzeMoveHistory([move], undefined, undefined, 'W', controller.signal, onMove)).rejects.toThrow();
    expect(onMove).not.toHaveBeenCalled(); expect(offlineKenMove).not.toHaveBeenCalled();
  });
  it('does not call the engine top choice a blunder because separate searches disagree', () => {
    const board = createInitialBoard(); const move = generateLegalMoves(board, 'W')[0];
    expect(classifyMove(board, 'W', move, { score: 500, bestMove: move }, { score: 100, bestMove: null }).quality).toBe('Best');
  });
});
