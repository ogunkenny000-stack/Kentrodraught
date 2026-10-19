import { afterAll, describe, expect, it } from "vitest";
import { boardToScanFen, createInitialBoard, generateLegalMoves, hubMoveStringToNigerian, movesAreEquivalent, type Board } from "../gameLogic";
import { PersistentEngine } from "./nativeEngine";
import { signKenReply, verifyKenReply } from './kenVictoryProof';
import { moveToHubString } from '../gameLogic';

const engine = new PersistentEngine();
afterAll(async () => { await engine.stop(); });
describe("real native HUB integration", () => {
  it.each([
    { name: "opening", board: createInitialBoard(), turn: "W" as const },
    { name: "forced final capture", board: { 23: "W", 17: "b" } as Board, turn: "W" as const },
    { name: "black king forced 49x38 screenshot", board: { 2: "b", 3: "b", 4: "b", 8: "b", 11: "b", 12: "b", 20: "w", 32: "w", 37: "w", 38: "w", 41: "w", 43: "w", 47: "w", 48: "w", 49: "B" } as Board, turn: "B" as const },
    { name: "free-choice king capture", board: { 34: "W", 1: "b", 8: "b", 28: "b", 36: "b" } as Board, turn: "W" as const },
    { name: "uncounted lone-king ending", board: { 23: "W", 50: "B" } as Board, turn: "W" as const },
  ])("returns a legal choice and actual finite evaluation for $name", async ({ board, turn }) => {
    const result = await engine.getMove(boardToScanFen(board, turn), 0.1, 4);
    const parsed = hubMoveStringToNigerian(result.move);
    expect(generateLegalMoves(board, turn).some((move) => movesAreEquivalent(move, parsed))).toBe(true);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.depth).toBeGreaterThan(0);
  }, 20_000);
  it("reuses its initialized process for a real health ping", async () => {
    expect(await engine.ping()).toBe(true);
  });
  it('keeps server attestation valid when a real native capture is replayed by the frontend rules', async () => {
    const board: Board = { 2: 'b', 3: 'b', 4: 'b', 8: 'b', 11: 'b', 12: 'b', 20: 'w', 32: 'w', 37: 'w', 38: 'w', 41: 'w', 43: 'w', 47: 'w', 48: 'w', 49: 'B' };
    const fen = boardToScanFen(board, 'B');
    const reply = await engine.getMove(fen, 0.1, 4);
    const parsed = hubMoveStringToNigerian(reply.move);
    const legal = generateLegalMoves(board, 'B').find(move => movesAreEquivalent(move, parsed))!;
    expect(legal.caps.length).toBeGreaterThan(1);
    const data = { ownerId: 'synthetic-owner', gameId: 'synthetic-game', level: 3, fen, move: reply.move };
    const secret = 'synthetic-attestation-secret-with-thirty-two-characters';
    expect(verifyKenReply({ ...data, move: moveToHubString(legal) }, signKenReply(data, secret), secret)).toBe(true);
  });
});
