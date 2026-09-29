#!/usr/bin/env node
/**
 * Normalizes installer filenames to stable, safe downloadable filenames
 * before checksum generation and release upload.
 *
 * GitHub Releases replaces spaces with periods in uploaded asset names.
 * If checksums are generated from files with spaces, the manifest and release
 * notes will reference a filename that does not match what users download
 * (e.g. 'Her Flight Deck_...' vs 'Her.Flight.Deck_...').
 *
 * Normalizing filenames on disk prior to hashing ensures SHA256SUMS.txt
 * and release notes match the exact downloadable assets.
 */

import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Normalizes an installer filename for release distribution.
 * Replaces whitespace with periods, matching GitHub Releases asset normalization.
 *
 * @param {string} filename
 * @returns {string}
 */
export function normalizeInstallerFilename(filename) {
  if (typeof filename !== "string") {
    throw new TypeError("Filename must be a string");
  }
  return filename.replace(/ /g, ".");
}

/**
 * Normalizes installer filenames in the given directory.
 * Renames any files containing spaces to their normalized names.
 *
 * @param {string} dir
 * @returns {Array<{ from: string, to: string }>}
 */
export function normalizeInstallerFilenames(dir) {
  const entries = readdirSync(dir).filter((name) => name !== "SHA256SUMS.txt");
  if (entries.length === 0) throw new Error("No installers found for release");

  // Check every destination before renaming anything. On Linux renameSync would
  // otherwise replace an existing file if two source names normalize alike.
  const destinations = new Set();
  for (const name of entries) {
    if (!lstatSync(join(dir, name)).isFile() || !/\.(dmg|exe)$/.test(name)) {
      throw new Error(`Unexpected release artifact: ${name}`);
    }
    const normalized = normalizeInstallerFilename(name);
    if (destinations.has(normalized)) {
      throw new Error(`Installer filename collision after normalization: ${normalized}`);
    }
    destinations.add(normalized);
  }
  const renames = [];

  for (const name of entries) {
    const fullPath = join(dir, name);
    const normalized = normalizeInstallerFilename(name);
    if (normalized !== name) {
      const destPath = join(dir, normalized);
      renameSync(fullPath, destPath);
      renames.push({ from: name, to: normalized });
    }
  }

  return renames;
}

/**
 * Generates SHA256SUMS.txt content for installer files in a directory.
 *
 * @param {string} dir
 * @returns {string}
 */
export function generateChecksumManifest(dir) {
  const entries = readdirSync(dir).sort();
  const lines = [];

  for (const name of entries) {
    if (name === "SHA256SUMS.txt") continue;
    const fullPath = join(dir, name);
    if (!statSync(fullPath).isFile()) continue;
    if (!name.endsWith(".dmg") && !name.endsWith(".exe")) continue;

    const bytes = readFileSync(fullPath);
    const hash = createHash("sha256").update(bytes).digest("hex");
    lines.push(`${hash}  ${name}`);
  }

  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/**
 * Normalizes filenames and generates SHA256SUMS.txt in the target directory.
 *
 * @param {string} dir
 * @returns {{ renames: Array<{ from: string, to: string }>, manifest: string }}
 */
export function prepareReleaseInstallers(dir) {
  const renames = normalizeInstallerFilenames(dir);
  const manifest = generateChecksumManifest(dir);
  if (!manifest) throw new Error("No installers found for checksum manifest");
  writeFileSync(join(dir, "SHA256SUMS.txt"), manifest, "utf8");
  return { renames, manifest };
}

// CLI entry point
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const targetDir = process.argv[2] || "installers";
  const { renames, manifest } = prepareReleaseInstallers(targetDir);
  for (const { from, to } of renames) {
    console.log(`Normalized installer filename: '${from}' -> '${to}'`);
  }
  if (manifest) {
    console.log(`Generated ${join(targetDir, "SHA256SUMS.txt")}:\n${manifest.trim()}`);
  }
}
