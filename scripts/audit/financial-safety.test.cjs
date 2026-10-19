const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
// CI installs TypeScript locally; allow the workspace-wide compiler for
// offline verification when node_modules is unavailable.
const ts = (() => {
  try { return require('typescript'); }
  catch { return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); }
})();
const root = path.resolve(__dirname,'../..');
function loadTypeScript(name, mocks) {
  const src = fs.readFileSync(path.join(root,name),'utf8');
  const js=ts.transpileModule(src,{fileName:name,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  vm.runInNewContext(js,{exports,require(spec){if(spec in mocks)return mocks[spec];throw new Error('Unexpected dependency '+spec)},process,console,Date,Number,Error,Set,Array,String},{filename:name});
  return exports;
}

test('disabled coin subsystem does not make a DB request',async()=>{
  const previous=process.env.KENTRO_COINS_ENABLED;
  process.env.KENTRO_COINS_ENABLED='0';
  try {
    const mod=loadTypeScript('src/server/coinInfrastructure.ts',{'../../supabaseAdmin':{getSupabaseAdmin(){throw new Error('DB queried while disabled')}}});
    const r=await mod.checkCoinInfrastructure();assert.equal(r.ok,false);
  }finally{if(previous===undefined)delete process.env.KENTRO_COINS_ENABLED;else process.env.KENTRO_COINS_ENABLED=previous;}
});
test('missing hosted readiness RPC fails closed',async()=>{
  const previous=process.env.KENTRO_COINS_ENABLED;
  process.env.KENTRO_COINS_ENABLED='1';
  try {
    const mod=loadTypeScript('src/server/coinInfrastructure.ts',{'../../supabaseAdmin':{getSupabaseAdmin(){return {rpc:async name=>({data:null,error:{code:'PGRST202'}})}}}});
    const r=await mod.checkCoinInfrastructure();assert.equal(r.ok,false);
  }finally{if(previous===undefined)delete process.env.KENTRO_COINS_ENABLED;else process.env.KENTRO_COINS_ENABLED=previous;}
});
test('complete hosted readiness RPC allows server activation',async()=>{
  const previous=process.env.KENTRO_COINS_ENABLED;
  process.env.KENTRO_COINS_ENABLED='1';
  try {
    const mod=loadTypeScript('src/server/coinInfrastructure.ts',{'../../supabaseAdmin':{getSupabaseAdmin(){return {rpc:async name=>({data:{ready:true},error:null})}}}});
    const r=await mod.checkCoinInfrastructure();assert.equal(r.ok,true);
  }finally{if(previous===undefined)delete process.env.KENTRO_COINS_ENABLED;else process.env.KENTRO_COINS_ENABLED=previous;}
});
test('paid match uses one atomic charge receipt RPC',async()=>{
  const calls=[];
  const mod=loadTypeScript('coinsService.ts',{'./supabaseAdmin':{getSupabaseAdmin(){return {rpc:async(name,args)=>{calls.push({name,args});return {data:{ok:true,alreadyCharged:false},error:null}}}}}});
  const result=await mod.debitMultipleWallets([' Alice ',' BOB '],10,'match_entry','game-123');
  assert.equal(result.ok,true);assert.deepEqual(calls.map(x=>x.name),['kentro_charge_match_pot']);
  assert.equal(calls[0].args.p_match_id,'game-123');
  assert.deepEqual(Array.from([calls[0].args.p_white,calls[0].args.p_black]),['alice','bob']);
});
test('paid match cannot charge without stable unique game ID',async()=>{
  let called=false;
  const mod=loadTypeScript('coinsService.ts',{'./supabaseAdmin':{getSupabaseAdmin(){called=true;throw Error('should not query')}}});
  await assert.rejects(()=>mod.debitMultipleWallets(['alice','bob'],10,'match_entry'),/stable game ID/);
  assert.equal(called,false);
});
test('insufficient money means failed all-or-none paid match',async()=>{
  const mod=loadTypeScript('coinsService.ts',{'./supabaseAdmin':{getSupabaseAdmin(){return {rpc:async()=>({data:{ok:false,insufficientUsers:['bob']},error:null})}}}});
  const result=await mod.debitMultipleWallets(['alice','bob'],10,'match_entry','game-456');
  assert.equal(result.ok,false);assert.deepEqual(Array.from(result.insufficientUsers),['bob']);
});
test('free match makes no database calls',async()=>{
  const mod=loadTypeScript('coinsService.ts',{'./supabaseAdmin':{getSupabaseAdmin(){throw Error('free should not query')}}});
  assert.deepEqual({...await mod.debitMultipleWallets(['alice','bob'],0,'match_entry')},{ok:true});
});
test('paid match charge uses White/Black colors, not room join order',()=>{
  const source=fs.readFileSync(path.join(root,'src/server/onlinePlay.ts'),'utf8');
  assert.match(source,/participants\.find\(\(p\) => p\.color === "W"\)/);
  assert.match(source,/participants\.find\(\(p\) => p\.color === "B"\)/);
  assert.match(source,/const usernames = \[whiteParticipant\.username, blackParticipant\.username\]/);
  assert.doesNotMatch(source,/const usernames = participants\.map\(\(p\) => p\.username\)/);
});
test('money migration defines charge receipt and explicit service-role access',()=>{
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261017_zz_coin_safety.sql'),'utf8');
  for(const contract of [
    /match_id text primary key/i,/pg_advisory_xact_lock/i,/kentro_charge_match_pot/i,
    /kentro_coin_readiness/i,/pg_catalog\.to_regprocedure/i,/enable row level security/i,
    /grant execute on function public\.kentro_charge_match_pot\(text,text,text,numeric\) to service_role/i,
    /kentro_match_settlements\(match_id,result\)/i
  ])assert.match(sql,contract);
});

test('database readiness requires profile authorization guards and nonpublic money RPCs',()=>{
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261017_zz_coin_safety.sql'),'utf8');
  const readiness=sql.slice(sql.indexOf('create or replace function public.kentro_coin_readiness'));
  assert.ok(readiness.includes('kentro_profile_guard'));
  assert.ok(readiness.includes('kentro_security_policy_backup'));
  for(const fn of ['kentro_unlock_ai','kentro_charge_match_pot','kentro_settle_match_pot','kentro_create_withdrawal','kentro_resolve_purchase','kentro_resolve_withdrawal']) {
    assert.ok(readiness.includes("not pg_catalog.has_function_privilege('anon', 'public."+fn+"("), fn+' anon execute exposed');
    assert.ok(readiness.includes("not pg_catalog.has_function_privilege('authenticated', 'public."+fn+"("), fn+' authenticated execute exposed');
  }
});

test('admin coin settings default to disabled on failed backend readiness',()=>{
  const src=fs.readFileSync(path.join(root,'src/AdminPanel.tsx'),'utf8');
  assert.match(src,/const \[coinsEnabled, setCoinsEnabled\] = useState<boolean>\(false\)/);
  assert.match(src,/setCoinsEnabled\(data\.coinsEnabled === true\)/);
  assert.match(src,/\.catch\(\(\) => \{[^}]*setCoinsEnabled\(false\)/s);
});

test('ambiguous match start uses a receipt-aware database refund',async()=>{
  const calls=[];
  const mod=loadTypeScript('coinsService.ts',{'./supabaseAdmin':{getSupabaseAdmin(){return {rpc:async(name,args)=>{calls.push({name,args});return {data:{ok:true,refunded:true},error:null}}}}}});
  const result=await mod.refundUnstartedMatch('round-4',' Alice ',' BOB ',10);
  assert.equal(result.refunded,true);
  assert.deepEqual(calls.map(x=>x.name),['kentro_refund_unstarted_match']);
  assert.equal(calls[0].args.p_white,'alice');
  assert.equal(calls[0].args.p_black,'bob');
});
test('a cancelled paid room cannot re-use a refunded charge receipt',()=>{
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261017_zz_coin_safety.sql'),'utf8');
  assert.match(sql,/Match payment already settled; a new game must use a new ID/);
  assert.match(sql,/create or replace function public.kentro_refund_unstarted_match/);
  assert.match(sql,/pg_advisory_xact_lock\(pg_catalog.hashtextextended\('kentro-settlement:'/);
  const code=fs.readFileSync(path.join(root,'src/server/onlinePlay.ts'),'utf8');
  assert.match(code,/refundInterruptedStart\(gameCode, usernames\[0\], usernames\[1\], entryFee/);
  assert.match(code,/refundInterruptedStart\(gameCode, white.username, black.username, room.entryFeePerPlayer/);
  assert.match(code,/deleteRoom\(room\); \/\/ never recycle a paid\/refunded match receipt/);
});

test('live finance installer is transaction-bound, narrowly scoped and does not erase ledgers',()=>{
  const sql=fs.readFileSync(path.join(root,'supabase/manual_live_finance_20261017.sql'),'utf8');
  assert.match(sql,/^BEGIN;/m);
  assert.match(sql,/^COMMIT;/m);
  assert.equal((sql.match(/^COMMIT;/gm)||[]).length,1);
  assert.match(sql,/SET LOCAL lock_timeout/);
  assert.match(sql,/SET LOCAL statement_timeout/);
  assert.match(sql,/kentro_security_policy_backup/);
  assert.match(sql,/kentro_profile_guard/);
  assert.match(sql,/Coin readiness did not pass, rolling back the entire upgrade/);
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''),/\b(?:TRUNCATE|DROP TABLE|DELETE FROM (?:public\.)?coin_wallets|DELETE FROM (?:public\.)?coin_transactions)\b/i);
  assert.doesNotMatch(sql,/create or replace function public\.kentro_tournament_chat/i);
});

test('coin readiness rejects obsolete broad tournament and official-game insert policies',()=>{
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261017_zz_coin_safety.sql'),'utf8');
  assert.match(sql,/policyname in \('tournaments_write_authenticated'/);
  assert.match(sql,/policyname='completed_games_write_authenticated'/);
  const installer=fs.readFileSync(path.join(root,'supabase/manual_live_finance_20261017.sql'),'utf8');
  assert.match(installer,/drop policy if exists tournaments_update_authenticated/i);
  assert.match(installer,/drop policy if exists completed_games_write_authenticated/i);
});

test('financial synthetic probe rolls back wallet entries and checks repeat charges',()=>{
  const sql=fs.readFileSync(path.join(root,'supabase/verify_finance_no_commit_20261017.sql'),'utf8');
  assert.match(sql,/KENTRO_PROBE_INTENTIONAL_ROLLBACK/);
  assert.match(sql,/Probe data survived rollback/);
  assert.match(sql,/Duplicate charge was not deduplicated/);
  assert.match(sql,/Second refund not deduplicated/);
});
