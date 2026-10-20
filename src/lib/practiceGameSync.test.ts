import {beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({store:new Map<string,string>(),write:vi.fn(),session:vi.fn()}));
vi.mock('./safeStorage',()=>({safeStorage:{getItem:(k:string)=>f.store.get(k)??null,setItem:(k:string,v:string)=>f.store.set(k,v)}}));
vi.mock('../supabase',()=>({supabase:{auth:{getSession:f.session},from:()=>({upsert:f.write})}}));
import {savePracticeGame,retryPracticeGames} from './practiceGameSync';
beforeEach(()=>{f.store.clear();f.write.mockReset().mockResolvedValue({error:null});f.session.mockReset().mockResolvedValue({data:{session:{user:{id:'alice'}}}});});
it('keeps an offline game and retries using its stable ID with no duplicate insertion',async()=>{
 f.write.mockResolvedValueOnce({error:Error('offline')});await expect(savePracticeGame('alice',{gameId:'game-1',moveHistory:[]})).rejects.toThrow('offline');expect(f.store.get('kentro.pendingPracticeGames.alice')).toContain('game-1');expect(await retryPracticeGames('alice')).toBe(1);expect(f.write.mock.calls[1]).toEqual([{gameId:'game-1',moveHistory:[]},{onConflict:'gameId',ignoreDuplicates:true}]);expect(await retryPracticeGames('alice')).toBe(0);
});
it('never sends another signed-in account the pending games',async()=>{f.session.mockResolvedValue({data:{session:{user:{id:'bob'}}}});await expect(savePracticeGame('alice',{gameId:'game-2'})).rejects.toThrow('same account');expect(f.write).not.toHaveBeenCalled();expect(f.store.get('kentro.pendingPracticeGames.alice')).toContain('game-2');});
it('serializes concurrent sends and drains games added during a send',async()=>{let finish:(value:unknown)=>void;f.write.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));const one=savePracticeGame('alice',{gameId:'one'});await vi.waitFor(()=>expect(f.write).toHaveBeenCalledTimes(1));const two=savePracticeGame('alice',{gameId:'two'});finish!({error:null});await Promise.all([one,two]);expect(f.write.mock.calls.map(c=>c[0].gameId)).toEqual(['one','two']);});
