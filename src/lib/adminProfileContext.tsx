import React from "react";
import { AdminUserProfileModal } from "../components/admin/AdminUserProfileModal";

interface AdminProfileContextValue {
  /** True only for a signed-in admin holding the `view_users` permission --
   * this is what actually gates whether tapping a name anywhere opens their
   * full profile. Everyone else gets plain, inert text: no click handler,
   * no hover styling, no change from how it already looked. */
  canViewProfiles: boolean;
  /** Every admin permission the signed-in account holds, forwarded into the
   * profile modal so it can show/hide Ban, Suspend, and Reset Rating the
   * same way the Admin Panel's own Users tab already does. */
  permissions: string[];
  /** Open the full-profile modal for a username. No-ops for non-admins and
   * for an empty/missing name, so call sites never need to check first. */
  openAdminProfile: (username: string) => void;
}

const AdminProfileContext = React.createContext<AdminProfileContextValue>({
  canViewProfiles: false,
  permissions: [],
  openAdminProfile: () => {},
});

/** Read access to the admin-profile-viewer from anywhere in the tree. Most
 * call sites want <AdminTappableName> below instead of this directly. */
export function useAdminProfile() {
  return React.useContext(AdminProfileContext);
}

/**
 * Wraps the whole app once (see App.tsx). This is what makes "tap any
 * username, see their full profile" work from anywhere -- chat, lobby,
 * tournaments, friends, a live game -- without threading a callback prop
 * through every component in between. For a non-admin (or an admin without
 * `view_users`), this is entirely inert: openAdminProfile does nothing and
 * the modal never mounts.
 */
export function AdminProfileProvider({
  permissions = [],
  children,
}: {
  permissions?: string[];
  children: React.ReactNode;
}) {
  const [openUsername, setOpenUsername] = React.useState<string | null>(null);
  const perms = permissions || [];
  const canViewProfiles = perms.includes("view_users");

  const openAdminProfile = React.useCallback(
    (username: string) => {
      if (!canViewProfiles) return;
      const clean = (username || "").trim();
      if (!clean) return;
      setOpenUsername(clean);
    },
    [canViewProfiles]
  );

  return (
    <AdminProfileContext.Provider value={{ canViewProfiles, permissions: perms, openAdminProfile }}>
      {children}
      {canViewProfiles && openUsername && (
        <AdminUserProfileModal username={openUsername} permissions={perms} onClose={() => setOpenUsername(null)} />
      )}
    </AdminProfileContext.Provider>
  );
}

/**
 * Drop-in replacement for rendering a plain username as text. For an admin
 * with `view_users`, the name becomes a tap target that opens that
 * player's full profile right where it was tapped -- no detour through the
 * Admin Panel's own search first. For everyone else it renders exactly the
 * plain text it replaced: same content, same className, no click handler,
 * no visual change whatsoever.
 *
 * Safe to nest inside an already-clickable row (a "start chat" row, a
 * "load this game" row, etc.) -- tapping the name stops the click from
 * bubbling up, so it opens the profile instead of also firing the row's
 * own action.
 */
export function AdminTappableName({
  username,
  className = "",
  children,
}: {
  username: string | null | undefined;
  className?: string;
  children?: React.ReactNode;
}) {
  const { canViewProfiles, openAdminProfile } = useAdminProfile();
  const label = children ?? username;

  if (!canViewProfiles || !username) {
    return <span className={className}>{label}</span>;
  }

  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        openAdminProfile(username);
      }}
      title="View full profile (admin)"
      className={`${className} cursor-pointer hover:underline decoration-dotted decoration-amber-400/70 underline-offset-2`}
    >
      {label}
    </span>
  );
}
