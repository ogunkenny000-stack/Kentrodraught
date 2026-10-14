import { describe, expect, it, vi, afterEach } from "vitest";
import {
  cleanInviteRoomCode,
  getRoomCodeFromUrl,
  makeRoomInviteUrl,
  removeRoomInviteFromUrl,
  copyInviteText,
} from "./roomInvite";

describe("WhatsApp room invitations", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a tappable, room-specific HTTPS invitation", () => {
    expect(makeRoomInviteUrl("2680001", "https://draught.com"))
      .toBe("https://draught.com/?room=2680001");
  });

  it("normalizes a room code exactly as the online server does", () => {
    expect(cleanInviteRoomCode("  ab-1234  ")).toBe("AB1234");
    expect(cleanInviteRoomCode("1234567890123")).toBe("1234567890");
    expect(() => makeRoomInviteUrl("--", "https://draught.com")).toThrow();
  });

  it("extracts the room without joining automatically", () => {
    expect(getRoomCodeFromUrl("?room=2680001&utm_source=whatsapp")).toBe("2680001");
    expect(getRoomCodeFromUrl("?join=abcd09")).toBe("ABCD09");
    expect(getRoomCodeFromUrl("?code=1a2b")).toBe("1A2B");
    expect(getRoomCodeFromUrl("?room=--")).toBeNull();
    expect(getRoomCodeFromUrl("?page=home")).toBeNull();
  });

  it("cleans up only invitation parameters after joining/dismissing", () => {
    expect(removeRoomInviteFromUrl("https://draught.com/?room=2680001&ref=whatsapp#app"))
      .toBe("/?ref=whatsapp#app");
  });

  it("copies either the code or URL when the browser grants clipboard access", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyInviteText(makeRoomInviteUrl("2680001", "https://draught.com"));
    expect(writeText).toHaveBeenCalledWith("https://draught.com/?room=2680001");
  });
});
