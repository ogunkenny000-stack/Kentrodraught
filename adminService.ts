import { getSupabaseAdmin, verifyAccessToken } from "./supabaseAdmin";

/**
 * The full list of grantable admin permissions. This is intentionally NOT a
 * fixed set of role bundles (Super Admin / Tournament Admin / Moderator /
 * Support) -- Kenny asked for freeform per-admin control: "out of the list
 * of jobs admin can do I will pick the ones they have access to by myself
 * ... I can add or remove that access anytime." The role names below are
 * kept only as suggested presets the admin UI can use to pre-check a group
 * of boxes; they don't gate anything by themselves.
 */
export const ADMIN_PERMISSIONS = [
  "manage_admins",
  "view_users",
  "edit_users",
  "suspend_users",
  "ban_users",
  "view_games",
  "manage_tournaments",
  "manage_reports",
  "manage_payments",
  "manage_coin_settings",
  "credit_coins",
  "view_analytics",
  "manage_announcements",
  "view_audit_log",
  "manage_puzzles",
] as const;

export type AdminPermission = typeof ADMIN_PERMISSIONS[number];

export interface AdminRecord {
  username: string;
  uid: string;
  permissions: AdminPermission[];
  roleLabel?: string; // cosmetic only, e.g. "Moderator" -- does not grant anything by itself
  addedAt: number;
  addedBy: string;
}

/** Admin grants bind to immutable Supabase user ids. Display names never authorize. */
/** Looks up the admin record for a verified Supabase user id, or null if they aren't one. */
export async function getAdminByUid(uid: string): Promise<AdminRecord | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("admins")
    .select("*")
    .eq("uid", uid)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.uid !== uid || !Array.isArray(data.permissions)) return null;
  return {
    ...data,
    permissions: data.permissions.filter((permission: unknown): permission is AdminPermission =>
      typeof permission === "string" && (ADMIN_PERMISSIONS as readonly string[]).includes(permission)),
  } as AdminRecord;
}

/**
 * Verifies the request's access token AND that the resulting user id has the
 * given permission. Returns the AdminRecord on success, or null on any
 * failure (bad/missing token, not an admin, missing permission) -- callers
 * should respond 403 on null rather than distinguishing why, so as not to
 * leak which admins exist to an unauthenticated prober.
 */
export async function requirePermission(accessToken: string | undefined | null, permission: AdminPermission): Promise<AdminRecord | null> {
  try {
    const uid = await verifyAccessToken(accessToken);
    if (!uid) return null;
    const admin = await getAdminByUid(uid);
    return admin?.permissions.includes(permission) ? admin : null;
  } catch {
    return null; // Permission checks fail closed when storage is unavailable.
  }
}

/**
 * Every admin action must be logged (spec requirement) and logs must not be
 * editable. Using .insert() (create-only from this server-side path) rather
 * than exposing any update/delete path satisfies "not editable" -- there
 * simply is no function in this file that modifies or removes a log once
 * written, and no RLS policy grants clients any access to audit_logs at all
 * (see supabase/schema.sql).
 */
export async function writeAuditLog(entry: {
  adminUsername: string;
  adminUid: string;
  action: string;
  target?: string;
  details?: Record<string, unknown>;
  result: "success" | "failure";
  ip?: string | null;
}) {
  const { error } = await getSupabaseAdmin()
    .from("audit_logs")
    .insert({
      adminUsername: entry.adminUsername,
      adminUid: entry.adminUid,
      action: entry.action,
      target: entry.target ?? null,
      details: entry.details ?? null,
      result: entry.result,
      ip: entry.ip ?? null,
      timestamp: Date.now(),
    });
  if (error) throw error;
}
