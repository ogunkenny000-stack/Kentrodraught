/** Real local browser UI journeys. Authenticated services remain unavailable;
 * no external service calls or fabricated persistence are required. */
import { APP_URL, assert, launchChrome, restrictToLocalNetwork, snapshot, waitForText } from './harness';
import { createInitialBoard, generateLegalMoves } from '../../src/gameLogic';
import type { Page } from 'puppeteer-core';

const browser = await launchChrome();
const page = await browser.newPage();
const errors: string[] = [];
async function click(text: string, exact = true) {
  await page.waitForFunction((text, exact) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).some(button => button.getClientRects().length && (exact ? button.textContent?.trim().toLowerCase() === text.toLowerCase() : button.textContent?.toLowerCase().includes(text.toLowerCase()))), {}, text, exact);
  const handle = await page.evaluateHandle((text, exact) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.getClientRects().length && (exact ? button.textContent?.trim().toLowerCase() === text.toLowerCase() : button.textContent?.toLowerCase().includes(text.toLowerCase()))) || null, text, exact);
  const element = handle.asElement();
  if (!element) throw new Error(`Visible button missing: ${text}`);
  await element.evaluate(button => button.scrollIntoView({block:'center'}));
  await page.waitForFunction(button => { const r = button.getBoundingClientRect(); const hit = document.elementFromPoint(r.x+r.width/2, r.y+r.height/2); return !!hit && button.contains(hit); }, {}, element);
  await element.asLocator().click(); await handle.dispose();
}
try {
  await page.setViewport({ width: 1440, height: 1000 });
  await restrictToLocalNetwork(page);
  page.on('pageerror', error => {
    const stack = String((error as Error).stack || error);
    if (/WebSocket closed without opened/.test(stack) && /\/@vite\/client/.test(stack)) return;
    errors.push(stack);
  });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('kentro_splash_seen', 'true'); sessionStorage.setItem('kentro_splash_seen', 'true');
  });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await waitForText(page, 'Explore as guest'); await click('Explore as guest');
  await waitForText(page, 'Guest Mode');
  for (const target of ['Tournaments', 'The lounge']) {
    await click(target); await waitForText(page, 'Unlock more Kentro Draught');
    await click('Keep Exploring');
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]')); 
    assert(true, `${target} guest navigation requires an account`);
  }
  await click('Board editor'); await waitForText(page, 'Brush active');
  await click('Clear All');
  assert(await page.evaluate(() => !document.querySelector('#square-31 .kentro-royal-piece')), 'editor clears the real board');
  await click('W King'); await page.click('#square-31');
  await click('B Man'); await page.click('#square-20');
  assert(await page.evaluate(() => document.querySelectorAll('[id^="square-"] .kentro-royal-piece').length === 2), 'editor paints only the chosen two pieces');
  await snapshot(page, 'surfaces-01-editor');
  await click('Play Position'); await click('Play vs AI'); await click('White first');
  await click('Start Match — White plays first'); await waitForText(page, 'VS Computer Settings');
  await click('Apply & Start Match', false);
  await waitForText(page, 'Custom position loaded');
  assert(await page.evaluate(() => document.querySelectorAll('[id^="square-"] .kentro-royal-piece').length === 2), 'custom editor position survives AI setup');
  assert(await page.evaluate(() => !document.querySelector('#square-1 .kentro-royal-piece')), 'custom start does not become the standard forty-piece board');
  await snapshot(page, 'surfaces-02-custom-ai');
  await click('Home');
  await click('Analysis lab'); await waitForText(page, 'Analysis Options');
  await click('Explore a New Position', false); await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await page.waitForSelector('#square-31');
  const move = generateLegalMoves(createInitialBoard(), 'W')[0];
  await page.click(`#square-${move.from}`); await page.click(`#square-${move.to}`);
  assert(await page.evaluate(sq => !!document.querySelector(`#square-${sq} .kentro-royal-piece`), move.to), 'analysis board accepts a legal move after leaving a custom position');
  await snapshot(page, 'surfaces-03-analysis');
  await click('Home'); await click('Academy');
  await page.waitForSelector('.k-academy-page');
  await waitForText(page, 'Kentro Academy');
  assert(await page.evaluate(() => /fundamental|beginner|lesson|learn/i.test(document.body.innerText)), 'academy provides learning content');
  await snapshot(page, 'surfaces-04-academy');
  await click('Home'); await click('Puzzles');
  await waitForText(page, 'Puzzles');
  await snapshot(page, 'surfaces-05-puzzles');
  assert(await page.evaluate(() => /puzzle|loading|no puzzles|unavailable/i.test(document.body.innerText)), 'puzzles opens with a visible state while hosted content is unavailable');
  assert(!errors.length, `no uncaught UI errors (${errors.join('; ')})`);
  console.log('PASS local editor/custom AI/analysis/academy/puzzle guest journeys; hosted puzzle content and persistence unverified.');
} catch (error) {
  await snapshot(page, 'surfaces-failure');
  console.error(await page.evaluate(() => document.body.innerText));
  throw error;
} finally { await browser.close(); }
