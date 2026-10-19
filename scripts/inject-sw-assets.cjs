/**
 * Precache startup and nearby offline assets. Fetching every lazy route during service
 * worker install cancels out React code splitting, causing large first-load
 * downloads on Nigerian mobile networks. Nearby gameplay is the deliberate
 * exception: it must open without a backend once the app has prepared offline.
 * Other lazy chunks are cached on first use by the worker's fetch handler.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const distDir = process.env.KENTRO_DIST_DIR || path.join(process.cwd(), "dist");
const assetsDir = path.join(distDir, "assets");
const swPath = path.join(distDir, "sw.js");
if (!fs.existsSync(assetsDir) || !fs.existsSync(swPath)) {
  throw new Error("[inject-sw-assets] dist/assets or dist/sw.js missing; run vite build first.");
}
const html = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
// Vite includes the entry script and any startup CSS/modulepreload links in
// index.html. The rest is genuinely lazy and shouldn't be pre-downloaded.
const precacheSet = new Set([...html.matchAll(/(?:src|href)=["'](\/assets\/[^"'?]+\.(?:js|css|wasm))["']/g)]
  .map((match) => match[1])
  .filter((uri) => uri.startsWith("/assets/") && !uri.includes("..") &&
    fs.existsSync(path.join(distDir, uri.slice(1)))));
const nearby = fs.readdirSync(assetsDir).find(name => /^OfflineNearby-[\w-]+\.js$/.test(name));
if (!nearby) throw new Error("[inject-sw-assets] Nearby offline bundle missing.");
const visited = new Set();
function addStaticImports(uri) {
  if (visited.has(uri)) return;
  visited.add(uri);
  const filename = path.join(distDir, uri.slice(1));
  if (!uri.startsWith("/assets/") || !fs.existsSync(filename)) throw new Error(`[inject-sw-assets] Missing offline dependency: ${uri}`);
  precacheSet.add(uri);
  if (!uri.endsWith(".js")) return;
  const source = fs.readFileSync(filename, "utf8");
  // Static imports only. Traversing import(...) would also download every
  // optional route referenced by the entry bundle, defeating code splitting.
  for (const match of source.matchAll(/\b(?:from|import)\s*["']([^"']+)["']/g)) {
    if (!match[1].startsWith(".") || !/\.(?:js|css|wasm)$/.test(match[1])) continue;
    addStaticImports(path.posix.normalize(path.posix.join(path.posix.dirname(uri), match[1])));
  }
}
addStaticImports(`/assets/${nearby}`);
// Prepare the full local engine even before its first match.
const offlineKen = fs.readdirSync(assetsDir).find(name => /^OfflineKen-[\w-]+\.js$/.test(name));
if (offlineKen) {
  addStaticImports(`/assets/${offlineKen}`);
  for (const name of ['scan.js', 'scan.wasm', 'ken-worker.js']) {
    const uri = `/engine/${name}`;
    if (!fs.existsSync(path.join(distDir, uri.slice(1)))) throw new Error(`Missing offline engine: ${uri}`);
    precacheSet.add(uri);
  }
}
const precache = [...precacheSet].sort();
if (!precache.some((uri) => uri.endsWith(".js"))) {
  throw new Error("[inject-sw-assets] Could not identify the entry JavaScript bundle in index.html.");
}
let sw = fs.readFileSync(swPath, "utf8");
const versionPattern = /const CACHE_VERSION = "[^"]*";/;
const assetsPattern = /const PRECACHE_ASSETS = \[[\s\S]*?\];/;
if (!versionPattern.test(sw) || !assetsPattern.test(sw)) {
  throw new Error("[inject-sw-assets] Service worker precache/version placeholders missing.");
}
const hash = crypto.createHash("sha256");
hash.update(sw.replace(versionPattern, 'const CACHE_VERSION = "";').replace(assetsPattern, "const PRECACHE_ASSETS = [];"));
hash.update(html);
for (const asset of precache) {
  hash.update(asset);
  hash.update(fs.readFileSync(path.join(distDir, asset.slice(1))));
}
const version = hash.digest("hex").slice(0, 16);
sw = sw.replace(versionPattern, `const CACHE_VERSION = "kentro-draught-${version}";`)
  .replace(assetsPattern, `const PRECACHE_ASSETS = ${JSON.stringify(precache, null, 2)};`);
fs.writeFileSync(swPath, sw);
console.log(`[inject-sw-assets] Startup and nearby offline assets: ${precache.length}. Other feature chunks load only when opened.`);
