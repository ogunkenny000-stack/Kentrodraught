import express from 'express';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAccountAuthRouter, type AccountAuthDependencies } from './accountAuth';

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); });
async function fixture(overrides: Partial<AccountAuthDependencies> = {}) {
  const deps = { configured: () => true, resolveEmail: vi.fn(async () => 'private@example.invalid'), signIn: vi.fn(async () => ({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', user: { id: 'own-account' } }) as any), resetPassword: vi.fn(async () => {}), ...overrides };
  const app = express(); app.use(express.json()); app.use('/api/auth', createAccountAuthRouter(deps));
  const server = app.listen(0, '127.0.0.1'); servers.push(server);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as any).port;
  const post = async (route: string, body: object) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
  };
  return { deps, post };
}

describe('server-mediated username authentication privacy', () => {
  it('resolves privately and returns only the successful account session', async () => {
    const { deps, post } = await fixture();
    const response = await post('login', { username: ' Alice ', password: 'example-password' });
    expect(deps.resolveEmail).toHaveBeenCalledWith('alice');
    expect(deps.signIn).toHaveBeenCalledWith('private@example.invalid', 'example-password');
    expect(response.status).toBe(200); expect(response.cache).toBe('no-store');
    expect(response.body.session.user.id).toBe('own-account');
    expect(JSON.stringify(response.body)).not.toContain('private@example.invalid');
  });
  it('does not distinguish a nonexistent username from a wrong password', async () => {
    const missing = await fixture({ resolveEmail: vi.fn(async () => null) });
    const wrong = await fixture({ signIn: vi.fn(async () => null) });
    const body = { username: 'alice', password: 'wrong' };
    expect(await missing.post('login', body)).toEqual(await wrong.post('login', body));
    expect(missing.deps.signIn).not.toHaveBeenCalled();
  });
  it('returns the same reset response for existing, absent and provider-failure accounts', async () => {
    const existing = await fixture();
    const absent = await fixture({ resolveEmail: vi.fn(async () => null) });
    const failing = await fixture({ resetPassword: vi.fn(async () => { throw new Error('private detail'); }) });
    const response = await existing.post('password-reset', { username: 'alice', redirectTo: 'https://attacker.invalid' });
    expect(await absent.post('password-reset', { username: 'missing' })).toEqual(response);
    expect(await failing.post('password-reset', { username: 'alice' })).toEqual(response);
    expect(existing.deps.resetPassword).toHaveBeenCalledWith('private@example.invalid');
    expect(absent.deps.resetPassword).not.toHaveBeenCalled();
  });
  it('validates inputs before attempting authentication', async () => {
    const { deps, post } = await fixture();
    for (const body of [{ username: {}, password: 'pw' }, { username: 'a'.repeat(65), password: 'pw' }, { username: 'alice', password: 'p'.repeat(1025) }]) expect((await post('login', body)).status).toBe(400);
    expect(deps.resolveEmail).not.toHaveBeenCalled();
  });
  it('fails closed without configuration and hides upstream error details', async () => {
    const absent = await fixture({ configured: () => false });
    expect((await absent.post('login', { username: 'alice', password: 'pw' })).status).toBe(503);
    const failing = await fixture({ resolveEmail: vi.fn(async () => { throw new Error('private database details'); }) });
    const response = await failing.post('login', { username: 'alice', password: 'pw' });
    expect(response.status).toBe(503); expect(JSON.stringify(response.body)).not.toContain('private database');
  });
  it('bounds attempts for the normalized account independently of supplied client IP headers', async () => {
    const { deps, post } = await fixture({ signIn: vi.fn(async () => null) });
    for (let i = 0; i < 12; i++) expect((await post('login', { username: i % 2 ? 'ALICE' : ' alice ', password: 'wrong' })).status).toBe(401);
    expect((await post('login', { username: 'Alice', password: 'wrong' })).status).toBe(429);
    expect(deps.resolveEmail).toHaveBeenCalledTimes(12);
    expect((await post('login', { username: 'Bob', password: 'wrong' })).status).toBe(401);
  });
  it('limits reset delivery while keeping repeated responses generic', async () => {
    const { deps, post } = await fixture();
    const first = await post('password-reset', { username: 'Alice' });
    for (let i = 0; i < 5; i++) expect(await post('password-reset', { username: ' alice ' })).toEqual(first);
    expect(deps.resetPassword).toHaveBeenCalledTimes(3);
  });
});
