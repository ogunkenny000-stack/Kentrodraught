/** Starts the built server on loopback without any hosted credentials. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'kentro-production-smoke-'));
const env = { ...process.env, NODE_ENV: 'production', PORT: '38127', KENTRO_COINS_ENABLED: '0', SKIP_DB_MIGRATION: '1', KENTRO_DATA_DIR: runtime };
for (const key of Object.keys(env)) if (/SUPABASE|BOOTSTRAP|PROGRESSION_SECRET|VAPID/.test(key)) delete env[key];
const proc = spawn(process.execPath, ['dist/server.cjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
for (const stream of [proc.stdout, proc.stderr]) stream.on('data', chunk => output += chunk);
const evidence = { mode: 'local production bundle without hosted credentials', checks: [], productionAcceptance: false };
try {
  for (let i = 0; i < 60; i++) {
    if (proc.exitCode !== null) throw Error('Server exited: ' + output.slice(-2000));
    try { if ((await fetch('http://127.0.0.1:38127/api/health')).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  for (const [route, status] of [['/api/health', 200], ['/api/coins/settings', 200], ['/api/coins/wallet/alice', 503], ['/', 200], ['/server.cjs', 404]]) {
    const response = await fetch('http://127.0.0.1:38127' + route);
    if (response.status !== status) throw Error(route + ' returned ' + response.status);
    if (route === '/api/coins/settings' && (await response.json()).coinsEnabled !== false) throw Error('Money unexpectedly enabled');
    evidence.checks.push({ route, status });
  }
  evidence.status = 'PASS';
} catch (error) {
  evidence.status = 'BLOCKED_OR_FAIL'; evidence.reason = error.message; process.exitCode = 1;
} finally {
  proc.kill('SIGTERM');
  await Promise.race([new Promise(resolve => proc.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 2000))]);
  if (proc.exitCode === null) proc.kill('SIGKILL');
  evidence.checkedAt = new Date().toISOString();
  fs.mkdirSync('docs/audit/evidence/finance-rollout-20261017', { recursive: true });
  fs.writeFileSync('docs/audit/evidence/finance-rollout-20261017/production-smoke.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
  fs.rmSync(runtime, { recursive: true, force: true });
}
