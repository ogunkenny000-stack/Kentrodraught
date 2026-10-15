import { describe, expect, it } from 'vitest';
import { generateLegalMoves, boardToScanFen } from '../gameLogic';
import { initialOfflineMatch, playOfflineMove, makeOfflineMoveMessage, receiveOfflineMove, receiveOfflineReply, makePairingCode, parsePairingCode, ensureNearbyCandidates } from './offlineMatch';
import type { OfflineRequests } from './offlineMatch';

describe('nearby offline match rules', () => {
  it('starts with Nigerian 10x10 legal first moves', () => {
    const s = initialOfflineMatch();
    expect(generateLegalMoves(s.board, 'W').length).toBeGreaterThan(0);
    expect(s.turn).toBe('W');
  });
  it('mirrors a local move on remote device and alternates sides', () => {
    const a = initialOfflineMatch();
    const b = initialOfflineMatch();
    const legal = generateLegalMoves(a.board, 'W')[0];
    const msg = makeOfflineMoveMessage(a, legal);
    const nextA = playOfflineMove(a, legal, 'W');
    const nextB = receiveOfflineMove(b, msg, 'W');
    expect(boardToScanFen(nextA.board, nextA.turn)).toBe(boardToScanFen(nextB.board, nextB.turn));
    expect(nextB.history.length).toBe(1);
    expect(nextB.turn).toBe('B');
  });
  it('rejects out of turn, replay and state mismatches', () => {
    const state = initialOfflineMatch();
    const move = generateLegalMoves(state.board, 'W')[0];
    expect(() => playOfflineMove(state, move, 'B')).toThrow('not your turn');
    const packet = makeOfflineMoveMessage(state, move);
    const next = receiveOfflineMove(state, packet, 'W');
    expect(() => receiveOfflineMove(next, packet, 'W')).toThrow('out of sync');
    expect(() => receiveOfflineMove(state, { ...packet, before: 'wrong' }, 'W')).toThrow('out of sync');
  });
  it('keeps both peers synchronized through captures and the final result', () => {
    let host = initialOfflineMatch();
    let guest = initialOfflineMatch();
    let captures = 0;
    for (let ply = 0; ply < 200 && !host.result; ply++) {
      const choice = generateLegalMoves(host.board, host.turn)[0];
      if (choice.caps.length) captures++;
      const packet = makeOfflineMoveMessage(host, choice);
      const mover = host.turn;
      host = playOfflineMove(host, choice, mover);
      guest = receiveOfflineMove(guest, packet, mover);
      expect(boardToScanFen(host.board, host.turn)).toBe(boardToScanFen(guest.board, guest.turn));
      expect(host.result).toEqual(guest.result);
    }
    expect(captures).toBeGreaterThan(0);
    expect(host.result).not.toBeNull();
  });
  it('rejects illegal moves rather than advancing both boards', () => {
    const state = initialOfflineMatch();
    expect(() => playOfflineMove(state, { from: 1, to: 6, caps: [] }, 'W')).toThrow('Illegal');
  });
});

describe('nearby agreement consent', () => {
  const requests: OfflineRequests = { drawIncoming: false, drawOutgoing: false, rematchIncoming: false, rematchOutgoing: false };
  it('prevents an unsolicited acceptance from ending or resetting the game', () => {
    const state = initialOfflineMatch();
    expect(() => receiveOfflineReply(state, { type: 'draw-reply', accept: true }, requests)).toThrow('Unexpected');
    const ended = { ...state, result: { winner: 'W' as const, reason: 'Resignation' } };
    expect(() => receiveOfflineReply(ended, { type: 'rematch-accept' }, requests)).toThrow('Unexpected');
    expect(state.result).toBeNull();
    expect(ended.result.reason).toBe('Resignation');
  });
  it('requires a pending local offer and boolean answer to agree to a draw', () => {
    const state = initialOfflineMatch();
    const pending = { ...requests, drawOutgoing: true };
    expect(receiveOfflineReply(state, { type: 'draw-reply', accept: true }, pending).result).toEqual({ winner: null, reason: 'Draw agreed' });
    expect(receiveOfflineReply(state, { type: 'draw-reply', accept: false }, pending)).toBe(state);
    expect(() => receiveOfflineReply(state, { type: 'draw-reply', accept: 'yes' as any }, pending)).toThrow('Unexpected');
  });
  it('rematches an ended game only after a local rematch request', () => {
    const state = initialOfflineMatch();
    const move = generateLegalMoves(state.board, 'W')[0];
    const ended = { ...playOfflineMove(state, move, 'W'), result: { winner: null, reason: 'Draw agreed' } };
    const pending = { ...requests, rematchOutgoing: true };
    expect(receiveOfflineReply(ended, { type: 'rematch-accept' }, pending)).toEqual(initialOfflineMatch());
    expect(() => receiveOfflineReply(state, { type: 'rematch-accept' }, pending)).toThrow('Unexpected');
  });
});

describe('pairing exchange', () => {
  it('does not advertise a gathered connection that has no local ICE address', () => {
    expect(() => ensureNearbyCandidates('v=0\r\na=end-of-candidates\r\n')).toThrow('local Wi-Fi address');
    expect(() => ensureNearbyCandidates('v=0\r\na=candidate:1 1 UDP 2122260223 192.168.1.2 60000 typ host\r\n')).not.toThrow();
  });
  it('round trips an SDP offer without any server', () => {
    const description = { type: 'offer' as const, sdp: 'v=0\r\no=- 1 2 IN IP4 0.0.0.0\r\n' };
    expect(parsePairingCode(makePairingCode(description), 'offer')).toEqual(description);
  });
  it('rejects wrong code type and corrupt codes', () => {
    const description = { type: 'answer' as const, sdp: 'v=0\r\no=- 1 2 IN IP4 0.0.0.0\r\n' };
    expect(() => parsePairingCode(makePairingCode(description), 'offer')).toThrow('Wrong');
    expect(() => parsePairingCode('not a code', 'offer')).toThrow('not a valid');
  });
});
