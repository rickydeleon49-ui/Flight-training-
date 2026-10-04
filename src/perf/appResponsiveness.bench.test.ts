// @vitest-environment jsdom
/**
 * Responsiveness benchmark for the frontend, gated so normal test runs skip it.
 *
 *   PowerShell:  $env:HFD_BENCH='1'; $env:HFD_BENCH_OUT='bench.json'; npx vitest run src/perf/appResponsiveness.bench.test.ts
 *   Git Bash:    HFD_BENCH=1 HFD_BENCH_OUT=bench.json npx vitest run src/perf/appResponsiveness.bench.test.ts
 *
 * What it measures: the real AppDataProvider and real pages over node:sqlite
 * (same migrations as the desktop app), in jsdom. Times are JavaScript and
 * React work plus SQLite queries in Node. They are NOT WebView paint, Tauri
 * IPC, or packaged-app startup, and must not be reported as such.
 *
 * Synthetic data only (see studyLibraryFixture.ts). Every Study Library result
 * is checked against the fixture's answer key before its timing is kept. Each
 * figure records the raw samples, median, min, max and count; interaction
 * scenarios discard one warm-up run first. File status is a labelled mock.
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import os from "node:os";
import { Profiler, createElement as h, useEffect, type ProfilerOnRenderCallback } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import type { SqlValue } from "@/data/db";
import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { addDays, todayIso } from "@/lib/dates";
import { FlightDeck } from "@/pages/FlightDeck/FlightDeck";
import { Questions } from "@/pages/Questions/Questions";
import { MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
import { StudyLibrary } from "@/pages/StudyLibrary/StudyLibrary";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

import {
  fixtureIdentity,
  fixtureLibrary,
  fixtureMaterial,
  materialId,
  seedFixtureMaterials,
  type FixtureMaterial,
} from "./studyLibraryFixture";
import { renderedResult, runLibraryScenarios, stats, timed, type Meter } from "./studyLibraryHarness";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

/**
 * MOCK file status. The detail page only checks files in the desktop app, so
 * the benchmark reports file handling as available and answers existence from
 * the fixture. This exercises the page's missing-file path; it says nothing
 * about the real filesystem or the native document_exists command.
 */
const fileChecks: string[] = [];
let mockMissing = new Set<string>();
vi.mock("@/services/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/documents")>();
  return {
    ...actual,
    canHandleFiles: () => true,
    documentExists: async (path: string) => {
      fileChecks.push(path);
      return !mockMissing.has(path);
    },
  };
});

/**
 * Realistic tiers for one student pilot. Most actions end up completed and
 * most questions answered over time; the Study Library is the part that can
 * grow large, because automatic PDF splitting turns one book into many parts.
 * - small: first weeks of training
 * - medium: about a year of training with a split handbook or two
 * - large: several years, a heavily split library, long training record
 * - stress: NOT a realistic tier. Large's other records with 10,000 materials,
 *   to see how Study Library cost scales past the realistic range.
 */
const SIZES = {
  small: { materials: 100, actions: 100, journal: 30, questions: 50 },
  medium: { materials: 1_000, actions: 400, journal: 150, questions: 250 },
  large: { materials: 5_000, actions: 1_500, journal: 500, questions: 800 },
  stress: { materials: 10_000, actions: 1_500, journal: 500, questions: 800 },
} as const;
/** Share of actions still open and of questions still unanswered. */
const OPEN_ACTION_EVERY = 5; // 1 in 5 open, the rest completed
const UNANSWERED_EVERY = 3; // 1 in 3 still to ask
const REPEATS = 5;
const WARMUPS = 1;

const counts = { selects: 0, executes: 0 };
function instrument(inner: TestDatabase): TestDatabase {
  return {
    ...inner,
    async select<T>(sql: string, params?: SqlValue[]) {
      counts.selects++;
      return inner.select<T>(sql, params);
    },
    async execute(sql: string, params?: SqlValue[]) {
      counts.executes++;
      return inner.execute(sql, params);
    },
    close: () => inner.close(),
  };
}

async function seed(size: (typeof SIZES)[keyof typeof SIZES], materials: FixtureMaterial[]) {
  const base = await createNodeSqliteDatabase();
  const repos = createRepositories(base);
  await repos.app.set("airline_starter_pack", "skipped-for-bench");
  const today = todayIso();
  await seedFixtureMaterials(base, materials);
  for (let i = 0; i < size.actions; i++) {
    const open = i % OPEN_ACTION_EVERY === 0;
    await repos.actions.create({
      id: `a-${i}`,
      title: `Synthetic action ${i}`,
      status: open ? "open" : "completed",
      completedAt: open ? null : `${addDays(today, -(i % 365))}T12:00:00.000Z`,
      dueDate: open ? addDays(today, (i % 20) - 3) : addDays(today, -(i % 365)),
      estimatedMinutes: 5 + (i % 4) * 5,
      relatedType: i % 2 ? "material" : null,
      relatedId: i % 2 ? materialId(i % size.materials) : null,
    });
  }
  for (let i = 0; i < size.journal; i++) {
    await repos.journal.create({ date: addDays(today, -i), title: `Synthetic flight ${i}`, totalTime: 1.2, wentWell: "Synthetic" });
  }
  for (let i = 0; i < size.questions; i++) {
    const unanswered = i % UNANSWERED_EVERY === 0;
    await repos.questions.create({
      text: `Synthetic question ${i}?`,
      status: unanswered ? "to_ask" : "answered",
      answer: unanswered ? "" : "Synthetic answer.",
    });
  }
  return base;
}

let context: ReturnType<typeof useAppData>;
let navigate: ReturnType<typeof useNavigate>;
/** performance.now() of the commit that first showed ready data. */
let readyAt: number | null = null;
let renders = 0;
let renderMs = 0;
const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
  renders++;
  renderMs += actualDuration;
};
function Probe() {
  context = useAppData();
  navigate = useNavigate();
  const { status } = context;
  // Stamped on the commit that first shows ready data, so polling delay is not timed.
  useEffect(() => {
    if (status === "ready" && readyAt === null) readyAt = performance.now();
  }, [status]);
  return null;
}
function Pages() {
  const { status } = useAppData();
  if (status !== "ready") return null;
  return h(Routes, null,
    h(Route, { path: "/", element: h(FlightDeck) }),
    h(Route, { path: "/study", element: h(StudyLibrary) }),
    h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }),
    h(Route, { path: "/questions", element: h(Questions) }));
}
/** Mount at a path; resolves with milliseconds from render start to the ready commit. */
async function mount(path: string): Promise<number> {
  readyAt = null;
  const started = performance.now();
  render(h(Profiler, { id: "app", onRender },
    h(AppDataProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Probe), h(Pages)))));
  await waitFor(() => expect(readyAt).not.toBeNull(), { timeout: 60_000 });
  return readyAt! - started;
}

/**
 * Page-ready checks for timed navigation. Direct DOM reads rather than
 * Testing Library role queries, whose own cost in jsdom would be timed too.
 */
function pageTitle(): string | undefined {
  return document.querySelector("h1.page-header__title")?.textContent ?? undefined;
}
async function waitForPage(ready: () => boolean) {
  if (ready()) return;
  await waitFor(() => expect(ready()).toBe(true), { timeout: 10_000 });
}

function resetCounters() {
  counts.selects = 0;
  counts.executes = 0;
  renders = 0;
  renderMs = 0;
}
const meter: Meter = {
  reset: resetCounters,
  read: () => ({ renders, renderMs, selects: counts.selects, executes: counts.executes }),
};

/** Node process memory, sampled after each timed step; the max is of those samples only. */
const memory = { maxRssMiB: 0, maxHeapUsedMiB: 0, samples: 0 };
function sampleMemory() {
  const usage = process.memoryUsage();
  memory.maxRssMiB = Math.max(memory.maxRssMiB, usage.rss / 1024 / 1024);
  memory.maxHeapUsedMiB = Math.max(memory.maxHeapUsedMiB, usage.heapUsed / 1024 / 1024);
  memory.samples++;
}

function sourceIdentity() {
  const git = (args: string) => {
    try {
      return execSync(`git ${args}`, { encoding: "utf8" }).trim();
    } catch {
      return "unavailable";
    }
  };
  return { head: git("rev-parse HEAD"), branch: git("branch --show-current"), dirtyFiles: git("status --porcelain").split("\n").filter(Boolean) };
}

afterEach(() => {
  cleanup();
  mockMissing = new Set();
});

it.skipIf(process.env.HFD_BENCH !== "1")("measures load, refresh, Study Library and navigation", async () => {
  const report: Record<string, unknown> = {
    environment: {
      node: process.version,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model,
      cpuCount: os.cpus().length,
      totalMemGiB: Math.round(os.totalmem() / 1024 ** 3),
      source: sourceIdentity(),
      startedAt: new Date().toISOString(),
      repeats: REPEATS,
      warmupsDiscardedPerInteractionScenario: WARMUPS,
      timingDomain: "Node + jsdom: JavaScript, React and SQLite (node:sqlite) work. Not WebView paint, Tauri IPC or packaged startup.",
      memoryMethod: "process.memoryUsage() sampled after each timed step; max of samples, not true peak; Node process, not packaged app.",
      fileStatus: "MOCK: documentExists answered from the fixture; no filesystem access.",
    },
  };
  for (const [name, size] of Object.entries(SIZES)) {
    sessionStorage.clear();
    localStorage.clear();
    memory.maxRssMiB = 0;
    memory.maxHeapUsedMiB = 0;
    memory.samples = 0;
    const materials = fixtureLibrary(size.materials);
    mockMissing = new Set(materials.filter((m) => m.mockFileMissing).map((m) => m.filePath!));
    let base: TestDatabase | null = null;
    try {
      const seedMs = await timed(async () => {
        base = await seed(size, materials);
      });
      db = instrument(base!);
      const row: Record<string, unknown> = {
        dataset: size,
        fixtureSha256: await fixtureIdentity(materials),
        fixtureCoverage: {
          withTags: materials.filter((m) => m.tags.length).length,
          duplicateTitle: materials.filter((m) => m.title === "Weight and balance worksheet").length,
          unicodeTitles: materials.filter((m) => m.index % 10 === 1).length,
          withFile: materials.filter((m) => m.filePath).length,
          mockMissingFile: mockMissing.size,
        },
        seedMsNotMeasured: Math.round(seedMs),
      };

      // Database load alone: the Study Library's list query plus tag join, through the real repository.
      const repos = createRepositories(db);
      const list: number[] = [];
      let listQueries = 0;
      for (let r = 0; r < WARMUPS + REPEATS; r++) {
        resetCounters();
        let loaded: Awaited<ReturnType<typeof repos.documents.list>> = [];
        const ms = await timed(async () => {
          loaded = await repos.documents.list();
        });
        expect(loaded).toHaveLength(size.materials);
        expect(loaded.reduce((n, m) => n + m.tags.length, 0)).toBe(materials.reduce((n, m) => n + m.tags.length, 0));
        if (r >= WARMUPS) list.push(ms);
        listQueries = counts.selects;
      }
      row.dbMaterialsListMs = stats(list);
      row.dbMaterialsListSelects = listQueries;

      // Cold load to the first committed ready state: provider + loadAll of every
      // section + first Study Library render. Fresh provider each time.
      const load: number[] = [];
      let loadQueries = 0;
      for (let r = 0; r < REPEATS; r++) {
        resetCounters();
        load.push(await mount("/study"));
        loadQueries = counts.selects;
        sampleMemory();
        expect(renderedResult()).toMatchObject({ total: size.materials });
        cleanup();
      }
      row.coldLoadToLibraryListedMs = stats(load);
      row.loadSelectQueries = loadQueries;

      // Study Library interactions, each verified against the answer key.
      await mount("/study");
      row.studyLibrary = await runLibraryScenarios({
        materials, loaded: () => context.data.materials, meter, repeats: REPEATS, warmups: WARMUPS, afterStep: sampleMemory,
      });

      // One small mutation end to end, including the full refresh it triggers.
      const actionMutation: number[] = [];
      let actionQueries = { selects: 0, executes: 0 };
      let rendersPerMutation = 0;
      for (let r = 0; r < REPEATS; r++) {
        resetCounters();
        actionMutation.push(await timed(async () => {
          await act(async () => {
            await context.mutate((repos) => repos.actions.update(`a-${r}`, { priority: r % 2 ? "later" : "important" }));
          });
        }));
        sampleMemory();
        actionQueries = { ...counts };
        rendersPerMutation = renders;
      }
      row.actionMutationWithRefreshMs = stats(actionMutation);
      row.actionMutationQueries = actionQueries;
      row.rendersPerMutation = rendersPerMutation;

      // A material edit refreshes the list the library filters; check it shows.
      const materialMutation: number[] = [];
      let materialQueries = { selects: 0, executes: 0 };
      for (let r = 0; r < REPEATS; r++) {
        const id = materialId(5 + r);
        const reviewStatus = r % 2 ? "studying" : "confident";
        resetCounters();
        materialMutation.push(await timed(async () => {
          await act(async () => {
            await context.mutate((repos) => repos.documents.update(id, { reviewStatus }));
          });
        }));
        sampleMemory();
        materialQueries = { ...counts };
        expect(context.data.materials.find((m) => m.id === id)?.reviewStatus).toBe(reviewStatus);
      }
      row.materialMutationWithRefreshMs = stats(materialMutation);
      row.materialMutationQueries = materialQueries;

      // Open a material and go back, for each file state. Opening waits for the
      // title, and for a stored file also for the (mocked) existence check.
      const openCases = {
        noFile: fixtureMaterial(3, size.materials),
        presentFileMock: fixtureMaterial(4, size.materials),
        missingFileMock: fixtureMaterial(8, size.materials),
      };
      const openResults: Record<string, unknown> = {};
      const back: number[] = [];
      for (const [kind, material] of Object.entries(openCases)) {
        const samples: number[] = [];
        for (let r = 0; r < REPEATS; r++) {
          fileChecks.length = 0;
          samples.push(await timed(async () => {
            await act(async () => navigate(`/study/${material.id}`));
            await waitForPage(() => pageTitle() === material.title);
            if (material.filePath) {
              await vi.waitFor(() => expect(fileChecks).toContain(material.filePath));
              await act(async () => {});
            }
          }));
          sampleMemory();
          const missingShown = screen.queryByText("This file is no longer in your library storage.") !== null;
          expect(missingShown).toBe(material.mockFileMissing);
          back.push(await timed(async () => {
            await act(async () => navigate("/study"));
            await waitForPage(() => pageTitle() === "Study Library");
          }));
        }
        openResults[kind] = { materialId: material.id, missingNoticeShown: material.mockFileMissing, openMs: stats(samples) };
      }
      row.openMaterial = openResults;
      row.backToLibraryMs = stats(back);

      // Section navigation: Flight Deck → Study Library → Questions, repeated,
      // timed per leg as well as in total.
      const nav: number[] = [];
      const legs = { flightDeck: [] as number[], studyLibrary: [] as number[], questions: [] as number[] };
      for (let r = 0; r < REPEATS; r++) {
        nav.push(await timed(async () => {
          legs.flightDeck.push(await timed(async () => {
            await act(async () => navigate("/"));
            await waitForPage(() => document.body.textContent?.includes("Daily Flight Plan") ?? false);
          }));
          legs.studyLibrary.push(await timed(async () => {
            await act(async () => navigate("/study"));
            await waitForPage(() => pageTitle() === "Study Library");
          }));
          legs.questions.push(await timed(async () => {
            await act(async () => navigate("/questions"));
            await waitForPage(() => pageTitle() === "Questions");
          }));
        }));
        sampleMemory();
      }
      row.navigationLegMs = {
        flightDeck: stats(legs.flightDeck),
        studyLibrary: stats(legs.studyLibrary),
        questions: stats(legs.questions),
      };
      row.questionsDomNodes = document.querySelectorAll("*").length;
      row.threeSectionNavigationMs = stats(nav);

      const end = process.memoryUsage();
      row.nodeMemory = {
        endHeapUsedMiB: Math.round(end.heapUsed / 1024 / 1024),
        endRssMiB: Math.round(end.rss / 1024 / 1024),
        maxSampledHeapUsedMiB: Math.round(memory.maxHeapUsedMiB),
        maxSampledRssMiB: Math.round(memory.maxRssMiB),
        samples: memory.samples,
      };
      report[name] = row;
    } finally {
      cleanup();
      (base as TestDatabase | null)?.close();
    }
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
  if (process.env.HFD_BENCH_OUT) writeFileSync(process.env.HFD_BENCH_OUT, JSON.stringify(report, null, 2));
}, 1_800_000);
