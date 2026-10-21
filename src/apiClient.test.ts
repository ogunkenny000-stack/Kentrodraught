import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const auth=vi.hoisted(()=>({token:'alice',session:vi.fn()}));
vi.mock('./supabase',()=>({supabase:{auth:{getSession:auth.session}}}));
import {apiGet,apiPost} from './apiClient';
beforeEach(()=>{auth.token='alice';auth.session.mockImplementation(async()=>({data:{session:{access_token:auth.token}}}));vi.stubGlobal('fetch',vi.fn());});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
const reply=(value:unknown)=>({ok:true,json:async()=>value});
it('shares overlapping same-account reads and does not cache completed data',async()=>{
 let finish!:(v:any)=>void;vi.mocked(fetch).mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
 const a=apiGet('/api/tv/live',{b:'2',a:'1'}),b=apiGet('/api/tv/live',{a:'1',b:'2'});
 await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));finish(reply({rooms:[]}));
 expect(await a).toEqual(await b);expect(fetch).toHaveBeenCalledWith('/api/tv/live?a=1&b=2',expect.anything());
 vi.mocked(fetch).mockResolvedValueOnce(reply({rooms:['new']}) as any);expect(await apiGet('/api/tv/live',{a:'1',b:'2'})).toEqual({rooms:['new']});expect(fetch).toHaveBeenCalledTimes(2);
});
it('never joins another account or guest request',async()=>{
 const finish:((v:any)=>void)[]=[];vi.mocked(fetch).mockImplementation(()=>new Promise(r=>finish.push(r)));
 const alice=apiGet('/api/wallet');await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
 auth.token='bob';const bob=apiGet('/api/wallet');await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
 finish[0](reply({balance:10}));finish[1](reply({balance:20}));expect(await alice).toEqual({balance:10});expect(await bob).toEqual({balance:20});
});
it('releases failed reads so retry gets a new request',async()=>{
 vi.mocked(fetch).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(reply({ok:true}) as any);
 await expect(apiGet('/api/retry')).rejects.toThrow('offline');expect(await apiGet('/api/retry')).toEqual({ok:true});
});
it('times out stalled reads and lets the user retry',async()=>{
 vi.useFakeTimers();vi.mocked(fetch).mockImplementationOnce((_u,o)=>new Promise((_r,reject)=>o!.signal!.addEventListener('abort',()=>reject(new Error('aborted')))));
 const assertion=expect(apiGet('/api/stalled')).rejects.toMatchObject({status:408});await vi.advanceTimersByTimeAsync(15000);await assertion;
 vi.mocked(fetch).mockResolvedValueOnce(reply({ok:true}) as any);expect(await apiGet('/api/stalled')).toEqual({ok:true});
});
it('keeps write requests separate even when they have identical bodies',async()=>{
 vi.mocked(fetch).mockResolvedValue(reply({ok:true}) as any);await Promise.all([apiPost('/api/write',{amount:10}),apiPost('/api/write',{amount:10})]);expect(fetch).toHaveBeenCalledTimes(2);
});
it('preserves server error details',async()=>{
 vi.mocked(fetch).mockResolvedValue({ok:false,status:403,json:async()=>({error:'Forbidden'})} as any);await expect(apiGet('/api/private')).rejects.toMatchObject({status:403,data:{error:'Forbidden'}});
});
it('starts a fresh read after a successful write even if an older read is pending',async()=>{
 let finish!:(v:any)=>void;vi.mocked(fetch).mockImplementationOnce(()=>new Promise(r=>finish=r)).mockResolvedValueOnce(reply({ok:true}) as any).mockResolvedValueOnce(reply({balance:20}) as any);
 const old=apiGet('/api/balance');await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));await apiPost('/api/deposit',{amount:10});
 expect(await apiGet('/api/balance')).toEqual({balance:20});finish(reply({balance:10}));await old;expect(fetch).toHaveBeenCalledTimes(3);
});
