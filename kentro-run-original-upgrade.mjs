import fs from 'node:fs/promises';import crypto from 'node:crypto';
const ref='pwovowlyylceuzontdhg',site='https://kentrodraught.ai.studio',asset='/assets/index-UX8mt1L2.js';
const result={project:ref,liveDatabaseModified:false,readyForLiveUpgrade:false};
try{
if(!process.env.SUPABASE_ACCESS_TOKEN)throw Error('Management credential is unavailable');
const page=await fetch(site+'/',{signal:AbortSignal.timeout(15000)});const html=await page.text();
const settingsResponse=await fetch(site+'/api/coins/settings',{signal:AbortSignal.timeout(15000)});const settings=await settingsResponse.json();
result.updatedAssetsPresent=html.includes(asset);result.liveCoinsEnabled=settings.coinsEnabled;
if(!result.updatedAssetsPresent||settings.coinsEnabled!==false){result.blocker='Deploy the original-project upgrade ZIP first. Current live backend is not the verified gated deployment.';console.log(JSON.stringify(result,null,2));await fs.writeFile('/workspace/scratch/kentro-original-live-upgrade-status.json',JSON.stringify(result,null,2));process.exitCode=2;}else{
const published=Buffer.from(await(await fetch(site+asset)).arrayBuffer());const expected=await fs.readFile('/workspace/uploaded-app/kentro-draughts/dist'+asset);if(crypto.createHash('sha256').update(published).digest('hex')!==crypto.createHash('sha256').update(expected).digest('hex'))throw Error('Deployed bundle differs from verified candidate');
if((await fetch(site+'/api/coins/wallet/alice')).status!==503)throw Error('Expected disabled financial route before upgrade');
const report=JSON.parse(await fs.readFile('/workspace/scratch/kentro-original-upgrade-rehearsal.json','utf8'));if(!report.passed||!report.atomicRollbackVerified)throw Error('Original-data upgrade rehearsal is not complete');
const query=await fs.readFile('/workspace/scratch/Kentro-original-upgrade.sql','utf8');if(crypto.createHash('sha256').update(query).digest('hex')!==report.sqlSha256)throw Error('Upgrade SQL differs from rehearsed file');result.readyForLiveUpgrade=true;
const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(150000)});
if(!response.ok){const error=await response.json();throw Error('Upgrade failed atomically: '+String(error.message||'HTTP '+response.status).split('\n')[0]);}await response.arrayBuffer();result.liveDatabaseModified=true;result.status='Database upgraded; hosting backend restart and live acceptance checks remain necessary';console.log(JSON.stringify(result,null,2));await fs.writeFile('/workspace/scratch/kentro-original-live-upgrade-status.json',JSON.stringify(result,null,2));
}
}catch(error){result.blocker=String(error.message).split('\n')[0];await fs.writeFile('/workspace/scratch/kentro-original-live-upgrade-status.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=1;}
