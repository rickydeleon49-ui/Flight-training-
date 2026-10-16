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

/** Lines that describe earlier, superseded claims. They are kept for honesty but never validated as current claims. */
const isHistoricalLine = (line) => /historical/i.test(line);
const currentText = (txt) => txt.split("\n").filter((l) => !isHistoricalLine(l)).join("\n");

/** Test names cited as `[M4-Rnn] …`, `[control] …` or `[sensitivity] …`. */
export function extractTests(txt) {
  const matches = currentText(txt).match(/\[(?:M4-R\d+|control|sensitivity)\][^\n`"|]+/g) ?? [];
  return [...new Set(matches.map((s) => s.trim()))];
}

/** Mutant IDs cited as `M<number>_<NAME>`, excluding document names that share the shape. */
export function extractMutants(txt) {
  const matches = currentText(txt).match(/`?(M\d+_[A-Z0-9_]+)`?/g) ?? [];
  return [
    ...new Set(
      matches
        .map((s) => s.replace(/`/g, "").trim())
        .filter((s) => !/DOCUMENT|ROUND|CONDITIONAL|VIEWER|NAVIGATION/.test(s)),
    ),
  ];
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
    `installed package: ${record.installedPackage?.name}@${record.installedPackage?.version}\n` +
    `scratch-artifacts.json sha256: ${record.scratchArtifactsSha256}\n` +
    `RESULT: ${ok ? "PASS - pack-local scratch engine installed and verified" : `FAILED - npm ci exited ${record.exit}`}\n`;
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
