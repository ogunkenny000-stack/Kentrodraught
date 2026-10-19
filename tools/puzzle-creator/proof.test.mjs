import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {canonicalPuzzleFen,equivalentFen,provePuzzle,puzzleContentKey,verifyCertificate,PuzzleBudgetExceeded} from './proof.ts';
import {generateLegalMoves,scanFenToBoard,applyMove} from '../../src/gameLogic.ts';
const fen='Weeeeeeeeeweeebeeeeweeeeeeeeeeeeeeeeebeweeeeeeeeeee';
test('sacrifice and complete multiple capture are proven against all defenses',()=>{
 const p=provePuzzle(fen,{deadline:Date.now()+10000,maxNodes:100000});assert.ok(p);assert.equal(p.difficulty,'Easy');assert.equal(p.maxPlies,3);assert.equal(p.line[0].caps.length,0);assert.ok(p.line.at(-1).caps.length>=2);assert.ok(verifyCertificate(p)>3);
 const bad=structuredClone(p);bad.certificate.edges[0].next.edges=[];assert.throws(()=>verifyCertificate(bad),/Unfinished/);
 const illegal=structuredClone(p);illegal.certificate.edges[0].next.edges[0].next.edges[0].move.caps.pop();assert.throws(()=>verifyCertificate(illegal),/Illegal/);
});
test('rotation and colour swap share a position identity, involutively',()=>{assert.equal(equivalentFen(equivalentFen(fen)),fen);assert.equal(puzzleContentKey(fen),puzzleContentKey(equivalentFen(fen)));const a=scanFenToBoard(fen),b=scanFenToBoard(equivalentFen(fen));const children=generateLegalMoves(a.board,a.turn).map(m=>puzzleContentKeyForChild(applyMove(a.board,m).board,a.turn==='W'?'B':'W'));const rotatedChildren=generateLegalMoves(b.board,b.turn).map(m=>puzzleContentKeyForChild(applyMove(b.board,m).board,b.turn==='W'?'B':'W'));assert.deepEqual(children.sort(),rotatedChildren.sort());});
import {boardToScanFen} from '../../src/gameLogic.ts';
function puzzleContentKeyForChild(board,turn){return puzzleContentKey(boardToScanFen(board,turn));}
test('budget exhaustion and malformed positions never become accepted puzzles',()=>{assert.throws(()=>provePuzzle(fen,{maxNodes:1}),PuzzleBudgetExceeded);assert.throws(()=>canonicalPuzzleFen('W'+'e'.repeat(50)));assert.throws(()=>canonicalPuzzleFen(fen.slice(0,-1)+'?'));});
test('standalone SQLite import is idempotent across restarts and colour rotations',()=>{
 const dir=mkdtempSync(join(tmpdir(),'kentro-puzzles-'));try{const db=join(dir,'puzzles.sqlite'),file=join(dir,'puzzles.json');const p=provePuzzle(fen,{deadline:Date.now()+10000});writeFileSync(file,JSON.stringify([{proof:p}]));
 const run=(args)=>{const r=spawnSync(process.execPath,['tools/puzzle-creator/bin/kentro-puzzles.cjs',...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 assert.equal(run(['import','--db',db,'--file',file]).verified,1);assert.equal(run(['import','--db',db,'--file',file]).duplicates,1);
 const rotated=provePuzzle(equivalentFen(fen),{deadline:Date.now()+10000});assert.ok(rotated);writeFileSync(file,JSON.stringify([{proof:rotated}]));assert.equal(run(['import','--db',db,'--file',file]).duplicates,1);
 run(['export','--db',db,'--out',file]);assert.equal(JSON.parse(readFileSync(file,'utf8')).length,1);assert.equal(run(['verify','--file',file]).verified,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('all published samples reprove their difficulty including the double-sacrifice hard puzzle',()=>{
 const examples=JSON.parse(readFileSync(new URL('./examples.json',import.meta.url),'utf8'));
 assert.ok(examples.some(p=>p.difficulty==='Hard'));
 for(const item of examples){const p=provePuzzle(item.fen,{deadline:Date.now()+30000,maxNodes:1000000});assert.ok(p);assert.equal(p.difficulty,item.difficulty);assert.equal(p.maxPlies,item.proof.maxPlies);verifyCertificate(p);}
});
test('concurrent independent processes cannot publish the same position twice',async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const exec=promisify(execFile);const dir=mkdtempSync(join(tmpdir(),'kentro-concurrent-'));
 try{const file=join(dir,'input.json'),db=join(dir,'puzzles.sqlite');writeFileSync(file,JSON.stringify([{proof:provePuzzle(fen,{deadline:Date.now()+10000})}]));const args=['tools/puzzle-creator/bin/kentro-puzzles.cjs','import','--db',db,'--file',file];const results=await Promise.all([exec(process.execPath,args),exec(process.execPath,args)]);assert.equal(results.reduce((n,r)=>n+JSON.parse(r.stdout).verified,0),1);assert.equal(results.reduce((n,r)=>n+JSON.parse(r.stdout).duplicates,0),1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a proof cannot omit just one of several free-choice defenses',()=>{
 const examples=JSON.parse(readFileSync(new URL('./examples.json',import.meta.url),'utf8'));const p=structuredClone(examples.find(p=>p.difficulty==='Hard').proof);let removed=false;const prune=(tree,ply)=>{if(!removed&&ply%2===1&&tree.edges.length>1){tree.edges.pop();removed=true;return;}for(const edge of tree.edges)prune(edge.next,ply+1);};prune(p.certificate,0);assert.ok(removed);assert.throws(()=>verifyCertificate(p),/Missing defensive reply/);
});
