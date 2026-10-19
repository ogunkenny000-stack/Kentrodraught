import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { analysisPdn, evaluationLabel, moverAt, parseAnalysisPdn, parseAnalysisPosition, reviewWhiteScore, whiteEvaluation } from './analysisPresentation';
import { createInitialBoard, generateLegalMoves, applyMove, boardToScanFen, moveToNotationString } from '../gameLogic';
import { AnalysisGraph } from '../components/AnalysisGraph';
import type { EngineEval, MoveEvalResult } from '../types';

const evaluated: EngineEval = { score: 250, depth: 18, pv: '', isThinking: false, ready: true, turn: 'B' };
describe('analysis presentation and portable studies', () => {
  it('uses the evaluated historical side, including Black-first studies', () => {
    expect(whiteEvaluation(evaluated, 'W')).toBe(-250);
    expect(evaluationLabel(evaluated, 'W')).toBe('-2.50');
    expect(moverAt(0, 'B')).toBe('B'); expect(moverAt(1, 'B')).toBe('W');
    expect(reviewWhiteScore({ score: 250 } as MoveEvalResult, 0, 'B')).toBe(250);
    expect(reviewWhiteScore({ score: 250 } as MoveEvalResult, 0, 'W')).toBe(-250);
  });
  it('does not present missing, failed or pending searches as equal positions', () => {
    expect(evaluationLabel({ ...evaluated, ready: false }, 'B')).toBe('—');
    expect(evaluationLabel({ ...evaluated, error: 'unavailable' }, 'B')).toBe('—');
    expect(evaluationLabel({ ...evaluated, isThinking: true }, 'B')).toBe('—');
    expect(evaluationLabel({ ...evaluated, score: 0 }, 'B')).toBe('0.00');
  });
  it.each(['W', 'B'] as const)('round-trips a custom root and captures with %s first', first => {
    const initial = { 23: 'W', 40: 'B', 17: 'b' } as const;
    let board = { ...initial }, turn: 'W' | 'B' = first;
    const moves = [];
    for (let i = 0; i < 6; i++) {
      const move = generateLegalMoves(board, turn)[0];
      if (!move) break;
      moves.push(move); board = applyMove(board, move).board as typeof board; turn = turn === 'W' ? 'B' : 'W';
    }
    const exported = analysisPdn(moves.map(moveToNotationString), initial, first);
    const parsed = parseAnalysisPdn(exported);
    expect(boardToScanFen(parsed.initialBoard, parsed.initialTurn)).toBe(boardToScanFen(initial, first));
    expect(parsed.moves).toEqual(moves); expect(boardToScanFen(parsed.board, parsed.turn)).toBe(boardToScanFen(board, turn)); expect(parsed.turn).toBe(turn);
  });
  it('reads tagged opening exports, comments and attached move numbers', () => {
    const move = generateLegalMoves(createInitialBoard(), 'W')[0];
    expect(parseAnalysisPdn(`[Event "Study"]\n1.${moveToNotationString(move)} {note} *`).moves).toEqual([move]);
  });
  it('rejects illegal moves, unsupported variations and moves after a result', () => {
    expect(() => parseAnalysisPdn('1. 1-50')).toThrow('not legal');
    expect(() => parseAnalysisPdn('(1. 32-28)')).toThrow('single main line');
    expect(() => parseAnalysisPdn('* 32-28')).toThrow('follow the game result');
  });
  it('normalizes promotion-edge pieces consistently with the engine and rejects impossible piece counts', () => {
    const fen = 'W' + 'w'.repeat(5) + 'e'.repeat(45);
    const result = parseAnalysisPosition(fen);
    expect(Object.values(result.board).filter(p => p === 'W')).toHaveLength(5);
    expect(() => parseAnalysisPosition('W' + 'w'.repeat(21) + 'e'.repeat(29))).toThrow('at most 20');
    expect(() => parseAnalysisPosition('bad')).toThrow('Invalid SCAN FEN');
  });
  it('leaves holes in an incompletely reviewed graph rather than inventing equal scores', () => {
    const ev = { score: 100, index: 0, quality: 'Good', comment: '' } as MoveEvalResult;
    const html = renderToStaticMarkup(<AnalysisGraph count={3} moveEvaluations={{ 0: ev, 2: ev }} historyViewIndex={null} onHistoryNavigate={() => {}} />);
    expect(html.match(/<circle/g)).toHaveLength(2);
    expect(html.match(/<line/g)).toHaveLength(1); // Only the neutral reference line; no bridge across missing move 2.
    expect(html).not.toContain('Review move 2');
  });
});
