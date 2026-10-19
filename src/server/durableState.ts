import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/** Single-writer atomic state. A successful command is acknowledged only after
 * its replacement file and parent directory are flushed. Runtime files contain
 * resume credentials and must never be served, committed or packaged. */
const owners = new Set<string>();
export class DurableState<T> {
  private previous = "";
  private closed = false;
  constructor(readonly file: string | false) {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (owners.has(file))
      throw new Error("Another writer already owns durable state");
    const lock = file + ".lock";
    if (fs.existsSync(lock)) {
      const pid = Number(fs.readFileSync(lock, "utf8"));
      if (!Number.isSafeInteger(pid) || pid < 1)
        throw new Error("Invalid durable state lock");
      if (pid !== process.pid) {
        try {
          process.kill(pid, 0);
          throw new Error("Another process owns durable state");
        } catch (error: any) {
          if (error.code !== "ESRCH") throw error;
        }
      }
      fs.unlinkSync(lock);
    }
    fs.writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
    owners.add(file);
  }
  close(): void {
    this.closed = true;
    if (this.file && owners.delete(this.file))
      fs.rmSync(this.file + ".lock", { force: true });
  }
  read(): T | null {
    if (!this.file || !fs.existsSync(this.file)) return null;
    const bytes = fs.readFileSync(this.file);
    if (bytes.length > 32 * 1024 * 1024)
      throw new Error("Durable state exceeds the supported size");
    const data = JSON.parse(bytes.toString());
    if (
      data.version !== 1 ||
      typeof data.payload !== "string" ||
      data.sha256 !== createHash("sha256").update(data.payload).digest("hex")
    )
      throw new Error(
        "Durable state is corrupt; restore a verified backup before startup",
      );
    this.previous = data.payload;
    return JSON.parse(data.payload);
  }
  write(state: T): void {
    if (this.closed) throw new Error("Durable state writer is closed");
    if (!this.file) return;
    const payload = JSON.stringify(state);
    if (payload === this.previous) return;
    const bytes = JSON.stringify({
      version: 1,
      sha256: createHash("sha256").update(payload).digest("hex"),
      payload,
    });
    if (Buffer.byteLength(bytes) > 32 * 1024 * 1024)
      throw new Error("Durable state exceeds the supported size");
    const directory = path.dirname(this.file);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temp = this.file + "." + process.pid + ".tmp";
    const descriptor = fs.openSync(temp, "w", 0o600);
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temp, this.file);
    const parent = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(parent);
    } finally {
      fs.closeSync(parent);
    }
    this.previous = payload;
  }
}
