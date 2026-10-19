// Rebuild with Emscripten 3.1.74. Generated browser files are shipped for ordinary installs.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sources = fs.readdirSync(path.join(root, 'nd_upgraded'))
  .filter(f => f.endsWith('.cpp') && !['main.cpp', 'thread.cpp'].includes(f))
  .map(f => `nd_upgraded/${f}`);
fs.mkdirSync(path.join(root, 'public/engine'), { recursive: true });
const result = spawnSync(process.env.EMXX || 'em++', [...sources,
  '-std=c++14', '-O3', '-flto', '-fno-rtti', '-DNDEBUG', '-fexceptions',
  '-sDISABLE_EXCEPTION_CATCHING=0', '-sMODULARIZE=1', '-sEXPORT_NAME=createKenEngine',
  '-sENVIRONMENT=worker,node', '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=67108864',
  '-sMAXIMUM_MEMORY=536870912', '-sSTACK_SIZE=2097152',
  '-sEXPORTED_FUNCTIONS=["_ken_init","_ken_search"]',
  '-sEXPORTED_RUNTIME_METHODS=["ccall"]',
  '--embed-file', 'nd_upgraded/data/eval_nigerian@/data/eval_nigerian',
  '-o', 'public/engine/scan.js'], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
