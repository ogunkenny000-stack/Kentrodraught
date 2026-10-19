/**
 * Nigerian capture rules / native-engine parity regression.
 * Runs without npm-installed dependencies on Node 22+ and any C++14 compiler.
 * Both rules implementations must agree on every legal move, not just the
 * engine's selected move. No database/network services are accessed.
 *
 *   node --experimental-strip-types scripts/audit/nigerian-capture-parity.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  boardToScanFen, generateLegalMoves, hubMoveStringToNigerian,
  applyMove, createInitialBoard,
} from '../../src/gameLogic.ts';

const screenshot = {
  2: 'b', 3: 'b', 4: 'b', 8: 'b', 11: 'b', 12: 'b',
  20: 'w', 32: 'w', 37: 'w', 38: 'w', 41: 'w', 43: 'w',
  47: 'w', 48: 'w', 49: 'B',
};
const kingBranches = { 34: 'W', 1: 'b', 8: 'b', 28: 'b', 36: 'b' };
const check = (board, turn, description, predicate) => {
  const moves = generateLegalMoves(board, turn);
  assert(moves.length, `${description}: expected legal moves`);
  assert(predicate(moves), `${description}: illegal capture behavior: ${JSON.stringify(moves)}`);
};
check(screenshot, 'B', 'screenshot king forced continuation', ms =>
  ms.every(m => m.from === 49 && m.caps.length === 2 && m.caps[0] === 38) &&
  ms.some(m => m.path?.join(',') === '33,42' && m.caps.join(',') === '38,37') &&
  !ms.some(m => m.to === 16 || m.to === 22));
check(kingBranches, 'W', 'king landing branches', ms =>
  ms.length === 2 && ms.every(m => m.caps.length === 2) &&
  ms.some(m => m.caps.join(',') === '28,8') &&
  ms.some(m => m.caps.join(',') === '28,36'));
check({34:'W',1:'b',8:'b',28:'b',36:'b',39:'b'},'W', 'different king victims preserve free choice', ms =>
  ms.some(m => m.caps.length === 1 && m.caps[0] === 39) &&
  ms.some(m => m.caps.length === 2 && m.caps[0] === 28) &&
  !ms.some(m => m.caps.length === 1 && m.caps[0] === 28));
check({23:'w',28:'b'}, 'W', 'man backward capture', ms => ms.length === 1 && ms[0].to === 34 && ms[0].caps[0] === 28);
check({13:'w',7:'b',6:'b'}, 'W', 'man over-crown continuation', ms => ms.length === 1 && ms[0].to === 11 && ms[0].caps.length === 2 && applyMove({13:'w',7:'b',6:'b'},ms[0]).board[11] === 'w');
// Separate capture opportunities remain free-choice, not maximum count.
const cases = [
  {board:screenshot,turn:'B',name:'screenshot'},
  {board:kingBranches,turn:'W',name:'king landing choice'},
  {board:{34:'W',1:'b',8:'b',28:'b',36:'b',39:'b'},turn:'W',name:'different king victims, free choice'},
  {board:{23:'w',28:'b'},turn:'W',name:'backwards man'},
  {board:{13:'w',7:'b',6:'b'},turn:'W',name:'over-crown'},
  {board:createInitialBoard(),turn:'W',name:'opening'},
];
// Exact existing free-choice fixture: a 1-capture and a separate 3-capture.
// Use actual Nigerian square mapping from the TypeScript referee fixture instead.
import { ngRcToSq } from '../../src/gameLogic.ts';
const rc = (r,c) => {
  const s = ngRcToSq(r,c);
  assert(s !== null);
  return s;
};
const bChoice = {
  [rc(7,1)]: 'w', [rc(6,2)]: 'b', [rc(4,4)]: 'b',
  [rc(2,6)]: 'b', [rc(8,2)]: 'b', [rc(0,8)]: 'b',
};
check(bChoice, 'W', 'Nigerian free-choice across separate victims', ms =>
  ms.length === 2 && ms.some(m => m.caps.length === 1) && ms.some(m => m.caps.length === 3));
cases.push({board:bChoice,turn:'W',name:'different-victim free choice'});

let seed = 7321;
const random = () => {seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296;};
for(let i=0;i<150;i++) {
  const board={};
  for(let sq=1;sq<=50;sq++) {
    const v=random();
    board[sq]=v<0.06?'W':v<0.12?'w':v<0.22?'b':v<0.28?'B':null;
    if(sq<=5&&board[sq]==='w') board[sq]='W';
    if(sq>=46&&board[sq]==='b') board[sq]='B';
  }
  if(!Object.values(board).some(p=>p==='w'||p==='W') || !Object.values(board).some(p=>p==='b'||p==='B')) continue;
  cases.push({board,turn:'W',name:`random ${i} White`},{board,turn:'B',name:`random ${i} Black`});
}
const tdir=mkdtempSync(join(tmpdir(),'kentro-nigerian-rules-'));
const binary=join(tdir,'native-rules-probe');
try {
  const sources=['bit','common','fen','gen','list','move','pos','score','util','libmy','var'].map(n=>`nd_upgraded/${n}.cpp`);
  execFileSync(process.env.CXX || (process.platform==='darwin'?'clang++':'g++'), [
    '-std=c++14','-O1','-ffunction-sections','-fdata-sections',
    process.platform==='darwin'?'-Wl,-dead_strip':'-Wl,--gc-sections',
    '-I','nd_upgraded','scripts/native-rules-probe.cpp',...sources,'-o',binary
  ],{timeout:90000,stdio:'pipe'});
  const result=spawnSync(binary,{input:cases.map(({board,turn})=>boardToScanFen(board,turn)).join('\n')+'\n',encoding:'utf8',timeout:40000,maxBuffer:16*1024*1024});
  assert.equal(result.error,undefined, result.error?.message);
  assert.equal(result.status,0,result.stderr);
  const lines=result.stdout.trim().split('\n');
  assert.equal(lines.length,cases.length);
  const norm = m => `${m.from}/${m.to}/${[...m.caps].sort((a,b)=>a-b).join(',')}`;
  let checked=0;
  for(let i=0;i<cases.length;i++) {
    const [,,...moves]=lines[i].split(' ');
    const native=moves.map(s=>hubMoveStringToNigerian(s));
    assert(native.every(Boolean),`Unparseable C++ move in ${cases[i].name}`);
    const expected=generateLegalMoves(cases[i].board,cases[i].turn).map(norm).sort();
    const actual=native.map(norm).sort();
    assert.deepEqual(actual,expected,`C++/TypeScript legal move mismatch for ${cases[i].name}`);
    checked++;
  }
  console.log(`PASS: ${checked} exact move-list parity positions (C++ vs TypeScript), including screenshot, continuation, free choice and randomized positions.`);
} finally {rmSync(tdir,{recursive:true,force:true});}
