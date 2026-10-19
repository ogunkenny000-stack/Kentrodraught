/** Two isolated Chromium contexts exercising actual local WebRTC.
 * E2E_APP_URL=http://127.0.0.1:8123 npx tsx scripts/e2e/nearby.e2e.ts
 * This does not substitute for physical phone/hotspot or Safari testing.
 */
import type { Page } from "puppeteer-core";
import { APP_URL, assert, clickByText, launchChrome, restrictToLocalNetwork, snapshot, waitForText } from "./harness";
import { createInitialBoard, generateLegalMoves } from "../../src/gameLogic";

// Use the browser's actual network policy. A managed policy that prohibits
// local ICE candidates is an explicit unavailable outcome, never a fake peer.
const browser = await launchChrome();
const errors: string[] = [];
const pages: Page[] = [];

async function nearbyPage(): Promise<Page> {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  pages.push(page);
  await restrictToLocalNetwork(page);
  page.on("pageerror", error => errors.push(String(error)));
  page.on("dialog", dialog => { void dialog.accept(); });
  await page.evaluateOnNewDocument(() => {
    sessionStorage.setItem("kentro_splash_seen", "true");
    localStorage.setItem("kentro_splash_seen", "true");
    // Observe the real host channel so regression packets use the actual
    // transport, rather than mocking component state or RTC implementations.
    const create = RTCPeerConnection.prototype.createDataChannel;
    const channels: RTCDataChannel[] = [];
    (window as any).__nearbyChannels = channels;
    RTCPeerConnection.prototype.createDataChannel = function(label, options) {
      (window as any).__nearbyPeer = this;
      const channel = create.call(this, label, options);
      channels.push(channel);
      return channel;
    };
    const remote = RTCPeerConnection.prototype.setRemoteDescription;
    RTCPeerConnection.prototype.setRemoteDescription = function(description) {
      (window as any).__nearbyPeer = this;
      return remote.call(this, description);
    };
  });
  await page.goto(`${APP_URL}/?offline=1`, { waitUntil: "domcontentloaded" });
  await waitForText(page, "Nearby Offline Game");
  return page;
}

async function fill(page: Page, selector: string, value: string) {
  await page.click(selector);
  await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
  await page.keyboard.sendCharacter(value);
}

async function connectionCode(page: Page): Promise<string> {
  await page.waitForFunction(() => !!document.querySelector<HTMLTextAreaElement>('[aria-label="Your nearby connection code"]')?.value || document.body.innerText.includes("This browser did not provide a local Wi-Fi address"));
  if (await page.evaluate(() => document.body.innerText.includes("This browser did not provide a local Wi-Fi address"))) {
    assert(await page.evaluate(() => !document.querySelector<HTMLTextAreaElement>('[aria-label="Your nearby connection code"]')?.value), "browser without ICE candidates displays a useful error and emits no unusable pairing code");
    throw new Error("UNAVAILABLE: Chromium gathered zero host ICE candidates. Inspect managed WebRtcIPHandling policy and test on supported physical Wi-Fi devices; no successful data-channel claim is made.");
  }
  return page.$eval('[aria-label="Your nearby connection code"]', element => (element as HTMLTextAreaElement).value);
}

try {
  const host = await nearbyPage();
  const guest = await nearbyPage();
  await clickByText(host, "Host Game");
  const offer = await connectionCode(host);
  await clickByText(guest, "Join Game");
  await fill(guest, '[aria-label="Host invitation"]', offer);
  await clickByText(guest, "Create Reply");
  const answer = await connectionCode(guest);
  await fill(host, '[aria-label="Guest reply"]', answer);
  await clickByText(host, "Connect & Start Game");
  await waitForText(host, "● Connected"); await waitForText(guest, "● Connected");
  await host.waitForSelector('button[aria-label^="Square 31"]');
  assert(offer.startsWith("KENTRO-LAN-1:") && answer.startsWith("KENTRO-LAN-1:"), "actual browser offer/answer pairing completed");
  // Turn and state synchronization over the real ordered data channel.
  const move = generateLegalMoves(createInitialBoard(), "W")[0];
  await host.click(`button[aria-label^="Square ${move.from} "]`);
  await host.click(`button[aria-label="Square ${move.to}"]`);
  await waitForText(host, "1 moves"); await waitForText(guest, "1 moves");
  await waitForText(guest, "Your turn");
  assert(await guest.$(`button[aria-label^="Square ${move.to} "]`), "peer board contains the moved piece");
  await host.evaluate(() => (window as any).__nearbyChannels[0].send(JSON.stringify({ type: "draw-reply", accept: true })));
  await waitForText(guest, "Unexpected nearby draw response");
  assert(!(await guest.evaluate(() => document.body.innerText.includes("Draw agreed."))), "unsolicited draw acceptance cannot terminate play");
  await clickByText(host, "Offer Draw");
  await waitForText(guest, "Your opponent offers a draw");
  await clickByText(guest, "Accept");
  await waitForText(host, "Draw agreed"); await waitForText(guest, "Draw agreed");
  await host.evaluate(() => (window as any).__nearbyChannels[0].send(JSON.stringify({ type: "rematch-accept" })));
  await waitForText(guest, "Unexpected nearby rematch response");
  assert(await guest.$('button[aria-label^="Square 26 "]') || await guest.evaluate(() => document.body.innerText.includes("1 moves")), "unsolicited rematch acceptance preserves the finished game");
  await clickByText(host, "Play Again");
  await waitForText(guest, "Opponent wants a rematch"); await clickByText(guest, "Accept");
  await waitForText(host, "0 moves"); await waitForText(guest, "0 moves");
  await clickByText(host, "Resign");
  await waitForText(host, "Opponent wins"); await waitForText(guest, "You win");
  await snapshot(host, "nearby-01-host-result"); await snapshot(guest, "nearby-02-guest-result");
  await clickByText(host, "Disconnect");
  await waitForText(guest, "Disconnected");
  assert(await guest.evaluate(() => Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label^="Square"]')).every(button => button.disabled)), "connection loss pauses every board square");
  assert(errors.length === 0, `no page errors (${errors.join("; ")})`);
  console.log("PASS: real local WebRTC pairing, move mirror, consent guards, draw, rematch, resignation and disconnection.");
} catch (error) {
  console.error("Uncaught page errors:", errors);
  for (const [index, page] of pages.entries()) {
    console.error(`Nearby context ${index}: ${await page.evaluate(() => document.body.innerText)}`);
    console.error(await page.evaluate(() => {
      const peer: RTCPeerConnection | undefined = (window as any).__nearbyPeer;
      return peer ? { connection: peer.connectionState, ice: peer.iceConnectionState, candidates: (peer.localDescription?.sdp || "").split("\n").filter(line => line.startsWith("a=candidate:")).length } : { connection: "none" };
    }));
    await snapshot(page, `nearby-failure-${index}`);
  }
  throw error;
} finally { await browser.close(); }
