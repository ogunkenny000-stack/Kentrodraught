// Prepare the existing native engine; never silently substitute a weaker AI.
const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const root = path.resolve(__dirname, "..");
const engineDir = path.join(root, "nd_upgraded");
const binaryPath = path.join(engineDir, process.platform === "win32" ? "scan_nigerian.exe" : "scan_nigerian");
const buildStatePath = path.join(root, "data", "native-engine-build.json");
const compileFlags = "-pthread -Wall -Wextra -Wno-unused -Wno-unused-parameter -std=c++14 -fno-rtti -O3 -DNDEBUG -flto -funroll-loops -ffast-math";
const linkFlags = "-pthread -O3 -flto";

function fileHash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sourceFingerprint() {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify({ platform: process.platform, arch: process.arch, compiler: process.env.CXX || "", compileFlags, linkFlags }));
  const files = fs.readdirSync(engineDir).filter((name) => /\.(cpp|hpp|h)$/.test(name) || /^Makefile/.test(name) || name === "scan.ini").sort();
  for (const name of files) hash.update(name + "\0" + fileHash(path.join(engineDir, name)) + "\0");
  hash.update(fileHash(path.join(engineDir, "data", "eval_nigerian")));
  hash.update(fileHash(__filename));
  return hash.digest("hex");
}

function ensureSources() {
  const required = ["main.cpp", "data/eval_nigerian", process.platform === "darwin" ? "Makefile_macos" : "Makefile_linux"];
  if (required.every((name) => fs.existsSync(path.join(engineDir, name)))) return;
  const archive = path.join(root, "nd_upgraded.zip");
  if (!fs.existsSync(archive)) throw new Error("Missing nd_upgraded sources and nd_upgraded.zip. Keep the shipped engine archive in the project.");
  // Preserve existing source edits: extract only missing files.
  try {
    execFileSync("unzip", ["-n", "-q", archive], { cwd: root, stdio: "pipe" });
  } catch (unzipError) {
    const script = [
      "import pathlib,stat,sys,zipfile",
      "root=pathlib.Path(sys.argv[2]).resolve()",
      "with zipfile.ZipFile(sys.argv[1]) as archive:",
      " for item in archive.infolist():",
      "  name=pathlib.PurePosixPath(item.filename)",
      "  if name.is_absolute() or '..' in name.parts or not name.parts or name.parts[0]!='nd_upgraded': raise ValueError('Unsafe engine archive path')",
      "  if stat.S_ISLNK(item.external_attr >> 16): raise ValueError('Engine archive symlink not allowed')",
      "  if item.is_dir(): continue",
      "  dest=root.joinpath(*name.parts)",
      "  if dest.exists(): continue",
      "  dest.parent.mkdir(parents=True,exist_ok=True)",
      "  dest.write_bytes(archive.read(item))",
      "  mode=(item.external_attr >> 16)&0o777",
      "  if mode: dest.chmod(mode)",
    ].join("\n");
    try {
      execFileSync("python3", ["-c", script, archive, root], { cwd: root, stdio: "pipe" });
    } catch (pythonError) {
      throw new Error(`Cannot extract nd_upgraded.zip. Install unzip or Python 3, or extract it into the project first. ${pythonError.message}`);
    }
  }
  for (const name of required) {
    if (!fs.existsSync(path.join(engineDir, name))) throw new Error(`Engine archive is missing ${name}`);
  }
}

function probeBinary() {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, ["hub"], { cwd: engineDir, stdio: ["pipe", "pipe", "pipe"] });
    let initialized = false;
    let searched = false;
    let settled = false;
    let buffer = "";
    let stderr = "";
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { child.kill(); reject(error); } else resolve();
    };
    const timer = setTimeout(() => finish(new Error("Engine initialization/search timed out")), 20000);
    child.on("error", finish);
    child.stdin.on("error", (error) => finish(error));
    child.stderr.on("data", (data) => { stderr = (stderr + data).slice(-4000); });
    child.stdout.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n"); buffer = lines.pop() || "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!initialized && line === "ready") {
          initialized = true;
          const fen = "W" + "b".repeat(20) + "e".repeat(10) + "w".repeat(20);
          child.stdin.write(`pos pos=\"${fen}\"\nlevel depth=1 move-time=0.05\ngo think\n`);
        } else if (initialized && /^done\b.*\bmove=\S+/.test(line)) {
          searched = true;
          child.stdin.end("quit\n");
        } else if (/^error\b/.test(line)) {
          finish(new Error(line));
        }
      }
    });
    child.on("exit", (code, signal) => {
      if (code === 0 && initialized && searched) finish();
      else finish(new Error(`Engine probe failed (${signal || code}): ${stderr.trim() || "did not complete initialization and a search"}`));
    });
    child.stdin.write("hub\ninit\n");
  });
}

async function main() {
  if (process.platform === "win32") throw new Error("The bundled native engine targets Linux/macOS. On Windows, run this project through its Docker setup or WSL.");
  ensureSources();
  const weights = path.join(engineDir, "data", "eval_nigerian");
  fs.chmodSync(weights, 0o644);
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  const rootWeights = path.join(root, "data", "eval_nigerian");
  if (!fs.existsSync(rootWeights)) fs.copyFileSync(weights, rootWeights);

  const fingerprint = sourceFingerprint();
  let buildState;
  try { buildState = JSON.parse(fs.readFileSync(buildStatePath, "utf8")); } catch { /* A missing stamp requires a fresh build. */ }
  const current = fs.existsSync(binaryPath) && buildState?.source === fingerprint && buildState?.binary === fileHash(binaryPath);
  if (current) {
    try {
      fs.chmodSync(binaryPath, 0o755);
      await probeBinary();
      console.log("[build:engine] Native engine initialized and completed a search.");
      return;
    } catch (error) {
      console.warn(`[build:engine] Existing binary is not usable: ${error.message}. Rebuilding.`);
    }
  } else if (fs.existsSync(binaryPath)) {
    console.log("[build:engine] Source/build fingerprint changed or missing. Rebuilding.");
  }

  const makefile = process.platform === "darwin" ? "Makefile_macos" : "Makefile_linux";
  const compiler = process.env.CXX || (process.platform === "darwin" ? "clang++" : "g++");
  const jobs = Math.max(1, Math.min(4, os.availableParallelism ? os.availableParallelism() : os.cpus().length));
  try {
    // No -march=native: a container/image must run on a different CPU too.
    execFileSync("make", ["-B", "-f", makefile, `-j${jobs}`, `CXX=${compiler}`,
      `CXXFLAGS=${compileFlags}`, `LDFLAGS=${linkFlags}`], { cwd: engineDir, stdio: "inherit" });
  } catch (error) {
    throw new Error(`Native engine compilation failed. Install make and a C++14 compiler, or use the project's Docker build. No automatic OS package installation was attempted. ${error.message}`);
  }
  fs.chmodSync(binaryPath, 0o755);
  await probeBinary();
  fs.writeFileSync(buildStatePath, JSON.stringify({ source: fingerprint, binary: fileHash(binaryPath) }) + "\n");
  console.log("[build:engine] Native engine rebuilt and search-verified.");
}

if (require.main === module) main().catch((error) => {
  console.error(`[build:engine] ${error.message}`);
  process.exitCode = 1;
});
module.exports = { ensureSources, probeBinary, sourceFingerprint, main };
