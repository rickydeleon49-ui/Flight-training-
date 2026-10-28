/**
 * Disposable evaluation tooling. Never imported by the application.
 *
 * P54-06 phase B part 2: measures `fsrs6-candidate-1` against the frozen
 * preregistration (docs/evidence/p54-06-phase-b-2026-10-19/), compares it with
 * the unchanged production simple-v1 module over phase A's 19 histories, runs
 * the proposed transition contracts, and (with --controls) the negative controls.
 *
 *   node runner.mjs              JSON result; exit 1 unless status is PASS
 *   node runner.mjs --controls   negative-control results; exit 1 unless every control is refused
 *
 * Frozen inputs are only read. The oracle runs only through the preregistered
 * harness (proof/oracle.mjs: isolated vm after the Git blob and SHA-256 checks).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { generate, loadScenarios } from "../../p54-06-phase-b-2026-10-19/proof/generate-reference.mjs";
import { loadOracle } from "../../p54-06-phase-b-2026-10-19/proof/oracle.mjs";
import { compareFixtures, validateFixtures } from "../../p54-06-feasibility-baseline-2026-10-17/proof/baseline.mjs";
import { transitionCard, reviewAfterTransition } from "./transition.mjs";

export const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const PREREG_DIR = fileURLToPath(new URL("../../p54-06-phase-b-2026-10-19/", import.meta.url));
export const PHASE_A_DIR = fileURLToPath(new URL("../../p54-06-feasibility-baseline-2026-10-17/", import.meta.url));
export const CANDIDATE_PATH = fileURLToPath(new URL("../candidate/fsrs6Candidate.ts", import.meta.url));
const PREREG_PREFIX = "docs/evidence/p54-06-phase-b-2026-10-19/";

/** Digests reviewed before this run. A copy that rewrites a file and its inventory still fails here. */
export const PINS = Object.freeze({
  preregistrationSha256File: "b58c24f0a0b34f84527e1f9fc9797d63890b7dc69ee591efaf1230eaf1b5199d",
  preregistrationSha256Sums: "b824e477e24bbd52ff724972aa3e5f37df1ac5b604489379b6a7495504bf5582",
  phaseAFixtures: "c50a2fb8b23f5ca598f0f5bc8fc091b7aaa144bcf77f7746a831817eb27971fe",
  phaseARequiredInputs: "385c62d1c058ee2154bd53389aebe35016817967678a65d784dfc4702febd72b",
  phaseABaseCommit: "e8f68080186331803f8f2578086e3f8258c8eff1",
  simpleV1: { path: "src/logic/cardScheduler.ts", sha256: "019dab24fa66d1e3065b7580f9062ac9c3205c46f3ea8df65d0de58f318e0004" },
  localDay: { path: "src/logic/localDay.ts", sha256: "3efbaf18db07403430ec6bf751d001181e552e64eed8e53cde7c8be97702c514" },
  oracleLabel: "fsrs4anki v6.1.3 fsrs4anki_scheduler.js blob 724a2f445adfffb2cc3d7fae7a96ab37b948561c",
  scenariosSha256: "c783f59cf276f26a27b872b376f2c73a6fbc3a83e6beb01778069ced8a4f673b",
});
export const EXPECTED = Object.freeze({ scenarios: 30, steps: 66, contract: 42, phaseAHistories: 19 });
const DAY = 86_400_000;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const plus = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();

// ---------------------------------------------------------------- provenance

/** Refuses (throws) unless every frozen file, inventory and the oracle output match the pins. */
export function verifyProvenance(preregDir = PREREG_DIR) {
  const file = (p) => join(preregDir, p);
  const shaFile = readFileSync(file("PREREGISTRATION.sha256"));
  assert.equal(sha256(shaFile), PINS.preregistrationSha256File, "PREREGISTRATION.sha256 differs from the reviewed digest");
  const lines = shaFile.toString("utf8").trim().split("\n");
  assert.equal(lines.length, 8, "PREREGISTRATION.sha256 must bind 8 files");
  for (const line of lines) {
    const [digest, path] = line.split(/ {2}/);
    assert.equal(sha256(readFileSync(file(path))), digest, `Frozen file digest mismatch: ${path}`);
  }
  const sums = readFileSync(file("SHA256SUMS"));
  assert.equal(sha256(sums), PINS.preregistrationSha256Sums, "Phase B SHA256SUMS differs from the reviewed digest");
  for (const line of sums.toString("utf8").trim().split("\n")) {
    const [digest, path] = line.split(/ {2}/);
    assert(path.startsWith(PREREG_PREFIX), `Unexpected inventory path: ${path}`);
    assert.equal(sha256(readFileSync(file(path.slice(PREREG_PREFIX.length)))), digest, `Inventory digest mismatch: ${path}`);
  }
  const script = loadOracle(pathToFileURL(file("oracle/fsrs4anki_scheduler.js")));
  const scenarios = loadScenarios(pathToFileURL(file("scenarios.json")));
  const reference = JSON.parse(readFileSync(file("reference-vectors.json"), "utf8"));
  const contract = JSON.parse(readFileSync(file("contract-vectors.json"), "utf8"));
  checkReferenceProvenance(reference);
  assert.deepEqual(generate(scenarios, script), reference, "The oracle no longer reproduces the frozen reference vectors");
  return { scenarios, reference, contract };
}

export function checkReferenceProvenance(reference) {
  assert.equal(reference.schema, "hfd-fsrs6-reference-vectors/1", "Reference schema");
  assert.equal(reference.oracle, PINS.oracleLabel, "Reference vectors name a different oracle");
  assert.equal(reference.scenariosSha256, PINS.scenariosSha256, "Reference vectors name different scenarios");
}

// ---------------------------------------------------------------- modules

async function importTs(source, fileName) {
  const out = ts.transpileModule(source, {
    fileName,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    reportDiagnostics: true,
  });
  assert(!(out.diagnostics ?? []).some((d) => d.category === ts.DiagnosticCategory.Error), `Transpile failed: ${fileName}`);
  return import(`data:text/javascript;base64,${Buffer.from(out.outputText).toString("base64")}`);
}

export async function loadCandidate(path = CANDIDATE_PATH) {
  const bytes = readFileSync(path);
  const module = await importTs(bytes.toString("utf8"), "fsrs6Candidate.ts");
  assert.equal(module.SCHEDULER_VERSION, "fsrs6-candidate-1");
  return { module, sha256: sha256(bytes) };
}

/** The unchanged production module, read-only, after its bytes match phase A's pin and Git blob. */
async function loadProduction({ path, sha256: digest }) {
  const bytes = readFileSync(resolve(ROOT, path));
  assert.equal(sha256(bytes), digest, `Production source differs from phase A's pin: ${path}`);
  const pinned = execFileSync("git", ["cat-file", "blob", `${PINS.phaseABaseCommit}:${path}`], { cwd: ROOT, maxBuffer: 1 << 21 });
  assert.equal(sha256(pinned), digest, `Phase A base commit blob differs: ${path}`);
  return importTs(bytes.toString("utf8"), path);
}

// ---------------------------------------------------------------- 1a. oracle vectors

const PATH_FOR_PHASE = { new: "new", learning: "same-day", review: "review" };
const ANCHOR = "2000-01-01T00:00:00.000Z";

function call(candidate, fn, failures, where) {
  try {
    return { value: fn() };
  } catch (error) {
    if (error instanceof candidate.FsrsRefusal) return { refusal: error.code };
    failures.push({ where, kind: "candidate-threw", message: String(error?.message ?? error) });
    return { threw: true };
  }
}

export function evaluateReference(reference, scenarios, candidate) {
  const failures = [];
  const deviations = [];
  const limitations = [];
  const notComparable = [];
  const counts = { vectors: 0, steps: 0, ratingOutcomes: 0, dExact: 0, sExact: 0, intervalExact: 0, intervalWindow: 0 };
  const config = candidate.ORACLE_PARITY_CONFIG;
  checkReferenceProvenance(reference);
  const ids = reference.vectors.map((v) => v.id);
  if (ids.length !== EXPECTED.scenarios || new Set(ids).size !== ids.length) failures.push({ where: "reference", kind: "vector-count", message: `${ids.length} vectors` });
  for (const sc of scenarios.scenarios) if (!ids.includes(sc.id)) failures.push({ where: sc.id, kind: "missing-vector" });
  const totalSteps = reference.vectors.reduce((n, v) => n + v.steps.length, 0);
  if (totalSteps !== EXPECTED.steps) failures.push({ where: "reference", kind: "step-count", message: `${totalSteps} steps` });

  for (const vector of reference.vectors) {
    counts.vectors += 1;
    const sc = scenarios.scenarios.find((s) => s.id === vector.id);
    if (!sc) { failures.push({ where: vector.id, kind: "unknown-vector" }); continue; }
    let prior = sc.start === "new" ? null : {
      schedulerVersion: candidate.SCHEDULER_VERSION, d: sc.start.d, s: sc.start.s, reps: 1, lapses: 0, lastReviewedAt: ANCHOR, dueAt: ANCHOR,
    };
    for (const [i, step] of vector.steps.entries()) {
      counts.steps += 1;
      const where = `${vector.id}#${i}`;
      if ((step.prior === null) !== (prior === null) || (prior && (prior.d !== step.prior.d || prior.s !== step.prior.s))) {
        failures.push({ where, kind: "prior-chain", expected: step.prior, actual: prior && { d: prior.d, s: prior.s } });
      }
      const now = step.phase === "new" ? ANCHOR
        : step.phase === "learning" ? plus(prior.lastReviewedAt, 10 * 60_000)
        : plus(prior.lastReviewedAt, step.elapsedDays * DAY);
      if (step.oracleError) {
        const r = call(candidate, () => candidate.decideFsrs(prior, "good", now, config), failures, where);
        limitations.push({ where, note: "oracle throws on a review with 0 elapsed days; no comparison", candidatePath: r.value?.path ?? null, candidate: r.value?.state ?? r.refusal ?? null });
        break;
      }
      let chosen = null;
      for (const rating of candidate.FSRS_RATINGS) {
        const at = `${where}/${rating}`;
        const r = call(candidate, () => candidate.decideFsrs(prior, rating, now, config), failures, at);
        if (!r.value) { if (r.refusal) failures.push({ where: at, kind: "unexpected-refusal", code: r.refusal }); continue; }
        counts.ratingOutcomes += 1;
        const c = r.value;
        const o = step.outputs[rating];
        if (c.path !== PATH_FOR_PHASE[step.phase]) failures.push({ where: at, kind: "path", expected: PATH_FOR_PHASE[step.phase], actual: c.path });
        if (c.state.d === o.d) counts.dExact += 1; else failures.push({ where: at, kind: "d", expected: o.d, actual: c.state.d });
        if (c.state.s === o.s) counts.sExact += 1;
        else if (o.s === 0 && c.state.s === 0.01) deviations.push({ where: at, deviation: "C1", oracle: o.s, candidate: c.state.s });
        else if (o.s > 1_000_000 && c.state.s === 1_000_000) deviations.push({ where: at, deviation: "C3", oracle: o.s, candidate: c.state.s });
        else failures.push({ where: at, kind: "s", expected: o.s, actual: c.state.s });
        const ci = c.intervalDays;
        const due = Date.parse(c.state.dueAt) - Date.parse(now);
        if (due !== (ci === null ? 10 * 60_000 : ci * DAY)) failures.push({ where: at, kind: "due-vs-interval", actual: c.state.dueAt });
        if (rating === "again") {
          if (o.scheduledDays !== null || ci !== null) failures.push({ where: at, kind: "again-interval", oracle: o.scheduledDays, candidate: ci });
          else notComparable.push({ where: at, reason: "Again: oracle leaves it to Anki learning steps; candidate 10 minutes" });
        } else if (o.scheduledDays === null) {
          if (rating === "hard" && step.phase !== "review" && ci === 1) notComparable.push({ where: at, reason: "Hard on new/same-day: oracle leaves it to learning steps; candidate 1 day" });
          else failures.push({ where: at, kind: "interval-null", candidate: ci });
        } else if (o.scheduledDays > config.maximumInterval) {
          if (ci === config.maximumInterval) deviations.push({ where: at, deviation: "C2", oracle: o.scheduledDays, candidate: ci });
          else failures.push({ where: at, kind: "interval-cap", oracle: o.scheduledDays, candidate: ci });
        } else if (ci < 2.5) {
          if (ci === o.scheduledDays) counts.intervalExact += 1; else failures.push({ where: at, kind: "interval-exact", oracle: o.scheduledDays, candidate: ci });
        } else {
          const band = Math.ceil(0.05 * ci) + 2;
          if (o.scheduledDays >= ci - band && o.scheduledDays <= ci + band) counts.intervalWindow += 1;
          else failures.push({ where: at, kind: "interval-window", oracle: o.scheduledDays, candidate: ci, window: [ci - band, ci + band] });
        }
        if (rating === step.rating) chosen = c.state;
      }
      if (!chosen) break;
      prior = chosen;
    }
  }
  return { counts, failures, deviations, limitations, notComparable: notComparable.length };
}

// ---------------------------------------------------------------- 1b. contract vectors

const NON_FINITE = { NaN: Number.NaN, Infinity: Number.POSITIVE_INFINITY, "-Infinity": Number.NEGATIVE_INFINITY };
const decodePrior = (prior) => {
  if (prior === null) return null;
  const out = { ...prior };
  for (const k of ["d", "s"]) if (typeof out[k] === "string" && Object.hasOwn(NON_FINITE, out[k])) out[k] = NON_FINITE[out[k]];
  return out;
};

/** An independent re-check of check 4, so an accepted output is proved to be a valid next prior. */
export function isValidNextPrior(state) {
  const instant = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && new Date(Date.parse(v)).toISOString() === v;
  return state.schedulerVersion === "fsrs6-candidate-1" && Number.isFinite(state.d) && state.d >= 1 && state.d <= 10
    && Number.isFinite(state.s) && state.s >= 0.01 && state.s <= 1_000_000
    && Number.isSafeInteger(state.reps) && state.reps >= 0 && Number.isSafeInteger(state.lapses) && state.lapses >= 0
    && instant(state.lastReviewedAt) && instant(state.dueAt);
}

export function evaluateContract(contract, candidate) {
  const failures = [];
  const results = [];
  const vectors = contract.vectors ?? [];
  if (vectors.length !== EXPECTED.contract || new Set(vectors.map((v) => v.id)).size !== vectors.length) {
    failures.push({ where: "contract", kind: "vector-count", message: `${vectors.length} vectors` });
  }
  let assertions = 0;
  for (const v of vectors) {
    const config = v.config === "product" ? candidate.PRODUCT_CONFIG : v.config === "oracle-parity" ? candidate.ORACLE_PARITY_CONFIG : null;
    if (!config) { failures.push({ where: v.id, kind: "config" }); continue; }
    const prior = decodePrior(v.prior);
    const before = structuredClone(prior);
    const r = call(candidate, () => candidate.decideFsrs(prior, v.rating, v.now, config), failures, v.id);
    try { assert.deepEqual(prior, before); } catch { failures.push({ where: v.id, kind: "mutated-prior" }); }
    const fail = (key, expected, actual) => failures.push({ where: v.id, kind: key, expected, actual });
    const e = v.expect;
    if (r.threw) continue;
    if (e.refusal) {
      assertions += 1;
      if (r.refusal !== e.refusal) fail("refusal", e.refusal, r.refusal ?? r.value?.state);
      results.push({ id: v.id, refusal: r.refusal ?? null });
      continue;
    }
    if (!r.value) { fail("unexpected-refusal", null, r.refusal); continue; }
    const { state, path, elapsedDays, intervalDays } = r.value;
    const again = call(candidate, () => candidate.decideFsrs(prior, v.rating, v.now, config), failures, `${v.id}/determinism`);
    try { assert.deepEqual(again.value, r.value); } catch { failures.push({ where: v.id, kind: "nondeterministic" }); }
    if (!isValidNextPrior(state)) fail("invalid-output-state", "valid prior", state);
    const check = (key, actual) => {
      if (!Object.hasOwn(e, key)) return;
      assertions += 1;
      if (actual !== e[key]) fail(key, e[key], actual);
    };
    check("elapsedDays", elapsedDays);
    check("path", path);
    check("dueAt", state.dueAt);
    check("lapsesDelta", state.lapses - (prior?.lapses ?? 0));
    check("intervalDays", intervalDays);
    check("s", state.s);
    check("reps", state.reps);
    if (Object.hasOwn(e, "successorAccepted") || Object.hasOwn(e, "successorRefusal")) {
      assertions += 1;
      const next = call(candidate, () => candidate.decideFsrs(state, "good", plus(state.lastReviewedAt, DAY), config), failures, `${v.id}/successor`);
      if (e.successorAccepted && !next.value) fail("successorAccepted", true, next.refusal);
      if (e.successorRefusal && next.refusal !== e.successorRefusal) fail("successorRefusal", e.successorRefusal, next.refusal ?? next.value?.state);
    }
    results.push({ id: v.id, path, elapsedDays, intervalDays, state });
  }
  return { vectors: vectors.length, assertions, failures, results };
}

// ---------------------------------------------------------------- 2. phase A histories

export function evaluatePhaseA(fixtures, simple, localDays, candidate) {
  const failures = [];
  const histories = [];
  const differences = { sameInterval: 0, differentInterval: 0, lapseCountDiffers: 0, needsTransition: 0, sameRefusal: 0, notReachedAfterRefusal: 0 };
  let baseline;
  try {
    validateFixtures(fixtures);
    baseline = compareFixtures(fixtures, simple, localDays);
  } catch (error) {
    failures.push({ where: "simple-v1", kind: "baseline-mismatch", message: error.message });
    return { failures, histories, differences };
  }
  if (baseline.cases.length !== EXPECTED.phaseAHistories) failures.push({ where: "phase-a", kind: "history-count", message: `${baseline.cases.length}` });
  const config = candidate.PRODUCT_CONFIG;
  for (const [ci, c] of fixtures.cases.entries()) {
    const simpleObs = baseline.cases[ci].observations;
    let prior = structuredClone(c.prior);
    let stopped = null;
    const rows = [];
    for (const [i, review] of c.reviews.entries()) {
      const where = `${c.id}#${i}`;
      const s = simpleObs[i];
      if (stopped) { differences.notReachedAfterRefusal += 1; rows.push({ i, simple: s.refusal ?? s.intervalMs, candidate: `not reached (${stopped})` }); continue; }
      const before = structuredClone(prior);
      const r = call(candidate, () => candidate.decideFsrs(prior, review.rating, review.at, config), failures, where);
      try { assert.deepEqual(prior, before); } catch { failures.push({ where, kind: "mutated-prior" }); }
      if (r.threw) { stopped = "threw"; continue; }
      if (r.refusal) {
        stopped = r.refusal;
        let kind;
        if (s.refusal === r.refusal) { kind = "same-refusal"; differences.sameRefusal += 1; }
        else if (r.refusal === "UNSUPPORTED_SCHEDULER_VERSION" && prior?.schedulerVersion === "simple-v1") { kind = "needs-transition"; differences.needsTransition += 1; }
        else { kind = "unexpected-refusal"; failures.push({ where, kind, simple: s.refusal ?? s.state, candidate: r.refusal }); }
        rows.push({ i, simple: s.refusal ?? s.intervalMs, candidate: r.refusal, kind });
        continue;
      }
      if (s.refusal) { failures.push({ where, kind: "candidate-accepted-a-simple-refusal", simple: s.refusal }); stopped = "diverged"; continue; }
      const { state } = r.value;
      if (!isValidNextPrior(state)) failures.push({ where, kind: "invalid-output-state", actual: state });
      const intervalMs = Date.parse(state.dueAt) - Date.parse(review.at);
      if (intervalMs <= 0 || intervalMs > 180 * DAY) failures.push({ where, kind: "interval-outside-product-range", intervalMs });
      if (state.reps !== (prior?.reps ?? 0) + 1) failures.push({ where, kind: "reps" });
      if (intervalMs === s.intervalMs) differences.sameInterval += 1; else differences.differentInterval += 1;
      if (state.lapses !== s.state.lapses) differences.lapseCountDiffers += 1;
      rows.push({ i, rating: review.rating, simpleDays: s.intervalMs / DAY, candidateDays: intervalMs / DAY, simpleLapses: s.state.lapses, candidateLapses: state.lapses, d: state.d, s: state.s, path: r.value.path });
      prior = state;
    }
    histories.push({ id: c.id, historyClass: c.historyClass, reviews: c.reviews.length, rows });
  }
  return { failures, histories, differences };
}

// ---------------------------------------------------------------- 3. transition simulations

function counting(candidate) {
  const counter = { calls: 0 };
  const proxy = { ...candidate, scheduleFsrs: (...args) => { counter.calls += 1; return candidate.scheduleFsrs(...args); } };
  return { proxy, counter };
}
const freeze = (value) => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

export function runTransitions(candidate, simple, fixtures) {
  const config = candidate.PRODUCT_CONFIG;
  const source = fixtures.cases.find((c) => c.id === "lapse-and-relearn");
  const events = source.reviews.map((r) => ({ rating: r.rating, at: r.at }));
  let simpleState = null;
  for (const e of events) simpleState = simple.scheduleCard(simpleState, e.rating, e.at);
  const replay = (list) => list.reduce((s, e) => candidate.scheduleFsrs(s, e.rating, e.at, config), null);
  const full = replay(events);
  const suffix = events.slice(-4);
  const partial = replay(suffix);
  const card = (over = {}) => ({ cardId: "card-1", generation: 7, flagged: false, suspended: false, schedule: simpleState, ...over });
  const req = (id, over = {}, history = { retention: "complete", events }) => freeze(structuredClone({ operationId: id, expectedGeneration: 7, card: card(over.card), history, ...over.top }));
  const run = (request, ledger = {}, cand = candidate) => transitionCard(ledger, request, cand, config);
  const cases = [];
  const add = (id, contract, fn) => {
    try { fn(); cases.push({ id, contract, pass: true }); }
    catch (error) { cases.push({ id, contract, pass: false, message: error.message }); }
  };

  add("retained-complete-history", "replayed under the candidate; method reconstructed", () => {
    const { outcome } = run(req("op-complete"));
    assert.equal(outcome.status, "applied");
    assert.equal(outcome.method, "reconstructed");
    assert.equal(outcome.reconstructed, true);
    assert.deepEqual({ ...outcome.card.schedule, dueAt: full.dueAt }, full);
    assert.equal(outcome.card.generation, 8);
  });
  add("retained-partial-history", "fallback replay of the retained suffix, marked not-reconstructed; counters kept", () => {
    const { outcome } = run(req("op-partial", {}, { retention: "partial", events: suffix }));
    assert.equal(outcome.method, "partial-fallback");
    assert.equal(outcome.reconstructed, false);
    assert.equal(outcome.card.schedule.d, partial.d);
    assert.equal(outcome.card.schedule.s, partial.s);
    assert.equal(outcome.card.schedule.reps, simpleState.reps);
    assert.equal(outcome.card.schedule.lapses, simpleState.lapses);
    assert.notDeepEqual([partial.d, partial.s], [full.d, full.s], "fallback must be visibly different from reconstruction here");
  });
  add("erased-history", "stays erased; the card starts new", () => {
    const { outcome } = run(req("op-erased", {}, { retention: "erased", events: [] }));
    assert.equal(outcome.method, "erased-starts-new");
    assert.equal(outcome.card.schedule, null);
    assert.equal(outcome.historyEvents, 0);
    const refused = run(req("op-erased-2", {}, { retention: "erased", events })).outcome;
    assert.equal(refused.code, "HISTORY_INCONSISTENT", "erased history cannot be resurrected");
  });
  add("unknown-version", "refused", () => {
    const { outcome } = run(req("op-unknown", { card: { schedule: { ...simpleState, schedulerVersion: "not-adopted" } } }));
    assert.deepEqual(outcome, { status: "refused", code: "UNSUPPORTED_SCHEDULER_VERSION" });
  });
  add("unreviewed-state", "no-op; stays new", () => {
    const { outcome } = run(req("op-unreviewed", { card: { schedule: null } }, { retention: "complete", events: [] }));
    assert.equal(outcome.status, "no-op");
    assert.equal(outcome.card.schedule, null);
    assert.equal(outcome.card.generation, 7);
  });
  add("already-transitioned", "no-op", () => {
    const { outcome } = run(req("op-again", { card: { schedule: full } }));
    assert.equal(outcome.status, "no-op");
    assert.deepEqual(outcome.card.schedule, full);
  });
  add("flagged-card", "flag kept; schedule transitioned", () => {
    const { outcome } = run(req("op-flagged", { card: { flagged: true } }));
    assert.equal(outcome.card.flagged, true);
    assert.equal(outcome.card.suspended, false);
    assert.equal(outcome.method, "reconstructed");
  });
  add("suspended-card", "suspension kept (not lifted); schedule transitioned", () => {
    const { outcome } = run(req("op-suspended", { card: { suspended: true } }));
    assert.equal(outcome.card.suspended, true);
    assert.equal(outcome.card.schedule.dueAt, simpleState.dueAt);
  });
  add("stale-generation", "refused; refusal stored under its operation ID", () => {
    const { outcome, ledger } = run(req("op-stale", { top: { expectedGeneration: 6 } }));
    assert.deepEqual(outcome, { status: "refused", code: "STALE_GENERATION" });
    assert.deepEqual(ledger["op-stale"], outcome);
  });
  add("repeated-operation-id", "the stored result is replayed, not recomputed", () => {
    const { proxy, counter } = counting(candidate);
    const first = run(req("op-repeat"), {}, proxy);
    const callsAfterFirst = counter.calls;
    assert(callsAfterFirst > 0);
    const second = run(req("op-repeat", {}, { retention: "erased", events: [] }), first.ledger, proxy);
    assert.equal(second.replayed, true);
    assert.equal(second.outcome, first.outcome, "the very stored object is returned");
    assert.equal(counter.calls, callsAfterFirst, "nothing was recomputed");
  });
  add("pending-due-instant", "kept until the next real review, then replaced by the candidate", () => {
    const { outcome } = run(req("op-due"));
    assert.equal(outcome.card.schedule.dueAt, simpleState.dueAt);
    assert.notEqual(simpleState.dueAt, full.dueAt, "the kept due differs from a recomputed one here");
    const at = simpleState.dueAt;
    const next = reviewAfterTransition(outcome.card.schedule, "good", at, candidate, config);
    assert.equal(next.reps, outcome.card.schedule.reps + 1);
    assert.equal(next.lastReviewedAt, at);
    assert.equal(next.dueAt, candidate.scheduleFsrs({ ...outcome.card.schedule }, "good", at, config).dueAt);
  });
  add("inconsistent-complete-history", "refused when the history does not account for the state", () => {
    const { outcome } = run(req("op-gap", {}, { retention: "complete", events: events.slice(1) }));
    assert.equal(outcome.code, "HISTORY_INCONSISTENT");
  });
  add("pure-and-deterministic", "frozen inputs are untouched and two runs agree", () => {
    const a = run(req("op-pure"));
    const b = run(req("op-pure"));
    assert.deepEqual(a, b);
  });
  return { cases, passed: cases.filter((c) => c.pass).length, failed: cases.filter((c) => !c.pass).length };
}

// ---------------------------------------------------------------- whole run

export async function runPhaseB2({ preregDir = PREREG_DIR, candidatePath = CANDIDATE_PATH, candidate: override, mutateInputs } = {}) {
  const started = performance.now();
  try {
    const frozen = verifyProvenance(preregDir);
    const inputs = mutateInputs ? mutateInputs(structuredClone(frozen)) : frozen;
    const loaded = override ? { module: override, sha256: "override" } : await loadCandidate(candidatePath);
    const candidate = loaded.module;
    const fixturesBytes = readFileSync(join(PHASE_A_DIR, "fixtures.json"));
    assert.equal(sha256(fixturesBytes), PINS.phaseAFixtures, "Phase A fixtures differ from the reviewed digest");
    assert.equal(sha256(readFileSync(join(PHASE_A_DIR, "required-inputs.json"))), PINS.phaseARequiredInputs, "Phase A required inputs differ");
    const fixtures = JSON.parse(fixturesBytes);
    const simple = await loadProduction(PINS.simpleV1);
    const localDays = await loadProduction(PINS.localDay);
    assert.equal(simple.SCHEDULER_VERSION, "simple-v1");

    const t0 = performance.now();
    const reference = evaluateReference(inputs.reference, inputs.scenarios, candidate);
    const contract = evaluateContract(inputs.contract, candidate);
    const t1 = performance.now();
    const phaseA = evaluatePhaseA(fixtures, simple, localDays, candidate);
    const transitions = runTransitions(candidate, simple, fixtures);
    const t2 = performance.now();
    const failureCount = reference.failures.length + contract.failures.length + phaseA.failures.length + transitions.failed;
    return {
      schema: "hfd-fsrs6-phase-b2-results/1",
      status: failureCount === 0 ? "PASS" : "FAIL",
      scope: "Synthetic, disposable comparison only. Production stays on simple-v1; no migration or adoption.",
      candidateSha256: loaded.sha256,
      oracle: PINS.oracleLabel,
      summary: {
        failures: failureCount,
        reference: { ...reference.counts, failures: reference.failures.length, deviations: tally(reference.deviations), limitations: reference.limitations.length, notComparableIntervals: reference.notComparable },
        contract: { vectors: contract.vectors, assertions: contract.assertions, failures: contract.failures.length },
        phaseA: { histories: phaseA.histories.length, reviews: phaseA.histories.reduce((n, h) => n + h.reviews, 0), correctnessFailures: phaseA.failures.length, intendedDifferences: phaseA.differences },
        transitions: { cases: transitions.cases.length, passed: transitions.passed, failed: transitions.failed },
      },
      reference: { failures: reference.failures, deviations: reference.deviations, limitations: reference.limitations },
      contract: { failures: contract.failures, results: contract.results },
      phaseA,
      transitions: transitions.cases,
      timing: { evaluationMs: round(t2 - t0), vectorMs: round(t1 - t0), phaseAAndTransitionsMs: round(t2 - t1), totalMs: round(performance.now() - started) },
      environment: environment(),
    };
  } catch (error) {
    return { schema: "hfd-fsrs6-phase-b2-results/1", status: "FAIL", refused: true, message: error.message };
  }
}

const round = (ms) => Math.round(ms * 10) / 10;
const tally = (list) => list.reduce((acc, x) => ({ ...acc, [x.deviation]: (acc[x.deviation] ?? 0) + 1 }), {});
export function environment() {
  return {
    node: process.version, typescript: ts.version, platform: platform(), osRelease: release(), arch: arch(),
    cpu: cpus()[0]?.model ?? "unknown", cpuCount: cpus().length,
    unmeasured: ["memory use", "native (Rust) parity and responsiveness", "installed-app responsiveness"],
  };
}

// ---------------------------------------------------------------- 4. negative controls

/** Each control works on a disposable copy or in-memory clone; every one must make the runner refuse success. */
export async function negativeControls() {
  const { module: candidate } = await loadCandidate();
  const temp = mkdtempSync(join(tmpdir(), "hfd-fsrs-b2-controls-"));
  const copy = (name) => { const dir = join(temp, name); cpSync(PREREG_DIR, dir, { recursive: true }); return dir; };
  const editJson = (dir, file, fn) => { const p = join(dir, file); const data = JSON.parse(readFileSync(p, "utf8")); fn(data); writeFileSync(p, JSON.stringify(data, null, 2) + "\n"); };
  const controls = [];
  const record = async (id, how, run) => {
    const result = await run();
    controls.push({ id, how, refused: result.status !== "PASS", reason: result.message ?? firstFailure(result) });
  };
  try {
    await record("wrong-expectation-in-memory", "one contract dueAt changed by 1 ms in an in-memory clone", () =>
      runPhaseB2({ mutateInputs: (i) => { i.contract.vectors.find((v) => v.id === "product-cap-180-days").expect.dueAt = "2027-04-17T15:00:00.001Z"; return i; } }));
    await record("wrong-expectation-in-copy", "the same change written to a disposable copy of the frozen folder", () => {
      const dir = copy("wrong");
      editJson(dir, "contract-vectors.json", (c) => { c.vectors.find((v) => v.id === "product-cap-180-days").expect.dueAt = "2027-04-17T15:00:00.001Z"; });
      return runPhaseB2({ preregDir: dir });
    });
    await record("wrong-oracle-value-in-memory", "one reference d nudged by 0.01 in an in-memory clone", () =>
      runPhaseB2({ mutateInputs: (i) => { i.reference.vectors[0].steps[0].outputs.good.d += 0.01; return i; } }));
    await record("missing-contract-vector", "one contract vector removed from an in-memory clone", () =>
      runPhaseB2({ mutateInputs: (i) => { i.contract.vectors.pop(); return i; } }));
    await record("missing-reference-vector", "one reference vector removed from an in-memory clone", () =>
      runPhaseB2({ mutateInputs: (i) => { i.reference.vectors.splice(3, 1); return i; } }));
    await record("missing-vector-in-copy", "one contract vector removed from a disposable copy", () => {
      const dir = copy("missing");
      editJson(dir, "contract-vectors.json", (c) => { c.vectors.pop(); });
      return runPhaseB2({ preregDir: dir });
    });
    await record("candidate-throws", "the candidate throws a plain Error on its 50th call", () => {
      let n = 0;
      const decideFsrs = (...a) => { n += 1; if (n === 50) throw new Error("injected candidate failure"); return candidate.decideFsrs(...a); };
      return runPhaseB2({ candidate: { ...candidate, decideFsrs } });
    });
    await record("oracle-byte-flipped-and-inventory-rewritten", "one oracle byte flipped in a copy and PREREGISTRATION.sha256 rewritten to match", () => {
      const dir = copy("oracle");
      const p = join(dir, "oracle/fsrs4anki_scheduler.js");
      const bytes = readFileSync(p); bytes[bytes.length - 2] ^= 1; writeFileSync(p, bytes);
      const shaPath = join(dir, "PREREGISTRATION.sha256");
      writeFileSync(shaPath, readFileSync(shaPath, "utf8").replace(/^[a-f0-9]{64}(?= {2}oracle\/fsrs4anki_scheduler\.js$)/m, sha256(bytes)));
      return runPhaseB2({ preregDir: dir });
    });
    await record("oracle-byte-flipped", "one oracle byte flipped in a copy, inventories untouched", () => {
      const dir = copy("oracle2");
      const p = join(dir, "oracle/fsrs4anki_scheduler.js");
      const bytes = readFileSync(p); bytes[bytes.length - 2] ^= 1; writeFileSync(p, bytes);
      return runPhaseB2({ preregDir: dir });
    });
    await record("provenance-label-mismatch", "reference vectors claim a different oracle in an in-memory clone", () =>
      runPhaseB2({ mutateInputs: (i) => { i.reference.oracle = "fsrs4anki v6.1.1"; return i; } }));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  return { status: controls.every((c) => c.refused) ? "PASS" : "FAIL", controls };
}

function firstFailure(result) {
  const all = [...(result.reference?.failures ?? []), ...(result.contract?.failures ?? []), ...(result.phaseA?.failures ?? []), ...(result.transitions ?? []).filter((t) => !t.pass)];
  const f = all[0];
  return f ? `${f.where ?? f.id}: ${f.kind ?? f.message}` : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    assert(args.length === 0 || (args.length === 1 && args[0] === "--controls"), "Usage: node runner.mjs [--controls]");
    const result = args[0] === "--controls" ? await negativeControls() : await runPhaseB2();
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "PASS") process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: "FAIL", message: error.message }));
    process.exitCode = 1;
  }
}
