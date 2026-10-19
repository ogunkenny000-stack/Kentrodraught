/** Read-only Supabase schema contract. No database writes, no Auth users or user rows read.
 * For authenticated self-hosted/staging verification set SUPABASE_DB_URL in secret
 * settings and SUPABASE_SCHEMA_READONLY_CONFIRM=1; never commit URLs or keys. */
import { pathToFileURL } from 'node:url';

export const REQUIRED_TABLES = Object.freeze([
  'profiles','completed_games','tournaments','friends','private_messages',
  'coin_wallets','coin_transactions','guest_online_trials','kentro_notifications',
  'kentro_push_subscriptions','kentro_security_policy_backup','kentro_match_settlements','kentro_match_charges',
  'kentro_rated_matches','kentro_tournament_invites','kentro_groups',
  'kentro_group_members','kentro_group_messages'
]);
export const REQUIRED_COLUMNS = Object.freeze({
  profiles:['statsVersion'],
  completed_games:['private','participantUserIds'],
  tournaments:['engineVersion','engineState'],
});
export const REQUIRED_FUNCTIONS = Object.freeze([
  'guest_online_available','claim_guest_online_games','kentro_apply_rated_result',
  'kentro_settle_match_pot','kentro_charge_match_pot','kentro_coin_readiness','kentro_unlock_ai','kentro_create_withdrawal',
  'kentro_redeem_tournament_invite','kentro_commit_tournament',
  'kentro_pay_completed_tournament','kentro_group_action','kentro_group_feed',
  'kentro_group_list','kentro_group_view','kentro_account_active'
]);
export const REQUIRED_POLICIES = Object.freeze([
  ['completed_games','completed_games_select_visible'],
  ['tournaments','tournaments_select_visible'],
  ['friends','friends_insert_sender'],
  ['friends','friends_update_recipient'],
  ['kentro_notifications','kentro_notifications_read_own'],
  ['kentro_notifications','kentro_notifications_update_own'],
  ['kentro_groups','kentro_group_read'],
  ['kentro_group_members','kentro_member_read'],
  ['kentro_group_messages','kentro_group_message_read'],
]);
const key = (table,name) => `${table}:${name}`;
export function evaluateSchemaReadiness(snapshot) {
  const tables = new Map((snapshot.tables || []).map(x => [x.name,x.rls]));
  const columns = new Set((snapshot.columns || []).map(x => key(x.table,x.column)));
  const functions = new Set(snapshot.functions || []);
  const policies = new Set((snapshot.policies || []).map(x => key(x.table,x.name)));
  const issues = [];
  const warnings = [];
  for(const table of REQUIRED_TABLES) {
    if(!tables.has(table)) issues.push(`MISSING_TABLE public.${table}`);
    else if(!tables.get(table)) issues.push(`RLS_DISABLED public.${table}`);
  }
  for(const [table,required] of Object.entries(REQUIRED_COLUMNS)) {
    for(const column of required) if(!columns.has(key(table,column))) issues.push(`MISSING_COLUMN public.${table}.${column}`);
  }
  for(const fn of REQUIRED_FUNCTIONS) if(!functions.has(fn)) issues.push(`MISSING_RPC public.${fn}`);
  for(const [table,policy] of REQUIRED_POLICIES) if(!policies.has(key(table,policy))) issues.push(`MISSING_POLICY public.${table}.${policy}`);
  if(policies.has(key('completed_games','completed_games_write_authenticated'))) issues.push('LEGACY_BROAD_WRITE_POLICY completed_games_write_authenticated');
  if(policies.has(key('tournaments','tournaments_update_authenticated'))) issues.push('LEGACY_BROAD_WRITE_POLICY tournaments_update_authenticated');
  for(const fn of (snapshot.privileged || [])) {
    if(['resolve_username_to_email','handle_new_user','tournaments_money_guard'].includes(fn.name)
       && (fn.anon || fn.auth)) issues.push(`PUBLIC_PRIVILEGED_RPC public.${fn.name}`);
    if(fn.name === 'is_tournament_admin' && fn.anon) warnings.push('CHECK_EXECUTE_AUTHORIZATION public.is_tournament_admin callable by anon');
  }
  return {ready:issues.length===0,issues,warnings,checkedAt:new Date().toISOString(),mode:'read-only catalog checks; not a live feature acceptance test'};
}

// Running with a database connection requires explicit opt in and keeps the
// transaction read only even if a future developer accidentally adds SQL.
export async function inspectHostedCatalog(connectionString) {
  const {default: pg} = await import('pg');
  const client = new pg.Client({connectionString,connectionTimeoutMillis:10000,query_timeout:15000,application_name:'kentro_readonly_schema_preflight'});
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '12s'");
    const [tables,columns,functions,policies,privileged] = await Promise.all([
      client.query("select c.relname name,c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')"),
      client.query("select table_name as table,column_name as column from information_schema.columns where table_schema='public'"),
      client.query("select p.proname as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"),
      client.query("select tablename as table,policyname as name from pg_policies where schemaname='public'"),
      client.query("select p.proname as name,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') auth from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef")
    ]);
    await client.query('ROLLBACK');
    return { tables:tables.rows,columns:columns.rows,functions:functions.rows.map(x=>x.name),policies:policies.rows,privileged:privileged.rows };
  } catch(error) { await client.query('ROLLBACK').catch(()=>{});throw error; }
  finally { await client.end(); }
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(process.env.SUPABASE_SCHEMA_READONLY_CONFIRM!=='1'||!process.env.SUPABASE_DB_URL){
    console.error('PENDING: set SUPABASE_SCHEMA_READONLY_CONFIRM=1 and server-only SUPABASE_DB_URL. The database will not be changed.');
    process.exitCode=2;
  } else {
    try {
      const report=evaluateSchemaReadiness(await inspectHostedCatalog(process.env.SUPABASE_DB_URL));
      console.log(JSON.stringify(report,null,2));process.exitCode=report.ready?0:1;
    } catch(error) {console.error(`SCHEMA CHECK FAILED: ${error?.message?.replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[redacted]')||'unknown error'}`);process.exitCode=2;}
  }
}
