/** OPT-IN disposable staging integration. Never invoked by the local suite/CI.
 * Needs two already-confirmed test accounts, never production users. Tokens
 * belong in environment settings, never in chat, source or committed reports. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const names=['SUPABASE_STAGING_TEST_URL','SUPABASE_STAGING_PUBLISHABLE_KEY','SUPABASE_STAGING_ALICE_TOKEN','SUPABASE_STAGING_BOB_TOKEN','SUPABASE_STAGING_EXPECTED_REF'];
if(process.env.SUPABASE_STAGING_TEST_CONFIRM!=='disposable-staging'||names.some(n=>!process.env[n])){
 console.log('PENDING: hosted Supabase integration was not executed. Configure explicit disposable staging bindings and confirmation first.');process.exit(2);
}
const url=new URL(process.env.SUPABASE_STAGING_TEST_URL);
assert.equal(url.protocol,'https:');assert.equal(url.hostname,process.env.SUPABASE_STAGING_EXPECTED_REF+'.supabase.co');
const client=(token)=>createClient(url.toString(),process.env.SUPABASE_STAGING_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:token?{headers:{Authorization:'Bearer '+token}}:undefined});
const alice=client(process.env.SUPABASE_STAGING_ALICE_TOKEN),bob=client(process.env.SUPABASE_STAGING_BOB_TOKEN),anon=client();
let groupId;let passed=0;
async function checked(label,fn){await fn();passed++;console.log('PASS '+label);}
async function rpc(db,fn,args){const{data,error}=await db.rpc(fn,args);if(error)throw new Error('Staging RPC failed: '+fn+' ('+String(error.code||'unknown')+')');return data;}
try{
 const au=await alice.auth.getUser(process.env.SUPABASE_STAGING_ALICE_TOKEN),bu=await bob.auth.getUser(process.env.SUPABASE_STAGING_BOB_TOKEN);assert.ifError(au.error);assert.ifError(bu.error);assert.ok(au.data.user&&bu.data.user);assert.notEqual(au.data.user.id,bu.data.user.id);
 let bobName;
 await checked('genuine Auth validates two separate canonical test profiles',async()=>{
  const a=await alice.from('profiles').select('username,ownerId').eq('ownerId',au.data.user.id).single(),b=await bob.from('profiles').select('username,ownerId').eq('ownerId',bu.data.user.id).single();assert.ifError(a.error);assert.ifError(b.error);bobName=b.data.username;
 });
 await checked('anonymous role cannot mutate groups or execute tournament authority',async()=>{
  const g=await anon.rpc('kentro_group_action',{p_group:null,p_action:'create',p_data:{name:'must fail'}}),t=await alice.rpc('kentro_commit_tournament',{p_id:'must-fail',p_version:0,p_next:{}});assert.ok(g.error);assert.ok(t.error);
 });
 await checked('group creation is durable and retry identity is idempotent',async()=>{
  groupId=randomUUID();const args={p_group:groupId,p_action:'create',p_data:{name:'Disposable staging '+groupId.slice(0,8)}};const first=await rpc(alice,'kentro_group_action',args),again=await rpc(alice,'kentro_group_action',args);assert.equal(first.id,again.id);
 });
 await checked('outsider cannot read group or messages before recipient consent',async()=>{
  const{data,error}=await bob.from('kentro_groups').select('id').eq('id',groupId);assert.ifError(error);assert.equal(data.length,0);
  await rpc(alice,'kentro_group_action',{p_group:groupId,p_action:'invite',p_data:{username:bobName}});
  const rejected=await bob.rpc('kentro_group_action',{p_group:groupId,p_action:'send',p_data:{text:'must fail'}});assert.ok(rejected.error);
  await rpc(bob,'kentro_group_action',{p_group:groupId,p_action:'accept',p_data:{}});
 });
 await checked('real PostgREST RPC sends canonical messages and binds retry identity',async()=>{
  const id=randomUUID(),args={p_group:groupId,p_action:'send',p_data:{id,text:'Disposable staging message'}};await rpc(bob,'kentro_group_action',args);await rpc(bob,'kentro_group_action',args);
  const feed=await rpc(alice,'kentro_group_feed',{p_group:groupId});assert.equal(feed.length,1);assert.equal(feed[0].sender,bobName);
 });
 await checked('membership removal revokes hosted reads',async()=>{
  await rpc(alice,'kentro_group_action',{p_group:groupId,p_action:'remove',p_data:{username:bobName}});assert.deepEqual(await rpc(bob,'kentro_group_feed',{p_group:groupId}),[]);
 });
 console.log(passed+' hosted staging checks passed. Email, Realtime transport, live tournament UI/worker, wallets and device media require the separate acceptance runbook.');
}finally{
 if(groupId){const cleanup=await alice.rpc('kentro_group_action',{p_group:groupId,p_action:'delete',p_data:{}});if(cleanup.error)throw new Error('Staging cleanup failed; remove the disposable test group through its owner.');}
}
