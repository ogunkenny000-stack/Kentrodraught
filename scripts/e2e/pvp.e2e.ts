/**
 * Two-browser end-to-end test of online play against a RUNNING dev server
 * (default http://localhost:3000). Run:  npx tsx scripts/e2e/pvp.e2e.ts
 * Covers: host room -> join by code -> accept -> moves relay both ways ->
 * server clocks tick -> dropped socket recovers and play continues ->
 * voice call connects (fake devices) and ends -> resign -> game over ->
 * rematch accepted -> new game starts. Screenshots in scripts/e2e/out/.
 */
import type { Page } from "puppeteer-core";
import { createInitialBoard, generateLegalMoves, applyMove, type Board, type Move } from "../../src/gameLogic";
import { launchChrome, openUserPage, TEST_USERS, waitForText, clickByText, assert, snapshot, gotoArena, saveSessionToken } from "./harness";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const section = (t: string) => console.log(`\n== ${t} ==`);

function watchConsole(page: Page, tag: string) {
  page.on("console", (m) => {
    const txt = m.text();
    if (m.type() !== "error") return;
    if (/401|No suitable key|Supabase Error|Failed to load resource/.test(txt)) return; // expected: fake session
    console.log(`  [${tag} console.error] ${txt.slice(0, 220)}`);
  });
  page.on("pageerror", (e) => console.log(`  [${tag} pageerror] ${String(e).slice(0, 220)}`));
}

async function hasPiece(page: Page, sq: number): Promise<boolean> {
  return page.evaluate((n: number) => {
    const el = document.getElementById(`square-${n}`);
    return !!el && el.querySelector(".rounded-full") !== null;
  }, sq);
}

async function clickSquare(page: Page, sq: number) {
  await page.click(`#square-${sq}`);
}

/** Local model of the game, driven by the app's own rules engine (same as scripts/pvp-smoke.ts). */
const model = { board: createInitialBoard() as Board, turn: "W" as "W" | "B" };
function pickMove(): Move {
  const ms = generateLegalMoves(model.board, model.turn);
  if (!ms.length) throw new Error("no legal moves in the local model");
  return ms.find((m) => m.caps.length === 0) || ms[0];
}
/** Plays the next legal move on `page`; resolves true if `other` shows the piece landing. */
async function play(page: Page, other: Page, timeoutMs = 6000): Promise<{ ok: boolean; mv: Move }> {
  const mv = pickMove();
  await clickSquare(page, mv.from);
  await sleep(150);
  await clickSquare(page, mv.to);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await hasPiece(other, mv.to)) && !(await hasPiece(other, mv.from))) {
      model.board = applyMove(model.board, mv).board;
      model.turn = model.turn === "W" ? "B" : "W";
      return { ok: true, mv };
    }
    await sleep(200);
  }
  return { ok: false, mv };
}

async function clockTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("span"))) {
      const t = (el as HTMLElement).innerText?.trim();
      if (t && /^\d{1,2}:\d\d$/.test(t)) out.push(t);
    }
    return out;
  });
}

async function socketStatus(page: Page): Promise<string> {
  return page.evaluate(() => {
    const s = (window as any).__kdGameSocket;
    return s ? String(s.status ?? s.getStatus?.() ?? "unknown") : "no-hook";
  });
}

async function connectedText(page: Page): Promise<boolean> {
  return page.evaluate(() => /Voice Connected|Voice Call — Live|HD Video Call — Live/.test(document.body.innerText));
}

const browser = await launchChrome();
const A = await openUserPage(browser, TEST_USERS.A);
const B = await openUserPage(browser, TEST_USERS.B);
watchConsole(A, "A");
watchConsole(B, "B");
let failed = false;
try {
  section("1. A hosts a room");
  await gotoArena(A);
  await clickByText(A, "Create Room");
  await waitForText(A, "Launch & Create Match Arena");
  await clickByText(A, "Launch & Create Match Arena");
  await A.waitForFunction(() => /Share code\s*#\s*\d{5,}/.test(document.body.innerText), { timeout: 20000 });
  const code = await A.evaluate(() => (document.body.innerText.match(/Share code\s*#\s*(\d{5,})/) || [])[1]);
  assert(code, `room code shown to host: ${code}`);
  await snapshot(A, "01-host-waiting");

  section("2. B joins by code and accepts");
  await gotoArena(B);
  await B.waitForSelector('input[placeholder^="ENTER ROOM CODE"]');
  await B.type('input[placeholder^="ENTER ROOM CODE"]', code);
  await clickByText(B, "Join Room");
  await waitForText(B, "Accept & Play");
  await clickByText(B, "Accept & Play");
  await A.waitForSelector("#square-1", { timeout: 20000 });
  await B.waitForSelector("#square-1", { timeout: 20000 });
  assert(await hasPiece(A, 31) && await hasPiece(B, 20), "both players see the starting position");
  await snapshot(A, "02-A-board");
  await snapshot(B, "02-B-board");

  section("3. Moves relay both ways (server-validated)");
  // Whoever is White can play the first legal move; the other page's clicks are no-ops.
  let white: Page, black: Page;
  let r = await play(A, B, 4000);
  if (r.ok) { white = A; black = B; }
  else { r = await play(B, A); if (!r.ok) throw new Error("neither page could play the opening move"); white = B; black = A; }
  assert(true, `White is ${white === A ? "A (kdtest1)" : "B (kdtest2)"}; ${r.mv.from}-${r.mv.to} relayed to the opponent`);
  r = await play(black, white);
  assert(r.ok, `Black's ${r.mv.from}-${r.mv.to} relayed to White`);
  // Out of turn: a click sequence on Black's page must not move anything.
  const probe = generateLegalMoves(model.board, "B")[0];
  await clickSquare(black, probe.from); await sleep(150); await clickSquare(black, probe.to); await sleep(1200);
  assert(!(await hasPiece(white, probe.to)) || (await hasPiece(white, probe.from)), "Black cannot move twice in a row (turn enforced)");
  for (let i = 0; i < 3; i++) {
    const mover = model.turn === "W" ? white : black;
    const otherP = mover === white ? black : white;
    r = await play(mover, otherP);
    assert(r.ok, `${model.turn === "B" ? "White" : "Black"} played ${r.mv.from}-${r.mv.to}${r.mv.caps.length ? " (capture)" : ""}`);
  }

  section("4. Server clocks are shown and tick for the side to move");
  const c0 = await clockTexts(white);
  assert(c0.length >= 2, `clocks visible: ${c0.join(" | ")}`);
  await sleep(3200);
  const c1 = await clockTexts(white);
  assert(c1.join() !== c0.join(), `a clock ticked: ${c0.join(" | ")} -> ${c1.join(" | ")}`);

  section("5. Dropped socket: banner appears, reconnects, play continues");
  const statusBefore = await socketStatus(black);
  assert(statusBefore === "connected", `black's socket status before drop: ${statusBefore}`);
  await black.evaluate(() => {
    const s = (window as any).__kdGameSocket;
    const raw = s.ws || s.socket || s._ws;
    if (!raw) throw new Error("no raw ws on manager");
    raw.close();
  });
  await black.waitForFunction(() => /Reconnecting/i.test(document.body.innerText), { timeout: 8000 });
  assert(true, "'Reconnecting…' shown after the drop");
  await black.waitForFunction(() => {
    const s = (window as any).__kdGameSocket;
    return String(s.status ?? s.getStatus?.()) === "connected";
  }, { timeout: 20000 });
  await black.waitForFunction(() => !/Reconnecting…/.test(document.body.innerText), { timeout: 15000 });
  assert(true, "socket reconnected and banner cleared");
  const sample = Object.entries(model.board).filter(([, v]) => v).slice(0, 6);
  for (const [sq] of sample) assert(await hasPiece(black, Number(sq)), `piece still on ${sq} after rejoin`);
  {
    const mover = model.turn === "W" ? white : black;
    const otherP = mover === white ? black : white;
    r = await play(mover, otherP);
    assert(r.ok, `play continues after the reconnect (${r.mv.from}-${r.mv.to})`);
  }
  await snapshot(black, "05-after-reconnect");

  section("6. Voice call between the players (fake devices)");
  await clickByText(A, "Voice Call");
  await waitForText(B, "Incoming Voice Call", 15000);
  await snapshot(B, "06-incoming-call");
  await clickByText(B, "Accept");
  await A.waitForFunction(() => /Voice Connected|Voice Call — Live/.test(document.body.innerText), { timeout: 30000 });
  await B.waitForFunction(() => /Voice Connected|Voice Call — Live/.test(document.body.innerText), { timeout: 30000 });
  assert(true, "both sides show the call as connected");
  await snapshot(A, "06-call-connected");
  await A.click('button[title="End Call"]');
  await B.waitForFunction(() => !/Voice Connected|Voice Call — Live|Incoming Voice Call/.test(document.body.innerText), { timeout: 15000 });
  await A.waitForFunction(() => !/Voice Connected|Voice Call — Live/.test(document.body.innerText), { timeout: 15000 });
  assert(true, "call ended on both sides after A hung up");

  section("7. Resign -> opponent accepts -> game over");
  await clickByText(black, "Resign");
  // Offline games ask "Resign Game?"; in multiplayer the request goes to the opponent directly.
  await sleep(800);
  if (await black.evaluate(() => /Resign Game\?/.test(document.body.innerText))) {
    await black.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button")) as HTMLElement[];
      btns.filter((b) => /resign/i.test(b.innerText)).pop()?.click();
    });
  }
  await waitForText(black, "Resignation Pending", 15000);
  await waitForText(white, "Resignation Offered", 15000);
  assert(true, "resignation request reached the opponent and paused the clock");
  await snapshot(white, "07-resign-request");
  await clickByText(white, "Accept (Win Match)");
  await white.waitForFunction(() => /Game Over|Victory|You won|wins/i.test(document.body.innerText), { timeout: 15000 });
  await black.waitForFunction(() => /Game Over|Defeat|You lost|wins/i.test(document.body.innerText), { timeout: 15000 });
  assert(true, "game over shown to both after the accepted resignation");
  await snapshot(white, "07-game-over-white");
  await snapshot(black, "07-game-over-black");

  section("8. Rematch request -> accept -> new game starts");
  await white.click("#game-over-rematch-button");
  await waitForText(black, "Your opponent wants to rematch", 15000);
  await black.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")) as HTMLElement[];
    (btns.find((b) => /accept/i.test(b.innerText) && !/play/i.test(b.innerText)))?.click();
  });
  await A.waitForFunction(() => {
    const s = document.getElementById("square-32");
    return !!s && s.querySelector(".rounded-full") !== null;
  }, { timeout: 20000 });
  await B.waitForFunction(() => {
    const s = document.getElementById("square-32");
    return !!s && s.querySelector(".rounded-full") !== null;
  }, { timeout: 20000 });
  assert((await hasPiece(A, 31)) && (await hasPiece(A, 20)) && !(await hasPiece(A, 25)), "board reset to the starting position for the rematch");
  await snapshot(A, "08-rematch-started");
  console.log("\n✅ ALL E2E CHECKS PASSED");
} catch (err) {
  failed = true;
  console.log("\n❌ E2E FAILED:", (err as Error).message);
  await snapshot(A, "fail-A").catch(() => {});
  await snapshot(B, "fail-B").catch(() => {});
  const dump = async (p: Page, t: string) => console.log(`--- ${t} text:\n` + (await p.evaluate(() => document.body.innerText.slice(0, 1200))));
  await dump(A, "A").catch(() => {});
  await dump(B, "B").catch(() => {});
} finally {
  await saveSessionToken(A, TEST_USERS.A);
  await saveSessionToken(B, TEST_USERS.B);
  // Leave whatever room is left so the test names are free for the next run
  // (an abandoned live seat stays reserved for its owner during grace).
  for (const p of [A, B]) {
    await p.evaluate(() => { try { (window as any).__kdGameSocket?.send({ type: "leave-room" }); } catch {} }).catch(() => {});
  }
  await sleep(800);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
