import { supabase } from "../supabase";
import type { NotificationPreferences } from "./smartNotifications";

const categoryKeys = ["challenge","friend","tournament","result","system"] as const;
// In particular, an unreachable push server must not hold sign-out open.
const pushFetch = (url: string, init: RequestInit = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
async function authHeaders(): Promise<Record<string,string>> {
  const {data} = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("Sign in before enabling push alerts.");
  return { "Content-Type":"application/json", Authorization:`Bearer ${data.session.access_token}` };
}
async function saveSubscription(sub: PushSubscription, prefs: NotificationPreferences) {
  const response = await pushFetch("/api/notifications/push-subscribe",{method:"POST",headers:await authHeaders(),body:JSON.stringify({subscription:sub.toJSON(),categories:categoryKeys.filter(c=>prefs[c])})});
  if (!response.ok) {const body=await response.json().catch(()=>({}));throw new Error(body.error||"Failed to save background alerts");}
}

export async function enableBackgroundPush(prefs: NotificationPreferences): Promise<"background" | "foreground"> {
  if (!("Notification" in window) || !window.isSecureContext) throw new Error("Notifications need HTTPS and a supported browser.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");
  // Browser-only notifications can still work when the server has no VAPID key.
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "foreground";
  const configResponse = await pushFetch("/api/notifications/push-config",{cache:"no-store"});
  if (!configResponse.ok) return "foreground";
  const {publicKey} = await configResponse.json();
  if (!publicKey || typeof publicKey !== "string") return "foreground";
  const key = Uint8Array.from(atob(publicKey.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
  // Development deliberately unregisters its service worker. Do not hang on
  // serviceWorker.ready when a registration has not been installed yet.
  const registration = await navigator.serviceWorker.getRegistration();
  // A registration that is still installing may never activate (offline or
  // failed install). Do not leave the user waiting indefinitely on .ready.
  if (!registration?.active) return "foreground";
  let existing = await registration.pushManager.getSubscription();
  const existingKey = existing?.options?.applicationServerKey;
  if (existing && existingKey && (existingKey.byteLength !== key.length || !key.every((value, i) => new Uint8Array(existingKey)[i] === value))) {
    if (!await existing.unsubscribe()) throw new Error("Could not update background alerts. Try again.");
    existing = null;
  }
  const subscription = existing || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  await saveSubscription(subscription, prefs);
  return "background";
}
export async function refreshBackgroundCategories(prefs: NotificationPreferences) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await saveSubscription(subscription,prefs);
}
export async function disableBackgroundPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  try {
    const response = await pushFetch("/api/notifications/push-unsubscribe",{method:"POST",headers:await authHeaders(),body:JSON.stringify({endpoint})});
    if (!response.ok) throw new Error("Could not turn off push alerts on the server.");
  } finally {
    // Sign-out can continue while the server is offline. Revoke this browser's
    // endpoint anyway so the next person using it cannot receive our alerts.
    await subscription.unsubscribe();
  }
}
