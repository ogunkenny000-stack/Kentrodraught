import { generateLegalMoves, movesAreEquivalent, type Board, type Move } from '../gameLogic';
import { replayForAnalysis } from './analysisReplay';

/** Never apply a raw engine response or an incomplete capture as a fallback. */
export function canonicalGameMove(board: Board, turn: 'W' | 'B', move: Move): Move | null {
  const canonical = generateLegalMoves(board, turn).find(candidate => movesAreEquivalent(candidate, move));
  return canonical ? { ...canonical, ...(move.kenProof ? { kenProof: move.kenProof } : {}) } : null;
}

export function savedGameStart(record: any): { board: Board | undefined; turn: 'W' | 'B' } {
  const metadata = record.moveEvaluations?.__kentroGameRecord;
  return {
    board: record.initialBoard ?? metadata?.startingPosition ?? undefined,
    turn: (record.initialTurn ?? metadata?.startingTurn) === 'B' ? 'B' : 'W',
  };
}

/** Validate before saving and preserve everything required to replay this match. */
export function recordedGameData(history: Move[], initialBoard: Board, initialTurn: 'W' | 'B', evaluations: Record<string, unknown>) {
  const replay = replayForAnalysis(history, initialBoard, initialTurn);
  return {
    moveHistory: replay.moves,
    moveEvaluations: {
      ...evaluations,
      __kentroGameRecord: {
        startingPosition: initialBoard,
        startingTurn: initialTurn,
        currentPosition: replay.boards[replay.boards.length - 1],
        currentTurn: replay.turns[replay.turns.length - 1],
      },
    },
  };
}
