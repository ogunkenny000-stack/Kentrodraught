import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
const root=process.cwd();
const src=fs.readFileSync('src/server/kenVictoryProof.ts','utf8');
const code=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exported={};
const mockRules={createInitialBoard:()=>({}),checkGameEnd:()=>({isOver:false,isDraw:false,winner:null}),generateLegalMoves:()=>[],boardToScanFen:()=>'',moveToHubString:()=>'',applyMove:()=>({board:{}})};
vm.runInNewContext(code,{exports:exported,require(spec){if(spec==='node:crypto')return {createHmac,timingSafeEqual};if(spec==='../gameLogic')return mockRules;throw Error(spec)},Buffer,Date,JSON,Number,String,Array,Error,RegExp});
const data={ownerId:'testuser',gameId:'cf668a14-82e5-4a65-ad0e-1f84742c3912',level:3,fen:'W'+'e'.repeat(50),move:'32-28'};
const secret='unit-test-secret-must-be-at-least-32-bytes-long';
test('server-only AI proof verifies only the exact binding',()=>{
 const proof=exported.signKenReply(data,secret);
 assert.equal(exported.verifyKenReply(data,proof,secret),true);
 assert.equal(exported.verifyKenReply({...data,level:4},proof,secret),false);
 assert.equal(exported.verifyKenReply({...data,gameId:'cf668a14-82e5-4a65-ad0e-1f84742c3913'},proof,secret),false);
 assert.equal(exported.verifyKenReply({...data,fen:'B'+'e'.repeat(50)},proof,secret),false);
});
test('expired and unsigned Ken moves are rejected',()=>{
 const old=exported.signKenReply(data,secret,Date.now()-4*86400000);
 assert.equal(exported.verifyKenReply(data,old,secret),false);
 assert.equal(exported.verifyKenReply(data,'made-up',secret),false);
 assert.equal(exported.verifyKenVictory({...data,mode:'Human_vs_AI',moves:[]},secret).ok,false);
});
test('source uses persisted one-time claim and denies public RPC access',()=>{
 const sql=fs.readFileSync('supabase/migrations/20261017_ken_verified_progression.sql','utf8');
 assert.match(sql,/primary key\(owner_id,game_id\)/);
 assert.match(sql,/kentro_claim_ken_victory/);
 assert.match(sql,/from public,anon,authenticated/);
 assert.match(sql,/kentro_lock_ken_entitlement_trigger/);
 const app=fs.readFileSync('src/App.tsx','utf8');
 assert.match(app,/\/api\/ken\/claim-win/);
 assert.match(app,/kenProgressionGameIdRef/);
});
