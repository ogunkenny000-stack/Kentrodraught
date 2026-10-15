import { afterAll, describe, expect, it } from "vitest";
import { boardToScanFen, createInitialBoard, generateLegalMoves, hubMoveStringToNigerian, movesAreEquivalent, type Board } from "../gameLogic";
import { PersistentEngine } from "./nativeEngine";

const engine = new PersistentEngine();
afterAll(async () => { await engine.stop(); });
describe("real native HUB integration", () => {
  it.each([
    { name: "opening", board: createInitialBoard() },
    { name: "forced final capture", board: { 23: "W", 17: "b" } as Board },
    { name: "free-choice king capture", board: { 34: "W", 1: "b", 8: "b", 28: "b", 36: "b" } as Board },
    { name: "uncounted lone-king ending", board: { 23: "W", 50: "B" } as Board },
  ])("returns a legal choice and actual finite evaluation for $name", async ({ board }) => {
    const result = await engine.getMove(boardToScanFen(board, "W"), 0.1, 4);
    const parsed = hubMoveStringToNigerian(result.move);
    expect(generateLegalMoves(board, "W").some((move) => movesAreEquivalent(move, parsed))).toBe(true);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.depth).toBeGreaterThan(0);
  }, 20_000);
  it("reuses its initialized process for a real health ping", async () => {
    expect(await engine.ping()).toBe(true);
  });
});
