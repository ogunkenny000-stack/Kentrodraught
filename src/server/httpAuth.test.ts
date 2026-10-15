import { describe, expect, it } from "vitest";
import { canReadGameRecord, requestAccessToken } from "./httpAuth";
describe("record access boundary", () => {
  it("allows public records without signing in", () => expect(canReadGameRecord({},null)).toBe(true));
  it.each([null,"intruder"])("denies private records to non-participants %s", uid => expect(canReadGameRecord({ private:true,participantUserIds:["player"] },uid)).toBe(false));
  it("allows the verified participant", () => expect(canReadGameRecord({ private:true,participantUserIds:["player"] },"player")).toBe(true));
  it("fails closed for private records missing participant bindings", () => expect(canReadGameRecord({ private:true },"player")).toBe(false));
  it("recognizes standard bearer and existing access-token headers", () => {
    expect(requestAccessToken({authorization:"Bearer token"})).toBe("token");
    expect(requestAccessToken({"x-access-token":"legacy"})).toBe("legacy");
    expect(requestAccessToken({authorization:"Basic token"})).toBeUndefined();
    expect(requestAccessToken({authorization:["Bearer a","Bearer b"]})).toBeUndefined();
  });
});
