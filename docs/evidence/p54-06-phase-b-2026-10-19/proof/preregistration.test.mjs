import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SCENARIOS, VECTORS, generate, loadScenarios } from "./generate-reference.mjs";
import { ORACLE, loadOracle, runOracle } from "./oracle.mjs";

const here = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "hfd-fsrs-prereg-"));
after(() => rmSync(temp, { recursive: true, force: true }));
const vectors = () => JSON.parse(readFileSync(VECTORS, "utf8"));
const contract = () => JSON.parse(readFileSync(here("contract-vectors.json"), "utf8"));
const lastStep = (id) => vectors().vectors.find((v) => v.id === id).steps.at(-1);

test("every preregistered file matches PREREGISTRATION.sha256", () => {
  const lines = readFileSync(here("PREREGISTRATION.sha256"), "utf8").trim().split("\n");
  assert.equal(lines.length, 8);
  for (const line of lines) {
    const [digest, path] = line.split(/ {2}/);
    assert.equal(createHash("sha256").update(readFileSync(here(path))).digest("hex"), digest, path);
  }
});

test("a one-byte change to the oracle is refused before it runs", () => {
  const bytes = readFileSync(ORACLE);
  bytes[bytes.length - 2] ^= 1;
  const copy = join(temp, "oracle.js");
  writeFileSync(copy, bytes);
  assert.throws(() => loadOracle(pathToFileURL(copy)), /pinned Git blob/);
});

test("changed scenario inputs are refused by their digest", () => {
  const input = JSON.parse(readFileSync(SCENARIOS, "utf8"));
  input.scenarios[0].steps[0].rating = "easy";
  const copy = join(temp, "scenarios.json");
  writeFileSync(copy, JSON.stringify(input, null, 2) + "\n");
  assert.throws(() => loadScenarios(pathToFileURL(copy)), /preregistered digest/);
});

test("the frozen vectors are exactly what the oracle produces from the scenarios", () => {
  assert.deepEqual(generate(loadScenarios()), vectors());
  const counts = vectors().vectors.reduce((n, v) => n + v.steps.length, 0);
  assert.equal(vectors().vectors.length, 30);
  assert.equal(counts, 66);
});

test("the documented oracle limitations stay on record", () => {
  const cap = lastStep("bound-max-interval-cap").outputs;
  assert.equal(cap.hard.scheduledDays, 36500);
  assert.equal(cap.good.scheduledDays, 36501, "ordering pushes Good past the cap (deviation C2)");
  assert.equal(cap.easy.scheduledDays, 36502);
  assert.equal(lastStep("bound-tiny-s-same-day").outputs.again.s, 0, "stability can round to 0 (deviation C1)");
  assert.equal(lastStep("oracle-review-zero-elapsed").oracleError, true);
  const ceiling = lastStep("bound-stability-ceiling").outputs;
  assert(["hard", "good", "easy"].every((r) => ceiling[r].s > 1_000_000), "stability exceeds the ceiling (deviation C3)");
});

test("oracle fuzz is real: one stability, three seeds, different Easy intervals", () => {
  const easy = ["initial-again", "initial-hard", "initial-good"].map((id) => lastStep(id).outputs.easy);
  assert(easy.every((o) => o.s === 8.3));
  assert.equal(new Set(easy.map((o) => o.scheduledDays)).size, 3);
  const script = loadOracle();
  const again = runOracle(script, { phase: "new", prior: null, seed: "initial-good#0" }).easy.scheduledDays;
  assert.equal(again, lastStep("initial-good").outputs.easy.scheduledDays, "a seed reproduces its interval");
});

test("contract vectors are hand-specified, unique and use only preregistered expectations", () => {
  const { vectors: list } = contract();
  assert.equal(list.length, 42);
  assert.equal(new Set(list.map((v) => v.id)).size, list.length);
  const refusals = new Set(["INVALID_RATING", "INVALID_TIME", "UNSUPPORTED_SCHEDULER_VERSION", "INVALID_STATE", "CLOCK_BEHIND_LAST_REVIEW", "COUNTER_OUT_OF_RANGE", "DUE_OUT_OF_RANGE"]);
  const shapes = new Set(["refusal", "elapsedDays", "path", "dueAt", "lapsesDelta", "intervalDays", "s", "successorAccepted", "successorRefusal", "reps"]);
  for (const v of list) {
    assert(["product", "oracle-parity"].includes(v.config), v.id);
    assert(Object.keys(v.expect).length > 0 && Object.keys(v.expect).every((k) => shapes.has(k)), v.id);
    if (v.expect.refusal) assert(refusals.has(v.expect.refusal), v.id);
  }
  assert.deepEqual(new Set(list.filter((v) => v.expect.refusal).map((v) => v.expect.refusal)), refusals, "every refusal is exercised");
});

// Independent arithmetic for the hand-written expectations: each is recomputed
// from `now` and the preregistered rule it encodes, with no scheduler code.
const DAY = 86_400_000;
const at = (id) => contract().vectors.find((v) => v.id === id);
const plus = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();

test("contract dates and elapsed floors agree with hand arithmetic", () => {
  assert.equal(at("again-returns-in-10-minutes").expect.dueAt, plus(at("again-returns-in-10-minutes").now, 10 * 60_000));
  assert.equal(at("new-card-hard-waits-1-day").expect.dueAt, plus(at("new-card-hard-waits-1-day").now, DAY));
  for (const id of ["product-cap-180-days", "product-cap-holds-after-ordering"]) {
    assert.equal(at(id).expect.dueAt, plus(at(id).now, 180 * DAY), id);
  }
  for (const id of ["accept-equal-clock-is-same-day", "elapsed-floor-just-under-1-day", "elapsed-floor-exactly-1-day", "elapsed-floor-1.999-days"]) {
    const v = at(id);
    assert.equal(Math.floor((Date.parse(v.now) - Date.parse(v.prior.lastReviewedAt)) / DAY), v.expect.elapsedDays, id);
    assert.equal(v.expect.path, v.expect.elapsedDays === 0 ? "same-day" : "review", id);
  }
  const overflow = at("refuse-due-past-year-9999");
  assert(Date.parse(overflow.now) + DAY > Date.parse("9999-12-31T23:59:59.999Z"), "even a 1-day interval overflows");
  const behind = at("refuse-clock-1ms-behind");
  assert.equal(Date.parse(behind.prior.lastReviewedAt) - Date.parse(behind.now), 1);
  for (const id of ["parity-cap-holds-after-ordering", "accept-stability-at-ceiling"]) {
    const v = at(id);
    assert(Math.floor((Date.parse(v.now) - Date.parse(v.prior.lastReviewedAt)) / DAY) >= 30000, id);
  }
});

test("prior-field refusals each change exactly one field of a valid prior", () => {
  const valid = at("refuse-unknown-rating").prior;
  for (const v of contract().vectors.filter((x) => /^refuse-(invalid|missing|noncanonical|negative|fractional|stability)/.test(x.id) && x.expect.refusal === "INVALID_STATE" && !x.id.startsWith("refuse-invalid-state"))) {
    const changed = Object.keys({ ...valid, ...v.prior }).filter((k) => JSON.stringify(valid[k]) !== JSON.stringify(v.prior[k]));
    assert.equal(changed.length, 1, `${v.id} changes ${changed}`);
  }
});

test("counter vectors sit exactly at and one below the safe-integer maximum", () => {
  const M = Number.MAX_SAFE_INTEGER;
  assert.equal(at("refuse-reps-at-safe-maximum").prior.reps, M);
  const below = at("accept-reps-just-below-safe-maximum");
  assert.equal(below.prior.reps, M - 1);
  assert.equal(below.expect.reps, below.prior.reps + 1);
  assert(Number.isSafeInteger(below.expect.reps));
  assert.equal(at("refuse-lapses-at-safe-maximum-on-again").prior.lapses, M);
  assert.equal(at("accept-lapses-at-safe-maximum-on-good").prior.lapses, M);
});
