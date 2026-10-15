// Self-contained regression tests; no third-party packages required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { gunzipSync, brotliDecompressSync } = require('node:zlib');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kentro-perf-'));
try {
  const dist = path.join(base, 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  const entry = '/assets/index-abc12345.js';
  const css = '/assets/index-abcd8765.css';
  const lazy = '/assets/KentroTV-beef9090.js';
  const payload = 'console.log("Kentro");'.repeat(1500);
  for (const [file, data] of [[entry, payload], [css, 'a{color:#fff}'.repeat(1500)], [lazy, payload]]) {
    fs.writeFileSync(path.join(dist, file.slice(1)), data);
  }
  fs.writeFileSync(path.join(dist, 'index.html'), `<html><link rel="stylesheet" href="${css}"><script type="module" src="${entry}"></script></html>`);
  fs.writeFileSync(path.join(dist, 'sw.js'), `const CACHE_VERSION = "kentro-old";\nconst PRECACHE_ASSETS = [];\n`);
  const env = { ...process.env, KENTRO_DIST_DIR: dist };
  execFileSync(process.execPath, [path.join(__dirname, 'inject-sw-assets.cjs')], { env });
  const sw = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
  assert(sw.includes(entry));
  assert(sw.includes(css));
  assert(!sw.includes(lazy), 'lazy TV must NOT download during install');
  execFileSync(process.execPath, [path.join(__dirname, 'precompress-assets.cjs')], { env });
  const raw = fs.readFileSync(path.join(dist, entry.slice(1)));
  const gz = fs.readFileSync(path.join(dist, entry.slice(1) + '.gz'));
  const br = fs.readFileSync(path.join(dist, entry.slice(1) + '.br'));
  assert.deepEqual(gunzipSync(gz), raw);
  assert.deepEqual(brotliDecompressSync(br), raw);
  assert(br.byteLength < gz.byteLength);
  fs.writeFileSync(path.join(dist, entry.slice(1)), 'small');
  execFileSync(process.execPath, [path.join(__dirname, 'precompress-assets.cjs')], { env });
  assert(!fs.existsSync(path.join(dist, entry.slice(1) + '.gz')), 'shrunk asset must not retain stale gzip bytes');
  assert(!fs.existsSync(path.join(dist, entry.slice(1) + '.br')), 'shrunk asset must not retain stale Brotli bytes');
  console.log(`Startup lazy-loading: PASS (2 of 3 bundles preloaded); gzip + Brotli byte-perfect: PASS (raw ${raw.length}, gzip ${gz.length}, Brotli ${br.length})`);
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
