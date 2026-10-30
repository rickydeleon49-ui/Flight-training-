/**
 * Drives the real Study Library page through measured scenarios and checks
 * every measured result against the fixture's answer key, so a faster but
 * wrong result fails instead of being reported. Shared by the opt-in
 * benchmark and the always-on scenario correctness test.
 *
 * Expects the page to be mounted at /study already. Timings are JavaScript,
 * React and jsdom DOM work in Node, not WebView paint.
 */
import { act, fireEvent, screen } from "@testing-library/react";

import type { StudyMaterial } from "@/domain/types";
import { sortMaterials, type MaterialSort } from "@/logic/library";

import {
  DEFAULT_VIEW,
  analyticCounts,
  expectedIds,
  pageFilterReplica,
  type FixtureMaterial,
  type LibraryView,
  type StatusChip,
} from "./studyLibraryFixture";

export const PAGE_SIZE = 100;
/** Displayed-card count reached by the expanded-state scenarios. */
export const EXPANDED_CARDS = 1_000;

export interface Stats {
  median: number;
  min: number;
  max: number;
  n: number;
  samples: number[];
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Median (upper median for even counts), range, count and the raw samples. */
export function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: round(sorted[Math.floor(sorted.length / 2)]!),
    min: round(sorted[0]!),
    max: round(sorted.at(-1)!),
    n: sorted.length,
    samples: samples.map(round),
  };
}

export async function timed(work: () => Promise<void> | void): Promise<number> {
  const started = performance.now();
  await work();
  return performance.now() - started;
}

/** Counters owned by the caller: React Profiler renders and database calls. */
export interface Meter {
  reset(): void;
  read(): { renders: number; renderMs: number; selects: number; executes: number };
}

type Step =
  | { kind: "query"; value: string }
  | { kind: "topic"; value: LibraryView["topic"] }
  | { kind: "type"; value: LibraryView["type"] }
  | { kind: "status"; value: StatusChip }
  | { kind: "sort"; value: MaterialSort }
  | { kind: "showMore" };

interface Scenario {
  name: string;
  /** Untimed steps applied after the reset. */
  setup: Step[];
  /** The timed step or steps; each is timed on its own. */
  measured: Step[];
  /** Key into analyticCounts that the final result must also equal. */
  analytic?: string;
  /** Material count needed for the scenario to mean anything. */
  minimumMaterials?: number;
}

const NARROWING = "airspace class b";

export const SCENARIOS: Scenario[] = [
  { name: "emptyQueryClearsSearch", setup: [{ kind: "query", value: "airspace" }], measured: [{ kind: "query", value: "" }] },
  { name: "matchingQueryPasted", setup: [], measured: [{ kind: "query", value: "airspace" }], analytic: "airspace" },
  {
    name: "narrowingQueryTyped",
    setup: [],
    measured: Array.from(NARROWING, (_, i) => ({ kind: "query" as const, value: NARROWING.slice(0, i + 1) })),
    analytic: NARROWING,
  },
  { name: "noMatchQuery", setup: [], measured: [{ kind: "query", value: "xylophone" }], analytic: "xylophone" },
  { name: "unicodeUppercaseAccent", setup: [], measured: [{ kind: "query", value: "MÉTÉO" }], analytic: "MÉTÉO" },
  { name: "unicodeCjk", setup: [], measured: [{ kind: "query", value: "航空" }], analytic: "航空" },
  {
    name: "unicodeDecomposedNoNormalization",
    setup: [],
    measured: [{ kind: "query", value: "météo" }],
    analytic: "météo",
  },
  {
    name: "duplicateTitlesUnderTitleSort",
    setup: [{ kind: "sort", value: "title" }],
    measured: [{ kind: "query", value: "weight and balance" }],
    analytic: "weight and balance",
  },
  { name: "tagQuery", setup: [], measured: [{ kind: "query", value: "xc-planning" }], analytic: "xc-planning" },
  { name: "notesQuery", setup: [], measured: [{ kind: "query", value: "fuel planning" }], analytic: "fuel planning" },
  {
    name: "filtersAndSortTogether",
    setup: [
      { kind: "topic", value: "weather" },
      { kind: "status", value: "Review again" },
      { kind: "query", value: "ground" },
    ],
    measured: [{ kind: "sort", value: "title" }],
  },
  { name: "statusChipNextUp", setup: [], measured: [{ kind: "status", value: "Next Up" }] },
  { name: "sortRecentToPriority", setup: [], measured: [{ kind: "sort", value: "priority" }] },
  { name: "sortPriorityToTitle", setup: [{ kind: "sort", value: "priority" }], measured: [{ kind: "sort", value: "title" }] },
  { name: "sortTitleToRecent", setup: [{ kind: "sort", value: "title" }], measured: [{ kind: "sort", value: "recent" }] },
  { name: "showMoreProgressive", setup: [], measured: [{ kind: "showMore" }], minimumMaterials: PAGE_SIZE + 1 },
  // The page has no fixed card cap: each Show more adds 100. These measure a
  // stated expanded display of up to EXPANDED_CARDS cards; larger displays,
  // scrolling and refreshes while expanded are not measured.
  {
    name: "showMoreExpandTo1000",
    setup: [],
    measured: Array.from({ length: EXPANDED_CARDS / PAGE_SIZE - 1 }, () => ({ kind: "showMore" as const })),
    minimumMaterials: EXPANDED_CARDS,
  },
  {
    name: "queryWhileExpanded",
    setup: Array.from({ length: EXPANDED_CARDS / PAGE_SIZE - 1 }, () => ({ kind: "showMore" as const })),
    measured: [{ kind: "query", value: "airspace" }],
    analytic: "airspace",
    minimumMaterials: EXPANDED_CARDS,
  },
];

/** One timed event in a scenario, with every figure measured for that same step's view. */
export interface StepResult {
  /** Position in the scenario's measured sequence (0-based). */
  step: number;
  /** The event, e.g. `query "airspace c"` or `showMore`. */
  event: string;
  /** View and progressive limit after the event; compute and verification use exactly this state. */
  view: LibraryView;
  limit: number;
  /** Wall time inside act(): React render, commit, effects and jsdom DOM work. */
  wallMs: Stats;
  /** React Profiler actualDuration summed over the event (render phase only). */
  reactRenderMs: Stats;
  /** Index-free filter (page replica) plus production sortMaterials for this step's view, over the loaded records. */
  computeMs: Stats;
  /** React commits observed for this event, one entry per recorded repeat. */
  rendersPerRepeat: number[];
  /** Database calls during this event over all recorded repeats; filtering is in memory, so expected 0. */
  dbCallsAllRepeats: { selects: number; executes: number };
  resultCount: number;
  shownCount: number;
}

export interface ScenarioResult {
  steps: StepResult[];
  /** Result after the last measured step. */
  final: { resultCount: number; shownCount: number };
  verified: string[];
}

export interface ScenarioRun {
  materials: FixtureMaterial[];
  loaded: () => StudyMaterial[];
  meter: Meter;
  repeats: number;
  /** Discarded runs before the recorded ones, per scenario. */
  warmups: number;
  /** Called after each timed step and before its verification, e.g. for memory sampling. */
  afterStep?: () => void;
  /** Run only these scenarios (focused tests); default all. */
  only?: string[];
}

function searchInput() {
  return screen.getByLabelText("Search your library") as HTMLInputElement;
}

function selectByLabel(label: string) {
  return screen.getByLabelText(label) as HTMLSelectElement;
}

/** The view the page is showing, read from its controls. */
function currentView(): LibraryView {
  const pressed = screen.getAllByRole("button", { pressed: true })[0];
  return {
    query: searchInput().value,
    topic: selectByLabel("Filter by topic").value as LibraryView["topic"],
    type: selectByLabel("Filter by material type").value as LibraryView["type"],
    status: (pressed?.textContent ?? "Everything") as StatusChip,
    sort: selectByLabel("Sort materials").value as MaterialSort,
  };
}

function stepView(view: LibraryView, step: Step): LibraryView {
  switch (step.kind) {
    case "query": return { ...view, query: step.value };
    case "topic": return { ...view, topic: step.value };
    case "type": return { ...view, type: step.value };
    case "status": return { ...view, status: step.value };
    case "sort": return { ...view, sort: step.value };
    case "showMore": return view;
  }
}

/**
 * Check a step and find its control, returning only the event to dispatch.
 * Queries and the no-op guard stay out of the timed region: role queries in
 * jsdom cost tens of milliseconds with 100 cards on the page.
 */
function prepare(step: Step): () => Promise<void> {
  const before = currentView();
  if (step.kind !== "showMore" && JSON.stringify(stepView(before, step)) === JSON.stringify(before)) {
    throw new Error(`Step ${JSON.stringify(step)} would not change the view; the measurement would be a no-op.`);
  }
  let dispatch: () => void;
  switch (step.kind) {
    case "query": {
      const input = searchInput();
      dispatch = () => fireEvent.change(input, { target: { value: step.value } });
      break;
    }
    case "topic":
    case "type":
    case "sort": {
      const label = { topic: "Filter by topic", type: "Filter by material type", sort: "Sort materials" }[step.kind];
      const select = selectByLabel(label);
      dispatch = () => fireEvent.change(select, { target: { value: step.value } });
      break;
    }
    case "status": {
      const chip = screen.getByRole("button", { name: step.value });
      dispatch = () => fireEvent.click(chip);
      break;
    }
    case "showMore": {
      const more = screen.getByRole("button", { name: "Show 100 more materials" });
      dispatch = () => fireEvent.click(more);
      break;
    }
  }
  return () => act(async () => dispatch());
}

async function apply(step: Step): Promise<void> {
  await prepare(step)();
}

/**
 * Back to the default view with the progressive limit reset. A throwaway
 * query forces a new filter key, so a previous "show more" cannot carry over.
 */
async function reset(): Promise<void> {
  await act(async () => {
    fireEvent.change(searchInput(), { target: { value: "\u0000reset" } });
  });
  const view = currentView();
  if (view.topic !== DEFAULT_VIEW.topic) await apply({ kind: "topic", value: DEFAULT_VIEW.topic });
  if (view.type !== DEFAULT_VIEW.type) await apply({ kind: "type", value: DEFAULT_VIEW.type });
  if (view.status !== DEFAULT_VIEW.status) await apply({ kind: "status", value: DEFAULT_VIEW.status });
  if (view.sort !== DEFAULT_VIEW.sort) await apply({ kind: "sort", value: DEFAULT_VIEW.sort });
  await apply({ kind: "query", value: DEFAULT_VIEW.query });
}

/** What the page lists right now: total matches and the ids of the shown cards. */
export function renderedResult(): { total: number; shownIds: string[] } {
  const shownIds = Array.from(document.querySelectorAll<HTMLAnchorElement>("a.material-card"), (a) =>
    decodeURIComponent(a.getAttribute("href")!.replace(/^\/study\//, "")),
  );
  if (screen.queryByText("Nothing matches those filters.")) return { total: 0, shownIds };
  const line = document.querySelector(".library__result-count")?.textContent ?? "";
  const match = /Showing ([\d,]+) of ([\d,]+) materials/.exec(line);
  if (!match) throw new Error(`No result count on the page: "${line}"`);
  const shown = Number(match[1]!.replace(/,/g, ""));
  if (shown !== shownIds.length) throw new Error(`Page says ${shown} shown but has ${shownIds.length} cards.`);
  return { total: Number(match[2]!.replace(/,/g, "")), shownIds };
}

interface Expected {
  view: LibraryView;
  limit: number;
  /** Key into analyticCounts that applies to this state, if any. */
  analytic?: string;
}

/**
 * Check the page against the answer key for one state: every control, the
 * total, and the exact ids and order of the shown cards. Never timed.
 */
function verifyState(run: ScenarioRun, scenario: Scenario, label: string, want: Expected): { total: number; shown: number } {
  const where = `${scenario.name} ${label}`;
  const controls = currentView();
  if (JSON.stringify(controls) !== JSON.stringify(want.view)) {
    throw new Error(`${where}: controls show ${JSON.stringify(controls)}, intended ${JSON.stringify(want.view)}.`);
  }
  const expected = expectedIds(run.materials, want.view);
  const { total, shownIds } = renderedResult();
  if (total !== expected.length) {
    throw new Error(`${where}: page reports ${total} results, answer key expects ${expected.length}.`);
  }
  const expectedShown = expected.slice(0, want.limit);
  if (JSON.stringify(shownIds) !== JSON.stringify(expectedShown)) {
    const at = shownIds.findIndex((id, i) => id !== expectedShown[i]);
    const position = at === -1 ? Math.min(shownIds.length, expectedShown.length) : at;
    throw new Error(
      `${where}: shown ids/order differ from answer key at position ${position} ` +
        `(page ${shownIds[position]}, expected ${expectedShown[position]}; ${shownIds.length} vs ${expectedShown.length} shown).`,
    );
  }
  if (want.analytic !== undefined) {
    const analytic = analyticCounts(run.materials.length)[want.analytic];
    if (analytic !== total) throw new Error(`${where}: generator rules give ${analytic}, page reports ${total}.`);
  }
  return { total, shown: shownIds.length };
}

function describe(step: Step): string {
  return step.kind === "showMore" ? "showMore" : `${step.kind} ${JSON.stringify(step.value)}`;
}

/** Filter, search and sort changes reset the page to its first 100 cards; Show more adds 100. */
function stepLimit(limit: number, step: Step): number {
  return step.kind === "showMore" ? limit + PAGE_SIZE : PAGE_SIZE;
}

export async function runLibraryScenarios(run: ScenarioRun): Promise<Record<string, ScenarioResult | { skipped: string }>> {
  const results: Record<string, ScenarioResult | { skipped: string }> = {};
  for (const scenario of SCENARIOS.filter((s) => !run.only || run.only.includes(s.name))) {
    if (scenario.minimumMaterials && run.materials.length < scenario.minimumMaterials) {
      results[scenario.name] = { skipped: `needs at least ${scenario.minimumMaterials} materials` };
      continue;
    }
    // The intended state after each measured step, fixed before anything runs.
    const plan: Expected[] = [];
    let view = DEFAULT_VIEW;
    let limit = PAGE_SIZE;
    for (const step of scenario.setup) {
      view = stepView(view, step);
      limit = stepLimit(limit, step);
    }
    const afterSetup: Expected = { view, limit };
    scenario.measured.forEach((step, index) => {
      view = stepView(view, step);
      limit = stepLimit(limit, step);
      const last = index === scenario.measured.length - 1;
      plan.push({ view, limit, analytic: last ? scenario.analytic : undefined });
    });

    const samples = scenario.measured.map(() => ({
      wall: [] as number[], react: [] as number[], renders: [] as number[], selects: 0, executes: 0, total: 0, shown: 0,
    }));
    for (let r = 0; r < run.warmups + run.repeats; r++) {
      const recording = r >= run.warmups;
      await reset();
      verifyState(run, scenario, "after reset", { view: DEFAULT_VIEW, limit: PAGE_SIZE });
      for (const step of scenario.setup) await apply(step);
      verifyState(run, scenario, "after setup", afterSetup);
      for (const [index, step] of scenario.measured.entries()) {
        const dispatch = prepare(step);
        run.meter.reset();
        const ms = await timed(dispatch);
        const counts = run.meter.read();
        run.afterStep?.();
        // Every measured state is checked before its sample is kept, so a
        // transient wrong result fails even if a later step looks right.
        const seen = verifyState(run, scenario, `step ${index} (${describe(step)})`, plan[index]!);
        if (!recording) continue;
        const slot = samples[index]!;
        slot.wall.push(ms);
        slot.react.push(counts.renderMs);
        slot.renders.push(counts.renders);
        slot.selects += counts.selects;
        slot.executes += counts.executes;
        slot.total = seen.total;
        slot.shown = seen.shown;
      }
    }

    // Index-free compute for each step's own view, checked against the answer key.
    const steps: StepResult[] = [];
    for (const [index, step] of scenario.measured.entries()) {
      const want = plan[index]!;
      const expected = expectedIds(run.materials, want.view);
      const compute: number[] = [];
      for (let r = 0; r < run.warmups + run.repeats; r++) {
        let ids: string[] = [];
        const ms = await timed(() => {
          ids = sortMaterials(pageFilterReplica(run.loaded(), want.view), want.view.sort).map((m) => m.id);
        });
        if (JSON.stringify(ids) !== JSON.stringify(expected)) {
          throw new Error(`${scenario.name} step ${index}: page filter replica disagrees with the answer key; update the replica.`);
        }
        if (r >= run.warmups) compute.push(ms);
      }
      const slot = samples[index]!;
      steps.push({
        step: index,
        event: describe(step),
        view: want.view,
        limit: want.limit,
        wallMs: stats(slot.wall),
        reactRenderMs: stats(slot.react),
        computeMs: stats(compute),
        rendersPerRepeat: slot.renders,
        dbCallsAllRepeats: { selects: slot.selects, executes: slot.executes },
        resultCount: slot.total,
        shownCount: slot.shown,
      });
    }

    const last = steps.at(-1)!;
    results[scenario.name] = {
      steps,
      final: { resultCount: last.resultCount, shownCount: last.shownCount },
      verified: [
        "controls, count and exact shown ids/order checked after reset, after setup and after every measured step (warm-ups included), outside timing",
        ...(scenario.analytic !== undefined ? [`final count equals generator rule "${scenario.analytic}"`] : []),
        "per-step replica filter + sortMaterials equal the answer key",
      ],
    };
  }
  await reset();
  return results;
}
