import { classifyMove, type PositionEval } from "../shared/moveClassification";
export { classifyMove, type PositionEval } from "../shared/moveClassification";
import { Board, Move, generateLegalMoves } from "../gameLogic";
import { analyzeKen } from "./kenEngine";
import { MoveEvalResult } from "../types";
import { replayForAnalysis } from "./analysisReplay";

/** Single engine call for one position. This is the unit cached by both the
 * live incremental analyzer and the batch analyzer below, so each board
 * position is ever evaluated once, not once as "before" and again as
 * someone else's "after". Uses the server's native Ken engine. */
export async function evaluatePosition(board: Board, turn: "W" | "B", thinkTime: number): Promise<PositionEval> {
  if (generateLegalMoves(board, turn).length === 0) return { score: -10000, bestMove: null };
  // An unavailable evaluation is not evidence of an equal position. Let the
  // caller's existing error handling retry instead of caching a invented draw.
  const data = await analyzeKen(board, turn, Math.round(thinkTime * 1000));
  if (!Number.isFinite(data.score)) throw new Error("Engine returned an invalid evaluation");
  return { score: data.score, bestMove: data.move ?? null };
}

/** Batch analysis for a full game (manual "Run AI Game Review", PDN import).
 * Evaluates every position exactly once (N+1 engine calls for N moves, not
 * 2N), same as before this refactor -- only the live/incremental path below
 * is new. */
export async function analyzeMoveHistory(
  history: Move[],
  onProgress?: (pct: number) => void,
  startingPosition?: Board | null,
  startingTurn: "W" | "B" = "W"
): Promise<Record<number, MoveEvalResult>> {
  const evals: Record<number, MoveEvalResult> = {};
  const { boards: boardsList, turns, moves } = replayForAnalysis(history, startingPosition, startingTurn);

  const posEvals: PositionEval[] = [];
  for (let i = 0; i <= history.length; i++) {
    onProgress?.(Math.round((i / (history.length + 1)) * 100));
    posEvals.push(await evaluatePosition(boardsList[i], turns[i], 0.5));
  }

  for (let i = 0; i < history.length; i++) {
    const result = classifyMove(boardsList[i], turns[i], moves[i], posEvals[i], posEvals[i + 1]);
    evals[i] = { ...result, index: i };
  }

  onProgress?.(100);
  return evals;
}
