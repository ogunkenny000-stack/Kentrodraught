import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import type { Server } from 'node:http';
import { mountProductionStatic, encodingQuality } from './staticAssets';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'kentro-static-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'assets'));
  writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Kentro</title>');
  writeFileSync(path.join(root, 'server.cjs'), 'private backend');
  writeFileSync(path.join(root, 'server.cjs.map'), 'private source map');
  writeFileSync(path.join(root, 'kentro-edge'), 'private binary');
  const raw = 'console.log("hello");'.repeat(100);
  writeFileSync(path.join(root, 'assets/app-abcdefgh.js'), raw);
  writeFileSync(path.join(root, 'assets/app-abcdefgh.js.gz'), gzipSync(raw));
  writeFileSync(path.join(root, 'assets/app-abcdefgh.js.br'), brotliCompressSync(raw));
  const app = express(); mountProductionStatic(app, root);
  const server = await new Promise<Server>(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  cleanups.push(() => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }));
  return { raw, url: `http://127.0.0.1:${(server.address() as any).port}` };
}

describe('production asset isolation and negotiation', () => {
  it('never serves backend bundles, compressed variants or source maps', async () => {
    const { url } = await setup();
    for (const name of ['server.cjs', 'server.cjs.map', 'server.cjs.gz', 'kentro-edge', 'assets/app-abcdefgh.js.br']) expect((await fetch(`${url}/${name}`)).status, name).toBe(404);
  });
  it('returns 404 for missing scripts/APIs while supporting SPA navigation', async () => {
    const { url } = await setup();
    expect((await fetch(`${url}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${url}/api/missing`)).status).toBe(404);
    expect(await (await fetch(`${url}/arena`)).text()).toContain('<title>Kentro');
  });
  it('selects the preferred allowed representation and varies identity too', async () => {
    const { url, raw } = await setup();
    for (const [header, expected] of [['br;q=0.3,gzip;q=0.9', 'gzip'], ['br;q=0,gzip;q=0', null], ['br;q=0.3,identity;q=1', null], ['*;q=0.8', 'br']] as const) {
      const response = await fetch(`${url}/assets/app-abcdefgh.js`, { headers: { 'Accept-Encoding': header } });
      expect(response.status).toBe(200); expect(response.headers.get('content-encoding')).toBe(expected);
      expect(response.headers.get('vary')).toContain('Accept-Encoding'); expect(await response.text()).toBe(raw);
      expect(response.headers.get('cache-control')).toContain('immutable');
    }
  });
  it('returns 406 when every available representation is refused', async () => {
    const { url } = await setup();
    expect((await fetch(`${url}/assets/app-abcdefgh.js`, { headers: { 'Accept-Encoding': '*;q=0' } })).status).toBe(406);
    expect(encodingQuality('gzip;q=0, *;q=1', 'gzip')).toBe(0);
  });
});
