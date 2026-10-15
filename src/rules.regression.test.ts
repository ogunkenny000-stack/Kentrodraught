import { describe, it, expect } from "vitest";
import { Board, Move, generateLegalMoves, applyMove, parseNotationString, parsePdnMoveList, createInitialBoard, moveToNotationString, checkGameEnd } from "./gameLogic";
const empty = (): Board => Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i + 1, null]));

describe("capture and notation regressions", () => {
  it("keeps each terminal king landing even when a nearer landing can continue", () => {
    const board: Board = { 23: "W", 18: "b", 8: "b" };
    const moves = generateLegalMoves(board, "W");
    expect(moves.map(moveToNotationString).sort()).toEqual(["23x3x18x8", "23x5x18", "23x9x18"].sort());
  });
  it("keeps all 141 choices in a high-mobility capture position", () => {
    const board = empty();
    for (const square of [1, 10, 11, 15, 42, 48, 50]) board[square] = "W";
    for (const square of [7, 13, 16, 23, 24, 25, 26, 27, 31, 35, 36, 40, 46]) board[square] = "B";
    expect(generateLegalMoves(board, "W")).toHaveLength(141);
  });
  it("continues a king capture across the vacated starting square", () => {
    const board = empty(); board[23] = "W";
    for (const square of [17, 7, 8, 27]) board[square] = "b";
    const moves = generateLegalMoves(board, "W");
    const candidates = moves.filter((m) => m.path?.slice(0, 3).join(",") === "12,3,14");
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((m) => m.caps.length === 4)).toBe(true);
    expect(candidates.map((m) => m.to).sort((a, b) => a - b)).toEqual([32, 36, 41]);
  });
  it("keeps a man on its origin when a complete capture loops back", () => {
    const board = empty(); board[23] = "w";
    for (const square of [17, 16, 26, 27]) board[square] = "b";
    const move = generateLegalMoves(board, "W").find((m) => m.from === m.to && m.caps.length === 4);
    expect(move).toBeDefined();
    expect(applyMove(board, move!).board[23]).toBe("w");
  });
  it.each(["0-51", "31-26-junk", "31-26garbage", "31--26", "31-26x22", "1x0x7", "1x51x7", "1x2x7oops", "31.5-26", "-1-2", "1-2-3", "1x2x"])("rejects the entire invalid token %s", (token) => {
    expect(parseNotationString(token)).toBeNull();
  });
  it("preserves valid quiet and hub-style capture notation", () => {
    expect(parseNotationString(" 31-26 ")).toEqual({ from: 31, to: 26, caps: [] });
    expect(parseNotationString("23x41x17x7x8x27")).toEqual({ from: 23, to: 41, caps: [17, 7, 8, 27] });
  });
  it("does not import a legal prefix followed by junk", () => {
    const notation = moveToNotationString(generateLegalMoves(createInitialBoard(), "W")[0]);
    expect(parsePdnMoveList(notation)).toHaveLength(1);
    expect(() => parsePdnMoveList(notation + "-junk")).toThrow("valid notation");
  });
});

/** Fixed, legal nonrepeating quiet histories. Checking the arbiter itself at
 * the boundary catches counter and priority errors that a parallel test-only
 * draw counter cannot detect. */
function replayFixture(board: Board, line: string): Move[] {
  const history: Move[] = [];
  let current = { ...board };
  for (const token of line.split(" ")) {
    const parsed = parseNotationString(token)!;
    const turn = history.length % 2 === 0 ? "W" : "B";
    const legal = generateLegalMoves(current, turn).find((move) => move.from === parsed.from && move.to === parsed.to && !move.caps.length);
    if (!legal) throw new Error(`Illegal fixture step ${token}`);
    history.push(legal); current = applyMove(current, legal).board;
  }
  return history;
}

describe("move-counted draw boundaries", () => {
  const two: Board = { 1: "W", 49: "B" };
  const three: Board = { 1: "W", 40: "B", 44: "B", 49: "B" };
  const many: Board = { 1: "W", 2: "W", 6: "W", 40: "B", 44: "B", 49: "B" };
  const twoLine = "1-28 49-16 28-37 16-22 37-24 22-26 24-15 26-22 15-42 22-31";
  const threeLine = "1-28 44-35 28-12 49-11 12-1 35-2 1-17 11-44 17-34 44-11 34-28 11-16 28-46 16-11 46-15 11-27 15-37 2-11 37-42 40-2 42-31 27-14 31-42 14-5 42-15 5-14 15-46 14-30 46-41 2-24 41-5 24-10";
  const manyLine = "6-28 44-16 28-19 49-44 1-50 16-3 19-15 44-22 15-10 3-21 10-19 22-44 19-14 44-38 14-36 38-11 36-42 11-16 50-17 40-49 2-24 16-38 24-18 38-20 42-36 20-43 36-42 49-16 18-5 16-38 5-14 43-48 14-30 38-47 42-10 47-38 10-5 48-37 30-8 21-7 5-36 38-20 17-22 7-21 22-13 21-12 36-18 37-28 18-36 28-15";
  it.each([
    [two, twoLine, 10, "5 moves"],
    [three, threeLine, 32, "16 moves"],
    [many, manyLine, 50, "25 consecutive"],
  ] as const)("draws at the exact threshold and never on material alone", (board, line, threshold, reason) => {
    const history = replayFixture(board, line);
    expect(history).toHaveLength(threshold);
    expect(checkGameEnd([], board).isOver).toBe(false);
    expect(checkGameEnd(history.slice(0, -1), board).isOver).toBe(false);
    expect(checkGameEnd(history, board)).toMatchObject({ isOver: true, isDraw: true, winner: null, reason: expect.stringContaining(reason) });
  });
  it("detects the third board-and-turn occurrence through the real arbiter", () => {
    const board: Board = { 23: "W", 49: "B" };
    const history = replayFixture(board, "23-17 49-44 17-23 44-49 23-17 49-44 17-23 44-49");
    expect(checkGameEnd(history.slice(0, -1), board).isOver).toBe(false);
    expect(checkGameEnd(history, board).reason).toBe("Threefold repetition");
  });
  it("gives a no-move loss precedence over material draw rules", () => {
    expect(checkGameEnd([], { 1: "W" }, "B")).toMatchObject({ isOver: true, winner: "W", isDraw: false });
  });
  it("does not apply the material clock when the stronger side has only men", () => {
    const board: Board = { 44: "W", 6: "b", 7: "b" };
    const history = replayFixture(board, "44-35 7-12 35-48 12-16 48-37 16-22 37-15 6-12 15-46 22-27");
    expect(checkGameEnd(history, board).isOver).toBe(false);
  });
});
