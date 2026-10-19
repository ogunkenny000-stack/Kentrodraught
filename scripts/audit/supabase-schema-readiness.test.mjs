import {test} from 'node:test';
import assert from 'node:assert/strict';
import {REQUIRED_TABLES,REQUIRED_COLUMNS,REQUIRED_FUNCTIONS,REQUIRED_POLICIES,evaluateSchemaReadiness} from './supabase-schema-readiness.mjs';
const complete={
 tables:REQUIRED_TABLES.map(name=>({name,rls:true})),
 columns:Object.entries(REQUIRED_COLUMNS).flatMap(([table,cols])=>cols.map(column=>({table,column}))),
 functions:[...REQUIRED_FUNCTIONS],policies:REQUIRED_POLICIES.map(([table,name])=>({table,name})),
 privileged:[{name:'handle_new_user',anon:false,auth:false},{name:'resolve_username_to_email',anon:false,auth:false}],
};
test('hardened schema contract passes',()=>assert.equal(evaluateSchemaReadiness(complete).ready,true));
test('pre-upgrade schema reports missing objects instead of claiming readiness',()=>{
 const result=evaluateSchemaReadiness({tables:[{name:'profiles',rls:true},{name:'completed_games',rls:true}],columns:[],functions:[],policies:[]});
 assert.equal(result.ready,false);assert.ok(result.issues.some(i=>i.includes('kentro_groups')));
});
test('publicly executable definer RPCs block readiness',()=>{
 const result=evaluateSchemaReadiness({...complete,privileged:[{name:'resolve_username_to_email',anon:true,auth:true}]});
 assert.equal(result.ready,false);assert.ok(result.issues.some(i=>i.includes('PUBLIC_PRIVILEGED_RPC')));
});
test('legacy permissive match/tournament writes block readiness',()=>{
 const result=evaluateSchemaReadiness({...complete,policies:[...complete.policies,{table:'completed_games',name:'completed_games_write_authenticated'},{table:'tournaments',name:'tournaments_update_authenticated'}]});
 assert.equal(result.ready,false);assert.equal(result.issues.filter(i=>i.includes('LEGACY_BROAD_WRITE_POLICY')).length,2);
});
test('required missing RLS on exposed tables is a blocker',()=>{
 const result=evaluateSchemaReadiness({...complete,tables:complete.tables.map(t=>t.name==='kentro_groups'?{...t,rls:false}:t)});
 assert.equal(result.ready,false);assert.ok(result.issues.some(i=>i.includes('RLS_DISABLED')));
});
test('potentially callable tournament-admin function surfaces warning',()=>{
 const result=evaluateSchemaReadiness({...complete,privileged:[{name:'is_tournament_admin',anon:true,auth:true}]});
 assert.equal(result.ready,true);assert.equal(result.warnings.length,1);
});
