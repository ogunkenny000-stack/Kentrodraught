import { Board, Move, generateLegalMoves, movesAreEquivalent, moveToNotationString } from "../gameLogic";
import { analyzeKen } from "./kenEngine";
import { MoveEvalResult } from "../types";
import { replayForAnalysis } from "./analysisReplay";

export interface PositionEval {
  score: number; // relative to the side to move in that position (engine convention)
  bestMove: Move | null;
}

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

/**
 * Pure classification (no fetching) given the before/after position evals
 * for one move. Reused by both the live incremental analyzer and the batch
 * analyzer so there is exactly one classification algorithm in the app.
 */
export function classifyMove(
  boardBefore: Board,
  mover: "W" | "B",
  playedMove: Move,
  before: PositionEval,
  after: PositionEval
): MoveEvalResult {
  const moverEvalBefore = before.score; // already relative to the mover (engine convention)
  const moverEvalAfter = -after.score; // after.score is relative to the opponent; flip into mover's frame
  const delta = moverEvalBefore - moverEvalAfter; // positive = move made things worse for the mover

  const legalMovesHere = generateLegalMoves(boardBefore, mover);
  const isForced = legalMovesHere.length === 1;

  const bestMoveNigerian = before.bestMove;
  const isBestMove = !!bestMoveNigerian && movesAreEquivalent(playedMove, bestMoveNigerian);

  const WIN_THRESHOLD = 400; // ~4 pawns of material-equivalent edge: treated as decisive

  let quality: MoveEvalResult["quality"] = "Good";
  let comment = "";
  let missedTactic = false;

  if (isForced) {
    quality = "Forced";
    comment = playedMove.caps.length > 0 ? "This was your only legal move -- a capture was mandatory." : "This was your only legal move.";
  } else if (moverEvalBefore >= WIN_THRESHOLD && moverEvalAfter < WIN_THRESHOLD) {
    quality = "Missed Win";
    comment = "This position was winning, but the move let a decisive advantage slip away.";
    missedTactic = !isBestMove;
  } else if (delta > 150) {
    quality = "Blunder";
    comment = "Lost a major advantage or gave away pieces.";
    missedTactic = !isBestMove;
  } else if (delta > 75) {
    quality = "Mistake";
    comment = "A poor move that worsens your position significantly.";
    missedTactic = !isBestMove;
  } else if (delta > 35) {
    quality = "Inaccuracy";
    comment = "Not the best move. Allows the opponent some counterplay.";
    missedTactic = !isBestMove;
  } else if (isBestMove) {
    // Heuristic approximation of "Brilliant" (see note): a bigger, more
    // tempting immediate capture existed and was passed up in favor of the
    // engine's actual top choice. This flags non-obvious best moves; it is
    // NOT a full sacrifice/combination detector, which would need multi-ply
    // search per candidate move rather than a single top-line comparison.
    const biggestAltCaptureLen = legalMovesHere.reduce((max, m) => Math.max(max, m?.caps?.length ?? 0), 0);
    const playedCapsLen = playedMove?.caps?.length ?? 0;
    if (biggestAltCaptureLen > playedCapsLen && delta <= -60) {
      quality = "Brilliant";
      comment = "A non-obvious move -- a bigger immediate capture was available, but this was actually stronger.";
    } else {
      quality = "Best";
      comment = "The engine's top choice in this position.";
    }
  } else if (delta < 0) {
    quality = "Excellent";
    comment = "Excellent move! Improved your position.";
  } else {
    quality = "Good";
    comment = "Solid move, holding the tension.";
  }

  return {
    index: -1, // caller fills in the real index
    score: after.score,
    quality,
    comment,
    isBestMove,
    missedTactic,
    bestMoveHint: !isBestMove && bestMoveNigerian ? moveToNotationString(bestMoveNigerian) : undefined,
    bestMoveSquares: !isBestMove && bestMoveNigerian && typeof bestMoveNigerian.from === "number" && typeof bestMoveNigerian.to === "number" ? { from: bestMoveNigerian.from, to: bestMoveNigerian.to } : undefined,
  };
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
