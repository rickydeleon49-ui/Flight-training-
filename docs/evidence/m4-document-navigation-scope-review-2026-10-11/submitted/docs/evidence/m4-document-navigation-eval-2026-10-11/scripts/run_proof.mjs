/**
 * Standalone runner for M4 disposable proof suite.
 * Runs with Node's native test runner, writes execution receipt.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const scriptDir = path.resolve("docs/evidence/m4-document-navigation-eval-2026-10-11");
const testFile = path.join(scriptDir, "proof/proof.test.mjs");
const receiptPath = path.join(scriptDir, "receipts/03-proof-suite.txt");

console.log(`Executing M4 Disposable Proof: ${testFile}`);

const res = spawnSync("node", ["--test", testFile], {
  encoding: "utf-8",
  env: process.env,
});

const output = [
  `=== M4 Disposable Proof Execution Receipt ===`,
  `Timestamp: ${new Date().toISOString()}`,
  `Command: node --test docs/evidence/m4-document-navigation-eval-2026-10-11/proof/proof.test.mjs`,
  `Exit Code: ${res.status}`,
  `--- Standard Output ---`,
  res.stdout,
  res.stderr ? `--- Standard Error ---\n${res.stderr}` : "",
].filter(Boolean).join("\n");

fs.writeFileSync(receiptPath, output);
console.log(res.stdout);
if (res.stderr) console.error(res.stderr);

if (res.status !== 0) {
  console.error(`Proof suite failed with exit code ${res.status}`);
  process.exit(res.status ?? 1);
}

console.log(`Proof completed successfully. Receipt written to ${receiptPath}`);
