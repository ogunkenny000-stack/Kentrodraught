/** Actual production service worker cache/reload on Chromium's secure loopback.
 * Start an isolated production Node listener with HOST=0.0.0.0, then run:
 * CHROME_NO_SANDBOX=1 E2E_APP_URL=http://127.0.0.2:8132 npx tsx scripts/e2e/offline.e2e.ts
 * 127.0.0.2 avoids the intentional localhost/127.0.0.1 development guard.
 */
import { APP_URL, assert, launchChrome, snapshot, waitForText } from "./harness";

const origin = new URL(APP_URL);
if (!/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(origin.hostname) || origin.hostname === "127.0.0.1") throw new Error("Use a 127/8 loopback host other than the app's development exception 127.0.0.1.");
const browser = await launchChrome();
const page = await browser.newPage();
try {
  await page.setRequestInterception(true);
  page.on("request", request => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && url.origin !== origin.origin) void request.abort("blockedbyclient");
    else void request.continue();
  });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("kentro_splash_seen", "true");
    sessionStorage.setItem("kentro_splash_seen", "true");
  });
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await waitForText(page, "Explore as guest");
  assert(await page.evaluate(() => window.isSecureContext), "browser treats 127/8 loopback as secure context");
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, { timeout: 30_000 });
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const assets = keys.find(key => key.startsWith("kentro-draught-") && key.endsWith("-assets"));
    return assets ? (await (await caches.open(assets)).keys()).map(request => new URL(request.url).pathname) : [];
  });
  assert(cached.some(path => path.includes("/OfflineNearby-")), "production install precaches nearby before the user opens its mode");
  assert(!cached.some(path => path.includes("/KentroTV-")), "TV remains lazy and avoids additional first-load downloads");
  assert(cached.some(path => path.includes("/AnalysisSidebar-")), "analysis sidebar is prepared for offline use");
  assert(!cached.some(path => path.includes("/CoinsPurchaseModal-")), "network-only wallet does not add install traffic");
  await page.setOfflineMode(true);
  await page.goto(`${APP_URL}/?offline=1`, { waitUntil: "domcontentloaded" });
  await waitForText(page, "Nearby Offline Game");
  assert(await page.evaluate(() => !navigator.onLine), "nearby mode opens after the browser goes offline");
  await snapshot(page, "offline-01-production-nearby");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForText(page, "Nearby Offline Game");
  console.log("PASS: actual production service worker installed, prepared Nearby (TV stayed lazy), then opened and reloaded Nearby with browser networking offline.");
} finally { await browser.close(); }
