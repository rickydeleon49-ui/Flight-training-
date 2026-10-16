/**
 * Evidence checks shared by the proof runner and its permanent tests (M4-R31, M4-R32).
 *
 * Round 4 (Claude): these were inline in run_integration_proof.mjs, and the round-4 tests
 * re-implemented them inside the test file instead of calling them. The runner and the tests
 * now use these same functions, so a test failure means the runner's own logic is wrong.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

/**
 * Historical text is excluded only inside explicit markers (M4-R36):
 *   <!-- historical:begin --> … <!-- historical:end -->
 * The word "historical" on its own exempts nothing. An unterminated begin marker excludes nothing,
 * so a malformed block can never hide a current claim.
 */
export const HISTORICAL_BEGIN = "<!-- historical:begin -->";
export const HISTORICAL_END = "<!-- historical:end -->";
export function currentText(txt) {
  let out = "";
  let rest = txt;
  for (;;) {
    const begin = rest.indexOf(HISTORICAL_BEGIN);
    if (begin === -1) return out + rest;
    const end = rest.indexOf(HISTORICAL_END, begin + HISTORICAL_BEGIN.length);
    if (end === -1) return out + rest;
    out += rest.slice(0, begin);
    rest = rest.slice(end + HISTORICAL_END.length);
  }
}

/** Test names cited as `[M4-Rnn] …`, `[control] …` or `[sensitivity] …`. */
export function extractTests(txt) {
  const matches = currentText(txt).match(/\[(?:M4-R\d+|control|sensitivity)\][^\n`"|]+/g) ?? [];
  return [...new Set(matches.map((s) => s.trim()))];
}

/**
 * Mutant IDs cited as execution claims (M4-R36). Any standalone `M<number>_<NAME>` token counts,
 * whatever words its name contains. A token is not a claim only by syntax: when it is part of a
 * file name or path (joined to `/`, `-`, `.<letter>` or more name characters) or is environment
 * syntax (`$NAME`, `NAME=`). Sentence punctuation after a claim does not hide it.
 */
const MUTANT_TOKEN = /(?<![A-Za-z0-9_$\/.\-])M\d+_[A-Z0-9_]*[A-Z0-9](?![A-Za-z0-9_=\/\-]|\.[A-Za-z0-9])/g;
export function extractMutants(txt) {
  return [...new Set(currentText(txt).match(MUTANT_TOKEN) ?? [])];
}

/** Current counts claimed in prose, e.g. "68 mapped tests" or "16 executed mutants". */
export function extractClaimedCounts(txt) {
  const claims = [];
  for (const m of currentText(txt).matchAll(/\b(\d+)\s+mapped tests\b/g)) claims.push({ kind: "mappedTests", value: Number(m[1]), text: m[0] });
  for (const m of currentText(txt).matchAll(/\b(\d+)\s+(?:executed\s+)?mutants\b/g)) claims.push({ kind: "mutants", value: Number(m[1]), text: m[0] });
  return claims;
}

/**
 * Compare what the report/README claim with what actually ran.
 * @param {{texts: string[], executedTests: Set<string>, executedMutants: Set<string>, measured: {mappedTests: number, mutants: number}}} input
 */
export function validateTraceability({ texts, executedTests, executedMutants, measured }) {
  const joined = texts.join("\n");
  const citedTests = extractTests(joined);
  const citedMutants = extractMutants(joined);
  const unexecutedCitedTests = citedTests.filter((t) => !executedTests.has(t));
  const unexecutedCitedMutants = citedMutants.filter((m) => !executedMutants.has(m));
  const missingExecutedMutants = [...executedMutants].filter((m) => !citedMutants.includes(m));
  const staleCounts = extractClaimedCounts(joined).filter((c) => c.value !== measured[c.kind]);
  const noMutants = executedMutants.size === 0;
  return {
    ok:
      unexecutedCitedTests.length === 0 &&
      unexecutedCitedMutants.length === 0 &&
      missingExecutedMutants.length === 0 &&
      staleCounts.length === 0 &&
      !noMutants,
    citedTests,
    citedMutants,
    unexecutedCitedTests,
    unexecutedCitedMutants,
    missingExecutedMutants,
    staleCounts,
    noMutants,
  };
}

/** Run `shasum -a 256 -c <manifest>` in `dir` and report the measured outcome. */
export function verifyManifest(dir, manifestName) {
  const r = spawnSync("shasum", ["-a", "256", "-c", manifestName], { cwd: dir, encoding: "utf8" });
  const bad = (r.stdout || "").split("\n").filter((l) => /: (FAILED|WARNING)/.test(l));
  return { exit: r.status, bad, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ok: r.status === 0 && bad.length === 0 };
}

/** The RESULT line for a verification outcome. Success is only ever written for a measured success. */
export function verificationResult(outcome, passText) {
  return outcome.ok
    ? `RESULT: PASS - ${passText}`
    : `RESULT: FAILED - verification exited ${outcome.exit}${outcome.bad.length ? `: ${outcome.bad.join("; ")}` : ""}`;
}

/** The install audit for a live `npm ci` run, built from its real exit status. */
export function liveInstallAudit(record) {
  const ok = record.exit === 0;
  const text =
    `=== 01b scratch engine install audit ===\n` +
    `node: ${record.nodeVersion}  platform: ${record.platform}\n` +
    `mode: live-install (executed npm ci)\n` +
    `command: ${record.command}\n` +
    `cwd: ${record.cwd}\n` +
    `exit: ${record.exit}\n` +
    `signal: ${record.signal ?? "none"}\n` +
    (record.spawnError ? `spawn error: ${record.spawnError}\n` : "") +
    `installed package: ${record.installedPackage?.name}@${record.installedPackage?.version}\n` +
    `scratch-artifacts.json sha256: ${record.scratchArtifactsSha256}\n` +
    `RESULT: ${ok ? "PASS - pack-local scratch engine installed and verified" : record.signal ? `FAILED - npm ci was terminated by ${record.signal} (no exit status)` : `FAILED - npm ci exited ${record.exit}`}\n`;
  return { ok, text };
}

/** Outcome receipts that only a completed run may fill in. */
export const OUTCOME_RECEIPTS = ["15-run-summary.json", "16-manifest-verification.txt"];

/**
 * Mark the outcome receipts incomplete at the start of a run, so a run that stops part-way can
 * never leave an earlier run's success summary in place.
 */
export function markOutcomesIncomplete(receiptsDir, startedAt) {
  fs.mkdirSync(receiptsDir, { recursive: true });
  fs.writeFileSync(
    path.join(receiptsDir, "15-run-summary.json"),
    JSON.stringify({ status: "incomplete", startedAt, note: "This run has not finished. No outcome is claimed." }, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(receiptsDir, "16-manifest-verification.txt"),
    `=== 16 manifest verification ===\nRESULT: INCOMPLETE - run started at ${startedAt} and has not finished; no verification outcome is claimed\n`,
  );
}

// ---------------------------------------------------------------------------
// M4-R35: install execution records
// ---------------------------------------------------------------------------

/** Schema of the record a live engine install writes, and the only thing reuse accepts as proof that it ran. */
export const INSTALL_EXECUTION_SCHEMA = "hfd-m4-engine-install-execution/1";
/** Where that record lives, relative to the engine directory. */
export const INSTALL_EXECUTION_FILE = "install-execution.json";
/** The files a record binds: the manifests npm installed from and the bytes the proof executes. */
export const ENGINE_BOUND_FILES = [
  "package.json",
  "package-lock.json",
  "node_modules/pdfjs-dist/package.json",
  "node_modules/pdfjs-dist/legacy/build/pdf.mjs",
];

const sha256File = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

/** The exact install command for an engine directory given relative to the repository root. */
export function installCommandFor(engineRel) {
  return `npm ci --prefix ${engineRel} --no-audit --no-fund --ignore-scripts`;
}

/** Current SHA-256 of every bound file, or null for a file that is not there. */
export function engineBindings(engineDir) {
  const out = {};
  for (const rel of ENGINE_BOUND_FILES) {
    const p = path.join(engineDir, rel);
    out[rel] = fs.existsSync(p) ? sha256File(p) : null;
  }
  return out;
}

/** The record a live install writes, built only from what actually ran. */
export function buildInstallExecutionRecord({ command, cwd, nodeVersion, npmVersion, exit, signal, spawnError, stdout, stderr, startedAt, finishedAt, bindings }) {
  return {
    schema: INSTALL_EXECUTION_SCHEMA,
    command,
    cwd,
    nodeVersion,
    npmVersion,
    // M4-R39: exit and signal are recorded exactly as the child ended. A signalled child keeps
    // exit null; no numeric exit is invented for it.
    exit,
    signal: signal ?? null,
    spawnError: spawnError ?? null,
    startedAt,
    finishedAt,
    stdout,
    stderr,
    bindings,
  };
}

/** Read a record; a missing or unparsable file is reported, never treated as an empty record. */
export function readInstallExecution(file) {
  if (!fs.existsSync(file)) return { record: null, error: "missing" };
  try {
    return { record: JSON.parse(fs.readFileSync(file, "utf8")), error: null };
  } catch (err) {
    return { record: null, error: `malformed: ${err.message}` };
  }
}

/**
 * Whether a recorded install proves that the engine about to be reused was installed by a
 * successful run of the expected command in this checkout. This is separate from, and in addition
 * to, the byte-integrity check against scratch-artifacts.json.
 */
export function validateInstallExecution(read, { expectedCommand, expectedCwd, currentBindings }) {
  const problems = [];
  if (read.error) return { ok: false, problems: [`install execution record ${read.error}`] };
  const r = read.record;
  if (!r || typeof r !== "object" || Array.isArray(r)) return { ok: false, problems: ["install execution record is not an object"] };
  if (r.schema !== INSTALL_EXECUTION_SCHEMA) problems.push(`schema is ${JSON.stringify(r.schema)}, expected ${INSTALL_EXECUTION_SCHEMA}`);
  for (const field of ["command", "cwd", "nodeVersion", "npmVersion", "startedAt", "finishedAt"]) {
    if (typeof r[field] !== "string" || r[field].length === 0) problems.push(`${field} is missing`);
  }
  if (typeof r.stdout !== "string" || typeof r.stderr !== "string") problems.push("captured stdout/stderr are missing");
  if (r.exit !== 0) problems.push(`recorded install exit is ${JSON.stringify(r.exit)}, not 0`);
  if (r.signal !== undefined && r.signal !== null) problems.push(`recorded install was terminated by ${JSON.stringify(r.signal)}`);
  if (typeof r.command === "string" && r.command !== expectedCommand) problems.push(`recorded command ${JSON.stringify(r.command)} is not ${JSON.stringify(expectedCommand)}`);
  if (typeof r.cwd === "string" && r.cwd !== expectedCwd) problems.push(`recorded cwd ${JSON.stringify(r.cwd)} is not this checkout ${JSON.stringify(expectedCwd)}`);
  if (!r.bindings || typeof r.bindings !== "object") {
    problems.push("artifact bindings are missing");
  } else {
    for (const rel of ENGINE_BOUND_FILES) {
      const recorded = r.bindings[rel];
      const current = currentBindings[rel];
      if (typeof recorded !== "string" || !/^[0-9a-f]{64}$/.test(recorded)) problems.push(`binding for ${rel} is missing`);
      else if (current === null) problems.push(`${rel} is not present now`);
      else if (recorded !== current) problems.push(`${rel} has changed since the recorded install`);
    }
  }
  return { ok: problems.length === 0, problems };
}
