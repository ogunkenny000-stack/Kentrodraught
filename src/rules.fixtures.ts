import type { Board, Move } from "./gameLogic";
import { applyMove, generateLegalMoves } from "./gameLogic";

export const drawFixtures: { board: Board; notation: string; plies: number; reason: string }[] = [
  { board: { 23: "W", 50: "B" }, notation: "23-14 50-34 14-27 34-47 27-22 47-31 22-44 31-4 44-38 4-9", plies: 10, reason: "Lone king vs 2 or fewer" },
  { board: { 1: "b", 23: "W", 50: "B" }, notation: "23-14 50-39 14-32 39-44 32-26 44-16 26-37 16-22 37-32 22-31", plies: 10, reason: "Lone king vs 2 or fewer" },
  { board: { 1: "b", 2: "b", 23: "W", 50: "B" }, notation: "23-14 50-45 14-32 45-6 32-26 6-23 26-37 23-5 37-26 5-27 26-13 27-9 13-31 9-41 31-22 41-46 22-44 46-41 44-35 41-23 35-24 2-6 24-13 23-9 13-2 6-12 2-29 9-23 29-2 23-34 2-40 12-17", plies: 32, reason: "Lone king vs 3 pieces" },
  { board: { 10: "B", 12: "W", 23: "W", 38: "B" }, notation: "23-36 10-15 12-3 38-33 36-31 33-37 31-13 15-4 13-18 37-42 18-2 42-36 2-6 4-15 6-50 15-46 50-6 46-42 6-17 36-5 3-8 5-27 8-13 27-9 13-2 9-41 17-13 41-9 13-7 42-31 7-29 9-15 29-18 31-4 18-41 15-46 41-27 46-15 27-32 15-20 2-24 4-17 32-41 20-43 41-5 17-4 24-2 43-47 2-6 4-8", plies: 50, reason: "25 consecutive king moves" },
];

/** Every fixture ply must be legal; historical draw tests must not forge moves. */
export function fixtureHistory(initialBoard: Board, notation: string, firstMover: "W" | "B" = "W"): Move[] {
  let board = initialBoard;
  let turn = firstMover;
  return notation.split(" ").map((token) => {
    const [from, to] = token.split("-").map(Number);
    const move = generateLegalMoves(board, turn).find((mv) => mv.from === from && mv.to === to && mv.caps.length === 0);
    if (!move) throw new Error(`Illegal fixture move ${token} for ${turn}`);
    board = applyMove(board, move).board;
    turn = turn === "W" ? "B" : "W";
    return move;
  });
}

export const overflowBoard: Board = {
  4: "W", 6: "W", 7: "b", 8: "b", 11: "b", 13: "W", 16: "b", 17: "b", 20: "W", 22: "b", 24: "b", 25: "b", 27: "b", 30: "W", 34: "b", 38: "W", 43: "b", 44: "b", 50: "W",
};
