/**
 * Her Flight Deck - Remaining Corrections Proof Runner (M4-R5–R8)
 *
 * Runs all proof suites, database lifecycle tests, sensitivity mutants,
 * and rereview diagnostics, validating exact counts, exits, and generating receipts.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const packDir = path.resolve("docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11");
const rereviewDir = path.resolve("docs/evidence/m4-document-navigation-scope-rereview-2026-10-11");
const receiptsDir = path.join(packDir, "receipts");

if (!fs.existsSync(receiptsDir)) {
  fs.mkdirSync(receiptsDir, { recursive: true });
}

console.log("=== 1. Running Corrected Proof Suite (Expect: 10 pass) ===");
const proofRes = spawnSync("node", ["--test", path.join(packDir, "proof/proof.test.mjs")], { encoding: "utf-8" });
console.log(proofRes.stdout);
if (proofRes.status !== 0) {
  console.error("FAIL: proof.test.mjs exited with code", proofRes.status);
  console.error(proofRes.stderr);
  process.exit(proofRes.status ?? 1);
}
if (!proofRes.stdout.includes("pass 10") || !proofRes.stdout.includes("fail 0")) {
  console.error("FAIL: Expected exactly 10 passing tests in proof.test.mjs");
  process.exit(1);
}

console.log("=== 2. Running File-Backed SQLite Database Lifecycle Tests (Expect: 7 pass) ===");
const dbRes = spawnSync("node", ["--test", path.join(packDir, "proof/databaseLifecycle.test.mjs")], { encoding: "utf-8" });
console.log(dbRes.stdout);
if (dbRes.status !== 0) {
  console.error("FAIL: databaseLifecycle.test.mjs exited with code", dbRes.status);
  console.error(dbRes.stderr);
  process.exit(dbRes.status ?? 1);
}
if (!dbRes.stdout.includes("pass 7") || !dbRes.stdout.includes("fail 0")) {
  console.error("FAIL: Expected exactly 7 passing tests in databaseLifecycle.test.mjs");
  process.exit(1);
}

console.log("=== 3. Running Sensitivity Mutants Test Suite (Expect: 5 pass) ===");
const mutRes = spawnSync("node", ["--test", path.join(packDir, "proof/sensitivity.test.mjs")], { encoding: "utf-8" });
console.log(mutRes.stdout);
if (mutRes.status !== 0) {
  console.error("FAIL: sensitivity.test.mjs exited with code", mutRes.status);
  console.error(mutRes.stderr);
  process.exit(mutRes.status ?? 1);
}
if (!mutRes.stdout.includes("pass 5") || !mutRes.stdout.includes("fail 0")) {
  console.error("FAIL: Expected exactly 5 passing tests in sensitivity.test.mjs");
  process.exit(1);
}

console.log("=== 4. Reproducing Frozen Rereview Diagnostics (Expect: 13 fail, 2 pass, exit 1) ===");
const diagRes = spawnSync("node", ["--test", "diagnostics.test.mjs"], { cwd: rereviewDir, encoding: "utf-8" });
console.log(`Diagnostic exit code: ${diagRes.status} (expected 1)`);
if (diagRes.status !== 1) {
  console.error("FAIL: Expected diagnostics.test.mjs to exit with 1, got", diagRes.status);
  process.exit(1);
}
if (!diagRes.stdout.includes("pass 2") || !diagRes.stdout.includes("fail 13")) {
  console.error("FAIL: Expected 13 fail, 2 pass in diagnostics.test.mjs");
  process.exit(1);
}

console.log("=== 5. Running Frozen Current Controls (Expect: 10 pass, exit 0) ===");
const curRes = spawnSync("node", ["--test", "frozen-current.test.mjs"], { cwd: rereviewDir, encoding: "utf-8" });
console.log(`Frozen current exit code: ${curRes.status} (expected 0)`);
if (curRes.status !== 0) {
  console.error("FAIL: Expected frozen-current.test.mjs to exit with 0, got", curRes.status);
  process.exit(1);
}
if (!curRes.stdout.includes("pass 10") || !curRes.stdout.includes("fail 0")) {
  console.error("FAIL: Expected 10 pass in frozen-current.test.mjs");
  process.exit(1);
}

// Write combined proof receipt
const proofReceipt = [
  "=== M4 Remaining Corrections Proof Execution Receipt ===",
  `Timestamp: ${new Date().toISOString()}`,
  `Command: node docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/scripts/run_remaining_proof.mjs`,
  `Suite 1 (proof.test.mjs): Exit 0, 10 passed`,
  `Suite 2 (databaseLifecycle.test.mjs): Exit 0, 7 passed`,
  `Suite 3 (sensitivity.test.mjs): Exit 0, 5 passed`,
  "\n--- 1. Proof Suite Output ---",
  proofRes.stdout.trimEnd(),
  "\n--- 2. Database Lifecycle Output ---",
  dbRes.stdout.trimEnd(),
  "\n--- 3. Sensitivity Mutants Output ---",
  mutRes.stdout.trimEnd(),
].join("\n");
fs.writeFileSync(path.join(receiptsDir, "03-proof-suite.txt"), proofReceipt + "\n");

// Write diagnostics reproduction receipt
const diagReceipt = [
  "=== Rereview Diagnostics & Frozen Current Execution Receipt ===",
  `Timestamp: ${new Date().toISOString()}`,
  `Command 1: node --test diagnostics.test.mjs (in rereview pack)`,
  `Exit Code: ${diagRes.status} (expected 1: 13 failed, 2 passed controls)`,
  `Command 2: node --test frozen-current.test.mjs (in rereview pack)`,
  `Exit Code: ${curRes.status} (expected 0: 10 passed)`,
  "\n--- Diagnostics Output (13 fail / 2 pass) ---",
  diagRes.stdout.trimEnd(),
  "\n--- Frozen Current Output (10 pass) ---",
  curRes.stdout.trimEnd(),
].join("\n");
fs.writeFileSync(path.join(receiptsDir, "05-diagnostics.txt"), diagReceipt + "\n");

console.log("All suites executed and verified with expected counts and exits.");
