/** Local Chromium regression journey. Run against npm run dev with no hosted credentials:
 * E2E_APP_URL=http://127.0.0.1:8123 npx tsx scripts/e2e/frontend.e2e.ts
 * Screenshots are actual browser captures in ignored scripts/e2e/out/.
 */
import type { Page } from "puppeteer-core";
import { APP_URL, launchChrome, restrictToLocalNetwork, assert, snapshot, waitForText } from "./harness";
import { createInitialBoard, generateLegalMoves } from "../../src/gameLogic";

const browser = await launchChrome();
const errors: string[] = [];
let failed = false;

async function clickVisible(page: Page, text: string, exact = false) {
  const handle = await page.evaluateHandle((needle, matchExactly) => Array.from(document.querySelectorAll<HTMLElement>("button"))
    .find(button => button.getClientRects().length && (matchExactly ? button.innerText.trim() === needle : button.innerText.toLowerCase().includes(needle.toLowerCase()))) || null, text, exact);
  const element = handle.asElement();
  if (!element) throw new Error(`No visible button: ${text}`);
  await element.click();
  await handle.dispose();
}

async function freshPage(width: number, height: number) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height });
  await restrictToLocalNetwork(page);
  page.on("pageerror", error => {
    const stack = String((error as Error).stack || error);
    // Multiple isolated Vite instances share the default HMR port. This
    // known development-client error has no relation to app gameplay.
    if (/WebSocket closed without opened/.test(stack) && /\/@vite\/client/.test(stack)) return;
    errors.push(stack);
  });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("kentro_splash_seen", "true");
    sessionStorage.setItem("kentro_splash_seen", "true");
  });
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await waitForText(page, "Explore as guest");
  return page;
}

async function assertNoOverflow(page: Page, label: string) {
  const problems = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("main,.k-auth-screen,[role=dialog]"))
    .filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 2)
    .map(element => ({ tag: element.tagName, className: element.className, width: element.clientWidth, scrollWidth: element.scrollWidth })));
  assert(!problems.length, `${label}: no horizontal clipping (${JSON.stringify(problems)})`);
}

async function assertDialogKeyboard(page: Page) {
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "dialog");
  await page.keyboard.down("Shift");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Shift");
  const trapped = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  assert(trapped, "dialog Shift+Tab keeps focus inside");
  await page.keyboard.press("Tab");
  assert(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), "dialog Tab wraps inside");
}

try {
  const desktop = await freshPage(1440, 1000);
  assert(await desktop.evaluate(() => Array.from(document.querySelectorAll<HTMLInputElement>("form input")).every(input => input.labels?.length)), "auth inputs have programmatic labels");
  await desktop.click('[aria-label="Show password"]');
  assert(await desktop.$('input#auth-password[type="text"]'), "password reveal has an accessible control");
  await desktop.click('form button[type="submit"]');
  await desktop.waitForSelector('[role="alert"]');
  assert(await desktop.evaluate(() => document.querySelector('[role="alert"]')?.textContent?.includes("Username")), "invalid auth form announces validation");
  await snapshot(desktop, "frontend-01-auth-desktop");
  await clickVisible(desktop, "Create Account", true);
  await desktop.type("#auth-username", "KGuest_reserved");
  await desktop.click('form button[type="submit"]');
  await waitForText(desktop, "reserved for Guest Mode");
  assert(await desktop.evaluate(() => Array.from(document.querySelectorAll<HTMLInputElement>("form input")).every(input => input.labels?.length)), "registration fields retain labels and reserved guest usernames are rejected");
  await snapshot(desktop, "frontend-10-registration-desktop");
  await clickVisible(desktop, "Sign In", true);
  await clickVisible(desktop, "Forgot password?");
  await desktop.locator("#auth-username").fill("");
  assert(await desktop.$eval("#auth-username", input => (input as HTMLInputElement).value === ""), "recovery validation starts with an empty username");
  await clickVisible(desktop, "Send Reset Link", true);
  await waitForText(desktop, "Username must be at least 3 characters");
  assert(!(await desktop.$("#auth-password")), "password recovery validates username and does not ask for the old password");
  await snapshot(desktop, "frontend-11-password-recovery-desktop");
  await clickVisible(desktop, "Back to sign in");
  await clickVisible(desktop, "Explore as guest");
  await waitForText(desktop, "Guest Mode");
  await waitForText(desktop, "AI 3/3 left");
  await snapshot(desktop, "frontend-02-home-desktop");
  await assertNoOverflow(desktop, "desktop home");
  await desktop.click('button[aria-label="Settings"]');
  await assertDialogKeyboard(desktop);
  await waitForText(desktop, "Royal Wood");
  await snapshot(desktop, "frontend-03-settings-desktop");
  await assertNoOverflow(desktop, "desktop settings");
  await clickVisible(desktop, "Comfort");
  await desktop.click('[role="switch"][aria-label="Reduce motion"]');
  assert(await desktop.evaluate(() => !!document.querySelector(".k-app-shell.k-motion-reduced")), "reduce-motion preference applies");
  await desktop.keyboard.press("Escape");
  await desktop.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await desktop.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Settings");
  assert(true, "settings restores focus to opener");

  for (let used = 1; used <= 3; used++) {
    await clickVisible(desktop, "Play Ken AI", true);
    await waitForText(desktop, "VS Computer Settings");
    assert(await desktop.evaluate(() => !document.querySelector("button button")), "AI selection has no nested buttons");
    await clickVisible(desktop, "Apply & Start Match");
    await desktop.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    await desktop.waitForSelector("#square-1");
    await waitForText(desktop, `AI ${3 - used}/3 left`);
    if (used === 1) {
      await snapshot(desktop, "frontend-04-ai-royalwood-desktop");
      const move = generateLegalMoves(createInitialBoard(), "W")[0];
      await desktop.click(`#square-${move.from}`);
      await desktop.click(`#square-${move.to}`);
      await desktop.waitForFunction(() => {
        const raw = localStorage.getItem("kentro_guest_ai_game_in_progress");
        return !!raw && JSON.parse(raw).moveHistory.length >= 2;
      }, { timeout: 30_000 });
      await clickVisible(desktop, "Home", true);
      await clickVisible(desktop, "Play Ken AI", true);
      await waitForText(desktop, "Resumed your game in progress");
      await waitForText(desktop, "AI 2/3 left");
      assert(true, "resuming an AI match consumes no additional trial");
      // A new-game action starts the second trial; leave without moves so
      // opening setup next time starts a fresh third match.
      await clickVisible(desktop, "New", true);
      await waitForText(desktop, "AI 1/3 left");
      await waitForText(desktop, "New Game started");
      assert(await desktop.evaluate(() => !localStorage.getItem("kentro_guest_ai_game_in_progress")), "New removes the previous saved AI game");
      assert(await desktop.evaluate(() => !!document.getElementById("square-31")?.querySelector(".kentro-royal-piece")), "New game restores real pieces rather than using click event as board");
      used = 2;
    }
    await clickVisible(desktop, "Home", true);
  }
  await clickVisible(desktop, "Play Ken AI", true);
  await waitForText(desktop, "VS Computer Settings");
  await clickVisible(desktop, "Apply & Start Match");
  await waitForText(desktop, "Unlock more Kentro Draught");
  await waitForText(desktop, "all 3 free AI games");
  await assertDialogKeyboard(desktop);
  await snapshot(desktop, "frontend-05-guest-quota-desktop");
  assert(true, "fourth AI game requires account and dialog stays above setup");
  await desktop.keyboard.press("Escape");
  await desktop.waitForFunction(() => !document.body.innerText.includes("Unlock more Kentro Draught"));

  const mobile = await freshPage(390, 844);
  await snapshot(mobile, "frontend-06-auth-mobile");
  await assertNoOverflow(mobile, "mobile auth");
  await clickVisible(mobile, "Explore as guest");
  await waitForText(mobile, "AI 3/3 left");
  await snapshot(mobile, "frontend-07-home-mobile");
  await assertNoOverflow(mobile, "mobile home");
  for (const action of ["My profile", "Friends", "Wallet & store"]) {
    await mobile.click('button[aria-label="Open navigation"]');
    await waitForText(mobile, "Navigation");
    await clickVisible(mobile, action, true);
    await waitForText(mobile, "Unlock more Kentro Draught");
    await assertDialogKeyboard(mobile);
    assert(true, `guest mobile ${action} requires account`);
    await clickVisible(mobile, "Keep Exploring");
    await mobile.waitForFunction(() => !document.body.innerText.includes("Unlock more Kentro Draught"));
  }
  await mobile.click('button[aria-label="Settings"]');
  await assertNoOverflow(mobile, "mobile settings");
  await snapshot(mobile, "frontend-08-settings-mobile");
  await mobile.keyboard.press("Escape");
  await mobile.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await clickVisible(mobile, "Play AI", true);
  await clickVisible(mobile, "Apply & Start Match");
  await mobile.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await mobile.waitForSelector("#square-50");
  await snapshot(mobile, "frontend-09-ai-royalwood-mobile");
  await assertNoOverflow(mobile, "mobile board");
  assert(await mobile.evaluate(() => {
    const board = document.getElementById("square-50")!.closest(".k-board-frame") || document.getElementById("square-50")!;
    const rectangle = board.getBoundingClientRect();
    return rectangle.left >= 0 && rectangle.right <= innerWidth && rectangle.top >= 0 && rectangle.bottom <= innerHeight;
  }), "mobile board is within viewport");
  for (const [width, height] of [[320, 640], [360, 800], [375, 812], [414, 896], [768, 1024], [1024, 768], [844, 390], [1440, 1000]]) {
    await mobile.setViewport({ width, height });
    await assertNoOverflow(mobile, `board ${width}x${height}`);
    assert(await mobile.evaluate(() => {
      const rectangle = document.getElementById("square-50")!.getBoundingClientRect();
      return rectangle.left >= 0 && rectangle.right <= innerWidth;
    }), `board squares stay horizontally reachable at ${width}x${height}`);
    await snapshot(mobile, `frontend-board-${width}x${height}`);
  }
  assert(!errors.length, `no uncaught frontend exceptions (${errors.join("; ")})`);
  console.log("PASS frontend browser regression journey");
} catch (error) {
  failed = true;
  console.error(error);
  console.error("Uncaught exceptions:", errors);
  for (const [index, page] of (await browser.pages()).entries()) {
    await snapshot(page, `frontend-failure-${index}`).catch(() => {});
    console.error(await page.evaluate(() => document.body.innerText.slice(0, 1800)).catch(() => ""));
  }
} finally {
  await browser.close();
  process.exitCode = failed ? 1 : 0;
}
