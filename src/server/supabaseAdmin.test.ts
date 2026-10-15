import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { getUser, maybeSingle, createClient } = vi.hoisted(() => ({ getUser: vi.fn(), maybeSingle: vi.fn(), createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
let verifyAccessToken: typeof import("../../supabaseAdmin").verifyAccessToken;
beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://fixture.invalid"); vi.stubEnv("SUPABASE_SECRET_KEY", "fixture-not-a-real-key");
  createClient.mockReturnValue({ auth: { getUser }, from: () => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle }) });
  ({ verifyAccessToken } = await import("../../supabaseAdmin"));
});
afterEach(() => vi.unstubAllEnvs());
describe("access-token verification and account moderation", () => {
  it("does not query auth without a token", async () => {
    await expect(verifyAccessToken(null)).resolves.toBeNull(); expect(getUser).not.toHaveBeenCalled();
  });
  it("returns only the identity verified by Auth", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "verified" } }, error: null });
    maybeSingle.mockResolvedValue({ data: { banned: false, suspendedUntil: null }, error: null });
    await expect(verifyAccessToken("access-token")).resolves.toBe("verified");
  });
  it.each([{ banned: true }, { suspendedUntil: Date.now() + 86_400_000 }, { usernameLower: "kentro_house" }])("rejects restricted accounts", async profile => {
    getUser.mockResolvedValue({ data: { user: { id: "restricted" } }, error: null });
    maybeSingle.mockResolvedValue({ data: profile, error: null });
    await expect(verifyAccessToken("access-token")).resolves.toBeNull();
  });
  it("allows an expired suspension", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "verified" } }, error: null });
    maybeSingle.mockResolvedValue({ data: { suspendedUntil: 1 }, error: null });
    await expect(verifyAccessToken("access-token")).resolves.toBe("verified");
  });
  it("fails closed on profile lookup failure", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "verified" } }, error: null });
    maybeSingle.mockResolvedValue({ data: null, error: new Error("unavailable") });
    await expect(verifyAccessToken("access-token")).resolves.toBeNull();
  });
  it("rejects expired or forged tokens", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error("invalid JWT") });
    await expect(verifyAccessToken("forged")).resolves.toBeNull(); expect(maybeSingle).not.toHaveBeenCalled();
  });
  it("fails closed when credentials are missing", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    await expect(verifyAccessToken("token")).resolves.toBeNull(); expect(getUser).not.toHaveBeenCalled();
  });
});
