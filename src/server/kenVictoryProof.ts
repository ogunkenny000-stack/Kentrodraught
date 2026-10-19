/** Server-issued attestations for Ken AI replies and verified level progression. */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  applyMove, boardToScanFen, checkGameEnd, createInitialBoard,
  generateLegalMoves, moveToHubString, type Move,
} from "../gameLogic";

export type KenProofData = { ownerId: string; gameId: string; level: number; fen: string; move: string };
export function signKenReply(data: KenProofData, secret: string, now = Date.now()): string {
  if (!secret || secret.length < 32) throw new Error("Ken victory attestation unavailable");
  const timestamp = Math.floor(now / 1000);
  const signature = createHmac("sha256", secret).update(JSON.stringify([data.ownerId,data.gameId,data.level,data.fen,data.move,timestamp])).digest("hex");
  return `${timestamp}.${signature}`;
}
export function verifyKenReply(data: KenProofData, proof: unknown, secret: string, now = Date.now()): boolean {
  if (typeof proof !== "string" || !/^\d{10}\.[a-f0-9]{64}$/.test(proof) || !secret || secret.length < 32) return false;
  const issued = Number(proof.split(".")[0]);
  if (issued > now / 1000 + 60 || issued < now / 1000 - 2 * 86400) return false;
  const expected = signKenReply(data, secret, issued * 1000);
  return timingSafeEqual(Buffer.from(proof), Buffer.from(expected));
}
export interface KenRecordedMove extends Move { kenProof?: string }
export function verifyKenVictory(input: {
  ownerId: string; gameId: string; level: number; mode: string; moves: unknown;
}, secret: string): { ok: boolean; reason?: string } {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.gameId)
    || !Number.isInteger(input.level) || input.level < 1 || input.level >= 8
    || !["Human_vs_AI","AI_vs_Human"].includes(input.mode) || !Array.isArray(input.moves)
    || input.moves.length < 3 || input.moves.length > 300)
    return { ok: false, reason: "Invalid Ken victory submission" };
  const playerColor = input.mode === "Human_vs_AI" ? "W" : "B";
  const aiColor = playerColor === "W" ? "B" : "W";
  let board = createInitialBoard();
  let aiReplies = 0;
  const moves: KenRecordedMove[] = [];
  for (let i = 0; i < input.moves.length; i++) {
    const submitted = input.moves[i] as KenRecordedMove;
    if (!submitted || !Number.isInteger(submitted.from) || !Number.isInteger(submitted.to)
      || !Array.isArray(submitted.caps) || submitted.caps.length > 20) return { ok: false, reason: "Invalid move" };
    const turn = i % 2 === 0 ? "W" : "B";
    if (checkGameEnd(moves).isOver) return { ok: false, reason: "Moves continue after game end" };
    const fen = boardToScanFen(board, turn);
    const same = generateLegalMoves(board, turn).filter(candidate =>
      candidate.from === submitted.from && candidate.to === submitted.to
      && candidate.caps.length === submitted.caps.length
      && candidate.caps.every((captured, j) => captured === submitted.caps[j])
      && (submitted.path === undefined || (Array.isArray(submitted.path)
        && JSON.stringify(candidate.path ?? []) === JSON.stringify(submitted.path)))
    );
    if (same.length !== 1) return { ok: false, reason: "Illegal or ambiguous Nigerian move" };
    if (turn === aiColor) {
      if (!verifyKenReply({ ownerId: input.ownerId, gameId: input.gameId,
          level: input.level, fen, move: moveToHubString(same[0]) }, submitted.kenProof, secret))
        return { ok: false, reason: "Unverified Ken AI move" };
      aiReplies++;
    }
    board = applyMove(board, same[0]).board;
    moves.push(same[0]);
  }
  const result = checkGameEnd(moves);
  if (!aiReplies || !result.isOver || result.isDraw || result.winner !== playerColor)
    return { ok: false, reason: "A completed verified Ken victory is required" };
  return { ok: true };
}
