import { classifyMove, type PositionEval } from "../shared/moveClassification";
export { classifyMove, type PositionEval } from "../shared/moveClassification";
import { Board, Move, generateLegalMoves, boardToScanFen, checkGameEnd } from "../gameLogic";
import { offlineKenMove } from '../engine/offlineKen';
import { analyzeKen } from "./kenEngine";
import { MoveEvalResult } from "../types";
import { replayForAnalysis } from "./analysisReplay";

/** Single engine call for one position. This is the unit cached by both the
 * live incremental analyzer and the batch analyzer below, so each board
 * position is ever evaluated once, not once as "before" and again as
 * someone else's "after". Uses local WebAssembly when given a cancellation signal; otherwise the server client. */
const localEvaluations = new Map<string, PositionEval>();
export async function evaluatePosition(board: Board, turn: "W" | "B", thinkTime: number, signal?: AbortSignal): Promise<PositionEval> {
  signal?.throwIfAborted();
  if (generateLegalMoves(board, turn).length === 0) return { score: -10000, bestMove: null };
  // An unavailable evaluation is not evidence of an equal position. Let the
  // caller's existing error handling retry instead of caching a invented draw.
  const key = `${boardToScanFen(board, turn)}|${thinkTime}`;
  if (signal && localEvaluations.has(key)) return localEvaluations.get(key)!;
  const data = signal ? await offlineKenMove(board, turn, thinkTime, 0, false, signal)
    : await analyzeKen(board, turn, Math.round(thinkTime * 1000));
  signal?.throwIfAborted();
  if (!Number.isFinite(data.score)) throw new Error("Engine returned an invalid evaluation");
  const result = { score: data.score, bestMove: data.move ?? null };
  if (signal) {
    if (localEvaluations.size >= 256) localEvaluations.delete(localEvaluations.keys().next().value!);
    localEvaluations.set(key, result);
  }
  return result;
}

/** Batch analysis for a full game (manual "Run AI Game Review", PDN import).
 * Evaluates every position exactly once (N+1 engine calls for N moves, not
 * 2N), same as before this refactor -- only the live/incremental path below
 * is new. */
export async function analyzeMoveHistory(
  history: Move[],
  onProgress?: (pct: number) => void,
  startingPosition?: Board | null,
  startingTurn: "W" | "B" = "W",
  signal?: AbortSignal,
  onMove?: (evaluation: MoveEvalResult) => void
): Promise<Record<number, MoveEvalResult>> {
  const evals: Record<number, MoveEvalResult> = {};
  const { boards: boardsList, turns, moves } = replayForAnalysis(history, startingPosition, startingTurn);

  signal?.throwIfAborted();
  let before = await evaluatePosition(boardsList[0], turns[0], 0.5, signal);
  for (let i = 0; i < history.length; i++) {
    signal?.throwIfAborted();
    const end = checkGameEnd(moves.slice(0, i + 1), boardsList[0], startingTurn);
    const after = end.isDraw ? { score: 0, bestMove: null } : await evaluatePosition(boardsList[i + 1], turns[i + 1], 0.5, signal);
    signal?.throwIfAborted();
    const result = classifyMove(boardsList[i], turns[i], moves[i], before, after);
    evals[i] = { ...result, index: i };
    onMove?.(evals[i]);
    onProgress?.(Math.round(((i + 1) / history.length) * 100));
    before = after;
  }

  onProgress?.(100);
  return evals;
}
