import express from 'express';
import { getSupabaseAdmin, verifyAccessToken } from '../../supabaseAdmin';
import { requestAccessToken } from './httpAuth';

interface InviteResult { ok?: boolean; error?: string; tournament?: Record<string, unknown> }
export interface TournamentInviteDependencies {
  verify(token: string | undefined): Promise<string | null>;
  redeem(owner: string, code: string): Promise<InviteResult>;
}
const defaults: TournamentInviteDependencies = {
  verify: verifyAccessToken,
  async redeem(owner, code) {
    const { data, error } = await getSupabaseAdmin().rpc('kentro_redeem_tournament_invite', { p_owner: owner, p_code: code });
    if (error) throw new Error('Invitation lookup unavailable');
    return data;
  },
};

/** The caller's verified UID, never a body UID, receives private read access.
 * Mount behind the separate bounded invite rate limiter. */
export function createTournamentInviteRouter(deps: TournamentInviteDependencies = defaults) {
  const router = express.Router();
  router.post('/invite', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const owner = await deps.verify(requestAccessToken(req.headers));
      if (!owner) return res.status(401).json({ error: 'Sign in to use a tournament invitation.' });
      const code = typeof req.body?.inviteCode === 'string' ? req.body.inviteCode.trim().toUpperCase() : '';
      if (!/^[A-Z0-9_-]{4,64}$/.test(code)) return res.status(400).json({ error: 'Enter a valid tournament invitation code.' });
      const result = await deps.redeem(owner, code);
      if (result?.error === 'not_open') return res.status(410).json({ error: 'This tournament invitation is no longer open.' });
      if (!result?.ok || !result.tournament) return res.status(404).json({ error: 'Tournament invitation was not found.' });
      return res.json({ tournament: result.tournament });
    } catch {
      return res.status(503).json({ error: 'Tournament invitations are temporarily unavailable.' });
    }
  });
  return router;
}
