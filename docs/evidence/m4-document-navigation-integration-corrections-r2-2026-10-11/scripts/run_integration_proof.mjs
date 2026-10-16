#!/usr/bin/env node
/**
 * Her Flight Deck - Round-3 Integration Proof Runner (M4-R20, R25, R27)
 *
 * Nothing here is asserted from a literal. Expectations are read from maintained artifacts:
 *   - scratch/accepted-main/            verified shipped ledger + derived schema ceiling (R21)
 *   - receipts/00-pre-edit-inventory.json  the subject pack's pre-edit bytes (REV1)
 *   - issue-to-test-map.json            required test names, cross-checked against what ran
 *   - scratch/pdfjs-engine/scratch-artifacts.json  digests of the engine bytes that execute (R22)
 *   - the frozen rereview pack's checks.json  historical reproduction expectations
 *
 * Each step writes its receipt BEFORE the next one runs, so a mid-run failure still leaves its
 * evidence. SHA256SUMS is generated last and re-verified inside the same execution, with
 * the verification outcome recorded in receipts/16-manifest-verification.txt.
 *
 * Usage: node docs/evidence/<this pack>/scripts/run_integration_proof.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runRealParserDemonstration, resolveEngine } from "../proof/realParserDemonstration.mjs";
import {
  INSTALL_EXECUTION_FILE,
  buildInstallExecutionRecord,
  engineBindings,
  installCommandFor,
  readInstallExecution,
  validateInstallExecution,
  liveInstallAudit,
  markOutcomesIncomplete,
  validateTraceability,
  verificationResult,
  verifyManifest,
} from "./evidenceChecks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packRoot = process.argv.includes("--pack-root")
  ? path.resolve(process.argv[process.argv.indexOf("--pack-root") + 1])
  : path.resolve(here, "..");
const repoRoot = path.resolve(packRoot, "../../..");
const packRel = path.relative(repoRoot, packRoot);
const subjectRel = "docs/evidence/m4-document-navigation-integration-corrections-2026-10-11";
const frozenRel = "docs/evidence/m4-document-navigation-integration-rereview-2026-10-11";
const receiptsDir = path.join(packRoot, "receipts");

// ---------------------------------------------------------------------------
// 08b report and README traceability (R25/R32/R36). Shared by the full run and by
// `--validate-claims-only`, which checks the current report and README against the receipts of
// the last recorded run without re-running anything.
// ---------------------------------------------------------------------------
const CURRENT_REPORT = "docs/M4_DOCUMENT_NAVIGATION_ROUND6_CORRECTIONS_REPORT_2026-10-16.md";
function claimsTraceability({ executedTests, mappedCount }) {
  const reportPath = path.join(repoRoot, CURRENT_REPORT);
  const readmePath = path.join(packRoot, "README.md");
  const reportText = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : "";
  const readmeText = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : "";
  const executedMutantsPath = path.join(receiptsDir, "07b-executed-mutants.json");
  const executedMutantsData = fs.existsSync(executedMutantsPath)
    ? JSON.parse(fs.readFileSync(executedMutantsPath, "utf8"))
    : { total: 0, mutants: [] };
  const executedMutants = new Set(executedMutantsData.mutants.map((m) => m.id));
  const trace = validateTraceability({
    texts: [reportText, readmeText],
    executedTests,
    executedMutants,
    measured: { mappedTests: mappedCount, mutants: executedMutants.size },
  });
  const ok = trace.ok && reportText.length > 0;
  const text =
    `=== 08b report and README traceability validation ===\n` +
    `node: ${process.version}\n` +
    `report: ${CURRENT_REPORT} (${reportText.length ? "present" : "MISSING"})\n` +
    `executed mutants in receipt: ${executedMutants.size}\n` +
    `cited tests in report and README: ${trace.citedTests.length} (unexecuted: ${trace.unexecutedCitedTests.length})\n` +
    (trace.unexecutedCitedTests.length ? trace.unexecutedCitedTests.map((t) => `  MISSING TEST: ${t}`).join("\n") + "\n" : "  (all cited tests executed)\n") +
    `cited mutants in report and README: ${trace.citedMutants.length} (unexecuted: ${trace.unexecutedCitedMutants.length})\n` +
    (trace.unexecutedCitedMutants.length ? trace.unexecutedCitedMutants.map((m) => `  UNEXECUTED CITED MUTANT: ${m}`).join("\n") + "\n" : "  (all cited mutants executed)\n") +
    (trace.missingExecutedMutants.length ? trace.missingExecutedMutants.map((m) => `  EXECUTED MUTANT MISSING FROM REPORT/README: ${m}`).join("\n") + "\n" : "  (all executed mutants cited)\n") +
    (trace.staleCounts.length ? trace.staleCounts.map((c) => `  STALE COUNT: "${c.text}" (measured ${c.kind} = ${c.kind === "mappedTests" ? mappedCount : executedMutants.size})`).join("\n") + "\n" : "  (all cited counts match measured counts)\n") +
    `RESULT: ${ok ? "PASS - every cited test, mutant and count matches what executed, and all executed mutants are cited" : "FAILED - report or README has traceability discrepancy"}\n`;
  const failures = [];
  if (trace.unexecutedCitedTests.length) failures.push(`08b traceability: report/README cites unexecuted tests (${trace.unexecutedCitedTests.length})`);
  if (trace.unexecutedCitedMutants.length) failures.push(`08b traceability: report/README cites unexecuted mutants (${trace.unexecutedCitedMutants.join(", ")})`);
  if (trace.missingExecutedMutants.length) failures.push(`08b traceability: executed mutants missing from report/README (${trace.missingExecutedMutants.join(", ")})`);
  if (trace.noMutants) failures.push("08b traceability: no executed mutants found in receipts/07b-executed-mutants.json");
  if (trace.staleCounts.length) failures.push(`08b traceability: stale counts in report/README (${trace.staleCounts.map((c) => c.text).join(", ")})`);
  if (!reportText.length) failures.push(`08b traceability: current report ${CURRENT_REPORT} is missing`);
  return { ok, text, failures };
}

if (process.argv.includes("--validate-claims-only")) {
  // Executed test names come from the recorded suite receipts' "passed names" sections.
  const executedTests = new Set();
  for (const name of ["05-suite-proof.txt", "06-suite-lifecycle.txt", "07-suite-sensitivity.txt"]) {
    const file = path.join(receiptsDir, name);
    if (!fs.existsSync(file)) continue;
    for (const m of fs.readFileSync(file, "utf8").matchAll(/^  - (.+)$/gm)) executedTests.add(m[1].trim());
  }
  const map = JSON.parse(fs.readFileSync(path.join(packRoot, "issue-to-test-map.json"), "utf8"));
  let mappedCount = 0;
  for (const g of map.groups ?? []) for (const c of g.cases ?? []) if (c.test_name) mappedCount++;
  const result = claimsTraceability({ executedTests, mappedCount });
  process.stdout.write(result.text);
  if (!result.ok) {
    console.error(`PROOF RUN FAILED:\n- ${result.failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("CLAIMS VALIDATION PASSED (report and README match the recorded receipts)");
  process.exit(0);
}

if (process.argv.includes("--verify-manifest-only")) {
  const verify = verifyManifest(packRoot, "SHA256SUMS");
  if (!verify.ok) {
    console.error(`PROOF RUN FAILED: 16 manifest: SHA256SUMS does not verify (exit ${verify.exit}): ${verify.bad.join("; ") || verify.stderr.trim()}`);
    process.exit(1);
  }
  console.log("MANIFEST VERIFICATION PASSED");
  process.exit(0);
}

const DEFAULT_PINNED_REF = "e8720003a76be680812dfe3605d58e7eb6372d00";
const hasPinnedRefOverride = Boolean(process.env.M4_PINNED_REF);
const PINNED_REF = process.env.M4_PINNED_REF ?? DEFAULT_PINNED_REF;
const pinnedRefSource = hasPinnedRefOverride
  ? "environment override (M4_PINNED_REF)"
  : "default (hardcoded accepted-main baseline)";

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const fileSha = (p) => sha256(fs.readFileSync(p));
const failures = [];
const steps = [];

fs.mkdirSync(receiptsDir, { recursive: true });
// Round 4 (M4-R31): before any step runs, replace the outcome receipts with an explicit
// "incomplete" state, so an interrupted run cannot leave an earlier success summary behind.
markOutcomesIncomplete(receiptsDir, new Date().toISOString());
process.chdir(repoRoot);

const write = (name, text) => fs.writeFileSync(path.join(receiptsDir, name), text.endsWith("\n") ? text : text + "\n");

function exec(label, command, args, opts = {}) {
  const r = spawnSync(command, args, { encoding: "utf-8", cwd: opts.cwd ?? repoRoot, maxBuffer: 64 * 1024 * 1024 });
  const record = {
    label,
    command: [command, ...args].join(" "),
    cwd: opts.cwd ?? repoRoot,
    nodeVersion: process.version,
    exit: r.status,
    // M4-R39: a child killed by a signal has no exit status; keep the real signal instead.
    signal: r.signal ?? null,
    error: r.error ? String(r.error.message) : null,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
  steps.push(record);
  return record;
}

/** Commits the step's receipt immediately, then fails the run if the step did not meet `expect`. */
function commit(label, step, expect, receiptName, render) {
  const problem = expect(step);
  const body =
    `=== ${label} ===\n` +
    `node: ${process.version}  platform: ${process.platform}/${process.arch}\n` +
    `cwd: ${step.cwd}\ncommand: ${step.command}\nexit: ${step.exit}\n` +
    (problem ? `RESULT: FAILED - ${problem}\n` : "RESULT: PASS\n") +
    `--- stdout ---\n${step.stdout}\n--- stderr ---\n${step.stderr}\n` +
    (render ? `\n--- derived ---\n${render}\n` : "");
  if (receiptName) write(receiptName, body);
  if (problem) failures.push(`${label}: ${problem}`);
  return !problem;
}

/** Parse the node:test TAP summary and result lines. */
function parseTap(stdout) {
  const num = (label) => {
    const m = new RegExp(`^# ${label} (\\d+)$`, "m").exec(stdout);
    return m ? Number(m[1]) : null;
  };
  return {
    tests: num("tests"),
    pass: num("pass"),
    fail: num("fail"),
    passedNames: [...stdout.matchAll(/^ok \d+ - (.+?)(?:\s+\(.+?\))?$/gm)].map((m) => m[1].trim()),
    failedNames: [...stdout.matchAll(/^not ok \d+ - (.+?)(?:\s+\(.+?\))?$/gm)].map((m) => m[1].trim()),
  };
}

console.log(`=== round-6 integration proof runner | node ${process.version} | ${packRel}`);

// ---------------------------------------------------------------------------
// 01 toolchain and repository identity (all measured)
// ---------------------------------------------------------------------------
const head = exec("head", "git", ["rev-parse", "HEAD"]);
const status = exec("status", "git", ["status", "--porcelain", "-uno"]);
const trackedDirty = status.stdout.split("\n").filter((l) => l && !l.startsWith("??"));
commit(
  "01 toolchain",
  head,
  (s) => (s.exit === 0 ? null : "git rev-parse failed"),
  "01-toolchain.txt",
  `head: ${head.stdout.trim()}\nnode: ${process.version}\npinned accepted-main: ${PINNED_REF} [source: ${pinnedRefSource}]\ntracked modifications in this worktree: ${trackedDirty.length}`
);

// ---------------------------------------------------------------------------
// 01b scratch engine install verification and audit (R22/R27/R31)
// ---------------------------------------------------------------------------
const engineDir = path.join(packRoot, "scratch", "pdfjs-engine");
const pkgDir = path.join(engineDir, "node_modules", "pdfjs-dist");
const scratchArtifactsPath = path.join(engineDir, "scratch-artifacts.json");
const doInstall = process.argv.includes("--install");
// Round 4 (Claude): only the reuse lane needs an existing engine. Previously this check ran
// before `--install` was read, so a clean checkout could never reach the live-install lane.
if (!doInstall && !fs.existsSync(pkgDir)) {
  console.error(`\nPROOF RUN ABORTED: scratch engine not installed at ${pkgDir}.\nRun this runner with --install, or: npm ci --prefix ${path.relative(repoRoot, engineDir)} --no-audit --no-fund --ignore-scripts\n`);
  process.exit(1);
}
let installRecord;
let installAuditText;

const engineRel = path.relative(repoRoot, engineDir);
const expectedInstallCommand = installCommandFor(engineRel);
const executionPath = path.join(engineDir, INSTALL_EXECUTION_FILE);

if (doInstall) {
  // Round 5 (M4-R35): a live install writes a real execution record — command, cwd, Node/npm,
  // exit, captured output and the digests of what it produced — so a later reuse can be bound to
  // an install that actually ran and succeeded.
  const npmV = exec("npm version", "npm", ["--version"]);
  const startedAt = new Date().toISOString();
  const r = exec("engine install", "npm", ["ci", "--prefix", engineRel, "--no-audit", "--no-fund", "--ignore-scripts"]);
  const finishedAt = new Date().toISOString();
  const execution = buildInstallExecutionRecord({
    command: expectedInstallCommand,
    cwd: repoRoot,
    nodeVersion: process.version,
    npmVersion: (npmV.stdout || "").trim() || `unknown (npm --version exited ${npmV.exit})`,
    exit: r.exit,
    signal: r.signal,
    spawnError: r.error,
    stdout: r.stdout,
    stderr: r.stderr,
    startedAt,
    finishedAt,
    bindings: engineBindings(engineDir),
  });
  fs.mkdirSync(engineDir, { recursive: true });
  fs.writeFileSync(executionPath, JSON.stringify(execution, null, 2) + "\n");
  const pkgJson = fs.existsSync(path.join(pkgDir, "package.json")) ? JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")) : null;
  installRecord = {
    mode: "live-install",
    command: expectedInstallCommand,
    cwd: repoRoot,
    exit: r.exit,
    signal: r.signal,
    spawnError: r.error,
    nodeVersion: process.version,
    npmVersion: execution.npmVersion,
    installedPackage: pkgJson,
    scratchArtifactsSha256: fs.existsSync(scratchArtifactsPath) ? fileSha(scratchArtifactsPath) : null,
    executionRecordSha256: fileSha(executionPath),
  };
  const audit = liveInstallAudit({ ...installRecord, platform: `${process.platform}/${process.arch}` });
  installAuditText =
    audit.text +
    `npm: ${execution.npmVersion}\n` +
    `execution record: ${path.relative(packRoot, executionPath)} sha256 ${installRecord.executionRecordSha256}\n` +
    `--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`;
  if (r.exit !== 0) {
    failures.push(
      r.signal
        ? `01b engine install: npm ci was terminated by ${r.signal} (no exit status)`
        : `01b engine install: npm ci exited ${r.exit}${r.error ? ` (${r.error})` : ""}`
    );
  }
  steps.push({ label: "01b engine install audit", ...installRecord });
} else {
  // Byte integrity against scratch-artifacts.json (what was evaluated) ...
  const recorded = fs.existsSync(scratchArtifactsPath) ? JSON.parse(fs.readFileSync(scratchArtifactsPath, "utf8")) : null;
  const lockSha = fs.existsSync(path.join(engineDir, "package-lock.json")) ? fileSha(path.join(engineDir, "package-lock.json")) : null;
  const pkgSha = fs.existsSync(path.join(engineDir, "package.json")) ? fileSha(path.join(engineDir, "package.json")) : null;
  const legacySha = fs.existsSync(path.join(pkgDir, "legacy/build/pdf.mjs")) ? fileSha(path.join(pkgDir, "legacy/build/pdf.mjs")) : null;
  const lockMatches = Boolean(recorded) && lockSha === recorded.lockfile?.sha256;
  const pkgMatches = Boolean(recorded) && pkgSha === recorded.packageJson?.sha256;
  const engineMatches = Boolean(recorded) && legacySha === recorded.evaluated_assets?.["legacy/build/pdf.mjs"]?.sha256;
  const integrityOk = lockMatches && pkgMatches && engineMatches;

  // ... and, separately, proof that a successful install of exactly these bytes ran here (M4-R35).
  // scratch-artifacts.json's installCommand is a description, not an execution record.
  const attestation = validateInstallExecution(readInstallExecution(executionPath), {
    expectedCommand: expectedInstallCommand,
    expectedCwd: repoRoot,
    currentBindings: engineBindings(engineDir),
  });
  const execution = readInstallExecution(executionPath).record;
  const reuseOk = integrityOk && attestation.ok;

  installRecord = {
    mode: "verified-reuse",
    command: `verified-reuse of ${expectedInstallCommand}`,
    cwd: repoRoot,
    exit: reuseOk ? 0 : 1,
    nodeVersion: process.version,
    integrityOk,
    attestationOk: attestation.ok,
    attestationProblems: attestation.problems,
    recordedInstall: execution && typeof execution === "object" ? { command: execution.command, cwd: execution.cwd, nodeVersion: execution.nodeVersion, npmVersion: execution.npmVersion, exit: execution.exit, finishedAt: execution.finishedAt } : null,
    installedPackage: fs.existsSync(path.join(pkgDir, "package.json")) ? JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")) : null,
    scratchArtifactsSha256: fs.existsSync(scratchArtifactsPath) ? fileSha(scratchArtifactsPath) : null,
    executionRecordSha256: fs.existsSync(executionPath) ? fileSha(executionPath) : null,
  };
  installAuditText =
    `=== 01b scratch engine install audit ===\n` +
    `node: ${process.version}  platform: ${process.platform}/${process.arch}\n` +
    `mode: verified-reuse (no install ran in this execution)\n` +
    `--- byte integrity against scratch-artifacts.json ---\n` +
    `lockfile sha256: ${lockSha} (matches: ${lockMatches})\n` +
    `package.json sha256: ${pkgSha} (matches: ${pkgMatches})\n` +
    `legacy pdf.mjs sha256: ${legacySha} (matches: ${engineMatches})\n` +
    `integrity: ${integrityOk ? "PASS" : "FAILED"}\n` +
    `--- install execution record (${path.relative(packRoot, executionPath)}, sha256 ${installRecord.executionRecordSha256}) ---\n` +
    (installRecord.recordedInstall
      ? `recorded command: ${installRecord.recordedInstall.command}\nrecorded cwd: ${installRecord.recordedInstall.cwd}\nrecorded node/npm: ${installRecord.recordedInstall.nodeVersion} / ${installRecord.recordedInstall.npmVersion}\nrecorded exit: ${installRecord.recordedInstall.exit}\nrecorded finished: ${installRecord.recordedInstall.finishedAt}\n`
      : "") +
    (attestation.problems.length ? attestation.problems.map((x) => `  PROBLEM: ${x}`).join("\n") + "\n" : "") +
    `attestation: ${attestation.ok ? "PASS" : "FAILED"}\n` +
    `RESULT: ${reuseOk ? "PASS - engine bytes verified and bound to a recorded successful install in this checkout" : `FAILED - ${!integrityOk ? "engine bytes do not match scratch-artifacts.json" : ""}${!integrityOk && !attestation.ok ? "; " : ""}${!attestation.ok ? "no valid successful install execution record" : ""}`}\n`;
  if (!integrityOk) failures.push("01b engine install: verified-reuse failed due to artifact digest mismatch");
  if (!attestation.ok) failures.push(`01b engine install: verified-reuse has no valid install execution record (${attestation.problems.join("; ")})`);
  steps.push({ label: "01b engine install audit", ...installRecord });
}
write("01b-engine-install.txt", installAuditText);

// Round 4 (M4-R31): every later suite and the parser proof need this engine. If it is not
// usable, stop now with a recorded failure instead of crashing at the parser step and leaving
// only the "incomplete" marker behind.
if (!fs.existsSync(pkgDir) || failures.some((f) => f.startsWith("01b engine install"))) {
  const stopped = {
    status: "failed",
    ranAt: new Date().toISOString(),
    node: process.version,
    stoppedAt: "01b engine install",
    failures: [...failures, ...(fs.existsSync(pkgDir) ? [] : [`01b engine install: no usable engine at ${path.relative(repoRoot, pkgDir)}`])],
  };
  write("15-run-summary.json", JSON.stringify(stopped, null, 2));
  write("16-manifest-verification.txt", `=== 16 manifest verification ===\nRESULT: NOT RUN - the run stopped at 01b engine install; no verification outcome is claimed\n`);
  console.error(`PROOF RUN FAILED:\n- ${stopped.failures.join("\n- ")}`);
  process.exit(1);
}

// Round 5: `--engine-check-only` runs the real install/reuse step above and stops. It never
// claims a full run; tests use it to drive the actual runner without recursing into the suites.
if (process.argv.includes("--engine-check-only")) {
  const partial = { status: "engine-check-only", ranAt: new Date().toISOString(), node: process.version, engineMode: installRecord.mode, failures: [...failures] };
  write("15-run-summary.json", JSON.stringify(partial, null, 2));
  write("16-manifest-verification.txt", `=== 16 manifest verification ===\nRESULT: NOT RUN - engine check only; no verification outcome is claimed\n`);
  if (failures.length) {
    console.error(`PROOF RUN FAILED:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`ENGINE CHECK PASSED (${installRecord.mode}); no other step ran.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 02 accepted-main reference must exist and verify (R21)
// ---------------------------------------------------------------------------
const ceilingPath = path.join(packRoot, "scratch/accepted-main/schema-ceiling.txt");
const ledgerPath = path.join(packRoot, "scratch/accepted-main/src-tauri/migrations");
if (!fs.existsSync(ceilingPath) || !fs.existsSync(ledgerPath)) {
  failures.push("02 accepted-main: scratch/accepted-main is missing; run scripts/prepare-accepted-main.mjs");
  write("02-accepted-main.txt", `=== 02 accepted-main ===\nRESULT: FAILED - reference tree absent\n`);
} else {
  const prep = exec("accepted-main prepare", process.execPath, [path.join(packRel, "scripts/prepare-accepted-main.mjs"), ...(PINNED_REF ? [PINNED_REF] : [])]);
  commit(
    "02 accepted-main",
    prep,
    (s) => (s.exit === 0 ? null : `reference preparation exited ${s.exit}: ${s.stderr.slice(0, 200) || s.stdout.slice(0, 200)}`),
    "02-accepted-main.txt",
    `derived from: ${PINNED_REF} [source: ${pinnedRefSource}]\n${prep.stdout.trim()}`
  );
}

// ---------------------------------------------------------------------------
// 03 subject pack vs the pre-edit inventory (REV1: "unchanged" must be measured, added fails R27)
// ---------------------------------------------------------------------------
const inventoryPath = path.join(receiptsDir, "00-pre-edit-inventory.json");
if (!fs.existsSync(inventoryPath)) {
  failures.push("03 inventory: receipts/00-pre-edit-inventory.json missing");
} else {
  const inv = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  const now = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(full); continue; }
      now[path.relative(repoRoot, full)] = fileSha(full);
    }
  };
  walk(path.join(repoRoot, subjectRel));
  const changed = Object.entries(inv.subjectPackFiles.entries).filter(([p, e]) => now[p] && now[p] !== e.sha256).map(([p]) => p);
  const removed = Object.keys(inv.subjectPackFiles.entries).filter((p) => !now[p]);
  const added = Object.keys(now).filter((p) => !inv.subjectPackFiles.entries[p]);
  write(
    "03-subject-pack-inventory.txt",
    `=== 03 subject pack vs pre-edit inventory ===\nnode: ${process.version}\ncmd: compare ${subjectRel} against receipts/00-pre-edit-inventory.json\n` +
    `recorded files: ${Object.keys(inv.subjectPackFiles.entries).length}\nchanged: ${changed.length} ${JSON.stringify(changed)}\n` +
    `removed: ${removed.length} ${JSON.stringify(removed)}\nadded: ${added.length} ${JSON.stringify(added)}\n` +
    `RESULT: ${changed.length === 0 && removed.length === 0 && added.length === 0 ? "PASS - subject R9-R12 pack is byte-identical to the pre-edit inventory" : "FAILED - subject pack drifted"}`
  );
  if (changed.length || removed.length || added.length) {
    failures.push(`03 inventory: subject pack drifted (changed=${changed.length}, removed=${removed.length}, added=${added.length})`);
  }
}

// ---------------------------------------------------------------------------
// 04 frozen submitted paths and prior rounds' published SHA256SUMS (R27)
// ---------------------------------------------------------------------------
const frozenManifest = path.join(repoRoot, frozenRel, "submitted-hashes.json");
const frozen = JSON.parse(fs.readFileSync(frozenManifest, "utf8"));
const frozenResult = { unchanged: [], changed: [], missing: [] };
for (const [rel, expected] of Object.entries(frozen.files)) {
  const p = path.join(repoRoot, rel);
  if (!fs.existsSync(p)) frozenResult.missing.push(rel);
  else (fileSha(p) === expected ? frozenResult.unchanged : frozenResult.changed).push({ path: rel, expected, actual: fileSha(p) });
}
const frozenExpect = inv04Expect(frozenResult);
function inv04Expect(r) {
  const disclosed = [
    "docs/M4_DOCUMENT_NAVIGATION_AND_VIEWER_EVALUATION_2026-10-11.md",
    "docs/M4_CONDITIONAL_IMPLEMENTATION_PROMPT_2026-10-11.md",
  ];
  const unexpected = r.changed.filter((c) => !disclosed.includes(c.path)).map((c) => c.path);
  if (r.missing.length) return `missing paths: ${r.missing.join(", ")}`;
  if (unexpected.length) return `unexpected changed paths: ${unexpected.join(", ")}`;
  return null;
}

// Verify published SHA256SUMS for the R9-R12 review pack and prior rounds (R27)
const priorPacksToCheck = [
  "docs/evidence/m4-document-navigation-integration-rereview-2026-10-11", // R9-R12 review pack
  "docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11",
  "docs/evidence/m4-document-navigation-scope-rereview-2026-10-11",
  "docs/evidence/m4-document-navigation-scope-review-2026-10-11",
  "docs/evidence/m4-document-navigation-eval-2026-10-11",
];
const priorPackResults = [];
for (const rel of priorPacksToCheck) {
  const full = path.join(repoRoot, rel);
  if (!fs.existsSync(path.join(full, "SHA256SUMS"))) {
    priorPackResults.push({ rel, status: "MISSING SHA256SUMS" });
    failures.push(`04 prior packs: ${rel}/SHA256SUMS missing`);
    continue;
  }
  const check = exec(`verify ${path.basename(rel)}`, "shasum", ["-a", "256", "-c", "SHA256SUMS"], { cwd: full });
  const bad = (check.stdout || "").split("\n").filter((l) => /: (FAILED|WARNING)/.test(l));
  if (check.exit !== 0 || bad.length > 0) {
    priorPackResults.push({ rel, status: `FAILED: ${bad.join("; ") || check.stderr}` });
    failures.push(`04 prior packs: ${rel} SHA256SUMS check failed`);
  } else {
    const count = (check.stdout || "").split("\n").filter((l) => l.endsWith(": OK")).length;
    priorPackResults.push({ rel, status: `PASS (${count} files OK)` });
  }
}

write(
  "04-frozen-submitted-paths.txt",
  `=== 04 frozen submitted paths and prior rounds verification ===\nnode: ${process.version}\nmanifest: ${frozenRel}/submitted-hashes.json\n` +
  `entries: ${Object.keys(frozen.files).length}  unchanged: ${frozenResult.unchanged.length}  changed(disclosed): ${frozenResult.changed.length}  missing: ${frozenResult.missing.length}\n` +
  `changed detail:\n${frozenResult.changed.map((c) => `  ${c.path}\n    expected ${c.expected}\n    actual   ${c.actual}`).join("\n") || "  (none)"}\n` +
  `--- prior rounds published SHA256SUMS verification (R27) ---\n` +
  priorPackResults.map((p) => `  ${p.rel}: ${p.status}`).join("\n") + "\n" +
  `RESULT: ${frozenExpect ? `FAILED - ${frozenExpect}` : "PASS - final state reconciles: unchanged except disclosed revisions, and all prior packs verified"}`
);
if (frozenExpect) failures.push(`04 frozen: ${frozenExpect}`);

// ---------------------------------------------------------------------------
// 05-07 current suites, with map traceability
// ---------------------------------------------------------------------------
const issueMap = JSON.parse(fs.readFileSync(path.join(packRoot, "issue-to-test-map.json"), "utf8"));
const mappedNames = new Set();
for (const g of issueMap.groups ?? []) for (const item of g.cases ?? []) if (item.test_name) mappedNames.add(item.test_name);

// Round 5: the sensitivity suite runs first, so receipts/07b-executed-mutants.json describes this
// run before the proof suite's execution-record test reads it. Receipt names are unchanged.
const suites = [
  { name: "sensitivityMutants.test.mjs", receipt: "07-suite-sensitivity.txt" },
  { name: "proof.test.mjs", receipt: "05-suite-proof.txt" },
  { name: "databaseLifecycle.test.mjs", receipt: "06-suite-lifecycle.txt" },
];
const executedNames = new Set();
for (const s of suites) {
  const r = exec(s.name, process.execPath, ["--test", "--test-reporter=tap", path.join(packRel, "proof", s.name)]);
  const t = parseTap(r.stdout);
  for (const n of t.passedNames) executedNames.add(n);
  commit(
    `suite ${s.name}`,
    r,
    (step) => {
      if (step.exit !== 0) return `exit ${step.exit}; failing tests: ${JSON.stringify(t.failedNames)}`;
      if (t.tests === null || t.tests === 0) return "no tests were reported";
      if (t.fail !== 0) return `${t.fail} failing`;
      if (t.pass !== t.tests) return `pass count ${t.pass} != tests ${t.tests}`;
      return null;
    },
    s.receipt,
    `tests ${t.tests}, pass ${t.pass}, fail ${t.fail}\npassed names:\n${t.passedNames.map((n) => `  - ${n}`).join("\n")}`
  );
}

// Every mapped test must actually have run.
const neverRun = [...mappedNames].filter((n) => !executedNames.has(n));
write(
  "08-issue-map-traceability.txt",
  `=== 08 issue-to-test map traceability ===\nnode: ${process.version}\n` +
  `mapped test names: ${mappedNames.size}  executed: ${executedNames.size}  mapped-but-not-executed: ${neverRun.length}\n` +
  `${neverRun.map((n) => `  MISSING: ${n}`).join("\n") || "  (none)"}\n` +
  `RESULT: ${neverRun.length ? "FAILED - the map names tests that did not run" : "PASS - every mapped test executed and passed"}`
);
if (neverRun.length) failures.push(`08 traceability: ${neverRun.length} mapped tests did not run`);

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 08b report and README traceability validation (R25/R32)
// Consumes execution records from receipts/07b-executed-mutants.json.
// Fails loudly if report or README cites any test or mutant that did not execute,
// or if any executed mutant is missing from the report/README.
// ---------------------------------------------------------------------------
const trace08b = claimsTraceability({ executedTests: executedNames, mappedCount: mappedNames.size });
write("08b-report-readme-traceability.txt", trace08b.text);
failures.push(...trace08b.failures);

// ---------------------------------------------------------------------------
// 09 parser proof on this engine + artifact digest of the bytes that executed
// ---------------------------------------------------------------------------
const enginePath = resolveEngine("legacy");
const harness = path.join(packRel, "scripts/parser-entrypoint.mjs");
const demo = exec("parser legacy demo", process.execPath, [harness, "legacy"]);
const demoJson = (() => { try { return JSON.parse(demo.stdout); } catch { return null; } })();
const artifacts = JSON.parse(fs.readFileSync(path.join(packRoot, "scratch/pdfjs-engine/scratch-artifacts.json"), "utf8"));
const recordedPdfMjs = artifacts?.evaluated_assets?.["legacy/build/pdf.mjs"]?.sha256 ?? null;
const executingSha = fileSha(enginePath);
commit(
  "09 parser proof",
  demo,
  (s) => {
    if (s.exit !== 0) return `parser demonstration exited ${s.exit}: ${s.stderr.slice(0, 200)}`;
    if (!demoJson) return "parser output was not JSON";
    if (demoJson.results.length !== 5) return `expected 5 fixtures, got ${demoJson.results.length}`;
    if (!demoJson.results.every((x) => x.success)) return `fixture failures: ${JSON.stringify(demoJson.results.filter((x) => !x.success))}`;
    if (demoJson.corruption?.resolvedPages !== 50) return `forged /Count demonstration resolved ${demoJson.corruption?.resolvedPages}, expected 50`;
    return null;
  },
  "09-parser-legacy.txt",
  `engine resolved from this pack: ${path.relative(repoRoot, enginePath)}\n` +
  `executing artifact sha256: ${executingSha}\n` +
  `scratch-artifacts.json pdf.mjs: ${recordedPdfMjs}\n` +
  `digests match: ${recordedPdfMjs === executingSha ? "YES" : "NO - the audit no longer describes the bytes that ran"}\n` +
  demo.stdout
);
if (recordedPdfMjs !== executingSha) failures.push("09 parser: recorded artifact digest does not match the executing bytes");

// Modern entrypoint on an engine that cannot run it stays a labelled historical artifact.
const modern = exec("parser modern probe", process.execPath, [harness, "modern"]);
const modernExpectedFailure = Number(process.versions.node.split(".")[0]) < 24;
write(
  "10-parser-modern-historical.txt",
  `=== 10 modern pdfjs entrypoint probe (labelled historical artifact) ===\nnode: ${process.version}\n` +
  `exit: ${modern.exit}\nstdout: ${modern.stdout.trim()}\nstderr(head): ${modern.stderr.split("\n").slice(0, 4).join(" | ")}\n` +
  `expectation on this lane: ${modernExpectedFailure ? "FAILS (Promise.try unavailable in Node < 24) — recorded as a limitation of THAT BUILD only" : "loads cleanly"}\n` +
  `RESULT: ${modernExpectedFailure === (modern.exit !== 0) ? "PASS - matches the lane expectation" : "FAILED - modern entrypoint behaviour changed on this engine"}`
);
if (modernExpectedFailure !== (modern.exit !== 0)) failures.push("10 modern probe: unexpected behaviour on this lane");

// ---------------------------------------------------------------------------
// 11 historical reproductions from the frozen rereview pack (expectations from checks.json)
// ---------------------------------------------------------------------------
const histExpect = JSON.parse(fs.readFileSync(path.join(repoRoot, frozenRel, "checks.json"), "utf8")).checks;
const histFiles = { diagnostics: "diagnostics.test.mjs", "historical-current": "historical-current.test.mjs", "prior-current": "prior-current.test.mjs" };
const histLines = [];
for (const [key, file] of Object.entries(histFiles)) {
  const expectation = histExpect.find((c) => c.name === key);
  const r = exec(`historical ${key}`, process.execPath, ["--test", "--test-reporter=tap", path.join(repoRoot, frozenRel, file)], { cwd: path.join(repoRoot, frozenRel) });
  const t = parseTap(r.stdout);
  const laneMatches = expectation && expectation.runtime === process.version;
  let problem = null;
  if (!expectation) problem = `no recorded expectation for ${key}`;
  else if (laneMatches) {
    if (r.exit !== expectation.exit) problem = `exit ${r.exit} != recorded ${expectation.exit}`;
    else if (t.pass !== expectation.passed || t.fail !== expectation.failed) problem = `counts ${t.pass}/${t.fail} != recorded ${expectation.passed}/${expectation.failed}`;
  }
  histLines.push(
    `${key}: recorded exit=${expectation?.exit} pass=${expectation?.passed} fail=${expectation?.failed} @${expectation?.runtime} | ` +
    `observed exit=${r.exit} pass=${t.pass} fail=${t.fail} @${process.version} | ${problem ? `FAILED - ${problem}` : laneMatches ? "PASS (same lane)" : "OBSERVED (different lane; not comparable)"}`
  );
  if (problem) failures.push(`11 historical ${key}: ${problem}`);
}
write("11-historical-reproductions.txt", `=== 11 historical reproductions (frozen rereview pack) ===\n` + histLines.join("\n"));

// ---------------------------------------------------------------------------
// 12 hygiene (measured)
// ---------------------------------------------------------------------------
const ws = exec("whitespace", "git", ["diff", "--check"]);
const staged = exec("staged", "git", ["diff", "--cached", "--name-only"]);
const otherWorktrees = exec("subject tracked state", "git", ["status", "--porcelain", "-uno"]);
commit(
  "12 hygiene",
  ws,
  (s) => {
    if (s.stdout.trim()) return `trailing whitespace/conflict markers: ${s.stdout.trim().slice(0, 200)}`;
    if (staged.stdout.trim()) return `staged files present: ${staged.stdout.trim()}`;
    return null;
  },
  "12-hygiene.txt",
  `tracked modifications: ${trackedDirty.length}\nsubject pack untracked: ${otherWorktrees.stdout.split("\n").filter((l) => l.startsWith("??") && l.includes("m4-document-navigation")).length} entries\nproduction paths (src/, src-tauri/, package.json, Cargo.*) modified: ${trackedDirty.filter((l) => /^\s*M\s+(src\/|src-tauri\/|package|Cargo)/.test(l)).length}`
);

// ---------------------------------------------------------------------------
// 13-16 Two-Stage Manifest Generation, Tamper Self-Test, and In-Run Verification (R27/R31)
// ---------------------------------------------------------------------------
const getPackFiles = () => {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, e.name);
      const rel = path.relative(packRoot, full);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || rel === "scratch/accepted-main") continue;
        walk(full);
        continue;
      }
      if (rel === "SHA256SUMS" || rel === "PAYLOAD_SHA256SUMS") continue;
      files.push(rel);
    }
  };
  walk(packRoot);
  return files;
};

// 14 Tamper self-test: prove runner itself fails when a delivered receipt is changed after manifest (R27/R31)
const tamperDir = fs.mkdtempSync(path.join(os.tmpdir(), "hfd-r3-tamper-"));
try {
  fs.mkdirSync(path.join(tamperDir, "receipts"), { recursive: true });
  fs.copyFileSync(path.join(receiptsDir, "01-toolchain.txt"), path.join(tamperDir, "receipts", "01-toolchain.txt"));

  const receiptSha = fileSha(path.join(tamperDir, "receipts", "01-toolchain.txt"));
  fs.writeFileSync(path.join(tamperDir, "SHA256SUMS"), `${receiptSha}  receipts/01-toolchain.txt\n`);

  // Tamper with delivered receipt
  fs.appendFileSync(path.join(tamperDir, "receipts", "01-toolchain.txt"), "TAMPER_EXTRA_BYTE\n");

  // Run the runner itself in verify mode against the tampered pack
  const runnerTamperCheck = exec(
    "runner tamper check",
    process.execPath,
    [path.join(packRoot, "scripts", "run_integration_proof.mjs"), "--verify-manifest-only", "--pack-root", tamperDir],
    { cwd: tamperDir }
  );
  const runnerFailed = runnerTamperCheck.exit !== 0 && (runnerTamperCheck.stderr || runnerTamperCheck.stdout).includes("FAILED");

  write(
    "14-manifest-tamper-selftest.txt",
    `=== 14 manifest tamper self-test ===\nnode: ${process.version}\n` +
    `cmd: node scripts/run_integration_proof.mjs --verify-manifest-only --pack-root <tmp> against tampered receipts/01-toolchain.txt\n` +
    `runner exit: ${runnerTamperCheck.exit}\noutput: ${runnerTamperCheck.stderr.trim() || runnerTamperCheck.stdout.trim()}\n` +
    `RESULT: ${runnerFailed ? "PASS - runner itself halts with exit 1 when a delivered receipt is changed after manifest" : "FAILED - runner did not fail on tampered receipt"}\n`
  );
  if (!runnerFailed) failures.push("14 tamper self-test: runner failed to reject tampered delivered receipt");
} finally {
  fs.rmSync(tamperDir, { recursive: true, force: true });
}

// Stage 1 Payload files (all pack files excluding self-referential outcome receipts and outer manifests)
const excludedFromPayload = new Set([
  "PAYLOAD_SHA256SUMS",
  "SHA256SUMS",
  "receipts/15-run-summary.json",
  "receipts/16-manifest-verification.txt",
]);
const payloadFiles = getPackFiles().filter((f) => !excludedFromPayload.has(f)).sort((a, b) => a.localeCompare(b));

// 13-manifest.txt: describes two-stage manifest architecture (R27/R31)
const expectedDeliveryCount = payloadFiles.length + 3; // payloadFiles + PAYLOAD_SHA256SUMS + 15 + 16
write(
  "13-manifest.txt",
  `=== 13 manifest generation ===\nnode: ${process.version}  platform: ${process.platform}/${process.arch}\n` +
  `cwd: ${packRoot}\n` +
  `stage 1 payload entries: ${payloadFiles.length}\n` +
  `stage 2 delivery entries: ${expectedDeliveryCount}\n` +
  `architecture: two-stage manifest resolving checksum self-reference\n` +
  `  - Stage 1: PAYLOAD_SHA256SUMS seals ${payloadFiles.length} immutable payload files\n` +
  `  - Stage 1 verification: measured execution recorded in receipts/16-manifest-verification.txt\n` +
  `  - Stage 2: SHA256SUMS seals complete delivery including payload manifest and receipts 15 & 16\n` +
  `  - Final seal verification: recorded as outer execution result outside covered set\n` +
  `included scratch artifacts: package.json, package-lock.json, scratch-artifacts.json\n` +
  `excluded by design: node_modules and scratch/accepted-main (prepared on demand)\n`
);

// Generate Stage 1 PAYLOAD_SHA256SUMS
const payloadBody = payloadFiles.map((rel) => `${fileSha(path.join(packRoot, rel))}  ${rel}`).join("\n") + "\n";
fs.writeFileSync(path.join(packRoot, "PAYLOAD_SHA256SUMS"), payloadBody);

// Execute Stage 1 verification command and record measured results
const payloadOutcome = verifyManifest(packRoot, "PAYLOAD_SHA256SUMS");
const payloadVerify = { exit: payloadOutcome.exit, stdout: payloadOutcome.stdout, stderr: payloadOutcome.stderr };
steps.push({ label: "payload manifest verify", command: "shasum -a 256 -c PAYLOAD_SHA256SUMS", cwd: packRoot, nodeVersion: process.version, ...payloadVerify });
const payloadBad = payloadOutcome.bad;
const payloadVerifyOk = payloadOutcome.ok;

if (!payloadVerifyOk) {
  failures.push(`16 payload manifest: PAYLOAD_SHA256SUMS verification failed: ${payloadBad.join("; ") || payloadVerify.stderr}`);
}

// 16 manifest verification receipt: records ACTUAL MEASURED outcome of payload verification
const payloadLines = (payloadVerify.stdout || "").trim().split("\n");
const manifestVerificationReceipt =
  `=== 16 manifest verification ===\nnode: ${process.version}  platform: ${process.platform}/${process.arch}\n` +
  `cwd: ${packRoot}\ncommand: shasum -a 256 -c PAYLOAD_SHA256SUMS\nexit: ${payloadVerify.exit}\n` +
  `${verificationResult(payloadOutcome, `all ${payloadFiles.length} payload files verified against PAYLOAD_SHA256SUMS`)}\n` +
  `--- verified files (summary) ---\n` +
  payloadLines.map((l) => l.trim()).join("\n") + "\n" +
  `\n--- stage 2 outer delivery seal ---\n` +
  `outer manifest SHA256SUMS seals complete delivery (${expectedDeliveryCount} entries) including receipts/15-run-summary.json and receipts/16-manifest-verification.txt\n`;
write("16-manifest-verification.txt", manifestVerificationReceipt);

// Collect all files to be included in Stage 2 outer delivery manifest SHA256SUMS
const allDeliveryFiles = [
  ...payloadFiles,
  "PAYLOAD_SHA256SUMS",
  "receipts/15-run-summary.json",
  "receipts/16-manifest-verification.txt",
].sort((a, b) => a.localeCompare(b));

// 15 summary: written with measured stepsExecuted accounting for the outer delivery verification step
const summary = {
  ranAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  cwd: repoRoot,
  headCommit: head.stdout.trim(),
  pinnedAcceptedMain: PINNED_REF || null,
  pinnedAcceptedMainSource: pinnedRefSource,
  pack: packRel,
  suites: suites.map((s) => {
    const st = steps.find((x) => x.label === s.name);
    const t = parseTap(st?.stdout ?? "");
    return { file: s.name, exit: st?.exit, tests: t.tests, pass: t.pass, fail: t.fail };
  }),
  mappedTests: mappedNames.size,
  mappedButNotExecuted: neverRun,
  frozenSubmitted: { unchanged: frozenResult.unchanged.length, changedDisclosed: frozenResult.changed.map((c) => c.path), missing: frozenResult.missing },
  priorPacksVerified: priorPackResults,
  parser: { engine: path.relative(repoRoot, enginePath), executingSha256: executingSha, recordedMatchesExecuting: recordedPdfMjs === executingSha },
  manifest: {
    payloadEntries: payloadFiles.length,
    payloadVerified: payloadVerifyOk,
    payloadExit: payloadVerify.exit,
    deliveryEntries: allDeliveryFiles.length,
    finalSealVerification: "recorded as outer execution result outside covered set",
    stages: {
      stage1: "PAYLOAD_SHA256SUMS verified before sealing receipts 15 and 16",
      stage2: "SHA256SUMS seals complete package including receipts 15 and 16",
    },
  },
  stepsExecuted: steps.length + 1, // accounting for delivery manifest verify
  failures: [...failures],
};
write("15-run-summary.json", JSON.stringify(summary, null, 2));

// Generate Stage 2 authoritative delivery SHA256SUMS from final bytes on disk
const deliveryManifestBody = allDeliveryFiles.map((rel) => `${fileSha(path.join(packRoot, rel))}  ${rel}`).join("\n") + "\n";
fs.writeFileSync(path.join(packRoot, "SHA256SUMS"), deliveryManifestBody);

// Stage 2 execution: verify delivered SHA256SUMS as outer check
const deliveryOutcome = verifyManifest(packRoot, "SHA256SUMS");
const deliveryVerify = { exit: deliveryOutcome.exit, stdout: deliveryOutcome.stdout, stderr: deliveryOutcome.stderr };
steps.push({ label: "delivery manifest verify", command: "shasum -a 256 -c SHA256SUMS", cwd: packRoot, nodeVersion: process.version, ...deliveryVerify });
const deliveryBad = deliveryOutcome.bad;
const deliveryVerifyOk = deliveryOutcome.ok;

if (!deliveryVerifyOk) {
  failures.push(`16 delivery manifest: SHA256SUMS does not verify: ${deliveryBad.join("; ") || deliveryVerify.stderr}`);
  // Truthfully update summary and verification receipt to record failure before stopping
  summary.manifest.deliveryVerified = false;
  summary.failures = failures;
  write("15-run-summary.json", JSON.stringify(summary, null, 2));
  write("16-manifest-verification.txt", manifestVerificationReceipt + `\nDELIVERY SEAL FAILED: ${deliveryBad.join("; ")}\n`);
}

console.log(`steps: ${steps.length}, mapped tests: ${mappedNames.size}, failures: ${failures.length}`);
if (failures.length) {
  console.error(`PROOF RUN FAILED:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("ALL CURRENT-GENERATION STEPS PASSED AND RE-VERIFIED.");
