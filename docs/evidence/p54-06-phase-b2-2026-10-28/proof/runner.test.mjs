/**
 * Re-runs the phase B part 2 measurements. From the repository root, with Node 22:
 *   node --test docs/evidence/p54-06-phase-b2-2026-10-28/proof/runner.test.mjs
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { EXPECTED, loadCandidate, negativeControls, runPhaseB2 } from "./runner.mjs";

test("the candidate passes every oracle and contract vector, phase A and the transition contracts", async () => {
  const r = await runPhaseB2();
  assert.equal(r.status, "PASS", JSON.stringify(r.message ?? r.summary));
  const s = r.summary;
  assert.equal(s.reference.vectors, EXPECTED.scenarios);
  assert.equal(s.reference.steps, EXPECTED.steps);
  assert.equal(s.reference.dExact, s.reference.ratingOutcomes);
  assert.deepEqual(s.reference.deviations, { C1: 1, C2: 8, C3: 3 }, "only the preregistered deviations appear");
  assert.equal(s.contract.vectors, EXPECTED.contract);
  assert.equal(s.contract.failures, 0);
  assert.equal(s.phaseA.histories, EXPECTED.phaseAHistories);
  assert.equal(s.phaseA.correctnessFailures, 0);
  assert.equal(s.transitions.failed, 0);
});

test("every negative control makes the runner refuse success", async () => {
  const r = await negativeControls();
  assert(r.controls.length >= 4);
  for (const c of r.controls) assert.equal(c.refused, true, c.id);
  assert.equal(r.status, "PASS");
});

test("the candidate never mutates its prior and refuses in the preregistered order", async () => {
  const { module: c } = await loadCandidate();
  const prior = Object.freeze({ schedulerVersion: "simple-v1", d: Number.NaN, s: 10, reps: 3, lapses: 0, lastReviewedAt: "invalid", dueAt: "x" });
  const code = (fn) => { try { fn(); return null; } catch (e) { assert(e instanceof c.FsrsRefusal); return e.code; } };
  assert.equal(code(() => c.scheduleFsrs(prior, "skip", "bad", c.PRODUCT_CONFIG)), "INVALID_RATING");
  assert.equal(code(() => c.scheduleFsrs(prior, "good", "bad", c.PRODUCT_CONFIG)), "INVALID_TIME");
  assert.equal(code(() => c.scheduleFsrs(prior, "good", "2026-10-19T15:00:00.000Z", c.PRODUCT_CONFIG)), "UNSUPPORTED_SCHEDULER_VERSION");
  // An invalid config never preempts the numbered refusals (Codex review, 28 Oct).
  for (const bad of [{ maximumInterval: 0 }, {}, null]) {
    assert.equal(code(() => c.scheduleFsrs(prior, "skip", "bad", bad)), "INVALID_RATING");
    assert.equal(code(() => c.scheduleFsrs(null, "good", "bad", bad)), "INVALID_TIME");
    assert.equal(code(() => c.scheduleFsrs(prior, "good", "2026-10-19T15:00:00.000Z", bad)), "UNSUPPORTED_SCHEDULER_VERSION");
    assert.throws(() => c.scheduleFsrs(null, "good", "2026-10-19T15:00:00.000Z", bad), TypeError);
  }
  const fresh = c.scheduleFsrs(null, "good", "2026-10-19T15:00:00.000Z", c.PRODUCT_CONFIG);
  const frozen = Object.freeze({ ...fresh });
  const next = c.scheduleFsrs(frozen, "good", "2026-10-21T15:00:00.000Z", c.PRODUCT_CONFIG);
  assert.equal(next.reps, 2);
  assert.deepEqual(frozen, fresh);
});
