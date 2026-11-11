/**
 * Validates a candidate release version against semantic version rules
 * and the repository's permanently retired versions registry.
 *
 * Usage:
 *   node scripts/check-release-version.mjs <version>
 *   e.g. node scripts/check-release-version.mjs 0.5.3
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_FILE = join(__dirname, "release-policy.json");

export function loadReleasePolicy(policyPath = POLICY_FILE) {
  try {
    const content = readFileSync(policyPath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Could not read release policy at ${policyPath}: ${error.message}`);
  }
}

export function validateReleaseVersion(rawCandidate, policyPath = POLICY_FILE) {
  if (!rawCandidate || typeof rawCandidate !== "string") {
    return {
      valid: false,
      error: "No release version specified. Provide a version such as 0.5.3.",
    };
  }

  const normalized = rawCandidate.trim().replace(/^v/, "");

  // Require standard semantic version format: major.minor.patch
  const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/;
  if (!semverPattern.test(normalized)) {
    return {
      valid: false,
      error: `'${rawCandidate}' is not a valid release version. Expected format: major.minor.patch (e.g. 0.5.3).`,
    };
  }

  const policy = loadReleasePolicy(policyPath);
  const retiredEntry = (policy.retiredVersions || []).find(
    (entry) => entry.version === normalized,
  );

  if (retiredEntry) {
    return {
      valid: false,
      version: normalized,
      retired: true,
      reason: retiredEntry.reason,
      error: `Version ${normalized} is permanently retired and must never be reused.\nReason: ${retiredEntry.reason}`,
    };
  }

  return {
    valid: true,
    version: normalized,
  };
}

const IOS_YML = "src-tauri/gen/apple/project.yml";
const IOS_PLIST = "src-tauri/gen/apple/her-flight-deck_iOS/Info.plist";

/** Read every recorded version of the app. iOS entries are undefined when the iOS project is absent. */
export function readVersionFiles(rootDir = join(__dirname, "..")) {
  const read = (rel) => readFileSync(join(rootDir, rel), "utf8");
  const lock = JSON.parse(read("package-lock.json"));
  const cargo = read("src-tauri/Cargo.toml").match(/^version\s*=\s*"([^"]+)"/m);
  const cargoLock = read("src-tauri/Cargo.lock").match(
    /\[\[package\]\]\s+name\s*=\s*"her-flight-deck"\s+version\s*=\s*"([^"]+)"/,
  );
  const versions = {
    "package.json": JSON.parse(read("package.json")).version,
    "package-lock.json": lock.version,
    "package-lock.json (packages)": lock.packages?.[""]?.version,
    "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
    "src-tauri/Cargo.toml": cargo ? cargo[1] : "",
    "src-tauri/Cargo.lock": cargoLock ? cargoLock[1] : "",
  };
  if (existsSync(join(rootDir, IOS_YML))) {
    versions[`${IOS_YML} CFBundleShortVersionString`] =
      read(IOS_YML).match(/^\s*CFBundleShortVersionString:\s*"?([^"\s]+)"?/m)?.[1] ?? "";
  }
  if (existsSync(join(rootDir, IOS_PLIST))) {
    versions[`${IOS_PLIST} CFBundleShortVersionString`] =
      read(IOS_PLIST).match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/)?.[1] ?? "";
  }
  return versions;
}

/** Every recorded version (Mac files and the iOS marketing version) must equal `version`. */
export function checkVersionAgreement(version, rootDir = join(__dirname, "..")) {
  const versions = readVersionFiles(rootDir);
  const mismatched = Object.entries(versions).filter(([, v]) => v !== version).map(([file, v]) => `${file}=${v ?? "missing"}`);
  return { agree: mismatched.length === 0, versions, mismatched };
}

// CLI entry point
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const candidate = process.argv[2];
  const result = validateReleaseVersion(candidate);

  if (!result.valid) {
    console.error(`::error::${result.error}`);
    exit(1);
  }

  if (process.argv.includes("--agree")) {
    const agreement = checkVersionAgreement(result.version);
    if (!agreement.agree) {
      console.error(`::error::Version files do not all say ${result.version}: ${agreement.mismatched.join(", ")}`);
      exit(1);
    }
    console.log(`All version files (including the iOS marketing version) say ${result.version}.`);
    exit(0);
  }

  console.log(`Version ${result.version} is valid and eligible for release.`);
  exit(0);
}
