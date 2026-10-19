/** Disposable evaluation tooling. Never imported by the application. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const FIXTURES = fileURLToPath(new URL("../fixtures.json", import.meta.url));
export const PINS = fileURLToPath(new URL("../baseline-source-pins.json", import.meta.url));
export const REQUIRED_INPUTS = fileURLToPath(new URL("../required-inputs.json", import.meta.url));
/** Reviewed digest of required-inputs.json. The contract is never taken from the caller. */
export const REQUIRED_INPUTS_SHA256 = "385c62d1c058ee2154bd53389aebe35016817967678a65d784dfc4702febd72b";
export const MAX_FIXTURE_BYTES = 512 * 1024;
const SOURCE_PATHS = [
  "src/logic/cardScheduler.ts", "src/logic/localDay.ts", "src/logic/cardIdentity.ts",
  "src/data/cardReviewTransaction.ts", "src-tauri/src/card_reviews.rs",
  "src-tauri/src/card_reviews_tests.rs", "src-tauri/migrations/0012_card_reviews.sql",
  "src/data/cardReviewContract.test.ts", "package-lock.json",
];
const REQUIRED_CASES = [
  "new-again", "new-hard", "new-good", "new-easy", "repeated-hard", "repeated-again",
  "ladder-cap", "lapse-and-relearn", "twenty-days-overdue", "same-day-and-equal-time",
  "new-after-reset", "state-without-retained-events", "very-old-capped-card",
  "spring-elapsed-day", "fall-elapsed-day", "clock-backward", "noncanonical-time",
  "foreign-version", "unknown-rating",
];
const REQUIRED_LOCAL = [
  "spring-23-hour-day", "fall-25-hour-day", "travel-utc", "travel-los-angeles",
  "travel-kiritimati", "leap-day",
];
const STATE_KEYS = ["schedulerVersion", "step", "reps", "lapses", "lastReviewedAt", "dueAt"];
const REFUSALS = new Set([
  "INVALID_RATING", "INVALID_TIME", "UNSUPPORTED_SCHEDULER_VERSION", "CLOCK_BEHIND_LAST_REVIEW",
]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Read at most limit+1 bytes even if a file grows after opening. No writes. */
export function readBounded(file, limit) {
  const fd = openSync(file, "r");
  try {
    assert(fstatSync(fd).isFile(), "Input must be a regular file");
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length <= limit) {
      const n = readSync(fd, buffer, length, buffer.length - length, null);
      if (!n) break;
      length += n;
    }
    assert(length <= limit, "Input exceeds byte limit");
    return buffer.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}

function keys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label}: object required`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label}: unexpected/missing fields`);
}
function text(value, label) {
  assert(typeof value === "string" && value.length > 0 && value.length <= 128, `${label}: bounded text required`);
}
function instant(value) {
  assert(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value), "Canonical UTC instant required");
  assert(Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, "Valid instant required");
}
function state(value) {
  keys(value, STATE_KEYS, "state");
  text(value.schedulerVersion, "schedulerVersion");
  assert(Number.isInteger(value.step) && value.step >= -1 && value.step <= 7, "Invalid baseline step");
  for (const key of ["reps", "lapses"]) assert(Number.isSafeInteger(value[key]) && value[key] >= 0, "Invalid counter");
  instant(value.lastReviewedAt);
  instant(value.dueAt);
}
/** Load the frozen required-input contract (P54BASE-R1) and check its reviewed digest. */
export function loadRequiredInputs(file = REQUIRED_INPUTS, expectedSha256 = REQUIRED_INPUTS_SHA256) {
  const bytes = readBounded(file, MAX_FIXTURE_BYTES);
  assert.equal(sha256(bytes), expectedSha256, "Required-input contract differs from the reviewed digest");
  const contract = JSON.parse(bytes);
  keys(contract, ["schema", "note", "cases", "localDays"], "required-input contract");
  assert.equal(contract.schema, "hfd-scheduler-required-inputs/1");
  assert.deepEqual(contract.cases.map((c) => c.id), REQUIRED_CASES, "Contract must cover exactly the required histories");
  assert.deepEqual(contract.localDays.map((c) => c.id), REQUIRED_LOCAL, "Contract must cover exactly the required local days");
  return contract;
}
const CONTRACT = loadRequiredInputs();

/** Required IDs must be present, and must carry exactly the contract's inputs, not just its labels. */
function coverage(actual, required, label, project) {
  const ids = actual.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: duplicate ID`);
  for (const frozen of required) {
    const supplied = actual.find((item) => item.id === frozen.id);
    assert(supplied, `${label}: missing required vector ${frozen.id}`);
    assert.deepEqual(project(supplied), frozen, `${label}: required inputs changed for ${frozen.id}`);
  }
}
const historyInputs = (c) => ({
  id: c.id, historyClass: c.historyClass, prior: c.prior,
  reviews: c.reviews.map((r) => ({ rating: r.rating, at: r.at })),
});
const localInputs = (c) => ({ id: c.id, at: c.at, zone: c.zone });

export function validateFixtures(input) {
  keys(input, ["schema", "cases", "localDays"], "fixtures");
  assert.equal(input.schema, "hfd-scheduler-feasibility-fixtures/1");
  assert(Array.isArray(input.cases) && input.cases.length <= 128, "Case count exceeds limit");
  assert(Array.isArray(input.localDays) && input.localDays.length <= 64, "Local-day count exceeds limit");
  let total = 0;
  for (const c of input.cases) {
    keys(c, ["id", "historyClass", "prior", "reviews"], "case");
    text(c.id, "case ID");
    assert(["new", "retained", "missing", "missing-after-reset", "refusal"].includes(c.historyClass), "Unknown history class");
    if (c.prior !== null) state(c.prior);
    assert(Array.isArray(c.reviews) && c.reviews.length > 0 && c.reviews.length <= 256, "Invalid review count");
    total += c.reviews.length;
    assert(total <= 4096, "Total review count exceeds limit");
    for (const review of c.reviews) {
      const refusal = Object.hasOwn(review, "expectedRefusal");
      keys(review, ["rating", "at", refusal ? "expectedRefusal" : "expected"], "review");
      text(review.rating, "rating");
      text(review.at, "review time");
      if (refusal) assert(REFUSALS.has(review.expectedRefusal), "Unknown expected refusal");
      else {
        instant(review.at);
        state(review.expected);
      }
    }
  }
  for (const c of input.localDays) {
    keys(c, ["id", "at", "zone", "expectedDate", "expectedNextMidnight"], "local-day vector");
    text(c.id, "local-day ID");
    instant(c.at);
    assert(["UTC", "America/Los_Angeles", "Pacific/Kiritimati"].includes(c.zone), "Unregistered fixture zone");
    assert(/^\d{4}-\d{2}-\d{2}$/.test(c.expectedDate), "Expected local date required");
    instant(c.expectedNextMidnight);
  }
  coverage(input.cases, CONTRACT.cases, "histories", historyInputs);
  coverage(input.localDays, CONTRACT.localDays, "local days", localInputs);
  return input;
}

export function verifySourcePins(pins, root = ROOT) {
  keys(pins, ["schema", "baseCommit", "files"], "source pins");
  assert.equal(pins.schema, "hfd-scheduler-baseline-source-pins/1");
  assert(/^[a-f0-9]{40}$/.test(pins.baseCommit), "Pinned base commit required");
  const gitOptions = { cwd: ROOT, maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] };
  assert.equal(execFileSync("git", ["cat-file", "-t", pins.baseCommit], gitOptions).toString().trim(), "commit", "Baseline must identify a Git commit");
  assert(Array.isArray(pins.files), "Source files required");
  assert.deepEqual(pins.files.map((f) => f.path).sort(), [...SOURCE_PATHS].sort(), "Exact baseline source set required");
  const verified = new Map();
  for (const f of pins.files) {
    keys(f, ["path", "bytes", "sha256"], "source pin");
    assert(Number.isSafeInteger(f.bytes) && f.bytes >= 0 && /^[a-f0-9]{64}$/.test(f.sha256), "Invalid source pin");
    const bytes = readBounded(resolve(root, f.path), 2 * 1024 * 1024);
    assert.equal(bytes.length, f.bytes, `Source length drift: ${f.path}`);
    assert.equal(sha256(bytes), f.sha256, `Source hash drift: ${f.path}`);
    const baseline = execFileSync("git", ["cat-file", "blob", `${pins.baseCommit}:${f.path}`], gitOptions);
    assert.equal(sha256(baseline), f.sha256, `Pinned source differs from baseline Git blob: ${f.path}`);
    verified.set(f.path, bytes.toString("utf8"));
  }
  return verified;
}

async function sourceModule(relative, verifiedSource) {
  assert(typeof verifiedSource === "string", "Verified source bytes required");
  const source = verifiedSource;
  const result = ts.transpileModule(source, {
    fileName: relative,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    reportDiagnostics: true,
  });
  assert(!(result.diagnostics ?? []).some((d) => d.category === ts.DiagnosticCategory.Error), "Transpile failed");
  return import(`data:text/javascript;base64,${Buffer.from(result.outputText).toString("base64")}`);
}

/** A fixture comparison, not a new scheduler or a migration simulator. */
export function compareFixtures(input, scheduler, localDays) {
  validateFixtures(input);
  const cases = [];
  for (const c of input.cases) {
    let prior = structuredClone(c.prior);
    const observations = [];
    for (const review of c.reviews) {
      const before = structuredClone(prior);
      let actual, error;
      try { actual = scheduler.scheduleCard(prior, review.rating, review.at); }
      catch (caught) { error = caught; }
      assert.deepEqual(prior, before, `${c.id}: scheduler mutated its input`);
      if (Object.hasOwn(review, "expectedRefusal")) {
        assert(error instanceof scheduler.SchedulerRefusal, `${c.id}: expected scheduler refusal`);
        assert.equal(error.code, review.expectedRefusal, `${c.id}: wrong refusal`);
        observations.push({ rating: review.rating, at: review.at, refusal: error.code });
      } else {
        if (error) throw error;
        assert.deepEqual(actual, review.expected, `${c.id}: baseline mismatch`);
        observations.push({ rating: review.rating, at: review.at, state: actual,
          intervalMs: Date.parse(actual.dueAt) - Date.parse(review.at) });
        prior = actual;
      }
    }
    cases.push({ id: c.id, historyClass: c.historyClass, observations });
  }
  const local = input.localDays.map((c) => {
    const date = localDays.localDate(c.at, c.zone);
    const midnight = localDays.nextLocalMidnightUtc(c.at, c.zone);
    assert.equal(date, c.expectedDate, `${c.id}: local date mismatch`);
    assert.equal(midnight, c.expectedNextMidnight, `${c.id}: local boundary mismatch`);
    return { id: c.id, at: c.at, zone: c.zone, localDate: date, nextMidnightUtc: midnight };
  });
  return { cases, localDays: local };
}

export async function runBaseline(fixturePath = FIXTURES) {
  assert.equal(process.versions.node.split(".")[0], "22", "Use the reviewed Node 22 lane");
  assert.equal(ts.version, "5.9.3", "Use the locked TypeScript compiler");
  const pins = JSON.parse(readBounded(PINS, MAX_FIXTURE_BYTES));
  const sources = verifySourcePins(pins);
  const bytes = readBounded(fixturePath, MAX_FIXTURE_BYTES);
  const input = validateFixtures(JSON.parse(bytes));
  const scheduler = await sourceModule("src/logic/cardScheduler.ts", sources.get("src/logic/cardScheduler.ts"));
  const local = await sourceModule("src/logic/localDay.ts", sources.get("src/logic/localDay.ts"));
  assert.equal(scheduler.SCHEDULER_VERSION, "simple-v1");
  const compared = compareFixtures(input, scheduler, local);
  return {
    schema: "hfd-scheduler-feasibility-baseline/1", status: "PASS",
    scope: "Synthetic simple-v1 baseline only; no FSRS comparison or persistence proof",
    baseCommit: pins.baseCommit, fixtureSha256: sha256(bytes),
    schedulerVersion: scheduler.SCHEDULER_VERSION,
    historyCount: compared.cases.length,
    reviewCount: compared.cases.reduce((n, c) => n + c.observations.length, 0),
    localDayCount: compared.localDays.length,
    ...compared,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    assert(args.length === 0 || (args.length === 2 && args[0] === "--fixtures"), "Usage: node baseline.mjs [--fixtures path]");
    console.log(JSON.stringify(await runBaseline(args[1] ?? FIXTURES), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: "FAIL", message: error.message }));
    process.exitCode = 1;
  }
}
