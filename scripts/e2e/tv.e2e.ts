/** Real React UI with deterministic, browser-intercepted local replay records.
 * Start a fresh development listener, then run:
 * CHROME_NO_SANDBOX=1 E2E_APP_URL=http://127.0.0.1:8149 npx tsx scripts/e2e/tv.e2e.ts
 * This does not validate hosted records, Supabase/RLS, push delivery, native
 * sharing, the OS clipboard, WhatsApp, or video recording on real devices.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "puppeteer-core";
import { APP_URL, launchChrome, snapshot, waitForText } from "./harness";
import { applyMove, createInitialBoard, generateLegalMoves } from "../../src/gameLogic";
import type { Move } from "../../src/gameLogic";
import type { KentroGameRecord } from "../../src/types/gameRecords";

const origin = new URL(APP_URL);
if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) throw new Error("TV browser fixtures require a loopback E2E_APP_URL.");
const outputDirectory = join(process.cwd(), "scripts/e2e/out");
mkdirSync(outputDirectory, { recursive: true });
const logFile = join(outputDirectory, "tv.e2e.log");
writeFileSync(logFile, `TV browser fixture run ${new Date().toISOString()} at ${origin.origin}\n`);
function log(message: string) { console.log(message); appendFileSync(logFile, `${message}\n`); }
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
  log(`  PASS ${message}`);
}

let finalBoard = createInitialBoard();
let turn: "W" | "B" = "W";
const history: Move[] = [];
for (let i = 0; i < 100; i++) {
  const legal = generateLegalMoves(finalBoard, turn);
  if (!legal.length) break;
  const move = legal.find(candidate => candidate.caps.length >= 2) || legal[(i * 7 + 2) % legal.length];
  history.push(move);
  finalBoard = applyMove(finalBoard, move).board;
  turn = turn === "W" ? "B" : "W";
}
const game: KentroGameRecord = {
  gameCode: "TV_LOCAL_001", previousGameCode: null, seriesId: "local-tv-fixture", seriesGameNumber: 1,
  player1: "Local Gold", player2: "Local Black", whitePlayer: "Local Gold", blackPlayer: "Local Black",
  playerColors: { "Local Gold": "W", "Local Black": "B" }, gameMode: "Online", timeControl: "5 min",
  startingPosition: null, completeMoveHistory: history, moveHistoryStrings: [], currentPosition: finalBoard,
  gameStartTime: 1_790_000_000_000, gameEndTime: 1_790_000_060_000, durationSeconds: 60,
  finalResult: "1–0", resultReason: "Local completed replay fixture", winner: "Local Gold", loser: "Local Black", isDraw: false,
};
assert(history.some(move => move.caps.length), "deterministic legal fixture contains a capture");

const syntheticUid = "00000000-0000-4000-8000-000000000011";
const now = Math.floor(Date.now() / 1000);
const fakeToken = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify({ sub: syntheticUid, aud: "authenticated", role: "authenticated", exp: now + 3600 })).toString("base64url")}.local-ui-fixture`;
const session = {
  access_token: fakeToken, token_type: "bearer", refresh_token: "local-ui-fixture", expires_in: 3600, expires_at: now + 3600,
  user: { id: syntheticUid, aud: "authenticated", role: "authenticated", email: "tv-ui@example.test",
    email_confirmed_at: new Date().toISOString(), user_metadata: { username: "tv_local_fixture", email_verified: true },
    app_metadata: { provider: "email", providers: ["email"] }, identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
};

const browser = await launchChrome();
const errors: string[] = [];
const requests = { recent: 0, replay: 0, blocked: 0 };
let failed = false;

async function pageAt(width: number, height: number, signedIn = false) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.setViewport({ width, height });
  await page.setRequestInterception(true);
  page.on("request", request => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && url.origin !== origin.origin) {
      requests.blocked++;
      void request.abort("blockedbyclient");
    } else if (url.origin === origin.origin && url.pathname === "/api/games/recent") {
      requests.recent++;
      void request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ games: [game] }) });
    } else if (url.origin === origin.origin && url.pathname === `/api/games/code/${game.gameCode}`) {
      requests.replay++;
      void request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ game }) });
    } else void request.continue();
  });
  page.on("pageerror", error => {
    const message = String((error as Error).stack || error);
    if (/WebSocket closed without opened/.test(message) && /\/@vite\/client/.test(message)) return;
    errors.push(message);
  });
  await page.evaluateOnNewDocument(`(() => {
    localStorage.setItem("kentro_splash_seen", "true");
    sessionStorage.setItem("kentro_splash_seen", "true");
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async text => { window.__tvCopiedText = text; }
    }});
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class LocalWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        const destination = new URL(String(url), window.location.href);
        super(destination.origin.replace(/^ws/, "http") === window.location.origin ? url : "ws://127.0.0.1:1/blocked-external-websocket", protocols);
      }
    };
  })()`);
  if (signedIn) await page.evaluateOnNewDocument((value: string) => {
    localStorage.setItem("sb-placeholder-auth-token", value);
    localStorage.setItem("lidraughts_username", "tv_local_fixture");
  }, JSON.stringify(session));
  return page;
}

async function clickText(page: Page, text: string) {
  const handle = await page.evaluateHandle(needle => Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find(button => button.getClientRects().length && button.innerText.includes(needle)) || null, text);
  const button = handle.asElement();
  if (!button) throw new Error(`No visible button containing ${text}`);
  await button.click();
  await handle.dispose();
}
async function position(page: Page) {
  return page.$eval('input[aria-label="Replay position"]', element => Number((element as HTMLInputElement).value));
}
async function expectPosition(page: Page, expected: number) {
  await page.waitForFunction(value => Number((document.querySelector('input[aria-label="Replay position"]') as HTMLInputElement)?.value) === value, {}, expected);
}
async function copiedLink(page: Page) {
  const copied = await page.evaluate("window.__tvCopiedText || ''") as string;
  const match = copied.match(/https?:\/\/\S+/);
  assert(!!match, "share fallback writes a URL through the clipboard adapter");
  return new URL(match[0]);
}

try {
  log("Real React TV UI; /api/games responses are deterministic local browser fixtures. Every off-origin HTTP request and WebSocket is blocked.");
  const desktop = await pageAt(1440, 1000);
  await desktop.goto(`${origin.origin}/?replay=${game.gameCode}&ply=1900&clipEnd=2000`, { waitUntil: "domcontentloaded" });
  await waitForText(desktop, "Explore as guest");
  await clickText(desktop, "Explore as guest");
  await desktop.waitForSelector('[aria-label="10 by 10 Nigerian Draughts replay board"]');
  await expectPosition(desktop, history.length);
  assert(new URL(desktop.url()).searchParams.get("replay") === game.gameCode, "first-visit guest continuation preserves the shared replay");
  assert(await desktop.$eval('input[aria-label="Replay position"]', element => Number((element as HTMLInputElement).max)) === history.length, "deep-link ply and clip end clamp to the loaded legal record");
  assert(!!(await desktop.$('[aria-label="Play replay"]')), "a clip beginning beyond the last ply does not autoplay past the record");
  await snapshot(desktop, "tv-01-replay-desktop");

  await desktop.click('[aria-label="First move"]'); await expectPosition(desktop, 0);
  assert(await desktop.$$eval('[aria-label="10 by 10 Nigerian Draughts replay board"] .kentro-royal-piece', pieces => pieces.length) === 40, "first frame renders all 40 opening pieces");
  await desktop.click('[aria-label="Next move"]'); await expectPosition(desktop, 1);
  await desktop.click('[aria-label="Previous move"]'); await expectPosition(desktop, 0);
  await desktop.click('[aria-label="Last move"]'); await expectPosition(desktop, history.length);
  await desktop.click('[aria-label="Play replay"]');
  await desktop.waitForFunction(() => Number((document.querySelector('input[aria-label="Replay position"]') as HTMLInputElement)?.value) > 0 && !!document.querySelector('[aria-label="Pause replay"]'));
  await desktop.click('[aria-label="Pause replay"]');
  assert((await position(desktop)) < history.length, "play from the final frame restarts and advances; pause stops playback");
  await desktop.focus('input[aria-label="Replay position"]');
  await desktop.keyboard.press("Home");
  for (let i = 0; i < 4; i++) await desktop.keyboard.press("ArrowRight");
  await expectPosition(desktop, 4);
  assert(true, "keyboard slider changes the actual replay position");
  await clickText(desktop, "Copy Replay Link");
  let link = await copiedLink(desktop);
  assert(link.origin === origin.origin && link.searchParams.get("replay") === game.gameCode && link.searchParams.get("ply") === "4" && !link.searchParams.has("clipEnd"), "copy replay link includes the selected exact ply");
  await clickText(desktop, "More Share Options");
  link = await copiedLink(desktop);
  assert(link.searchParams.get("ply") === "4", "unavailable native share falls back to copying the replay message");

  const highlight = await desktop.evaluate(() => {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(element => element.innerText.includes("-piece capture"));
    const match = button?.innerText.match(/Moves (\d+)–(\d+)/);
    return match ? { from: Number(match[1]), to: Number(match[2]) } : null;
  });
  assert(!!highlight && highlight.to <= history.length && highlight.to > highlight.from, "capture highlight offers a bounded animated move interval");
  await clickText(desktop, "-piece capture");
  await desktop.waitForFunction(from => Number((document.querySelector('input[aria-label="Replay position"]') as HTMLInputElement)?.value) > from, {}, highlight.from);
  await desktop.click('[aria-label="Pause replay"]');
  assert((await position(desktop)) <= highlight.to, "selected capture highlight advances inside its interval");
  await clickText(desktop, "Share Animated Link");
  link = await copiedLink(desktop);
  assert(Number(link.searchParams.get("ply")) === highlight.from && Number(link.searchParams.get("clipEnd")) === highlight.to, "animated share link retains both highlight bounds");
  await snapshot(desktop, "tv-02-highlight-desktop");

  await desktop.click('button[aria-label^="Open notifications,"]');
  await waitForText(desktop, "Sign in for notifications");
  assert(!!(await desktop.$('[role="dialog"][aria-label="Kentro notifications"]')), "guest inbox renders sign-in guidance without claiming delivery");
  await snapshot(desktop, "tv-03-notifications-guest-desktop");
  await desktop.keyboard.press("Escape");
  await desktop.waitForFunction(() => !document.querySelector('[aria-label="Kentro notifications"]'));

  const mobile = await pageAt(390, 844);
  await mobile.goto(`${origin.origin}/?replay=${game.gameCode}`, { waitUntil: "domcontentloaded" });
  await waitForText(mobile, "Explore as guest"); await clickText(mobile, "Explore as guest");
  await mobile.waitForSelector('[aria-label="10 by 10 Nigerian Draughts replay board"]');
  await expectPosition(mobile, 0);
  assert(await mobile.$eval('[aria-label="10 by 10 Nigerian Draughts replay board"]', board => {
    const rectangle = board.getBoundingClientRect();
    return rectangle.left >= 0 && rectangle.right <= innerWidth && rectangle.width > 250;
  }), "390px mobile replay board fits the viewport horizontally");
  assert(await mobile.$eval(".k-tv-hub", element => element.scrollWidth <= element.clientWidth + 2), "mobile TV layout has no horizontal overflow");
  await snapshot(mobile, "tv-04-replay-mobile");
  await mobile.click('[aria-label="Next move"]'); await expectPosition(mobile, 1);
  assert(true, "mobile replay step control changes the rendered frame");

  const authenticated = await pageAt(390, 844, true);
  await authenticated.goto(`${origin.origin}/?replay=${game.gameCode}`, { waitUntil: "domcontentloaded" });
  await authenticated.waitForSelector('[aria-label="10 by 10 Nigerian Draughts replay board"]');
  await authenticated.click('button[aria-label^="Open notifications,"]');
  await waitForText(authenticated, "Notifications unavailable.");
  assert(true, "synthetic signed-in inbox shows unavailable state when Supabase is blocked");
  await snapshot(authenticated, "tv-05-notifications-unavailable-mobile");
  await authenticated.click('[aria-label="Notification preferences"]');
  await waitForText(authenticated, "Browser alerts (optional)");
  const categorySelector = '[aria-label="Kentro notifications"] input[type="checkbox"]';
  assert((await authenticated.$$(categorySelector)).length === 5, "notification preferences render all five categories");
  await authenticated.click(categorySelector);
  assert(await authenticated.evaluate(uid => JSON.parse(localStorage.getItem(`kd.notification.prefs.${uid}`) || "{}").challenge === false, syntheticUid), "category preference persists locally for the synthetic account");
  assert(await authenticated.evaluate(() => Array.from(document.querySelectorAll("button")).some(button => button.innerText.trim() === "Enable notifications")), "optional browser permission remains a user action");
  await snapshot(authenticated, "tv-06-notification-preferences-mobile");
  await authenticated.reload({ waitUntil: "domcontentloaded" });
  await authenticated.waitForSelector('[aria-label="10 by 10 Nigerian Draughts replay board"]');
  await authenticated.click('button[aria-label^="Open notifications,"]');
  await authenticated.click('[aria-label="Notification preferences"]');
  await authenticated.waitForSelector(categorySelector);
  assert(await authenticated.$eval(categorySelector, element => !(element as HTMLInputElement).checked), "disabled category remains off after reloading the app");

  assert(requests.recent >= 3 && requests.replay >= 3, "TV uses the explicit local replay and recent-game fixtures");
  assert(!errors.length, `no uncaught UI errors (${errors.join("; ")})`);
  log(`PASS TV browser journey. Fixture requests: recent=${requests.recent}, replay=${requests.replay}; blocked off-origin requests=${requests.blocked}.`);
  log("Limits: no hosted archive/auth/database/RLS, live spectator synchronization, push delivery, native share, real clipboard, WhatsApp handoff, or video export was verified.");
} catch (error) {
  failed = true;
  log(String((error as Error).stack || error));
  for (const [index, page] of (await browser.pages()).entries()) {
    await snapshot(page, `tv-failure-${index}`).catch(() => {});
    log(await page.evaluate(() => document.body.innerText.slice(0, 2000)).catch(() => "Page unavailable"));
  }
  log(`Uncaught browser exceptions: ${errors.join("; ")}`);
} finally {
  await browser.close();
  process.exitCode = failed ? 1 : 0;
}
