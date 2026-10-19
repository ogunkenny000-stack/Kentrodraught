import express from "express";
import { createHmac } from "node:crypto";
import { verifyAccessToken } from "../../supabaseAdmin";
import { requestAccessToken } from "./httpAuth";
export const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];
export function mediaIceConfiguration(
  uid: string | null,
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
) {
  const urls = (env.TURN_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    urls.some(
      (u) =>
        !/^turns?:[a-zA-Z0-9.\-[\]:]+(?::\d+)?(?:\?transport=(?:tcp|udp))?$/.test(
          u,
        ),
    )
  )
    throw new Error("Invalid TURN_URLS");
  if (!uid || !env.TURN_SHARED_SECRET || !urls.length)
    return {
      iceServers: STUN_SERVERS,
      relayConfigured: false,
      expiresAt: null,
    };
  const expires = Math.floor(now / 1000) + 600;
  const username = expires + ":" + uid;
  const credential = createHmac("sha1", env.TURN_SHARED_SECRET)
    .update(username)
    .digest("base64");
  return {
    iceServers: [...STUN_SERVERS, { urls, username, credential }],
    relayConfigured: true,
    expiresAt: expires * 1000,
  };
}
export function createMediaRouter(
  verify = verifyAccessToken,
  env: Record<string, string | undefined> = process.env,
) {
  const router = express.Router();
  router.get("/ice", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const uid = await verify(requestAccessToken(req.headers));
      res.json(mediaIceConfiguration(uid, env));
    } catch {
      res
        .status(503)
        .json({ error: "Media relay configuration is unavailable." });
    }
  });
  return router;
}
