/** RFC 8291 aes128gcm Web Push and RFC 8292 VAPID using Node's built-in crypto.
 * No service account keys or private credentials are ever sent to browsers.
 */
import { ECDH, createECDH, createPrivateKey, createCipheriv, createHmac, randomBytes, sign } from "node:crypto";
import { getSupabaseAdmin } from "../../supabaseAdmin";

export interface BrowserPushSubscription { endpoint: string; keys: { p256dh: string; auth: string } }
const b64 = (bytes: Buffer) => bytes.toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");
const hkdfExpand = (prk: Buffer, info: Buffer, length: number) => createHmac("sha256", prk).update(info).update(Buffer.from([1])).digest().subarray(0,length);
const sha256hmac = (key: Buffer, value: Buffer) => createHmac("sha256",key).update(value).digest();
const utf8 = (v: string) => Buffer.from(v, "utf8");

export function vapidSettings() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY || "";
  const contact = process.env.WEB_PUSH_CONTACT || "";
  if (!publicKey || !privateKey || !/^mailto:.+@.+|^https:\/\/.+/.test(contact)) return null;
  try {
    const d = unb64(privateKey), pub = unb64(publicKey);
    if (d.length !== 32 || pub.length !== 65 || pub[0] !== 4) return null;
    const ecdh = createECDH("prime256v1"); ecdh.setPrivateKey(d);
    if (!ecdh.getPublicKey().equals(pub)) return null;
    return { publicKey, privateKey, contact };
  } catch { return null; }
}

/** Strict host allowlist: subscriptions are user input; never POST to internal/private infrastructure. */
export function safePushEndpoint(input: unknown): input is string {
  if (typeof input !== "string" || input.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(input)) return false;
  try {
    // URL normalizes an explicit :443 to an empty port. Check the original
    // authority as well to preserve the no-explicit-port endpoint contract.
    const authority = /^https:\/\/([^/?#]+)/i.exec(input)?.[1];
    if (!authority || authority.includes(":")) return false;
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !url.port && (
      host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" ||
      host === "push.services.mozilla.com" || host.endsWith(".push.apple.com") ||
      host === "web.push.apple.com" || host.endsWith(".notify.windows.com")
    );
  } catch { return false; }
}

export function validateSubscription(value: any): BrowserPushSubscription | null {
  if (!value || !safePushEndpoint(value.endpoint) || typeof value.keys?.p256dh !== "string" || typeof value.keys?.auth !== "string") return null;
  try {
    if (!/^[A-Za-z0-9_-]{87}$/.test(value.keys.p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(value.keys.auth)) return null;
    const pub = unb64(value.keys.p256dh), auth = unb64(value.keys.auth);
    if (pub.length !== 65 || pub[0] !== 4 || auth.length !== 16) return null;
    // A correctly sized uncompressed point can still be off the curve. Reject
    // it here instead of letting every queued delivery fail encryption/retry.
    ECDH.convertKey(pub, "prime256v1", undefined, undefined, "uncompressed");
    return { endpoint: value.endpoint, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
  } catch { return null; }
}

/** Outputs the encrypted RFC 8188 single-record body, never its plaintext. */
export function encryptPushPayload(subscription: BrowserPushSubscription, json: string): Buffer {
  const receiverPub = unb64(subscription.keys.p256dh), auth = unb64(subscription.keys.auth);
  const ephemeral = createECDH("prime256v1"); ephemeral.generateKeys();
  const serverPub = ephemeral.getPublicKey(), salt = randomBytes(16);
  const sharedSecret = ephemeral.computeSecret(receiverPub);
  const keyInfo = Buffer.concat([utf8("WebPush: info"), Buffer.from([0]), receiverPub, serverPub]);
  const ikm = hkdfExpand(sha256hmac(auth, sharedSecret), keyInfo, 32);
  const prk = sha256hmac(salt, ikm);
  const cek = hkdfExpand(prk, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdfExpand(prk, utf8("Content-Encoding: nonce\0"), 12);
  const cleartext = Buffer.concat([utf8(json), Buffer.from([2])]);
  if (cleartext.length + 16 >= 4096) throw new Error("Push payload too large");
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(cleartext), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([serverPub.length]), serverPub, ciphertext]);
}

export function createVapidAuthorization(endpoint: string, settings: NonNullable<ReturnType<typeof vapidSettings>>): string {
  const aud = new URL(endpoint).origin;
  const header = b64(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64(utf8(JSON.stringify({ aud, exp: Math.floor(Date.now()/1000) + 12*3600, sub: settings.contact })));
  const ecdh = createECDH("prime256v1"); ecdh.setPrivateKey(unb64(settings.privateKey));
  const pub = ecdh.getPublicKey();
  const key = createPrivateKey({ key: { kty: "EC", crv: "P-256", x: b64(pub.subarray(1,33)), y: b64(pub.subarray(33)), d: settings.privateKey }, format: "jwk" });
  const signature = sign("sha256", utf8(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${payload}.${b64(signature)}, k=${settings.publicKey}`;
}

export async function sendBrowserPush(sub: BrowserPushSubscription, payload: {title:string;body:string;url:string;tag:string}): Promise<number> {
  const settings = vapidSettings();
  if (!settings) return 503;
  if (!validateSubscription(sub)) return 400;
  const body = encryptPushPayload(sub, JSON.stringify(payload));
  const response = await fetch(sub.endpoint, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(9000), headers: {
    Authorization: createVapidAuthorization(sub.endpoint, settings),
    "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "normal",
  }, body });
  return response.status;
}

let deliveryRunning = false;
/** Processes undispatched notifications; records permanent errors and retries temporary network errors. */
export async function deliverPendingPushes(): Promise<void> {
  if (deliveryRunning || !vapidSettings() || !process.env.SUPABASE_SECRET_KEY) return;
  deliveryRunning = true;
  try {
    const db = getSupabaseAdmin();
    const {data, error} = await db.from("kentro_notifications")
      .select("id,recipient_id,category,title,body,target_path,created_at")
      .is("push_delivered_at", null).gte("created_at", new Date(Date.now()-6*3600_000).toISOString())
      .order("created_at", {ascending:true}).limit(60);
    if (error) throw error;
    for (const n of data || []) {
      const {data: subs, error: subError} = await db.from("kentro_push_subscriptions").select("endpoint,p256dh,auth,categories").eq("recipient_id", n.recipient_id).limit(8);
      if (subError) throw subError;
      let temporaryError = false;
      await Promise.all((subs || []).filter(s => !Array.isArray(s.categories) || s.categories.includes(n.category)).map(async s => {
        try {
          const sub = validateSubscription({ endpoint:s.endpoint, keys:{p256dh:s.p256dh,auth:s.auth} });
          if (!sub) return;
          const status = await sendBrowserPush(sub, {title:n.title,body:n.body,url:n.target_path,tag:n.id});
          if (status === 404 || status === 410) await db.from("kentro_push_subscriptions").delete().eq("endpoint", s.endpoint);
          else if (status === 429 || status >= 500) temporaryError = true;
        } catch { temporaryError = true; }
      }));
      if (!temporaryError) await db.from("kentro_notifications").update({push_delivered_at:new Date().toISOString()}).eq("id",n.id);
    }
  } finally { deliveryRunning = false; }
}
