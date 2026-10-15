import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RequestHandler } from "express";
import { getSupabaseAdmin } from "../../supabaseAdmin";
import { clientIp, createAttemptLimiter, type RateLimitRule } from "./securityMiddleware";

export type UsernameAuthClient = { auth: Pick<SupabaseClient["auth"], "signInWithPassword" | "resetPasswordForEmail"> };
export interface UsernameAuthOptions {
  resolveEmail?: (username: string) => Promise<string | null>;
  createAuthClient?: () => UsernameAuthClient;
  /** Trusted configuration only. Never derive this from request headers/body. */
  appUrl?: string;
  now?: () => number;
  signInIpLimit?: RateLimitRule;
  signInUsernameLimit?: RateLimitRule;
  recoveryIpLimit?: RateLimitRule;
  recoveryUsernameLimit?: RateLimitRule;
}

const invalidCredentials = { error: "Invalid username or password." };
const recoveryResult = { ok: true };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function normalizedUsername(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function configuredRecoveryRedirect(value: string | undefined): string | undefined {
  if (!value || value.trim() !== value || /[\s\\]/u.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash || !["http:", "https:"].includes(url.protocol)) return undefined;
    // HTTP is useful for local development, but never for a public reset URL.
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return undefined;
    return url.origin;
  } catch { return undefined; }
}

async function resolveEmail(username: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin().rpc("resolve_username_to_email", { p_username: username });
  if (error) throw error;
  return typeof data === "string" && data.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(data) ? data : null;
}

function createAuthClient(): UsernameAuthClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase authentication is not configured");
  // Password sign-in mutates the auth client's session. It must never run on the
  // shared service client used for privileged database calls.
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
}

/** Server-side username lookup keeps account emails out of public responses. */
export function createUsernameAuthHandlers(options: UsernameAuthOptions = {}): { signIn: RequestHandler; recover: RequestHandler } {
  const lookup = options.resolveEmail ?? resolveEmail;
  const newClient = options.createAuthClient ?? createAuthClient;
  const redirectTo = configuredRecoveryRedirect(options.appUrl ?? process.env.APP_URL ?? process.env.PUBLIC_APP_URL);
  const signInIp = createAttemptLimiter(options.signInIpLimit ?? { windowMs: 15 * 60_000, max: 30 }, options.now);
  const signInUsername = createAttemptLimiter(options.signInUsernameLimit ?? { windowMs: 15 * 60_000, max: 10 }, options.now);
  const recoveryIp = createAttemptLimiter(options.recoveryIpLimit ?? { windowMs: 60 * 60_000, max: 10 }, options.now);
  const recoveryUsername = createAttemptLimiter(options.recoveryUsernameLimit ?? { windowMs: 60 * 60_000, max: 5 }, options.now);

  const signIn: RequestHandler = async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const username = normalizedUsername(req.body?.username);
    const ipRetry = signInIp(clientIp(req));
    const userRetry = username ? signInUsername(digest(username)) : 0;
    const retryAfter = Math.max(ipRetry, userRetry);
    if (retryAfter) {
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: "Too many sign-in attempts. Please try again later." });
      return;
    }
    const password = req.body?.password;
    if (!username || typeof password !== "string" || password.length < 1 || Buffer.byteLength(password, "utf8") > 1024) {
      res.status(401).json(invalidCredentials); return;
    }
    try {
      const email = await lookup(username);
      // Keep the same auth-provider call for unknown usernames and wrong passwords.
      const { data, error } = await newClient().auth.signInWithPassword({ email: email || "username-not-found@invalid.invalid", password });
      if (!email || error || !data.session || !data.user) { res.status(401).json(invalidCredentials); return; }
      res.json({ session: data.session, user: data.user });
    } catch { res.status(401).json(invalidCredentials); }
  };

  const recover: RequestHandler = async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const username = normalizedUsername(req.body?.username);
    const ipRetry = recoveryIp(clientIp(req));
    const userRetry = username ? recoveryUsername(digest(username)) : 0;
    // Recovery always has the same public result, including invalid names,
    // provider errors, missing configuration and rate limits.
    if (!username || ipRetry || userRetry || !redirectTo) { res.json(recoveryResult); return; }
    try {
      const email = await lookup(username);
      if (email) await newClient().auth.resetPasswordForEmail(email, { redirectTo });
    } catch { /* Do not expose account existence or provider/configuration errors. */ }
    res.json(recoveryResult);
  };
  return { signIn, recover };
}
