/** Serve dist on 127.0.0.2 (not the development SW exception), then run this test. */
import { APP_URL, assert, launchChrome, waitForText } from './harness';
import { applyMove, boardToScanFen, createInitialBoard, generateLegalMoves, hubMoveStringToNigerian, movesAreEquivalent } from '../../src/gameLogic';

const browser = await launchChrome();
const page = await browser.newPage();
const origin = new URL(APP_URL).origin;
let engineApiCalls = 0;
try {
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/engine/move') engineApiCalls++;
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) void request.abort();
    else void request.continue();
  });
  await page.evaluateOnNewDocument("localStorage.setItem('kentro_splash_seen','true');sessionStorage.setItem('kentro_splash_seen','true');");
  await page.goto(`${APP_URL}/?offline=ken`, { waitUntil: 'domcontentloaded' });
  await waitForText(page, 'Play vs Ken · Offline');
  await page.waitForFunction(async () => {
    const cached = await caches.match('/engine/scan.wasm');
    return !!cached && !!(await navigator.serviceWorker.getRegistration())?.active;
  }, { timeout: 60000 });
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForText(page, 'Play vs Ken · Offline');
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.innerText.includes('Ken 8 ('))?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent?.includes('Apply & Start'))?.click());
  await page.waitForSelector('[role="dialog"]', { hidden: true });
  const first = generateLegalMoves(createInitialBoard(), 'W')[0];
  await page.click(`#square-${first.from}`);
  await page.click(`#square-${first.to}`);
  await waitForText(page, 'Ken is thinking…');
  await waitForText(page, 'Your turn — Gold', 30000);
  assert(await page.evaluate(() => !navigator.onLine), 'actual AI reply completed with browser networking disabled');
  // Exercise the real worker against evolving positions and mandatory captures,
  // independently validating every result with the existing game rules.
  let board = applyMove(createInitialBoard(), first).board;
  let turn: 'W' | 'B' = 'B';
  let captures = 0;
  for (let ply = 0; ply < 36; ply++) {
    const legal = generateLegalMoves(board, turn);
    if (!legal.length) break;
    const fen = boardToScanFen(board, turn);
    const result: any = await page.evaluate((position: string) => new Promise((resolve, reject) => {
      const worker = new Worker('/engine/ken-worker.js');
      const timeout = setTimeout(() => { worker.terminate(); reject(new Error('worker timed out')); }, 30000);
      worker.onerror = () => { clearTimeout(timeout); worker.terminate(); reject(new Error('worker failed')); };
      worker.onmessage = ({ data }) => { clearTimeout(timeout); worker.terminate(); resolve(data.result); };
      worker.postMessage({ fen: position, seconds: 0.05, depth: 0, pst: false });
    }), fen);
    const parsed = result && hubMoveStringToNigerian(result.move);
    const move = parsed && legal.find(candidate => movesAreEquivalent(candidate, parsed));
    assert(!!move, `WASM move ${ply} is legal under unchanged Nigerian rules`);
    if (move!.caps.length) captures++;
    assert(Number.isFinite(result.score) && result.nodes >= 0, 'real search statistics returned');
    board = applyMove(board, move!).board;
    turn = turn === 'W' ? 'B' : 'W';
  }
  assert(captures > 0, 'real offline search exercised captures');
  await page.click('[title="New Match"]');
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.innerText.includes('Ken 4 ('))?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.innerText.trim() === 'As Black')?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent?.includes('Apply & Start'))?.click());
  await waitForText(page, 'Ken is thinking…');
  // A new setup cancels the actual local search before starting a fresh game.
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[title="New Match"]')?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.innerText.trim() === 'As White')?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent?.includes('Apply & Start'))?.click());
  await page.waitForSelector('[role="dialog"]', { hidden: true });
  await waitForText(page, 'Your turn — Gold');
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert(await page.$$eval('.kentro-royal-piece', pieces => pieces.length === 40), 'restart retained all forty initial pieces after cancelling search');
  assert(engineApiCalls === 0, 'offline practice never calls the engine API');
  console.log(`PASS: production offline reload, actual AI reply, 36 validated WASM plies (${captures} captures), restart, zero engine API calls.`);
} finally { await browser.close(); }
