// Dependency-free integrity checks for the royal Nigerian board upgrade.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (pathIn) => fs.readFileSync(path.join(root, pathIn), 'utf8');
const screen = read('src/components/game/GameScreen.tsx');
const nearby = read('src/components/game/OfflineNearby.tsx');
const replay = read('src/components/KentroTV.tsx');
const css = read('src/index.css');
const logic = read('src/gameLogic.ts');
assert(screen.includes('grid-cols-10 grid-rows-10'));
assert(screen.includes('ngRcToSq(r, c)'));
assert(screen.includes('handleSquareClick(sq)'));
assert(screen.includes('kentro-royal-piece--gold'));
assert(screen.includes('kentro-royal-frame'));
assert(nearby.includes('ngRcToSq(row, col)'));
assert(nearby.includes('clickSquare(sq)'));
assert(nearby.includes('kentro-royal-frame'));
assert(replay.includes('ngRcToSq(row, col)'));
assert(replay.includes('kentro-royal-frame'));
assert(logic.includes('ngRcToSq'));
for (const file of ['black.webp', 'gold.webp', 'dark.webp', 'light.webp']) {
  const asset = `public/board/royal-wood/${file}`;
  assert(fs.statSync(path.join(root, asset)).size > 600, `${asset} missing or too small`);
  assert(css.includes(`/board/royal-wood/${file}`), `${file} not connected to CSS`);
}
console.log('PASS: Nigerian 10x10 board geometry, move handlers, replays, and 4 royal visual assets');
