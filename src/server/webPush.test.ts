import { describe, expect, it, vi } from "vitest";
import { createECDH, createHmac, createPublicKey, verify, createDecipheriv } from "node:crypto";
import { encryptPushPayload, createVapidAuthorization, safePushEndpoint, validateSubscription, vapidSettings } from "./webPush";

const b64 = (buffer: Buffer) => buffer.toString("base64url");
const hkdf = (key: Buffer, info: string | Buffer, len: number) =>
  createHmac("sha256", key).update(info).update(Buffer.from([1])).digest().subarray(0, len);
const mac = (key: Buffer, input: Buffer) => createHmac("sha256", key).update(input).digest();

describe("Web Push security and cryptography", () => {
  it("rejects internal, redirect and non-push subscription endpoints", () => {
    expect(safePushEndpoint("https://fcm.googleapis.com/fcm/send/123")).toBe(true);
    expect(safePushEndpoint("https://web.push.apple.com/QABC")).toBe(true);
    for (const invalid of ["http://localhost:8000", "https://127.0.0.1", "https://evil.test", "https://fcm.googleapis.com.evil.test/", "https://u:p@fcm.googleapis.com/", "https://fcm.googleapis.com:443/", "https://fcm.googleapis.com:8443/", "https://fcm.googleapis.com\n/"]) {
      expect(safePushEndpoint(invalid)).toBe(false);
    }
  });

  it("requires valid receiver P-256 and authentication keys", () => {
    const receiver = createECDH("prime256v1"); receiver.generateKeys();
    const endpoint = "https://fcm.googleapis.com/fcm/send/fixture";
    const subscription = {endpoint, keys:{p256dh:b64(receiver.getPublicKey()),auth:b64(Buffer.alloc(16,7))}};
    expect(validateSubscription(subscription)).toEqual(subscription);
    expect(validateSubscription({...subscription,keys:{...subscription.keys,auth:"invalid"}})).toBeNull();
    const offCurve = Buffer.alloc(65); offCurve[0] = 4;
    expect(validateSubscription({ ...subscription, keys: { ...subscription.keys, p256dh: b64(offCurve) } })).toBeNull();
    expect(validateSubscription({ ...subscription, keys: { ...subscription.keys, auth: subscription.keys.auth + "!" } })).toBeNull();
  });

  it("produces an RFC 8291 payload that the receiving device decrypts", () => {
    const receiver = createECDH("prime256v1"); receiver.generateKeys();
    const auth = Buffer.alloc(16, 9), receiverPub = receiver.getPublicKey();
    const subscription = { endpoint:"https://fcm.googleapis.com/fcm/send/fixture", keys:{p256dh:b64(receiverPub),auth:b64(auth)}};
    const clear = JSON.stringify({title:"Kentro game",body:"Your match finished",url:"/?replay=2690001",tag:"game1"});
    const packet = encryptPushPayload(subscription, clear);
    const salt = packet.subarray(0,16), recordSize = packet.readUInt32BE(16), serverKeyLen = packet[20];
    const serverKey = packet.subarray(21, 21 + serverKeyLen), ciphertext = packet.subarray(21 + serverKeyLen);
    expect(recordSize).toBe(4096);
    expect(serverKeyLen).toBe(65);
    const secret = receiver.computeSecret(serverKey);
    const info = Buffer.concat([Buffer.from("WebPush: info\0"), receiverPub, serverKey]);
    const ikm = hkdf(mac(auth,secret),info,32);
    const prk = mac(salt,ikm);
    const key = hkdf(prk,"Content-Encoding: aes128gcm\0",16);
    const nonce = hkdf(prk,"Content-Encoding: nonce\0",12);
    const decipher = createDecipheriv("aes-128-gcm", key, nonce);
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0,-16)),decipher.final()]);
    expect(plaintext.subarray(0,-1).toString()).toBe(clear);
    expect(plaintext[plaintext.length-1]).toBe(2);
  });

  it("creates a signed VAPID token for the push service origin", () => {
    const pair = createECDH("prime256v1"); pair.generateKeys();
    const publicKey = b64(pair.getPublicKey()), privateKey = b64(pair.getPrivateKey());
    const token = createVapidAuthorization("https://fcm.googleapis.com/fcm/send/test", {publicKey,privateKey,contact:"mailto:example@example.com"});
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(token);
    expect(match).not.toBeNull();
    const [,head,body,sig,pub] = match!;
    expect(pub).toBe(publicKey);
    const payload = JSON.parse(Buffer.from(body,"base64url").toString());
    expect(payload.aud).toBe("https://fcm.googleapis.com");
    const point = pair.getPublicKey();
    const key = createPublicKey({key:{kty:"EC",crv:"P-256",x:b64(point.subarray(1,33)),y:b64(point.subarray(33))},format:"jwk"});
    expect(verify("sha256",Buffer.from(`${head}.${body}`),{key,dsaEncoding:"ieee-p1363"},Buffer.from(sig,"base64url"))).toBe(true);
  });
});

it("accepts matching VAPID keys and rejects malformed contacts and key encodings", () => {
  const pair = createECDH("prime256v1"); pair.generateKeys();
  try {
    vi.stubEnv("WEB_PUSH_VAPID_PUBLIC_KEY", b64(pair.getPublicKey()));
    vi.stubEnv("WEB_PUSH_VAPID_PRIVATE_KEY", b64(pair.getPrivateKey()));
    vi.stubEnv("WEB_PUSH_CONTACT", "mailto:admin@example.com");
    expect(vapidSettings()).not.toBeNull();
    for (const contact of ["mailto:a@b\nInjected", "mailto:invalid", "https://user:password@example.com", "http://example.com"]) {
      vi.stubEnv("WEB_PUSH_CONTACT", contact); expect(vapidSettings()).toBeNull();
    }
    vi.stubEnv("WEB_PUSH_CONTACT", "https://example.com/contact");
    expect(vapidSettings()).not.toBeNull();
    vi.stubEnv("WEB_PUSH_VAPID_PUBLIC_KEY", b64(pair.getPublicKey()) + "!");
    expect(vapidSettings()).toBeNull();
  } finally { vi.unstubAllEnvs(); }
});
