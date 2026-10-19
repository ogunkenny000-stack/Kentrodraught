import { safeStorage } from './safeStorage';
import { supabase } from '../supabase';
import type { Move } from '../gameLogic';
type PendingWin = {gameId:string; level:number; mode:string; moves:Move[]};
const pendingKey = (owner: string) => `kentro.pendingKenWins.${owner}`;
function pending(owner: string): PendingWin[] {
  try { const rows = JSON.parse(safeStorage.getItem(pendingKey(owner)) || '[]'); return Array.isArray(rows) ? rows.filter(row => row && typeof row.gameId==='string' && Number.isInteger(row.level) && Array.isArray(row.moves)).slice(-8) : []; } catch { return []; }
}
const claims = new Map<string, Promise<number>>();
/** Concurrent automatic save/Next clicks share one idempotent server claim. */
export function saveKenVictory(ownerId: string, gameId: string, level: number, mode: string, moves: Move[]): Promise<number> {
  if (!Number.isInteger(level) || level < 1 || level >= 8) return Promise.reject(new Error("Ken progression ends at level 8."));
  const key = `${ownerId}:${gameId}`;
  const existing = claims.get(key); if (existing) return existing;
  const queue = pending(ownerId).filter(win=>win.gameId!==gameId);
  safeStorage.setItem(pendingKey(ownerId), JSON.stringify([...queue,{gameId,level,mode,moves}].slice(-8)));
  const task = (async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token || data.session.user.id !== ownerId) throw new Error('Sign in again to save your Ken victory.');
    const response = await fetch('/api/ken/claim-win', {
      method:'POST', signal:AbortSignal.timeout(15000),
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},
      body:JSON.stringify({gameId,level,mode,moves}),
    });
    const result = await response.json();
    if (!response.ok || !result?.ok || !Number.isInteger(result.maxUnlockedKenLevel) || result.maxUnlockedKenLevel < level+1 || result.maxUnlockedKenLevel > 8)
      throw new Error(result?.error || 'Your victory could not be saved. Tap Move to Higher Level to retry.');
    safeStorage.setItem(pendingKey(ownerId), JSON.stringify(pending(ownerId).filter(win=>win.gameId!==gameId)));
    return result.maxUnlockedKenLevel as number;
  })();
  claims.set(key,task);
  // Failed calls can be retried; successful claims stay deduplicated for this session.
  void task.catch(()=>{if(claims.get(key)===task)claims.delete(key);});
  if(claims.size>64)claims.delete(claims.keys().next().value!);
  return task;
}

/** Replay only the signed-in owner's pending, server-verifiable receipts in level order. */
export async function retryPendingKenVictories(ownerId: string): Promise<number> {
  let max = 0;
  for (const win of pending(ownerId).sort((a,b)=>a.level-b.level)) {
    try { max = Math.max(max, await saveKenVictory(ownerId,win.gameId,win.level,win.mode,win.moves)); }
    catch { break; } // Keep receipts for the next connection; never grant an unverified level.
  }
  return max;
}
