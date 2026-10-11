// Authoritative game-end check for ONLINE rooms, evaluated against the room's
// real starting position (custom board, short-one/two/three handicaps,
// crown-crown setup) and its live board -- never against a board
// reconstructed from the standard 20-vs-20 opening (which is what
// gameLogic.checkGameEnd does and is only correct for standard games).
//
// Rules mirror gameLogic.checkGameEnd exactly, in the same priority order:
//   1. side to move has no legal moves          -> other side wins
//   2. threefold repetition (board + side)       -> draw
//   3. 25 king-only capture-free moves each side -> draw
//   4. lone king vs 3 pieces (>=1 king), 16 moves each side, no change -> draw
//   5. lone king vs <=2 pieces (>=1 king), 5 moves each side, no change -> draw
import { applyMove, generateLegalMoves, getCol, isKing } from "../gameLogic";
import type { Board, GameEndResult, Move } from "../gameLogic";

type Color = "W" | "B";

interface PieceCounts {
  whiteMen: number;
  whiteKings: number;
  blackMen: number;
  blackKings: number;
}

function countPieces(board: Board): PieceCounts {
  const c: PieceCounts = { whiteMen: 0, whiteKings: 0, blackMen: 0, blackKings: 0 };
  for (let sq = 1; sq <= 50; sq++) {
    const pc = board[sq];
    if (!pc) continue;
    const white = getCol(pc) === "W";
    const king = isKing(pc);
    if (white && king) c.whiteKings++;
    else if (white) c.whiteMen++;
    else if (king) c.blackKings++;
    else c.blackMen++;
  }
  return c;
}

function countsEqual(a: PieceCounts, b: PieceCounts): boolean {
  return a.whiteMen === b.whiteMen && a.whiteKings === b.whiteKings && a.blackMen === b.blackMen && a.blackKings === b.blackKings;
}

function materialCategory(c: PieceCounts): "three" | "two" | null {
  const whiteLoneKing = c.whiteKings === 1 && c.whiteMen === 0;
  const blackLoneKing = c.blackKings === 1 && c.blackMen === 0;
  if (!whiteLoneKing && !blackLoneKing) return null;
  const strongCount = whiteLoneKing ? c.blackMen + c.blackKings : c.whiteMen + c.whiteKings;
  const strongHasKing = whiteLoneKing ? c.blackKings >= 1 : c.whiteKings >= 1;
  if (!strongHasKing) return null;
  if (strongCount === 3) return "three";
  if (strongCount <= 2) return "two";
  return null;
}

function boardsEqual(a: Board, b: Board): boolean {
  for (let sq = 1; sq <= 50; sq++) {
    if ((a[sq] ?? null) !== (b[sq] ?? null)) return false;
  }
  return true;
}

/** Full 50-square copy so sparse custom boards compare/apply cleanly. */
export function normalizeBoard(src: Board | null | undefined): Board {
  const out: Board = {};
  for (let sq = 1; sq <= 50; sq++) out[sq] = src?.[sq] ?? null;
  return out;
}

const NO_END: GameEndResult = { isOver: false, winner: null, isDraw: false, reason: "" };

/**
 * @param startBoard  the position the game actually started from
 * @param startTurn   who moved first from that position
 * @param history     every validated move so far, in order
 * @param liveBoard   the room's current board (used as the final position;
 *                    falls back to replaying `history` from `startBoard`)
 * @param liveTurn    the room's current side to move
 */
export function checkGameEndFrom(
  startBoard: Board,
  startTurn: Color,
  history: Move[],
  liveBoard?: Board | null,
  liveTurn?: Color,
): GameEndResult {
  const boards: Board[] = [normalizeBoard(startBoard)];
  for (let i = 0; i < history.length; i++) {
    boards.push(applyMove(boards[i], history[i]).board);
  }
  const finalBoard = liveBoard ? normalizeBoard(liveBoard) : boards[boards.length - 1];
  const sideToMove: Color = liveTurn ?? (history.length % 2 === 0 ? startTurn : startTurn === "W" ? "B" : "W");

  // 1. No legal moves -> opponent wins.
  if (generateLegalMoves(finalBoard, sideToMove).length === 0) {
    const winner: Color = sideToMove === "W" ? "B" : "W";
    return { isOver: true, winner, isDraw: false, reason: "No legal moves left" };
  }

  // 2. Threefold repetition (same board, same side to move).
  {
    let repeats = 1;
    for (let i = boards.length - 1 - 2; i >= 0; i -= 2) {
      if (boardsEqual(boards[i], finalBoard)) {
        repeats++;
        if (repeats >= 3) {
          return { isOver: true, winner: null, isDraw: true, reason: "Threefold repetition" };
        }
      }
    }
  }

  // 3. 25 consecutive king-only, capture-free moves by each side (50 plies).
  {
    let streak = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const mv = history[i];
      const movedPiece = boards[i][mv.from];
      const wasKingMove = !!movedPiece && isKing(movedPiece);
      const wasCapture = Array.isArray(mv.caps) && mv.caps.length > 0;
      if (wasKingMove && !wasCapture) streak++;
      else break;
    }
    if (streak >= 50) {
      return { isOver: true, winner: null, isDraw: true, reason: "25 consecutive king moves by each side with no capture" };
    }
  }

  // 4 & 5. Material-insufficiency rules.
  {
    const currentCounts = countPieces(finalBoard);
    const category = materialCategory(currentCounts);
    if (category) {
      let pliesInCategory = 0;
      for (let i = boards.length - 1; i > 0; i--) {
        if (countsEqual(countPieces(boards[i - 1]), currentCounts)) pliesInCategory++;
        else break;
      }
      const threshold = category === "three" ? 32 : 10;
      if (pliesInCategory >= threshold) {
        const moves = category === "three" ? 16 : 5;
        return {
          isOver: true,
          winner: null,
          isDraw: true,
          reason: category === "three"
            ? `Lone king vs 3 pieces (incl. a king): no progress in ${moves} moves by each side`
            : `Lone king vs 2 or fewer pieces (incl. a king): no progress in ${moves} moves by each side`,
        };
      }
    }
  }

  return NO_END;
}
