/**
 * Source-level timings (Node 22 on this Mac; not WKWebView, not an installed
 * app). Opt-in: M3_BENCH=1. Writes receipts/bench-results.json.
 *
 * Dataset per size: 15 built-in + 200 custom skills, 400 debriefs, N
 * observations written through the real candidate transaction (one act each),
 * spread over 120 observed dates with tied timestamps in every batch of 25.
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { openCandidateStore, openEngine, type EngineName } from "../prototype/candidateEngine";
import { validateCandidateDatabase } from "../prototype/skillEvidenceValidation";
import { candidateReference } from "../prototype/candidateEngine";
import { uuid } from "./helpers";

const SIZES = [100, 2_500, 5_000, 10_000];
const OUT = `${process.cwd()}/docs/evidence/m3-skills-evidence-scope-2026-10-10/receipts/bench-results.json`;

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return { n: samples.length, medianMs: +at(0.5).toFixed(3), p95Ms: +at(0.95).toFixed(3), maxMs: +sorted.at(-1)!.toFixed(3) };
}

async function time<T>(fn: () => Promise<T>): Promise<[number, T]> {
  const start = performance.now();
  const value = await fn();
  return [performance.now() - start, value];
}

describe.runIf(process.env["M3_BENCH"] === "1")("benchmarks", () => {
  it("records timings for 100 / 2,500 / 5,000 / 10,000 observations on both engines", async () => {
    const results: unknown[] = [];
    for (const engineName of ["node:sqlite", "sql.js"] as EngineName[]) {
      for (const size of SIZES) {
        const engine = await openEngine(engineName);
        const store = await openCandidateStore(engine);
        const skills = (await store.skills()).map((s) => s.id);
        for (let i = 0; i < 200; i++) {
          const skillId = `custom.${uuid()}`;
          await store.act({ action: "create_custom_skill", operationId: uuid(), skillId, label: `Bench skill ${i}`, description: "", topic: "general" });
          skills.push(skillId);
        }
        const journals: string[] = [];
        for (let j = 0; j < 400; j++) {
          const id = uuid();
          engine.run("INSERT INTO journal_entries (id, date, title, created_at, updated_at) VALUES (?, '2026-09-01', ?, 'x', 'x')", [id, `Lesson ${j}`]);
          journals.push(id);
        }
        const writes: number[] = [];
        for (let i = 0; i < size; i++) {
          const day = String((i % 120) + 1).padStart(3, "0");
          const observedOn = new Date(Date.UTC(2026, 0, 1) + (Number(day) - 1) * 86_400_000).toISOString().slice(0, 10);
          const stamp = new Date(Date.UTC(2026, 5, 1) + Math.floor(i / 25) * 1000).toISOString();
          const [ms] = await time(() =>
            store.act(
              {
                action: "create_observation", operationId: uuid(), observationId: uuid(), skillId: skills[i % 40]!, journalId: journals[i % 400]!,
                sourceField: "none", wording: `Synthetic observation ${i}: hold the centerline and look further down the runway.`, observedOn,
                attribution: i % 3 === 0 ? "self_report" : "instructor_transcribed", instructorName: i % 3 === 0 ? "" : "Synthetic CFI",
              },
              { now: () => stamp },
            ),
          );
          writes.push(ms);
        }
        const firstPage: number[] = [];
        const skillPage: number[] = [];
        const summary: number[] = [];
        for (let r = 0; r < 20; r++) {
          firstPage.push((await time(() => store.page({ limit: 20 })))[0]);
          skillPage.push((await time(() => store.page({ skillId: skills[r % 40]!, limit: 20 })))[0]);
          summary.push((await time(() => store.summary(skills[r % 40]!)))[0]);
        }
        // Walk the whole history at 50 per page.
        const walk: number[] = [];
        let cursor: string | null = null;
        let seen = 0;
        do {
          const [ms, page] = await time(() => store.page({ limit: 50, cursor }));
          walk.push(ms);
          seen += page.items.length;
          cursor = page.nextCursor;
        } while (cursor);
        expect(seen).toBe(size);
        const reference = await candidateReference();
        const [validateMs] = await time(() => validateCandidateDatabase((s, p) => engine.query(s, p), reference));
        const row = {
          engine: engineName, observations: size, skills: skills.length, debriefs: 400,
          write: stats(writes), firstPage20: stats(firstPage), skillPage20: stats(skillPage), summary: stats(summary),
          fullWalk50: { pages: walk.length, ...stats(walk), totalMs: +walk.reduce((a, b) => a + b, 0).toFixed(1) },
          restoreValidationMs: +validateMs.toFixed(1),
        };
        results.push(row);
        console.log(JSON.stringify(row));
        engine.close();
      }
    }
    writeFileSync(OUT, `${JSON.stringify({ node: process.version, platform: `${process.platform}-${process.arch}`, results }, null, 2)}\n`);
  }, 900_000);
});
