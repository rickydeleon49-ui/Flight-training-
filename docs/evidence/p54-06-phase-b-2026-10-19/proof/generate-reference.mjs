/**
 * Disposable evaluation tooling. Never imported by the application.
 *
 * Turns the preregistered scenario inputs into reference vectors using only
 * the pinned FSRS4Anki oracle. No candidate code is involved.
 *
 *   node generate-reference.mjs            print vectors as JSON
 *   node generate-reference.mjs --check    exit 1 unless they equal the frozen file
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RATINGS, loadOracle, runOracle } from "./oracle.mjs";

export const SCENARIOS = new URL("../scenarios.json", import.meta.url);
export const VECTORS = new URL("../reference-vectors.json", import.meta.url);
export const SCENARIOS_SHA256 = "c783f59cf276f26a27b872b376f2c73a6fbc3a83e6beb01778069ced8a4f673b";

/** A step's elapsed days: a number, or "scheduled" for the previous interval. */
function elapsed(step, previous) {
  if (typeof step.elapsedDays === "number") return step.elapsedDays;
  assert.equal(step.elapsedDays, "scheduled", "elapsedDays must be a number or \"scheduled\"");
  assert(Number.isInteger(previous) && previous > 0, "\"scheduled\" needs a previous review interval");
  return previous;
}

export function loadScenarios(url = SCENARIOS) {
  const bytes = readFileSync(url);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), SCENARIOS_SHA256, "Scenarios differ from the preregistered digest");
  return JSON.parse(bytes);
}

export function generate(scenarios, script = loadOracle()) {
  const vectors = [];
  for (const sc of scenarios.scenarios) {
    let prior = sc.start === "new" ? null : sc.start;
    let interval = sc.startScheduledDays ?? null;
    const steps = [];
    for (const [i, step] of sc.steps.entries()) {
      const input = { phase: step.phase, prior, seed: `${sc.id}#${i}` };
      if (step.phase === "review") {
        input.elapsedDays = elapsed(step, interval);
        input.scheduledDays = step.scheduledDays ?? interval ?? input.elapsedDays;
      }
      if (step.expectOracleError) {
        assert.throws(() => runOracle(script, input), `${sc.id}#${i}: oracle was expected to fail`);
        steps.push({ ...input, oracleError: true });
        break;
      }
      const out = runOracle(script, input);
      steps.push({ ...input, rating: step.rating, outputs: out });
      prior = { d: out[step.rating].d, s: out[step.rating].s };
      interval = out[step.rating].scheduledDays ?? interval;
    }
    vectors.push({ id: sc.id, category: sc.category, steps });
  }
  return {
    schema: "hfd-fsrs6-reference-vectors/1",
    oracle: "fsrs4anki v6.1.3 fsrs4anki_scheduler.js blob 724a2f445adfffb2cc3d7fae7a96ab37b948561c",
    scenariosSha256: SCENARIOS_SHA256,
    ratings: RATINGS,
    vectors,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = generate(loadScenarios());
    if (process.argv[2] === "--check") {
      assert.deepEqual(result, JSON.parse(readFileSync(VECTORS)), "Regenerated vectors differ from the frozen file");
      console.log(JSON.stringify({ status: "PASS", vectors: result.vectors.length }));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(JSON.stringify({ status: "FAIL", message: error.message }));
    process.exitCode = 1;
  }
}
