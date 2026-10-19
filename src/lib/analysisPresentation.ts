import { Board, Move, applyMove, generateLegalMoves, movesAreEquivalent, parseNotationString, boardToScanFen, createInitialBoard, scanFenToBoard } from '../gameLogic';
import type { EngineEval, MoveEvalResult } from '../types';

export function whiteEvaluation(evaluation: EngineEval, fallbackTurn: 'W' | 'B'): number {
  return (evaluation.turn ?? fallbackTurn) === 'W' ? evaluation.score : -evaluation.score;
}

export function evaluationLabel(evaluation: EngineEval, turn: 'W' | 'B'): string {
  if (evaluation.isThinking || evaluation.error || !evaluation.ready) return '—';
  if (evaluation.terminal?.isDraw) return 'Draw';
  const score = whiteEvaluation(evaluation, turn);
  if (Math.abs(score) > 8000) return score > 0 ? 'White wins' : 'Black wins';
  return `${score > 0 ? '+' : ''}${(score / 100).toFixed(2)}`;
}

export function moverAt(index: number, firstTurn: 'W' | 'B'): 'W' | 'B' {
  return index % 2 === 0 ? firstTurn : firstTurn === 'W' ? 'B' : 'W';
}

/** Stored move scores are relative to the opponent AFTER the move. */
export function reviewWhiteScore(evaluation: MoveEvalResult, index: number, firstTurn: 'W' | 'B'): number {
  return moverAt(index, firstTurn) === 'W' ? -evaluation.score : evaluation.score;
}

export function parseAnalysisPosition(fen: string) {
  const result = scanFenToBoard(fen.trim());
  for (const color of ['w', 'b']) {
    if (Object.values(result.board).filter(p => p?.toLowerCase() === color).length > 20) throw new Error('Each side can have at most 20 pieces.');
  }
  // Match the engine's existing automatic promotion at the promotion edge.
  return scanFenToBoard(boardToScanFen(result.board, result.turn));
}

export function analysisPdn(moves: string[], initialBoard: Board, firstTurn: 'W' | 'B'): string {
  const fen = boardToScanFen(initialBoard, firstTurn);
  const standard = fen === boardToScanFen(createInitialBoard(), 'W');
  const tags = `[Event "Nigerian Draughts Analysis Session"]\n[Result "*"]\n${standard ? '' : `[SetUp "1"]\n[FEN "${fen}"]\n`}`;
  const text = moves.map((move, i) => {
    const side = moverAt(i, firstTurn);
    const number = Math.floor((i + (firstTurn === 'B' ? 1 : 0)) / 2) + 1;
    return side === 'W' ? `${number}. ${move}` : i === 0 ? `${number}... ${move}` : move;
  }).join(' ');
  return `${tags}\n${text}${text ? ' ' : ''}*\n`;
}

/** Read the application's own Nigerian notation, including its custom root. */
export function parseAnalysisPdn(text: string) {
  const fen = /\[FEN\s+"([^"]+)"\]/i.exec(text)?.[1];
  const start = fen ? parseAnalysisPosition(fen) : { board: createInitialBoard(), turn: 'W' as const };
  const body = text.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
  if (/[()]/.test(body)) throw new Error('Import a single main line; remove bracketed variations first.');
  const tokens = body.replace(/\b\d+\.(?:\.\.)?/g, ' ').trim().split(/\s+/).filter(Boolean);
  const moves: Move[] = [];
  let board = start.board, turn: 'W' | 'B' = start.turn;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (['*', '1-0', '0-1', '1/2-1/2'].includes(token)) {
      if (i !== tokens.length - 1) throw new Error('Moves cannot follow the game result.');
      break;
    }
    const parsed = parseNotationString(token);
    const canonical = parsed && generateLegalMoves(board, turn).find(move => movesAreEquivalent(move, parsed));
    if (!canonical) throw new Error(`Move ${moves.length + 1} (${token}) is not legal for ${turn === 'W' ? 'White' : 'Black'}. Use Nigerian square notation with complete captures.`);
    moves.push(canonical); board = applyMove(board, canonical).board; turn = turn === 'W' ? 'B' : 'W';
  }
  return { moves, initialBoard: start.board, initialTurn: start.turn, board, turn };
}
