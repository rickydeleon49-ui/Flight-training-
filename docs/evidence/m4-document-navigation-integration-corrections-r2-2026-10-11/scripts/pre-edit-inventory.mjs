#!/usr/bin/env node
/**
 * Her Flight Deck — round-2 pre-edit inventory (REV1 requirement).
 *
 * Records SHA-256 + byte size for every file in the subject R9–R12 pack BEFORE any edit or run,
 * plus the 32 frozen submitted paths and the three revised top-level documents, and re-verifies
 * the subject pack's own SHA256SUMS. Every later "preserved"/"unchanged" claim must cite this.
 *
 * Usage: node scripts/pre-edit-inventory.mjs            (run from the repository root)
 * Writes: receipts/00-pre-edit-inventory.json inside this pack.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const packRel = "docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11";
const subjectRel = "docs/evidence/m4-document-navigation-integration-corrections-2026-10-11";
const frozenRel = "docs/evidence/m4-document-navigation-integration-rereview-2026-10-11/submitted-hashes.json";
const root = process.cwd();
if (!fs.existsSync(path.join(root, packRel))) {
  console.error(`run from the repository root; missing ${packRel}`);
  process.exit(2);
}

const digest = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const listFiles = (dir) => {
  const acc = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules") continue; // untracked scratch installs are excluded by the assignment
        walk(full);
      } else acc.push(full);
    }
  };
  walk(dir);
  return acc.map((f) => path.relative(root, f));
};

const subjectFiles = listFiles(path.join(root, subjectRel));
const entries = {};
for (const rel of subjectFiles) {
  const abs = path.join(root, rel);
  entries[rel] = { sha256: digest(abs), bytes: fs.statSync(abs).size };
}

// The 32 frozen submitted paths.
const frozen = JSON.parse(fs.readFileSync(path.join(root, frozenRel), "utf8"));
const frozenState = {};
for (const [rel, expected] of Object.entries(frozen.files)) {
  const abs = path.join(root, rel);
  frozenState[rel] = fs.existsSync(abs)
    ? { expected, sha256: digest(abs), state: digest(abs) === expected ? "unchanged" : "changed" }
    : { expected, sha256: null, state: "missing" };
}
const counts = Object.values(frozenState).reduce(
  (a, v) => ((a[v.state] = (a[v.state] || 0) + 1), a),
  {}
);

// The subject pack's own manifest, measured as delivered.
const manifestPath = path.join(root, subjectRel, "SHA256SUMS");
const manifestLines = fs.readFileSync(manifestPath, "utf8").trim().split("\n");
const manifestResult = { recorded: manifestLines.length, matching: [], stale: [], absent: [] };
for (const line of manifestLines) {
  const [hash, ...rest] = line.trim().split(/\s+/);
  const rel = rest.join(" ");
  const abs = path.join(root, subjectRel, rel);
  if (!fs.existsSync(abs)) manifestResult.absent.push(rel);
  else (digest(abs) === hash ? manifestResult.matching : manifestResult.stale).push(rel);
}

// The three revised top-level documents (report is the fourth subject artifact).
const topDocs = [
  "docs/M4_DOCUMENT_NAVIGATION_AND_VIEWER_EVALUATION_2026-10-11.md",
  "docs/M4_CONDITIONAL_IMPLEMENTATION_PROMPT_2026-10-11.md",
  "docs/M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_REPORT_2026-10-11.md",
].reduce((acc, rel) => ((acc[rel] = { sha256: digest(path.join(root, rel)), bytes: fs.statSync(path.join(root, rel)).size }), acc), {});

const report = {
  purpose: "pre-edit inventory required by M4 round-2 revision 1; nothing may claim 'unchanged' without citing this",
  command: "node docs/evidence/" + packRel.split("/").pop() + "/scripts/pre-edit-inventory.mjs",
  cwd: root,
  nodeVersion: process.version,
  recordedAt: new Date().toISOString(),
  headCommit: process.env.M4_HEAD_COMMIT ?? "",
  pinnedAcceptedMain: process.env.M4_PINNED_REF ?? "",
  subjectPack: subjectRel,
  subjectPackFiles: { count: Object.keys(entries).length, entries },
  frozenSubmittedPaths: {
    manifest: frozenRel,
    entries: Object.keys(frozenState).length,
    tally: counts,
    detail: frozenState,
  },
  subjectPackOwnManifest: {
    path: `${subjectRel}/SHA256SUMS`,
    recorded: manifestResult.recorded,
    matching: manifestResult.matching.length,
    staleCount: manifestResult.stale.length,
    stale: manifestResult.stale,
    absent: manifestResult.absent,
  },
  revisedTopLevelDocuments: topDocs,
};

const outPath = path.join(root, packRel, "receipts", "00-pre-edit-inventory.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(
  `pre-edit inventory: ${Object.keys(entries).length} subject files, frozen ${JSON.stringify(counts)}, ` +
  `own-manifest ${manifestResult.matching.length} match / ${manifestResult.stale.length} stale / ${manifestResult.absent.length} absent -> ${path.relative(root, outPath)}`
);
