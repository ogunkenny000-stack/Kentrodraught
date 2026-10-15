import { applyMove, createInitialBoard, generateLegalMoves, movesAreEquivalent, type Board, type Move, type Piece } from "../gameLogic";

/** Replay trusted or imported records through canonical legal moves before review. */
export function replayForAnalysis(history: Move[], startingPosition?: Board | null, startingTurn: "W" | "B" = "W") {
  if (!Array.isArray(history) || (startingTurn !== "W" && startingTurn !== "B")) throw new Error("Invalid review history or first mover");
  let board: Board;
  if (startingPosition == null) board = createInitialBoard();
  else {
    if (typeof startingPosition !== "object" || Array.isArray(startingPosition)) throw new Error("Invalid review starting position");
    board = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [index + 1, null]));
    for (const [key, value] of Object.entries(startingPosition)) {
      const square = Number(key);
      if (!/^[1-9]\d*$/.test(key) || !Number.isInteger(square) || square > 50 || ![null, "w", "W", "b", "B"].includes(value)) throw new Error("Invalid review starting position");
      board[square] = value as Piece;
    }
  }
  const boards: Board[] = [board];
  const turns: ("W" | "B")[] = [startingTurn];
  const moves: Move[] = [];
  let turn = startingTurn;
  for (const [index, move] of history.entries()) {
    const canonical = generateLegalMoves(board, turn).find((candidate) => movesAreEquivalent(candidate, move));
    if (!canonical) throw new Error(`Illegal recorded move at ply ${index + 1}`);
    moves.push(canonical);
    board = applyMove(board, canonical).board;
    turn = turn === "W" ? "B" : "W";
    boards.push(board);
    turns.push(turn);
  }
  return { boards, turns, moves };
}
