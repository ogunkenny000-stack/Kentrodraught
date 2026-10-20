import {supabase} from '../supabase';
import {safeStorage} from './safeStorage';
type PracticeRecord={gameId:string;[key:string]:unknown};
export type PracticeSyncState={phase:'idle'|'saving'|'pending'|'saved'|'error';count:number;error:string;lastSaved:number;durable:boolean};
const queueKey=(owner:string)=>`kentro.pendingPracticeGames.${owner}`;
const volatile=new Map<string,PracticeRecord[]>(),completed=new Map<string,Set<string>>();
const active=new Map<string,Promise<number>>(),states=new Map<string,PracticeSyncState>(),listeners=new Set<()=>void>();
function pending(owner:string):PracticeRecord[]{const raw=safeStorage.getItem(queueKey(owner));const rows=raw?JSON.parse(raw):[];if(!Array.isArray(rows)||rows.length>50||rows.some(row=>!row||typeof row.gameId!=='string'))throw Error('Saved-game retry queue needs recovery. Keep your browser data.');return [...new Map([...rows,...(volatile.get(owner)||[])].filter(row=>!completed.get(owner)?.has(row.gameId)).map(row=>[row.gameId,row])).values()];}
function count(owner:string){try{return pending(owner).length;}catch{return 0;}}
function publish(owner:string,patch:Partial<PracticeSyncState>){states.set(owner,{phase:'idle',count:count(owner),error:'',lastSaved:0,durable:true,...states.get(owner),...patch});listeners.forEach(listener=>listener());}
export function getPracticeSyncState(owner:string):PracticeSyncState{if(!states.has(owner)){try{const size=pending(owner).length;states.set(owner,{phase:size?'pending':'idle',count:size,error:'',lastSaved:0,durable:true});}catch{states.set(owner,{phase:'error',count:0,error:'Saved-game retry queue needs recovery. Keep your browser data.',lastSaved:0,durable:true});}}return states.get(owner)!;}
export function subscribePracticeSync(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
function store(owner:string,rows:PracticeRecord[]){
 const raw=JSON.stringify(rows);safeStorage.setItem(queueKey(owner),raw);const durable=safeStorage.getItem(queueKey(owner))===raw;
 if(durable){volatile.delete(owner);completed.delete(owner);}else{volatile.set(owner,rows);}
 publish(owner,{count:rows.length,durable});
}
async function storageLock<T>(owner:string,work:()=>T):Promise<T>{
 if(typeof navigator!=='undefined'&&navigator.locks){let entered=false;try{return await navigator.locks.request(queueKey(owner),()=>{entered=true;return work();});}catch(error){if(entered||!['SecurityError','NotAllowedError','NotSupportedError'].includes((error as Error).name))throw error;}}
 return work();
}
/** Stable IDs, per-account queues and short storage locks protect retries across tabs. */
export async function savePracticeGame(owner:string,record:PracticeRecord){
 try{await storageLock(owner,()=>{const rows=pending(owner).filter(row=>row.gameId!==record.gameId);if(rows.length>=50)throw Error('Reconnect to sync your pending games before saving another.');store(owner,[...rows,record]);});let saved=await retryPracticeGames(owner);if(pending(owner).some(row=>row.gameId===record.gameId))saved+=await retryPracticeGames(owner);return saved;}
 catch(error){publish(owner,{phase:'error',count:count(owner),error:error instanceof Error?error.message:'Game save is pending. Reconnect to retry.'});throw error;}
}
export function retryPracticeGames(owner:string):Promise<number>{
 const existing=active.get(owner);if(existing)return existing;
 const task=(async()=>{let saved=0;try{
  while(true){const row=pending(owner)[0];if(!row){if(saved)publish(owner,{phase:'saved',count:0,error:'',lastSaved:Date.now()});else if(getPracticeSyncState(owner).phase!=='saved')publish(owner,{phase:'idle',count:0,error:''});return saved;}
   publish(owner,{phase:'saving',count:count(owner),error:''});
   const {data}=await supabase.auth.getSession();if(data.session?.user.id!==owner)throw Error('Sign in to the same account to save this game.');
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
   try{const {error}=await supabase.from('completed_games').upsert(row,{onConflict:'gameId',ignoreDuplicates:true}).abortSignal(controller.signal);if(error)throw error;}finally{clearTimeout(timer);}
   await storageLock(owner,()=>{const acknowledged=completed.get(owner)||new Set<string>();acknowledged.add(row.gameId);completed.set(owner,acknowledged);store(owner,pending(owner).filter(item=>item.gameId!==row.gameId));});saved++;
  }
 }catch(error){publish(owner,{phase:'error',count:count(owner),error:error instanceof Error?error.message:'Game save is pending. Reconnect to retry.'});throw error;}})();
 active.set(owner,task);void task.finally(()=>{active.delete(owner);}).catch(()=>{});return task;
}
