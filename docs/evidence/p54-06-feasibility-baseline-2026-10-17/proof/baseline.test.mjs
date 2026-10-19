import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  FIXTURES, MAX_FIXTURE_BYTES, PINS, REQUIRED_INPUTS, REQUIRED_INPUTS_SHA256, ROOT,
  loadRequiredInputs, readBounded, runBaseline, validateFixtures, verifySourcePins,
} from "./baseline.mjs";

const temp = mkdtempSync(join(tmpdir(), "hfd-scheduler-baseline-"));
after(() => rmSync(temp, { recursive: true, force: true }));
const fixtures = () => JSON.parse(readFileSync(FIXTURES, "utf8"));
const pins = () => JSON.parse(readFileSync(PINS, "utf8"));
const cli = fileURLToPath(new URL("./baseline.mjs", import.meta.url));
let serial = 0;
function fixtureFile(input) {
  const path = join(temp, `fixtures-${serial++}.json`);
  writeFileSync(path, JSON.stringify(input));
  return path;
}

test("real production baseline matches every registered literal vector", async () => {
  const result = await runBaseline();
  assert.equal(result.status, "PASS");
  assert.equal(result.historyCount, 19);
  assert.equal(result.reviewCount, 78);
  assert.equal(result.localDayCount, 6);
  assert.equal(result.schedulerVersion, "simple-v1");
  const spring = result.localDays.find((c) => c.id === "spring-23-hour-day");
  const fall = result.localDays.find((c) => c.id === "fall-25-hour-day");
  assert.equal(Date.parse(spring.nextMidnightUtc) - Date.parse(spring.at), 23 * 3600000);
  assert.equal(Date.parse(fall.nextMidnightUtc) - Date.parse(fall.at), 25 * 3600000);
  for (const id of ["spring-elapsed-day", "fall-elapsed-day"]) {
    assert.equal(result.cases.find((c) => c.id === id).observations[0].intervalMs, 86400000);
  }
});

test("CLI output is identical across two runs and neither fixtures nor source change", () => {
  const beforeFixture = readFileSync(FIXTURES);
  const beforeSource = readFileSync(join(ROOT, "src/logic/cardScheduler.ts"));
  const a = execFileSync(process.execPath, [cli]);
  const b = execFileSync(process.execPath, [cli]);
  assert.deepEqual(a, b);
  assert.equal(JSON.parse(a).status, "PASS");
  assert.deepEqual(readFileSync(FIXTURES), beforeFixture);
  assert.deepEqual(readFileSync(join(ROOT, "src/logic/cardScheduler.ts")), beforeSource);
});

test("a wrong expected interval fails through the real CLI with no partial PASS", () => {
  const input = fixtures();
  input.cases.find((c) => c.id === "new-good").reviews[0].expected.dueAt = "2026-10-08T15:00:00.000Z";
  const child = spawnSync(process.execPath, [cli, "--fixtures", fixtureFile(input)], { encoding: "utf8" });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, "");
  assert.equal(JSON.parse(child.stderr).status, "FAIL");
  assert.match(JSON.parse(child.stderr).message, /new-good: baseline mismatch/);
});

test("an incorrect refusal cannot pass as any generic exception", async () => {
  const input = fixtures();
  input.cases.find((c) => c.id === "clock-backward").reviews[0].expectedRefusal = "INVALID_TIME";
  await assert.rejects(runBaseline(fixtureFile(input)), /wrong refusal/);
});

for (const [label, mutate, message] of [
  ["missing required history", (f) => f.cases.splice(0, 1), /missing required vector/],
  ["missing required timezone", (f) => f.localDays.splice(0, 1), /missing required vector/],
  ["duplicate ID", (f) => f.cases.push(structuredClone(f.cases[0])), /duplicate ID/],
  ["empty review stream", (f) => { f.cases[0].reviews = []; }, /review count/],
  ["unknown fields", (f) => { f.skipVerification = true; }, /unexpected\/missing fields/],
  ["ambiguous expectation", (f) => { f.cases[0].reviews[0].expectedRefusal = "INVALID_TIME"; }, /unexpected\/missing fields/],
  ["unknown expected refusal", (f) => { f.cases.at(-1).reviews[0].expectedRefusal = "ANY_ERROR"; }, /Unknown expected refusal/],
  ["unknown zone", (f) => { f.localDays[0].zone = "unregistered"; }, /Unregistered fixture zone/],
  ["fractional counter", (f) => { f.cases[0].reviews[0].expected.reps = 1.5; }, /Invalid counter/],
  ["invalid expected instant", (f) => { f.cases[0].reviews[0].expected.dueAt = "2026-02-30T15:00:00.000Z"; }, /Valid instant/],
]) {
  test(`fixture gate rejects ${label}`, () => {
    const input = fixtures(); mutate(input);
    assert.throws(() => validateFixtures(input), message);
  });
}

// P54BASE-R1: a required ID must keep its frozen inputs, not just its label or the totals.
function refusedThroughCli(input, message) {
  const child = spawnSync(process.execPath, [cli, "--fixtures", fixtureFile(input)], { encoding: "utf8" });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, "");
  const failure = JSON.parse(child.stderr);
  assert.equal(failure.status, "FAIL");
  assert.match(failure.message, message);
}

test("P54BASE-R1: retaining IDs cannot hide deleted review transitions", () => {
  const input = fixtures();
  for (const c of input.cases) c.reviews = c.reviews.slice(0, 1);
  refusedThroughCli(input, /required inputs changed/);
});

test("P54BASE-R1: retaining IDs and counts cannot replace DST and travel zones with UTC", () => {
  const input = fixtures();
  for (const c of input.localDays) {
    c.zone = "UTC";
    c.expectedDate = c.at.slice(0, 10);
    const midnight = new Date(c.at);
    midnight.setUTCDate(midnight.getUTCDate() + 1);
    midnight.setUTCHours(0, 0, 0, 0);
    c.expectedNextMidnight = midnight.toISOString();
  }
  refusedThroughCli(input, /local days: required inputs changed/);
});

for (const [label, mutate] of [
  ["a required rating", (f) => { f.cases.find((c) => c.id === "ladder-cap").reviews[1].rating = "hard"; }],
  ["a required review time", (f) => { f.cases.find((c) => c.id === "twenty-days-overdue").reviews[1].at = "2026-10-09T15:00:00.000Z"; }],
  ["a required prior state", (f) => { f.cases.find((c) => c.prior !== null).prior.reps += 1; }],
  ["a required history class", (f) => { f.cases.find((c) => c.id === "new-good").historyClass = "retained"; }],
  ["a required local-day time", (f) => { f.localDays.find((c) => c.id === "leap-day").at = "2028-03-01T12:00:00.000Z"; }],
]) {
  test(`P54BASE-R1: changing ${label} refuses even with expectations untouched`, () => {
    const input = fixtures(); mutate(input);
    assert.throws(() => validateFixtures(input), /required inputs changed/);
  });
}

test("P54BASE-R1: an equivalent reserialization and a distinct extra vector still pass", async () => {
  const input = fixtures();
  const reordered = JSON.parse(JSON.stringify(input, null, 4));
  reordered.cases.reverse();
  reordered.localDays.reverse();
  const extra = structuredClone(input.localDays.find((c) => c.id === "travel-utc"));
  extra.id = "experimental-extra-utc";
  reordered.localDays.push(extra);
  const result = await runBaseline(fixtureFile(reordered));
  assert.equal(result.status, "PASS");
  assert.equal(result.historyCount, 19);
  assert.equal(result.reviewCount, 78);
  assert.equal(result.localDayCount, 7);
});

test("P54BASE-R1: the contract is bound to its reviewed digest, never to the caller", () => {
  assert.equal(loadRequiredInputs().cases.length, 19);
  const forged = join(temp, "forged-contract.json");
  const contract = JSON.parse(readFileSync(REQUIRED_INPUTS, "utf8"));
  contract.localDays.forEach((c) => { c.zone = "UTC"; });
  writeFileSync(forged, JSON.stringify(contract, null, 2) + "\n");
  assert.throws(() => loadRequiredInputs(forged), /reviewed digest/);
  const digest = createHash("sha256").update(readFileSync(REQUIRED_INPUTS)).digest("hex");
  assert.equal(digest, REQUIRED_INPUTS_SHA256);
});

test("individual and aggregate review limits are enforced before evaluation", () => {
  const input = fixtures();
  input.cases[0].reviews = Array(257).fill(input.cases[0].reviews[0]);
  assert.throws(() => validateFixtures(input), /review count/);
  const aggregate = fixtures();
  aggregate.cases = Array.from({ length: 17 }, (_, i) => ({
    ...structuredClone(aggregate.cases[0]), id: `extra-${i}`,
    reviews: Array(256).fill(structuredClone(aggregate.cases[0].reviews[0])),
  }));
  assert.throws(() => validateFixtures(aggregate), /Total review count/);
});

test("byte reader accepts the cap and refuses cap+1", () => {
  const file = join(temp, "bounded.txt");
  writeFileSync(file, Buffer.alloc(MAX_FIXTURE_BYTES, 32));
  assert.equal(readBounded(file, MAX_FIXTURE_BYTES).length, MAX_FIXTURE_BYTES);
  writeFileSync(file, Buffer.alloc(MAX_FIXTURE_BYTES + 1, 32));
  assert.throws(() => readBounded(file, MAX_FIXTURE_BYTES), /byte limit/);
});

test("CLI rejects malformed JSON and unknown bypass flags with no PASS", () => {
  const file = join(temp, "invalid.json"); writeFileSync(file, "{");
  for (const args of [["--fixtures", file], ["--skip-source-check"]]) {
    const child = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(child.status, 1);
    assert.equal(child.stdout, "");
    assert.equal(JSON.parse(child.stderr).status, "FAIL");
  }
});

test("all nine baseline sources are required; a changed hash refuses", () => {
  const complete = pins();
  assert.equal(verifySourcePins(complete).size, 9);
  const missing = pins(); missing.files.pop();
  assert.throws(() => verifySourcePins(missing), /Exact baseline source set/);
  const altered = pins(); altered.files[0].sha256 = "0".repeat(64);
  assert.throws(() => verifySourcePins(altered), /Source hash drift/);
});

test("same-length source corruption is caught in a disposable copy", () => {
  const scratch = join(temp, "source-copy");
  for (const { path } of pins().files) {
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    cpSync(join(ROOT, path), join(scratch, path));
  }
  const file = join(scratch, "src/logic/cardScheduler.ts");
  const source = readFileSync(file);
  source[0] = source[0] === 32 ? 33 : 32;
  writeFileSync(file, source);
  assert.throws(() => verifySourcePins(pins(), scratch), /Source hash drift/);
  const forged = pins();
  forged.files[0].sha256 = createHash("sha256").update(source).digest("hex");
  assert.throws(() => verifySourcePins(forged, scratch), /differs from baseline Git blob/);
});

test("an unavailable baseline commit refuses before loading any module", () => {
  const input = pins(); input.baseCommit = "0".repeat(40);
  assert.throws(() => verifySourcePins(input));
});
