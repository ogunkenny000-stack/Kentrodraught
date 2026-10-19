export type NotificationCategory = "challenge" | "friend" | "tournament" | "result" | "system";
export interface KentroNotification {
  id: string;
  recipient_id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  target_path: string;
  created_at: string;
  read_at: string | null;
}
export type NotificationPreferences = Record<NotificationCategory, boolean> & { browserAlerts: boolean };
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  challenge: true, friend: true, tournament: true, result: true, system: true, browserAlerts: false,
};
export function notificationStorageKey(userId: string) { return `kd.notification.prefs.${userId}`; }
export function loadNotificationPreferences(userId: string): NotificationPreferences {
  try {
    const raw = localStorage.getItem(notificationStorageKey(userId));
    if (raw) {
      const data = JSON.parse(raw);
      return Object.fromEntries(Object.entries(DEFAULT_NOTIFICATION_PREFERENCES).map(([key, value]) => [key, typeof data[key] === "boolean" ? data[key] : value])) as NotificationPreferences;
    }
  } catch {}
  return { ...DEFAULT_NOTIFICATION_PREFERENCES };
}
export function validNotificationPath(path: string): string {
  // Only same-site relative navigation, never arbitrary URLs or JS schemes.
  // The URL parser strips tabs/newlines before resolving a URL. Reject them
  // before testing the prefix so /\t/attacker cannot become //attacker.
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(path)) return "/";
  return path;
}
export function unreadCount(items: KentroNotification[], prefs: NotificationPreferences): number {
  return items.filter(i => !i.read_at && prefs[i.category] !== false).length;
}
