import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, verifyAccessToken, maybeSingle } = vi.hoisted(() => ({
  from: vi.fn(), verifyAccessToken: vi.fn(), maybeSingle: vi.fn(),
}));
vi.mock("../../supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({ from }), verifyAccessToken,
}));
import { getAdminByUid, requirePermission } from "../../adminService";

beforeEach(() => {
  vi.resetAllMocks();
  from.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle });
});

describe("administrator identity", () => {
  it("never promotes a matching owner display name without an explicit admin row", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getAdminByUid("attacker")).resolves.toBeNull();
    expect(from).toHaveBeenCalledExactlyOnceWith("admins");
  });
  it("retains explicit grants and excludes unrecognized permissions", async () => {
    maybeSingle.mockResolvedValue({ data: { uid: "uid", username: "owner", permissions: ["view_games", "root", null] }, error: null });
    await expect(getAdminByUid("uid")).resolves.toMatchObject({ permissions: ["view_games"] });
  });
  it.each([null, { uid: "other", permissions: ["manage_admins"] }, { uid: "uid", permissions: "manage_admins" }])("rejects malformed or mismatched admin rows", async (data) => {
    maybeSingle.mockResolvedValue({ data, error: null });
    await expect(getAdminByUid("uid")).resolves.toBeNull();
  });
  it("fails closed on an ambiguous or unavailable admin lookup", async () => {
    verifyAccessToken.mockResolvedValue("uid");
    maybeSingle.mockResolvedValue({ data: null, error: new Error("duplicate rows") });
    await expect(requirePermission("token", "manage_admins")).resolves.toBeNull();
  });
  it("does not look up admins for an invalid token", async () => {
    verifyAccessToken.mockResolvedValue(null);
    await expect(requirePermission("expired", "manage_admins")).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
  it("requires the requested permission even for a cosmetic Owner role", async () => {
    verifyAccessToken.mockResolvedValue("uid");
    maybeSingle.mockResolvedValue({ data: { uid: "uid", roleLabel: "Owner", permissions: ["view_games"] }, error: null });
    await expect(requirePermission("token", "manage_admins")).resolves.toBeNull();
    await expect(requirePermission("token", "view_games")).resolves.toMatchObject({ uid: "uid" });
  });
});
