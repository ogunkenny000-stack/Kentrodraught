import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { mediaIceConfiguration } from "./mediaConfig";
describe("short-lived media relay credentials", () => {
  it("never exposes a shared relay credential to anonymous callers", () => {
    const result = mediaIceConfiguration(
      null,
      {
        TURN_URLS: "turn:relay.example:3478",
        TURN_SHARED_SECRET: "local-test-secret",
      },
      1000000,
    );
    expect(result.iceServers).toHaveLength(2);
    expect(result.relayConfigured).toBe(false);
  });
  it("issues authenticated bounded credentials without exposing the shared secret", () => {
    const env = {
      TURN_URLS:
        "turn:relay.example:3478,turns:relay.example:443?transport=tcp",
      TURN_SHARED_SECRET: "local-test-secret",
    };
    const result = mediaIceConfiguration("fixture-user", env, 1000000);
    const relay = result.iceServers[2] as any;
    expect(relay.username).toBe("1600:fixture-user");
    expect(relay.credential).toBe(
      createHmac("sha1", env.TURN_SHARED_SECRET)
        .update(relay.username)
        .digest("base64"),
    );
    expect(result.expiresAt).toBe(1600000);
    expect(JSON.stringify(result)).not.toContain(env.TURN_SHARED_SECRET);
  });
  it("rejects injected or HTTP relay URLs", () => {
    expect(() =>
      mediaIceConfiguration("u", {
        TURN_URLS: "https://internal.example",
        TURN_SHARED_SECRET: "fixture",
      }),
    ).toThrow();
    expect(() =>
      mediaIceConfiguration("u", {
        TURN_URLS: "turn:relay.example\nAuthorization:injected",
      }),
    ).toThrow();
  });
});
