import {afterEach, beforeEach, expect, it, vi} from 'vitest';
const {storage,session}=vi.hoisted(()=>({storage:new Map<string,string>(),session:{user:{id:'owner'},access_token:'fixture'}}));
vi.mock('../supabase',()=>({supabase:{auth:{getSession:async()=>({data:{session}})}}}));
vi.mock('./safeStorage',()=>({safeStorage:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)}}));
import {saveKenVictory,retryPendingKenVictories} from './kenProgression';
beforeEach(()=>{storage.clear();});
afterEach(()=>{vi.unstubAllGlobals();});
it.each([2,3,4,5,6,7])('saves a verified level %i win and grants the following level without a coin request',async level=>{
 const fetcher=vi.fn(async()=>({ok:true,json:async()=>({ok:true,maxUnlockedKenLevel:level+1})}));vi.stubGlobal('fetch',fetcher);
 expect(await saveKenVictory('owner',`level-${level}`,level,'Human_vs_AI',[])).toBe(level+1);
 expect(fetcher.mock.calls).toHaveLength(1);
 expect(JSON.parse((fetcher.mock.calls as any)[0][1].body).level).toBe(level);
 expect((fetcher.mock.calls as any)[0][0]).toBe('/api/ken/claim-win');
});
it('shares concurrent claims and retains failed receipts for reconnect/reload retry',async()=>{
 const fetcher=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ok:true,json:async()=>({ok:true,maxUnlockedKenLevel:4})});vi.stubGlobal('fetch',fetcher);
 const first=saveKenVictory('owner','retry-game',3,'Human_vs_AI',[]);
 expect(saveKenVictory('owner','retry-game',3,'Human_vs_AI',[])).toBe(first);
 await expect(first).rejects.toThrow('offline');
 expect(storage.get('kentro.pendingKenWins.owner')).toContain('retry-game');
 expect(await retryPendingKenVictories('owner')).toBe(4);
 expect(storage.get('kentro.pendingKenWins.owner')).toBe('[]');
 expect(fetcher).toHaveBeenCalledTimes(2);
});
it('does not claim another account receipts or create level 9',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 await expect(saveKenVictory('another-owner','wrong-account',3,'Human_vs_AI',[])).rejects.toThrow('Sign in');
 await expect(saveKenVictory('owner','level-8',8,'Human_vs_AI',[])).rejects.toThrow('ends at level 8');
 expect(fetcher).not.toHaveBeenCalled();
});
