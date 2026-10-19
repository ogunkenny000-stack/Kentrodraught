import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DurableState } from "./durableState";
const directories: string[] = [];
const writers: DurableState<unknown>[] = [];
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kentro-durable-"));
  directories.push(directory);
  return path.join(directory, "rooms.json");
}
function writer(file: string) {
  const value = new DurableState<any>(file);
  writers.push(value);
  return value;
}
afterEach(() => {
  for (const value of writers.splice(0)) value.close();
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
describe("durable single-writer state", () => {
  it("restores atomic state with private file and directory permissions", () => {
    const file = fixture();
    const value = writer(file);
    value.write({ token: "synthetic", rooms: [1] });
    value.close();
    expect(writer(file).read()).toEqual({ token: "synthetic", rooms: [1] });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
  });
  it("rejects checksum corruption without discarding the saved file", () => {
    const file = fixture();
    const value = writer(file);
    value.write({ room: 1 });
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    state.payload = '{"room":2}';
    fs.writeFileSync(file, JSON.stringify(state));
    expect(() => value.read()).toThrow("corrupt");
    expect(fs.existsSync(file)).toBe(true);
  });
  it("rejects a second writer and prevents writes after ownership is released", () => {
    const file = fixture(),
      value = writer(file);
    expect(() => writer(file)).toThrow("Another writer");
    value.close();
    const next = writer(file);
    next.write({ room: 2 });
    expect(() => value.write({ room: 3 })).toThrow("closed");
    expect(next.read()).toEqual({ room: 2 });
  });
  it("refuses a lock held by another live process", () => {
    const file = fixture();
    fs.writeFileSync(file + ".lock", String(process.ppid));
    expect(() => writer(file)).toThrow("Another process");
  });
  it("preserves the prior snapshot after oversized replacement failure", () => {
    const file = fixture(),
      value = writer(file);
    value.write({ room: 1 });
    expect(() => value.write({ blob: "x".repeat(33 * 1024 * 1024) })).toThrow(
      "size",
    );
    expect(value.read()).toEqual({ room: 1 });
  });
});
