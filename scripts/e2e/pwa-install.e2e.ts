import {APP_URL,assert,launchChrome,waitForText} from './harness';
const browser=await launchChrome();
const origin=new URL(APP_URL).origin;
const errors:string[]=[];
async function fresh(width=390,ios=false,standalone=false){
 const context=await browser.createBrowserContext();const page=await context.newPage();await page.setViewport({width,height:844});
 if(ios)await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1');
 await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(['http:','https:'].includes(u.protocol)&&u.origin!==origin)void r.abort();else void r.continue();});
 page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluateOnNewDocument((installed:boolean)=>{localStorage.setItem('kentro_splash_seen','true');sessionStorage.setItem('kentro_splash_seen','true');if(installed)Object.defineProperty(navigator,'standalone',{value:true,configurable:true});},standalone);
 await page.goto(APP_URL,{waitUntil:'domcontentloaded'});await waitForText(page,'Explore as guest');return page;
}
try{
 const page=await fresh();await page.click('[aria-label="Install Kentro app"]');await waitForText(page,'Install Kentro');assert(await page.$('[role="dialog"]')!==null,'visible install button opens keyboard-accessible browser instructions');await page.keyboard.press('Escape');await page.waitForSelector('[role="dialog"]',{hidden:true});
 await page.evaluate("window.__installCalls=0;window.dispatchEvent(Object.assign(new Event('beforeinstallprompt',{cancelable:true}),{prompt:async()=>{window.__installCalls++;},userChoice:Promise.resolve({outcome:'dismissed'})}));");
 await page.click('[aria-label="Install Kentro app"]');await page.waitForFunction(()=>(window as any).__installCalls===1);assert(await page.evaluate(()=>(window as any).__installCalls===1),'button calls the browser prompt once');await page.click('[aria-label="Install Kentro app"]');await waitForText(page,'Install Kentro');assert(await page.evaluate(()=>(window as any).__installCalls===1),'dismissed prompt is not reused');await page.keyboard.press('Escape');await page.waitForSelector('[role="dialog"]',{hidden:true});
 await waitForText(page,'Offline engine files ready',60000);
 await page.evaluate(async()=>{for(const key of await caches.keys())if(key.endsWith('-assets'))await(await caches.open(key)).delete('/engine/scan.wasm');window.dispatchEvent(new Event('online'));});
 await waitForText(page,'1 file still needs to download',15000);assert(true,'missing WASM is detected instead of reporting ready');
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent?.includes('Prepare offline play'))?.click());await waitForText(page,'Offline engine files ready',60000);assert(await page.evaluate(async()=>!!await caches.match('/engine/scan.wasm')),'prepare button restores missing WASM');
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent?.includes('Explore as guest'))?.click());await waitForText(page,'The board is yours.');assert(await page.$('[aria-label="Install Kentro app"]')!==null,'install control remains available in the signed-out guest header');
 for(const width of [320,390]){await page.setViewport({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}px home fits without horizontal scrolling`);}
 await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));await page.waitForFunction(()=>!document.querySelector('[aria-label="Install Kentro app"]'));assert(true,'installation event hides all install controls');
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()==='Play Ken Offline')?.click());await waitForText(page,'Play vs Ken · Offline');assert(new URL(page.url()).searchParams.get('offline')==='ken','offline practice preserves its URL for reload');await page.setOfflineMode(true);await page.reload({waitUntil:'domcontentloaded'});await waitForText(page,'Play vs Ken · Offline');await page.evaluate(()=>[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b=>b.textContent?.includes('Apply & Start'))?.click());await page.waitForSelector('[role="dialog"]',{hidden:true});await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()==='Offline files')?.click());await waitForText(page,'Offline engine files ready');assert(true,'offline Ken reloads with verified cached files after repair');
 const ios=await fresh(390,true);await ios.click('[aria-label="Install Kentro app"]');await waitForText(ios,'Tap Share, then Add to Home Screen.');assert(true,'iPhone guide explains the manual installation path');
 const installed=await fresh(390,false,true);assert(await installed.$('[aria-label="Install Kentro app"]')===null,'standalone app does not ask to install again');assert(errors.length===0,`no uncaught browser errors: ${errors.join('; ')}`);
 console.log('PASS install controls, native-prompt adapter, iPhone guide, standalone state, mobile layout, missing-engine detection, repair and actual offline reload. Browser installation itself remains user-controlled.');
}finally{await browser.close();}
