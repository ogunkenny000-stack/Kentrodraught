import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({read:vi.fn(),signal:vi.fn()}));
vi.mock('../supabase',()=>({supabase:{from:()=>({select:()=>({eq:()=>({abortSignal:(signal:AbortSignal)=>{f.signal(signal);return {maybeSingle:f.read};}})})})}}));
beforeEach(()=>{vi.resetModules();f.read.mockReset();f.signal.mockReset();});
afterEach(()=>vi.useRealTimers());
it('shares avatar lookups and keeps a successful result cached',async()=>{
 const {getAvatarUrl}=await import('./avatarCache');f.read.mockResolvedValue({data:{avatarUrl:'photo'},error:null});
 expect(await Promise.all([getAvatarUrl('Alice'),getAvatarUrl('alice')])).toEqual(['photo','photo']);expect(await getAvatarUrl('alice')).toBe('photo');expect(f.read).toHaveBeenCalledTimes(1);
});
it('retries transient errors instead of caching a missing photo for 45 minutes',async()=>{
 vi.useFakeTimers();const {getAvatarUrl}=await import('./avatarCache');f.read.mockResolvedValueOnce({data:null,error:Error('offline')}).mockResolvedValueOnce({data:{avatarUrl:'restored'},error:null});
 expect(await getAvatarUrl('retry')).toBeNull();await vi.advanceTimersByTimeAsync(15001);expect(await getAvatarUrl('retry')).toBe('restored');
});
it('does not replace a newly uploaded avatar with an older pending response',async()=>{
 const {getAvatarUrl,primeAvatar}=await import('./avatarCache');let finish!:(v:any)=>void;f.read.mockImplementation(()=>new Promise(r=>finish=r));
 const old=getAvatarUrl('editor');primeAvatar('editor','new');finish({data:{avatarUrl:'old'},error:null});await old;expect(await getAvatarUrl('editor')).toBe('new');
});
it('aborts a stalled avatar read and releases it for later retry',async()=>{
 vi.useFakeTimers();const {getAvatarUrl}=await import('./avatarCache');f.read.mockImplementationOnce(()=>new Promise((_r,reject)=>f.signal.mock.calls[0][0].addEventListener('abort',()=>reject(Error('timeout')))));
 const first=getAvatarUrl('stalled');await vi.advanceTimersByTimeAsync(8000);expect(await first).toBeNull();expect(f.signal.mock.calls[0][0].aborted).toBe(true);
 await vi.advanceTimersByTimeAsync(15001);f.read.mockResolvedValue({data:{avatarUrl:'back'},error:null});expect(await getAvatarUrl('stalled')).toBe('back');
});
it('does not query synthetic player names',async()=>{const {getAvatarUrl}=await import('./avatarCache');expect(await getAvatarUrl('Ken Level 8')).toBeNull();expect(f.read).not.toHaveBeenCalled();});
