import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

import { validateReleaseVersion } from "./check-release-version.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

export function bumpVersions(version, rootDir = ROOT, options = {}) {
  const validation = validateReleaseVersion(version);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // 1. package.json & tauri.conf.json
  const pkgPath = join(rootDir, "package.json");
  const pkgJson = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkgJson.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2) + "\n");

  const tauriPath = join(rootDir, "src-tauri/tauri.conf.json");
  const tauriJson = JSON.parse(readFileSync(tauriPath, "utf8"));
  tauriJson.version = version;
  writeFileSync(tauriPath, JSON.stringify(tauriJson, null, 2) + "\n");

  // 2. package-lock.json
  const lockPath = join(rootDir, "package-lock.json");
  const lockJson = JSON.parse(readFileSync(lockPath, "utf8"));
  lockJson.version = version;
  if (lockJson.packages && lockJson.packages[""]) {
    lockJson.packages[""].version = version;
  }
  writeFileSync(lockPath, JSON.stringify(lockJson, null, 2) + "\n");

  // 3. src-tauri/Cargo.toml
  const cargoPath = join(rootDir, "src-tauri/Cargo.toml");
  const cargoContent = readFileSync(cargoPath, "utf8");
  const updatedCargo = cargoContent.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
  writeFileSync(cargoPath, updatedCargo);

  // 4. Update Cargo.lock
  const lockFilePath = join(rootDir, "src-tauri/Cargo.lock");
  if (options.syncCargoLockDirectly) {
    const cargoLockContent = readFileSync(lockFilePath, "utf8");
    const updatedCargoLock = cargoLockContent.replace(
      /(\[\[package\]\]\s+name\s*=\s*"her-flight-deck"\s+version\s*=\s*)"[^"]+"/,
      `$1"${version}"`,
    );
    writeFileSync(lockFilePath, updatedCargoLock);
  } else if (typeof options.cargoRunner === "function") {
    options.cargoRunner(rootDir, version);
  } else {
    // Update Cargo.lock via cargo check (failing visibly without silent suppression)
    const cargoManifest = join(rootDir, "src-tauri/Cargo.toml");
    const cargoBin = options.cargoBin || "cargo";
    try {
      execFileSync(cargoBin, ["check", "--manifest-path", cargoManifest, "--quiet"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      const stderr = err && err.stderr ? err.stderr.toString() : err.message;
      throw new Error(`Failed to update Cargo.lock via cargo check: ${stderr}`);
    }
  }

  // 5. Verification: check all 5 sources strictly match
  const verifiedPkg = JSON.parse(readFileSync(pkgPath, "utf8")).version;
  const verifiedTauri = JSON.parse(readFileSync(tauriPath, "utf8")).version;
  const verifiedLock = JSON.parse(readFileSync(lockPath, "utf8"));
  const verifiedLockVer = verifiedLock.version;
  const verifiedLockPkgVer = verifiedLock.packages?.[""]?.version;
  const cargoMatch = readFileSync(cargoPath, "utf8").match(/^version\s*=\s*"([^"]+)"/m);
  const verifiedCargo = cargoMatch ? cargoMatch[1] : "";

  const cargoLockContent = readFileSync(lockFilePath, "utf8");
  const cargoLockMatch = cargoLockContent.match(
    /\[\[package\]\]\s+name\s*=\s*"her-flight-deck"\s+version\s*=\s*"([^"]+)"/,
  );
  const verifiedCargoLock = cargoLockMatch ? cargoLockMatch[1] : "";

  if (
    verifiedPkg !== version ||
    verifiedTauri !== version ||
    verifiedLockVer !== version ||
    verifiedLockPkgVer !== version ||
    verifiedCargo !== version ||
    verifiedCargoLock !== version
  ) {
    throw new Error(
      `Version synchronization verification failed: expected=${version} package.json=${verifiedPkg} tauri=${verifiedTauri} lock=${verifiedLockVer} lockPkg=${verifiedLockPkgVer} cargo=${verifiedCargo} cargoLock=${verifiedCargoLock}`,
    );
  }

  return {
    version,
    packageJson: verifiedPkg,
    packageLock: verifiedLockVer,
    tauriConf: verifiedTauri,
    cargoToml: verifiedCargo,
    cargoLock: verifiedCargoLock,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const version = process.argv[2];
  if (!version) {
    console.error("Usage: node scripts/bump-version.mjs <version>");
    exit(1);
  }
  try {
    const result = bumpVersions(version);
    console.log(`Successfully synchronized all 5 version locations to ${result.version}`);
  } catch (err) {
    console.error(`::error::${err.message}`);
    exit(1);
  }
}
