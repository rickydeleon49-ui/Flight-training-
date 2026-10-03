// @vitest-environment jsdom
/**
 * Keeps the Study Library benchmark honest in ordinary test runs: the fixture's
 * answer key must agree with the generator rules, and every benchmark scenario
 * must produce exactly the expected ids and order on the real page.
 */
import { createElement as h, Profiler } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { StudyLibrary } from "@/pages/StudyLibrary/StudyLibrary";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

import {
  analyticCounts,
  expectedIds,
  fixtureLibrary,
  seedFixtureMaterials,
  type FixtureMaterial,
} from "./studyLibraryFixture";
import { SCENARIOS, renderedResult, runLibraryScenarios, type Meter, type ScenarioResult } from "./studyLibraryHarness";

let db: TestDatabase | null = null;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

let context: ReturnType<typeof useAppData> | null = null;
function Probe() {
  context = useAppData();
  return null;
}

const meter: Meter = {
  reset() {},
  read: () => ({ renders: 0, renderMs: 0, selects: 0, executes: 0 }),
};

async function mountLibrary(materials: FixtureMaterial[]) {
  db = await createNodeSqliteDatabase();
  await createRepositories(db).app.set("airline_starter_pack", "skipped-for-test");
  await seedFixtureMaterials(db, materials);
  render(h(Profiler, { id: "library", onRender: () => {} },
    h(AppDataProvider, null,
      h(MemoryRouter, { initialEntries: ["/study"] },
        h(Probe),
        h(Routes, null, h(Route, { path: "/study", element: h(StudyLibrary) }))))));
  await waitFor(() => expect(context?.status).toBe("ready"));
}

afterEach(() => {
  cleanup();
  db?.close();
  db = null;
  context = null;
  sessionStorage.clear();
});

describe("Study Library benchmark fixture", () => {
  it("gives every tier distinct creation times so each sort order is fully defined", () => {
    for (const total of [100, 1_000, 5_000, 10_000]) {
      const times = new Set(fixtureLibrary(total).map((m) => m.createdAt));
      expect(times.size).toBe(total);
    }
  });

  it("agrees with the counts stated by the generator rules", () => {
    for (const total of [100, 240, 1_000]) {
      const materials = fixtureLibrary(total);
      for (const [query, count] of Object.entries(analyticCounts(total))) {
        expect(expectedIds(materials, { query, topic: "", type: "", status: "Everything", sort: "recent" }), query)
          .toHaveLength(count);
      }
    }
  });

  it("covers tags, Unicode, duplicates and mocked missing files at every tier", () => {
    const materials = fixtureLibrary(100);
    expect(materials.filter((m) => m.tags.includes("météo")).length).toBeGreaterThan(0);
    expect(materials.filter((m) => m.title === "Weight and balance worksheet").length).toBe(10);
    expect(materials.filter((m) => m.mockFileMissing).length).toBe(13);
    expect(materials.filter((m) => m.filePath && !m.mockFileMissing).length).toBe(12);
  });
});

const EXPANDED = ["showMoreExpandTo1000", "queryWhileExpanded"];

function finished(results: Record<string, ScenarioResult | { skipped: string }>, name: string): ScenarioResult {
  const result = results[name];
  if (!result || "skipped" in result) throw new Error(`${name} did not run`);
  return result;
}

describe("Study Library benchmark scenarios", () => {
  it("lists exactly the answer key's ids and order on the real page for every scenario", async () => {
    const materials = fixtureLibrary(240);
    await mountLibrary(materials);
    const results = await runLibraryScenarios({
      materials, loaded: () => context!.data.materials, meter, repeats: 1, warmups: 0,
    });
    expect(Object.keys(results)).toEqual(SCENARIOS.map((s) => s.name));
    for (const [name, result] of Object.entries(results)) {
      // Expanded-state scenarios need 1,000 materials and are covered below.
      expect("skipped" in result, name).toBe(EXPANDED.includes(name));
    }
    // Spot checks that the scenarios exercise what their names say.
    expect(finished(results, "matchingQueryPasted").final.resultCount).toBe(24);
    expect(finished(results, "noMatchQuery").final.resultCount).toBe(0);
    expect(finished(results, "filtersAndSortTogether").final.resultCount).toBeGreaterThan(1);
    expect(finished(results, "showMoreProgressive").final.shownCount).toBe(200);
    // Every typed prefix is its own step, measured and verified for its own query.
    const narrowing = finished(results, "narrowingQueryTyped");
    expect(narrowing.steps.map((s) => s.view.query)).toEqual(Array.from("airspace class b", (_, i) => "airspace class b".slice(0, i + 1)));
    expect(narrowing.steps.at(-1)!.resultCount).toBe(6);
    for (const step of narrowing.steps) {
      expect(step.wallMs.n).toBe(1);
      expect(step.computeMs.n).toBe(1);
    }
  }, 30_000);

  it("measures a stated expanded display of 1,000 cards, and a query from it returns to 100", async () => {
    const materials = fixtureLibrary(1_000);
    await mountLibrary(materials);
    const results = await runLibraryScenarios({
      materials, loaded: () => context!.data.materials, meter, repeats: 1, warmups: 0, only: EXPANDED,
    });
    const expand = finished(results, "showMoreExpandTo1000");
    expect(expand.steps.map((s) => s.shownCount)).toEqual([200, 300, 400, 500, 600, 700, 800, 900, 1_000]);
    const query = finished(results, "queryWhileExpanded");
    expect(query.final).toEqual({ resultCount: 100, shownCount: 100 });
  }, 60_000);

  it("fails the run when the final page result differs from the answer key", async () => {
    const materials = fixtureLibrary(240);
    await mountLibrary(materials);
    // Negative control: an answer key that is wrong about one airspace title.
    const wrong = materials.map((m) => (m.index === 40 ? { ...m, title: "Renamed handout" } : m));
    await expect(runLibraryScenarios({
      materials: wrong, loaded: () => context!.data.materials, meter, repeats: 1, warmups: 0,
    })).rejects.toThrow(/answer key|generator rules/);
  }, 30_000);

  it("fails the run on a wrong intermediate keystroke result even when the final result is correct", async () => {
    const materials = fixtureLibrary(240);
    await mountLibrary(materials);
    // Negative control from Codex's review (R1): at "airspace c" only, the first
    // card shows a wrong id; it is restored before the next keystroke, so the
    // final "airspace class b" state is correct.
    let altered: { card: HTMLAnchorElement; href: string } | null = null;
    let injected = 0;
    let observed = false;
    const run = runLibraryScenarios({
      materials, loaded: () => context!.data.materials, meter, repeats: 1, warmups: 0, only: ["narrowingQueryTyped"],
      afterStep() {
        if (altered) altered.card.setAttribute("href", altered.href);
        altered = null;
        const query = (document.querySelector('[aria-label="Search your library"]') as HTMLInputElement).value;
        if (query !== "airspace c") return;
        const card = document.querySelector<HTMLAnchorElement>("a.material-card")!;
        altered = { card, href: card.getAttribute("href")! };
        card.setAttribute("href", "/study/wrong-intermediate-id");
        injected++;
        observed = renderedResult().shownIds.includes("wrong-intermediate-id");
      },
    });
    await expect(run).rejects.toThrow(/step 9 \(query "airspace c"\): shown ids\/order differ/);
    expect(injected).toBe(1);
    expect(observed).toBe(true);
  }, 30_000);

  it("fails the run on a wrong intermediate count even when the final result is correct", async () => {
    const materials = fixtureLibrary(240);
    await mountLibrary(materials);
    let line: { element: Element; text: string } | null = null;
    const run = runLibraryScenarios({
      materials, loaded: () => context!.data.materials, meter, repeats: 1, warmups: 0, only: ["narrowingQueryTyped"],
      afterStep() {
        if (line) line.element.textContent = line.text;
        line = null;
        const query = (document.querySelector('[aria-label="Search your library"]') as HTMLInputElement).value;
        if (query !== "airspace c") return;
        const element = document.querySelector(".library__result-count")!;
        line = { element, text: element.textContent! };
        element.textContent = element.textContent!.replace(/of ([\d,]+) materials/, "of 999 materials");
      },
    });
    await expect(run).rejects.toThrow(/step 9 \(query "airspace c"\): page reports 999 results/);
  }, 30_000);
});
