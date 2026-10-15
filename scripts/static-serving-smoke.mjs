// Regression coverage for real production static serving and compression.
// Start an isolated local production server, then pass its loopback HTTP origin.
import http from 'node:http';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
const target = new URL(process.argv[2] || 'http://127.0.0.1:8126');
assert(target.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(target.hostname)
  && target.pathname === '/' && !target.username && !target.password && !target.search, 'Only loopback test origins are permitted');
const asset = fs.readdirSync('dist/assets').find(name => /^index-.+\.js$/.test(name));
assert(asset, 'Built entry JavaScript missing');
const raw = fs.readFileSync('dist/assets/' + asset);
const request = (route, headers = {}) => new Promise((resolve,reject) => {
  const req = http.get(new URL(route,target),{headers},response => {
    const chunks=[]; response.on('error',reject); response.on('data',chunk=>chunks.push(chunk));
    response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));
  });
  req.setTimeout(5000,()=>req.destroy(new Error('Request timed out'))); req.on('error',reject);
});
for (const [header,encoding] of [['identity',''],['br, gzip','br'],['br;q=0.1,gzip;q=1','gzip'],['br;q=0,gzip;q=0',''],['identity;q=1,br;q=0.1,gzip;q=0.1','']]) {
  const response=await request('/assets/'+asset,{'Accept-Encoding':header});
  assert.equal(response.status,200);assert.equal(response.headers['content-encoding']||'',encoding);
  assert.match(response.headers.vary,/Accept-Encoding/i);assert.match(response.headers['cache-control'],/immutable/);
  const body=encoding==='br'?brotliDecompressSync(response.body):encoding==='gzip'?gunzipSync(response.body):response.body;
  assert.deepEqual(body,raw);
}
for(const header of ['identity;q=0,br;q=0,gzip;q=0','*;q=0'])assert.equal((await request('/assets/'+asset,{'Accept-Encoding':header})).status,406);
for(const route of ['/server.cjs','/server.cjs.map','/.env','/assets/missing.js','/missing.png'])assert.equal((await request(route)).status,404,route);
assert.equal((await request('/room/invite')).status,200);
const health=await request('/api/health');assert.equal(health.status,200);assert.equal(health.headers['cache-control'],'no-store');
assert.equal((await request('/api/unknown')).status,404);
console.log('Production static/cache/compression/API regression checks PASS');
