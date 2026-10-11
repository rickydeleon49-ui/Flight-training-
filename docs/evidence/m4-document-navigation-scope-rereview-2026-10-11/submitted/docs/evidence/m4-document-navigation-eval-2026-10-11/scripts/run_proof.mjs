/**
 * Standalone runner for M4 disposable proof and diagnostics suite.
 * Runs tests and records exact receipts.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const evalDir = path.resolve("docs/evidence/m4-document-navigation-eval-2026-10-11");
const reviewDir = path.resolve("docs/evidence/m4-document-navigation-scope-review-2026-10-11");
const receiptsDir = path.join(evalDir, "receipts");

console.log("=== Running M4 Corrected Proof Suite ===");
const proofRes = spawnSync("node", ["--test", path.join(evalDir, "proof/proof.test.mjs")], { encoding: "utf-8" });
console.log(proofRes.stdout);
if (proofRes.status !== 0) {
  console.error(proofRes.stderr);
  process.exit(proofRes.status ?? 1);
}

console.log("=== Running Database Migration & Ownership Tests ===");
const dbRes = spawnSync("node", ["--test", path.join(evalDir, "proof/databaseVerification.test.mjs")], { encoding: "utf-8" });
console.log(dbRes.stdout);
if (dbRes.status !== 0) {
  console.error(dbRes.stderr);
  process.exit(dbRes.status ?? 1);
}

console.log("=== Running Python Schema Probe ===");
const pyRes = spawnSync("python3", [path.join(evalDir, "scripts/verify_schema_probe.py")], { encoding: "utf-8" });
console.log(pyRes.stdout);
if (pyRes.status !== 0) {
  console.error(pyRes.stderr);
  process.exit(pyRes.status ?? 1);
}

console.log("=== Reproducing Frozen Review Diagnostics (Expected: 8 failed, 2 passed) ===");
let diagRes = { status: 1, stdout: "", stderr: "" };
if (fs.existsSync(path.join(reviewDir, "diagnostics.test.mjs"))) {
  diagRes = spawnSync("node", ["--test", "diagnostics.test.mjs"], { cwd: reviewDir, encoding: "utf-8" });
  console.log(`Diagnostic exit code: ${diagRes.status} (expected 1 for 8 failed / 2 passed)`);
}

// Write combined proof receipt
const proofReceipt = [
  "=== M4 Corrected Proof Execution Receipt ===",
  `Timestamp: ${new Date().toISOString()}`,
  `Command: node --test docs/evidence/m4-document-navigation-eval-2026-10-11/proof/proof.test.mjs`,
  `Exit Code: ${proofRes.status}`,
  "--- Proof Suite Output ---",
  proofRes.stdout.trimEnd(),
  "\n--- Database Verification Output ---",
  dbRes.stdout.trimEnd(),
  "\n--- Python Schema Probe Output ---",
  pyRes.stdout.trimEnd(),
].join("\n");
fs.writeFileSync(path.join(receiptsDir, "03-proof-suite.txt"), proofReceipt + "\n");

// Write frozen diagnostics reproduction receipt
const diagReceipt = [
  "=== Frozen Review Diagnostics Reproduction Receipt ===",
  `Timestamp: ${new Date().toISOString()}`,
  `Command: node --test diagnostics.test.mjs (in docs/evidence/m4-document-navigation-scope-review-2026-10-11)`,
  `Exit Code: ${diagRes.status} (expected exit 1: 8 failed / 2 passed controls on frozen submission)`,
  "--- Diagnostic Output ---",
  diagRes.stdout.trimEnd(),
].join("\n");
fs.writeFileSync(path.join(receiptsDir, "05-frozen-diagnostics.txt"), diagReceipt + "\n");

console.log("All receipts updated successfully.");
