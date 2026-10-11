import { describe, it, expect } from "vitest";
import { Board, generateLegalMoves, applyMove, parseNotationString, parsePdnMoveList, createInitialBoard, moveToNotationString } from "./gameLogic";
const empty = (): Board => Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i + 1, null]));

describe("capture and notation regressions", () => {
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
