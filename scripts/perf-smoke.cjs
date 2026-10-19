// Quick non-destructive HTTP timing smoke test, no external dependencies.
// Run only against a local test service. e.g. node scripts/perf-smoke.cjs http://127.0.0.1:3000
const target = process.argv[2] || 'http://127.0.0.1:3000';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(target)) {
  console.error('Safety: only local test servers are supported.');
  process.exit(1);
}
const routes = ['/', '/api/games/recent?limit=1'];
function percentile(data, p) { const x = [...data].sort((a,b)=>a-b); return x[Math.min(x.length-1, Math.ceil(x.length*p)-1)].toFixed(1); }
(async () => {
  for (const route of routes) {
    const times = [];
    for (let i=0;i<30;i++) {
      const start = performance.now();
      const response = await fetch(target+route, { headers: {'Cache-Control':'no-cache'}, signal: AbortSignal.timeout(5000) });
      await response.arrayBuffer();
      times.push(performance.now()-start);
      if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
    }
    console.log(`${route}: ${times.length} requests; p50=${percentile(times,0.5)}ms p95=${percentile(times,0.95)}ms`);
  }
})().catch((e)=>{ console.error(e.message); process.exitCode=1; });
