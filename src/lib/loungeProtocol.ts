/** Usernames allow underscores; a colon-separated pair is unambiguous. Legacy
 * rows are normalized from their sender/recipient fields when read. */
export function directChatId(first: string, second: string): string {
  return `dm:${[first.trim().toLowerCase(), second.trim().toLowerCase()].sort().join(':')}`;
}
export function directChatTarget(chatId: string, username: string): string {
  const mine = username.trim().toLowerCase();
  if (!chatId.startsWith('dm:')) return '';
  const participants = chatId.slice(3).split(':');
  return participants.length === 2 && participants.includes(mine) ? participants.find(name => name !== mine) || '' : '';
}
const META_PREFIX = '___KENTRO_META___:';
const RICH_FIELDS = ['text', 'voiceNote', 'duration', 'sticker', 'stickerEmoji', 'stickerImageUrl', 'stickerLabel', 'gameShare', 'replyTo', 'forwardedFrom', 'mediaUrl', 'mediaType', 'fileName'] as const;
function richFields(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of RICH_FIELDS) {
    const value = payload[key];
    if (key === 'duration') {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) result[key] = value;
    } else if (key === 'mediaType') {
      if (value === 'image' || value === 'video' || value === 'file') result[key] = value;
    } else if (key === 'replyTo') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const reply = value as Record<string, unknown>;
      if (typeof reply.id !== 'string' || typeof reply.sender !== 'string') continue;
      result[key] = Object.fromEntries(['id', 'sender', 'text', 'type', 'mediaUrl']
        .filter(field => typeof reply[field] === 'string').map(field => [field, reply[field]]));
    } else if (key === 'gameShare') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const game = value as Record<string, unknown>;
      if (typeof game.gameCode !== 'string') continue;
      const share = Object.fromEntries(['gameCode', 'whitePlayer', 'blackPlayer', 'result', 'resultDetail', 'timeControl', 'date']
        .filter(field => typeof game[field] === 'string').map(field => [field, game[field]]));
      if (typeof game.movesCount === 'number' && Number.isSafeInteger(game.movesCount) && game.movesCount >= 0) share.movesCount = game.movesCount;
      if (game.gameData && typeof game.gameData === 'object' && !Array.isArray(game.gameData)) share.gameData = game.gameData;
      result[key] = share;
    } else if (typeof value === 'string') result[key] = value;
  }
  return result;
}
export function encodeLoungePayload(payload: Record<string, unknown>): string {
  return META_PREFIX + JSON.stringify(richFields(payload));
}
export function decodeLoungePayload(text: unknown): Record<string, any> {
  if (typeof text !== 'string') return { text: '' };
  if (!text.startsWith(META_PREFIX)) return { text };
  try {
    const parsed = JSON.parse(text.slice(META_PREFIX.length));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { text };
    return richFields(parsed);
  } catch { return { text }; }
}
