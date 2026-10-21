// Self-contained regression tests; no third-party packages required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { gunzipSync, brotliDecompressSync } = require('node:zlib');
const { randomBytes } = require('node:crypto');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kentro-perf-'));
try {
  const dist = path.join(base, 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  const entry = '/assets/index-abc12345.js';
  const css = '/assets/index-abcd8765.css';
  const lazy = '/assets/KentroTV-beef9090.js';
  const nearby = '/assets/OfflineNearby-abcd1234.js';
  const analysis = '/assets/AnalysisSidebar-abcd1234.js';
  const wallet = '/assets/CoinsPurchaseModal-abcd1234.js';
  const payload = 'console.log("Kentro");'.repeat(1500);
  for (const [file, data] of [[entry, payload], [css, 'a{color:#fff}'.repeat(1500)], [lazy, payload]]) {
    fs.writeFileSync(path.join(dist, file.slice(1)), data);
  }
  fs.writeFileSync(path.join(dist, nearby.slice(1)), `import './index-abc12345.js'; import('/assets/KentroTV-beef9090.js');`);
  fs.writeFileSync(path.join(dist, analysis.slice(1)), `import './index-abc12345.js';`);
  fs.writeFileSync(path.join(dist, wallet.slice(1)), payload);
  fs.writeFileSync(path.join(dist, 'index.html'), `<html><link rel="stylesheet" href="${css}"><script type="module" src="${entry}"></script></html>`);
  fs.writeFileSync(path.join(dist, 'sw.js'), `const CACHE_VERSION = "kentro-old";\nconst PRECACHE_ASSETS = [];\n`);
  const env = { ...process.env, KENTRO_DIST_DIR: dist };
  execFileSync(process.execPath, [path.join(__dirname, 'inject-sw-assets.cjs')], { env });
  const sw = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
  assert(sw.includes(entry));
  assert(sw.includes(css));
  assert(sw.includes(nearby), 'Nearby must work after offline preparation');
  assert(!sw.includes(lazy), 'lazy TV must NOT download during install');
  assert(sw.includes(analysis), 'analysis must remain usable after offline preparation');
  assert(!sw.includes(wallet), 'network-only wallet must remain lazy');
  execFileSync(process.execPath, [path.join(__dirname, 'precompress-assets.cjs')], { env });
  const raw = fs.readFileSync(path.join(dist, entry.slice(1)));
  const gz = fs.readFileSync(path.join(dist, entry.slice(1) + '.gz'));
  const br = fs.readFileSync(path.join(dist, entry.slice(1) + '.br'));
  assert.deepEqual(gunzipSync(gz), raw);
  assert.deepEqual(brotliDecompressSync(br), raw);
  assert(br.byteLength < gz.byteLength);
  // Rebuilding a changed or deleted source must not leave stale variants.
  const entryFile = path.join(dist, entry.slice(1));
  fs.writeFileSync(entryFile, 'small revision');
  execFileSync(process.execPath, [path.join(__dirname, 'precompress-assets.cjs')], { env });
  for (const suffix of ['.gz', '.br']) assert(!fs.existsSync(entryFile + suffix), 'small source retains stale compression');
  fs.writeFileSync(entryFile, randomBytes(4096));
  for (const suffix of ['.gz', '.br']) fs.writeFileSync(entryFile + suffix, 'stale');
  execFileSync(process.execPath, [path.join(__dirname, 'precompress-assets.cjs')], { env });
  for (const suffix of ['.gz', '.br']) assert(!fs.existsSync(entryFile + suffix), 'incompressible source retains stale compression');
  fs.unlinkSync(entryFile);
  for (const suffix of ['.gz', '.br']) fs.writeFileSync(entryFile + suffix, 'orphan');
  execFileSync(process.execPath, [path.join(__dirname, 'precompress-assets.cjs')], { env });
  for (const suffix of ['.gz', '.br']) assert(!fs.existsSync(entryFile + suffix), 'removed source retains orphan compression');
  console.log(`Startup + nearby caching: PASS (TV remains lazy); gzip + Brotli byte-perfect: PASS (raw ${raw.length}, gzip ${gz.length}, Brotli ${br.length})`);
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
