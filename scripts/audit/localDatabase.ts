/** Auth schema fixture for local PostgreSQL only; never a hosted Supabase test. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
export async function localDatabase() {
  const raw = process.env.AUDIT_PG_URL;
  if (!raw) throw new Error('Set AUDIT_PG_URL to disposable local PostgreSQL.');
  const url = new URL(raw);
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('Only loopback databases are allowed.');
  const admin = new Client({connectionString:raw}); await admin.connect();
  const name = 'kentro_fixture_'+process.pid+'_'+Date.now();
  await admin.query('create database '+name); url.pathname='/'+name;
  const db = new Client({connectionString:url.toString()}); await db.connect();
  const root=process.cwd();
  try {
    for(const file of ['scripts/audit/supabase-fixture.sql','supabase/schema.sql'])await db.query(await fs.readFile(path.join(root,file),'utf8'));
    for(const file of (await fs.readdir(path.join(root,'supabase/migrations'))).filter(f=>f.endsWith('.sql')).sort())await db.query(await fs.readFile(path.join(root,'supabase/migrations',file),'utf8'));
  } catch(error) { await db.end();await admin.query('drop database '+name+' with (force)');await admin.end();throw error; }
  return {db,url:url.toString(),async close(){await db.end();await admin.query('drop database '+name+' with (force)');await admin.end();}};
}
