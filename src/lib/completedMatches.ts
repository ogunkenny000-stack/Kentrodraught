/** One authoritative completed match, regardless of how many old clients saved it.
 *
 * Online games are now saved by the server under the room's numeric game code.
 * Older app versions also inserted two client-created game_<timestamp>... rows.
 * These helpers hide those legacy copies without deleting any Supabase data.
 */
export interface CompletedMatch {
  gameId?: string;
  gameCode?: string;
  id?: string;
  whitePlayer?: string;
  blackPlayer?: string;
  white_player?: string;
  black_player?: string;
  winner?: string | null;
  result?: string | null;
  isDraw?: boolean;
  timestamp?: number | string;
  gameEndTime?: number;
  playMode?: string;
  gameMode?: string;
  moveHistory?: unknown[];
  completeMoveHistory?: unknown[];
  moves?: unknown[];
}

export type MatchOutcome = 'Won' | 'Loss' | 'Draw' | 'Unknown';
const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();

export function matchPlayers(match: CompletedMatch): { white: string; black: string } {
  return {
    white: String(match.whitePlayer || match.white_player || 'White'),
    black: String(match.blackPlayer || match.black_player || 'Black'),
  };
}

export function matchOutcome(match: CompletedMatch, side: 'white' | 'black'): MatchOutcome {
  const { white, black } = matchPlayers(match);
  const winner = normalize(match.winner ?? match.result);
  if (match.isDraw || ['draw', '½–½', '1/2-1/2', '0.5-0.5', 'tie'].includes(winner) || winner.includes('draw')) return 'Draw';
  if (!winner) return 'Unknown';
  let winningSide: 'white' | 'black' | null = null;
  if (['w', 'white', '1–0', '1-0'].includes(winner) || winner === normalize(white) || winner === `${normalize(white)} won`) winningSide = 'white';
  if (['b', 'black', '0–1', '0-1'].includes(winner) || winner === normalize(black) || winner === `${normalize(black)} won`) winningSide = 'black';
  if (!winningSide) return 'Unknown';
  return side === winningSide ? 'Won' : 'Loss';
}

const timestamp = (row: CompletedMatch): number => {
  const raw = row.timestamp ?? row.gameEndTime;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : Date.parse(String(raw || ''));
  return Number.isFinite(n) ? n : 0;
};

const normalizedId = (row: CompletedMatch): string => String(row.gameId || row.gameCode || row.id || '');
const canonical = (row: CompletedMatch): boolean => /^\d{7,10}$/.test(normalizedId(row));
const movesOf = (row: CompletedMatch): unknown[] => Array.isArray(row.moveHistory) ? row.moveHistory : Array.isArray(row.completeMoveHistory) ? row.completeMoveHistory : Array.isArray(row.moves) ? row.moves : [];

function sameMatch(a: CompletedMatch, b: CompletedMatch): boolean {
  if (normalizedId(a) && normalizedId(a) === normalizedId(b)) return true;
  // Two authoritative room codes always refer to DIFFERENT matches, even if
  // the same players replay the exact same opening in a rapid rematch.
  if (canonical(a) && canonical(b)) return false;
  const online = (r: CompletedMatch) => ['multiplayer', 'online'].includes(normalize(r.playMode || r.gameMode));
  if (!online(a) || !online(b)) return false;
  const ap = matchPlayers(a), bp = matchPlayers(b);
  if (normalize(ap.white) !== normalize(bp.white) || normalize(ap.black) !== normalize(bp.black)) return false;
  if (matchOutcome(a, 'white') !== matchOutcome(b, 'white')) return false;
  if (matchOutcome(a, 'white') === 'Unknown') return false;
  const at = timestamp(a), bt = timestamp(b);
  if (!at || !bt || Math.abs(at - bt) > 45_000) return false;
  const am = movesOf(a), bm = movesOf(b);
  // Zero/one-move resignations need a far tighter time window: two independent
  // very short games must never be accidentally collapsed.
  if (Math.max(am.length, bm.length) < 3 && Math.abs(at - bt) > 4_000) return false;
  if (am.length && bm.length) {
    if (Math.abs(am.length - bm.length) > 1) return false;
    const shorter = Math.min(am.length, bm.length);
    for (let i = 0; i < shorter; i++) if (JSON.stringify(am[i]) !== JSON.stringify(bm[i])) return false;
  } else if (Math.max(am.length, bm.length) >= 3) {
    // An incomplete row with no moves cannot establish match identity.
    return false;
  }
  return true;
}

/** Prefer the server record; never alter records or merge distinct rematches. */
export function uniqueCompletedMatches<T extends CompletedMatch>(rows: readonly T[]): T[] {
  const sorted = [...rows].sort((a, b) => Number(canonical(b)) - Number(canonical(a)) || timestamp(b) - timestamp(a));
  const unique: T[] = [];
  for (const row of sorted) {
    if (!unique.some(existing => sameMatch(row, existing))) unique.push(row);
  }
  return unique.sort((a, b) => timestamp(b) - timestamp(a));
}
