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

/**
 * HARDCODED OWNER ACCOUNT (explicitly requested): whoever is signed in as
 * this username is ALWAYS a full admin with every permission -- no env var,
 * no bootstrap step, no admins-table row required. The password lives in
 * Supabase Auth like any other account: register/sign in inside the app
 * with this username and your chosen password (e.g. kenny4123@) and the
 * server treats that account as the owner from then on. From the Admin
 * Panel's "Admins" tab the owner can then grant/revoke anyone else.
 *
 * Security note, in plain terms: the FIRST person to register this exact
 * username claims the owner seat, so register it before telling the world
 * about your app. Usernames are unique (profiles.usernameLower), so once
 * it's yours, it's yours.
 */
const SUPER_ADMIN_USERNAME = "kennykristkentro";

async function getSuperAdminRecord(uid: string): Promise<AdminRecord | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("profiles")
    .select("username, usernameLower")
    .eq("ownerId", uid)
    .maybeSingle();
  if (error || !data) return null;
  if ((data.usernameLower || "").toLowerCase() !== SUPER_ADMIN_USERNAME) return null;

  const rec: AdminRecord = {
    username: data.username,
    uid,
    permissions: [...ADMIN_PERMISSIONS],
    roleLabel: "Owner",
    addedAt: 0,
    addedBy: "hardcoded-owner",
  };
  // Best-effort mirror into the admins table so the Admins tab lists the
  // owner alongside everyone they appoint. Failure here changes nothing --
  // the hardcoded grant above is what actually authorizes them.
  void (async () => {
    try {
      await getSupabaseAdmin().from("admins").upsert({
        uid,
        username: data.username,
        permissions: rec.permissions,
        roleLabel: "Owner",
        addedAt: Date.now(),
        addedBy: "system(hardcoded-owner)",
      }, { onConflict: "uid" });
    } catch { /* cosmetic only */ }
  })();
  return rec;
}

/** Looks up the admin record for a verified Supabase user id, or null if they aren't one. */
export async function getAdminByUid(uid: string): Promise<AdminRecord | null> {
  const superRec = await getSuperAdminRecord(uid);
  if (superRec) return superRec;
  const { data, error } = await getSupabaseAdmin()
    .from("admins")
    .select("*")
    .eq("uid", uid)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as AdminRecord | null) ?? null;
}

/**
 * Verifies the request's access token AND that the resulting user id has the
 * given permission. Returns the AdminRecord on success, or null on any
 * failure (bad/missing token, not an admin, missing permission) -- callers
 * should respond 403 on null rather than distinguishing why, so as not to
 * leak which admins exist to an unauthenticated prober.
 */
export async function requirePermission(accessToken: string | undefined | null, permission: AdminPermission): Promise<AdminRecord | null> {
  const uid = await verifyAccessToken(accessToken);
  if (!uid) return null;
  const admin = await getAdminByUid(uid);
  if (!admin) return null;
  if (!admin.permissions.includes(permission)) return null;
  return admin;
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
