/**
 * Toolkit defaults without structuredClone (WebKit before Safari 15.4 /
 * macOS 12.3), and the independence of every returned toolkit state.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { ToolkitState } from "@/domain/types";
import { removeCapability } from "@/testing/capabilities";

import {
  DEFAULT_READINESS_ITEMS,
  DEFAULT_TOOLKIT_STATE,
  copyToolkitData,
  defaultToolkitState,
  normalizeToolkitState,
} from "./toolkit";

const DEFAULTS_SNAPSHOT = JSON.stringify(DEFAULT_TOOLKIT_STATE);
const READINESS_SNAPSHOT = JSON.stringify(DEFAULT_READINESS_ITEMS);

let restore: () => void;
let db: TestDatabase;
let repos: Repositories;

beforeEach(async () => {
  restore = removeCapability(globalThis, "structuredClone");
  expect(typeof globalThis.structuredClone).toBe("undefined");
  db = await createNodeSqliteDatabase();
  repos = createRepositories(db);
});

afterEach(() => {
  db.close();
  restore();
  // No case may have changed the shared defaults.
  expect(JSON.stringify(DEFAULT_TOOLKIT_STATE)).toBe(DEFAULTS_SNAPSHOT);
  expect(JSON.stringify(DEFAULT_READINESS_ITEMS)).toBe(READINESS_SNAPSHOT);
});

/** Change every kind of nested value a screen might edit. */
function scribble(state: ToolkitState) {
  state.readinessItems[0]!.status = "instructor_signed_off";
  state.readinessItems[0]!.notes = "edited";
  state.readinessItems.push({ id: "custom-x", area: "flight", title: "Extra", status: "ready", notes: "" });
  state.credentials.push({
    id: "c-1", type: "medical", title: "Medical", identifier: "", issuedOn: null, expiresOn: null, notes: "", materialId: null,
  });
  state.quizAttempts.push({ id: "q-1", date: "2026-10-02T00:00:00.000Z", score: 1, total: 8, weakTopics: ["weather"] });
  state.safetyChecks.length = 0;
  state.careerSummary = "edited";
}

async function storeRaw(json: string) {
  await db.execute(
    "INSERT INTO pilot_toolkit (id, state_json, updated_at) VALUES ('toolkit', ?, '2026-10-02T00:00:00.000Z')",
    [json],
  );
}

describe("toolkit defaults without structuredClone", () => {
  const unusable: Array<[string, string | null]> = [
    ["fresh install (no row)", null],
    ["empty stored text", ""],
    ["corrupt JSON", "{not json"],
    ["stored null", "null"],
    ["stored number", "42"],
    ["stored string", "\"toolkit\""],
  ];

  for (const [label, raw] of unusable) {
    it(`returns independent defaults for ${label}`, async () => {
      if (raw !== null) await storeRaw(raw);
      const first = await repos.toolkit.get();
      expect(first).toEqual(DEFAULT_TOOLKIT_STATE);
      scribble(first);
      const second = await repos.toolkit.get();
      expect(second).toEqual(DEFAULT_TOOLKIT_STATE);
      expect(second.readinessItems).not.toBe(DEFAULT_TOOLKIT_STATE.readinessItems);
      expect(second.readinessItems[0]).not.toBe(DEFAULT_READINESS_ITEMS[0]);
    });
  }

  it("normalizes invalid field types to safe values with owned arrays", () => {
    const state = normalizeToolkitState({
      readinessItems: "nope", credentials: {}, safetyChecks: null, quizAttempts: 7,
      reminderLeadDays: 400, estimatedHourlyCost: -5, additionalTrainingCosts: "12",
    });
    expect(state.readinessItems).toEqual(DEFAULT_READINESS_ITEMS);
    expect(state.credentials).toEqual([]);
    expect(state.safetyChecks).toEqual([]);
    expect(state.quizAttempts).toEqual([]);
    expect(state.reminderLeadDays).toBe(90);
    expect(state.estimatedHourlyCost).toBe(0);
    expect(state.additionalTrainingCosts).toBe(12);
    scribble(state);
    expect(normalizeToolkitState({ credentials: {} }).credentials).toEqual([]);
  });

  it("keeps valid stored values and owns every nested object and array", async () => {
    const stored = normalizeToolkitState({
      ...DEFAULT_TOOLKIT_STATE,
      targetAirline: "A future employer",
      readinessItems: [
        { ...DEFAULT_READINESS_ITEMS[1]!, status: "ready", notes: "reviewed" },
        { id: "custom-1", area: "knowledge", title: "Custom", status: "learning", notes: "" },
      ],
      quizAttempts: [{ id: "q-0", date: "2026-10-01T00:00:00.000Z", score: 6, total: 8, weakTopics: ["airports"] }],
    });
    await repos.toolkit.save(stored);
    const json = (await db.select<{ state_json: string }>("SELECT state_json FROM pilot_toolkit"))[0]!.state_json;

    const first = await repos.toolkit.get();
    expect(first.targetAirline).toBe("A future employer");
    expect(first.readinessItems[1]).toMatchObject({ status: "ready", notes: "reviewed" });
    expect(first.readinessItems.at(-1)!.id).toBe("custom-1");
    expect(first.quizAttempts[0]!.weakTopics).toEqual(["airports"]);
    // Serialization is unchanged by the copy.
    expect(JSON.stringify(normalizeToolkitState(JSON.parse(json)))).toBe(json);

    scribble(first);
    first.quizAttempts[0]!.weakTopics.push("weather");
    const second = await repos.toolkit.get();
    expect(JSON.stringify(second)).toBe(json);
  });

  it("does not share structure with its input or between normalizations", () => {
    const input = {
      readinessItems: [{ ...DEFAULT_READINESS_ITEMS[0]!, notes: "mine" }],
      credentials: [{ id: "c-0", type: "medical", title: "Medical", identifier: "", issuedOn: null, expiresOn: null, notes: "", materialId: null }],
      quizAttempts: [{ id: "q-0", date: "2026-10-01T00:00:00.000Z", score: 6, total: 8, weakTopics: ["airports"] }],
    };
    const before = JSON.stringify(input);
    const a = normalizeToolkitState(input);
    const b = normalizeToolkitState(input);
    expect(a).toEqual(b);
    scribble(a);
    a.quizAttempts[0]!.weakTopics.push("weather");
    expect(JSON.stringify(input)).toBe(before);
    expect(b.readinessItems[0]!.notes).toBe("mine");
    expect(b.credentials).toHaveLength(1);
    expect(b.quizAttempts[0]!.weakTopics).toEqual(["airports"]);
  });

  it("gives each default factory call its own copy", () => {
    const a = defaultToolkitState();
    const b = defaultToolkitState();
    scribble(a);
    expect(b).toEqual(DEFAULT_TOOLKIT_STATE);
  });
});

describe("copyToolkitData", () => {
  it("copies arrays and plain objects deeply and keeps primitives", () => {
    const source = { a: [1, { b: "x" }], c: null, d: true, e: { f: [] as number[] } };
    const copy = copyToolkitData(source);
    expect(copy).toEqual(source);
    expect(copy.a).not.toBe(source.a);
    expect(copy.a[1]).not.toBe(source.a[1]);
    expect(copy.e.f).not.toBe(source.e.f);
  });
});
