/** Real WASM fixed-depth review, using a legal short custom game. */
import {APP_URL,assert,launchChrome} from './harness';
import {generateLegalMoves} from '../../src/gameLogic';
const browser=await launchChrome();const page=await browser.newPage();
try {
 const cdp=await page.createCDPSession();await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://*','wss://*']});
 await page.evaluateOnNewDocument(`window.__depthRequests=[];window.__depthResults=[];const OriginalWorker=window.Worker;window.Worker=class extends OriginalWorker{constructor(...args){super(...args);const send=this.postMessage.bind(this);this.postMessage=(data)=>{window.__depthRequests.push(data);send(data);};this.addEventListener('message',event=>window.__depthResults.push(event.data));}};`);
 await page.goto(APP_URL,{waitUntil:'domcontentloaded'});
 const start={23:'W',17:'b'} as const;const move=generateLegalMoves(start,'W')[0];
 const result:any=await page.evaluate(async(start,move)=>{
  const modulePath='/src/lib/analysis.ts'; const {analyzeMoveHistory}=await import(modulePath);
  const progress:number[]=[];const results=await analyzeMoveHistory([move],(p:number)=>progress.push(p),start,'W',new AbortController().signal);
  return {results,progress,requests:(window as any).__depthRequests,replies:(window as any).__depthResults};
 },start,move);
 assert(result.requests.length===1 && result.requests[0].depth===30 && result.requests[0].seconds===0,'full review requests depth 30 without the old half-second cutoff');
 assert(result.replies[0]?.result?.depth===30,'real WASM engine completes depth 30');
 assert(result.progress.at(-1)===100 && result.results[0],'full game reaches 100% with a graded move');
 console.log('PASS actual fixed-depth-30 WASM full-game review; terminal positions need no redundant engine call.');
}finally{await browser.close();}
