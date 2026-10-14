import { supabase } from "../supabase";
import type { NotificationPreferences } from "./smartNotifications";

const categoryKeys = ["challenge","friend","tournament","result","system"] as const;
async function authHeaders(): Promise<Record<string,string>> {
  const {data} = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("Sign in before enabling push alerts.");
  return { "Content-Type":"application/json", Authorization:`Bearer ${data.session.access_token}` };
}
async function saveSubscription(sub: PushSubscription, prefs: NotificationPreferences) {
  const response = await fetch("/api/notifications/push-subscribe",{method:"POST",headers:await authHeaders(),body:JSON.stringify({subscription:sub.toJSON(),categories:categoryKeys.filter(c=>prefs[c])})});
  if (!response.ok) {const body=await response.json().catch(()=>({}));throw new Error(body.error||"Failed to save background alerts");}
}

export async function enableBackgroundPush(prefs: NotificationPreferences): Promise<"background" | "foreground"> {
  if (!("Notification" in window) || !window.isSecureContext) throw new Error("Notifications need HTTPS and a supported browser.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");
  // Browser-only notifications can still work when the server has no VAPID key.
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "foreground";
  const configResponse = await fetch("/api/notifications/push-config",{cache:"no-store"});
  if (!configResponse.ok) return "foreground";
  const {publicKey} = await configResponse.json();
  if (!publicKey || typeof publicKey !== "string") return "foreground";
  const key = Uint8Array.from(atob(publicKey.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
  // Development deliberately unregisters its service worker. Do not hang on
  // serviceWorker.ready when a registration has not been installed yet.
  if (!await navigator.serviceWorker.getRegistration()) return "foreground";
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
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
  const response = await fetch("/api/notifications/push-unsubscribe",{method:"POST",headers:await authHeaders(),body:JSON.stringify({endpoint})});
  if (!response.ok) throw new Error("Could not turn off push alerts on the server.");
  await subscription.unsubscribe();
}
