/** Loopback-only guest multiplayer benchmark against an already running local server.
 * BENCH_URL=ws://127.0.0.1:8126 BENCH_CLIENTS=2,10,25,50,100 npx tsx scripts/ws-bench.ts
 * Optional BENCH_SERVER_PID reports Linux process RSS and CPU (CLK_TCK=100).
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import WebSocket from 'ws';
import { generateLegalMoves, applyMove, type Board } from '../src/gameLogic';
const target = new URL(process.env.BENCH_URL || 'ws://127.0.0.1:8126');
assert(target.protocol === 'ws:' && ['127.0.0.1','localhost','[::1]'].includes(target.hostname)
  && target.pathname === '/' && !target.username && !target.password && !target.search, 'Only loopback test servers are permitted');
const counts = (process.env.BENCH_CLIENTS || '2,10,25,50,100').split(',').map(Number);
assert(counts.every(n => Number.isInteger(n) && n >= 2 && n <= 100), 'Client counts must be integers 2..100');
type Msg = any;
const sleep = (ms:number) => new Promise(r => setTimeout(r,ms));
function summary(values:number[]) {
  assert(values.length, 'No observations collected');
  const sorted = [...values].sort((a,b)=>a-b);
  const p = (q:number) => Number(sorted[Math.max(0,Math.ceil(sorted.length*q)-1)].toFixed(3));
  return {samples:values.length,p50:p(.5),p95:p(.95),max:Number(sorted.at(-1)!.toFixed(3))};
}
class Client {
  name = `KGuest_${randomBytes(10).toString('hex')}`;
  ws = new WebSocket(target.toString(), {handshakeTimeout:5000});
  inbox:Msg[]=[];
  waiters:{match:(m:Msg)=>boolean;resolve:(m:Msg)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}[]=[];
  failure:Error|null=null;
  constructor() {
    this.ws.on('error',error=>this.fail(error));
    this.ws.on('close',()=>this.fail(new Error('WebSocket closed')));
    this.ws.on('message',raw=>{
      let message:Msg;
      try {message=JSON.parse(String(raw));} catch {this.fail(new Error('Invalid server JSON'));return;}
      message.__bytes=Buffer.byteLength(String(raw));
      if (message.type==='error'||message.type==='room-error') {this.fail(new Error(`Protocol error: ${message.code||message.error||message.message}`));return;}
      const index=this.waiters.findIndex(w=>w.match(message));
      if(index>=0) {const [w]=this.waiters.splice(index,1);clearTimeout(w.timer);w.resolve(message);}
      else {this.inbox.push(message);if(this.inbox.length>100)this.inbox.shift();}
    });
  }
  fail(error:Error) {this.failure||=error;for(const w of this.waiters.splice(0)){clearTimeout(w.timer);w.reject(error);}}
  wait(match:(m:Msg)=>boolean,timeout=8000):Promise<Msg> {
    if(this.failure)return Promise.reject(this.failure);
    const index=this.inbox.findIndex(match);if(index>=0)return Promise.resolve(this.inbox.splice(index,1)[0]);
    return new Promise((resolve,reject)=>{
      const waiter={match,resolve,reject,timer:setTimeout(()=>{
        const i=this.waiters.indexOf(waiter);if(i>=0)this.waiters.splice(i,1);reject(new Error('Timed out waiting for server reply'));
      },timeout)};this.waiters.push(waiter);
    });
  }
  send(message:Msg){this.ws.send(JSON.stringify(message));}
  async login(){
    if(this.ws.readyState!==WebSocket.OPEN)await new Promise<void>((resolve,reject)=>{this.ws.once('open',resolve);this.ws.once('error',reject);});
    const reply=this.wait(m=>m.type==='login-success');this.send({type:'login',username:this.name});
    assert.match((await reply).sessionToken,/^[0-9a-f]{32}$/);
  }
  async close(){
    if(this.ws.readyState===WebSocket.CLOSED)return;
    await new Promise<void>(resolve=>{
      const timer=setTimeout(()=>{this.ws.terminate();resolve();},500);
      this.ws.once('close',()=>{clearTimeout(timer);resolve();});this.ws.close();
    });
  }
}
function processSample(){
  const pid=process.env.BENCH_SERVER_PID;if(!pid||!/^\d+$/.test(pid))return null;
  const status=fs.readFileSync(`/proc/${pid}/status`,'utf8');
  const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1].split(' ');
  return {rssKiB:Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]),ticks:Number(stat[11])+Number(stat[12])};
}
async function runStage(count:number){
  const clients:Client[]=[];const started=performance.now();const before=processSample();
  const roomSetup:number[]=[],moves:number[]=[],pings:number[]=[],sizes:number[]=[];
  try{
    for(let i=0;i<count;i++){const c=new Client();clients.push(c);await c.login();}
    const rooms=await Promise.all(Array.from({length:Math.floor(count/2)},async(_,i)=>{
      const a=clients[i*2],b=clients[i*2+1],start=performance.now();
      const infoP=a.wait(m=>m.type==='room-info');a.send({type:'create-room',gameTime:5,bestOf:1,specialRule:'none',wagerAmount:0});const info=await infoP;
      const previewP=b.wait(m=>m.type==='room-preview');b.send({type:'join-room',roomId:info.roomId});await previewP;
      const startA=a.wait(m=>m.type==='game-started'),startB=b.wait(m=>m.type==='game-started');
      b.send({type:'join-room-accept',roomId:info.roomId});const [game]=await Promise.all([startA,startB]);
      roomSetup.push(performance.now()-start);const color=info.players.find((p:Msg)=>p.username===a.name)?.color;assert(color==='W'||color==='B');
      return {a,b,color,board:game.gameState.board as Board,turn:game.gameState.turn as 'W'|'B',seq:0};
    }));
    for(let round=0;round<12;round++){
      await Promise.all(rooms.map(async room=>{
        const legal=generateLegalMoves(room.board,room.turn);assert(legal.length>0,'Game ended before benchmark move budget');
        const waitA=room.a.wait(m=>m.type==='move-made'&&m.seq>room.seq),waitB=room.b.wait(m=>m.type==='move-made'&&m.seq>room.seq);
        const start=performance.now();(room.turn===room.color?room.a:room.b).send({type:'make-move',move:legal[round%legal.length]});
        const [a,b]=await Promise.all([waitA,waitB]);assert.deepEqual(a.move,b.move);assert.equal(a.seq,b.seq);assert.equal(a.turn,b.turn);
        moves.push(performance.now()-start);sizes.push(a.__bytes);room.board=applyMove(room.board,a.move).board;room.turn=a.turn;room.seq=a.seq;
      }));await sleep(25);
    }
    for(let round=0;round<10;round++){
      await Promise.all(clients.map(async(c,i)=>{
        const nonce=round*count+i,reply=c.wait(m=>m.type==='pong'&&m.t===nonce),start=performance.now();c.send({type:'ping',t:nonce});await reply;pings.push(performance.now()-start);
      }));await sleep(25);
    }
    const after=processSample(),elapsedMs=performance.now()-started;
    const result={clients:count,rooms:rooms.length,elapsedMs:Number(elapsedMs.toFixed(1)),roomSetupMs:summary(roomSetup),moveRelayMs:summary(moves),pingMs:summary(pings),deltaBytes:summary(sizes),
      nodeRssMiB:after?Number((after.rssKiB/1024).toFixed(1)):null,
      nodeCpuOneCorePercent:before&&after?Number(((after.ticks-before.ticks)/elapsedMs*1000).toFixed(1)):null,failures:0};
    await Promise.all(clients.map(async c=>{const reply=c.wait(m=>m.type==='left-room-success');c.send({type:'leave-room'});await reply;}));
    console.log(JSON.stringify(result));
  }finally{await Promise.all(clients.map(c=>c.close()));}
}
async function main(){for(const count of counts){await runStage(count);await sleep(250);}}
main().catch(error=>{console.error(error);process.exitCode=1;});
