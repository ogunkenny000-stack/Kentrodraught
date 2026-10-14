// Build-time Brotli + gzip compression. Both the Go edge and Node static
// server can serve these files without doing compression on a live request.
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync, brotliCompressSync, constants } = require('node:zlib');
const root = process.env.KENTRO_DIST_DIR || path.resolve(__dirname, '..', 'dist');
const counts = { gzip: 0, brotli: 0 };
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(file); continue; }
    if (!/\.(?:js|css|html|json|svg|txt)$/.test(entry.name)) continue;
    const data = fs.readFileSync(file);
    if (data.length < 1024) continue;
    const variants = [
      ['gzip', '.gz', gzipSync(data, { level: 8 })],
      ['brotli', '.br', brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })],
    ];
    for (const [name, ext, compressed] of variants) {
      if (compressed.length < data.length) {
        fs.writeFileSync(file + ext, compressed);
        counts[name]++;
      }
    }
  }
}
if (!fs.existsSync(root)) throw new Error('dist missing; run npm run build first');
walk(root);
console.log(`[Kentro] Precompressed ${counts.gzip} gzip and ${counts.brotli} Brotli files at build time`);
