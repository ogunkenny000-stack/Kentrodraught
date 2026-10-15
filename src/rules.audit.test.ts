import { describe, expect, it } from "vitest";
import { applyMove, boardToScanFen, checkGameEnd, convertSq, generateLegalMoves, ngRcToSq, ngSqToRc, scanFenToBoard, type Board, type Piece } from "./gameLogic";
import { checkGameEndFrom } from "./server/gameEnd";
import { drawFixtures, fixtureHistory } from "./rules.fixtures";

describe("Nigerian rules audit fixtures", () => {
  it("round-trips all 50 Nigerian squares and the engine square bijection", () => {
    for (let square = 1; square <= 50; square++) {
      expect(ngRcToSq(...ngSqToRc(square))).toBe(square);
      expect(convertSq(convertSq(square))).toBe(square);
    }
  });

  it("moves men forward quietly and captures backward when required", () => {
    expect(generateLegalMoves({ 23: "w" }, "W").map((mv) => mv.to)).toEqual([17, 18]);
    expect(generateLegalMoves({ 23: "b" }, "B").map((mv) => mv.to)).toEqual([27, 28]);
    expect(generateLegalMoves({ 23: "w", 28: "b" }, "W")).toEqual([{ from: 23, to: 34, caps: [28], path: [34] }]);
  });

  it("allows terminal king landings even when another landing permits continuation", () => {
    const moves = generateLegalMoves({ 34: "W", 1: "b", 8: "b", 28: "b", 36: "b" }, "W");
    expect(moves.map((mv) => [mv.to, mv.caps]).sort((a, b) => Number(a[0]) - Number(b[0])))
      .toEqual([[4, [28, 8]], [6, [28]], [12, [28]], [41, [28, 36]]]);
    expect(moves.some((mv) => [17, 23].includes(mv.to) && mv.caps.length === 1)).toBe(false);
  });

  it("keeps captured enemies as blockers until a king's chain ends", () => {
    const moves = generateLegalMoves({ 23: "W", 17: "b", 28: "b" }, "W");
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((mv) => mv.caps.length === 1)).toBe(true);
  });

  it("does not crown a man that visits the promotion row mid-capture and leaves it", () => {
    const board = { 13: "w", 7: "b", 6: "b" } as const;
    const moves = generateLegalMoves(board, "W");
    expect(moves).toEqual([{ from: 13, to: 11, caps: [7, 6], path: [2, 11] }]);
    expect(applyMove(board, moves[0])).toMatchObject({ promoted: false, board: { 11: "w" } });
    const finalPromotion = generateLegalMoves({ 13: "w", 7: "b" }, "W")[0];
    expect(applyMove({ 13: "w", 7: "b" }, finalPromotion)).toMatchObject({ promoted: true, board: { 2: "W" } });
  });

  it.each(drawFixtures)("waits for $plies plies before the $reason rule", ({ board, notation, plies, reason }) => {
    const history = fixtureHistory(board, notation);
    expect(history).toHaveLength(plies);
    for (let count = 0; count < plies; count++) expect(checkGameEnd(history.slice(0, count), board).isOver).toBe(false);
    expect(checkGameEnd(history, board)).toMatchObject({ isOver: true, isDraw: true, winner: null });
    expect(checkGameEnd(history, board).reason).toContain(reason);
  });

  it("uses the side to move and gives blocking wins priority over material draws", () => {
    const blocked = { 1: "W", 6: "b", 12: "b", 50: "B" } as const;
    expect(checkGameEnd([], blocked, "W")).toMatchObject({ winner: "B", isOver: true, isDraw: false });
    expect(checkGameEnd([], { 23: "W" }, "B")).toMatchObject({ winner: "W", isOver: true, isDraw: false });
  });

  it("detects threefold repetition from a legal custom-position history", () => {
    const board = { 23: "W", 49: "B" } as const;
    const history = fixtureHistory(board, "23-17 49-44 17-23 44-49 23-17 49-44 17-23 44-49");
    expect(checkGameEnd(history.slice(0, 7), board).isOver).toBe(false);
    expect(checkGameEnd(history, board)).toMatchObject({ isDraw: true, reason: "Threefold repetition" });
  });
});

describe("browser and authoritative room adjudication parity", () => {
  for (const firstMover of ["W", "B"] as const) {
    it.each(drawFixtures)(`agrees at every prefix of $plies plies with ${firstMover} moving first`, ({ board, notation, plies }) => {
      const startingBoard: Board = firstMover === "W" ? board : Object.fromEntries(Object.entries(board).map(([square, piece]): [number, Piece] => [
        51 - Number(square), piece === "W" ? "B" : piece === "B" ? "W" : piece === "w" ? "b" : piece === "b" ? "w" : null,
      ]));
      const transformedNotation = firstMover === "W" ? notation : notation.replace(/\d+/g, (square) => String(51 - Number(square)));
      const history = fixtureHistory(startingBoard, transformedNotation, firstMover);
      let liveBoard = startingBoard;
      for (let count = 0; count <= plies; count++) {
        const prefix = history.slice(0, count);
        const liveTurn = count % 2 === 0 ? firstMover : firstMover === "W" ? "B" : "W";
        expect(checkGameEndFrom(startingBoard, firstMover, prefix, liveBoard, liveTurn)).toEqual(checkGameEnd(prefix, startingBoard, firstMover));
        if (count < plies) liveBoard = applyMove(liveBoard, history[count]).board;
      }
    });
  }
});

describe("dense SCAN FEN import validation", () => {
  it.each(["", "W", "W" + "e".repeat(49), "W" + "e".repeat(51), "X" + "e".repeat(50), "W" + "e".repeat(49) + "?", "W:W31-50:B1-20", " W" + "e".repeat(50)])("rejects malformed position %s", (fen) => {
    expect(() => scanFenToBoard(fen)).toThrow("Invalid SCAN FEN");
  });
  it("round-trips a valid board including kings and the black side to move", () => {
    const board = { 1: "b", 10: "B", 31: "w", 49: "W" } as const;
    const parsed = scanFenToBoard(boardToScanFen(board, "B"));
    expect(parsed.turn).toBe("B");
    for (let square = 1; square <= 50; square++) expect(parsed.board[square]).toBe(board[square as keyof typeof board] ?? null);
  });
});
