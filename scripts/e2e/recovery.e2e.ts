/** Real recovery UI with an explicit in-browser Auth response fixture. No
 * hosted password, account or email is changed; off-origin traffic is blocked. */
import { APP_URL, TEST_USERS, assert, launchChrome, waitForText } from './harness';

const origin = new URL(APP_URL);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Recovery fixtures require loopback');
const browser = await launchChrome();
const user = { id: TEST_USERS.A.uid, email: TEST_USERS.A.email, aud: 'authenticated', role: 'authenticated',
  app_metadata: {}, user_metadata: { username: TEST_USERS.A.username }, identities: [], created_at: new Date().toISOString() };
let updates = 0;
async function pageFor(signedIn: boolean) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setRequestInterception(true);
  page.on('request', request => {
    const destination = new URL(request.url());
    if (destination.origin === origin.origin || !['http:', 'https:'].includes(destination.protocol)) return void request.continue();
    if (signedIn && destination.hostname === 'placeholder.supabase.co' && destination.pathname === '/auth/v1/user' && request.method() === 'OPTIONS') {
      return void request.respond({ status: 204, headers: { 'access-control-allow-origin': origin.origin, 'access-control-allow-methods': 'PUT', 'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'authorization,apikey,content-type,x-client-info' } });
    }
    if (signedIn && destination.hostname === 'placeholder.supabase.co' && destination.pathname === '/auth/v1/user' && request.method() === 'PUT') {
      const body = JSON.parse(request.postData() || '{}');
      if (body.password !== 'local-fixture-password-42') return void request.abort();
      updates++;
      return void request.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': origin.origin }, body: JSON.stringify(user) });
    }
    // Only the exact in-browser fixture above may respond for a hosted-looking
    // URL. No request is ever sent to the remote identity provider.
    void request.abort('blockedbyclient');
  });
  await page.evaluateOnNewDocument((signed, fixtureUser) => {
    localStorage.setItem('kentro_splash_seen', 'true');
    sessionStorage.setItem('kentro_splash_seen', 'true');
    const NativeSocket = WebSocket;
    (window as any).WebSocket = class extends NativeSocket {
      constructor(address: string | URL, protocols?: string | string[]) {
        const destination = new URL(String(address), location.href);
        super(['127.0.0.1', 'localhost', '[::1]'].includes(destination.hostname) ? address : 'ws://127.0.0.1:1/blocked', protocols);
      }
    };
    if (signed) {
      const expires = Math.floor(Date.now() / 1000) + 3600;
      const payload = btoa(JSON.stringify({ sub: fixtureUser.id, exp: expires, aud: 'authenticated', role: 'authenticated' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      localStorage.setItem('sb-placeholder-auth-token', JSON.stringify({ access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`, refresh_token: 'local-fixture', expires_in: 3600, expires_at: expires, token_type: 'bearer', user: fixtureUser }));
    }
  }, signedIn, user);
  await page.goto(`${origin.origin}/#type=recovery`, { waitUntil: 'domcontentloaded' });
  await waitForText(page, 'Set a new password');
  return page;
}
try {
  const expired = await pageFor(false);
  await expired.click('form button[type="submit"], form button:not([type])');
  await waitForText(expired, 'Password must be at least 8 characters');
  await expired.type('#recovery-password', 'local-fixture-password-42');
  await expired.type('#recovery-confirmation', 'different-password');
  await expired.click('form button[type="submit"], form button:not([type])');
  await waitForText(expired, 'The passwords do not match');
  await expired.locator('#recovery-confirmation').fill('local-fixture-password-42');
  await expired.click('form button[type="submit"], form button:not([type])');
  await waitForText(expired, 'This reset link has expired');
  assert(updates === 0, 'validation and an expired recovery session cannot update a password');

  const valid = await pageFor(true);
  await valid.type('#recovery-password', 'local-fixture-password-42');
  await valid.type('#recovery-confirmation', 'local-fixture-password-42');
  await valid.click('form button[type="submit"], form button:not([type])');
  await waitForText(valid, 'Password updated');
  assert(updates === 1, 'recovery success requires a successful explicit Auth update fixture');
  await valid.click('button');
  await valid.waitForFunction(() => !document.getElementById('recovery-password') && !document.body.innerText.includes('Password updated'));
  assert(true, 'successful recovery can continue into the application');
  console.log('PASS recovery UI validation, expired session, explicit provider-response fixture and continuation. Hosted reset/email delivery remains unverified.');
} finally { await browser.close(); }
