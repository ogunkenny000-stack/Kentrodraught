/** Disposable financial rehearsal. NEVER connects to a hosted database.
 * Default: AUDIT_PG_URL must identify a loopback PostgreSQL administrator.
 * --pglite: executes real PostgreSQL WASM, but explicitly SKIPS concurrency.
 * Both modes use only the captured, sanitized live schema and synthetic data.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '../..');
const wasm = process.argv.includes('--pglite');
const results = [];
let db, admin, databaseName, databaseUrl;
const peers = [];
const ids = { alice: '10000000-0000-4000-8000-000000000001', bob: '10000000-0000-4000-8000-000000000002' };
async function check(name, fn) {
  await fn(); results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`);
}
async function rejects(fn, pattern) {
  await assert.rejects(fn, e => { assert.match(e.message, pattern); return true; });
}
async function asRole(role, fn, uid) {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
  try {
    if (uid) await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)", [uid, role]);
    const result = await fn(); await db.exec('COMMIT'); return result;
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
}
const result = async (sql, params = [], client = db) => (await client.query(sql, params)).rows[0]?.result;
const charge = (id, fee = 30, client = db) => result("select kentro_charge_match_pot($1,'alice','bob',$2) result", [id, fee], client);
const refund = (id, fee = 30, client = db) => result("select kentro_refund_unstarted_match($1,'alice','bob',$2) result", [id, fee], client);
const settle = (id, draw = false, fee = 30, client = db) => result("select kentro_settle_match_pot($1,'alice','bob',$2,$3,$4,0.1) result", [id, fee, draw ? null : 'alice', draw], client);
const balance = async name => Number((await db.query('select balance from coin_wallets where username=$1', [name])).rows[0]?.balance || 0);
const count = async (id, type) => Number((await db.query('select count(*) n from coin_transactions where "refId"=$1 and type=$2', [id, type])).rows[0].n);
async function snapshot() {
  return (await db.query(`select jsonb_build_object(
    'wallets',(select jsonb_agg(to_jsonb(w) order by username) from coin_wallets w),
    'ledger',(select jsonb_agg(to_jsonb(t) order by id) from coin_transactions t),
    'profiles',(select jsonb_agg(to_jsonb(p) order by "usernameLower") from profiles p),
    'purchases',(select jsonb_agg(to_jsonb(p) order by id) from purchase_requests p),
    'withdrawals',(select jsonb_agg(to_jsonb(w) order by id) from withdrawal_requests w)) result`)).rows[0].result;
}
async function nativePeer() {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl, query_timeout: 15000 });
  await client.connect(); await client.query('SET ROLE service_role'); peers.push(client); return client;
}
try {
  if (wasm) {
    const { PGlite } = await import('@electric-sql/pglite');
    db = new PGlite();
  } else {
    if (!process.env.AUDIT_PG_URL) throw Error('BLOCKED: Set AUDIT_PG_URL to a disposable loopback PostgreSQL server. No concurrency test ran.');
    const url = new URL(process.env.AUDIT_PG_URL);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw Error('Refusing non-local PostgreSQL.');
    const { Client } = await import('pg');
    admin = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 10000 });
    await admin.connect();
    databaseName = 'kentro_finance_' + randomUUID().replaceAll('-', '');
    await admin.query(`CREATE DATABASE ${databaseName}`);
    url.pathname = '/' + databaseName; databaseUrl = url.toString();
    db = new Client({ connectionString: databaseUrl, query_timeout: 20000 }); await db.connect();
    db.exec = sql => db.query(sql);
  }
  const version = (await db.query('select version() version')).rows[0].version;
  console.log(`Engine: ${version}`);
  await db.exec(await fs.readFile(path.join(root, 'scripts/audit/live-finance-fixture-20261017.sql'), 'utf8'));
  for (const [name, id] of Object.entries(ids)) {
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [id, `${name}@example.invalid`, { username: name }]);
    await db.query("select credit_wallet($1,1000,'admin_adjustment','synthetic-fixture')", [name]);
  }
  const installer = await fs.readFile(path.join(root, 'supabase/manual_live_finance_20261017.sql'), 'utf8');
  await check('installer abort is atomic and preserves every existing wallet and ledger row', async () => {
    const before = await snapshot();
    const broken = installer.replace(/^COMMIT;$/m, () => "DO $$BEGIN RAISE EXCEPTION 'REHEARSAL_FAILURE_BEFORE_COMMIT'; END$$;\nCOMMIT;");
    await rejects(() => db.exec(broken), /REHEARSAL_FAILURE_BEFORE_COMMIT/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query("select to_regclass('public.kentro_match_charges') receipt")).rows[0].receipt, null);
    assert.deepEqual(await snapshot(), before);
  });
  await check('actual installer commits, readiness passes, and reinstall preserves data', async () => {
    const before = await snapshot();
    await db.exec(installer);
    assert.deepEqual(await snapshot(), before);
    assert.equal((await result('select kentro_coin_readiness() result')).ready, true);
    await db.exec(installer); assert.deepEqual(await snapshot(), before);
  });
  await check('rollback-only probe leaves no wallet, ledger, charge, or settlement rows', async () => {
    const before = await snapshot();
    await db.exec(await fs.readFile(path.join(root, 'supabase/verify_finance_no_commit_20261017.sql'), 'utf8'));
    assert.deepEqual(await snapshot(), before);
    for (const table of ['kentro_match_charges', 'kentro_match_settlements']) {
      assert.equal(Number((await db.query(`select count(*) n from ${table}`)).rows[0].n), 0);
    }
  });
  await check('all finance RPCs deny anon/authenticated and permit service_role; all finance tables use RLS', async () => {
    const rows = (await db.query(`select p.proname,has_function_privilege('anon',p.oid,'EXECUTE') anon,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
      has_function_privilege('service_role',p.oid,'EXECUTE') service
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
      ('kentro_coin_readiness','kentro_charge_match_pot','kentro_refund_unstarted_match','kentro_settle_match_pot',
      'kentro_unlock_ai','kentro_create_withdrawal','kentro_resolve_withdrawal','kentro_resolve_purchase',
      'tournament_entry','refund_tournament_entries','pay_tournament_prize','debit_wallet','credit_wallet',
      'debit_multiple_wallets','kentro_claim_ken_victory','kentro_commit_tournament','kentro_pay_completed_tournament')`)).rows;
    assert.equal(rows.length, 17);
    for (const row of rows) { assert.equal(row.anon, false, row.proname); assert.equal(row.authenticated, false, row.proname); assert.equal(row.service, true, row.proname); }
    for (const role of ['anon', 'authenticated']) await rejects(() => asRole(role, () => charge('forbidden')), /permission denied/);
    assert.equal((await asRole('service_role', () => result('select kentro_coin_readiness() result'))).ready, true);
    assert.equal((await db.query(`select bool_and(relrowsecurity) secure from pg_class where oid in
      ('public.coin_wallets'::regclass,'public.coin_transactions'::regclass,'public.purchase_requests'::regclass,
       'public.withdrawal_requests'::regclass,'public.kentro_match_charges'::regclass,'public.kentro_match_settlements'::regclass)`)).rows[0].secure, true);
  });
  await check('readiness detects exposed legacy finance helpers and missing service grants', async () => {
    await db.exec('BEGIN; GRANT EXECUTE ON FUNCTION public.credit_wallet(text,numeric,text,text) TO anon');
    assert.equal((await result('select kentro_coin_readiness() result')).ready, false); await db.exec('ROLLBACK');
    await db.exec('BEGIN; REVOKE EXECUTE ON FUNCTION public.refund_tournament_entries(text) FROM service_role');
    assert.equal((await result('select kentro_coin_readiness() result')).ready, false); await db.exec('ROLLBACK');
  });
  await check('profile creation succeeds with defaults; duplicate identities and forged entitlement fail', async () => {
    const id = '10000000-0000-4000-8000-000000000003';
    // Username conflict makes the signup trigger leave a profile to be claimed.
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [id, 'new@example.invalid', { username: 'alice' }]);
    await asRole('authenticated', () => db.query('insert into profiles("usernameLower",username,"ownerId","createdAt") values(\'new_player\',\'New_Player\',$1,0)', [id]), id);
    assert.ok(Number((await db.query('select "createdAt" t from profiles where "ownerId"=$1', [id])).rows[0].t) > 0);
    await rejects(() => asRole('authenticated', () => db.query('insert into profiles("usernameLower",username,"ownerId") values(\'alias\',\'Alias\',$1)', [id]), id), /Invalid profile creation|duplicate key/);
    await rejects(() => asRole('authenticated', () => db.query('update profiles set "maxUnlockedKenLevel"=8 where "ownerId"=$1', [id]), id), /server-managed/);
    await asRole('authenticated', () => db.query('update profiles set bio=\'Synthetic biography\' where "ownerId"=$1', [id]), id);
  });
  await check('charge retry debits once; winner receives one net payout and exact rake', async () => {
    const a = await balance('alice'), b = await balance('bob'), house = await balance('kentro_house');
    assert.equal((await asRole('service_role', () => charge('winner'))).alreadyCharged, false);
    assert.equal((await charge('winner')).alreadyCharged, true);
    assert.equal(await count('winner', 'match_entry'), 2);
    assert.equal(await balance('alice'), a - 30); assert.equal(await balance('bob'), b - 30);
    const paid = await settle('winner'); assert.equal(paid.payout, 54); assert.equal(paid.rake, 6);
    assert.deepEqual(await settle('winner'), paid);
    assert.equal(await count('winner', 'match_prize'), 1);
    assert.equal(await balance('alice'), a + 24); assert.equal(await balance('kentro_house'), house + 6);
  });
  await check('draw and aborted-game refunds are exact, idempotent, and cannot fund a new game', async () => {
    for (const [id, draw] of [['draw', true], ['abort', false]]) {
      const a = await balance('alice'), b = await balance('bob'); await charge(id);
      if (draw) { await settle(id, true); await settle(id, true); } else { await refund(id); await refund(id); }
      assert.equal(await balance('alice'), a); assert.equal(await balance('bob'), b);
      assert.equal(await count(id, 'refund'), 2);
      await rejects(() => charge(id), /already settled/);
    }
  });
  await check('cancellation before a delayed charge permanently closes that ID', async () => {
    const before = await snapshot();
    assert.equal((await refund('cancel-before-charge')).notCharged, true);
    await rejects(() => charge('cancel-before-charge'), /already settled/);
    assert.deepEqual(await snapshot(), before);
  });
  await check('old paid or refunded ledger references cannot be recharged or paid again', async () => {
    for (const type of ['match_prize', 'refund']) {
      const id = 'legacy-' + type;
      await db.query("select * from debit_multiple_wallets(array['alice','bob'],10,'match_entry',$1)", [id]);
      await db.query('select credit_wallet(\'alice\',20,$1,$2)', [type, id]);
      const before = await snapshot();
      await rejects(() => charge(id, 10), /Legacy match reference/);
      await rejects(() => settle(id, false, 10), /Existing match payout or refund/);
      assert.deepEqual(await snapshot(), before);
    }
  });
  await check('an injected second-debit failure rolls back the first debit and receipt', async () => {
    await db.exec("create function rehearsal_fail() returns trigger language plpgsql as $$begin if new.username='bob' and new.\"refId\"='fail-charge' then raise exception 'INJECTED_LEDGER_FAILURE'; end if; return new; end$$; create trigger rehearsal_fail before insert on coin_transactions for each row execute function rehearsal_fail()");
    const before = await snapshot(); await rejects(() => charge('fail-charge'), /INJECTED_LEDGER_FAILURE/);
    assert.deepEqual(await snapshot(), before);
    assert.equal(Number((await db.query("select count(*) n from kentro_match_charges where match_id='fail-charge'")).rows[0].n), 0);
    await db.exec('drop trigger rehearsal_fail on coin_transactions; drop function rehearsal_fail()');
  });
  await check('paid AI unlock charges once, while verified Ken 2 through 8 progression is free and replay-safe', async () => {
    let before = await balance('alice');
    const unlocked = await result('select kentro_unlock_ai($1,\'alice\',4,50) result', [ids.alice]); assert.equal(unlocked.ok, true);
    assert.equal(await balance('alice'), before - 50);
    assert.equal((await result('select kentro_unlock_ai($1,\'alice\',4,50) result', [ids.alice])).alreadyUnlocked, true);
    assert.equal(await balance('alice'), before - 50);
    before = await balance('bob'); const ledgerCount = (await db.query('select count(*) n from coin_transactions')).rows[0].n;
    for (let level = 2; level <= 7; level++) {
      const game = randomUUID(); const values = [ids.bob, game, level];
      assert.equal((await asRole('service_role', () => result('select kentro_claim_ken_victory($1,$2,$3) result', values))).maxUnlockedKenLevel, level + 1);
      assert.equal((await result('select kentro_claim_ken_victory($1,$2,$3) result', values)).alreadyClaimed, true);
      if (level < 7) assert.equal((await result('select kentro_claim_ken_victory($1,$2,$3) result', [ids.bob, game, level + 1])).ok, false);
    }
    assert.equal(await balance('bob'), before); assert.equal((await db.query('select count(*) n from coin_transactions')).rows[0].n, ledgerCount);
  });
  await check('synthetic operator purchase and withdrawal resolutions are atomic and single-use', async () => {
    const purchase = randomUUID(), a = await balance('alice');
    await db.query('insert into purchase_requests(id,username,"ownerId",coins,"amountNaira") values($1,\'alice\',$2,40,400)', [purchase, ids.alice]);
    assert.equal((await result("select kentro_resolve_purchase($1,true,'synthetic_operator',40) result", [purchase])).ok, true);
    assert.equal((await result("select kentro_resolve_purchase($1,true,'synthetic_operator',40) result", [purchase])).error, 'already_resolved');
    assert.equal(await balance('alice'), a + 40);
    const withdrawal = await result("select kentro_create_withdrawal($1,'alice',20,200,'Synthetic Person','0000000000','Test Bank') result", [ids.alice]);
    assert.equal(withdrawal.ok, true); assert.equal(await balance('alice'), a + 20);
    assert.equal((await result("select kentro_resolve_withdrawal($1,false,'synthetic_operator') result", [withdrawal.requestId])).ok, true);
    assert.equal((await result("select kentro_resolve_withdrawal($1,false,'synthetic_operator') result", [withdrawal.requestId])).error, 'already_resolved');
    assert.equal(await balance('alice'), a + 40);
    const paid = await result("select kentro_create_withdrawal($1,'alice',10,100,'Synthetic Person','0000000000','Test Bank') result", [ids.alice]);
    await result("select kentro_resolve_withdrawal($1,true,'synthetic_operator') result", [paid.requestId]);
    assert.equal((await db.query('select status from withdrawal_requests where id=$1', [paid.requestId])).rows[0].status, 'paid');
    assert.equal(await balance('alice'), a + 30); // status-only simulation; no bank transfer.
  });
  await check('tournament entry retry and cancellation refund preserve wallet balances', async () => {
    await db.query("insert into tournaments(id,status,\"maxPlayers\") values('synthetic_tournament','registration',2)");
    const a = await balance('alice'), b = await balance('bob');
    for (const name of ['alice', 'bob']) {
      const sql = "select * from tournament_entry('synthetic_tournament',$1,10,$2,'test')";
      assert.equal((await db.query(sql, [name, { username: name }])).rows[0].ok, true);
      assert.equal((await db.query(sql, [name, { username: name }])).rows[0].ok, false);
    }
    assert.equal((await db.query("select * from refund_tournament_entries('synthetic_tournament')")).rows[0].ok, true);
    assert.equal((await db.query("select * from refund_tournament_entries('synthetic_tournament')")).rows[0].ok, false);
    assert.equal(await balance('alice'), a); assert.equal(await balance('bob'), b);
  });
  if (wasm) {
    results.push({ name: 'parallel PostgreSQL charge/settle/refund sessions', status: 'NOT_RUN', reason: 'PGlite is single-connection; Promise.all would not be a real concurrency test.' });
    console.log('NOT_RUN native multi-connection concurrency; production GO remains blocked.');
  } else {
    const clients = await Promise.all(Array.from({ length: 12 }, nativePeer));
    await check('parallel retries debit each player once and pay one winner', async () => {
      await Promise.all(clients.map(c => charge('parallel-winner', 20, c)));
      assert.equal(await count('parallel-winner', 'match_entry'), 2);
      await Promise.all(clients.map(c => settle('parallel-winner', false, 20, c)));
      assert.equal(await count('parallel-winner', 'match_prize'), 1);
    });
    await check('parallel charge/cancel and settle/refund races conserve money and close the receipt', async () => {
      for (let round = 0; round < 12; round++) {
        const id = 'race-' + round; const a = await balance('alice'), b = await balance('bob');
        const raced = await Promise.allSettled([charge(id, 10, clients[0]), refund(id, 10, clients[1])]);
        for (const r of raced) if (r.status === 'rejected') assert.match(r.reason.message, /already settled/);
        assert.equal(await balance('alice'), a); assert.equal(await balance('bob'), b);
        await rejects(() => charge(id, 10), /already settled/);
        const terminal = 'terminal-' + round; await charge(terminal, 10);
        const moneyBefore = await balance('alice') + await balance('bob') + await balance('kentro_house');
        await Promise.all([settle(terminal, false, 10, clients[2]), refund(terminal, 10, clients[3])]);
        assert.equal(await balance('alice') + await balance('bob') + await balance('kentro_house'), moneyBefore + 20);
        assert.ok((await count(terminal, 'match_prize') === 1 && await count(terminal, 'refund') === 0)
          || (await count(terminal, 'match_prize') === 0 && await count(terminal, 'refund') === 2));
      }
    });
  }
  console.log(JSON.stringify({ mode: wasm ? 'PostgreSQL WASM sequential rehearsal' : 'native disposable PostgreSQL', version,
    checks: results, productionCertified: false, limits: ['No live restore test', 'No hosted Auth or PostgREST acceptance', 'No real purchase or bank payout verified', ...(wasm ? ['No multi-connection concurrency'] : [])] }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', message: error.message, code: error.code, where: error.where, completed: results }, null, 2));
  process.exitCode = 1;
} finally {
  for (const peer of peers) await peer.end();
  if (db) { if (wasm) await db.close(); else await db.end(); }
  if (admin) {
    if (databaseName) await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.end();
  }
}
