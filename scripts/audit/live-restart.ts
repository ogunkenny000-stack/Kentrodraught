import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';
import { generateLegalMoves } from '../../src/gameLogic';
const directory = await mkdtemp(path.join(os.tmpdir(),'kentro-live-restart-'));
let child: ReturnType<typeof spawn>;
const sockets: WebSocket[]=[];
async function boot() {
  child=spawn(process.execPath,['--import','tsx','scripts/audit/live-restart-fixture.ts'],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'test',KENTRO_DATA_DIR:directory,SUPABASE_URL:'',SUPABASE_SECRET_KEY:''},stdio:['ignore','pipe','pipe']});
  let output='';
  return await new Promise<number>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Fixture timeout '+output)),10000);
    child.once('exit',code=>{clearTimeout(timer); reject(new Error('Fixture exit '+code+' '+output));});
    child.stderr!.on('data',c=>output+=String(c));
    child.stdout!.on('data',c=>{output+=String(c);const line=output.split('\n').find(s=>s.startsWith('FIXTURE '));if(line){clearTimeout(timer);resolve(JSON.parse(line.slice(8)).port);}});
  });
}
async function stop(signal: NodeJS.Signals) { const exited=new Promise(r=>child.once('exit',r));child.kill(signal);await exited; }
async function peer(port:number,name:string,token?:string) {
  const ws=new WebSocket('ws://127.0.0.1:'+port);sockets.push(ws);
  const inbox:any[]=[];const notify=new Set<()=>void>();
  ws.on('message',b=>{inbox.push(JSON.parse(String(b)));notify.forEach(f=>f());});
  await new Promise<void>((r,j)=>{ws.once('open',r);ws.once('error',j);});
  const receive=(type:string)=>new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{notify.delete(find);reject(new Error('Missing '+type+' '+JSON.stringify(inbox)));},5000);const find=()=>{const i=inbox.findIndex(m=>m.type===type);if(i>=0){clearTimeout(timer);notify.delete(find);resolve(inbox.splice(i,1)[0]);}};notify.add(find);find();});
  const send=(m:any)=>ws.send(JSON.stringify(m));
  send({type:'login',username:name,sessionToken:token});return{send,receive,ws};
}
try {
  let port=await boot();const a=await peer(port,'restart_a');const at=(await a.receive('login-success')).sessionToken;
  const b=await peer(port,'restart_b');const bt=(await b.receive('login-success')).sessionToken;
  a.send({type:'create-room',gameTime:5,private:true});const room=await a.receive('room-info');
  b.send({type:'join-room-accept',roomId:room.roomId});const start=await a.receive('game-started');await b.receive('game-started');
  const white=start.players.find((p:any)=>p.color==='W').username==='restart_a'?a:b;
  const move=generateLegalMoves(start.gameState.board,'W')[0];white.send({type:'make-move',move});await a.receive('move-made');await b.receive('move-made');
  await stop('SIGKILL');port=await boot();
  const thief=await peer(port,'restart_a','0'.repeat(32));assert.equal((await thief.receive('error')).code,'name-taken');
  const resumedA=await peer(port,'restart_a',at);await resumedA.receive('login-success');const restoredA=await resumedA.receive('room-rejoined');
  assert.equal(restoredA.gameCode,start.gameCode);assert.equal(restoredA.gameState.moveHistory.length,1);assert.equal(restoredA.clock.running,null);
  const resumedB=await peer(port,'restart_b',bt);await resumedB.receive('login-success');const restoredB=await resumedB.receive('room-rejoined');assert.equal(restoredB.gameState.turn,'B');
  const black=restoredA.yourColor==='B'?resumedA:resumedB;
  const next=generateLegalMoves(restoredB.gameState.board,'B')[0];black.send({type:'make-move',move:next});await resumedA.receive('move-made');await resumedB.receive('move-made');
  resumedA.send({type:'offer-draw'});await resumedB.receive('draw-offered');resumedB.send({type:'draw-response',accept:true});await resumedA.receive('game-ended');await resumedB.receive('game-ended');
  // A subsequent rematch must never recover the previous game's terminal result.
  resumedA.send({type:'rematch-request'});await resumedB.receive('rematch-requested');
  resumedB.send({type:'rematch-response',accept:true});
  const rematch=await resumedA.receive('game-started');await resumedB.receive('game-started');
  assert.notEqual(rematch.gameCode,start.gameCode);
  await stop('SIGKILL');port=await boot();
  const againA=await peer(port,'restart_a',at);await againA.receive('login-success');const active=await againA.receive('room-rejoined');
  assert.equal(active.phase,'playing');assert.equal(active.gameCode,rematch.gameCode);assert.equal(active.gameState.moveHistory.length,0);
  const againB=await peer(port,'restart_b',bt);await againB.receive('login-success');await againB.receive('room-rejoined');
  await stop('SIGTERM');
  assert.equal((await stat(path.join(directory,'live_rooms.json'))).mode&0o777,0o600);
  const saved=JSON.parse(await readFile(path.join(directory,'live_rooms.json'),'utf8'));assert.equal(JSON.parse(saved.payload).rooms[0].gameState.moveHistory.length,0);assert.equal(JSON.parse(saved.payload).rooms[0].terminalResult,undefined);
  console.log('PASS actual SIGKILL/restart: private room, resume authentication, paused clocks, canonical board/history, continuing moves, agreed draw, rematch SIGKILL/restart without stale terminal result, SIGTERM, protected file mode.');
} finally { if(child&&!child.killed)child.kill('SIGKILL');sockets.forEach(s=>s.terminate());await rm(directory,{recursive:true,force:true}); }
