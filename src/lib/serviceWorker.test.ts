import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker(clients: Array<{ url: string; navigate: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> }> = []) {
  const handlers: Record<string, (event: any) => void> = {};
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const self = {
    location: { origin: "https://kentro.test", hostname: "kentro.test" },
    addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; },
    registration: { showNotification },
    clients: { matchAll: vi.fn().mockResolvedValue(clients), openWindow },
  };
  runInNewContext(readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"), { self, URL });
  async function dispatch(name: string, extra: Record<string, unknown>) {
    let pending: Promise<unknown> | undefined;
    handlers[name]({ ...extra, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
  }
  return { dispatch, showNotification, openWindow };
}

describe("notification service worker navigation", () => {
  it("rejects URLs whose control characters conceal an external origin", async () => {
    const context = worker();
    for (const url of ["/\t/attacker.test", "/\n/attacker.test", "//attacker.test", "/\\attacker.test"]) {
      await context.dispatch("push", { data: { json: () => ({ title: "A game", body: "Update", url }) } });
      expect(context.showNotification.mock.calls.at(-1)?.[1].data.url).toBe("/");
      await context.dispatch("notificationclick", { notification: { close: vi.fn(), data: { url } } });
      expect(context.openWindow).toHaveBeenLastCalledWith("https://kentro.test/");
    }
  });
  it("focuses an existing exact destination without reloading any app tab", async () => {
    const wrong = { url: "https://kentro.test.attacker.test/", navigate: vi.fn(), focus: vi.fn() };
    const other = { url: "https://kentro.test/?view=home", navigate: vi.fn(), focus: vi.fn() };
    const correct = { url: "https://kentro.test/?replay=2690001", navigate: vi.fn(), focus: vi.fn() };
    const context = worker([wrong, other, correct]);
    await context.dispatch("notificationclick", { notification: { close: vi.fn(), data: { url: "/?replay=2690001" } } });
    expect(wrong.navigate).not.toHaveBeenCalled();
    expect(other.navigate).not.toHaveBeenCalled();
    expect(correct.navigate).not.toHaveBeenCalled();
    expect(wrong.focus).not.toHaveBeenCalled();
    expect(other.focus).not.toHaveBeenCalled();
    expect(correct.focus).toHaveBeenCalledOnce();
    expect(context.openWindow).not.toHaveBeenCalled();
  });
  it("opens a different destination separately so an unfinished match can stay open", async () => {
    const playing = { url: "https://kentro.test/?room=1234567", navigate: vi.fn(), focus: vi.fn() };
    const context = worker([playing]);
    await context.dispatch("notificationclick", { notification: { close: vi.fn(), data: { url: "/?replay=2690001" } } });
    expect(playing.navigate).not.toHaveBeenCalled();
    expect(playing.focus).not.toHaveBeenCalled();
    expect(context.openWindow).toHaveBeenCalledWith("https://kentro.test/?replay=2690001");
  });
});
