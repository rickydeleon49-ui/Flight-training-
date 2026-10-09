import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

const contractPath = join(__dirname, "lineageContract.mjs");
const ddlPath = join(__dirname, "../candidate_migration_0013.sql");
const testPath = join(__dirname, "proof.test.mjs");

const origContractHash = sha256(contractPath);
const origDdlHash = sha256(ddlPath);

console.log("=== Real Mutation Sensitivity Verification (Isolated Scratch Workspace) ===");
console.log(`Original lineageContract.mjs SHA256: ${origContractHash}`);
console.log(`Original candidate_migration_0013.sql SHA256: ${origDdlHash}\n`);

// 1. Create isolated temporary workspace (SL-R6: never mutate evidence files in-place)
const tempWorkspace = mkdtempSync(join(tmpdir(), "m2-lineage-mutations-"));
const tempProofDir = join(tempWorkspace, "proof");
mkdirSync(tempProofDir, { recursive: true });
console.log(`Isolated temporary workspace: ${tempWorkspace}\n`);

const tempContractPath = join(tempProofDir, "lineageContract.mjs");
const tempDdlPath = join(tempWorkspace, "candidate_migration_0013.sql");
const tempTestPath = join(tempProofDir, "proof.test.mjs");
const tempPackageJson = join(tempProofDir, "package.json");

copyFileSync(contractPath, tempContractPath);
copyFileSync(ddlPath, tempDdlPath);
copyFileSync(testPath, tempTestPath);
if (existsSync(join(__dirname, "package.json"))) {
  copyFileSync(join(__dirname, "package.json"), tempPackageJson);
}

const shippedMigrationsDir = "/Users/rickymac/code/Flight-training-split-lineage-scope/src-tauri/migrations";

let passedMutantChecks = 0;

const mutations = [
  {
    id: "MUTANT-1",
    name: "Off-by-one arithmetic in composeNestedRanges (omitting - 1)",
    file: tempContractPath,
    origFile: contractPath,
    target: "parentRange.sourcePageStart + childSelection.firstPage - 1",
    replacement: "parentRange.sourcePageStart + childSelection.firstPage",
    expectedFailureSnippet: "120",
  },
  {
    id: "MUTANT-2",
    name: "Removal of child length upper-bound enforcement in mapChildPageToSource",
    file: tempContractPath,
    origFile: contractPath,
    target: 'if (childLength !== null && childPage > childLength) {\n    throw new Error(`Child page ${childPage} exceeds child length ${childLength}.`);\n  }',
    replacement: "/* removed upper bound check */",
    expectedFailureSnippet: "Missing expected exception",
  },
  {
    id: "MUTANT-3",
    name: "Removal of TYPEOF integer checks across candidate DDL (reverting to loose SQLite affinity)",
    file: tempDdlPath,
    origFile: ddlPath,
    mutate: (content) => content.replaceAll(/TYPEOF\([^)]+\) = 'integer' AND /g, ""),
    expectedFailureSnippet: "Missing expected exception",
  },
  {
    id: "MUTANT-4",
    name: "Removal of CHECK (material_id != root_material_id) constraint in candidate DDL",
    file: tempDdlPath,
    origFile: ddlPath,
    target: "CHECK (material_id != root_material_id)",
    replacement: "CHECK (1 = 1) /* removed self-root constraint */",
    expectedFailureSnippet: "Missing expected exception",
  },
];

try {
  for (const m of mutations) {
    console.log(`--- Testing ${m.id}: ${m.name} ---`);
    const cleanContent = readFileSync(m.origFile, "utf8");
    let mutated = "";
    if (typeof m.mutate === "function") {
      mutated = m.mutate(cleanContent);
      if (mutated === cleanContent) {
        console.error(`ERROR: Mutation function for ${m.id} made no changes!`);
        process.exit(1);
      }
    } else {
      if (!cleanContent.includes(m.target)) {
        console.error(`ERROR: Target snippet for ${m.id} not found in original file!`);
        process.exit(1);
      }
      mutated = cleanContent.replace(m.target, m.replacement);
    }

    // Apply mutation ONLY to isolated file in tempWorkspace
    writeFileSync(m.file, mutated, "utf8");

    let exitCode = 0;
    let testOutput = "";
    try {
      testOutput = execSync(`node --test "${tempTestPath}"`, {
        cwd: tempWorkspace,
        encoding: "utf8",
        env: {
          ...process.env,
          SHIPPED_MIGRATIONS_DIR: shippedMigrationsDir,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      exitCode = 0;
    } catch (err) {
      exitCode = err.status ?? 1;
      testOutput = (err.stdout || "") + "\n" + (err.stderr || "");
    } finally {
      // Restore clean copy in tempWorkspace
      copyFileSync(m.origFile, m.file);
    }

    // Verify temp file restored
    const restoredTempHash = sha256(m.file);
    const expectedHash = sha256(m.origFile);
    if (restoredTempHash !== expectedHash) {
      console.error(`CRITICAL: Restoration failed in temp workspace for ${m.file}!`);
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
    console.log(`Restoration confirmed exact SHA-256 match in temp workspace.\n`);
    passedMutantChecks++;
  }
} finally {
  // Clean up isolated scratch workspace
  if (existsSync(tempWorkspace)) {
    rmSync(tempWorkspace, { recursive: true, force: true });
    console.log(`Cleaned up temporary workspace: ${tempWorkspace}`);
  }
}

// Final verification: Assert that original files were NEVER modified
const finalContractHash = sha256(contractPath);
const finalDdlHash = sha256(ddlPath);
assert.equal(finalContractHash, origContractHash, "Original lineageContract.mjs must remain untouched");
assert.equal(finalDdlHash, origDdlHash, "Original candidate_migration_0013.sql must remain untouched");

console.log("\n=== All 4 Meaningful Mutations Caught and Verified ===");
console.log(`Passed checks: ${passedMutantChecks} / ${mutations.length}`);
console.log("Original evidence files confirmed 100% byte-for-byte immutable.");
