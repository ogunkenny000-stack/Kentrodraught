import { beforeEach, describe, expect, it, vi } from "vitest";
const { from, verify } = vi.hoisted(() => ({ from: vi.fn(), verify: vi.fn() }));
vi.mock("../../supabaseAdmin", () => ({ getSupabaseAdmin: () => ({ from }), verifyAccessToken: verify }));
import { getAdminByUid, requirePermission } from "../../adminService";

beforeEach(() => vi.resetAllMocks());
function record(data: unknown, error: unknown = null) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }) };
  from.mockReturnValue(query);
  return query;
}
describe("admin identity boundaries", () => {
  it("never promotes an account by its username", async () => {
    record(null);
    await expect(getAdminByUid("ordinary-user")).resolves.toBeNull();
    expect(from).toHaveBeenCalledWith("admins");
    expect(from).not.toHaveBeenCalledWith("profiles");
  });
  it("rejects a record for a different immutable identity", async () => {
    record({ uid: "someone-else", username: "kennykristkentro", permissions: ["manage_admins"] });
    await expect(getAdminByUid("ordinary-user")).resolves.toBeNull();
  });
  it("fails closed on malformed grants and unavailable database", async () => {
    verify.mockResolvedValue("user");
    record({ uid: "user", permissions: "manage_admins" });
    await expect(requirePermission("token", "manage_admins")).resolves.toBeNull();
    record(null, new Error("unavailable"));
    await expect(requirePermission("token", "manage_admins")).resolves.toBeNull();
  });
  it("preserves valid explicit uid grants and ignores unknown permissions", async () => {
    verify.mockResolvedValue("user");
    record({ uid: "user", username: "alice", permissions: ["view_users", "made_up_admin_power"] });
    await expect(requirePermission("token", "view_users")).resolves.toMatchObject({ uid: "user", permissions: ["view_users"] });
    await expect(requirePermission("token", "manage_admins")).resolves.toBeNull();
  });
});
