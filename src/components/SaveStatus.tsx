import React,{useCallback,useEffect,useState,useSyncExternalStore} from 'react';
import {CheckCircle2,CloudOff,RefreshCw} from 'lucide-react';
import {getPracticeSyncState,retryPracticeGames,subscribePracticeSync} from '../lib/practiceGameSync';
function OwnerSaveStatus({owner}:{owner:string}){
 const get=useCallback(()=>getPracticeSyncState(owner),[owner]);
 const state=useSyncExternalStore(subscribePracticeSync,get,get),[hideSaved,setHideSaved]=useState(false);
 useEffect(()=>{if(state.phase!=='saved')return;setHideSaved(Date.now()-state.lastSaved>10000);const timer=setTimeout(()=>setHideSaved(true),10000);return()=>clearTimeout(timer);},[state.phase,state.lastSaved]);
 useEffect(()=>{const update=(event:StorageEvent)=>{if(event.key===`kentro.pendingPracticeGames.${owner}`)void retryPracticeGames(owner).catch(()=>{});};window.addEventListener('storage',update);return()=>window.removeEventListener('storage',update);},[owner]);
 if(state.phase==='idle'||(state.phase==='saved'&&hideSaved))return null;
 const saved=state.phase==='saved',saving=state.phase==='saving';
 return <div className={`k-save-status ${saved?'is-saved':''}`} role="status" aria-live="polite"><span className="k-save-icon">{saved?<CheckCircle2 size={18}/>:saving?<RefreshCw className="animate-spin" size={18}/>:<CloudOff size={18}/>}</span><div><strong>{saved?'Game saved':saving?'Saving your game…':state.count?`${state.count} game recording${state.count===1?'':'s'} waiting to save`:'Game save needs attention'}</strong>{!saved&&<p>{state.durable===false?'Browser storage is unavailable. This window holds your recording—keep it open until saving finishes.':state.error||'Keep your browser data. Your recording will retry when the connection returns.'}</p>}</div>{!saved&&<button disabled={saving} onClick={()=>void retryPracticeGames(owner).catch(()=>{})}>{saving?'Saving…':'Retry save'}</button>}</div>;
}
export function SaveStatus({ownerId}:{ownerId?:string}){return ownerId?<OwnerSaveStatus key={ownerId} owner={ownerId}/>:null;}
