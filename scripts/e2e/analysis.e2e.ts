import { APP_URL, assert, launchChrome, snapshot, waitForText } from './harness';
import { boardToScanFen, createInitialBoard, generateLegalMoves, moveToNotationString, applyMove } from '../../src/gameLogic';
import { analysisPdn } from '../../src/lib/analysisPresentation';
const browser = await launchChrome();
const page = await browser.newPage();
const errors: string[] = [];
async function click(text: string) {
  await page.waitForFunction((t:string) => [...document.querySelectorAll<HTMLButtonElement>('button')].some(b=>b.getClientRects().length && b.textContent?.trim().startsWith(t)),{},text);
  const handle = await page.evaluateHandle((t: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getClientRects().length && b.textContent?.trim().startsWith(t)) ?? null, text);
  const element = handle.asElement(); if (!element) throw new Error(`Missing visible button: ${text}`);
  await element.evaluate(button=>button.scrollIntoView({block:'center'}));
  await page.waitForFunction(button=>{const r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));},{},element);
  await element.asLocator().click(); await handle.dispose();
}
try {
  await page.setViewport({ width: 1440, height: 1000 });
  // Chromium request interception can stall a worker's first WASM fetch.
  // Block hosted traffic through CDP instead; all fixture traffic uses HTTP loopback.
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['https://*', 'wss://*', 'ws://*'] });
  page.on('pageerror', error => { if (/WebSocket closed without opened/.test(String(error)) && /\/@vite\/client/.test(String((error as Error).stack))) return; errors.push(String(error)); });
  await page.evaluateOnNewDocument(`window.__workers=[]; const OriginalWorker=window.Worker; window.Worker=class extends OriginalWorker { constructor(...args){ super(...args); const record={url:args[0],started:Date.now()}; window.__workers.push(record); this.addEventListener('message',event=>record.result=event.data); this.addEventListener('error',event=>record.error=event.message); const stop=this.terminate.bind(this); this.terminate=()=>{record.stopped=Date.now();stop();}; }};`);
  await page.evaluateOnNewDocument("localStorage.setItem('kentro_splash_seen','true');sessionStorage.setItem('kentro_splash_seen','true');");
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await waitForText(page, 'Explore as guest'); await click('Explore as guest');
  await waitForText(page, 'Analysis lab'); await click('Analysis lab');
  await click('Explore a New Position');
  await waitForText(page, 'Analysis Workspace');
  await waitForText(page, 'Ken Analysis Engine');
  assert(await page.$eval('[aria-label="Analysis time per position"]', e => (e as HTMLSelectElement).value === '0'), 'depth 30 is the default analysis mode');
  await page.select('[aria-label="Analysis time per position"]', '1500');
  await page.waitForFunction(() => /Depth \d+/.test(document.body.innerText), { timeout: 30000 });
  await snapshot(page, 'analysis-01-desktop');
  await click('Setup');
  await page.waitForSelector('#analysis-fen');
  await page.type('#analysis-fen', 'invalid'); await click('Load');
  await waitForText(page, 'Invalid SCAN FEN');
  assert(!!await page.$('#square-31'), 'invalid setup preserves the current board');
  const start = { 23: 'W', 17: 'b', 40: 'b' } as const;
  const fen = boardToScanFen(start, 'B');
  await page.$eval('#analysis-fen', e => (e as HTMLInputElement).value = '');
  await page.click('#analysis-fen', { clickCount: 3 }); await page.keyboard.press('Backspace');
  await page.type('#analysis-fen', fen); await click('Load');
  await waitForText(page, 'Black to move');
  await page.keyboard.press('Home');
  await click('Engine');
  await page.waitForFunction(() => /Depth \d+/.test(document.body.innerText), { timeout: 30000 });
  await snapshot(page, 'analysis-02-custom-black');
  await page.select('[aria-label="Analysis time per position"]', '15000');
  await click('Setup'); await click('Starting Board (20v20)'); // Cancels a real long search.
  await waitForText(page, 'White to move');
  await click('Engine');
  await page.select('[aria-label="Analysis time per position"]', '1500');
  const first = generateLegalMoves(createInitialBoard(), 'W')[0];
  await page.click(`#square-${first.from}`); await page.click(`#square-${first.to}`);
  await click('Moves'); await waitForText(page, 'Pause depth-30 review'); await click('Pause depth-30 review'); await waitForText(page, 'Review paused');
  await page.keyboard.press('Home'); await waitForText(page, 'Starting position');
  await page.keyboard.press('ArrowRight'); await waitForText(page, 'After move 1');
  await page.keyboard.press('End'); await waitForText(page, 'Current position');
  await snapshot(page, 'analysis-03-replay');
  await click('Engine'); await click('Setup'); await click('Open board editor');
  await waitForText(page, 'Board Editor'); await click('Analyze position');
  await waitForText(page, 'Analysis Workspace');
  await waitForText(page, 'Current position');
  assert(!errors.length, `desktop analysis has no browser exceptions: ${errors.join('; ')}`);
  await page.setViewport({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const square = document.querySelector('#square-50')?.getBoundingClientRect();
    return !!square && square.bottom < innerHeight;
  });
  await snapshot(page, 'analysis-04-mobile');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'mobile analysis has no page-width overflow');
  assert(await page.evaluate(() => [...document.querySelectorAll('button')].some(button => button.title === 'Game Options Menu' && button.getBoundingClientRect().bottom <= innerHeight)), 'mobile board controls remain on screen');
  // A fresh forced-move search must not return Scan's internal unknown-score sentinel.
  const forcedFen = boardToScanFen({ 23: 'w', 17: 'b', 40: 'b' }, 'W');
  const result: any = await page.evaluate(fen => new Promise((resolve, reject) => {
    const worker = new Worker('/engine/ken-worker.js');
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Forced search timed out')); }, 30000);
    worker.onmessage = ({ data }) => { clearTimeout(timer); worker.terminate(); resolve(data.result); };
    worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error('Forced search failed')); };
    worker.postMessage({ fen, seconds: 0.2, depth: 0, pst: false });
  }), forcedFen);
  assert(Number.isFinite(result?.score) && Math.abs(result.score) <= 10000 && result.depth > 0, 'forced moves receive a searched score, never the unknown sentinel');
  // Fail and retry the actual analysis hook, without pretending a failed search is a draw.
  await page.evaluate('window.__workingWorker=window.Worker;window.Worker=function(){throw new Error("Device engine temporarily unavailable");}');
  await page.click('button[title="Open Analysis Lab & Full AI Game Review"]');
  await waitForText(page, 'Smart Lab');
  // Mobile engine controls are exercised through the same Lab used by players.
  const engineButton = await page.evaluateHandle(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent?.includes('Engine')) ?? null);
  if (engineButton.asElement()) await engineButton.asElement()!.asLocator().click();
  await page.select('[role="dialog"] [aria-label="Analysis time per position"]', '5000');
  await waitForText(page, 'Device engine temporarily unavailable');
  await page.evaluate('window.Worker=window.__workingWorker');
  await click('Retry analysis');
  await page.waitForFunction(() => /Depth \d+/.test(document.body.innerText), { timeout: 30000 });
  await page.keyboard.press('Escape');
  const initial = createInitialBoard(); let board = initial; let turn: 'W' | 'B' = 'B'; const moves = [];
  for (let i = 0; i < 3; i++) { const move = generateLegalMoves(board, turn)[0]; moves.push(move); board = applyMove(board, move).board; turn = turn === 'W' ? 'B' : 'W'; }
  await page.click('button[title="Import PDN Notation or FEN"]');
  await page.type('[aria-label="Game moves or exported PDN"]', analysisPdn(moves.map(moveToNotationString), initial, 'B'));
  await click('Import & Analyze');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await waitForText(page, '3 moves played');
  await waitForText(page, 'White to move');
  await page.keyboard.press('Home');
  await waitForText(page, 'Starting position · Black to move');
  assert(!errors.length, 'mobile retry and exported-study import have no browser exceptions');
  console.log('PASS: real local analysis, inline setup validation, Black-first root, cancelling deep search, review, starting-position replay, editor return and mobile layout.');
} catch(error) {
  await snapshot(page, 'analysis-failure');
  console.error((await page.evaluate(() => document.body.innerText)).slice(-5500));
  console.error('Workers:',await page.evaluate('JSON.stringify(window.__workers)'));console.error('Errors:',errors);
  throw error;
} finally { await browser.close(); }
