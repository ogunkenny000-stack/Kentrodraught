import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./smartNotifications";
import { disableBackgroundPush, enableBackgroundPush } from "./pushSubscription";

vi.mock("../supabase", () => ({ supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "local-fixture-token" } } }) } } }));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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

const prefs = { challenge:true, friend:true, tournament:true, result:true, system:true } as any;

function rotationBrowser(subscription: any) {
  const manager = {getSubscription: vi.fn(async () => subscription), subscribe: vi.fn(async () => ({toJSON:()=>({endpoint:'new-fixture'})}))};
  vi.stubGlobal('window', {Notification:{}, PushManager:{}, isSecureContext:true});
  vi.stubGlobal('Notification', {requestPermission:async ()=>'granted'});
  vi.stubGlobal('navigator', {serviceWorker:{getRegistration:async ()=>({active:{},pushManager:manager})}});
  return manager;
}
it('revokes the browser endpoint even when server removal times out', async () => {
  const unsubscribe = vi.fn(async () => true); rotationBrowser({endpoint:'fixture',unsubscribe});
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal,'timeout').mockReturnValue(controller.signal);
  vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve,reject) => {
    options.signal.addEventListener('abort',()=>reject(new DOMException('Timed out','TimeoutError')));
    queueMicrotask(()=>controller.abort());
  })));
  await expect(disableBackgroundPush()).rejects.toMatchObject({name:'TimeoutError'});
  expect(timeout).toHaveBeenCalledWith(8000);
  expect(unsubscribe).toHaveBeenCalledOnce();
});
it('replaces a subscription bound to an old VAPID key before saving it', async () => {
  const unsubscribe = vi.fn(async () => true);
  const manager = rotationBrowser({options:{applicationServerKey:new Uint8Array([9,8]).buffer},unsubscribe});
  const fetcher=vi.fn(async (url: string) => url.endsWith('push-config') ? {ok:true,json:async()=>({publicKey:'AQID'})} : {ok:true});
  vi.stubGlobal('fetch',fetcher);
  await expect(enableBackgroundPush(prefs)).resolves.toBe('background');
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(manager.subscribe).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[1][0]).toBe('/api/notifications/push-subscribe');
});
