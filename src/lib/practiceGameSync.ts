import { supabase } from '../supabase';
import { safeStorage } from './safeStorage';
type PracticeRecord = {gameId:string; [key:string]:unknown};
const queueKey=(owner:string)=>`kentro.pendingPracticeGames.${owner}`;
const active=new Map<string,Promise<number>>();
function pending(owner:string):PracticeRecord[]{const raw=safeStorage.getItem(queueKey(owner));if(!raw)return [];const rows=JSON.parse(raw);if(!Array.isArray(rows))throw Error('Saved-game retry queue is damaged. Keep your browser data for recovery.');return rows;}
function store(owner:string,rows:PracticeRecord[]){const raw=JSON.stringify(rows);safeStorage.setItem(queueKey(owner),raw);if(safeStorage.getItem(queueKey(owner))!==raw)throw Error('Browser storage is unavailable or full. Keep this game open and retry while connected.');}
/** Stable game IDs make replaying a queued insert safe after a lost response. */
export async function savePracticeGame(owner:string,record:PracticeRecord){
 const rows=pending(owner).filter(row=>row.gameId!==record.gameId);if(rows.length>=50)throw Error('Reconnect to sync your pending games before saving another.');store(owner,[...rows,record]);
 return retryPracticeGames(owner);
}
export function retryPracticeGames(owner:string):Promise<number>{
 const existing=active.get(owner);if(existing)return existing;
 const task=(async()=>{let saved=0;
  while(true){const row=pending(owner)[0];if(!row)return saved;const {data}=await supabase.auth.getSession();if(data.session?.user.id!==owner)throw Error('Sign in to the same account to save this game.');
   const {error}=await supabase.from('completed_games').upsert(row,{onConflict:'gameId',ignoreDuplicates:true});if(error)throw error;
   store(owner,pending(owner).filter(item=>item.gameId!==row.gameId));saved++;
  }
 })();active.set(owner,task);void task.finally(()=>{active.delete(owner);}).catch(()=>{});return task;
}
