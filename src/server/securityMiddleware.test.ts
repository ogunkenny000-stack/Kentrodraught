import express from "express";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createAttemptLimiter, createRateLimiter, securityHeaders } from "./securityMiddleware";

describe("HTTP security middleware", () => {
  it("bounds memory, fails closed at capacity and releases expired entries", () => {
    let now = 100;
    const attempt = createAttemptLimiter({ max: 2, windowMs: 1000, maxEntries: 2 }, () => now);
    expect(attempt("first")).toBe(0);
    expect(attempt("first")).toBe(0);
    expect(attempt("first")).toBe(1);
    expect(attempt("second")).toBe(0);
    expect(attempt("third")).toBe(1);
    now += 1000;
    expect(attempt("third")).toBe(0);
    expect(attempt("first")).toBe(0);
  });

  it("cannot bypass IP limits with forged forwarding headers", async () => {
    const app = express();
    app.use(securityHeaders, createRateLimiter({ max: 1, windowMs: 60_000 }));
    app.get("/", (_req, res) => res.json({ ok: true }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    try {
      const first = await fetch(url, { headers: { "X-Forwarded-For": "1.2.3.4" } });
      expect(first.status).toBe(200);
      expect(first.headers.get("X-Content-Type-Options")).toBe("nosniff");
      const second = await fetch(url, { headers: { "X-Forwarded-For": "5.6.7.8", "Forwarded": "for=9.8.7.6" } });
      expect(second.status).toBe(429);
      expect(second.headers.get("Retry-After")).toBe("60");
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
