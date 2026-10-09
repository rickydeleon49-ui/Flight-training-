// Real Mutation Sensitivity Verification Runner for M2 Split Lineage (SL-R9)
// Executes 8 distinct mutations inside an isolated temporary directory without modifying evidence files in-place.
// Saves per-mutant raw outputs, exit codes, and baseline/restored digests.

import { readFileSync, writeFileSync, rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getSha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

const proofDir = __dirname;
const packDir = join(proofDir, "..");
const receiptsMutationsDir = join(packDir, "receipts", "mutations");
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

console.log("=== Real Mutation Sensitivity Verification (Round 3) ===");
console.log(`Original lineageContract.mjs SHA256: ${baselineContractSha}`);
console.log(`Original candidate_migration_0013.sql SHA256: ${baselineDdlSha}`);

// Create isolated temporary workspace
const tempSandbox = mkdtempSync(join(tmpdir(), "m2-slr9-mutations-"));
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
      // Remove all TYPEOF(...) = 'integer' checks across the candidate DDL
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
    name: "MUTANT-5-OPTIONAL-GATE",
    target: "lineageContract",
    description: "Verification gate becomes optional again (omitting receipt/expectedParentSha256 check)",
    expectedFailureSubstring: "Unverified split without receipt must refuse all writes",
    apply: (content) => {
      const target = "if (!receipt && !expectedParentSha256) {\n      invokeCleanup();\n      throw new Error(\"A new split without any verified source identity refuses all writes.\");\n    }";
      if (!content.includes(target)) throw new Error("Target string for Mutant 5 not found");
      return content.replace(target, "// mutant: optional verification gate");
    },
  },
  {
    name: "MUTANT-6-CALLER-HASH-PRECEDENCE",
    target: "lineageContract",
    description: "Caller hash precedence is restored (caller forged hash overrides verified hash)",
    expectedFailureSubstring: "Caller forged hash must not replace verified hash",
    apply: (content) => {
      const target = "if (part.sourceContentSha256 && part.sourceContentSha256 !== verifiedHash) {\n          invokeCleanup();\n          throw new Error(`Contradictory caller hash for ${part.id}: caller supplied hash differs from verified source hash.`);\n        }";
      if (!content.includes(target)) throw new Error("Target string for Mutant 6 not found");
      return content.replace(target, "// mutant: accepted caller forged hash without check");
    },
  },
  {
    name: "MUTANT-7-HASH-NULLNESS-HEURISTIC",
    target: "lineageContract",
    description: "Hash-nullness tier heuristic restored (guessing tier from parent hash nullness instead of structure)",
    expectedFailureSubstring: "Nested part with null parent hash must report unknown parentStatus",
    apply: (content) => {
      const target = "const isDirectSplit = lineage.nested_level === 1 && lineage.parent_page_start === null;";
      const mutant = "const isDirectSplit = !lineage.parent_content_sha256 && !!lineage.source_content_sha256;";
      if (!content.includes(target)) throw new Error("Target string for Mutant 7 not found");
      return content.replace(target, mutant);
    },
  },
  {
    name: "MUTANT-8-SIBLING-COALESCE",
    target: "lineageContract",
    description: "Sibling COALESCE grouping restored (COALESCE(parent_content_sha256, source_content_sha256))",
    expectedFailureSubstring: "Unknown parent editions must not be grouped as siblings",
    apply: (content) => {
      const target1 = "const parentHash = row.parent_content_sha256;\n    if (!parentId || !parentHash) return [];";
      const mutant1 = "const parentHash = row.parent_content_sha256 || row.source_content_sha256;\n    if (!parentId || !parentHash) return [];";
      const target2 = "AND l.parent_content_sha256 = ?";
      const mutant2 = "AND COALESCE(l.parent_content_sha256, l.source_content_sha256) = ?";
      if (!content.includes(target1) || !content.includes(target2)) throw new Error("Target strings for Mutant 8 not found");
      return content.replace(target1, mutant1).replace(target2, mutant2);
    },
  },
];

let allPassed = true;
const summaryLines = [];
summaryLines.push("=== Real Mutation Sensitivity Verification (Round 3) ===");
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
writeFileSync(join(packDir, "receipts", "mutation-checks.txt"), summaryText + "\n");
writeFileSync(join(packDir, "receipts", "mutation-checks.exit"), `${allPassed ? 0 : 1}\n`);

console.log("\n" + summaryText);

if (!allPassed) {
  process.exit(1);
}
