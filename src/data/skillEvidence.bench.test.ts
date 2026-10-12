/**
 * Source-level timings of the production M3 transaction, readers and
 * whole-database validation (Node 22 on this Mac; not WKWebView, not an
 * installed app). Opt-in: M3_BENCH=1, with M3_BENCH_OUT naming the JSON file
 * to write. The same workload as the accepted prototype benchmark, including
 * a second page read after 100 wording edits since its cursor's fence (the
 * stale-cursor check) and a walk of one observation's 1,000 revisions at 100
 * per page.
 *
 * Dataset per size: 15 built-in + 200 custom skills, 400 debriefs, N
 * observations written through the real production transaction (one act each),
 * spread over 120 observed dates with tied timestamps in every batch of 25.
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validateApplicationDatabase } from "./practiceStateValidation";
import { openEngine, openStore, schemaReference, uuid, type EngineName } from "./testing/skillEvidenceEngines";

const SIZES = [100, 2_500, 5_000, 10_000];
const OUT = process.env["M3_BENCH_OUT"];

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
        const store = await openStore(engine);
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
        // A second page after 100 edits committed since its cursor's fence (none crosses it).
        const firstOfTwo = await store.page({ limit: 20 });
        const half = await store.page({ limit: 50 });
        const edited = [...half.items, ...(half.nextCursor ? (await store.page({ limit: 50, cursor: half.nextCursor })).items : [])];
        for (const item of edited) {
          await store.act({
            action: "edit_observation", operationId: uuid(), observationId: item.id, expectedRevision: item.revision,
            wording: `${item.wording} (reworded)`, observedOn: item.observedOn, attribution: item.attribution, instructorName: item.instructorName,
          });
        }
        const afterEdits: number[] = [];
        for (let r = 0; r < 20; r++) afterEdits.push((await time(() => store.page({ limit: 20, cursor: firstOfTwo.nextCursor })))[0]);
        const reference = await schemaReference();
        const [validateMs] = await time(() => validateApplicationDatabase((s, p) => engine.query(s, p), reference));
        const row = {
          engine: engineName, observations: size, skills: skills.length, debriefs: 400,
          write: stats(writes), firstPage20: stats(firstPage), skillPage20: stats(skillPage), summary: stats(summary),
          fullWalk50: { pages: walk.length, ...stats(walk), totalMs: +walk.reduce((a, b) => a + b, 0).toFixed(1) },
          restoreValidationMs: +validateMs.toFixed(1),
          secondPageAfter100Edits: stats(afterEdits),
        };
        results.push(row);
        console.log(JSON.stringify(row));
        engine.close();
      }
    }
    // One observation with 1,000 revisions, walked at 100 per page to revision 1.
    const history: unknown[] = [];
    for (const engineName of ["node:sqlite", "sql.js"] as EngineName[]) {
      const engine = await openEngine(engineName);
      const store = await openStore(engine);
      engine.run("INSERT INTO journal_entries (id, date, title, created_at, updated_at) VALUES ('bench-j', '2026-09-01', 'Lesson', 'x', 'x')", []);
      const observationId = uuid();
      await store.act({
        action: "create_observation", operationId: uuid(), observationId, skillId: "builtin.normal_landing", journalId: "bench-j",
        sourceField: "none", wording: "Revision 1", observedOn: "2026-09-01", attribution: "self_report", instructorName: "",
      });
      for (let revision = 1; revision < 1000; revision++) {
        await store.act({
          action: "edit_observation", operationId: uuid(), observationId, expectedRevision: revision,
          wording: `Revision ${revision + 1}`, observedOn: "2026-09-01", attribution: "self_report", instructorName: "",
        });
      }
      const pages: number[] = [];
      let cursor: string | null = null;
      let seen = 0;
      let earliest = "";
      do {
        const [ms, page] = await time(() => store.history({ observationId, cursor, limit: 100 }));
        pages.push(ms);
        seen += page.items.length;
        earliest = page.items.at(-1)?.wording ?? earliest;
        cursor = page.nextCursor;
      } while (cursor);
      expect([seen, earliest]).toEqual([1000, "Revision 1"]);
      const row = { engine: engineName, revisions: 1000, historyWalk100: { pages: pages.length, ...stats(pages), totalMs: +pages.reduce((a, b) => a + b, 0).toFixed(1) } };
      history.push(row);
      console.log(JSON.stringify(row));
      engine.close();
    }
    if (OUT) writeFileSync(OUT, `${JSON.stringify({ node: process.version, platform: `${process.platform}-${process.arch}`, results, history }, null, 2)}\n`);
  }, 900_000);
});
