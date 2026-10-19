import { describe, expect, it } from 'vitest';
import { directChatId, directChatTarget, encodeLoungePayload, decodeLoungePayload } from './loungeProtocol';

describe('lounge protocol compatibility', () => {
  it('keeps underscore usernames unambiguous and rejects unrelated conversations', () => {
    const id = directChatId('Ada_Lovelace', 'Ken_Player');
    expect(id).toBe(directChatId('ken_player', 'ada_lovelace'));
    expect(directChatTarget(id, 'Ada_Lovelace')).toBe('ken_player');
    expect(directChatId('ada_lovelace', 'ken')).not.toBe(directChatId('ada', 'lovelace_ken'));
    expect(directChatTarget(id, 'intruder')).toBe('');
  });
  it('round trips rich messages in the existing text column without identity override', () => {
    const payload = { text: 'hello', voiceNote: 'data:audio/webm;base64,AA', duration: 1, gameShare: { gameCode: '123' }, mediaUrl: 'data:image/png;base64,AA', fileName: 'board.png' };
    expect(decodeLoungePayload(encodeLoungePayload({ ...payload, sender: 'forged', id: 'forged' }))).toEqual(payload);
    expect(decodeLoungePayload('legacy text')).toEqual({ text: 'legacy text' });
    expect(decodeLoungePayload('___KENTRO_META___:invalid')).toEqual({ text: '___KENTRO_META___:invalid' });
  });
  it('does not allow malformed peer metadata to become renderable React objects', () => {
    const unsafe = '___KENTRO_META___:' + JSON.stringify({
      text: { html: 'crash' }, stickerEmoji: [], duration: -2, mediaType: 'javascript',
      replyTo: { id: 'reply', sender: { user: 'crash' }, text: 'hidden' },
      gameShare: { gameCode: 'K123', whitePlayer: { user: 'crash' }, blackPlayer: 'Ken', movesCount: -1 },
      sender: 'forged', status: 'seen',
    });
    expect(decodeLoungePayload(unsafe)).toEqual({ gameShare: { gameCode: 'K123', blackPlayer: 'Ken' } });
    expect(decodeLoungePayload({ text: 'untrusted object' })).toEqual({ text: '' });
  });
  it('retains supported reply and replay fields across reloads', () => {
    const payload = {
      replyTo: { id: 'uuid', sender: 'Ada', text: 'Reply', type: 'text' },
      gameShare: { gameCode: 'K123', whitePlayer: 'Ada', blackPlayer: 'Ken', result: 'draw', movesCount: 6, gameData: { moves: [] } },
      mediaType: 'file', fileName: 'notes.txt', mediaUrl: 'https://example.com/notes.txt', duration: 0,
    };
    expect(decodeLoungePayload(encodeLoungePayload(payload))).toEqual(payload);
    expect(decodeLoungePayload(encodeLoungePayload({ duration: Infinity }))).toEqual({});
  });
});
