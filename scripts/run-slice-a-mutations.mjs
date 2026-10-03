/**
 * Slice A Mutation Runner
 *
 * Reproducible mutation test runner for Her Flight Deck structured study-import Slice A.
 * Evaluates 22 architectural and privacy mutants against the studyPacket test suite.
 *
 * Requirements:
 * 1. Control run: proves zero failures on an unmodified scratch copy before running mutants.
 * 2. Complete scratch copies: includes src, package.json, package-lock.json, public notice,
 *    configs, and contract fixture evidence.
 * 3. Infrastructure failure distinction: syntax errors, crashes, missing reports, or
 *    unrelated notice failures are classified as infrastructure failures, not behavioral catches.
 * 4. Two-layer privacy defense preservation:
 *    - 19 mutants caught
 *    - 3 mutants neutralized (M10, M12a, M12b)
 * 5. Aggregate failure propagation: exits non-zero if any outcome is unexpected or on infrastructure failure.
 */

import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const P = "src/logic/studyPacket/";
const UPSTREAM_ECHO = [
  P + "schema.ts",
  'return rawError("unknown_field", path); // the unknown name itself is never returned',
  'return rawError("unknown_field", path, { field: key });',
];
const BOUNDARY_FIELD = [
  P + "diagnostics.ts",
  'if (typeof raw?.field === "string" && FIELD_ALLOWLIST.has(raw.field)) {',
  'if (typeof raw?.field === "string") {',
];

export const MUTANTS = [
  ["M1 forbidden property names accepted", "caught", [[P + "scan.ts", 'if (FORBIDDEN_KEYS.has(key)) stop("forbidden_property_name");', ""]]],
  ["M2 duplicate keys accepted (last wins)", "caught", [[P + "scan.ts", 'if (seen.has(key)) stop("duplicate_key", CONTRACT_FIELDS.has(key) ? { field: key } : {});', ""]]],
  ["M3 id uniqueness case-sensitive", "caught", [[P + "semantic.ts", "const folded = item.id.toLowerCase();", "const folded = item.id;"]]],
  ["M4 answer key case silently repaired", "caught", [[P + "semantic.ts", 'errors.push(rawError(folded ? "answer_key_case_mismatch" : "answer_key_not_in_choices", `${base}.correctChoiceId`));', 'if (!folded) errors.push(rawError("answer_key_not_in_choices", `${base}.correctChoiceId`));']]],
  ["M5 depth limit removed (objects)", "caught", [[P + "scan.ts", 'if (depth + 1 > LIMITS.depth) stop("depth_exceeded", { limit: LIMITS.depth });\n      i++;\n      const object', "i++;\n      const object"]]],
  ["M6 UTF-16 length instead of code points", "caught", [[P + "schema.ts", "const length = codePointLength(value);", "const length = value.length;"]]],
  ["M7 page claims mapped to sourcePage", "caught", [[P + "payload.ts", "flashcards: cards.map((card) => ({ front: card.front, back: card.back, sourcePage: null })),", "flashcards: cards.map((card) => ({ front: card.front, back: card.back, sourcePage: card.sourceRefs?.[0]?.page ?? null })),"]]],
  ["M8 unknown fields allowed", "caught", [[P + "schema.ts", "export const packetSchema = z.strictObject({", "export const packetSchema = z.looseObject({"]]],
  ["M9 credential check removed", "caught", [[P + "semantic.ts", 'if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value))) errors.push(rawError("credential_like_content", path));', ""]]],
  ["M10 errors echo input into the path", "neutralized", [[P + "schema.ts", "  const path = pathFromParts(issue.path);", '  const path = pathFromParts(issue.path) + (typeof issue.input === "string" ? " " + issue.input : "");']]],
  ["M11 control characters accepted", "caught", [[P + "scan.ts", 'if (hasInvalidCharacters(out)) stop("invalid_string_character");', ""]]],
  ["M12 diagnostic echo: unknown field name returned through an unchecked boundary", "caught", [UPSTREAM_ECHO, BOUNDARY_FIELD]],
  ["M12a boundary field allowlist removed only", "neutralized", [BOUNDARY_FIELD]],
  ["M12b unknown field name returned upstream only", "neutralized", [UPSTREAM_ECHO]],
  ["M12c path echo: identifier-shaped keys kept in paths, boundary path checks removed", "caught", [
    [P + "diagnostics.ts", 'else if (typeof part === "string" && CONTRACT_FIELDS.has(part)) out += `.${part}`;', 'else if (typeof part === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(part)) out += `.${part}`;'],
    [P + "diagnostics.ts", 'CONTRACT_FIELDS.has(name) || name === "<field>" ? match : ".<field>",', "match,"],
    [P + "diagnostics.ts", 'path: PATH_GRAMMAR.test(redacted) ? redacted : "$",', "path: redacted,"]]],
  ["M12d duplicate IDs returned: raw id added and passed by the boundary", "caught", [
    [P + "semantic.ts", "{ index, firstIndex: first }", "{ index, firstIndex: first, id: item.id }"],
    [P + "diagnostics.ts", "  return out;\n}\n\n/** A failure result", '  if (raw && "id" in raw) out.id = raw.id;\n  return out;\n}\n\n/** A failure result']]],
  ["M13 preview provenance dropped", "caught", [
    [P + "payload.ts", "    source,\n    guide:", "    source: null,\n    guide:"],
    [P + "payload.ts", "      sourceRefs: previewRefs(card.sourceRefs),", "      sourceRefs: [],"]]],
  ["M14 source claim warning only for generator", "caught", [[P + "semantic.ts", 'if (sourceClaims(packet.source)) warnings.add("source_claim_unverified");', 'if (packet.source?.generator) warnings.add("source_claim_unverified");']]],
  ["M15 export IDs leak into persistence", "caught", [[P + "payload.ts", "flashcards: cards.map((card) => ({ front: card.front, back: card.back, sourcePage: null })),", "flashcards: cards.map((card) => ({ id: card.id, front: card.front, back: card.back, sourcePage: null })),"]]],
  ["M16 R5 guard removed (orphan guide notes silently dropped again)", "caught", [[P + "semantic.ts", '    errors.push(rawError("source_notes_without_study_set", "$.guide.sourceNotes"));', ""]]],
  ["M17 guide source notes dropped from the persistence payload", "caught", [[P + "payload.ts", '            sourceNotes: packet.guide?.sourceNotes ?? "",\n            provider: "import",', '            sourceNotes: "",\n            provider: "import",']]],
  ["M18 notes alone counted as a substantive guide", "caught", [[P + "semantic.ts", "return Boolean(packet.guide && (packet.guide.summary || (packet.guide.sections ?? []).length));", "return Boolean(packet.guide && (packet.guide.summary || packet.guide.sourceNotes || (packet.guide.sections ?? []).length));"]]],
];

const EXPECTED_TOTAL_TESTS = 231;

/**
 * Creates an isolated scratch copy of the project needed for testing.
 * Reuses node_modules via symlink read-only.
 */
export function createScratchCopy(checkout, prefix = "hfd-slice-a-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    for (const item of [
      "src",
      "package.json",
      "package-lock.json",
      "public",
      "tsconfig.json",
      "vite.config.ts",
    ]) {
      cpSync(join(checkout, item), join(dir, item), { recursive: true });
    }
    const contractEvidence = "docs/evidence/structured-study-import-contract-2026-10-03";
    if (existsSync(join(checkout, contractEvidence))) {
      cpSync(join(checkout, contractEvidence), join(dir, contractEvidence), { recursive: true });
    }
    symlinkSync(join(checkout, "node_modules"), join(dir, "node_modules"));
    return dir;
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Runs Vitest in the scratch directory and evaluates report validity.
 */
function runSuite(checkout, dir) {
  const reportPath = join(dir, "report.json");
  const vitestBin = join(checkout, "node_modules/.bin/vitest");
  const runResult = spawnSync(
    vitestBin,
    ["run", "src/logic/studyPacket", "--reporter=json", `--outputFile=${reportPath}`],
    { cwd: dir, encoding: "utf8" }
  );

  let infrastructureError = null;
  if (runResult.error) {
    infrastructureError = `Process execution error: ${runResult.error.message}`;
  } else if (runResult.signal) {
    infrastructureError = `Process terminated with signal: ${runResult.signal}`;
  }

  if (!existsSync(reportPath)) {
    infrastructureError = infrastructureError || `No report generated: ${runResult.stderr?.slice(0, 300) || "empty output"}`;
    return {
      exit: runResult.status,
      total: 0,
      failed: 0,
      failedAssertions: [],
      unrelatedFailures: [],
      infrastructureError,
    };
  }

  let json;
  try {
    json = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (err) {
    return {
      exit: runResult.status,
      total: 0,
      failed: 0,
      failedAssertions: [],
      unrelatedFailures: [],
      infrastructureError: `Malformed JSON report: ${err.message}`,
    };
  }

  // Check for test file load/transform errors
  for (const fileResult of json.testResults || []) {
    if (fileResult.status === "failed" && (!fileResult.assertionResults || fileResult.assertionResults.length === 0)) {
      infrastructureError = infrastructureError || `Test file error in ${fileResult.name}: ${fileResult.message || "failed without assertions"}`;
    }
  }

  if (json.numTotalTests !== EXPECTED_TOTAL_TESTS) {
    infrastructureError = infrastructureError || `Unexpected total test count: got ${json.numTotalTests}, expected ${EXPECTED_TOTAL_TESTS}`;
  }

  // Extract actual failed assertions
  const failedAssertions = [];
  const unrelatedFailures = [];
  for (const fileResult of json.testResults || []) {
    for (const a of fileResult.assertionResults || []) {
      if (a.status === "failed") {
        if (a.fullName.includes("third-party notice for the zod dependency")) {
          unrelatedFailures.push(a.fullName);
        } else {
          failedAssertions.push(a.fullName);
        }
      }
    }
  }

  if (unrelatedFailures.length > 0) {
    infrastructureError = infrastructureError || `Unrelated notice failures detected (${unrelatedFailures.length}): ${unrelatedFailures.join("; ")}`;
  }

  return {
    exit: runResult.status,
    total: json.numTotalTests,
    failed: failedAssertions.length,
    failedAssertions,
    unrelatedFailures,
    infrastructureError,
  };
}

/**
 * Runs the unmodified control run.
 */
export function runControl(checkout) {
  const dir = createScratchCopy(checkout, "hfd-control-");
  try {
    const res = runSuite(checkout, dir);
    if (res.infrastructureError) {
      throw new Error(`Control run failed infrastructure check: ${res.infrastructureError}`);
    }
    if (res.exit !== 0 || res.failed !== 0 || res.total !== EXPECTED_TOTAL_TESTS) {
      throw new Error(`Control run failed: exit=${res.exit}, total=${res.total}, failed=${res.failed}, failures=${res.failedAssertions.join(", ")}`);
    }
    return res;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Runs all mutants.
 */
export function runMutations(checkout, mutants = MUTANTS) {
  const rows = [];
  for (const [name, expect, edits] of mutants) {
    const dir = createScratchCopy(checkout, "hfd-slice-a-mutant-");
    try {
      // Verify anchors and apply edits
      for (const [file, from, to] of edits) {
        const filePath = join(dir, file);
        if (!existsSync(filePath)) {
          throw new Error(`Target file ${file} does not exist in scratch copy for ${name}`);
        }
        const src = readFileSync(filePath, "utf8");
        const parts = src.split(from);
        if (parts.length !== 2) {
          throw new Error(`Mutation anchor not unique or missing (${parts.length - 1} occurrences) for ${name} in ${file}`);
        }
        writeFileSync(filePath, parts.join(to));
      }

      const res = runSuite(checkout, dir);

      let actual = "unknown";
      let caught = false;
      let asExpected = false;

      if (res.infrastructureError) {
        actual = "infrastructure_error";
        caught = false;
        asExpected = false;
      } else if (res.failed > 0 && res.exit !== 0) {
        actual = "caught";
        caught = true;
        asExpected = (expect === "caught");
      } else if (res.failed === 0 && res.exit === 0) {
        actual = "neutralized";
        caught = false;
        asExpected = (expect === "neutralized");
      } else {
        actual = `unexpected_state(exit=${res.exit},failed=${res.failed})`;
        asExpected = false;
      }

      rows.push({
        mutant: name,
        expect,
        actual,
        exit: res.exit,
        total: res.total,
        failed: res.failed,
        caught,
        asExpected,
        infrastructureError: res.infrastructureError,
        caughtBy: res.failedAssertions.slice(0, 8),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return rows;
}

/**
 * Self-test proving aggregate failure propagation on mismatched expectation.
 */
export function runSelfTest(checkout) {
  console.log("Running self-test: deliberately expecting M10 to be 'caught' instead of 'neutralized'...");
  const fakeMutants = [
    ["M10 deliberate expectation mismatch self-test", "caught", [
      [P + "schema.ts", "  const path = pathFromParts(issue.path);", '  const path = pathFromParts(issue.path) + (typeof issue.input === "string" ? " " + issue.input : "");']
    ]],
  ];
  const rows = runMutations(checkout, fakeMutants);
  const selfTestRow = rows[0];
  if (selfTestRow.actual === "neutralized" && selfTestRow.expect === "caught" && !selfTestRow.asExpected) {
    console.log("Self-test PASS: deliberate mismatch was correctly identified as unexpected (actual: neutralized, expected: caught, asExpected: false).");
    return true;
  } else {
    throw new Error(`Self-test FAIL: unexpected self-test behavior: ${JSON.stringify(selfTestRow)}`);
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const isSelfTest = args.includes("--self-test");
  const filteredArgs = args.filter((a) => !a.startsWith("--"));
  const checkout = resolve(filteredArgs[0] || process.cwd());
  const out = filteredArgs[1] ? resolve(filteredArgs[1]) : null;

  console.log(`Starting Slice A Mutation Runner`);
  console.log(`Checkout: ${checkout}`);
  if (out) console.log(`Output JSON: ${out}`);

  // 1. Control run
  console.log("\n[1/3] Running unmodified scratch control...");
  const controlRes = runControl(checkout);
  console.log(`Unmodified control passed: ${controlRes.total} tests, 0 failures, exit 0.`);

  // 2. Self-test check if requested
  if (isSelfTest) {
    console.log("\n[2/3] Running aggregate failure propagation self-test...");
    runSelfTest(checkout);
  }

  // 3. Mutation runs
  console.log(`\n[${isSelfTest ? "3/3" : "2/2"}] Running ${MUTANTS.length} mutants...`);
  const rows = runMutations(checkout, MUTANTS);

  console.log("\nResults Summary:");
  console.log("--------------------------------------------------------------------------------");
  for (const r of rows) {
    const status = r.asExpected ? "OK " : "BAD";
    const classification = r.actual.padEnd(12);
    const expected = `(expect ${r.expect})`.padEnd(20);
    const failureSummary = r.caughtBy.length > 0 ? r.caughtBy.slice(0, 2).join(" | ").slice(0, 100) : "none";
    console.log(`${status} ${classification} ${expected} ${r.mutant} [failed=${r.failed}/${r.total}, exit=${r.exit}] -> ${failureSummary}`);
    if (r.infrastructureError) {
      console.log(`     INFRASTRUCTURE ERROR: ${r.infrastructureError}`);
    }
  }
  console.log("--------------------------------------------------------------------------------");

  const summary = {
    mutants: rows.length,
    asExpected: rows.filter((r) => r.asExpected).length,
    caught: rows.filter((r) => r.caught).length,
    neutralized: rows.filter((r) => r.actual === "neutralized").length,
    infrastructureErrors: rows.filter((r) => r.infrastructureError).length,
  };
  console.log(`\nSummary: ${JSON.stringify(summary)}`);

  if (out) {
    writeFileSync(out, JSON.stringify({ control: { total: controlRes.total, exit: controlRes.exit }, summary, rows }, null, 2) + "\n");
    console.log(`Wrote results to ${out}`);
  }

  const allPassed = rows.length === 22 && rows.every((r) => r.asExpected) && summary.infrastructureErrors === 0;
  if (!allPassed) {
    console.error("FAILED: One or more mutations had unexpected results or infrastructure failures.");
    process.exit(1);
  } else {
    console.log("SUCCESS: All 22 mutations performed as expected (19 caught, 3 neutralized).");
    process.exit(0);
  }
}
