import { readFileSync, writeFileSync, copyFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scratchDir = join(__dirname, "../scratch");
if (!existsSync(scratchDir)) {
  mkdirSync(scratchDir, { recursive: true });
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

const contractPath = join(__dirname, "lineageContract.mjs");
const ddlPath = join(__dirname, "../candidate_migration_0013.sql");
const testPath = join(__dirname, "proof.test.mjs");

const origContractContent = readFileSync(contractPath, "utf8");
const origDdlContent = readFileSync(ddlPath, "utf8");

const origContractHash = sha256(contractPath);
const origDdlHash = sha256(ddlPath);

console.log("=== Real Mutation Sensitivity Verification ===");
console.log(`Original lineageContract.mjs SHA256: ${origContractHash}`);
console.log(`Original candidate_migration_0013.sql SHA256: ${origDdlHash}\n`);

let passedMutantChecks = 0;

const mutations = [
  {
    id: "MUTANT-1",
    name: "Off-by-one arithmetic in composeNestedRanges (omitting - 1)",
    file: contractPath,
    target: "parentRange.sourcePageStart + childSelection.firstPage - 1",
    replacement: "parentRange.sourcePageStart + childSelection.firstPage",
    expectedFailureSnippet: "Composed R start",
  },
  {
    id: "MUTANT-2",
    name: "Removal of child length upper-bound enforcement in mapChildPageToSource",
    file: contractPath,
    target: 'if (childLength !== null && childPage > childLength) {\n    throw new Error(`Child page ${childPage} exceeds child length ${childLength}.`);\n  }',
    replacement: "/* removed upper bound check */",
    expectedFailureSnippet: "Missing expected exception",
  },
  {
    id: "MUTANT-3",
    name: "Removal of TYPEOF integer checks across candidate DDL (reverting to loose SQLite affinity)",
    file: ddlPath,
    mutate: (content) => content.replaceAll(/TYPEOF\([^)]+\) = 'integer' AND /g, ""),
    expectedFailureSnippet: "Missing expected exception",
  },
  {
    id: "MUTANT-4",
    name: "Removal of CHECK (material_id != root_material_id) constraint in candidate DDL",
    file: ddlPath,
    target: "CHECK (material_id != root_material_id)",
    replacement: "CHECK (1 = 1) /* removed self-root constraint */",
    expectedFailureSnippet: "Missing expected exception",
  },
];

for (const m of mutations) {
  console.log(`--- Testing ${m.id}: ${m.name} ---`);
  const content = readFileSync(m.file, "utf8");
  let mutated = "";
  if (typeof m.mutate === "function") {
    mutated = m.mutate(content);
    if (mutated === content) {
      console.error(`ERROR: Mutation function for ${m.id} made no changes in ${m.file}!`);
      process.exit(1);
    }
  } else {
    if (!content.includes(m.target)) {
      console.error(`ERROR: Target snippet for ${m.id} not found in ${m.file}!`);
      process.exit(1);
    }
    mutated = content.replace(m.target, m.replacement);
  }

  // Apply mutation
  writeFileSync(m.file, mutated, "utf8");

  let exitCode = 0;
  let testOutput = "";
  try {
    testOutput = execSync(`node --test "${testPath}"`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    exitCode = 0;
  } catch (err) {
    exitCode = err.status ?? 1;
    testOutput = (err.stdout || "") + "\n" + (err.stderr || "");
  } finally {
    // Restore original file immediately
    writeFileSync(m.file, content, "utf8");
  }

  // Verify file restored
  const currentHash = sha256(m.file);
  const expectedHash = m.file === contractPath ? origContractHash : origDdlHash;
  if (currentHash !== expectedHash) {
    console.error(`CRITICAL: Restoration failed for ${m.file}! Hashes do not match.`);
    process.exit(1);
  }

  if (exitCode === 0) {
    console.error(`FAILURE: ${m.id} SURVIVED! Test suite unexpectedly passed (exit 0).`);
    process.exit(1);
  }

  if (!testOutput.includes(m.expectedFailureSnippet)) {
    console.error(`FAILURE: ${m.id} failed with unexpected error, missing "${m.expectedFailureSnippet}". Output:\n${testOutput}`);
    process.exit(1);
  }

  console.log(`SUCCESS: ${m.id} caught as expected! Exit code: ${exitCode}`);
  console.log(`Matched expected failure: "${m.expectedFailureSnippet}"`);
  console.log(`Restoration confirmed exact SHA-256 match.\n`);
  passedMutantChecks++;
}

// Final hash checks
const finalContractHash = sha256(contractPath);
const finalDdlHash = sha256(ddlPath);
assert.equal(finalContractHash, origContractHash, "Contract file final hash mismatch");
assert.equal(finalDdlHash, origDdlHash, "DDL file final hash mismatch");

console.log(`=== Summary: ${passedMutantChecks}/${mutations.length} mutations successfully caught and verified ===`);
console.log("All source files restored to exact baseline byte-for-byte.");
