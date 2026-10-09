// Real Mutation Sensitivity Verification Runner for M2 Split Lineage (SL-R12 / SL-R13)
// Executes 14 distinct mutations inside an isolated temporary directory without modifying evidence files in-place.
// Supports explicit output directory passed via argv[2] (never writes into a sealed pack).
// Uses pinned --test-reporter=tap so output parsing is environment-independent.
// Matches on failing test name and specific assertion message.
// Reports actual killed count and exits 1 on any miss.

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

console.log("=== Real Mutation Sensitivity Verification (Round 5) ===");
console.log(`Explicit Output Directory: ${explicitOutDir}`);
console.log(`Original lineageContract.mjs SHA256: ${baselineContractSha}`);
console.log(`Original candidate_migration_0013.sql SHA256: ${baselineDdlSha}`);

// Create isolated temporary workspace
const tempSandbox = mkdtempSync(join(tmpdir(), "m2-slr12-13-mutations-"));
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
    expectedTestSubstring: "Contract 3: Nested Range Composition",
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
    expectedTestSubstring: "Contract 2: Page Translation Maps Child Position",
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
    expectedTestSubstring: "Contract 5: Structural Tiers and Strict DDL CHECK Constraints",
    expectedFailureSubstring: "Fractional physical page bounds must fail TYPEOF constraint",
    apply: (content) => {
      return content.replaceAll(/TYPEOF\([^)]+\) = 'integer' AND /g, "");
    },
  },
  {
    name: "MUTANT-4-SELF-CYCLE",
    target: "candidateDdl",
    description: "Removal of CHECK (material_id != parent_material_id) constraint in candidate DDL",
    expectedTestSubstring: "Contract 5: Structural Tiers and Strict DDL CHECK Constraints",
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
    expectedTestSubstring: "Contract 8: Legacy NULL Parent Hash is Handled as Unknown",
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
    expectedTestSubstring: "Contract 9: Unknown Parent Editions Are Not Grouped as Siblings",
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
    expectedTestSubstring: "Contract 18: Idempotent Resubmission, Reconciliation, and Real Cancellation",
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
    expectedTestSubstring: "Contract 18: Idempotent Resubmission, Reconciliation, and Real Cancellation",
    expectedFailureSubstring: "Expected values to be strictly equal",
    apply: (content) => {
      const target = "if (row.status === \"committed\") {\n    return { operationId, status: \"committed\", cancelled: false, removedFiles: [] };\n  }";
      if (!content.includes(target)) throw new Error("Target string for Mutant 8 not found");
      return content.replace(target, "// mutant: allow cancelling committed batch");
    },
  },
  {
    name: "MUTANT-9-RECEIPTLESS-SAVE-RESTORED",
    target: "lineageContract",
    description: "Receipt-less save restored (bypassing mandatory receipt validation; successor to Round 3 optional gate) (SL-R10.1)",
    expectedTestSubstring: "Contract 11: Atomic Batch Save Binds to Authoritative Receipt",
    expectedFailureSubstring: "Receipt-less save must throw mandatory receipt error",
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
    description: "Receipt canonical hash verification skipped against operation log (successor to Round 3 caller-hash precedence, which is now structurally impossible) (SL-R10.2)",
    expectedTestSubstring: "Contract 11: Atomic Batch Save Binds to Authoritative Receipt",
    expectedFailureSubstring: "Tampered receipt must be refused by hash check",
    apply: (content) => {
      const target = "if (!opRow || opRow.receipt_hash !== computedHash || opRow.source_material_id !== receipt.sourceMaterialId) {\n      invokeCleanup();\n      throw new Error(\"Receipt hash mismatch or unrecorded receipt: receipt has been tampered with or not issued by split engine\");\n    }";
      if (!content.includes(target)) throw new Error("Target string for Mutant 10 not found");
      return content.replace(target, "// mutant: skipped receipt hash verification");
    },
  },
  {
    name: "MUTANT-11-SNAPSHOT-COMPARISON-REMOVED",
    target: "lineageContract",
    description: "Parent lineage snapshot comparison inside BEGIN IMMEDIATE removed (SL-R10.4)",
    expectedTestSubstring: "Contract 11: Atomic Batch Save Binds to Authoritative Receipt",
    expectedFailureSubstring: "Parent lineage snapshot drift must be refused",
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
    expectedTestSubstring: "Contract 13: Shipped Migrations 0001–0012 Faithful Schema Baseline",
    expectedFailureSubstring: "split_operation_log must not exist in shipped migrations 0001–0012",
    apply: (content) => {
      const target = "if (applyMigration0013) {";
      const mutant = "db.exec(`CREATE TABLE IF NOT EXISTS split_operation_log (operation_id TEXT PRIMARY KEY, source_material_id TEXT, receipt_canonical_json TEXT NOT NULL, receipt_hash TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);\n  if (applyMigration0013) {";
      if (!content.includes(target)) throw new Error("Target string for Mutant 12 not found");
      return content.replace(target, mutant);
    },
  },
  {
    name: "MUTANT-13-PARENT-TIER-MISLABEL",
    target: "lineageContract",
    description: "Nested part records root title/file_name in parent tier instead of immediate parent (SL-R12.1)",
    expectedTestSubstring: "Contract 11: Atomic Batch Save Binds to Authoritative Receipt",
    expectedFailureSubstring: "Nested parent tier must record immediate parent title and file name",
    apply: (content) => {
      const target = "const parentFile = receipt.isNested ? (receipt.parentSnapshot.parentFileName || basename(receipt.sourceFilePath)) : null;\n        const parentTitle = receipt.isNested ? (receipt.parentSnapshot.parentTitle || null) : null;";
      const mutant = "const parentFile = receipt.isNested ? receipt.rootFileName : null;\n        const parentTitle = receipt.isNested ? receipt.rootTitle : null;";
      if (!content.includes(target)) throw new Error("Target string for Mutant 13 not found");
      return content.replace(target, mutant);
    },
  },
  {
    name: "MUTANT-14-REISSUE-RESETS-OPERATION",
    target: "lineageContract",
    description: "Re-issuing identical receipt resets committed operation to pending via INSERT OR REPLACE (SL-R12.2)",
    expectedTestSubstring: "Contract 18: Idempotent Resubmission, Reconciliation, and Real Cancellation",
    expectedFailureSubstring: "Re-issuing receipt must not reset committed operation status",
    apply: (content) => {
      const target = "const existingOp = db.prepare(\"SELECT status FROM split_operation_log WHERE operation_id = ?\").get(operationId);\n  if (!existingOp) {\n    db.prepare(`\n      INSERT INTO split_operation_log (\n        operation_id, source_material_id, receipt_canonical_json, receipt_hash, status, created_at, updated_at\n      ) VALUES (?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))\n    `).run(operationId, sourceMaterialId, canonicalReceiptJson, receiptHash);\n  }";
      const mutant = "db.prepare(`\n    INSERT OR REPLACE INTO split_operation_log (\n      operation_id, source_material_id, receipt_canonical_json, receipt_hash, status, created_at, updated_at\n    ) VALUES (?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))\n  `).run(operationId, sourceMaterialId, canonicalReceiptJson, receiptHash);";
      if (!content.includes(target)) throw new Error("Target string for Mutant 14 not found");
      return content.replace(target, mutant);
    },
  },
];

let allPassed = true;
let killedCount = 0;
const summaryLines = [];
summaryLines.push("=== Real Mutation Sensitivity Verification (Round 5) ===");
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

  // Run tests in temp directory with pinned TAP test reporter
  const run = spawnSync("node", ["--test", "--test-reporter=tap", "proof.test.mjs"], {
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
    `Expected Test Substring: "${m.expectedTestSubstring}"`,
    `Expected Failure Substring: "${m.expectedFailureSubstring}"`,
    "",
    "=== Raw TAP Test Execution Output ===",
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

  // Parse TAP output to verify failing test name and failure message
  const hasTestName = fullOutput.includes(m.expectedTestSubstring);
  const hasErrorMessage = fullOutput.includes(m.expectedFailureSubstring);

  if (exitCode === 0) {
    console.error(`FAILURE: ${m.name} was NOT caught! Test suite exited 0.`);
    allPassed = false;
    summaryLines.push(`FAILED: ${m.name} (exit code 0 - mutant survived)`);
  } else if (!hasTestName || !hasErrorMessage) {
    console.error(`FAILURE: ${m.name} failed with exit ${exitCode}, but failed matching requirements:`);
    if (!hasTestName) console.error(`  Missing test substring: "${m.expectedTestSubstring}"`);
    if (!hasErrorMessage) console.error(`  Missing failure substring: "${m.expectedFailureSubstring}"`);
    allPassed = false;
    summaryLines.push(`FAILED: ${m.name} (mismatch: hasTestName=${hasTestName}, hasErrorMessage=${hasErrorMessage})`);
  } else {
    killedCount++;
    console.log(`SUCCESS: ${m.name} caught as expected! Exit code: ${exitCode}`);
    console.log(`Matched test: "${m.expectedTestSubstring}"`);
    console.log(`Matched failure message: "${m.expectedFailureSubstring}"`);
    console.log("Restoration confirmed exact SHA-256 match.");
    summaryLines.push(`SUCCESS: ${m.name} caught as expected (Exit ${exitCode}, test="${m.expectedTestSubstring}", message="${m.expectedFailureSubstring}")`);
  }
}

// Clean up sandbox
rmSync(tempSandbox, { recursive: true, force: true });

summaryLines.push(`\n=== Summary: ${killedCount}/${mutants.length} mutations successfully caught and verified ===`);
summaryLines.push("All source files preserved byte-for-byte; temporary mutation sandbox removed.");

const summaryText = summaryLines.join("\n");
writeFileSync(join(explicitOutDir, "mutation-checks.txt"), summaryText + "\n");
writeFileSync(join(explicitOutDir, "mutation-checks.exit"), `${allPassed ? 0 : 1}\n`);

console.log("\n" + summaryText);

if (!allPassed || killedCount !== mutants.length) {
  process.exit(1);
}
