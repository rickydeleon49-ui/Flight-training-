// @vitest-environment jsdom
/**
 * Daily Flight Plan card against the real AppDataProvider and a real SQLite
 * database, with the plan's own metadata writes instrumented so tests can hold
 * them (to force overlap), fail them, and count them.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import type { SqlValue } from "@/data/db";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { NextAction } from "@/domain/types";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

import { DailyPlanCard } from "./DailyPlanCard";

const TODAY = "2026-09-25";
const TOMORROW = "2026-09-26";
const YESTERDAY = "2026-09-24";
const PLAN_KEY = "daily_plan_session";

interface Faults {
  /** While set, plan writes wait for it to resolve. */
  gate: Promise<void> | null;
  failWrites: boolean;
  /** The next SELECT containing this text throws once (simulates a failed reload). */
  failSelect: string | null;
  writes: number;
}

const faults: Faults = { gate: null, failWrites: false, failSelect: null, writes: 0 };
let base: TestDatabase;
let db: TestDatabase;
let repos: Repositories;
let dir: string;

vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

function instrument(inner: TestDatabase): TestDatabase {
  return {
    async select<T>(sql: string, params?: SqlValue[]): Promise<T[]> {
      if (faults.failSelect && sql.includes(faults.failSelect)) {
        faults.failSelect = null;
        throw new Error("Could not reload the training record.");
      }
      return inner.select<T>(sql, params);
    },
    async execute(sql: string, params: SqlValue[] = []): Promise<void> {
      if (sql.includes("app_metadata") && params[0] === PLAN_KEY) {
        faults.writes++;
        if (faults.gate) await faults.gate;
        if (faults.failWrites) throw new Error("disk is full");
      }
      return inner.execute(sql, params);
    },
    close: () => inner.close(),
  };
}

async function openDatabase(): Promise<void> {
  base = await createNodeSqliteDatabase(join(dir, "plan.db"));
  db = instrument(base);
  repos = createRepositories(base);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "hfd-daily-plan-"));
  faults.gate = null;
  faults.failWrites = false;
  faults.failSelect = null;
  faults.writes = 0;
  await openDatabase();
  // Keep the airline starter pack out of these fixtures.
  await repos.app.set("airline_starter_pack", "skipped-for-tests");
});

afterEach(() => {
  cleanup();
  base.close();
  rmSync(dir, { recursive: true, force: true });
});

let context: ReturnType<typeof useAppData>;
function Probe() {
  context = useAppData();
  return null;
}
function Ready({ today }: { today: string }) {
  const { status } = useAppData();
  return status === "ready" ? h(DailyPlanCard, { customToday: today }) : null;
}
function tree(today: string) {
  return h(AppDataProvider, null, h(MemoryRouter, null, h(Probe), h(Ready, { today })));
}
async function mount(today = TODAY) {
  const view = render(tree(today));
  await waitFor(() => expect(context.status).toBe("ready"));
  return view;
}

function hold(): () => void {
  let release!: () => void;
  faults.gate = new Promise<void>((resolve) => {
    release = () => {
      faults.gate = null;
      resolve();
    };
  });
  return release;
}

const stored = () => repos.app.getDailyPlanState();
const suggestedTitles = () =>
  Array.from(document.querySelectorAll(".daily-plan-item__title")).map((el) => el.textContent);

async function action(title: string, minutes: number | null, dueDate: string | null = TODAY): Promise<NextAction> {
  return repos.actions.create({ title, estimatedMinutes: minutes, dueDate });
}

async function reload() {
  await act(async () => {
    await context.refresh();
  });
}

async function settled(ids: string[]) {
  await waitFor(async () => expect((await stored())?.suggestedIds).toEqual(ids));
}

describe("Daily Flight Plan card", () => {
  it("shows an honest empty state and never fabricates items", async () => {
    await mount();
    expect(screen.getByText("All recommended work completed for today.")).toBeTruthy();
    expect(screen.getByText(/No pending actions.*need attention/i)).toBeTruthy();
    expect(suggestedTitles()).toEqual([]);
  });

  it("shows only the items that exist, with named controls and a budget radiogroup", async () => {
    await action("Alpha", 5);
    await mount();

    await waitFor(() => expect(suggestedTitles()).toEqual(["Alpha"]));
    expect(screen.getByRole("radiogroup", { name: "Available minutes" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Start action: Alpha" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Why recommend Alpha?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip Alpha for today" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move Alpha to tomorrow" })).toBeTruthy();
    expect(screen.getByText("Due date stays the same")).toBeTruthy();
  });

  describe("session stability and persistence", () => {
    it("keeps A/B when a higher-priority C arrives, across a database reopen, until Refresh", async () => {
      const a = await action("Alpha", 5);
      const b = await action("Bravo", 5);
      const view = await mount();
      await settled([`action:${a.id}`, `action:${b.id}`]);

      const c = await action("Charlie", 5, YESTERDAY); // overdue: outranks A and B
      await reload();
      expect(suggestedTitles()).toEqual(["Alpha", "Bravo"]);
      expect(screen.getByText("Remaining unfinished work (1)")).toBeTruthy();
      expect((await stored())?.suggestedIds).toEqual([`action:${a.id}`, `action:${b.id}`]);

      // Quit and relaunch against the same file.
      view.unmount();
      base.close();
      await openDatabase();
      await mount();
      await waitFor(() => expect(suggestedTitles()).toEqual(["Alpha", "Bravo"]));

      fireEvent.click(screen.getByRole("button", { name: "Refresh daily plan recommendations" }));
      await waitFor(() => expect(suggestedTitles()).toEqual(["Charlie", "Alpha", "Bravo"]));
      await settled([`action:${c.id}`, `action:${a.id}`, `action:${b.id}`]);
    });

    it("refills only a vacated slot when a selected source is completed, then deleted", async () => {
      const a = await action("Alpha", 5);
      const b = await action("Bravo", 5);
      const d = await action("Delta", 15);
      await mount();
      await settled([`action:${a.id}`, `action:${b.id}`]); // Delta doesn't fit 20 - 10

      await repos.actions.update(a.id, { status: "completed", completedAt: `${TODAY}T10:00:00.000Z` });
      await reload();
      await waitFor(() => expect(suggestedTitles()).toEqual(["Bravo", "Delta"]));
      await settled([`action:${b.id}`, `action:${d.id}`]);

      await repos.actions.remove(b.id);
      await reload();
      await waitFor(() => expect(suggestedTitles()).toEqual(["Delta"]));
      expect(screen.queryByRole("button", { name: /Bravo/ })).toBeNull();
    });

    it("reports a failed first save honestly, does not loop, and recovers with Retry", async () => {
      await action("Alpha", 5);
      faults.failWrites = true;
      await mount();

      await screen.findByText(/Today's plan couldn't be saved/);
      expect(suggestedTitles()).toEqual(["Alpha"]);
      await reload();
      await reload();
      expect(faults.writes).toBe(1);
      expect(await stored()).toBeNull();

      faults.failWrites = false;
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(async () => expect((await stored())?.suggestedIds).toHaveLength(1));
      await waitFor(() => expect(screen.queryByText(/couldn't be saved/)).toBeNull());
    });

    it("does not keep writing on unchanged renders and reloads", async () => {
      const a = await action("Alpha", 5);
      const view = await mount();
      await settled([`action:${a.id}`]);
      const writesAfterFirstSave = faults.writes;
      expect(writesAfterFirstSave).toBe(1);

      await reload();
      await reload();
      view.rerender(tree(TODAY));
      await reload();
      expect(faults.writes).toBe(writesAfterFirstSave);
    });
  });

  describe("serialized decisions", () => {
    it("keeps both of two rapid skips made while the first write is still pending", async () => {
      const a = await action("Alpha", 5);
      const b = await action("Bravo", 5);
      await action("Delta", 5);
      await mount();
      await waitFor(async () => expect((await stored())?.suggestedIds).toHaveLength(3));

      const release = hold();
      fireEvent.click(screen.getByRole("button", { name: "Skip Alpha for today" }));
      fireEvent.click(screen.getByRole("button", { name: "Skip Bravo for today" }));
      release();

      await waitFor(async () => {
        const decisions = (await stored())?.decisions ?? {};
        expect(decisions[`action:${a.id}`]).toEqual({ type: "skip", date: TODAY });
        expect(decisions[`action:${b.id}`]).toEqual({ type: "skip", date: TODAY });
      });
      await waitFor(() => expect(suggestedTitles()).toEqual(["Delta"]));
    });

    it("keeps both a budget change and a deferral made back to back", async () => {
      await action("Alpha", 5);
      const b = await action("Bravo", 5);
      await mount();
      await waitFor(async () => expect((await stored())?.suggestedIds).toHaveLength(2));

      const release = hold();
      fireEvent.click(screen.getByRole("radio", { name: "10 min" }));
      fireEvent.click(screen.getByRole("button", { name: "Move Bravo to tomorrow" }));
      release();

      await waitFor(async () => {
        const state = await stored();
        expect(state?.timeBudget).toBe(10);
        expect(state?.decisions[`action:${b.id}`]).toEqual({ type: "defer", date: TODAY });
      });
    });

    it("resets two decisions in one write and neither comes back", async () => {
      const a = await action("Alpha", 5);
      const b = await action("Bravo", 5);
      await mount();
      await waitFor(async () => expect((await stored())?.suggestedIds).toHaveLength(2));

      fireEvent.click(screen.getByRole("button", { name: "Skip Alpha for today" }));
      await waitFor(async () => expect((await stored())?.decisions[`action:${a.id}`]).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Skip Bravo for today" }));
      await waitFor(async () => expect((await stored())?.decisions[`action:${b.id}`]).toBeTruthy());

      const before = faults.writes;
      fireEvent.click(screen.getAllByRole("button", { name: /Reset today's skips/ })[0] as HTMLElement);
      await waitFor(async () => expect((await stored())?.decisions).toEqual({}));
      expect(faults.writes).toBe(before + 1);
      await reload();
      expect((await stored())?.decisions).toEqual({});
      expect(screen.queryByRole("button", { name: /Reset today's skips/ })).toBeNull();
    });

    it("leaves the saved plan untouched when a decision write fails", async () => {
      const a = await action("Alpha", 5);
      await mount();
      await settled([`action:${a.id}`]);

      faults.failWrites = true;
      fireEvent.click(screen.getByRole("button", { name: "Skip Alpha for today" }));
      await screen.findByText(/That change couldn't be saved/);
      expect((await stored())?.decisions).toEqual({});
      expect(suggestedTitles()).toEqual(["Alpha"]);
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    });

    it("shows a saved decision even when the reload after it fails", async () => {
      const a = await action("Alpha", 5);
      await action("Bravo", 5);
      await mount();
      await waitFor(async () => expect((await stored())?.suggestedIds).toHaveLength(2));

      faults.failSelect = "FROM next_actions";
      fireEvent.click(screen.getByRole("button", { name: "Skip Alpha for today" }));
      await waitFor(() => expect(context.lastError).toBeTruthy());
      expect((await stored())?.decisions[`action:${a.id}`]).toEqual({ type: "skip", date: TODAY });
      await waitFor(() => expect(suggestedTitles()).toEqual(["Bravo"]));
      expect(screen.queryByText(/couldn't be saved/)).toBeNull();
    });

    it("completes a pending write safely after the card unmounts", async () => {
      const a = await action("Alpha", 5);
      const view = await mount();
      await settled([`action:${a.id}`]);

      const release = hold();
      fireEvent.click(screen.getByRole("button", { name: "Skip Alpha for today" }));
      view.unmount();
      release();
      await waitFor(async () =>
        expect((await stored())?.decisions[`action:${a.id}`]).toEqual({ type: "skip", date: TODAY }),
      );
    });

    it("never changes a source action's due date", async () => {
      const a = await action("Alpha", 5, TODAY);
      const b = await action("Bravo", 5, YESTERDAY);
      await mount();
      await waitFor(async () => expect((await stored())?.suggestedIds).toHaveLength(2));

      fireEvent.click(screen.getByRole("button", { name: "Skip Alpha for today" }));
      fireEvent.click(screen.getByRole("button", { name: "Move Bravo to tomorrow" }));
      await waitFor(async () => expect(Object.keys((await stored())?.decisions ?? {})).toHaveLength(2));

      const dates = Object.fromEntries((await repos.actions.list()).map((x) => [x.id, x.dueDate]));
      expect(dates[a.id]).toBe(TODAY);
      expect(dates[b.id]).toBe(YESTERDAY);
    });
  });

  describe("budget radiogroup keyboard", () => {
    const radio = (name: string) => screen.getByRole("radio", { name });
    const checked = () =>
      screen.getAllByRole("radio").find((el) => el.getAttribute("aria-checked") === "true")?.textContent;

    it("moves focus and selection together, with wraparound, Home and End", async () => {
      await action("Alpha", 5);
      await mount();
      await waitFor(async () => expect(await stored()).not.toBeNull());

      radio("20 min").focus();
      fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
      expect(document.activeElement).toBe(radio("30 min"));
      expect(checked()).toBe("30 min");

      fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
      fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
      expect(document.activeElement).toBe(radio("10 min")); // wrapped
      expect(checked()).toBe("10 min");

      fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" });
      expect(document.activeElement).toBe(radio("All / Untimed")); // wrapped back
      fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
      expect(document.activeElement).toBe(radio("10 min"));
      fireEvent.keyDown(document.activeElement as Element, { key: "End" });
      expect(document.activeElement).toBe(radio("All / Untimed"));

      await waitFor(async () => expect((await stored())?.timeBudget).toBeNull());
      expect(checked()).toBe("All / Untimed");
      expect(radio("All / Untimed").tabIndex).toBe(0);
      expect(radio("20 min").tabIndex).toBe(-1);
    });

    it("keeps focus on the attempted option but shows the saved budget when the save fails", async () => {
      await action("Alpha", 5);
      await mount();
      await waitFor(async () => expect((await stored())?.timeBudget).toBe(20));

      faults.failWrites = true;
      radio("20 min").focus();
      fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" });
      expect(document.activeElement).toBe(radio("10 min"));

      await screen.findByText(/That change couldn't be saved/);
      expect(checked()).toBe("20 min");
      expect(document.activeElement).toBe(radio("10 min"));
      expect((await stored())?.timeBudget).toBe(20);
    });
  });

  describe("local-date rollover while mounted", () => {
    it("expires yesterday's skip and deferral at the new local day without touching due dates", async () => {
      const a = await action("Alpha", 5, TODAY);
      const b = await action("Bravo", 5, TODAY);
      const view = await mount(TODAY);
      await waitFor(async () => expect((await stored())?.suggestedIds).toHaveLength(2));

      fireEvent.click(screen.getByRole("button", { name: "Skip Alpha for today" }));
      await waitFor(async () => expect((await stored())?.decisions[`action:${a.id}`]).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Move Bravo to tomorrow" }));
      await waitFor(async () => expect((await stored())?.decisions[`action:${b.id}`]).toBeTruthy());
      await waitFor(() => expect(suggestedTitles()).toEqual([]));

      // Same mounted card; the local date advances.
      view.rerender(tree(TOMORROW));
      await waitFor(() => expect(suggestedTitles()).toEqual(["Alpha", "Bravo"]));
      await waitFor(async () => {
        const state = await stored();
        expect(state?.date).toBe(TOMORROW);
        expect(state?.decisions).toEqual({});
      });
      const dates = (await repos.actions.list()).map((x) => x.dueDate);
      expect(dates).toEqual([TODAY, TODAY]);
    });
  });

  describe("budget exclusion vs finished work", () => {
    it("distinguishes budget exclusion from finished work when candidates exceed budget", async () => {
      const a = await action("Cross-country flight planning", 30);
      await mount();

      // Suggested should be empty because 30 min > 20 min default budget
      expect(suggestedTitles()).toEqual([]);
      // Honest budget exclusion message
      expect(screen.getByText("No suggestions fit your 20-minute budget.")).toBeTruthy();
      expect(
        screen.getByText(
          "Unfinished work exceeds your selected time budget. Choose a larger budget, select All / Untimed, or review and start remaining work below.",
        ),
      ).toBeTruthy();
      // Must NOT claim work is completed or postponed
      expect(screen.queryByText(/All recommended work completed/i)).toBeNull();
      expect(screen.queryByText(/No pending actions.*need attention/i)).toBeNull();

      // Remaining work control and Start action are discoverable
      expect(screen.getByRole("button", { name: /Remaining unfinished work \(1\)/i })).toBeTruthy();
      const viewRemainingBtn = screen.getByRole("button", { name: "View remaining work (1)" });
      fireEvent.click(viewRemainingBtn);

      // Remaining work item and Start button are visible and usable
      expect(screen.getByText("Cross-country flight planning")).toBeTruthy();
      expect(screen.getByText("(30 min)")).toBeTruthy();
      expect(screen.getByRole("button", { name: `Start action: ${a.title}` })).toBeTruthy();
    });

    it("reports honest empty state when sources are genuinely empty", async () => {
      await mount();
      expect(screen.getByText("All recommended work completed for today.")).toBeTruthy();
      expect(
        screen.getByText("No pending actions, lesson preparations, or study materials need attention today."),
      ).toBeTruthy();
      expect(suggestedTitles()).toEqual([]);
      expect(screen.queryByText(/Remaining unfinished work/i)).toBeNull();
    });

    it("shows postponed messaging and reset control when all candidates are skipped or deferred", async () => {
      await action("Preflight walkaround", 10);
      await mount();
      await waitFor(() => expect(suggestedTitles()).toEqual(["Preflight walkaround"]));

      fireEvent.click(screen.getByRole("button", { name: "Skip Preflight walkaround for today" }));
      await waitFor(() => expect(suggestedTitles()).toEqual([]));

      expect(screen.getByText("All recommended work completed or postponed for today.")).toBeTruthy();
      expect(screen.getByText("You've skipped or moved tasks for today. You can reset skips to restore them.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Reset today's skips & postponements" })).toBeTruthy();
    });

    it("includes and honestly discloses a valid unknown-duration suggestion", async () => {
      const a = await action("Review emergency checklist", null);
      await mount();

      await waitFor(() => expect(suggestedTitles()).toEqual(["Review emergency checklist"]));
      expect(screen.getByText("Estimate unknown")).toBeTruthy();
      expect(screen.getByText(/total duration indeterminate/i)).toBeTruthy();
      expect(screen.getByRole("button", { name: `Start action: ${a.title}` })).toBeTruthy();
    });
  });
});
