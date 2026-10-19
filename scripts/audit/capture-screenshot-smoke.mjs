/** Deterministic real-engine check for user's 49x38 screenshot position.
 * No authentication, Supabase connection, or dependency install required.
 * Run with Node 22+: node --experimental-strip-types scripts/audit/capture-screenshot-smoke.mjs
 * Compile once using npm run build:engine or node scripts/build-engine.cjs.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { boardToScanFen,generateLegalMoves,hubMoveStringToNigerian,movesAreEquivalent,applyMove } from '../../src/gameLogic.ts';
const board={2:'b',3:'b',4:'b',8:'b',11:'b',12:'b',20:'w',32:'w',37:'w',38:'w',41:'w',43:'w',47:'w',48:'w',49:'B'};
const expected=generateLegalMoves(board,'B');
assert(expected.length>0 && expected.every(m=>m.from===49 && m.caps[0]===38),'mandatory Black capture from 49 over 38');
const combo=expected.find(m=>m.to===42 && m.path?.[0]===33 && m.caps.join(',')==='38,37');
assert(combo,'the complete 49x38 land 33 x37 land 42 combination must exist');
assert(expected.every(m=>m.caps.length>=2),'King must not select a landing to dodge a possible follow-up after capturing the same victim');
const after=applyMove(board,combo).board;
assert(after[38]===null && after[37]===null && after[42]==='B','multi-capture must finish with both victims removed');
console.log('PASS: TypeScript referee identifies obligatory 49x38 and full two-capture continuation.');
const workDir=path.resolve('nd_upgraded');
const engine=spawn(path.join(workDir,'scan_nigerian'), ['hub'], {cwd:workDir,stdio:['pipe','pipe','pipe']});
let text='', errors='', started=false, sent=false, result=null;
const timer=setTimeout(()=>{engine.kill();console.error('FAIL: native engine timed out');process.exitCode=1;},18000);
engine.stderr.on('data',v=>{errors=(errors+v.toString()).slice(-2000);});
engine.stdout.on('data',chunk=>{
 text+=chunk.toString();const lines=text.split('\n');text=lines.pop()||'';
 for(const raw of lines){const line=raw.trim();
  if(line==='wait')engine.stdin.write('init\n');
  if(line==='ready'&&!sent){started=true;sent=true;engine.stdin.write(`pos pos="${boardToScanFen(board,'B')}"\nlevel depth=4 move-time=0.1\ngo think\n`);}
  if(/^done\b/.test(line)&&sent&&!result){result=line;engine.stdin.end('quit\n');}
  if(/^error\b/.test(line)) {errors=line;engine.kill();}
 }
});
engine.on('error',e=>{clearTimeout(timer);console.error('FAIL: Native engine cannot start:',e.message);process.exitCode=1;});
engine.on('close',(code)=>{
 clearTimeout(timer);
 if(!started||!result||code!==0){console.error('FAIL: Native engine search failed',errors,result,code);process.exitCode=1;return;}
 const match=result.match(/\bmove=(\S+)/);
 const parsed=match&&hubMoveStringToNigerian(match[1]);
 assert(parsed && expected.some(m=>movesAreEquivalent(m,parsed)),`Native move must be one of the complete compulsory captures, got ${match?.[1]||'none'}`);
 console.log(`PASS: Actual C++ AI respects compulsory capture in player's screenshot (${match[1]}).`);
});
engine.stdin.write('hub\n');
