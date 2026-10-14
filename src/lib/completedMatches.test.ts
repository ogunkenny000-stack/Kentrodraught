import { describe, expect, it } from 'vitest';
import { matchOutcome, uniqueCompletedMatches } from './completedMatches';

const baseTime = Date.UTC(2026, 9, 11, 12);
const moves = Array.from({ length: 22 }, (_, i) => ({ from: i, to: i + 1, caps: [] }));
const match = (gameId: string, timestamp: number, props: Record<string, unknown> = {}) => ({
  gameId, id: gameId, whitePlayer: 'Bayo', blackPlayer: 'Ayo', winner: 'B',
  playMode: 'Multiplayer', timestamp, moveHistory: moves, ...props,
});

describe('one match, one result log', () => {
  it('shows BOTH players correctly in the same match', () => {
    expect(matchOutcome(match('26100001', baseTime), 'white')).toBe('Loss');
    expect(matchOutcome(match('26100001', baseTime), 'black')).toBe('Won');
  });
  it('collapses the server row, both clients, and a repeated old client log', () => {
    const rows = [match('game_1', baseTime - 500), match('game_2', baseTime - 900),
      match('26100001', baseTime), match('game_3', baseTime + 200)];
    expect(uniqueCompletedMatches(rows).map(r => r.gameId)).toEqual(['26100001']);
  });
  it('collapses legacy clients even if the canonical server record is missing', () => {
    expect(uniqueCompletedMatches([match('game_1', baseTime), match('game_2', baseTime + 800)])).toHaveLength(1);
  });
  it('preserves each different authoritative rematch code, even with the same moves', () => {
    expect(uniqueCompletedMatches([match('26100001', baseTime), match('26100002', baseTime + 10000)])).toHaveLength(2);
  });
  it('keeps a genuine new rematch with different moves', () => {
    expect(uniqueCompletedMatches([match('game_1', baseTime), match('game_2', baseTime + 10000, {
      moveHistory: moves.map((m, i) => i === 9 ? { ...m, to: 49 } : m),
    })])).toHaveLength(2);
  });
  it('keeps AI games separate, including repeated identical openings', () => {
    expect(uniqueCompletedMatches([match('game_1', baseTime, { playMode: 'Human_vs_AI' }),
      match('game_2', baseTime + 1000, { playMode: 'Human_vs_AI' })])).toHaveLength(2);
  });
  it('keeps matches over 45 seconds apart separate', () => {
    expect(uniqueCompletedMatches([match('game_1', baseTime), match('game_2', baseTime + 46000)])).toHaveLength(2);
  });
  it('does not collapse two short resignations several seconds apart', () => {
    expect(uniqueCompletedMatches([match('game_1', baseTime, { moveHistory: [] }),
      match('game_2', baseTime + 6000, { moveHistory: [] })])).toHaveLength(2);
  });
  it('renders draws and username-coded winners correctly', () => {
    expect(matchOutcome(match('x', baseTime, { winner: 'Draw' }), 'white')).toBe('Draw');
    expect(matchOutcome(match('x', baseTime, { winner: 'Draw' }), 'black')).toBe('Draw');
    expect(matchOutcome(match('x', baseTime, { winner: 'ayo' }), 'black')).toBe('Won');
    expect(matchOutcome(match('x', baseTime, { winner: 'White' }), 'white')).toBe('Won');
    expect(matchOutcome(match('x', baseTime, { winner: null }), 'white')).toBe('Unknown');
  });
  it('accepts reverse name spellings but preserves white/black roles', () => {
    expect(uniqueCompletedMatches([match('26100001', baseTime),
      match('game_1', baseTime + 1000, { whitePlayer: 'bayo', blackPlayer: 'AYO' })])).toHaveLength(1);
  });
});
