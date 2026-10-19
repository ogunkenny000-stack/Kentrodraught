import { useEffect, useState } from 'react';
import { Board, boardToScanFen, scanFenToBoard } from '../gameLogic';
import type { EngineEval } from '../types';
import { offlineKenMove } from '../engine/offlineKen';

export function usePositionAnalysis(board: Board, turn: 'W' | 'B', enabled: boolean, timeMs = 0) {
  const fen = boardToScanFen(board, turn);
  const [attempt, setAttempt] = useState(0);
  const key = `${fen}|${enabled}|${timeMs}|${attempt}`;
  const [result, setResult] = useState<{ key: string; evaluation: EngineEval } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const position = scanFenToBoard(fen);
        if (!Object.values(position.board).some(Boolean)) throw new Error('Add pieces in the board editor, or load a position.');
        const data = await offlineKenMove(position.board, turn, timeMs / 1000, 30, false, controller.signal);
        if (!controller.signal.aborted) setResult({ key, evaluation: { ...data, turn, ready: true, isThinking: false } });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key, evaluation: { score: 0, depth: 0, pv: '', turn, ready: false, isThinking: false,
          error: error instanceof Error ? error.message : 'Analysis unavailable. Try again.' } });
      }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, fen, turn, enabled, timeMs]);
  const evaluation: EngineEval = result?.key === key ? result.evaluation : { score: 0, depth: 0, pv: '', turn, ready: false, isThinking: enabled };
  return { evaluation, retry: () => setAttempt(n => n + 1) };
}
