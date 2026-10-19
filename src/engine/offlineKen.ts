import { Board, boardToScanFen, generateLegalMoves, hubMoveStringToNigerian, movesAreEquivalent } from '../gameLogic';
import type { KenResult } from '../lib/kenEngine';

const completedSearches = new Map<string, KenResult>();

/** One worker per caller; cancellation actually stops CPU work. No API/auth requests. */
export function offlineKenMove(board: Board, turn: 'W' | 'B', seconds = 5, depth = 0, pst = false, signal?: AbortSignal): Promise<KenResult> {
  if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  const fixedDepth = seconds === 0 && depth > 0;
  const searchSeconds = fixedDepth ? 0 : Number.isFinite(seconds) ? Math.min(30, Math.max(0.05, seconds)) : 5;
  const legal = generateLegalMoves(board, turn);
  if (!legal.length) return Promise.resolve({ move: null, score: -10000, depth: 0, nodes: 0, pv: '' });
  const fen = boardToScanFen(board, turn);
  const key = `${fen}|${searchSeconds}|${depth}|${pst}`;
  const cached = completedSearches.get(key);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const worker = new Worker('/engine/ken-worker.js');
    const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); worker.terminate(); };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const abort = () => fail(new DOMException('Cancelled', 'AbortError'));
    // Include first-load compilation on slower phones, but never hang indefinitely.
    const timeout = setTimeout(() => fail(new Error('Offline engine timed out. Try again.')), fixedDepth ? 30 * 60 * 1000 : searchSeconds * 1000 + 60000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => fail(new Error('Offline engine could not load. Open the app online once to prepare offline play.'));
    worker.onmessage = ({ data }) => {
      const result = data?.result;
      const parsed = typeof result?.move === 'string' && hubMoveStringToNigerian(result.move);
      const canonical = parsed && legal.find(move => movesAreEquivalent(move, parsed));
      if (!canonical || !Number.isFinite(result.score) || Math.abs(result.score) > 10000 ||
          !Number.isInteger(result.depth) || result.depth < 0 || !Number.isFinite(result.nodes) || result.nodes < 0 || typeof result.pv !== 'string') {
        fail(new Error(typeof data?.error === 'string' ? data.error : 'Offline engine returned an invalid evaluation.')); return;
      }
      cleanup();
      const completed = { move: canonical, score: result.score, depth: result.depth, nodes: result.nodes, pv: result.pv };
      if (completedSearches.size >= 128) completedSearches.delete(completedSearches.keys().next().value!);
      completedSearches.set(key, completed);
      resolve(completed);
    };
    try {
      worker.postMessage({ fen, seconds: searchSeconds, depth, pst });
    } catch {
      fail(new Error('Offline engine could not start. Try again.'));
    }
  });
}
