/**
 * Shared helpers for the two-browser end-to-end tests (scripts/e2e/*.e2e.ts).
 * Drives a locally installed Chromium browser through puppeteer-core.
 *
 * All browser traffic is restricted to loopback. Rendering tests may inject
 * synthetic Supabase sessions; authenticated server journeys need a local
 * auth fixture. Fake tokens are never sent to a hosted Supabase project.
 */
import puppeteer, { Browser, Page } from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

export const APP_URL = process.env.E2E_APP_URL || "http://localhost:3000";
export const SUPABASE_REF = process.env.E2E_SUPABASE_REF || "placeholder";
export const CHROME_PATH =
  process.env.CHROME_PATH || ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(candidate => fs.existsSync(candidate));

const isLoopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);

/** Keep local browser tests from reaching production databases or services. */
export async function restrictToLocalNetwork(page: Page): Promise<void> {
  if (!isLoopback(new URL(APP_URL).hostname)) throw new Error("E2E_APP_URL must use a loopback host.");
  await page.setRequestInterception(true);
  page.on("request", request => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && !isLoopback(url.hostname)) void request.abort("blockedbyclient");
    else void request.continue();
  });
  // Plain JavaScript avoids tsx/esbuild keepNames helpers in a serialized
  // browser function (those helpers only exist in the Node process).
  await page.evaluateOnNewDocument(`(() => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class LocalWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        const destination = new URL(String(url), window.location.href);
        const local = ["localhost", "127.0.0.1", "[::1]"].includes(destination.hostname);
        // Keep the native asynchronous failure behavior expected by
        // supabase-js; throwing here would crash authenticated UI renders.
        // Chromium blocks port 1, so the replacement never reaches a host.
        super(local ? url : "ws://127.0.0.1:1/blocked-external-websocket", protocols);
      }
    };
  })()`);
}

export function loadEnvTest(): Record<string, string> {
  const p = path.join(process.cwd(), ".env.test");
  const out: Record<string, string> = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export const TEST_USERS = {
  A: { username: "kdtest1", uid: "00000000-0000-4000-8000-000000000011", email: "player-a@example.test" },
  B: { username: "kdtest2", uid: "00000000-0000-4000-8000-000000000012", email: "player-b@example.test" },
};

export async function launchChrome(opts: { headless?: boolean; args?: string[] } = {}): Promise<Browser> {
  if (!CHROME_PATH) throw new Error("Install Chromium or set CHROME_PATH to its executable.");
  const browserConfig = path.join("/tmp", "kentro-chromium-config");
  const browserCache = path.join("/tmp", "kentro-chromium-cache");
  fs.mkdirSync(browserConfig, { recursive: true });
  fs.mkdirSync(browserCache, { recursive: true });
  return puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: opts.headless ?? true,
    env: { ...process.env, XDG_CONFIG_HOME: browserConfig, XDG_CACHE_HOME: browserCache },
    args: [
      ...(process.getuid?.() === 0 || process.env.CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--mute-audio",
      "--window-size=1280,900",
      // Fake camera/mic so getUserMedia succeeds without prompts or hardware.
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--allow-insecure-localhost",
      ...(opts.args || []),
    ],
    defaultViewport: { width: 1280, height: 900 },
  });
}

function fakeSession(user: { username: string; uid: string; email: string }) {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: user.uid, aud: "authenticated", role: "authenticated", exp: nowSec + 6 * 3600 })).toString("base64url");
  const fakeJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.e2e-fake-signature`;
  return {
    access_token: fakeJwt,
    token_type: "bearer",
    expires_in: 6 * 3600,
    expires_at: nowSec + 6 * 3600,
    refresh_token: "e2e-fake-refresh",
    user: {
      id: user.uid,
      aud: "authenticated",
      role: "authenticated",
      email: user.email,
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: { username: user.username, email_verified: true },
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

/** Opens a fresh incognito-like context page already "signed in" as `user`. */
export async function openUserPage(browser: Browser, user: { username: string; uid: string; email: string }): Promise<Page> {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await restrictToLocalNetwork(page);
  page.setDefaultTimeout(30_000);
  const session = fakeSession(user);
  // Re-use the game-server session token from the previous run (like a real
  // browser would keep it), so a seat left in disconnect grace by an aborted
  // run can be taken over instead of answering "name-taken".
  const tokenFile = path.join(process.cwd(), "scripts/e2e/out", `session-${user.username}.json`);
  let savedToken: string | null = null;
  try { savedToken = JSON.parse(fs.readFileSync(tokenFile, "utf8")).token || null; } catch {}
  await page.evaluateOnNewDocument(
    (key: string, value: string, uname: string, tokenKey: string, token: string | null) => {
      try {
        window.localStorage.setItem(key, value);
        window.localStorage.setItem("lidraughts_username", uname);
        if (token) {
          window.localStorage.setItem(tokenKey, token);
          window.sessionStorage.setItem(tokenKey, token);
        }
      } catch {}
    },
    `sb-${SUPABASE_REF}-auth-token`,
    JSON.stringify(session),
    user.username,
    `kd.session.${user.username}`,
    savedToken
  );
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  return page;
}

export async function waitForText(page: Page, text: string, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    (t: string) => !!document.body && document.body.innerText.toLowerCase().includes(t.toLowerCase()),
    { timeout: timeoutMs },
    text
  );
}

export async function clickByText(page: Page, text: string, selector = "button"): Promise<void> {
  const handle = await page.evaluateHandle(
    (t: string, sel: string) => {
      const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      return els.find((e) => e.innerText.trim().toLowerCase().includes(t.toLowerCase())) || null;
    },
    text,
    selector
  );
  const el = handle.asElement();
  if (!el) throw new Error(`No ${selector} containing text "${text}"`);
  await (el as any).click();
}

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

export async function snapshot(page: Page, name: string): Promise<void> {
  const dir = path.join(process.cwd(), "scripts/e2e/out");
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) as `${string}.png`, fullPage: false });
}

/** Waits until the app has connected its game socket (splash gone, handlers live). */
export async function waitReady(page: Page, timeoutMs = 90_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const s = (window as any).__kdGameSocket;
      return !!s && String(s.status ?? s.getStatus?.()) === "connected";
    },
    { timeout: timeoutMs }
  );
  await new Promise((r) => setTimeout(r, 800));
}

/** Navigates to the Online Arena screen, retrying via the sidebar if the first click is swallowed. */
export async function gotoArena(page: Page): Promise<void> {
  await waitReady(page);
  const arenaVisible = () =>
    page.evaluate(() => /ONLINE ARENA/i.test(document.body.innerText) && /Custom game/i.test(document.body.innerText));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await clickByText(page, attempt === 0 ? "ONLINE PLAY" : "Online Arena");
    } catch {}
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      if (await arenaVisible()) return;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error("could not open the Online Arena");
}

/** Persists the game-server session token of `user` for the next run (see openUserPage). */
export async function saveSessionToken(page: Page, user: { username: string }): Promise<void> {
  try {
    const token = await page.evaluate(
      (k: string) => window.localStorage.getItem(k) || window.sessionStorage.getItem(k),
      `kd.session.${user.username}`
    );
    if (token) {
      const dir = path.join(process.cwd(), "scripts/e2e/out");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `session-${user.username}.json`), JSON.stringify({ token }));
    }
  } catch {}
}
