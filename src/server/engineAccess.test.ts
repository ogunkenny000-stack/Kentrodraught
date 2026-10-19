import { describe, it, expect, vi } from "vitest";
import {
  authorizeEngineRequest,
  type EngineAccessDependencies,
} from "./engineAccess";
const fen = "W" + "w".repeat(20) + "e".repeat(10) + "b".repeat(20);
const deps: EngineAccessDependencies = {
  verify: vi.fn(async (token) => (token === "valid" ? "uid" : null)),
  unlocked: vi.fn(async () => 5),
};
describe("server engine entitlements", () => {
  it("allows free levels and replaces forged engine parameters", async () => {
    expect(
      await authorizeEngineRequest(
        {
          fen,
          purpose: "play",
          levelId: 2,
          depth: 99,
          thinkTime: 5,
          usePst: false,
        },
        "",
        deps,
      ),
    ).toMatchObject({ depth: 12, thinkTimeSec: 2.5, usePst: true });
  });
  it("rejects anonymous paid access and unauthenticated claims", async () => {
    await expect(
      authorizeEngineRequest(
        { fen, purpose: "play", levelId: 8, maxUnlockedKenLevel: 8 },
        "",
        deps,
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      authorizeEngineRequest(
        { fen, purpose: "play", levelId: 4 },
        "forged",
        deps,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("uses canonical purchased levels and denies levels above that entitlement", async () => {
    expect(
      await authorizeEngineRequest(
        { fen, purpose: "play", levelId: 5, depth: 99, thinkTime: 5 },
        "valid",
        deps,
      ),
    ).toMatchObject({ depth: undefined, thinkTimeSec: 0.4, usePst: false });
    await expect(
      authorizeEngineRequest(
        { fen, purpose: "play", levelId: 6 },
        "valid",
        deps,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("caps generic and explicit analysis to the available level", async () => {
    for (const purpose of [undefined, "analysis"])
      expect(
        await authorizeEngineRequest(
          { fen, purpose, depth: 99, thinkTime: 5 },
          "",
          deps,
        ),
      ).toMatchObject({ depth: 14, usePst: true, thinkTimeSec: 3 });
  });
  it("fails closed during profile lookup errors", async () => {
    await expect(
      authorizeEngineRequest({ fen, purpose: "play", levelId: 4 }, "valid", {
        ...deps,
        unlocked: async () => {
          throw new Error("offline");
        },
      }),
    ).rejects.toThrow("offline");
  });
  it.each([0, 9, 1.5, "8", null])(
    "rejects invalid level %s",
    async (levelId) => {
      await expect(
        authorizeEngineRequest({ fen, purpose: "play", levelId }, "", deps),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
  it("keeps legacy diagnostic options explicitly local only", async () => {
    expect(
      await authorizeEngineRequest(
        { fen, depth: 99, thinkTime: 5 },
        "",
        deps,
        true,
      ),
    ).toMatchObject({ depth: 99, thinkTimeSec: 5 });
  });
});
