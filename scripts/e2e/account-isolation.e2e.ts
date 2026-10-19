/** Delayed account-A responses must not populate a signed-out guest session.
 * Uses synthetic browser responses only; all hosted traffic is blocked. */
import { APP_URL, assert, launchChrome, waitForText } from './harness';
const browser = await launchChrome();
const page = await browser.newPage();
const pending: Array<() => Promise<void>> = [];
try {
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    const reply = (value: unknown) => request.respond({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(value)});
    if (url.pathname.startsWith('/api/coins/wallet/')) pending.push(() => reply({balance:987654}));
    else if (url.pathname === '/api/admin/whoami') pending.push(() => reply({isAdmin:true,permissions:['manage_tournaments']}));
    else if (url.hostname === 'placeholder.supabase.co' && url.pathname === '/auth/v1/logout') void request.respond({status:204,headers:{'access-control-allow-origin':'*'}});
    else if (url.origin === new URL(APP_URL).origin || !['http:','https:'].includes(url.protocol)) void request.continue();
    else void request.abort();
  });
  await page.evaluateOnNewDocument(() => {
    const exp = Math.floor(Date.now()/1000)+21600;
    const uid = '00000000-0000-4000-8000-000000000099';
    const token = 'eyJhbGciOiJIUzI1NiJ9.'+btoa(JSON.stringify({sub:uid,aud:'authenticated',role:'authenticated',exp}))+'.fixture';
    localStorage.setItem('sb-placeholder-auth-token',JSON.stringify({access_token:token,token_type:'bearer',expires_at:exp,expires_in:21600,refresh_token:'fixture',user:{id:uid,aud:'authenticated',role:'authenticated',email:'isolated@example.test',email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{username:'isolationfixture',email_verified:true},identities:[]}}));
    localStorage.setItem('kentro_splash_seen','true');sessionStorage.setItem('kentro_splash_seen','true');
  });
  await page.goto(APP_URL,{waitUntil:'domcontentloaded'});
  await waitForText(page,'Sign out');
  await page.waitForFunction(() => document.body.innerText.includes('YOUR DRAUGHTS HOME'));
  // Both original requests are deliberately still in flight during sign-out.
  const deadline = Date.now()+10000;
  while(pending.length < 2 && Date.now()<deadline) await new Promise(r=>setTimeout(r,50));
  assert(pending.length >= 2,'wallet and admin requests are pending for the original identity');
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()==='Sign out')?.click());
  await waitForText(page,'Explore as guest');
  // No reload: preserve the App instance and its asynchronous callbacks.
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.includes('Explore as guest'))?.click());
  await waitForText(page,'Guest Mode');
  await Promise.all(pending.splice(0).map(reply=>reply()));
  await page.waitForNetworkIdle({idleTime:300,timeout:10000}).catch(()=>{});
  const text = await page.evaluate(()=>document.body.innerText);
  assert(text.includes('Coins · 0') && !text.includes('987654'),'late wallet response cannot appear in the next session');
  assert(!text.includes('Administration'),'late admin response cannot expose previous account controls');
  console.log('PASS delayed wallet/admin responses remain isolated after sign-out and guest continuation.');
} finally {await browser.close();}
