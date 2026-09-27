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
 * Synthetic data only. Each figure is the median of a fixed number of repeats,
 * with min and max reported for variability.
 */
import { writeFileSync } from "node:fs";
import { Profiler, createElement as h, type ProfilerOnRenderCallback } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

/**
 * Realistic tiers for one student pilot. Most actions end up completed and
 * most questions answered over time; the Study Library is the part that can
 * grow large, because automatic PDF splitting turns one book into many parts.
 * - small: first weeks of training
 * - medium: about a year of training with a split handbook or two
 * - large: several years, a heavily split library, long training record
 */
const SIZES = {
  small: { materials: 100, actions: 100, journal: 30, questions: 50 },
  medium: { materials: 1_000, actions: 400, journal: 150, questions: 250 },
  large: { materials: 5_000, actions: 1_500, journal: 500, questions: 800 },
} as const;
/** Share of actions still open and of questions still unanswered. */
const OPEN_ACTION_EVERY = 5; // 1 in 5 open, the rest completed
const UNANSWERED_EVERY = 3; // 1 in 3 still to ask
const REPEATS = 5;

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

async function seed(size: (typeof SIZES)[keyof typeof SIZES]) {
  const base = await createNodeSqliteDatabase();
  const repos = createRepositories(base);
  await repos.app.set("airline_starter_pack", "skipped-for-bench");
  const today = todayIso();
  const topics = ["airports", "weather", "regulations", "aerodynamics", "navigation"] as const;
  await base.execute("BEGIN");
  for (let i = 0; i < size.materials; i++) {
    await repos.documents.create({
      id: `m-${i}`,
      title: `Synthetic material ${i} — ${topics[i % 5]} review`,
      topic: topics[i % 5],
      materialType: "reference",
      notes: "Synthetic notes for benchmarking search across the library.",
    });
  }
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
      relatedId: i % 2 ? `m-${i % size.materials}` : null,
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
  await base.execute("COMMIT");
  return base;
}

let context: ReturnType<typeof useAppData>;
let navigate: ReturnType<typeof useNavigate>;
let renders = 0;
let renderMs = 0;
const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
  renders++;
  renderMs += actualDuration;
};
function Probe() {
  context = useAppData();
  navigate = useNavigate();
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
async function mount(path: string) {
  render(h(Profiler, { id: "app", onRender },
    h(AppDataProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Probe), h(Pages)))));
  await waitFor(() => expect(context.status).toBe("ready"), { timeout: 60_000 });
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 100) / 100;
  return { median: round(sorted[Math.floor(sorted.length / 2)]!), min: round(sorted[0]!), max: round(sorted.at(-1)!), n: sorted.length };
}
async function timed(work: () => Promise<void>) {
  const started = performance.now();
  await work();
  return performance.now() - started;
}
function resetCounters() {
  counts.selects = 0;
  counts.executes = 0;
  renders = 0;
  renderMs = 0;
}

afterEach(() => cleanup());

it.skipIf(process.env.HFD_BENCH !== "1")("measures load, refresh, Study Library and navigation", async () => {
  const report: Record<string, unknown> = {};
  for (const [name, size] of Object.entries(SIZES)) {
    const base = await seed(size);
    db = instrument(base);
    const row: Record<string, unknown> = { dataset: size };

    // Cold load to first ready state (provider + loadAll), fresh provider each time.
    const load: number[] = [];
    let loadQueries = 0;
    for (let r = 0; r < REPEATS; r++) {
      resetCounters();
      load.push(await timed(() => mount("/study")));
      loadQueries = counts.selects;
      cleanup();
    }
    row.coldLoadMs = stats(load);
    row.loadSelectQueries = loadQueries;

    // One small mutation end to end (toggle an action), including the refresh.
    await mount("/study");
    await screen.findByRole("heading", { name: "Study Library" });
    const mutation: number[] = [];
    let mutationQueries = { selects: 0, executes: 0 };
    for (let r = 0; r < REPEATS; r++) {
      resetCounters();
      mutation.push(await timed(async () => {
        await act(async () => {
          await context.mutate((repos) => repos.actions.update(`a-${r}`, { priority: r % 2 ? "later" : "important" }));
        });
      }));
      mutationQueries = { ...counts };
    }
    row.singleMutationWithRefreshMs = stats(mutation);
    row.singleMutationQueries = mutationQueries;
    row.rendersPerMutation = renders;

    // Study Library: typing a search, one keystroke at a time.
    const search = screen.getByLabelText("Search your library") as HTMLInputElement;
    const keys: number[] = [];
    let keystrokeRenders = 0;
    const word = "airspa";
    for (let r = 0; r < REPEATS; r++) {
      for (let i = 1; i <= word.length; i++) {
        resetCounters();
        keys.push(await timed(async () => {
          await act(async () => {
            fireEvent.change(search, { target: { value: word.slice(0, i) } });
          });
        }));
        keystrokeRenders = renders;
      }
      await act(async () => {
        fireEvent.change(search, { target: { value: "" } });
      });
    }
    row.searchKeystrokeMs = stats(keys);
    row.rendersPerKeystroke = keystrokeRenders;

    // Sort change and back.
    const sortSelect = screen.getByLabelText("Sort materials") as HTMLSelectElement;
    const sortOptions = Array.from(sortSelect.options).map((o) => o.value);
    const sorts: number[] = [];
    for (let r = 0; r < REPEATS; r++) {
      sorts.push(await timed(async () => {
        await act(async () => {
          fireEvent.change(sortSelect, { target: { value: sortOptions[(r % (sortOptions.length - 1)) + 1] } });
        });
      }));
    }
    row.sortChangeMs = stats(sorts);

    // Open a material, then back to the library.
    const open: number[] = [];
    const back: number[] = [];
    for (let r = 0; r < REPEATS; r++) {
      open.push(await timed(async () => {
        await act(async () => navigate(`/study/m-${r}`));
        await screen.findByRole("heading", { name: new RegExp(`^Synthetic material ${r} `) });
      }));
      back.push(await timed(async () => {
        await act(async () => navigate("/study"));
        await screen.findByRole("heading", { name: "Study Library" });
      }));
    }
    row.openMaterialMs = stats(open);
    row.backToLibraryMs = stats(back);

    // Section navigation: Flight Deck → Study Library → Questions, repeated,
    // timed per leg as well as in total.
    const nav: number[] = [];
    const legs = { flightDeck: [] as number[], studyLibrary: [] as number[], questions: [] as number[] };
    for (let r = 0; r < REPEATS; r++) {
      nav.push(await timed(async () => {
        legs.flightDeck.push(await timed(async () => {
          await act(async () => navigate("/"));
          await screen.findByText("Daily Flight Plan");
        }));
        legs.studyLibrary.push(await timed(async () => {
          await act(async () => navigate("/study"));
          await screen.findByRole("heading", { name: "Study Library" });
        }));
        legs.questions.push(await timed(async () => {
          await act(async () => navigate("/questions"));
          await screen.findByRole("heading", { name: "Questions" });
        }));
      }));
    }
    row.navigationLegMs = {
      flightDeck: stats(legs.flightDeck),
      studyLibrary: stats(legs.studyLibrary),
      questions: stats(legs.questions),
    };
    row.questionsDomNodes = document.querySelectorAll("*").length;
    row.threeSectionNavigationMs = stats(nav);

    row.heapUsedMiB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    cleanup();
    base.close();
    report[name] = row;
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
  if (process.env.HFD_BENCH_OUT) writeFileSync(process.env.HFD_BENCH_OUT, JSON.stringify(report, null, 2));
}, 600_000);
