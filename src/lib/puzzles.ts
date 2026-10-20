/**
 * Weekly puzzle rotation helpers. Solved-state is keyed to the current ISO
 * week, so every Monday the whole set "restarts" automatically -- old
 * weeks' progress is simply never read again (and pruned on write).
 */

export function currentPuzzleWeekKey(now: Date = new Date()): string {
  // ISO-8601 week number (Mon-based), UTC to keep every device in sync.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `kentro_puzzles_solved_${d.getUTCFullYear()}-W${week < 10 ? "0" + week : week}`;
}

/** Milliseconds until the next Monday 00:00 UTC (the weekly reset). */
export function msUntilPuzzleReset(now: Date = new Date()): number {
  const d = new Date(now);
  const day = d.getUTCDay() || 7; // Mon=1..Sun=7
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (8 - day)));
  return next.getTime() - d.getTime();
}

export function puzzleProgressKey(ownerId?: string): string {
  return `${currentPuzzleWeekKey()}_${encodeURIComponent(ownerId || 'guest')}`;
}
export function getSolvedPuzzleIds(ownerId?: string): Set<string> {
  try {
    const raw = localStorage.getItem(puzzleProgressKey(ownerId));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : []);
  } catch { return new Set(); }
}
export function markPuzzleSolved(id: string, ownerId?: string): void {
  try {
    const key = puzzleProgressKey(ownerId), solved = getSolvedPuzzleIds(ownerId);
    solved.add(id);
    localStorage.setItem(key, JSON.stringify([...solved]));
    const suffix = `_${encodeURIComponent(ownerId || 'guest')}`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const old = localStorage.key(i);
      if (old && old.startsWith('kentro_puzzles_solved_') && old.endsWith(suffix) && old !== key) localStorage.removeItem(old);
    }
  } catch { /* Practice stays available when storage is blocked. */ }
}
