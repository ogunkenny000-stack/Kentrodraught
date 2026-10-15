import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./smartNotifications";
import { disableBackgroundPush, enableBackgroundPush } from "./pushSubscription";

vi.mock("../supabase", () => ({ supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "local-fixture-token" } } }) } } }));

afterEach(() => { vi.unstubAllGlobals(); });

function browser(registration?: Record<string, unknown>) {
  const getRegistration = vi.fn().mockResolvedValue(registration);
  const requestPermission = vi.fn().mockResolvedValue("granted");
  vi.stubGlobal("window", { Notification: {}, PushManager: {}, isSecureContext: true });
  vi.stubGlobal("Notification", { requestPermission });
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration, ready: new Promise(() => {}) } });
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ publicKey: Buffer.alloc(65, 1).toString("base64url") }) });
  vi.stubGlobal("fetch", fetch);
  return { fetch, getRegistration, requestPermission };
}

describe("background push registration", () => {
  it("falls back promptly when a service worker registration has not activated", async () => {
    browser({ active: null });
    expect(await enableBackgroundPush(DEFAULT_NOTIFICATION_PREFERENCES)).toBe("foreground");
  });
  it("subscribes on the active registration without awaiting an unrelated ready promise", async () => {
    const subscription = { toJSON: () => ({ endpoint: "https://fcm.googleapis.com/local-fixture", keys: {} }) };
    const subscribe = vi.fn().mockResolvedValue(subscription);
    const context = browser({ active: {}, pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe } });
    expect(await enableBackgroundPush(DEFAULT_NOTIFICATION_PREFERENCES)).toBe("background");
    expect(subscribe).toHaveBeenCalledOnce();
    expect(context.fetch.mock.calls[1][0]).toBe("/api/notifications/push-subscribe");
    expect(JSON.parse(context.fetch.mock.calls[1][1].body).categories).toEqual(["challenge", "friend", "tournament", "result", "system"]);
  });
  it("denied permission stops before fetching configuration or saving a subscription", async () => {
    const context = browser();
    context.requestPermission.mockResolvedValue("denied");
    await expect(enableBackgroundPush(DEFAULT_NOTIFICATION_PREFERENCES)).rejects.toThrow("permission");
    expect(context.fetch).not.toHaveBeenCalled();
  });
  it("removes the server record and revokes the browser endpoint when disabling alerts", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const endpoint = "https://fcm.googleapis.com/local-fixture";
    const context = browser({ pushManager: { getSubscription: vi.fn().mockResolvedValue({ endpoint, unsubscribe }) } });
    await disableBackgroundPush();
    expect(context.fetch).toHaveBeenCalledWith("/api/notifications/push-unsubscribe", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ endpoint }),
      headers: expect.objectContaining({ Authorization: "Bearer local-fixture-token" }),
    }));
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it.each(["server failure", "network failure"])("revokes the browser endpoint even after %s during sign-out", async failure => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const context = browser({ pushManager: { getSubscription: vi.fn().mockResolvedValue({ endpoint: "https://fcm.googleapis.com/local-fixture", unsubscribe }) } });
    if (failure === "server failure") context.fetch.mockResolvedValue({ ok: false });
    else context.fetch.mockRejectedValue(new Error("Offline"));
    await expect(disableBackgroundPush()).rejects.toThrow(failure === "server failure" ? "server" : "Offline");
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
