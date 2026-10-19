import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectSupabaseConfig } from './supabase-config-preflight.mjs';
const valid = { VITE_SUPABASE_URL:'https://example.supabase.co', SUPABASE_URL:'https://example.supabase.co/', VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fake', SUPABASE_SECRET_KEY:'sb_secret_fake', SKIP_DB_MIGRATION:'1', NODE_ENV:'production', APP_URL:'https://game.example.org' };
test('accepts aligned server and browser config without contacting the database', () => assert.equal(inspectSupabaseConfig(valid).ok, true));
test('rejects cross-project credentials', () => assert.equal(inspectSupabaseConfig({...valid,SUPABASE_URL:'https://other.supabase.co'}).ok,false));
test('rejects secret exposed as public frontend key', () => assert.equal(inspectSupabaseConfig({...valid,VITE_SUPABASE_PUBLISHABLE_KEY:'sb_secret_fake'}).ok,false));
test('requires disabled runtime migrations', () => assert.equal(inspectSupabaseConfig({...valid,SKIP_DB_MIGRATION:'0'}).ok,false));
test('requires real HTTPS production APP_URL', () => assert.equal(inspectSupabaseConfig({...valid,APP_URL:'http://localhost:5173'}).ok,false));

test('rejects legacy service-role JWT in browser variables', () => {
 const jwt='a.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.sig';
 assert.equal(inspectSupabaseConfig({...valid,VITE_SUPABASE_PUBLISHABLE_KEY:jwt}).ok,false);
});
test('rejects a publishable/anon key used as the server secret',()=> assert.equal(inspectSupabaseConfig({...valid,SUPABASE_SECRET_KEY:'sb_publishable_wrong'}).ok,false));
test('rejects an anon legacy JWT used as a server secret',()=> {
 const jwt='a.'+Buffer.from(JSON.stringify({role:'anon'})).toString('base64url')+'.sig';
 assert.equal(inspectSupabaseConfig({...valid,SUPABASE_SECRET_KEY:jwt}).ok,false);
});
