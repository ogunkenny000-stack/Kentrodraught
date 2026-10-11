import { describe, it, expect, vi, beforeEach } from "vitest";
import { createInitialBoard, generateLegalMoves, applyMove } from "../gameLogic";
vi.mock("./kenEngine", () => ({ analyzeKen: vi.fn() }));
import { analyzeKen } from "./kenEngine";
import { evaluatePosition, classifyMove, analyzeMoveHistory } from "./analysis";
beforeEach(() => { vi.mocked(analyzeKen).mockReset(); });
describe("analysis correctness", () => {
  it("recognizes a no-move position without a network request", async () => {
    const board = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i + 1, null]));
    expect(await evaluatePosition(board, "B", 0.5)).toEqual({ score: -10000, bestMove: null });
    expect(analyzeKen).not.toHaveBeenCalled();
  });
  it("does not cache an unavailable engine as a drawn evaluation", async () => {
    vi.mocked(analyzeKen).mockRejectedValue(new Error("offline"));
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
    vi.mocked(analyzeKen).mockResolvedValue({ move, score: 0, depth: 1, nodes: 1, pv: "" });
    const progress: number[] = [];
    const result = await analyzeMoveHistory([move], (pct) => progress.push(pct));
    expect(result[0]).toBeDefined(); expect(progress.at(-1)).toBe(100);
  });
});
