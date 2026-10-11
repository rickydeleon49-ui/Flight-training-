/**
 * Keyset pagination of the evidence history: tied dates and timestamps,
 * filters, rows added and erased between pages, and the index the query uses.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { Engine, EngineName } from "../prototype/candidateEngine";
import { pageQuery } from "../prototype/skillEvidenceReader";
import { candidateWithDebrief, clock, observation, uuid } from "./helpers";

const engines: EngineName[] = ["node:sqlite", "sql.js"];
const open: Engine[] = [];
afterEach(() => {
  for (const e of open.splice(0)) e.close();
});

async function walk(store: Awaited<ReturnType<typeof candidateWithDebrief>>["store"], input: Parameters<typeof store.page>[0]) {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await store.page({ ...input, cursor });
    ids.push(...page.items.map((i) => i.id));
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor && pages < 1000);
  return { ids, pages };
}

describe.each(engines)("evidence history pages (%s)", (name) => {
  it("walks 53 observations sharing one date and one timestamp without gaps or repeats", async () => {
    const ctx = await candidateWithDebrief(name);
    open.push(ctx.engine);
    const c = clock(); // never advanced: every row has the same created_at
    const journals = [ctx.journalId];
    for (let j = 0; j < 2; j++) {
      const id = uuid();
      ctx.engine.run("INSERT INTO journal_entries (id, date, title, created_at, updated_at) VALUES (?, '2026-10-01', 'Extra', 'x', 'x')", [id]);
      journals.push(id);
    }
    const created: string[] = [];
    for (let i = 0; i < 53; i++) {
      const o = observation("builtin.normal_landing", journals[i % 3]!, { sourceField: "none", wording: `Note ${i}` });
      await ctx.store.act(o, { now: c.now });
      created.push(o.observationId);
    }
    const { ids, pages } = await walk(ctx.store, { limit: 10 });
    expect(pages).toBe(6);
    expect(new Set(ids).size).toBe(53);
    expect(ids).toEqual([...created].sort().reverse()); // id breaks the tie, descending
  });

  it("orders by observed date, then recording time, newest first; filters by skill, debrief and attribution", async () => {
    const ctx = await candidateWithDebrief(name);
    open.push(ctx.engine);
    const c = clock();
    const add = async (skillId: string, observedOn: string, attribution: "self_report" | "instructor_transcribed") => {
      c.advance();
      const o = observation(skillId, ctx.journalId, {
        observedOn, attribution, instructorName: attribution === "self_report" ? "" : "Synthetic CFI", sourceField: "none", wording: `${skillId} ${observedOn}`,
      });
      await ctx.store.act(o, { now: c.now });
      return o.observationId;
    };
    const a = await add("builtin.normal_landing", "2026-09-01", "self_report");
    const b = await add("builtin.normal_landing", "2026-10-02", "instructor_transcribed");
    const d = await add("builtin.go_around", "2026-10-02", "self_report");
    const e = await add("builtin.normal_landing", "2026-09-15", "instructor_transcribed");
    expect((await walk(ctx.store, { limit: 2 })).ids).toEqual([d, b, e, a]);
    expect((await walk(ctx.store, { skillId: "builtin.normal_landing", limit: 1 })).ids).toEqual([b, e, a]);
    expect((await walk(ctx.store, { skillId: "builtin.normal_landing", attribution: "self_report" })).ids).toEqual([a]);
    expect((await walk(ctx.store, { journalId: ctx.journalId, attribution: "instructor_transcribed" })).ids).toEqual([b, e]);
  });

  it("rows added or erased between pages never shift what the next page returns", async () => {
    const ctx = await candidateWithDebrief(name);
    open.push(ctx.engine);
    const c = clock();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      c.advance();
      const o = observation("builtin.normal_landing", ctx.journalId, { sourceField: "none", wording: `Old ${i}` });
      await ctx.store.act(o, { now: c.now });
      ids.unshift(o.observationId);
    }
    const first = await ctx.store.page({ limit: 3 });
    expect(first.items.map((i) => i.id)).toEqual(ids.slice(0, 3));
    // A newer observation and an erased one on the already-seen page.
    c.advance();
    await ctx.store.act(observation("builtin.normal_landing", ctx.journalId, { sourceField: "none", wording: "Newer" }), { now: c.now });
    await ctx.store.act({ action: "erase_observation", operationId: uuid(), observationId: ids[1]!, confirm: "erase" });
    const second = await ctx.store.page({ limit: 3, cursor: first.nextCursor });
    expect(second.items.map((i) => i.id)).toEqual(ids.slice(3, 6));
    expect(second.nextCursor).toBeNull();
  });

  it("an empty history is one empty page", async () => {
    const ctx = await candidateWithDebrief(name);
    open.push(ctx.engine);
    expect(await ctx.store.page({ skillId: "builtin.stalls" })).toEqual({ items: [], nextCursor: null });
  });
});

describe("query plans", () => {
  it("node:sqlite: skill pages and full pages read through the candidate indexes, not a table scan", async () => {
    const ctx = await candidateWithDebrief("node:sqlite");
    open.push(ctx.engine);
    const plan = (input: Parameters<typeof pageQuery>[0]) => {
      const { sql, params } = pageQuery(input);
      return ctx.engine.query(`EXPLAIN QUERY PLAN ${sql}`, params).map((r) => String(r["detail"])).join(" | ");
    };
    const skill = plan({ skillId: "builtin.normal_landing", cursor: JSON.stringify(["2026-10-01", "2026-10-10T00:00:00.000Z", "z"]) });
    const all = plan({});
    console.log(`plan(skill page): ${skill}`);
    console.log(`plan(all page):   ${all}`);
    expect(skill).toMatch(/idx_skill_observations_skill_page/);
    expect(all).toMatch(/idx_skill_observations_page/);
    expect(`${skill} ${all}`).not.toMatch(/SCAN o\b(?! USING)/);
    expect(`${skill} ${all}`).not.toMatch(/USE TEMP B-TREE FOR ORDER BY/);
  });
});
