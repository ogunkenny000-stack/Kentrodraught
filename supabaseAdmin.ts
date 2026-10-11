import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase admin client setup, used ONLY for operations that must be trusted
 * by the server and cannot be safely left to client-side RLS policies --
 * specifically: Kentro Coin wallet balances (money is involved; "balances
 * can never become negative" and "every deduction must be verified by the
 * server" per spec) and verifying that a request claiming to be from an
 * admin actually comes from a Supabase user id registered as one.
 *
 * SETUP (required before any of this works):
 *   1. Go to your project's Settings -> API Keys in the Supabase dashboard.
 *   2. Copy the Secret key (starts `sb_secret_...`) from the API Keys tab --
 *      or, on an older project still on legacy keys, the service_role key
 *      from the Legacy API Keys tab. Either works identically here.
 *   3. Set it as an environment variable (do NOT commit it):
 *        SUPABASE_URL='https://<your-project-ref>.supabase.co'
 *        SUPABASE_SECRET_KEY='<the secret / service_role key>'
 *   4. Restart the server.
 *
 * Until this is set, every coin-wallet and admin-verification operation
 * fails loudly (see the error thrown in getSupabaseAdmin()) rather than
 * silently falling back to an insecure client-side path.
 */

let client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SECRET_KEY are not set. Kentro Coins and admin-verified actions " +
        "cannot run without them -- see the setup comment at the top of supabaseAdmin.ts."
    );
  }

  client = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}

/**
 * Verifies a Supabase access token sent by the client (via
 * `supabase.auth.getSession()`'s access_token) and returns the verified user
 * id, or null if the token is missing/invalid/expired. Every privileged HTTP
 * endpoint (coin credit, admin actions) must call this -- never trust a uid
 * or username the client just includes in the request body, since that's
 * exactly as fake-able as the old "click button, get premium free" bug this
 * whole system replaced.
 */
export async function verifyAccessToken(accessToken: string | undefined | null): Promise<string | null> {
  if (!accessToken) return null;
  try {
    const { data, error } = await getSupabaseAdmin().auth.getUser(accessToken);
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}
