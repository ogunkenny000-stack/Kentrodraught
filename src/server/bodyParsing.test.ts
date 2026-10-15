import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { installBodyParsing } from './bodyParsing';

const servers: ReturnType<express.Express['listen']>[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function fixture() {
  const app = express();
  installBodyParsing(app, async req => req.headers.authorization === 'local-fixture-admin');
  app.post('*', (req, res) => res.json({ length: req.body?.text?.length ?? 0 }));
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return (route: string, body: string, authorized = false) => fetch(origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'local-fixture-admin' } : {}) }, body });
}

it('rejects large ordinary requests and returns a JSON error', async () => {
  const post = await fixture();
  const response = await post('/api/engine/move', JSON.stringify({ text: 'x'.repeat(1024 * 1024) }));
  expect(response.status).toBe(413);
  expect((await response.json()).error).toContain('too large');
});

it('authorizes a large import before parsing and retains the authorized import allowance', async () => {
  const post = await fixture();
  const body = JSON.stringify({ text: 'x'.repeat(1024 * 1024 + 1) });
  expect((await post('/api/admin/puzzles/sql-file', body)).status).toBe(403);
  const response = await post('/api/admin/puzzles/sql-file', body, true);
  expect(response.status).toBe(200);
  expect((await response.json()).length).toBe(1024 * 1024 + 1);
});

it('reports invalid JSON without a development stack page', async () => {
  const post = await fixture();
  const response = await post('/api/auth/login', '{');
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid JSON request body.' });
});
