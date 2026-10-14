/**
 * Precache ONLY startup assets. Fetching every lazy route during service
 * worker install cancels out React code splitting, causing large first-load
 * downloads on Nigerian mobile networks. Lazy chunks are cached on first use
 * by the worker's existing /assets/ cache-first fetch handler.
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
const precache = [...new Set([...html.matchAll(/(?:src|href)=["'](\/assets\/[^"'?]+\.(?:js|css|wasm))["']/g)]
  .map((match) => match[1])
  .filter((uri) => uri.startsWith("/assets/") && !uri.includes("..") &&
    fs.existsSync(path.join(distDir, uri.slice(1)))))]
  .sort();
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
console.log(`[inject-sw-assets] Startup assets: ${precache.length}. Other feature chunks load only when opened.`);
