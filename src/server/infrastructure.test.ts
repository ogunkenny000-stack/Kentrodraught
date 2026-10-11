import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";

const source = fs.readFileSync(path.resolve("public/sw.js"), "utf8");
const fixtureDirs: string[] = [];
afterEach(() => { for (const dir of fixtureDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function harness(options: { hostname?: string; storageFails?: boolean; writeFails?: boolean; cached?: Response; network?: () => Promise<Response> } = {}) {
  const handlers: Record<string, (event: any) => void> = {};
  const writes: string[] = [];
  const deleted: string[] = [];
  const hostname = options.hostname || "game.example";
  const cache = {
    match: vi.fn(async (_request: unknown) => options.cached),
    put: vi.fn(async (request: any, response: Response) => {
      if (options.writeFails) throw new Error("quota exceeded");
      writes.push(typeof request === "string" ? request : request.url);
      await response.text();
    }),
    addAll: vi.fn(async () => {}),
  };
  const fetch = vi.fn(options.network || (async () => new Response("fresh")));
  const caches = {
    open: vi.fn(async () => { if (options.storageFails) throw new Error("storage blocked"); return cache; }),
    keys: async () => ["unrelated-app-cache", "kentro-draught-old"],
    delete: async (key: string) => { deleted.push(key); return true; },
  };
  const self = {
    location: { hostname, origin: `https://${hostname}` },
    addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; },
    skipWaiting: vi.fn(async () => {}),
    registration: { unregister: vi.fn(async () => true) },
    clients: { claim: vi.fn(async () => {}) },
  };
  vm.runInNewContext(source, { self, caches, fetch, URL, Response, Promise });
  function dispatch(type: string, request: any = {}) {
    const waits: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    handlers[type]({ request, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<Response>) => { response = p; } });
    return { response, waits, async settle() { for (let i = 0; i < waits.length; i++) await waits[i]; } };
  }
  const request = (url: string, mode = "cors", method = "GET") => ({ url: `https://${hostname}${url}`, mode, method });
  return { dispatch, request, cache, fetch, writes, deleted, self };
}

describe("existing service worker", () => {
  it.each(["/api/coins/balance", "/api/engine/move", "/api/rooms"])("never intercepts live API %s", (url) => {
    const h = harness();
    expect(h.dispatch("fetch", h.request(url)).response).toBeUndefined();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("never caches writes or cross-origin requests", () => {
    const h = harness();
    expect(h.dispatch("fetch", h.request("/icon-192.png", "cors", "POST")).response).toBeUndefined();
    expect(h.dispatch("fetch", { url: "https://other.example/assets/app.js", method: "GET" }).response).toBeUndefined();
  });
  it("serves a successful asset request even when cache storage is unavailable", async () => {
    const h = harness({ storageFails: true });
    const e = h.dispatch("fetch", h.request("/assets/app.js"));
    expect(await (await e.response)!.text()).toBe("fresh");
    await e.settle();
  });
  it("handles a cache write rejection without breaking the network response", async () => {
    const h = harness({ writeFails: true });
    const e = h.dispatch("fetch", h.request("/assets/app.js"));
    expect(await (await e.response)!.text()).toBe("fresh");
    await e.settle();
    expect(h.cache.put).toHaveBeenCalledTimes(1);
  });
  it("returns a Response error, never undefined, on a first offline navigation", async () => {
    const h = harness({ network: async () => { throw new Error("offline"); } });
    const e = h.dispatch("fetch", h.request("/", "navigate"));
    expect((await e.response)!.type).toBe("error");
  });
  it("does not overwrite a working cached shell with a server error", async () => {
    const h = harness({ cached: new Response("working shell"), network: async () => new Response("unavailable", { status: 503 }) });
    const e = h.dispatch("fetch", h.request("/", "navigate"));
    expect(await (await e.response)!.text()).toBe("working shell");
    expect(h.cache.put).not.toHaveBeenCalled();
  });
  it("holds a background static-asset refresh alive after serving cached data", async () => {
    let finish!: (r: Response) => void;
    const network = new Promise<Response>((resolve) => { finish = resolve; });
    const h = harness({ cached: new Response("cached icon"), network: () => network });
    const e = h.dispatch("fetch", h.request("/icon-192.png"));
    expect(await (await e.response)!.text()).toBe("cached icon");
    expect(e.waits.length).toBeGreaterThan(0);
    finish(new Response("new icon"));
    await e.settle();
    expect(h.writes).toEqual(["https://game.example/icon-192.png"]);
  });
  it("development unregister only removes this app's caches", async () => {
    const h = harness({ hostname: "localhost" });
    const e = h.dispatch("activate");
    await e.settle();
    expect(h.deleted).toEqual(["kentro-draught-old"]);
    expect(h.self.registration.unregister).toHaveBeenCalledTimes(1);
  });
});

describe("production asset injection", () => {
  it("includes lazy runtime chunks, preserves dev guards, and is idempotent", () => {
    const dir = fs.mkdtempSync(path.resolve(".sw-fixture-"));
    fixtureDirs.push(dir);
    fs.mkdirSync(path.join(dir, "dist/assets/lazy"), { recursive: true });
    fs.writeFileSync(path.join(dir, "dist/sw.js"), source);
    fs.writeFileSync(path.join(dir, "dist/index.html"), "<html>shell</html>");
    for (const name of ["index-1.js", "index-1.css", "analysis-2.js", "lazy/worker-3.wasm", "photo.jpg"]) fs.writeFileSync(path.join(dir, "dist/assets", name), "fixture");
    const script = path.resolve("scripts/inject-sw-assets.cjs");
    const run = () => spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" });
    const first = run();
    expect(first.status, first.stderr).toBe(0);
    const result = fs.readFileSync(path.join(dir, "dist/sw.js"), "utf8");
    expect(result).toContain('"/assets/analysis-2.js"');
    expect(result).toContain('"/assets/lazy/worker-3.wasm"');
    expect(result).not.toContain('"/assets/photo.jpg"');
    expect(result).toContain("if (isDevEnv)");
    expect(() => new vm.Script(result)).not.toThrow();
    expect(run().status).toBe(0);
    expect(fs.readFileSync(path.join(dir, "dist/sw.js"), "utf8")).toBe(result);
  });
  it("fails clearly instead of succeeding with a missing build", () => {
    const dir = fs.mkdtempSync(path.resolve(".sw-fixture-"));
    fixtureDirs.push(dir);
    const result = spawnSync(process.execPath, [path.resolve("scripts/inject-sw-assets.cjs")], { cwd: dir, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("run vite build first");
  });
});
