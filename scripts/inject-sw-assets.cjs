/**
 * Post-build step: precache this build's runtime assets, including lazy chunks.
 * This makes the installed app shell load reliably offline. The C++ Ken engine,
 * multiplayer, accounts and other server-backed actions still need a connection.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const distDir = path.join(process.cwd(), "dist");
const assetsDir = path.join(distDir, "assets");
const swPath = path.join(distDir, "sw.js");

if (!fs.existsSync(assetsDir) || !fs.existsSync(swPath)) {
  throw new Error("[inject-sw-assets] dist/assets or dist/sw.js missing; run vite build first.");
}

function runtimeAssets(dir, prefix = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) return runtimeAssets(path.join(dir, entry.name), relative + "/");
    return entry.isFile() && /\.(?:js|css|wasm)$/.test(entry.name)
      ? ["/assets/" + relative] : [];
  });
}
const precache = runtimeAssets(assetsDir).sort();
if (precache.length === 0) throw new Error("[inject-sw-assets] No runtime assets were emitted.");

let sw = fs.readFileSync(swPath, "utf8");
const versionPattern = /const CACHE_VERSION = "[^"]*";/;
const assetsPattern = /const PRECACHE_ASSETS = \[[\s\S]*?\];/;
if (!versionPattern.test(sw) || !assetsPattern.test(sw)) {
  throw new Error("[inject-sw-assets] Service worker precache/version placeholders are missing.");
}
// Stable for identical output, but changes for shell, worker or runtime changes.
const hash = crypto.createHash("sha256");
hash.update(sw.replace(versionPattern, 'const CACHE_VERSION = "";').replace(assetsPattern, 'const PRECACHE_ASSETS = [];'));
hash.update(fs.readFileSync(path.join(distDir, "index.html")));
for (const asset of precache) {
  hash.update(asset);
  hash.update(fs.readFileSync(path.join(distDir, asset.slice(1))));
}
const version = hash.digest("hex").slice(0, 16);
sw = sw.replace(versionPattern, `const CACHE_VERSION = "kentro-draught-${version}";`)
  .replace(assetsPattern, `const PRECACHE_ASSETS = ${JSON.stringify(precache, null, 2)};`);
fs.writeFileSync(swPath, sw);
console.log(`[inject-sw-assets] precached ${precache.length} runtime asset(s).`);
