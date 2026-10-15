import type { Request, RequestHandler } from "express";

export interface RateLimitRule { windowMs: number; max: number; maxEntries?: number }

/** Express resolves req.ip according to its explicit trust-proxy configuration.
 * Never read X-Forwarded-For directly: clients can supply it themselves. */
export function clientIp(req: Pick<Request, "ip" | "socket">): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

/** Fixed-window limiter with bounded memory and no timer keeping Node alive.
 * New identities fail closed when all retained entries are still active. */
export function createAttemptLimiter(rule: RateLimitRule, now = Date.now): (key: string) => number {
  if (!Number.isSafeInteger(rule.max) || rule.max < 1 || !Number.isFinite(rule.windowMs) || rule.windowMs < 1 ||
      (rule.maxEntries !== undefined && (!Number.isSafeInteger(rule.maxEntries) || rule.maxEntries < 1))) {
    throw new Error("Invalid rate limit rule");
  }
  const records = new Map<string, { count: number; resetAt: number }>();
  const maxEntries = rule.maxEntries ?? 10_000;
  let nextCleanup = 0;
  return (key: string): number => {
    const timestamp = now();
    if (timestamp >= nextCleanup) {
      for (const [storedKey, record] of records) if (record.resetAt <= timestamp) records.delete(storedKey);
      nextCleanup = timestamp + Math.min(rule.windowMs, 60_000);
    }
    const record = records.get(key);
    if (record && record.resetAt > timestamp) {
      if (record.count >= rule.max) return Math.max(1, Math.ceil((record.resetAt - timestamp) / 1000));
      record.count += 1;
      return 0;
    }
    if (records.size >= maxEntries && !records.has(key)) return Math.max(1, Math.ceil(rule.windowMs / 1000));
    records.set(key, { count: 1, resetAt: timestamp + rule.windowMs });
    return 0;
  };
}

export function createRateLimiter(rule: RateLimitRule, prefix = "global"): RequestHandler {
  const attempt = createAttemptLimiter(rule);
  return (req, res, next) => {
    const retryAfter = attempt(`${prefix}:${clientIp(req)}`);
    if (!retryAfter) return next();
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "Too many requests. Please slow down and try again later." });
  };
}

export const securityHeaders: RequestHandler = (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self)");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000");
  next();
};

/** Optional defense for configured deployments; bearer authorization remains
 * mandatory on protected routes. No Origin header is normal for native clients. */
export function createOriginGuard(allowedOrigins: readonly string[]): RequestHandler {
  const origins = new Set(allowedOrigins.map(value => new URL(value).origin));
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !req.headers.origin) return next();
    if (origins.has(req.headers.origin)) return next();
    res.status(403).json({ error: "Request origin is not allowed." });
  };
}
