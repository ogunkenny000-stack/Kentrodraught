import express from "express";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { configuredRecoveryRedirect, createUsernameAuthHandlers, type UsernameAuthClient, type UsernameAuthOptions } from "./usernameAuth";

async function withAuthServer(options: UsernameAuthOptions, run: (post: (path: string, body: unknown, headers?: Record<string, string>) => Promise<Response>) => Promise<void>) {
  const app = express();
  app.use(express.json());
  const handlers = createUsernameAuthHandlers(options);
  app.post("/signin", handlers.signIn);
  app.post("/recover", handlers.recover);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run((path, body, headers) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

function fixture() {
  const resolveEmail = vi.fn(async (username: string) => username === "player_one" ? "private@example.com" : null);
  const signInWithPassword = vi.fn(async ({ email, password }: { email: string; password: string }) => ({
    data: email === "private@example.com" && password === "valid-password" ? { session: { access_token: "access", refresh_token: "refresh" }, user: { id: "user-1" } } : { session: null, user: null }, error: null,
  }));
  const resetPasswordForEmail = vi.fn(async () => ({ data: {}, error: null }));
  const createAuthClient = vi.fn(() => ({ auth: { signInWithPassword, resetPasswordForEmail } }) as unknown as UsernameAuthClient);
  return { resolveEmail, createAuthClient, signInWithPassword, resetPasswordForEmail };
}

describe("server-only username authentication", () => {
  it("uses a new auth client for each request and returns a session without resolving emails publicly", async () => {
    const deps = fixture();
    await withAuthServer(deps, async post => {
      for (let i = 0; i < 2; i++) {
        const response = await post("/signin", { username: "  PLAYER_ONE  ", password: "valid-password" });
        expect(response.status).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(await response.json()).toEqual({ session: { access_token: "access", refresh_token: "refresh" }, user: { id: "user-1" } });
      }
    });
    expect(deps.resolveEmail).toHaveBeenCalledWith("player_one");
    expect(deps.createAuthClient).toHaveBeenCalledTimes(2);
  });

  it("does not distinguish unknown accounts, wrong passwords, malformed inputs and provider failures", async () => {
    const deps = fixture();
    await withAuthServer(deps, async post => {
      for (const body of [{ username: "unknown", password: "valid-password" }, { username: "player_one", password: "wrong-password" }, { username: { bad: true }, password: "valid-password" }, { username: "player_one", password: "x".repeat(1025) }]) {
        const response = await post("/signin", body);
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "Invalid username or password." });
      }
      deps.resolveEmail.mockRejectedValueOnce(new Error("provider secret details"));
      const response = await post("/signin", { username: "player_one", password: "valid-password" });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Invalid username or password." });
    });
    expect(deps.signInWithPassword).toHaveBeenCalledWith({ email: "username-not-found@invalid.invalid", password: "valid-password" });
  });

  it("limits both username and real socket IP, ignoring spoofed forwarded-for", async () => {
    const deps = fixture();
    await withAuthServer({ ...deps, signInUsernameLimit: { max: 1, windowMs: 60_000 }, signInIpLimit: { max: 2, windowMs: 60_000 } }, async post => {
      expect((await post("/signin", { username: "player_one", password: "wrong-password" })).status).toBe(401);
      expect((await post("/signin", { username: "PLAYER_ONE", password: "valid-password" }, { "X-Forwarded-For": "8.8.8.8" })).status).toBe(429);
      expect((await post("/signin", { username: "another_user", password: "valid-password" }, { "X-Forwarded-For": "1.1.1.1" })).status).toBe(429);
    });
    expect(deps.createAuthClient).toHaveBeenCalledTimes(1);
  });

  it("keeps legacy long display names and short existing passwords usable", async () => {
    const deps = fixture();
    const legacyName = `Legacy Player - ${"x".repeat(50)}`;
    await withAuthServer(deps, async post => {
      expect((await post("/signin", { username: legacyName, password: "old" })).status).toBe(401);
    });
    expect(deps.resolveEmail).toHaveBeenCalledExactlyOnceWith(legacyName.toLowerCase());
    expect(deps.signInWithPassword).toHaveBeenCalledWith({ email: "username-not-found@invalid.invalid", password: "old" });
  });

  it("always succeeds recovery publicly and redirects only to trusted configuration", async () => {
    const deps = fixture();
    await withAuthServer({ ...deps, appUrl: "https://game.example/app", recoveryUsernameLimit: { max: 1, windowMs: 60_000 } }, async post => {
      for (const body of [{ username: "player_one", redirectTo: "https://evil.test/" }, { username: "PLAYER_ONE" }, { username: "unknown" }, { username: ["bad"] }]) {
        const response = await post("/recover", body, { Origin: "https://evil.test", Host: "evil.test", "X-Forwarded-Host": "evil.test" });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
      }
    });
    expect(deps.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith("private@example.com", { redirectTo: "https://game.example" });
    const failing = fixture(); failing.resolveEmail.mockRejectedValue(new Error("do not expose"));
    await withAuthServer({ ...failing, appUrl: "https://game.example" }, async post => {
      expect(await (await post("/recover", { username: "player_one" })).json()).toEqual({ ok: true });
    });
  });

  it("does not send recovery emails when redirect configuration is absent or unsafe", async () => {
    const deps = fixture();
    await withAuthServer({ ...deps, appUrl: "https://evil.test@game.example" }, async post => {
      expect(await (await post("/recover", { username: "player_one", redirectTo: "https://evil.test" })).json()).toEqual({ ok: true });
    });
    expect(deps.resolveEmail).not.toHaveBeenCalled();
    expect(configuredRecoveryRedirect("http://localhost:3000/path")).toBe("http://localhost:3000");
    for (const input of [undefined, "javascript:alert(1)", "http://public.example", "https://user:pass@example.com", "https://example.com/#evil", " https://example.com", "https://example.com\\evil"]) expect(configuredRecoveryRedirect(input)).toBeUndefined();
  });
});
