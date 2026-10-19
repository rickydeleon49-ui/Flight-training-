/**
 * Disposable evaluation tooling. Never imported by the application.
 *
 * Runs the pinned, unmodified FSRS4Anki scheduler (fsrs4anki v6.1.3, blob
 * 724a2f4) as an independent FSRS-6 reference. The script expects Anki's
 * custom-scheduling globals, so it runs in an isolated vm context with plain
 * stand-ins for `states`, `customData` and `ctx`. It has no network or file
 * access; the context exposes nothing else.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";

export const ORACLE = new URL("../oracle/fsrs4anki_scheduler.js", import.meta.url);
export const ORACLE_GIT_BLOB = "724a2f445adfffb2cc3d7fae7a96ab37b948561c";
export const ORACLE_SHA256 = "f323accb38ee17c792a7685a9c9ac7f5e7c3c7b9544d6e5f8a01e68000f1b84e";
export const RATINGS = ["again", "hard", "good", "easy"];

const gitBlob = (bytes) =>
  createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

/** Read the oracle and refuse it unless both identities match the pin. */
export function loadOracle(url = ORACLE) {
  const bytes = readFileSync(url);
  assert.equal(gitBlob(bytes), ORACLE_GIT_BLOB, "Oracle differs from the pinned Git blob");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), ORACLE_SHA256, "Oracle differs from the pinned SHA-256");
  return new vm.Script(`(function () {\n${bytes.toString("utf8")}\n})();`, { filename: "fsrs4anki_scheduler.js" });
}

const memory = (d, s) => Object.fromEntries(RATINGS.map((r) => [r, d === undefined ? {} : { d, s }]));
const slot = () => ({ normal: { review: { scheduledDays: null } } });

/**
 * One scheduler call. `phase` is the Anki card kind the script branches on:
 * "new", "learning" (same-day short-term path) or "review". Returns the
 * memory state the script wrote for each rating and the review intervals it
 * set (null where the script leaves the interval to Anki's learning steps).
 */
export function runOracle(script, { phase, prior, elapsedDays, scheduledDays, seed }) {
  const current =
    phase === "new" ? { normal: { new: {} } }
    : phase === "learning" ? { normal: { learning: {} } }
    : { normal: { review: { elapsedDays, scheduledDays, easeFactor: 2.5 } } };
  const sandbox = {
    states: { current, again: slot(), hard: slot(), good: slot(), easy: slot() },
    customData: prior ? memory(prior.d, prior.s) : memory(),
    ctx: { deckName: "global config for FSRS4Anki", seed },
  };
  script.runInNewContext(sandbox, { timeout: 1000 });
  const out = {};
  for (const r of RATINGS) {
    out[r] = {
      d: sandbox.customData[r].d,
      s: sandbox.customData[r].s,
      scheduledDays: sandbox.states[r].normal.review.scheduledDays,
    };
  }
  return out;
}
