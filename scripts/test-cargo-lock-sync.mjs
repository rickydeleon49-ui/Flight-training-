import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/**
 * Validates that Cargo.lock is in sync with Cargo.toml without modifying disk.
 *
 * Checks the lockfile version entry BEFORE any Cargo invocation, and executes
 * `cargo check --locked` so Cargo itself strictly refuses to rewrite a stale lockfile.
 */
export function checkCargoLockSync(rootDir = ROOT, options = {}) {
  const cargoTomlPath = join(rootDir, "src-tauri/Cargo.toml");
  const cargoLockPath = join(rootDir, "src-tauri/Cargo.lock");

  if (!existsSync(cargoTomlPath)) {
    throw new Error(`Cargo manifest not found: ${cargoTomlPath}`);
  }
  if (!existsSync(cargoLockPath)) {
    throw new Error(`Cargo lockfile not found: ${cargoLockPath}`);
  }

  // 1. Read Cargo.toml version
  const cargoTomlContent = readFileSync(cargoTomlPath, "utf8");
  const tomlMatch = cargoTomlContent.match(/^version\s*=\s*"([^"]+)"/m);
  if (!tomlMatch) {
    throw new Error("Could not find version in src-tauri/Cargo.toml");
  }
  const tomlVersion = tomlMatch[1];

  // 2. Verify Cargo.lock package entry matches Cargo.toml version BEFORE invoking any Cargo command
  const cargoLockContent = readFileSync(cargoLockPath, "utf8");
  const lockMatch = cargoLockContent.match(
    /\[\[package\]\]\s+name\s*=\s*"her-flight-deck"\s+version\s*=\s*"([^"]+)"/,
  );
  if (!lockMatch) {
    throw new Error("Could not find her-flight-deck package entry in src-tauri/Cargo.lock");
  }
  const lockVersion = lockMatch[1];

  if (tomlVersion !== lockVersion) {
    throw new Error(
      `Cargo lockfile is stale/out of sync: Cargo.toml=${tomlVersion} but Cargo.lock=${lockVersion}`,
    );
  }

  // 3. Verify cargo is present
  const cargoBin = options.cargoBin || "cargo";
  try {
    execFileSync(cargoBin, ["--version"], { encoding: "utf8" });
  } catch (err) {
    throw new Error("Cargo toolchain is not available. This check must run after Rust is installed.");
  }

  // 4. Run cargo check --locked to verify compile manifest and lockfile sync without mutating lockfile
  try {
    execFileSync(cargoBin, ["check", "--locked", "--manifest-path", cargoTomlPath, "--quiet"], {
      cwd: rootDir,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    const stderr = err && err.stderr ? err.stderr.toString() : err.message;
    throw new Error(`cargo check --locked failed: ${stderr}`);
  }

  return {
    version: tomlVersion,
    tomlVersion,
    lockVersion,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log("Checking Cargo toolchain and lockfile synchronization (read-only)...");
    const result = checkCargoLockSync();
    console.log(
      `Cargo lockfile synchronization verified: her-flight-deck is at ${result.version} in both Cargo.toml and Cargo.lock`,
    );
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
}
