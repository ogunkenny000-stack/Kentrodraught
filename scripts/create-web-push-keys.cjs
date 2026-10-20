/** Run once on the deployment host; never commit the resulting secret file. */
const {createECDH}=require('node:crypto');
const {writeFileSync}=require('node:fs');
const {resolve}=require('node:path');
const target=resolve(process.argv[2]||'.env.web-push');
const contact=process.argv[3]||'https://kentrodraught.ai.studio';
const url=new URL(contact);
if(!['mailto:','https:'].includes(url.protocol)||/[\s\r\n]/.test(contact)||url.hash||url.username||url.password)throw Error('Use a valid mailto: or https: push contact');
if(url.protocol==='mailto:'&&(!/^[^@?]+@[^@?]+\.[^@?]+$/.test(url.pathname)||url.search))throw Error('Invalid mailto contact');
const keys=createECDH('prime256v1');keys.generateKeys();
writeFileSync(target,`WEB_PUSH_VAPID_PUBLIC_KEY=${keys.getPublicKey().toString('base64url')}\nWEB_PUSH_VAPID_PRIVATE_KEY=${keys.getPrivateKey().toString('base64url')}\nWEB_PUSH_CONTACT=${contact}\n`,{flag:'wx',mode:0o600});
console.log('Push configuration saved to '+target+'. Add these values securely to the hosting environment and restart. Keep the private key secret and preserve this key pair.');
