/** Deterministic, server-free rules for nearby two-device games.
 * This deliberately shares the same move generator and adjudicator as online play.
 */
import { applyMove, boardToScanFen, checkGameEnd, createInitialBoard, generateLegalMoves, movesAreEquivalent } from '../gameLogic';
import type { Board, Move } from '../gameLogic';

export type Side = 'W' | 'B';
export type OfflineResult = { winner: Side | null; reason: string } | null;
export type OfflineMatch = {
  board: Board;
  turn: Side;
  history: Move[];
  result: OfflineResult;
};
export type WireMove = { type: 'move'; seq: number; before: string; move: Move };

export function initialOfflineMatch(): OfflineMatch {
  return { board: createInitialBoard(), turn: 'W', history: [], result: null };
}

/** Validate a move against the CURRENT position and its turn, including every capture. */
export function playOfflineMove(state: OfflineMatch, move: Move, mover: Side): OfflineMatch {
  if (state.result) throw new Error('This game has ended.');
  if (mover !== state.turn) throw new Error('It is not your turn.');
  const matching = generateLegalMoves(state.board, state.turn).find(m => movesAreEquivalent(m, move));
  if (!matching) throw new Error('Illegal move or incomplete capture.');
  const board = applyMove(state.board, matching).board;
  const history = [...state.history, matching];
  const turn = state.turn === 'W' ? 'B' : 'W';
  const gameEnd = checkGameEnd(history);
  return {
    board, turn, history,
    result: gameEnd.isOver ? { winner: gameEnd.winner, reason: gameEnd.reason } : null,
  };
}

export function makeOfflineMoveMessage(state: OfflineMatch, move: Move): WireMove {
  return { type: 'move', seq: state.history.length, before: boardToScanFen(state.board, state.turn), move };
}

export function receiveOfflineMove(state: OfflineMatch, packet: WireMove, remoteSide: Side): OfflineMatch {
  if (!packet || packet.type !== 'move' || packet.seq !== state.history.length ||
      packet.before !== boardToScanFen(state.board, state.turn)) {
    throw new Error('The two boards are out of sync. Start a new nearby match.');
  }
  return playOfflineMove(state, packet.move, remoteSide);
}

export function parsePairingCode(raw: string, expected: 'offer' | 'answer'): RTCSessionDescriptionInit {
  const code = raw.trim().replace(/\s+/g, '');
  if (!code.startsWith('KENTRO-LAN-1:') || code.length > 30000) {
    throw new Error('This is not a valid Kentro nearby connection code.');
  }
  try {
    const base64 = code.slice('KENTRO-LAN-1:'.length).replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const candidate = JSON.parse(new TextDecoder().decode(bytes));
    if (candidate?.v !== 1 || candidate?.type !== expected || typeof candidate.sdp !== 'string' ||
        candidate.sdp.length > 20000 || !candidate.sdp.startsWith('v=0')) {
      throw new Error('Wrong connection code for this step.');
    }
    return { type: expected, sdp: candidate.sdp };
  } catch (error) {
    if (error instanceof Error && error.message === 'Wrong connection code for this step.') throw error;
    throw new Error('The connection code is damaged. Copy the complete code again.');
  }
}

export function makePairingCode(description: RTCSessionDescriptionInit): string {
  if (!description.type || !description.sdp) throw new Error('Connection data is not ready.');
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, type: description.type, sdp: description.sdp }));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `KENTRO-LAN-1:${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
}
