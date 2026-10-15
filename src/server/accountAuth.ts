import express from 'express';
import { createClient, type Session } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../../supabaseAdmin';

export interface AccountAuthDependencies {
  configured(): boolean;
  resolveEmail(username: string): Promise<string | null>;
  signIn(email: string, password: string): Promise<Session | null>;
  resetPassword(email: string): Promise<void>;
}

// Password grants must never mutate the shared service-role client's session.
function isolatedAuthClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) }) },
  });
}

const defaults: AccountAuthDependencies = {
  configured: () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY),
  async resolveEmail(username) {
    if (username === 'kentro_house') return null;
    const { data, error } = await getSupabaseAdmin().rpc('resolve_username_to_email', { p_username: username });
    if (error) throw new Error('Account lookup unavailable');
    return typeof data === 'string' && data ? data : null;
  },
  async signIn(email, password) {
    const { data, error } = await isolatedAuthClient().auth.signInWithPassword({ email, password });
    return error ? null : data.session;
  },
  async resetPassword(email) {
    // Use the configured app URL or Supabase's approved Site URL. A caller
    // cannot choose the host receiving password-reset credentials.
    const appUrl = process.env.APP_URL;
    let redirectTo: string | undefined;
    if (appUrl) {
      const url = new URL(appUrl);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid app URL');
      redirectTo = url.origin;
    }
    const { error } = await isolatedAuthClient().auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw new Error('Password recovery unavailable');
  },
};

/** Mounted behind the server's separate bounded auth rate limit. The browser
 * receives its own successful session; anonymous requests never resolve a
 * username to another person's account email. */
export function createAccountAuthRouter(deps: AccountAuthDependencies = defaults) {
  const router = express.Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.post('/login', async (req, res) => {
    if (!deps.configured()) return res.status(503).json({ error: 'Sign-in is not configured.' });
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!username || username.length > 64 || !password || password.length > 1024) {
      return res.status(400).json({ error: 'Enter a valid username and password.' });
    }
    try {
      const email = await deps.resolveEmail(username);
      const session = email ? await deps.signIn(email, password) : null;
      if (!session) return res.status(401).json({ error: 'Invalid username or password.' });
      return res.json({ session });
    } catch {
      return res.status(503).json({ error: 'Sign-in is temporarily unavailable. Please try again.' });
    }
  });
  router.post('/password-reset', async (req, res) => {
    if (!deps.configured()) return res.status(503).json({ error: 'Password recovery is not configured.' });
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    if (!username || username.length > 64) return res.status(400).json({ error: 'Enter a valid username.' });
    try {
      const email = await deps.resolveEmail(username);
      if (email) await deps.resetPassword(email);
    } catch {
      // Keep absent accounts and provider failures indistinguishable. The
      // recovery UI gives the user a retry path without an email directory.
    }
    return res.json({ ok: true, message: 'If this account exists, password recovery instructions have been sent.' });
  });
  return router;
}
