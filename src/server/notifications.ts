import { getSupabaseAdmin } from "../../supabaseAdmin";

export type NotificationCategory = "challenge" | "friend" | "tournament" | "result" | "system";
const configured = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);

function cleanUsername(username: string): string {
  return typeof username === "string" ? username.trim().toLowerCase().slice(0, 60) : "";
}

export async function accountForUsername(username: string): Promise<string | null> {
  if (!configured()) return null;
  const name = cleanUsername(username);
  if (!name) return null;
  const { data, error } = await getSupabaseAdmin().from("profiles").select("ownerId").eq("usernameLower", name).maybeSingle();
  if (error) throw error;
  return data?.ownerId || null;
}

export async function insertNotification(recipientId: string, category: NotificationCategory, title: string, body: string, targetPath: string, dedupeKey: string): Promise<void> {
  if (!configured()) return;
  if (!/^\/[\w?&=/%.-]*$/.test(targetPath) || targetPath.startsWith("//")) throw new Error("Invalid notification navigation path");
  const { error } = await getSupabaseAdmin().from("kentro_notifications").upsert({
    recipient_id: recipientId, category, title: title.slice(0, 150), body: body.slice(0, 500), target_path: targetPath,
    dedupe_key: dedupeKey.slice(0, 200),
  }, { onConflict: "recipient_id,dedupe_key", ignoreDuplicates: true });
  if (error) throw error;
}

export async function notifyUsername(username: string, category: NotificationCategory, title: string, body: string, targetPath: string, dedupeKey: string): Promise<void> {
  const id = await accountForUsername(username);
  if (id) await insertNotification(id, category, title, body, targetPath, dedupeKey);
}

/** Invoked by the online game authority, never by the player's browser. */
export async function notifyMatchEnded(gameCode: string, white: string, black: string, winner: string | null): Promise<void> {
  if (!gameCode || !configured()) return;
  await Promise.allSettled([white, black].map(async player => {
    const other = player.toLowerCase() === white.toLowerCase() ? black : white;
    const message = winner ? winner.toLowerCase() === player.toLowerCase() ? `You won against ${other}. Watch your replay on Kentro TV.` : `${other} won the match. Review the game on Kentro TV.` : `Your match with ${other} was a draw. Review the replay.`;
    await notifyUsername(player, "result", "Your match has finished", message, `/?replay=${encodeURIComponent(gameCode)}`, `result:${gameCode}`);
  }));
}

/** Periodic reminders; dedupe keys guarantee at most one alert per participant per tournament. */
export async function sendTournamentReminders(nowMs = Date.now()): Promise<void> {
  if (!configured()) return;
  const { data, error } = await getSupabaseAdmin().from("tournaments").select("id,name,status,startTime,players").in("status", ["open", "registration", "upcoming", "active"]).limit(150);
  if (error) throw error;
  for (const tour of data || []) {
    const date = Date.parse(String(tour.startTime || ""));
    if (!Number.isFinite(date) || date < nowMs || date > nowMs + 15 * 60_000) continue;
    for (const p of Array.isArray(tour.players) ? tour.players : []) {
      const name = typeof p === "string" ? p : p?.username || p?.name;
      if (typeof name !== "string") continue;
      try { await notifyUsername(name, "tournament", "Tournament starts soon", `${tour.name || "Your tournament"} begins within 15 minutes.`, "/?view=tournament", `starting:${tour.id}:${date}`); }
      catch (err) { console.error("[Notifications] Tournament reminder failed", err); }
    }
  }
}
