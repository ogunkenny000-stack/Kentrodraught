import { applyMove, createInitialBoard, generateLegalMoves, movesAreEquivalent } from "../gameLogic";
import type { Board, Move } from "../gameLogic";
import type { KentroGameRecord } from "../types/gameRecords";

export interface ReplayFrame { board: Board; move: Move | null; ply: number; turn: "W" | "B" }
export interface Highlight { from: number; to: number; title: string; kind: "capture" | "promotion" | "finale" }

/** Deep links are bounded by the loaded record, not merely the URL's limit. */
export function replayBounds(frameCount: number, requestedPly: number, clipEnd?: number): { ply: number; range: { from: number; to: number } | null } {
  const last = Math.max(0, frameCount - 1);
  const ply = Math.min(last, Number.isSafeInteger(requestedPly) && requestedPly >= 0 ? requestedPly : 0);
  const to = Number.isSafeInteger(clipEnd) ? Math.min(last, clipEnd!) : ply;
  return { ply, range: to > ply ? { from: ply, to } : null };
}

/** Replay only legal, recorded moves. Never accept a client-supplied board snapshot as proof of a move. */
export function buildReplayFrames(game: Pick<KentroGameRecord, "startingPosition" | "completeMoveHistory">): ReplayFrame[] {
  let board = game.startingPosition && Object.keys(game.startingPosition).length ? { ...game.startingPosition } : createInitialBoard();
  const frames: ReplayFrame[] = [{ board, move: null, ply: 0, turn: "W" }];
  let turn: "W" | "B" = "W";
  for (const claimed of game.completeMoveHistory || []) {
    const legal = generateLegalMoves(board, turn).find(m => movesAreEquivalent(m, claimed));
    if (!legal) throw new Error(`Replay move ${frames.length} could not be verified.`);
    board = applyMove(board, legal).board;
    turn = turn === "W" ? "B" : "W";
    frames.push({ board, move: legal, ply: frames.length, turn });
  }
  return frames;
}

export function selectHighlights(frames: ReplayFrame[], max = 8): Highlight[] {
  const candidates: Array<Highlight & { weight: number }> = [];
  for (let i = 1; i < frames.length; i++) {
    const last = frames[i - 1].board;
    const frame = frames[i];
    const move = frame.move!;
    const promoted = (last[move.from] === "w" || last[move.from] === "b") && (frame.board[move.to] === "W" || frame.board[move.to] === "B");
    const capCount = move.caps?.length || 0;
    if (capCount > 0) candidates.push({ from: Math.max(0, i - 2), to: Math.min(frames.length - 1, i + 2), title: `${capCount}-piece capture · Move ${Math.ceil(i / 2)}`, kind: "capture", weight: capCount * 10 });
    if (promoted) candidates.push({ from: Math.max(0, i - 2), to: Math.min(frames.length - 1, i + 2), title: `King crowned · Move ${Math.ceil(i / 2)}`, kind: "promotion", weight: 9 });
  }
  if (frames.length > 1) candidates.push({ from: Math.max(0, frames.length - 7), to: frames.length - 1, title: "Final moves", kind: "finale", weight: 5 });
  return candidates.sort((a, b) => b.weight - a.weight || a.from - b.from).slice(0, max).sort((a,b)=>a.from-b.from).map(({weight, ...rest}) => rest);
}

export function replayLink(base: string, gameCode: string, ply = 0, clipEnd?: number): string {
  const url = new URL(base);
  url.search = "";
  url.hash = "";
  url.searchParams.set("replay", gameCode);
  if (ply > 0) url.searchParams.set("ply", String(ply));
  if (clipEnd !== undefined && Number.isSafeInteger(clipEnd) && clipEnd > ply) url.searchParams.set("clipEnd", String(Math.min(2000, clipEnd)));
  return url.toString();
}

export function parseReplayLink(search: string): { gameCode: string; ply: number; clipEnd?: number } | null {
  const p = new URLSearchParams(search);
  const code = p.get("replay") || "";
  if (!/^[a-zA-Z0-9_-]{3,40}$/.test(code)) return null;
  const raw = Number(p.get("ply") || 0);
  const ply = Number.isSafeInteger(raw) && raw >= 0 ? Math.min(2000, raw) : 0;
  const clip = Number(p.get("clipEnd"));
  return { gameCode: code, ply, ...(p.has("clipEnd") && Number.isSafeInteger(clip) && clip > ply && clip <= 2000 ? { clipEnd: clip } : {}) };
}
