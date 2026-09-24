#!/usr/bin/env node

/**
 * Validates a candidate release version against semantic version rules
 * and the repository's permanently retired versions registry.
 *
 * Usage:
 *   node scripts/check-release-version.mjs <version>
 *   e.g. node scripts/check-release-version.mjs 0.5.3
 */

import { readFileSync } from "node:fs";
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

// CLI entry point
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const candidate = process.argv[2];
  const result = validateReleaseVersion(candidate);

  if (!result.valid) {
    console.error(`::error::${result.error}`);
    exit(1);
  }

  console.log(`Version ${result.version} is valid and eligible for release.`);
  exit(0);
}
