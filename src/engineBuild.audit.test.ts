import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
const { sourceFingerprint, binaryIsFresh } = createRequire(import.meta.url)("../scripts/build-engine.cjs");

describe("native build source freshness", () => {
  it("rebuilds for changed sources, headers, weights, configuration, build flags or binary", () => {
    const directory = mkdtempSync(join(tmpdir(), "kentro-build-fingerprint-"));
    try {
      mkdirSync(join(directory, "data"));
      for (const name of ["main.cpp", "pos.hpp", "Makefile_linux", "scan.ini", "data/eval_nigerian", "build.cjs"]) writeFileSync(join(directory, name), name);
      const script = join(directory, "build.cjs");
      const original = sourceFingerprint(directory, script);
      expect(sourceFingerprint(directory, script)).toBe(original);
      for (const name of ["main.cpp", "pos.hpp", "Makefile_linux", "scan.ini", "data/eval_nigerian", "build.cjs"]) {
        const file = join(directory, name);
        const saved = readFileSync(file);
        writeFileSync(file, "changed");
        expect(sourceFingerprint(directory, script), name).not.toBe(original);
        writeFileSync(file, saved);
      }
      const binary = join(directory, "scan_nigerian");
      const stamp = join(directory, "engine-build.json");
      writeFileSync(binary, "verified build");
      const digest = createHash("sha256").update(readFileSync(binary)).digest("hex");
      writeFileSync(stamp, JSON.stringify({ sources: original, binary: digest }));
      expect(binaryIsFresh(original, binary, stamp)).toBe(true);
      expect(binaryIsFresh("changed sources", binary, stamp)).toBe(false);
      writeFileSync(binary, "different executable");
      expect(binaryIsFresh(original, binary, stamp)).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
