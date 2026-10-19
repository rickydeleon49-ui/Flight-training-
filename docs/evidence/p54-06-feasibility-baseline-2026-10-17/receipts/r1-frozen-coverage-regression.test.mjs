// Run from the reviewed repository root using Node 22. No repository writes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const base = join(process.cwd(), "docs/evidence/p54-06-feasibility-baseline-2026-10-17");
const runner = join(base, "proof/baseline.mjs");
function input() { return JSON.parse(readFileSync(join(base, "fixtures.json"), "utf8")); }
function run(mutated) {
  const temp = mkdtempSync(join(tmpdir(), "hfd-pr210-frozen-"));
  try {
    const file = join(temp, "fixture.json");
    writeFileSync(file, JSON.stringify(mutated));
    return spawnSync(process.execPath, [runner, "--fixtures", file], { encoding: "utf8" });
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
function refused(result) {
  assert.equal(result.status, 1, "A rewritten required corpus must refuse, not report baseline PASS");
  assert.equal(result.stdout, "", "No partial PASS output is permitted");
  assert.equal(JSON.parse(result.stderr).status, "FAIL");
}

test("control: registered corpus still passes with all 78 observations", () => {
  const result = run(input());
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "PASS");
  assert.equal(output.reviewCount, 78);
});

test("P54BASE-R1: retaining IDs cannot hide deleted review transitions", () => {
  const fixture = input();
  for (const c of fixture.cases) c.reviews = c.reviews.slice(0, 1);
  refused(run(fixture));
});

test("P54BASE-R1: retaining IDs/counts cannot replace DST and travel with UTC", () => {
  const fixture = input();
  for (const c of fixture.localDays) {
    c.zone = "UTC";
    c.expectedDate = c.at.slice(0, 10);
    const midnight = new Date(c.at);
    midnight.setUTCDate(midnight.getUTCDate() + 1);
    midnight.setUTCHours(0, 0, 0, 0);
    c.expectedNextMidnight = midnight.toISOString();
  }
  refused(run(fixture));
});
