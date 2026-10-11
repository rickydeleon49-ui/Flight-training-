#!/usr/bin/env node
/**
 * Her Flight Deck — reviewer verification of the M4 integration-corrections submission.
 *
 * 1. Re-verifies the 32 frozen submitted paths from the merged rereview pack
 *    (docs/evidence/m4-document-navigation-integration-rereview-2026-10-11/submitted-hashes.json)
 *    against the implementation worktree.
 * 2. Re-verifies the submitted pack's own SHA256SUMS against its delivered bytes.
 *
 * Usage: node verify-submitted-hashes.mjs [path/to/Flight-training-m4-viewer-evaluation]
 * Emits one JSON object on stdout. Exits 0 if the check ran, 2 if the target worktree is absent.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../");
const target = process.argv[2] ?? "/Users/rickymac/code/Flight-training-m4-viewer-evaluation";
const packRel = "docs/evidence/m4-document-navigation-integration-corrections-2026-10-11";
const frozenRel = "docs/evidence/m4-document-navigation-integration-rereview-2026-10-11/submitted-hashes.json";

const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

if (!fs.existsSync(path.join(target, packRel))) {
  console.log(JSON.stringify({ target, status: "TARGET_UNAVAILABLE", note: "Implementation worktree not present; nothing verified." }, null, 2));
  process.exit(2);
}

// 1. frozen submitted paths
const frozenPath = path.join(repoRoot, frozenRel);
const frozen = JSON.parse(fs.readFileSync(frozenPath, "utf8"));
const frozenResult = { ok: [], changed: [], missing: [] };
for (const [rel, expected] of Object.entries(frozen.files)) {
  const p = path.join(target, rel);
  if (!fs.existsSync(p)) frozenResult.missing.push(rel);
  else if (sha(p) === expected) frozenResult.ok.push(rel);
  else frozenResult.changed.push({ path: rel, expected, actual: sha(p) });
}

// 2. the pack's own manifest
const packDir = path.join(target, packRel);
const sums = fs.readFileSync(path.join(packDir, "SHA256SUMS"), "utf8").trim().split("\n").map((l) => {
  const [h, ...rest] = l.trim().split(/\s+/);
  return { hash: h, file: rest.join(" ").replace(/^\*?/, "") };
});
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.relative(packDir, path.join(d, e.name))); };
walk(packDir);
const manifestResult = { recorded: sums.length, deliveredFiles: files.length, matching: [], stale: [], unrecorded: [] };
for (const s of sums) {
  const p = path.join(packDir, s.file);
  if (!fs.existsSync(p)) { manifestResult.unrecorded.push(s.file + " (recorded, absent)"); continue; }
  (sha(p) === s.hash ? manifestResult.matching : manifestResult.stale).push(s.file);
}
const recorded = new Set(sums.map((s) => s.file));
for (const f of files) if (f !== "SHA256SUMS" && !recorded.has(f)) manifestResult.unrecorded.push(f);

console.log(JSON.stringify({
  target,
  generatedAt: new Date().toISOString(),
  repoHead: process.env.REVIEW_HEAD ?? "",
  frozenSubmittedPaths: {
    manifest: frozenRel,
    entries: Object.keys(frozen.files).length,
    unchanged: frozenResult.ok.length,
    changed: frozenResult.changed,
    missing: frozenResult.missing,
  },
  packSelfManifest: {
    manifestPath: `${packRel}/SHA256SUMS`,
    recorded: manifestResult.recorded,
    deliveredFiles: manifestResult.deliveredFiles,
    matching: manifestResult.matching.length,
    stale: manifestResult.stale,
    unrecorded: manifestResult.unrecorded,
  },
}, null, 2));
