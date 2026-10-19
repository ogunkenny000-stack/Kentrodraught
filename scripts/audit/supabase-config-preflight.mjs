/** Configuration-only preflight; never calls production, reads or prints credentials. */
import { pathToFileURL } from 'node:url';

function normalizedOrigin(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return url.origin;
  } catch { return null; }
}

// Legacy Supabase JWT keys are opaque-looking, but their payload declares
// anon/service_role. Check it without logging or returning the key.
export function keyRole(value) {
  if (typeof value !== 'string' || !value) return null;
  if (value.startsWith('sb_secret_')) return 'service_role';
  if (value.startsWith('sb_publishable_')) return 'anon';
  const parts=value.split('.');
  if(parts.length!==3) return null;
  try {
    const parsed=JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return parsed?.role === 'service_role' ? 'service_role' : parsed?.role === 'anon' ? 'anon' : null;
  } catch {return null;}
}

export function inspectSupabaseConfig(env) {
  const errors = [];
  const browser = normalizedOrigin(env.VITE_SUPABASE_URL);
  const server = normalizedOrigin(env.SUPABASE_URL);
  if (!browser) errors.push('VITE_SUPABASE_URL must be a complete HTTPS project URL.');
  if (!server) errors.push('SUPABASE_URL must be a complete HTTPS project URL.');
  if (browser && server && browser !== server) errors.push('Browser and server Supabase URLs refer to different projects.');
  const publicKey = (env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  const secretKey = (env.SUPABASE_SECRET_KEY || '').trim();
  if (!publicKey || /placeholder|your[_ -]/i.test(publicKey)) errors.push('VITE_SUPABASE_PUBLISHABLE_KEY is not configured.');
  if (!secretKey || /placeholder|your[_ -]/i.test(secretKey)) errors.push('SUPABASE_SECRET_KEY is not configured on the server.');
  if (publicKey && secretKey && publicKey === secretKey) errors.push('Client and server keys must not be identical.');
  if (keyRole(publicKey)==='service_role') errors.push('A privileged Supabase key must never be placed in VITE_ variables.');
  if (secretKey && keyRole(secretKey)==='anon') errors.push('SUPABASE_SECRET_KEY must be a server-only secret or service-role credential, not a publishable/anon key.');
  if (env.SKIP_DB_MIGRATION !== '1') errors.push('Set SKIP_DB_MIGRATION=1 to prevent uncontrolled startup migrations.');
  if (env.NODE_ENV === 'production') {
    const app = normalizedOrigin(env.APP_URL);
    if (!app || app.includes('localhost') || app.includes('127.0.0.1')) errors.push('APP_URL must be the real HTTPS app origin in production.');
  }
  return { ok: errors.length === 0, errors, projectOrigin: browser && browser === server ? browser : null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = inspectSupabaseConfig(process.env);
  for (const error of result.errors) console.error('CONFIG ERROR:', error);
  if (result.ok) console.log('PASS: Supabase deployment configuration is internally consistent (credentials and hosted access NOT verified).');
  process.exitCode = result.ok ? 0 : 2;
}
