// @vitest-environment jsdom
/**
 * STUDY-FLOW-01b: Integration tests for dependable next step in Daily Flight Plan.
 *
 * Verifies:
 * - Cold/no-enrolment state offers honest Start/Open without requiring school/instructor/account.
 * - Prominent first item shows "Next in your plan" and single primary Continue when homework is in progress/reopened.
 * - Exact canonical activity route (/study/homework/:assignmentId?activity=:activityId) is targeted.
 * - Reopen and re-render against the same SQLite database preserves the exact destination and Continue state.
 * - Partially completed assignment with next upcoming activity offers Start (not Continue).
 * - Clicking/repeating Continue never creates duplicate homework, actions, or history, and never completes activities.
 * - Skip and defer advance the prominent primary to the next suggestion while preserving source due dates and status.
 * - Archived or missing source yields safe Open (never Continue or claim readiness).
 * - Local-action CTA focuses its rendered control on FlightDeck, or falls back to status guidance.
 * - RequiresSourceCheck renders honest plain guidance that source is checked when opened, keeping internal IDs private.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { addDays, todayIso } from "@/lib/dates";
import { FlightDeck } from "@/pages/FlightDeck/FlightDeck";
import {
  homeworkOperation,
  newHomework,
  newHomeworkActivity,
} from "@/pages/StudyLibrary/homeworkUi";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

import { DailyPlanCard } from "./DailyPlanCard";

let dbDir: string;
let dbPath: string;
let db: TestDatabase;
let repos: Repositories;

vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

beforeEach(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "hfd-study-flow-01b-"));
  dbPath = join(dbDir, "study-flow-test.db");
  db = await createNodeSqliteDatabase(dbPath);
  repos = createRepositories(db);
  await repos.app.set("airline_starter_pack", "skipped-for-tests");
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

const today = todayIso();

function ReadyFlightDeck() {
  const { status } = useAppData();
  return status === "ready" ? h(FlightDeck) : null;
}

function ReadyDailyPlan({ customToday }: { customToday?: string }) {
  const { status } = useAppData();
  return status === "ready" ? h(DailyPlanCard, { customToday }) : null;
}

function renderDailyPlan(customToday = today) {
  return render(
    h(
      AppDataProvider,
      null,
      h(
        MemoryRouter,
        { initialEntries: ["/"] },
        h(
          Routes,
          null,
          h(Route, { path: "/", element: h(ReadyDailyPlan, { customToday }) }),
          h(Route, {
            path: "/study/homework/:assignmentId",
            element: h("div", { "data-testid": "homework-route" }, "Homework canonical view"),
          }),
        ),
      ),
    ),
  );
}

function renderFlightDeck() {
  return render(
    h(
      AppDataProvider,
      null,
      h(
        MemoryRouter,
        { initialEntries: ["/"] },
        h(
          Routes,
          null,
          h(Route, { path: "/", element: h(ReadyFlightDeck) }),
          h(Route, {
            path: "/study/homework/:assignmentId",
            element: h("div", { "data-testid": "homework-route" }, "Homework canonical view"),
          }),
        ),
      ),
    ),
  );
}

describe("STUDY-FLOW-01b: dependable next step in Daily Flight Plan", () => {
  it("no-enrolment and cold state presents honest Start without guilt or readiness claims", async () => {
    // Zero school, instructor, or flight path enrolment configured.
    await repos.actions.create({
      title: "Inspect engine oil and fuel sumps",
      dueDate: today,
      estimatedMinutes: 10,
    });

    renderDailyPlan();
    await screen.findByText("Daily Flight Plan");

    // First suggested item is prominent
    expect(await screen.findByText("Next in your plan")).toBeTruthy();
    expect(screen.getByText("Inspect engine oil and fuel sumps")).toBeTruthy();

    // Primary CTA is an honest Start button, not Continue
    const startBtn = screen.getByRole("button", {
      name: "Start action: Inspect engine oil and fuel sumps",
    });
    expect(startBtn.textContent).toBe("Start");

    // Never invents pass scores, readiness percentages, or guilt mechanics
    const cardText = document.querySelector(".daily-plan-card")?.textContent || "";
    expect(cardText).not.toContain("readiness");
    expect(cardText).not.toContain("mastery");
    expect(cardText).not.toContain("%");
    expect(cardText).not.toContain("streak");
  });

  it("actual durable reopened homework first item offers Continue and exact canonical activity route", async () => {
    // 1. Create homework with a checklist activity overdue so it ranks first in the plan
    const prev = newHomework();
    const draft = structuredClone(prev);
    draft.assignment.title = "Preflight walkaround checklist";
    draft.assignment.due_date = addDays(today, -1);
    const act = newHomeworkActivity(draft.assignment.id, 0, "checklist", draft.assignment.created_at);
    act.record.title = "Verify control surfaces and pitot cover";
    draft.activities = [act];

    const createOp = homeworkOperation(prev, draft, "create", true);
    await repos.homework.save(createOp);

    // 2. Complete through valid repository operation: complete must change ONLY target.state to completed, not body
    const completeDraft = structuredClone(createOp.next);
    completeDraft.activities[0]!.record.state = "completed";
    const completeOp = homeworkOperation(createOp.next, completeDraft, "complete");
    await repos.homework.save(completeOp);

    // 3. Reopen using existing operation helper: reopen must change target.cycle, preserving body
    const reopenDraft = structuredClone(completeOp.next);
    reopenDraft.activities[0]!.record.cycle++;
    const reopenOp = homeworkOperation(completeOp.next, reopenDraft, "reopen");
    await repos.homework.save(reopenOp);

    renderDailyPlan();
    await screen.findByText("Daily Flight Plan");

    // First suggested item is visually prominent with "Next in your plan"
    expect(await screen.findByText("Next in your plan")).toBeTruthy();
    expect(screen.getByText("Verify control surfaces and pitot cover")).toBeTruthy();

    // Primary button visible text is "Continue"
    const continueLink = await screen.findByRole("link", {
      name: "Continue homework for Verify control surfaces and pitot cover",
    });
    expect(continueLink.textContent).toBe("Continue");

    // Exact canonical activity route
    const expectedHref = `/study/homework/${draft.assignment.id}?activity=${act.record.id}`;
    expect(continueLink.getAttribute("href")).toBe(expectedHref);
  });

  it("reopen and re-render against the same SQLite database retains the exact destination", async () => {
    // Setup durable reopened homework
    const prev = newHomework();
    const draft = structuredClone(prev);
    draft.assignment.title = "Emergency procedures checklist";
    draft.assignment.due_date = addDays(today, -1);
    const act = newHomeworkActivity(draft.assignment.id, 0, "checklist", draft.assignment.created_at);
    act.record.title = "Engine failure in flight checklist";
    draft.activities = [act];

    const createOp = homeworkOperation(prev, draft, "create", true);
    await repos.homework.save(createOp);

    const completeDraft = structuredClone(createOp.next);
    completeDraft.activities[0]!.record.state = "completed";
    const completeOp = homeworkOperation(createOp.next, completeDraft, "complete");
    await repos.homework.save(completeOp);

    const reopenDraft = structuredClone(completeOp.next);
    reopenDraft.activities[0]!.record.cycle++;
    const reopenOp = homeworkOperation(completeOp.next, reopenDraft, "reopen");
    await repos.homework.save(reopenOp);

    const firstRender = renderDailyPlan();
    await screen.findByText("Daily Flight Plan");
    const link1 = await screen.findByRole("link", {
      name: "Continue homework for Engine failure in flight checklist",
    });
    const expectedHref = `/study/homework/${draft.assignment.id}?activity=${act.record.id}`;
    expect(link1.getAttribute("href")).toBe(expectedHref);

    // Unmount view, close database connection, and reopen same file from disk
    firstRender.unmount();
    db.close();

    db = await createNodeSqliteDatabase(dbPath);
    repos = createRepositories(db);

    renderDailyPlan();
    await screen.findByText("Daily Flight Plan");

    const link2 = await screen.findByRole("link", {
      name: "Continue homework for Engine failure in flight checklist",
    });
    expect(link2.textContent).toBe("Continue");
    expect(link2.getAttribute("href")).toBe(expectedHref);
  });

  it("next UPCOMING activity in partially completed assignment offers Start (not Continue)", async () => {
    const prev = newHomework();
    const draft = structuredClone(prev);
    draft.assignment.title = "Cross-country preparations";
    draft.assignment.due_date = addDays(today, -1);

    const act0 = newHomeworkActivity(draft.assignment.id, 0, "checklist", draft.assignment.created_at);
    act0.record.title = "Weather and NOTAM briefing";

    const act1 = newHomeworkActivity(draft.assignment.id, 1, "checklist", draft.assignment.created_at);
    act1.record.title = "Weight and balance computation";

    draft.activities = [act0, act1];
    const createOp = homeworkOperation(prev, draft, "create", true);
    await repos.homework.save(createOp);

    // Complete only Activity 0
    const partialDraft = structuredClone(createOp.next);
    partialDraft.activities.find((a) => a.record.id === act0.record.id)!.record.state =
      "completed";
    const completeOp = homeworkOperation(createOp.next, partialDraft, "complete");
    await repos.homework.save(completeOp);

    renderDailyPlan();
    await screen.findByText("Daily Flight Plan");

    // The first incomplete activity is Activity 1 ("Weight and balance computation")
    expect(await screen.findByText("Next in your plan")).toBeTruthy();
    expect(screen.getByText("Weight and balance computation")).toBeTruthy();

    // Since Activity 1 is still upcoming, the primary button says "Start", not "Continue"
    const startLink = await screen.findByRole("link", {
      name: "Start homework for Weight and balance computation",
    });
    expect(startLink.textContent).toBe("Start");
    expect(startLink.getAttribute("href")).toBe(
      `/study/homework/${draft.assignment.id}?activity=${act1.record.id}`,
    );
  });

  it("clicking/repeating Continue does not create duplicate homework, actions, or history, nor complete activity", async () => {
    const prev = newHomework();
    const draft = structuredClone(prev);
    draft.assignment.title = "Traffic pattern entry practice";
    draft.assignment.due_date = addDays(today, -1);
    const act = newHomeworkActivity(draft.assignment.id, 0, "checklist", draft.assignment.created_at);
    act.record.title = "Pattern altitude checklist";
    draft.activities = [act];

    const createOp = homeworkOperation(prev, draft, "create", true);
    await repos.homework.save(createOp);

    const completeDraft = structuredClone(createOp.next);
    completeDraft.activities[0]!.record.state = "completed";
    const completeOp = homeworkOperation(createOp.next, completeDraft, "complete");
    await repos.homework.save(completeOp);

    const reopenDraft = structuredClone(completeOp.next);
    reopenDraft.activities[0]!.record.cycle++;
    const reopenOp = homeworkOperation(completeOp.next, reopenDraft, "reopen");
    await repos.homework.save(reopenOp);

    const historyBefore = await repos.homework.history(draft.assignment.id);
    const actionsBefore = await repos.actions.list();
    const snapshotBefore = await repos.homework.get(draft.assignment.id);

    renderDailyPlan();
    await screen.findByText("Daily Flight Plan");

    const continueLink = await screen.findByRole("link", {
      name: "Continue homework for Pattern altitude checklist",
    });

    // Simulate clicking Continue multiple times
    fireEvent.click(continueLink);
    fireEvent.click(continueLink);

    // Verify zero database mutations or side-effects
    const historyAfter = await repos.homework.history(draft.assignment.id);
    expect(historyAfter.length).toBe(historyBefore.length);

    const actionsAfter = await repos.actions.list();
    expect(actionsAfter.length).toBe(actionsBefore.length);

    const snapshotAfter = await repos.homework.get(draft.assignment.id);
    expect(snapshotAfter?.assignment.state).toBe(snapshotBefore?.assignment.state);
    expect(snapshotAfter?.activities[0]?.record.state).toBe("reopened");
    expect(snapshotAfter?.assignment.completed_at).toBeNull();
  });

  it("skip and defer update the primary item to the next suggestion and leave source due dates intact", async () => {
    // Item 1: Overdue homework assignment
    const prev = newHomework();
    const draft = structuredClone(prev);
    draft.assignment.title = "VFR navigation log";
    draft.assignment.due_date = addDays(today, -2);
    const act = newHomeworkActivity(draft.assignment.id, 0, "checklist", draft.assignment.created_at);
    act.record.title = "Calculate magnetic course";
    draft.activities = [act];
    const createOp = homeworkOperation(prev, draft, "create", true);
    await repos.homework.save(createOp);

    // Item 2: Overdue standalone action
    const action2 = await repos.actions.create({
      title: "File flight plan with FSS",
      dueDate: addDays(today, -1),
      estimatedMinutes: 10,
    });

    renderDailyPlan();
    await screen.findByText("Daily Flight Plan");

    // Initially, Item 1 is prominent with "Next in your plan"
    expect(await screen.findByText("Next in your plan")).toBeTruthy();
    expect(screen.getByText("Calculate magnetic course")).toBeTruthy();

    // Skip Item 1 for today
    fireEvent.click(
      screen.getByRole("button", { name: "Skip Calculate magnetic course for today" }),
    );

    // Item 2 becomes prominent as the new first suggested item
    await waitFor(() => {
      expect(screen.queryByText("Calculate magnetic course")).toBeNull();
      expect(screen.getByText("File flight plan with FSS")).toBeTruthy();
      expect(screen.getByText("Next in your plan")).toBeTruthy();
    });

    // Check that source due dates and status in SQLite database are untouched
    const action1Row = await repos.actions.get(createOp.next.assignment.action_id!);
    expect(action1Row?.dueDate).toBe(addDays(today, -2));
    expect(action1Row?.status).toBe("open");

    const action2Row = await repos.actions.get(action2.id);
    expect(action2Row?.dueDate).toBe(addDays(today, -1));
    expect(action2Row?.status).toBe("open");

    // Move Item 2 to tomorrow
    fireEvent.click(
      screen.getByRole("button", { name: "Move File flight plan with FSS to tomorrow" }),
    );

    await waitFor(async () => {
      const refreshed2 = await repos.actions.get(action2.id);
      // Original due date stays exactly as it was
      expect(refreshed2?.dueDate).toBe(addDays(today, -1));
      expect(refreshed2?.status).toBe("open");
    });
  });

  it("archived and missing sources yield safe Open (never Continue or claim readiness)", async () => {
    // 1. Archived homework is deliberately filtered from recommendations
    const prev = newHomework();
    const draft = structuredClone(prev);
    draft.assignment.title = "Archived instrument cross-check";
    draft.assignment.due_date = addDays(today, -1);
    const act = newHomeworkActivity(draft.assignment.id, 0, "checklist", draft.assignment.created_at);
    act.record.title = "Standard rate turn scan";
    draft.activities = [act];
    const createOp = homeworkOperation(prev, draft, "create", true);
    await repos.homework.save(createOp);

    const archiveDraft = structuredClone(createOp.next);
    archiveDraft.assignment.archived = 1;
    const archiveOp = homeworkOperation(createOp.next, archiveDraft, "archive");
    await repos.homework.save(archiveOp);

    // 2. Add an action with missing related source via normal repositories (no raw SQL)
    const missingSourceAction = await repos.actions.create({
      title: "Review missing operating handbook",
      dueDate: addDays(today, -1),
      estimatedMinutes: 10,
      relatedType: "material",
      relatedId: "00000000-0000-4000-8000-000000000099",
    });

    renderDailyPlan();
    await screen.findByText("Daily Flight Plan");

    // Archived homework is absent from recommendations
    expect(screen.queryByText("Standard rate turn scan")).toBeNull();
    expect(screen.queryByText("Archived instrument cross-check")).toBeNull();

    // The missing-related-source action yields safe "Open", not "Continue"
    const openBtn = await screen.findByRole("button", {
      name: `Open action: ${missingSourceAction.title}`,
    });
    expect(openBtn.textContent).toBe("Open");
    expect(openBtn.textContent).not.toBe("Continue");

    fireEvent.click(openBtn);
    expect(
      await screen.findByText(
        `"${missingSourceAction.title}" isn't shown on this page. Find it in your action list.`,
      ),
    ).toBeTruthy();
  });

  it("local-action CTA focuses its rendered control on FlightDeck, or falls back to status guidance", async () => {
    const action = await repos.actions.create({
      title: "Review airport diagram",
      dueDate: today,
      estimatedMinutes: 5,
    });

    // Mount on real FlightDeck
    renderFlightDeck();
    await screen.findByText("Daily Flight Plan");

    const startBtn = await screen.findByRole("button", {
      name: "Start action: Review airport diagram",
    });
    expect(startBtn.textContent).toBe("Start");

    fireEvent.click(startBtn);

    // Focus lands on the action's own checkbox rendered in Flight Deck's action list
    const container = document.getElementById(`action-${action.id}`);
    const checkbox = container?.querySelector("input[type=checkbox]");
    expect(checkbox).toBeTruthy();
    expect(document.activeElement).toBe(checkbox);
  });

  it("default local-action focus succeeds without callback when control is present in the DOM", async () => {
    const action = await repos.actions.create({
      title: "Preflight weather briefing",
      dueDate: today,
      estimatedMinutes: 10,
    });

    render(
      h(
        "div",
        null,
        h(
          AppDataProvider,
          null,
          h(
            MemoryRouter,
            { initialEntries: ["/"] },
            h(
              Routes,
              null,
              h(Route, { path: "/", element: h(ReadyDailyPlan, { customToday: today }) }),
            ),
          ),
        ),
        h(
          "div",
          { id: `action-${action.id}` },
          h("input", { type: "checkbox", "aria-label": "Complete action" }),
        ),
      ),
    );

    await screen.findByText("Daily Flight Plan");

    const startBtn = await screen.findByRole("button", {
      name: "Start action: Preflight weather briefing",
    });
    expect(startBtn.textContent).toBe("Start");

    fireEvent.click(startBtn);

    const checkbox = document.getElementById(`action-${action.id}`)?.querySelector("input[type=checkbox]");
    expect(checkbox).toBeTruthy();
    expect(document.activeElement).toBe(checkbox);
  });

  it("requiresSourceCheck displays plain guidance that source is checked when opened without leaking raw IDs", async () => {
    const material = await repos.documents.create({
      title: "Pilot's Handbook of Aeronautical Knowledge",
      materialType: "reference",
      reviewStatus: "studying",
    });

    renderDailyPlan();
    await screen.findByText("Daily Flight Plan");

    // Guidance text is shown
    expect(await screen.findByText("Source is checked when opened")).toBeTruthy();

    // Internal availability metadata / raw IDs / paths are not rendered in normal UI
    const cardText = document.querySelector(".daily-plan-card")?.textContent || "";
    expect(cardText).not.toContain(material.id);
    expect(cardText).not.toContain("sourceAvailable");
  });
});
