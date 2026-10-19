import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production nearby offline preparation", () => {
  it("prepares nearby dependencies while retaining lazy loading for TV and other optional routes", () => {
    const directory = mkdtempSync(join(tmpdir(), "kentro-precache-test-"));
    try {
      mkdirSync(join(directory, "assets"));
      writeFileSync(join(directory, "index.html"), '<script type="module" src="/assets/index-entry.js"></script>');
      writeFileSync(join(directory, "sw.js"), 'const CACHE_VERSION = "fixture";\nconst PRECACHE_ASSETS = [];');
      writeFileSync(join(directory, "assets/index-entry.js"), 'import {board} from "./rules-shared.js"; const tv = () => import("./KentroTV-lazy.js");');
      writeFileSync(join(directory, "assets/OfflineNearby-local.js"), 'import {board} from "./rules-shared.js";import "./offline-style.css";');
      writeFileSync(join(directory, "assets/OfflineKen-local.js"), 'import {board} from "./rules-shared.js";');
      mkdirSync(join(directory, 'engine'));
      for (const name of ['scan.js', 'scan.wasm', 'ken-worker.js']) writeFileSync(join(directory, 'engine', name), 'engine-fixture');
      writeFileSync(join(directory, "assets/rules-shared.js"), 'import {piece} from "./pieces-shared.js";export const board = piece;');
      writeFileSync(join(directory, "assets/pieces-shared.js"), 'export const piece = 1;');
      writeFileSync(join(directory, "assets/offline-style.css"), 'body{}');
      writeFileSync(join(directory, "assets/KentroTV-lazy.js"), 'export const tv = true;');
      execFileSync(process.execPath, [new URL("../../scripts/inject-sw-assets.cjs", import.meta.url).pathname], { env: { ...process.env, KENTRO_DIST_DIR: directory } });
      const source = readFileSync(join(directory, "sw.js"), "utf8");
      const assets = JSON.parse(/const PRECACHE_ASSETS = (\[[\s\S]*?\]);/.exec(source)![1]);
      expect(assets).toEqual([
        "/assets/OfflineKen-local.js", "/assets/OfflineNearby-local.js", "/assets/index-entry.js", "/assets/offline-style.css", "/assets/pieces-shared.js", "/assets/rules-shared.js",
        "/engine/ken-worker.js", "/engine/scan.js", "/engine/scan.wasm",
      ]);
      expect(source).not.toContain("KentroTV-lazy");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
