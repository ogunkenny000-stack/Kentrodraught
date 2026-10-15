/** Disposable PostgreSQL regressions. No network or live Supabase connection. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261014_security_hardening.sql', import.meta.url), 'utf8');
const beginMarker = '-- BEGIN 20261014 SECURITY HARDENING (keep identical to the migration)\n';
const endMarker = '-- END 20261014 SECURITY HARDENING';
assert.equal(schema.split(beginMarker)[1].split(endMarker)[0], migration, 'Fresh schema must embed the exact forward migration');
const ids = {
  alice: '10000000-0000-4000-8000-000000000001',
  bob: '10000000-0000-4000-8000-000000000002',
  mallory: '10000000-0000-4000-8000-000000000003',
  admin: '10000000-0000-4000-8000-000000000004',
};
const withdrawalId = '20000000-0000-4000-8000-000000000001';
const purchaseId = '30000000-0000-4000-8000-000000000001';
let passed = 0;
const db = new PGlite();
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${passed} - ${name}`); };
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const scalar = async (sql, params = []) => Object.values(await one(sql, params))[0];
const as = async (role, uid, fn) => {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || '']);
  try { return await fn(); }
  finally { await db.exec('reset role'); await db.exec("reset request.jwt.claim.sub"); }
};
const rpc = (sql, params) => as('service_role', null, () => scalar(sql, params));
const balance = () => scalar('select balance::float from coin_wallets where username = $1', ['alice']);
const withdraw = (id = withdrawalId, coins = 100) => rpc('select submit_withdrawal($1,$2,$3,200,$4,$5,$6)', [ids.alice, id, coins, 'Alice Account', '0123456789', 'Test Bank']);
const resolveWithdrawal = (approve = false) => rpc('select resolve_withdrawal($1,$2,$3)', [withdrawalId, approve, ids.admin]);
const resolvePurchase = (approve = true) => rpc('select resolve_purchase($1,$2,$3,$4,$5)', [purchaseId, approve, approve ? 250 : 0, 'small', ids.admin]);
const reject = async (fn, pattern = /./) => assert.rejects(fn, pattern);

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create publication supabase_realtime;
  `);
  // PGlite includes core gen_random_uuid(), but does not package pgcrypto.
  // Everything else, including roles, RLS, triggers and RPC bodies, runs intact.
  await db.exec(schema.replace('create extension if not exists "pgcrypto";', '-- pgcrypto supplied by Supabase; core gen_random_uuid is available here'));
  await db.exec('grant all on all tables in schema public to anon, authenticated, service_role');
  for (const [name, id] of Object.entries(ids)) {
    await db.query('insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,$3)', [id, `${name}@example.invalid`, { username: name }]);
  }
  await db.query('insert into admins (username,uid,permissions) values ($1,$2,$3)', ['admin', ids.admin, ['manage_payments', 'manage_tournaments']]);
  await db.query('insert into coin_wallets (username,balance,"ownerId") values ($1,1000,$2)', ['alice', ids.alice]);
  await test('Fresh schema executes and signup creates the profile with Auth ownership', async () => {
    assert.equal(await scalar('select "ownerId" from profiles where "usernameLower" = $1', ['alice']), ids.alice);
  });
  await test('Signup username collision aborts the Auth insert', async () => {
    await reject(() => db.query('insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,$3)', ['10000000-0000-4000-8000-000000000005', 'duplicate@example.invalid', { username: 'ALICE' }]));
    assert.equal(await scalar('select count(*)::int from auth.users'), 4);
  });
  await test('The house wallet identity cannot be registered', async () => {
    await reject(() => db.query('insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,$3)', ['10000000-0000-4000-8000-000000000005', 'house@example.invalid', { username: 'kentro_house' }]), /reserved/);
  });
  await test('Anonymous users can read public profiles, but cannot enumerate emails', async () => {
    assert.equal(await as('anon', null, () => scalar('select count(*)::int from profiles')), 4);
    await reject(() => as('anon', null, () => db.query("select resolve_username_to_email('alice')")), /permission denied/);
    await reject(() => as('authenticated', ids.alice, () => db.query("select resolve_username_to_email('bob')")), /permission denied/);
  });
  await test('Client cannot insert forged profile defaults', async () => {
    await reject(() => as('authenticated', ids.alice, () => db.query('insert into profiles ("usernameLower",username,"ownerId",elo) values ($1,$1,$2,9999)', ['forged', ids.alice])), /row-level security/);
  });
  await test('Owner can update avatar, but cannot alter stats, unlocks or identity', async () => {
    await as('authenticated', ids.alice, () => db.query('update profiles set "avatarUrl" = $1 where "ownerId" = $2', ['/avatar.png', ids.alice]));
    for (const setClause of ['elo = 9999', '"maxUnlockedKenLevel" = 8', 'banned = true', '"usernameLower" = \'admin\'', '"ownerId" = null']) {
      await reject(() => as('authenticated', ids.alice, () => db.exec(`update profiles set ${setClause} where "usernameLower" = 'alice'`)), /server managed/);
    }
    assert.equal(await scalar('select elo::float from profiles where "usernameLower" = $1', ['alice']), 1500);
  });
  await test('A different account cannot mutate the profile', async () => {
    const r = await as('authenticated', ids.mallory, () => db.query("update profiles set \"avatarUrl\" = 'evil' where \"usernameLower\" = 'alice' returning *"));
    assert.equal(r.rows.length, 0);
  });
  await test('Friends derive immutable owner ids and prevent sender impersonation', async () => {
    await reject(() => as('authenticated', ids.mallory, () => db.exec("insert into friends(id,user1,user2,sender) values ('bad','alice','bob','alice')")), /identity/);
    await reject(() => as('authenticated', ids.alice, () => db.exec("insert into friends(id,user1,user2,sender,status) values ('bad','alice','bob','alice','accepted')")), /identity/);
    await as('authenticated', ids.alice, () => db.exec("insert into friends(id,user1,user2,sender) values ('alice_bob','alice','bob','alice')"));
    assert.equal(await scalar("select \"user2OwnerId\" from friends where id='alice_bob'"), ids.bob);
    assert.equal(await as('authenticated', ids.mallory, () => scalar('select count(*)::int from friends')), 0);
  });
  await test('Only the friend request recipient can accept an unchanged request', async () => {
    await reject(() => as('authenticated', ids.alice, () => db.exec("update friends set status='accepted' where id='alice_bob'")), /recipient/);
    await reject(() => as('authenticated', ids.bob, () => db.exec("update friends set status='accepted',user1='mallory' where id='alice_bob'")), /unchanged/);
    await as('authenticated', ids.bob, () => db.exec("update friends set status='accepted' where id='alice_bob'"));
    assert.equal(await scalar("select status from friends where id='alice_bob'"), 'accepted');
  });
  await test('DM recipients cannot impersonate senders or substitute participant ids', async () => {
    await reject(() => as('authenticated', ids.bob, () => db.exec("insert into private_messages(\"chatId\",sender,recipient,text) values ('alice_bob','alice','bob','spoof')")), /identity/);
    await reject(() => as('authenticated', ids.alice, () => db.query('insert into private_messages("chatId",sender,recipient,"recipientOwnerId",text) values ($1,$2,$3,$4,$5)', ['alice_bob','alice','bob',ids.mallory,'spoof'])), /identity/);
    await as('authenticated', ids.alice, () => db.exec("insert into private_messages(\"chatId\",sender,recipient,text) values ('alice_bob','alice','bob','hello')"));
    assert.equal(await as('authenticated', ids.bob, () => scalar('select count(*)::int from private_messages')), 1);
    assert.equal(await as('authenticated', ids.mallory, () => scalar('select count(*)::int from private_messages')), 0);
  });
  await test('DM reaction updates cannot rewrite identity or content', async () => {
    await as('authenticated', ids.bob, () => db.exec("update private_messages set reactions='{\"like\":1}'"));
    await reject(() => as('authenticated', ids.bob, () => db.exec("update private_messages set text='forged'")), /immutable/);
    await reject(() => as('authenticated', ids.alice, () => db.query('update private_messages set "recipientOwnerId"=$1', [ids.mallory])), /immutable/);
  });
  await test('Client tournament writes cannot forge rosters, results, money or creation', async () => {
    await db.exec("insert into tournaments(id,status,\"maxPlayers\") values ('test','registration',2)");
    for (const uid of [ids.alice, ids.admin]) {
      const r = await as('authenticated', uid, () => db.query("update tournaments set players='[{\"username\":\"mallory\"}]',\"prizePool\"=999 returning id"));
      assert.equal(r.rows.length, 0);
    }
    await reject(() => as('authenticated', ids.alice, () => db.exec("insert into tournaments(id) values ('forged')")), /row-level security/);
  });
  await test('Tournament entry executes without ambiguous output columns and charges once', async () => {
    const a = await as('service_role', null, () => one("select * from tournament_entry('test','Alice',10,'{\"username\":\"Alice\"}', 'joined')"));
    assert.equal(a.ok, true);
    assert.equal(await balance(), 990);
    const b = await as('service_role', null, () => one("select * from tournament_entry('test','ALICE',10,'{\"username\":\"ALICE\"}', 'joined')"));
    assert.equal(b.errorReason, 'already_registered');
    assert.equal(await balance(), 990);
    await reject(() => rpc("select tournament_entry('test','bob',-1,'{\"username\":\"bob\"}','joined')"), /Invalid tournament/);
  });
  await test('Clients cannot call financial RPCs or the private wallet helper', async () => {
    for (const sql of ["select unlock_ai_level('"+ids.alice+"',3,10)", "select security_lock_wallet('"+ids.alice+"')", "select resolve_withdrawal('"+withdrawalId+"',false,'"+ids.admin+"')"] ) {
      await reject(() => as('authenticated', ids.alice, () => db.exec(sql)), /permission denied/);
    }
    await reject(() => as('anon', null, () => db.exec("select unlock_ai_level('"+ids.alice+"',3,10)")), /permission denied/);
  });
  await test('AI unlock debit and entitlement are atomic and repeated target is free', async () => {
    const a = await rpc('select unlock_ai_level($1,3,20)', [ids.alice]);
    assert.equal(a.ok, true); assert.equal(a.maxUnlockedKenLevel, 3);
    assert.equal(await balance(), 970);
    const b = await rpc('select unlock_ai_level($1,3,20)', [ids.alice]);
    assert.equal(b.alreadyUnlocked, true); assert.equal(await balance(), 970);
    const c = await rpc('select unlock_ai_level($1,8,99999)', [ids.alice]);
    assert.equal(c.errorReason, 'insufficient_funds');
    assert.equal(await scalar("select \"maxUnlockedKenLevel\" from profiles where \"usernameLower\"='alice'"), 3);
  });
  await test('Failed entitlement write rolls back the debit and ledger', async () => {
    await db.exec("create function fail_unlock() returns trigger language plpgsql as $$ begin raise exception 'injected entitlement failure'; end $$; create trigger injected_unlock_failure before update on profiles for each row execute function fail_unlock()");
    await reject(() => rpc('select unlock_ai_level($1,4,25)', [ids.alice]), /injected entitlement/);
    await db.exec('drop trigger injected_unlock_failure on profiles');
    assert.equal(await balance(), 970);
    assert.equal(await scalar("select count(*)::int from coin_transactions where type='ai_unlock'"), 1);
  });
  await test('Withdrawal escrow and request commit together; same key cannot double charge', async () => {
    const a = await withdraw(); assert.equal(a.ok, true); assert.equal(a.requestId, withdrawalId);
    assert.equal(await balance(), 870);
    const b = await withdraw(); assert.equal(b.alreadySubmitted, true); assert.equal(await balance(), 870);
    await reject(() => withdraw(withdrawalId, 101), /idempotency key/);
    assert.equal(await scalar("select count(*)::int from coin_transactions where type='withdrawal'"), 1);
  });
  await test('Failed request insert rolls back its withdrawal debit', async () => {
    await db.exec("create function fail_request() returns trigger language plpgsql as $$ begin raise exception 'injected request failure'; end $$; create trigger injected_request_failure before insert on withdrawal_requests for each row execute function fail_request()");
    await reject(() => withdraw('20000000-0000-4000-8000-000000000002'), /injected request/);
    await db.exec('drop trigger injected_request_failure on withdrawal_requests');
    assert.equal(await balance(), 870);
  });
  await test('Financial admin permission is checked by UUID, independent of username', async () => {
    await reject(() => rpc('select resolve_withdrawal($1,false,$2)', [withdrawalId, ids.alice]), /Not authorized/);
    assert.equal(await scalar('select status from withdrawal_requests where id=$1', [withdrawalId]), 'pending');
  });
  await db.exec("create function fail_audit() returns trigger language plpgsql as $$ begin raise exception 'injected audit failure'; end $$");
  await test('Failed withdrawal audit rolls back refund and resolution', async () => {
    await db.exec('create trigger injected_audit_failure before insert on audit_logs for each row execute function fail_audit()');
    await reject(() => resolveWithdrawal(), /injected audit/);
    await db.exec('drop trigger injected_audit_failure on audit_logs');
    assert.equal(await balance(), 870);
    assert.equal(await scalar('select status from withdrawal_requests where id=$1', [withdrawalId]), 'pending');
  });
  await test('Rejecting a withdrawal refunds exactly once and audits exactly once', async () => {
    assert.equal((await resolveWithdrawal()).status, 'rejected'); assert.equal(await balance(), 970);
    assert.equal((await resolveWithdrawal()).errorReason, 'already_resolved');
    assert.equal((await resolveWithdrawal(true)).errorReason, 'already_resolved');
    assert.equal(await balance(), 970);
    assert.equal(await scalar("select count(*)::int from audit_logs where action='reject_withdrawal'"), 1);
  });
  await test('Client purchase submissions must be pending and owned by the real username', async () => {
    await reject(() => as('authenticated', ids.alice, () => db.query('insert into purchase_requests(username,"ownerId",status) values ($1,$2,$3)', ['alice',ids.alice,'approved'])), /row-level security/);
    await reject(() => as('authenticated', ids.alice, () => db.query('insert into purchase_requests(username,"ownerId") values ($1,$2)', ['bob',ids.alice])), /row-level security/);
    await as('authenticated', ids.alice, () => db.query('insert into purchase_requests(id,username,"ownerId","packageId",coins) values ($1,$2,$3,$4,99999)', [purchaseId,'alice',ids.alice,'small']));
  });
  await test('Locked purchase package must match the server configuration choice', async () => {
    await reject(() => rpc('select resolve_purchase($1,true,250,$2,$3)', [purchaseId,'other',ids.admin]), /package/);
    assert.equal(await balance(), 970);
  });
  await test('Failed purchase audit rolls back credit, ledger and approval', async () => {
    await db.exec('create trigger injected_audit_failure before insert on audit_logs for each row execute function fail_audit()');
    await reject(() => resolvePurchase(), /injected audit/);
    await db.exec('drop trigger injected_audit_failure on audit_logs');
    assert.equal(await balance(), 970);
    assert.equal(await scalar('select status from purchase_requests where id=$1', [purchaseId]), 'pending');
  });
  await test('Purchase approval credits server amount once and a later reject cannot overwrite it', async () => {
    assert.equal((await resolvePurchase()).ok, true); assert.equal(await balance(), 1220);
    assert.equal((await resolvePurchase()).errorReason, 'already_resolved');
    assert.equal((await resolvePurchase(false)).errorReason, 'already_resolved');
    assert.equal(await scalar('select "coinsCredited"::float from purchase_requests where id=$1', [purchaseId]), 250);
    assert.equal(await scalar("select count(*)::int from audit_logs where action='approve_purchase'"), 1);
  });
  await test('Legacy pending withdrawal without a verifiable escrow is preserved for reconciliation', async () => {
    await db.query('insert into withdrawal_requests(id,username,"ownerId",coins,"nairaAmount","accountName","accountNumber") values ($1,$2,$3,50,100,$2,$4)', ['20000000-0000-4000-8000-000000000003','alice',ids.alice,'0123456789']);
    const r = await rpc('select resolve_withdrawal($1,false,$2)', ['20000000-0000-4000-8000-000000000003', ids.admin]);
    assert.equal(r.errorReason, 'escrow_not_verified'); assert.equal(await balance(), 1220);
  });
  await test('Nonfinite financial inputs cannot create money or invalid balances', async () => {
    for (const amount of ['NaN', 'Infinity', '-Infinity']) {
      await reject(() => rpc('select unlock_ai_level($1,8,$2::numeric)', [ids.alice,amount]), /Invalid unlock/);
      await reject(() => rpc('select submit_withdrawal($1,$2,$3::numeric,1,$4,$5,$6)', [ids.alice,'20000000-0000-4000-8000-000000000004',amount,'Alice','0123456789','Bank']), /Invalid withdrawal/);
    }
  });
  await test('Forward migration can run repeatedly without losing any existing rows or balance', async () => {
    const before = await one('select (select count(*)::int from profiles) profiles, (select count(*)::int from private_messages) messages, (select count(*)::int from tournaments) tournaments, (select count(*)::int from coin_transactions) ledger, (select count(*)::int from audit_logs) audits');
    await db.exec(migration); await db.exec(migration);
    assert.deepEqual(await one('select (select count(*)::int from profiles) profiles, (select count(*)::int from private_messages) messages, (select count(*)::int from tournaments) tournaments, (select count(*)::int from coin_transactions) ledger, (select count(*)::int from audit_logs) audits'), before);
    assert.equal(await balance(), 1220);
  });
  console.log(`Database security: ${passed} checks passed in disposable PGlite. Live Supabase and multi-connection races were not tested.`);
} finally { await db.close(); }
