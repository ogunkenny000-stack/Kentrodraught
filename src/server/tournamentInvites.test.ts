import express from 'express';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTournamentInviteRouter } from './tournamentInvites';

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))); });
async function fixture() {
  const verify = vi.fn().mockResolvedValue('verified-owner');
  const redeem = vi.fn().mockResolvedValue({ ok: true, tournament: { id: 'private-tour', visibility: 'private' } });
  const app = express(); app.use(express.json()); app.use('/api/tournaments', createTournamentInviteRouter({ verify, redeem }));
  const server = createServer(app); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const request = (body: unknown, headers: Record<string, string> = { 'x-access-token': 'token' }) => fetch(`http://127.0.0.1:${port}/api/tournaments/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { verify, redeem, request };
}
describe('private tournament invitation facade', () => {
  it('binds redemption to the verified identity, normalizes the code, and prevents cached disclosure', async () => {
    const { request, verify, redeem } = await fixture();
    const response = await request({ inviteCode: '  aBcD_1234  ', ownerId: 'attacker-selected-owner' });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(verify).toHaveBeenCalledExactlyOnceWith('token'); expect(redeem).toHaveBeenCalledExactlyOnceWith('verified-owner', 'ABCD_1234');
    expect(await response.json()).toEqual({ tournament: { id: 'private-tour', visibility: 'private' } });
  });
  it('does not query an invitation for unauthenticated callers', async () => {
    const { request, verify, redeem } = await fixture(); verify.mockResolvedValue(null);
    expect((await request({ inviteCode: 'ABCD' })).status).toBe(401); expect(redeem).not.toHaveBeenCalled();
  });
  it.each(['', 'A', 'abc/def', 'A'.repeat(65), null, ['ABCD']])('rejects invalid invitation input before querying the database', async inviteCode => {
    const { request, redeem } = await fixture(); expect((await request({ inviteCode })).status).toBe(400); expect(redeem).not.toHaveBeenCalled();
  });
  it('returns generic missing and closed states without leaking a private record', async () => {
    const { request, redeem } = await fixture(); redeem.mockResolvedValue({ ok: false, error: 'not_found' });
    const missing = await request({ inviteCode: 'UNKNOWN' }); expect(missing.status).toBe(404); expect(await missing.json()).toEqual({ error: 'Tournament invitation was not found.' });
    redeem.mockResolvedValue({ ok: false, error: 'not_open' }); expect((await request({ inviteCode: 'CLOSED' })).status).toBe(410);
  });
  it('fails closed when database lookup or auth fails', async () => {
    const { request, verify, redeem } = await fixture(); redeem.mockRejectedValue(new Error('provider-secret-detail'));
    const response = await request({ inviteCode: 'ABCD' }); expect(response.status).toBe(503); expect(await response.text()).not.toContain('provider-secret-detail');
    verify.mockRejectedValue(new Error('auth failure')); expect((await request({ inviteCode: 'ABCD' })).status).toBe(503);
  });
});
