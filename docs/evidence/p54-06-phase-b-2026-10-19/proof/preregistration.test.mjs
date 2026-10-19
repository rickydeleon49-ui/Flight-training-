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
  assert.equal(vectors().vectors.length, 29);
  assert.equal(counts, 65);
});

test("the documented oracle limitations stay on record", () => {
  const cap = lastStep("bound-max-interval-cap").outputs;
  assert.equal(cap.hard.scheduledDays, 36500);
  assert.equal(cap.good.scheduledDays, 36501, "ordering pushes Good past the cap (deviation C2)");
  assert.equal(cap.easy.scheduledDays, 36502);
  assert.equal(lastStep("bound-tiny-s-same-day").outputs.again.s, 0, "stability can round to 0 (deviation C1)");
  assert.equal(lastStep("oracle-review-zero-elapsed").oracleError, true);
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
  assert.equal(list.length, 26);
  assert.equal(new Set(list.map((v) => v.id)).size, list.length);
  const refusals = new Set(["INVALID_RATING", "INVALID_TIME", "UNSUPPORTED_SCHEDULER_VERSION", "INVALID_STATE", "CLOCK_BEHIND_LAST_REVIEW", "DUE_OUT_OF_RANGE"]);
  const shapes = new Set(["refusal", "elapsedDays", "path", "dueAt", "lapsesDelta", "intervalDays", "s"]);
  for (const v of list) {
    assert(["product", "oracle-parity"].includes(v.config), v.id);
    assert(Object.keys(v.expect).length > 0 && Object.keys(v.expect).every((k) => shapes.has(k)), v.id);
    if (v.expect.refusal) assert(refusals.has(v.expect.refusal), v.id);
  }
  assert.deepEqual(new Set(list.filter((v) => v.expect.refusal).map((v) => v.expect.refusal)), refusals, "every refusal is exercised");
});
