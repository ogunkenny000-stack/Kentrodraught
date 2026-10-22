import {expect,it,vi} from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
function worker() {
 const stores=new Map<string,Map<string,Response>>();
 const handlers=new Map<string,Function>();
 const fetch=vi.fn(async()=>new Response('file',{headers:{'Content-Type':'application/javascript'}}));
 const caches={open:async(name:string)=>{
  if(!stores.has(name))stores.set(name,new Map());const map=stores.get(name)!;
  return {match:async(url:string)=>map.get(url),put:async(url:string,response:Response)=>{map.set(url,response);}};
 }};
 const scope={location:{hostname:'127.0.0.2'},addEventListener:(name:string,fn:Function)=>handlers.set(name,fn),skipWaiting:vi.fn(),clients:{claim:vi.fn()}};
 const source=fs.readFileSync('public/sw.js','utf8').replace('const PRECACHE_ASSETS = [];','const PRECACHE_ASSETS = ["/engine/scan.js", "/engine/scan.wasm"];');
 vm.runInNewContext(source,{self:scope,caches,fetch,setTimeout,clearTimeout,AbortController,Response,URL,Promise});
 const message=async(type:string)=>{let pending!:Promise<any>;let result:any;handlers.get('message')!({data:{type},ports:[{postMessage:(v:any)=>{result=v;}}],waitUntil:(p:Promise<any>)=>{pending=p;}});await pending;return result;};
 return {message,fetch,stores};
}
it('reports missing files before preparing and ready only after all files exist',async()=>{
 const w=worker();expect(await w.message('KENTRO_OFFLINE_STATUS')).toMatchObject({ready:false,missing:10});expect(await w.message('KENTRO_PREPARE_OFFLINE')).toEqual({ready:true,missing:0});expect(w.fetch).toHaveBeenCalledTimes(10);expect(await w.message('KENTRO_OFFLINE_STATUS')).toEqual({ready:true,missing:0});
});
it('preserves partial downloads and retries only missing files',async()=>{
 const w=worker();w.fetch.mockImplementation(async(url?:any)=>{if(url==='/engine/scan.wasm')throw Error('offline');return new Response('file');});expect(await w.message('KENTRO_PREPARE_OFFLINE')).toEqual({ready:false,missing:1});
 w.fetch.mockClear().mockResolvedValue(new Response('wasm'));expect(await w.message('KENTRO_PREPARE_OFFLINE')).toEqual({ready:true,missing:0});expect(w.fetch).toHaveBeenCalledTimes(1);
});
it('does not treat an HTML fallback as a saved engine',async()=>{
 const w=worker();w.fetch.mockResolvedValue(new Response('<html>missing</html>',{headers:{'Content-Type':'text/html'}}));expect(await w.message('KENTRO_PREPARE_OFFLINE')).toEqual({ready:false,missing:6});
});
it('coalesces simultaneous preparation requests',async()=>{
 const w=worker();const result=await Promise.all([w.message('KENTRO_PREPARE_OFFLINE'),w.message('KENTRO_PREPARE_OFFLINE')]);expect(result.every(r=>r.ready)).toBe(true);expect(w.fetch).toHaveBeenCalledTimes(10);
});
