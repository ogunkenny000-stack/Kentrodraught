/** Local-only disposable PostgreSQL regression suite. Never targets a live DB. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { calculateRating, defaultPlayerRating } from '../../src/rating.ts';
const connectionString = process.env.AUDIT_PG_URL;
if (!connectionString) throw new Error('Set AUDIT_PG_URL to a disposable local PostgreSQL admin URL.');
const url = new URL(connectionString);
if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('Audit refuses non-local PostgreSQL.');
const root = path.resolve(import.meta.dirname, '../..');
const dbName = `kentro_audit_${process.pid}`;
const admin = new Client({ connectionString });
await admin.connect();
await admin.query(`CREATE DATABASE ${dbName}`);
url.pathname = `/${dbName}`;
const databaseUrl = url.toString();
const owner = new Client({ connectionString: databaseUrl });
await owner.connect();
const clients = [];
let checks = 0;
function check(label, fn) { return Promise.resolve().then(fn).then(() => { checks++; console.log(`PASS ${label}`); }); }
async function denied(client, sql, values=[]) {
  try { const r = await client.query(sql, values); assert.equal(r.rowCount, 0, 'forbidden operation affected a row'); }
  catch (e) { if (e instanceof assert.AssertionError) throw e; assert.ok(['42501','23514','P0001','23502'].includes(e.code), `unexpected denial ${e.code}`); }
}
const uid = { alice:'10000000-0000-4000-8000-000000000001', bob:'10000000-0000-4000-8000-000000000002', carol:'10000000-0000-4000-8000-000000000003', admin:'10000000-0000-4000-8000-000000000004' };
async function roleClient(role, id) {
  const client = new Client({ connectionString: databaseUrl }); await client.connect(); clients.push(client);
  await client.query(`SET ROLE ${role}`);
  if (id) await client.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
  return client;
}
const balance = async username => Number((await owner.query('select balance from public.coin_wallets where username=$1',[username])).rows[0].balance);
try {
  await owner.query(await fs.readFile(path.join(root,'scripts/audit/supabase-fixture.sql'),'utf8'));
  await owner.query(await fs.readFile(path.join(root,'supabase/schema.sql'),'utf8'));
  const files = (await fs.readdir(path.join(root,'supabase/migrations'))).filter(f=>f.endsWith('.sql')).sort();
  for (const f of files) await owner.query(await fs.readFile(path.join(root,'supabase/migrations',f),'utf8'));
  for (const [username,id] of Object.entries(uid)) await owner.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,`${username}@example.invalid`,{username}]);
  await owner.query("insert into public.admins(username,uid,permissions) values('admin',$1,array['manage_tournaments'])",[uid.admin]);
  await owner.query("select public.credit_wallet('alice',100,'admin_adjustment','fixture'), public.credit_wallet('bob',100,'admin_adjustment','fixture')");
  const alice = await roleClient('authenticated',uid.alice), bob = await roleClient('authenticated',uid.bob), carol = await roleClient('authenticated',uid.carol), administrator = await roleClient('authenticated',uid.admin), anon = await roleClient('anon'), service = await roleClient('service_role');
  await check('anonymous and authenticated roles cannot resolve account emails',async()=>{
    await denied(anon,"select resolve_username_to_email('alice')");
    await denied(alice,"select resolve_username_to_email('bob')");
    assert.equal((await service.query("select resolve_username_to_email('alice') as email")).rows[0].email,'alice@example.invalid');
  });
  await check('SECURITY DEFINER signup cannot claim the reserved house wallet identity',async()=>{
    await denied(owner,'insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',
      ['10000000-0000-4000-8000-000000000005','reserved@example.invalid',{username:'kentro_house'}]);
    assert.equal((await owner.query('select * from profiles where "usernameLower"=\'kentro_house\'')).rowCount,0);
  });
  await check('concurrent first-profile claims cannot create two identities for one Auth UID',async()=>{
    const id='10000000-0000-4000-8000-000000000006';
    // A historical signup collision leaves this account without a profile.
    await owner.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,'collision@example.invalid',{username:'alice'}]);
    const first=await roleClient('authenticated',id), second=await roleClient('authenticated',id);
    const results=await Promise.allSettled([first.query('insert into profiles("usernameLower",username,"ownerId") values(\'newone\',\'Newone\',$1)',[id]),second.query('insert into profiles("usernameLower",username,"ownerId") values(\'newtwo\',\'Newtwo\',$1)',[id])]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal((await owner.query('select * from profiles where "ownerId"=$1',[id])).rowCount,1);
  });
  await check('profile identity, paid unlock, moderation and account age cannot be changed by owner',async()=>{
    for (const assignment of ['"usernameLower"=\'owner\'','"maxUnlockedKenLevel"=8','banned=true','"createdAt"=0','elo=9999','wins=999']) await denied(alice,`update profiles set ${assignment} where "usernameLower"='alice'`);
    await denied(bob,"update profiles set elo=9999 where \"usernameLower\"='alice'");
    await denied(alice,"insert into profiles(\"usernameLower\",username,\"ownerId\") values('alias','alias',$1)",[uid.alice]);
  });
  await check('friend consent, immutable participants and privacy',async()=>{
    await denied(alice,"insert into friends(id,\"user1\",\"user2\",sender,status) values('fake','alice','bob','alice','accepted')");
    await alice.query("insert into friends(id,\"user1\",\"user2\",sender) values('alice_bob','alice','bob','alice')");
    await denied(alice,"update friends set status='accepted' where id='alice_bob'");
    assert.equal((await carol.query('select * from friends')).rowCount,0);
    await denied(carol,"delete from friends where id='alice_bob'");
    assert.equal((await bob.query("update friends set status='accepted' where id='alice_bob'")).rowCount,1);
    await denied(bob,"update friends set \"user1\"='carol' where id='alice_bob'");
  });
  await check('DM sender and recipient bindings are genuine and message contents immutable',async()=>{
    const insert = 'insert into private_messages("chatId",sender,recipient,"senderOwnerId","recipientOwnerId",text) values(\'alice_bob\',\'alice\',\'bob\',$1,$2,\'hello\') returning id';
    await denied(bob,insert,[uid.alice,uid.bob]);
    await denied(alice,insert,[uid.alice,uid.carol]);
    const id=(await alice.query(insert,[uid.alice,uid.bob])).rows[0].id;
    assert.equal((await carol.query('select * from private_messages')).rowCount,0);
    await denied(bob,'update private_messages set text=\'forged\' where id=$1',[id]);
    assert.equal((await bob.query("update private_messages set status='seen' where id=$1",[id])).rowCount,1);
    await denied(carol,"insert into global_chat(sender,text) values('alice','fake')");
    await alice.query("insert into global_chat(sender,text) values('alice','real')");
  });
  await check('official records and tournament standings are server managed',async()=>{
    await denied(alice,"insert into completed_games(\"gameId\",\"whitePlayer\",\"blackPlayer\",\"playMode\") values('fake','alice','bob','Multiplayer')");
    await alice.query("insert into completed_games(\"gameId\",\"whitePlayer\",\"blackPlayer\",\"playMode\") values('practice','alice','Ken Level 3','Human_vs_AI')");
    await denied(bob,"update completed_games set winner='Black' where \"gameId\"='practice'");
    await denied(alice,"insert into tournaments(id) values('unauthorized')");
    await administrator.query("insert into tournaments(id,name,status,players) values('tour','Fixture','registration','[]')");
    await denied(alice,"update tournaments set status='completed',\"prizePool\"=100000 where id='tour'");
    await alice.query("select kentro_tournament_chat('tour','hello')");
    assert.equal((await owner.query("select chat->-1->>'sender' as sender from tournaments where id='tour'")).rows[0].sender,'alice');
  });
  await check('private replay rows are visible only to their verified participants',async()=>{
    await owner.query('insert into completed_games("gameId","whitePlayer","blackPlayer","playMode",private,"participantUserIds") values(\'private-match\',\'alice\',\'bob\',\'Multiplayer\',true,$1)',[JSON.stringify([uid.alice,uid.bob])]);
    assert.equal((await alice.query("select * from completed_games where \"gameId\"='private-match'")).rowCount,1);
    assert.equal((await bob.query("select * from completed_games where \"gameId\"='private-match'")).rowCount,1);
    assert.equal((await carol.query("select * from completed_games where \"gameId\"='private-match'")).rowCount,0);
    assert.equal((await anon.query("select * from completed_games where \"gameId\"='private-match'")).rowCount,0);
  });
  await check('wallets without ownerId stay private and purchases are pending genuine-owner claims',async()=>{
    assert.equal((await alice.query("select * from coin_wallets where username='alice'")).rowCount,1);
    assert.equal((await bob.query("select * from coin_wallets where username='alice'")).rowCount,0);
    await denied(alice,"insert into purchase_requests(username,\"ownerId\",status) values('alice',$1,'approved')",[uid.alice]);
    await denied(alice,"insert into purchase_requests(username,\"ownerId\") values('bob',$1)",[uid.alice]);
    await alice.query("insert into purchase_requests(username,\"ownerId\",\"packageId\") values('alice',$1,'fixture')",[uid.alice]);
    await denied(anon,"select credit_wallet('alice',100,'refund',null)");
    await denied(alice,"select kentro_unlock_ai($1,'alice',8,0)",[uid.alice]);
  });
  await check('new wallet writes reject negative, fractional and overflowing balances',async()=>{
    for (const amount of [-1,0.5,Number.MAX_SAFE_INTEGER]) await denied(service,"select credit_wallet('alice',$1,'refund','invalid')",[amount]);
    assert.equal(await balance('alice'),100);
  });
  await check('multi-wallet insufficient funds leaves every wallet unchanged',async()=>{
    const before=await balance('alice');
    const result=(await service.query("select * from debit_multiple_wallets(array['alice','empty'],10,'match_entry','insufficient')")).rows[0];
    assert.equal(result.ok,false); assert.equal(await balance('alice'),before);
    assert.equal((await owner.query("select * from coin_transactions where \"refId\"='insufficient'")).rowCount,0);
  });
  await check('concurrent and repeated match settlements distribute one escrow only',async()=>{
    await service.query("select * from debit_multiple_wallets(array['alice','bob'],10,'match_entry','match1')");
    const second=await roleClient('service_role');
    const sql="select kentro_settle_match_pot('match1','alice','bob',10,'alice',false,0.1) as result";
    const results=await Promise.all([service.query(sql),second.query(sql)]);
    assert.deepEqual(results[0].rows,results[1].rows);
    assert.equal(await balance('alice'),108); assert.equal(await balance('bob'),90); assert.equal(await balance('kentro_house'),2);
    assert.equal((await owner.query("select * from coin_transactions where type='match_prize' and \"refId\"='match1'")).rowCount,1);
    await denied(service,"select kentro_settle_match_pot('fake','alice','bob',10,'alice',false,0)");
  });
  await check('match credit failure rolls back payout, rake and settlement marker',async()=>{
    await service.query("select * from debit_multiple_wallets(array['alice','bob'],10,'match_entry','match2')");
    await owner.query("create function audit_fail_rake() returns trigger language plpgsql as $$ begin if new.\"refId\"='rake:match2' then raise exception 'simulated failure'; end if; return new; end $$; create trigger audit_fail_rake before insert on coin_transactions for each row execute function audit_fail_rake()");
    const before=await balance('alice'); await denied(service,"select kentro_settle_match_pot('match2','alice','bob',10,'alice',false,0.1)");
    assert.equal(await balance('alice'),before);
    assert.equal((await owner.query("select * from kentro_match_settlements where match_id='match2'")).rowCount,0);
    await owner.query('drop trigger audit_fail_rake on coin_transactions');
    await service.query("select kentro_settle_match_pot('match2','alice','bob',10,null,true,0)");
  });
  await check('concurrent unlock requests charge once and persist paid level',async()=>{
    const before=await balance('alice'); const second=await roleClient('service_role');
    const sql="select kentro_unlock_ai($1,'alice',8,5) as result";
    await Promise.all([service.query(sql,[uid.alice]),second.query(sql,[uid.alice])]);
    assert.equal(await balance('alice'),before-5);
    assert.equal((await owner.query("select \"maxUnlockedKenLevel\" from profiles where \"usernameLower\"='alice'")).rows[0].maxUnlockedKenLevel,8);
  });
  await check('withdrawal creation and concurrent rejection are atomic',async()=>{
    await owner.query("create function audit_fail_withdrawal() returns trigger language plpgsql as $$ begin if new.\"bankName\"='fail' then raise exception 'simulated request insert failure'; end if; return new; end $$; create trigger audit_fail_withdrawal before insert on withdrawal_requests for each row execute function audit_fail_withdrawal()");
    const before=await balance('alice');
    await denied(service,"select kentro_create_withdrawal($1,'alice',10,100,'Alice','0123456789','fail')",[uid.alice]);
    assert.equal(await balance('alice'),before);
    const request=(await service.query("select kentro_create_withdrawal($1,'alice',10,100,'Alice','0123456789','bank') as result",[uid.alice])).rows[0].result;
    assert.equal(await balance('alice'),before-10);
    const second=await roleClient('service_role'); const sql="select kentro_resolve_withdrawal($1,false,'admin') as result";
    const results=await Promise.all([service.query(sql,[request.requestId]),second.query(sql,[request.requestId])]);
    assert.equal(results.filter(r=>r.rows[0].result.ok).length,1); assert.equal(await balance('alice'),before);
  });
  await check('concurrent purchase approvals credit canonical owner once',async()=>{
    const id=(await owner.query("select id from purchase_requests where username='alice'")).rows[0].id;
    const before=await balance('alice'), second=await roleClient('service_role'); const sql="select kentro_resolve_purchase($1,true,'admin',15) as result";
    const results=await Promise.all([service.query(sql,[id]),second.query(sql,[id])]);
    assert.equal(results.filter(r=>r.rows[0].result.ok).length,1); assert.equal(await balance('alice'),before+15);
  });
  await check('concurrent tournament entry honors capacity, charges one canonical entrant and pays once',async()=>{
    await owner.query("insert into tournaments(id,status,players,\"maxPlayers\") values('capacity','registration','[]',1)");
    const before=await balance('alice')+await balance('bob'), second=await roleClient('service_role');
    const sql='select * from tournament_entry(\'capacity\',$1,7,$2,\'fixture entry\')';
    const results=await Promise.all([service.query(sql,['alice',{username:'Alice',rating:1500}]),second.query(sql,['bob',{username:'Bob',rating:1500}])]);
    assert.equal(results.filter(r=>r.rows[0].ok).length,1);
    assert.equal(results.filter(r=>r.rows[0].errorReason==='full').length,1);
    assert.equal(await balance('alice')+await balance('bob'),before-7);
    const winner=results[0].rows[0].ok?'alice':'bob';
    assert.equal((await service.query(sql,[winner,{username:winner.toUpperCase()}])).rows[0].errorReason,'already_registered');
    assert.equal((await service.query("select * from pay_tournament_prize('capacity','carol',0.1)")).rows[0].errorReason,'not_a_player');
    const pay="select * from pay_tournament_prize('capacity',$1,0.1)";
    const paid=await Promise.all([service.query(pay,[winner]),second.query(pay,[winner])]);
    assert.equal(paid.filter(r=>r.rows[0].ok).length,1);
    assert.equal((await owner.query("select * from coin_transactions where type='tournament_prize' and \"refId\"='capacity'")).rowCount,1);
  });
  await check('cancelled tournament refunds all logged entries once under concurrency',async()=>{
    await owner.query("insert into tournaments(id,status,players,\"maxPlayers\") values('refund','registration','[]',2)");
    const before=await balance('alice')+await balance('bob');
    for (const player of ['alice','bob']) await service.query("select * from tournament_entry('refund',$1,7,$2,'fixture entry')",[player,{username:player}]);
    assert.equal(await balance('alice')+await balance('bob'),before-14);
    const second=await roleClient('service_role');
    const results=await Promise.all([service.query("select * from refund_tournament_entries('refund')"),second.query("select * from refund_tournament_entries('refund')")]);
    assert.equal(results.filter(r=>r.rows[0].ok).length,1); assert.equal(await balance('alice')+await balance('bob'),before);
    assert.equal((await owner.query("select status from tournaments where id='refund'")).rows[0].status,'cancelled');
  });
  await check('bans and suspensions block direct browser writes and tournament admin powers',async()=>{
    await owner.query('update profiles set banned=true where "ownerId"=$1',[uid.alice]);
    await denied(alice,"insert into global_chat(sender,text) values('alice','bypassed ban')");
    await denied(alice,"insert into purchase_requests(username,\"ownerId\",\"packageId\") values('alice',$1,'fixture')",[uid.alice]);
    await owner.query('update profiles set banned=false where "ownerId"=$1',[uid.alice]);
    await owner.query('update profiles set "suspendedUntil"=$1 where "ownerId"=$2',[Date.now()+86400000,uid.admin]);
    await denied(administrator,"update tournaments set status='completed' where id='tour'");
    await denied(administrator,"insert into tournaments(id) values('suspended-admin')");
    await owner.query('update profiles set "suspendedUntil"=null where "ownerId"=$1',[uid.admin]);
  });
  const ratedSql='select kentro_apply_rated_result($1,$2,$3,$4,$5,$6,$7) as result';
  async function ratingArgs(gameId,white,black,winner) {
    const profiles=(await owner.query('select * from profiles where "usernameLower"=any($1)',[[white,black]])).rows;
    const a=profiles.find(p=>p.usernameLower===white), b=profiles.find(p=>p.usernameLower===black);
    const rating=p=>({rating:Number(p.elo),rd:Number(p.rd??defaultPlayerRating.rd),vol:Number(p.vol??defaultPlayerRating.vol)});
    const after=calculateRating(rating(a),rating(b),winner==='Draw'?0.5:winner==='W'?1:0);
    after.newPlayer1.rating=Math.max(100,Math.round(after.newPlayer1.rating)); after.newPlayer2.rating=Math.max(100,Math.round(after.newPlayer2.rating));
    return [gameId,uid[white],uid[black],a.statsVersion,b.statsVersion,winner,{white:after.newPlayer1,black:after.newPlayer2}];
  }
  async function ratedGame(id,white,black,winner) {
    await owner.query('insert into completed_games("gameId","whitePlayer","blackPlayer",winner,"playMode","participantUserIds","moveEvaluations") values($1,$2,$3,$4,\'Multiplayer\',$5,$6)',[id,white,black,winner,JSON.stringify([uid[white],uid[black]]),{__kentroGameRecord:{durationSeconds:60}}]);
  }
  await check('duplicate concurrent authoritative results apply both Glicko ratings and stats once',async()=>{
    await ratedGame('rated1','alice','bob','W');
    const args=await ratingArgs('rated1','alice','bob','W'), second=await roleClient('service_role');
    await denied(alice,ratedSql,args);
    const results=await Promise.all([service.query(ratedSql,args),second.query(ratedSql,args)]);
    assert.deepEqual(results[0].rows,results[1].rows);
    const a=(await owner.query('select * from profiles where "usernameLower"=\'alice\'')).rows[0];
    const b=(await owner.query('select * from profiles where "usernameLower"=\'bob\'')).rows[0];
    assert.equal(Number(a.elo),1662); assert.equal(Number(b.elo),1338);
    assert.equal(a.wins,1); assert.equal(b.losses,1); assert.equal(a.gamesCount,1); assert.equal(b.gamesCount,1);
    assert.equal(Number(a.totalPlayTime),60); assert.equal(Number(a.averageDuration),60);
    assert.equal((await owner.query('select * from kentro_rated_matches where game_id=\'rated1\'')).rowCount,1);
  });
  await check('overlapping concurrent rated games retry stale snapshots without losing either result',async()=>{
    await ratedGame('rated2','alice','bob','Draw'); await ratedGame('rated3','alice','carol','B');
    const firstArgs=await ratingArgs('rated2','alice','bob','Draw'), secondArgs=await ratingArgs('rated3','alice','carol','B');
    const second=await roleClient('service_role');
    const results=await Promise.all([service.query(ratedSql,firstArgs),second.query(ratedSql,secondArgs)]);
    const stale=results.map((r,i)=>({i,result:r.rows[0].result})).filter(r=>r.result.retry);
    assert.equal(stale.length,1);
    const retry=stale[0].i===0?await ratingArgs('rated2','alice','bob','Draw'):await ratingArgs('rated3','alice','carol','B');
    assert.equal((await service.query(ratedSql,retry)).rows[0].result.ok,true);
    const a=(await owner.query('select * from profiles where "usernameLower"=\'alice\'')).rows[0];
    assert.equal(a.gamesCount,3); assert.equal(a.wins,1); assert.equal(a.losses,1); assert.equal(a.draws,1);
    assert.equal(Number(a.totalPlayTime),180); assert.equal(Number(a.statsVersion),3);
    assert.equal((await owner.query('select * from kentro_rated_matches')).rowCount,3);
    await denied(service,ratedSql,['rated-forgery',...retry.slice(1)]);
  });
  await check('a failed second profile update rolls back both statistics and the rated ledger',async()=>{
    await ratedGame('rated-rollback','alice','bob','W');
    const args=await ratingArgs('rated-rollback','alice','bob','W');
    const before=(await owner.query('select "usernameLower",elo,"gamesCount","statsVersion" from profiles order by "usernameLower"')).rows;
    await owner.query("create function audit_fail_rating() returns trigger language plpgsql as $$ begin if new.\"usernameLower\"='bob' then raise exception 'simulated second-profile update failure'; end if; return new; end $$; create trigger audit_fail_rating before update on profiles for each row execute function audit_fail_rating()");
    await denied(service,ratedSql,args);
    assert.deepEqual((await owner.query('select "usernameLower",elo,"gamesCount","statsVersion" from profiles order by "usernameLower"')).rows,before);
    assert.equal((await owner.query("select * from kentro_rated_matches where game_id='rated-rollback'")).rowCount,0);
    await owner.query('drop trigger audit_fail_rating on profiles');
    await denied(service,ratedSql,[...args.slice(0,6),{white:{rating:1600},black:{rating:1400,rd:200,vol:0.06}}]);
    assert.equal((await service.query(ratedSql,args)).rows[0].result.ok,true);
  });
  await check('security migration reruns and exact-policy rollback preserve application data',async()=>{
    const before=(await owner.query('select count(*) as count from coin_transactions')).rows[0].count;
    const file=await fs.readFile(path.join(root,'supabase/migrations/20261014_security_authorization.sql'),'utf8');
    await owner.query(file);
    await owner.query(await fs.readFile(path.join(root,'supabase/rollback/20261014_security_authorization.sql'),'utf8'));
    assert.equal((await owner.query("select * from pg_policies where tablename='friends' and policyname='friends_write_authenticated'")).rowCount,1);
    assert.equal((await owner.query("select * from pg_policies where tablename='friends' and policyname='friends_insert_sender'")).rowCount,0);
    await owner.query(file);
    assert.equal((await owner.query('select count(*) as count from coin_transactions')).rows[0].count,before);
    await denied(alice,"update profiles set \"maxUnlockedKenLevel\"=7 where \"usernameLower\"='alice'");
  });
  console.log(`${checks} database security checks passed in disposable PostgreSQL`);
} finally {
  for (const client of clients) await client.end();
  await owner.end();
  await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
  await admin.end();
}
