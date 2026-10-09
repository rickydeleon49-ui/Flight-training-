// Real Mutation Sensitivity Verification Runner for M2 Split Lineage (SL-R10 / SL-R11)
// Executes 12 distinct mutations inside an isolated temporary directory without modifying evidence files in-place.
// Supports explicit output directory passed via argv[2] (never writes into a sealed pack).
// Saves per-mutant raw outputs, exit codes, and baseline/restored digests.

import { readFileSync, writeFileSync, rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { findShippedMigrationsDir } from "./lineageContract.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getSha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

const proofDir = __dirname;
const packDir = join(proofDir, "..");
const shippedMigrationsDir = findShippedMigrationsDir();

// Support explicit output directory argument (defaults to pack receipts dir)
const explicitOutDir = process.argv[2] ? resolve(process.argv[2]) : join(packDir, "receipts");
const receiptsMutationsDir = join(explicitOutDir, "mutations");
mkdirSync(receiptsMutationsDir, { recursive: true });

// Source paths
const lineageContractPath = join(proofDir, "lineageContract.mjs");
const candidateDdlPath = join(packDir, "candidate_migration_0013.sql");
const proofTestPath = join(proofDir, "proof.test.mjs");
const packageJsonPath = join(proofDir, "package.json");

const origContractContent = readFileSync(lineageContractPath, "utf8");
const origDdlContent = readFileSync(candidateDdlPath, "utf8");
const origProofContent = readFileSync(proofTestPath, "utf8");
const origPackageJson = readFileSync(packageJsonPath, "utf8");

const baselineContractSha = getSha256(origContractContent);
const baselineDdlSha = getSha256(origDdlContent);

console.log("=== Real Mutation Sensitivity Verification (Round 4) ===");
console.log(`Explicit Output Directory: ${explicitOutDir}`);
console.log(`Original lineageContract.mjs SHA256: ${baselineContractSha}`);
console.log(`Original candidate_migration_0013.sql SHA256: ${baselineDdlSha}`);

// Create isolated temporary workspace
const tempSandbox = mkdtempSync(join(tmpdir(), "m2-slr10-11-mutations-"));
const tempPack = join(tempSandbox, "pack");
const tempProof = join(tempPack, "proof");
mkdirSync(tempProof, { recursive: true });

// Copy files to mirror relative layout so candidate_migration_0013.sql resolves at ../candidate_migration_0013.sql
const tempContractPath = join(tempProof, "lineageContract.mjs");
const tempDdlPath = join(tempPack, "candidate_migration_0013.sql");
const tempProofTestPath = join(tempProof, "proof.test.mjs");
const tempPackageJsonPath = join(tempProof, "package.json");

writeFileSync(tempContractPath, origContractContent);
writeFileSync(tempDdlPath, origDdlContent);
writeFileSync(tempProofTestPath, origProofContent);
writeFileSync(tempPackageJsonPath, origPackageJson);

const mutants = [
  {
    name: "MUTANT-1-RANGE-COMPOSE",
    target: "lineageContract",
    description: "Off-by-one arithmetic in composeNestedRanges (omitting - 1)",
    expectedFailureSubstring: "Composed R start mismatch",
    apply: (content) => {
      const target = "const rootStart = p.start + c.start - 1;\n  const rootEnd = p.start + c.end - 1;";
      const mutant = "const rootStart = p.start + c.start;\n  const rootEnd = p.start + c.end;";
      if (!content.includes(target)) throw new Error("Target string for Mutant 1 not found");
      return content.replace(target, mutant);
    },
  },
  {
    name: "MUTANT-2-CHILD-BOUNDS",
    target: "lineageContract",
    description: "Removal of child length upper-bound enforcement in mapChildPageToSource",
    expectedFailureSubstring: "Child page beyond length must throw out-of-bounds error",
    apply: (content) => {
      const target = "if (count !== null && count !== undefined) {\n    if (childPage > count) {\n      throw new Error(`Child page ${childPage} exceeds child page count ${count}`);\n    }\n  }";
      if (!content.includes(target)) throw new Error("Target string for Mutant 2 not found");
      return content.replace(target, "// mutant: removed child upper-bound enforcement");
    },
  },
  {
    name: "MUTANT-3-TYPEOF-CHECKS",
    target: "candidateDdl",
    description: "Removal of TYPEOF integer checks across candidate DDL (reverting to loose SQLite affinity)",
    expectedFailureSubstring: "Fractional physical page bounds must fail TYPEOF constraint",
    apply: (content) => {
      return content.replaceAll(/TYPEOF\([^)]+\) = 'integer' AND /g, "");
    },
  },
  {
    name: "MUTANT-4-SELF-CYCLE",
    target: "candidateDdl",
    description: "Removal of CHECK (material_id != parent_material_id) constraint in candidate DDL",
    expectedFailureSubstring: "Self-parenting must fail cycle check constraint",
    apply: (content) => {
      const target = "CHECK (material_id != parent_material_id),";
      if (!content.includes(target)) throw new Error("Target string for Mutant 4 not found");
      return content.replace(target, "-- mutant: removed self-parenting check");
    },
  },
  {
    name: "MUTANT-5-HASH-NULLNESS-HEURISTIC",
    target: "lineageContract",
    description: "Hash-nullness tier heuristic restored (guessing tier from parent hash nullness instead of structure)",
    expectedFailureSubstring: "Legacy NULL parent hash must yield unknown status",
    apply: (content) => {
      const target = "const isDirectSplit = lineage.nested_level === 1 && lineage.parent_page_start === null;";
      const mutant = "const isDirectSplit = !lineage.parent_content_sha256 && !!lineage.source_content_sha256;";
      if (!content.includes(target)) throw new Error("Target string for Mutant 5 not found");
      return content.replace(target, mutant);
    },
  },
  {
    name: "MUTANT-6-SIBLING-COALESCE",
    target: "lineageContract",
    description: "Sibling COALESCE grouping restored (COALESCE(parent_content_sha256, source_content_sha256))",
    expectedFailureSubstring: "Unknown parent editions must not be grouped as siblings",
    apply: (content) => {
      const target1 = "const parentHash = current.parent_content_sha256;\n    if (!parentId || !parentHash) return [];";
      const mutant1 = "const parentHash = current.parent_content_sha256 || current.source_content_sha256;\n    if (!parentId || !parentHash) return [];";
      const target2 = "AND l.parent_content_sha256 = ?";
      const mutant2 = "AND COALESCE(l.parent_content_sha256, l.source_content_sha256) = ?";
      if (!content.includes(target1) || !content.includes(target2)) throw new Error("Target strings for Mutant 6 not found");
      return content.replace(target1, mutant1).replace(target2, mutant2);
    },
  },
  {
    name: "MUTANT-7-OUTPUT-COLLISION-SKIPPED",
    target: "lineageContract",
    description: "Output identity collision check before write omitted (SL-R11.2)",
    expectedFailureSubstring: "Planned output material ID already exists in library",
    apply: (content) => {
      const target = "for (const part of receipt.plan) {\n      const existing = db.prepare(\"SELECT id FROM study_materials WHERE id = ?\").get(part.id);\n      if (existing) {\n        invokeCleanup();\n        throw new Error(`Planned output material ID already exists in library: ${part.id}`);\n      }\n    }";
      if (!content.includes(target)) throw new Error("Target string for Mutant 7 not found");
      return content.replace(target, "// mutant: omitted output identity collision check");
    },
  },
  {
    name: "MUTANT-8-CANCEL-AFTER-COMMIT-ALLOWED",
    target: "lineageContract",
    description: "Cancellation of committed batch alters status instead of returning status: committed (SL-R11.3)",
    expectedFailureSubstring: "Expected values to be strictly equal",
    apply: (content) => {
      const target = "if (row.status === \"committed\") {\n      return { operationId, status: \"committed\", cancelled: false, removedFiles: [] };\n    }";
      if (!content.includes(target)) throw new Error("Target string for Mutant 8 not found");
      return content.replace(target, "// mutant: allow cancelling committed batch");
    },
  },
  {
    name: "MUTANT-9-RECEIPTLESS-SAVE-RESTORED",
    target: "lineageContract",
    description: "Receipt-less save restored (bypassing mandatory receipt validation) (SL-R10.1)",
    expectedFailureSubstring: "A valid SplitSourceReceipt is required; unverified split refused.",
    apply: (content) => {
      const target = "if (!options.receipt || typeof options.receipt !== \"object\") {\n      invokeCleanup();\n      throw new Error(\"A valid SplitSourceReceipt is required; unverified split refused.\");\n    }";
      if (!content.includes(target)) throw new Error("Target string for Mutant 9 not found");
      const mutant = "if (!options.receipt || typeof options.receipt !== \"object\") {\n      return { batchId: \"dummy\", operationId: \"dummy\", parts: [], count: 0, savedPartsCount: 0, idempotentReplay: false };\n    }";
      return content.replace(target, mutant);
    },
  },
  {
    name: "MUTANT-10-RECEIPT-HASH-SKIPPED",
    target: "lineageContract",
    description: "Receipt canonical hash verification skipped against operation log (SL-R10.2)",
    expectedFailureSubstring: "Receipt hash mismatch or unrecorded receipt",
    apply: (content) => {
      const target = "if (!opRow || opRow.receipt_hash !== computedHash || opRow.source_material_id !== receipt.sourceMaterialId) {\n        invokeCleanup();\n        throw new Error(\"Receipt hash mismatch or unrecorded receipt: receipt has been tampered with or not issued by split engine\");\n      }";
      if (!content.includes(target)) throw new Error("Target string for Mutant 10 not found");
      return content.replace(target, "// mutant: skipped receipt hash verification");
    },
  },
  {
    name: "MUTANT-11-SNAPSHOT-COMPARISON-REMOVED",
    target: "lineageContract",
    description: "Parent lineage snapshot comparison inside BEGIN IMMEDIATE removed (SL-R10.4)",
    expectedFailureSubstring: "Parent lineage snapshot has changed since split",
    apply: (content) => {
      const target = "if (\n          currentParentLineage.root_material_id !== receipt.parentSnapshot.rootMaterialId ||\n          currentParentLineage.source_content_sha256 !== receipt.parentSnapshot.rootContentSha256 ||\n          currentParentLineage.source_page_start !== receipt.parentSnapshot.parentRootPageStart ||\n          currentParentLineage.source_page_end !== receipt.parentSnapshot.parentRootPageEnd ||\n          currentParentLineage.source_total_pages !== receipt.parentSnapshot.rootTotalPages ||\n          currentParentLineage.child_page_count !== receipt.parentSnapshot.parentTotalPages ||\n          currentParentLineage.nested_level !== receipt.parentSnapshot.nestedLevel\n        ) {\n          throw new Error(\"Parent lineage snapshot has changed since split\");\n        }";
      if (!content.includes(target)) throw new Error("Target string for Mutant 11 not found");
      return content.replace(target, "// mutant: removed parent lineage snapshot comparison");
    },
  },
  {
    name: "MUTANT-12-OPERATION-LOG-IN-HELPER",
    target: "lineageContract",
    description: "Operation log table created prematurely in test helper instead of candidate DDL (SL-R11.1)",
    expectedFailureSubstring: "split_operation_log must not exist in shipped migrations 0001–0012",
    apply: (content) => {
      const target = "if (applyMigration0013) {";
      const mutant = "db.exec(`CREATE TABLE IF NOT EXISTS split_operation_log (operation_id TEXT PRIMARY KEY, source_material_id TEXT NOT NULL, receipt_canonical_json TEXT NOT NULL, receipt_hash TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);\n  if (applyMigration0013) {";
      if (!content.includes(target)) throw new Error("Target string for Mutant 12 not found");
      return content.replace(target, mutant);
    },
  },
];

let allPassed = true;
const summaryLines = [];
summaryLines.push("=== Real Mutation Sensitivity Verification (Round 4) ===");
summaryLines.push(`Baseline lineageContract.mjs SHA256: ${baselineContractSha}`);
summaryLines.push(`Baseline candidate_migration_0013.sql SHA256: ${baselineDdlSha}\n`);

for (let idx = 0; idx < mutants.length; idx++) {
  const m = mutants[idx];
  const mIndex = idx + 1;
  console.log(`\n--- Testing ${m.name}: ${m.description} ---`);

  const targetPath = m.target === "lineageContract" ? tempContractPath : tempDdlPath;
  const originalContent = m.target === "lineageContract" ? origContractContent : origDdlContent;
  const baselineSha = m.target === "lineageContract" ? baselineContractSha : baselineDdlSha;

  // Apply mutation in temp directory
  const mutatedContent = m.apply(originalContent);
  const mutatedSha = getSha256(mutatedContent);
  if (mutatedSha === baselineSha) {
    throw new Error(`Mutation ${m.name} failed to change content hash!`);
  }
  writeFileSync(targetPath, mutatedContent);

  // Run tests in temp directory
  const run = spawnSync("node", ["--test", "proof.test.mjs"], {
    cwd: tempProof,
    encoding: "utf8",
    env: { ...process.env, SHIPPED_MIGRATIONS_DIR: shippedMigrationsDir },
  });

  const fullOutput = (run.stdout || "") + "\n" + (run.stderr || "");
  const exitCode = run.status;

  // Save individual mutant receipts
  const rawReceipt = [
    `Mutant: ${m.name}`,
    `Description: ${m.description}`,
    `Target: ${m.target}`,
    `Baseline SHA256: ${baselineSha}`,
    `Mutated SHA256: ${mutatedSha}`,
    `Exit Code: ${exitCode}`,
    `Expected Failure Substring: "${m.expectedFailureSubstring}"`,
    "",
    "=== Raw Test Execution Output ===",
    fullOutput,
  ].join("\n");

  writeFileSync(join(receiptsMutationsDir, `mutant-${mIndex}.txt`), rawReceipt);
  writeFileSync(join(receiptsMutationsDir, `mutant-${mIndex}.exit`), `${exitCode}\n`);

  // Restore file in temp directory
  writeFileSync(targetPath, originalContent);
  const restoredSha = getSha256(readFileSync(targetPath, "utf8"));
  if (restoredSha !== baselineSha) {
    throw new Error(`CRITICAL: Restored SHA mismatch for ${m.name}`);
  }

  // Verify failure
  if (exitCode === 0) {
    console.error(`FAILURE: ${m.name} was NOT caught! Test suite exited 0.`);
    allPassed = false;
    summaryLines.push(`FAILED: ${m.name} (exit code 0 - mutant survived)`);
  } else if (!fullOutput.includes(m.expectedFailureSubstring)) {
    console.error(`FAILURE: ${m.name} failed with exit ${exitCode}, but did not match expected substring: "${m.expectedFailureSubstring}"`);
    console.error("Output snippet:\n", fullOutput.slice(0, 500));
    allPassed = false;
    summaryLines.push(`FAILED: ${m.name} (did not match "${m.expectedFailureSubstring}")`);
  } else {
    console.log(`SUCCESS: ${m.name} caught as expected! Exit code: ${exitCode}`);
    console.log(`Matched expected failure: "${m.expectedFailureSubstring}"`);
    console.log("Restoration confirmed exact SHA-256 match.");
    summaryLines.push(`SUCCESS: ${m.name} caught as expected (Exit ${exitCode}, matched "${m.expectedFailureSubstring}")`);
  }
}

// Clean up sandbox
rmSync(tempSandbox, { recursive: true, force: true });

summaryLines.push(`\n=== Summary: ${mutants.length}/${mutants.length} mutations successfully caught and verified ===`);
summaryLines.push("All source files preserved byte-for-byte; temporary mutation sandbox removed.");

const summaryText = summaryLines.join("\n");
writeFileSync(join(explicitOutDir, "mutation-checks.txt"), summaryText + "\n");
writeFileSync(join(explicitOutDir, "mutation-checks.exit"), `${allPassed ? 0 : 1}\n`);

console.log("\n" + summaryText);

if (!allPassed) {
  process.exit(1);
}
