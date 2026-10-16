#!/usr/bin/env node
/**
 * Her Flight Deck — accepted-main inputs without pulling (REV1 requirement).
 *
 * Reads bytes from a PINNED accepted-main commit and extracts them into
 * scratch/accepted-main/ as reference-only input for the lifecycle and parser proofs.
 * HEAD never moves; nothing is written to src/, src-tauri/ or any tracked production path.
 *
 * Usage: node scripts/prepare-accepted-main.mjs <pinned-commit>
 * Writes: receipts/01-accepted-main.json and the extracted reference tree.
 * Exits non-zero on any verification failure (missing ref, checksum mismatch, extra/missing
 * migration, review-pack digest failure, unparseable schema ceiling).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const packRel = "docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11";
const reviewPackRel = "docs/evidence/m4-document-navigation-integration-corrections-rereview-2026-10-11";
const root = process.cwd();
const scratch = path.join(root, packRel, "scratch", "accepted-main");
const EXPECTED_0014 = "34acb4c4cd22826512c1cd3d331675be6d2b223abe2322af8977769bcb3c048a";
const EXPECTED_REVIEW_ENTRIES = 29;

const pin = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(pin ?? "")) {
  console.error("usage: node scripts/prepare-accepted-main.mjs <40-char pinned commit>");
  process.exit(2);
}

const digest = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const steps = [];
const record = (step) => { steps.push(step); return step; };
const fail = (msg) => {
  record({ label: "FAILED", detail: msg });
  fs.mkdirSync(path.join(root, packRel, "receipts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, packRel, "receipts", "01-accepted-main.json"),
    JSON.stringify({ pin, nodeVersion: process.version, failed: msg, steps }, null, 2) + "\n"
  );
  console.error(`ACCEPTED-MAIN PREPARATION FAILED: ${msg}`);
  process.exit(1);
};

const git = (label, args) => {
  const r = spawnSync("git", args, { cwd: root, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  const step = record({ label, command: `git ${args.join(" ")}`, cwd: root, exit: r.status, stdoutBytes: r.stdout?.length ?? 0 });
  if (r.status !== 0) fail(`${label} exited ${r.status}: ${r.stderr?.toString().slice(0, 200) ?? ""}`);
  return r.stdout.toString();
};

/** git archive <pin> <paths…> | tar -x -C scratch, with each half's exit code captured. */
const extract = (label, paths) => {
  const tar = spawnSync("git", ["archive", "--format=tar", pin, ...paths], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  if (tar.status !== 0) fail(`${label}: git archive exited ${tar.status}`);
  const tmp = path.join(root, packRel, "scratch", `${label.replace(/[^\w-]/g, "_")}.tar`);
  fs.writeFileSync(tmp, tar.stdout);
  const out = spawnSync("tar", ["-x", "-C", scratch, "-f", tmp]);
  record({
    label: `${label} extract`,
    command: `git archive --format=tar ${pin} ${paths.join(" ")} | tar -x -C ${path.relative(root, scratch)}`,
    cwd: root,
    archiveExit: tar.status,
    tarExit: out.status,
    tarBytes: tar.stdout.length,
  });
  fs.rmSync(tmp);
  if (out.status !== 0) fail(`${label}: tar exited ${out.status}`);
};

if (!fs.existsSync(scratch)) fs.mkdirSync(scratch, { recursive: true });

// 0. the ref must resolve to exactly the pinned commit
const resolved = git("rev-parse", ["rev-parse", pin]).trim();
if (resolved !== pin) fail(`pinned ref resolved to ${resolved}`);
const subject = git("subject", ["log", "-1", "--format=%h %s", pin]).trim();

// 1. shipped migration ledger + the checksum data the app ships with it
extract("migrations", ["src-tauri/migrations", "src/data/migration-checksums.json"]);

// 2. every extracted .sql must match migration-checksums.json, both directions
const checksumsPath = path.join(scratch, "src/data/migration-checksums.json");
if (!fs.existsSync(checksumsPath)) fail("migration-checksums.json was not extracted");
const checksums = JSON.parse(fs.readFileSync(checksumsPath, "utf8"));
const migDir = path.join(scratch, "src-tauri/migrations");
const sqlFiles = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
const verification = {};
for (const f of sqlFiles) {
  const actual = digest(fs.readFileSync(path.join(migDir, f)));
  const expected = checksums[f];
  if (!expected) fail(`extracted ${f} has no entry in migration-checksums.json`);
  if (actual !== expected) fail(`checksum mismatch for ${f}: expected ${expected}, got ${actual}`);
  verification[f] = { sha256: actual, expected, state: "verified" };
}
for (const name of Object.keys(checksums)) {
  if (!sqlFiles.includes(name)) fail(`migration-checksums.json lists ${name} but it was not extracted`);
}
if (sqlFiles.length !== 14) fail(`expected 14 shipped migrations, found ${sqlFiles.length}`);
const skills0014 = verification["0014_skills_evidence.sql"]?.sha256;
if (skills0014 !== EXPECTED_0014) fail(`0014_skills_evidence.sql is ${skills0014}, expected ${EXPECTED_0014}`);

// 3. schema ceiling parsed out of accepted-main, never hardcoded here
const libSrc = git("read lib.rs", ["show", `${pin}:src-tauri/src/lib.rs`]);
const line = libSrc.split("\n").find((l) => l.includes("CURRENT_SCHEMA_VERSION"));
if (!line) fail("CURRENT_SCHEMA_VERSION not found in accepted-main lib.rs");
const parsed = /CURRENT_SCHEMA_VERSION[^=\n]*=\s*(\d+)/.exec(line);
if (!parsed) fail(`unparseable schema ceiling from: ${line.trim()}`);
const ceiling = Number(parsed[1]);
if (!Number.isSafeInteger(ceiling) || ceiling < 1) fail(`implausible schema ceiling ${ceiling} from: ${line.trim()}`);
fs.writeFileSync(
  path.join(scratch, "schema-ceiling.txt"),
  `commit ${pin}\nsource src-tauri/src/lib.rs\nline: ${line.trim()}\nCURRENT_SCHEMA_VERSION=${ceiling}\nlib_rs_sha256=${digest(Buffer.from(libSrc))}\n`
);

// 4. round-2 review pack as read-only reference
extract("review-pack", [reviewPackRel]);
const extractedReviewDir = path.join(scratch, reviewPackRel);
if (!fs.existsSync(path.join(extractedReviewDir, "SHA256SUMS"))) fail("review pack SHA256SUMS missing");
const sha = spawnSync("shasum", ["-a", "256", "-c", "SHA256SUMS"], { cwd: extractedReviewDir, encoding: "utf-8" });
const okLines = (sha.stdout || "").split("\n").filter((l) => l.endsWith(": OK")).length;
const failures = (sha.stdout || "").split("\n").filter((l) => /: (FAILED|WARNING)/.test(l));
record({ label: "verify review pack", command: "shasum -a 256 -c SHA256SUMS", cwd: path.relative(root, extractedReviewDir), exit: sha.status, ok: okLines, failed: failures });
if (sha.status !== 0 || failures.length) fail(`review pack verification: ${failures.join("; ")}`);
if (okLines !== EXPECTED_REVIEW_ENTRIES) fail(`review pack matched ${okLines} entries, expected ${EXPECTED_REVIEW_ENTRIES}`);

const report = {
  pin,
  pinnedSubject: subject,
  nodeVersion: process.version,
  recordedAt: new Date().toISOString(),
  worktreeHead: process.env.M4_HEAD_COMMIT ?? "",
  destination: path.relative(root, scratch),
  usageRule:
    "reference bytes only; excluded from the delivered SHA256SUMS. The lifecycle suite must read the ledger from here and must never fall back to this worktree's own 13-file src-tauri/migrations/.",
  shippedMigrations: { count: sqlFiles.length, files: sqlFiles, verification, skillsEvidence0014: skills0014 },
  schemaCeiling: {
    parsedFrom: `git show ${pin}:src-tauri/src/lib.rs`,
    line: line.trim(),
    value: ceiling,
    // consistency with the ledger actually extracted, not a hardcoded expectation
    equalsExtractedMigrationCount: ceiling === sqlFiles.length,
  },
  reviewPack: { path: path.relative(root, extractedReviewDir), expectedMatches: EXPECTED_REVIEW_ENTRIES, actualMatches: okLines, digestFailures: failures },
  steps,
};
fs.writeFileSync(path.join(root, packRel, "receipts", "01-accepted-main.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`accepted-main ready: ${sqlFiles.length} migrations verified, ceiling=${ceiling}, review pack ${okLines}/${EXPECTED_REVIEW_ENTRIES} digests OK`);
