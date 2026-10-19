import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { applyMove, boardToScanFen, createInitialBoard, moveToHubString, type Move } from '../gameLogic';
import { signKenReply, verifyKenVictory, type KenRecordedMove } from './kenVictoryProof';

// Legal deterministic full-game transcripts, with no live accounts or keys.
const fixtures: { winner: 'W' | 'B'; moves: Move[] }[] = JSON.parse(
  readFileSync(new URL('../../scripts/audit/ken-winning-transcripts.json', import.meta.url), 'utf8'),
);
const secret = 'synthetic-test-key-not-used-for-any-deployment';
function submission(winner: 'W' | 'B', level = 3) {
  const gameId = randomUUID(), ownerId = randomUUID();
  let board = createInitialBoard();
  const moves: KenRecordedMove[] = fixtures.find(f => f.winner === winner)!.moves.map((move, i) => {
    const turn = i % 2 === 0 ? 'W' : 'B';
    const fen = boardToScanFen(board, turn);
    const recorded = { ...move, ...(turn !== winner ? { kenProof: signKenReply({ ownerId, gameId, level, fen, move: moveToHubString(move) }, secret) } : {}) };
    board = applyMove(board, move).board;
    return recorded;
  });
  return { ownerId, gameId, level, mode: winner === 'W' ? 'Human_vs_AI' : 'AI_vs_Human', moves };
}
describe('complete Ken victory verification', () => {
  it.each([3, 4, 5, 6, 7])('accepts a legal server-attested level %i win for either human color', level => {
    for (const winner of ['W', 'B'] as const) expect(verifyKenVictory(submission(winner, level), secret)).toEqual({ ok: true });
  });
  it('rejects fabricated wins, missing signatures, owner/game/level changes, and unfinished games', () => {
    const input = submission('W');
    expect(verifyKenVictory({ ...input, ownerId: randomUUID() }, secret).ok).toBe(false);
    expect(verifyKenVictory({ ...input, gameId: randomUUID() }, secret).ok).toBe(false);
    expect(verifyKenVictory({ ...input, level: 4 }, secret).ok).toBe(false);
    expect(verifyKenVictory({ ...input, moves: input.moves.slice(0, -1) }, secret).ok).toBe(false);
    expect(verifyKenVictory({ ...input, moves: input.moves.map(({ kenProof, ...move }) => move) }, secret).ok).toBe(false);
    expect(verifyKenVictory({ ...input, moves: [{ from: 1, to: 50, caps: [] }, ...input.moves.slice(1)] }, secret).ok).toBe(false);
    expect(verifyKenVictory(input, 'different-test-key-with-at-least-thirty-two-characters').ok).toBe(false);
  });
});
