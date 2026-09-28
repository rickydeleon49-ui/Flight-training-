// @vitest-environment jsdom
/**
 * Questions renders a bounded number of rows at a time. Every question must
 * stay reachable, filters must cover the whole list, and each row's links
 * (looked up through id maps) must stay correct.
 */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

import { QUESTION_PAGE_SIZE, Questions } from "./Questions";

/**
 * Seeding and rendering hundreds of questions takes about 2.3 s on its own,
 * but over the 5 s default when the whole suite runs files in parallel.
 * A longer limit for these long-list tests only; no assertion is relaxed.
 */
const LONG_LIST_TIMEOUT_MS = 20_000;

let db: TestDatabase;
let repos: Repositories;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

let context: ReturnType<typeof useAppData>;
function Probe() {
  context = useAppData();
  return null;
}
function Ready() {
  return useAppData().status === "ready" ? h(Questions) : null;
}
async function open() {
  render(h(AppDataProvider, null, h(MemoryRouter, null, h(Probe), h(Ready))));
  await waitFor(() => expect(context.status).toBe("ready"));
  await screen.findByRole("heading", { name: "Questions" });
}
const rows = () => document.querySelectorAll(".question-row").length;

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  db = await createNodeSqliteDatabase();
  repos = createRepositories(db);
  await repos.app.set("airline_starter_pack", "skipped-for-tests");
});
afterEach(() => {
  cleanup();
  db.close();
});

describe("Questions list with a long history", () => {
  it("shows a page at a time, keeps every question reachable, and filters the whole list", async () => {
    const total = QUESTION_PAGE_SIZE * 2 + 50;
    for (let i = 0; i < total; i++) {
      await repos.questions.create({
        text: `Synthetic question ${i}`,
        status: i % 2 ? "answered" : "to_ask",
        answer: i % 2 ? "Synthetic answer" : "",
      });
    }
    await open();

    expect(rows()).toBe(QUESTION_PAGE_SIZE);
    expect(screen.getByText(`Showing ${QUESTION_PAGE_SIZE} of ${total} questions`)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `Show ${QUESTION_PAGE_SIZE} more questions` }));
    expect(rows()).toBe(QUESTION_PAGE_SIZE * 2);
    fireEvent.click(screen.getByRole("button", { name: "Show 50 more questions" }));
    expect(rows()).toBe(total);
    expect(screen.queryByRole("button", { name: /more questions/ })).toBeNull();
    // The oldest question (created first, listed last) is reachable.
    expect(screen.getByText("Synthetic question 0")).toBeTruthy();

    // A status filter covers the whole list and starts again from one page.
    fireEvent.click(screen.getByRole("button", { name: "Answered" }));
    const answered = Math.floor(total / 2);
    expect(rows()).toBe(QUESTION_PAGE_SIZE);
    expect(screen.getByText(`Showing ${QUESTION_PAGE_SIZE} of ${answered} questions`)).toBeTruthy();
    for (const row of Array.from(document.querySelectorAll(".question-row"))) {
      expect(row.textContent).toContain("Answered");
    }
  }, LONG_LIST_TIMEOUT_MS);

  it("shows no paging controls for a short list", async () => {
    await repos.questions.create({ text: "Only question" });
    await open();
    expect(rows()).toBe(1);
    expect(screen.queryByText(/^Showing /)).toBeNull();
    expect(screen.queryByRole("button", { name: /more questions/ })).toBeNull();
  });

  it("keeps each row's links right, including after a linked record is deleted", async () => {
    const material = await repos.documents.create({ title: "Synthetic AIM chapter", materialType: "reference" });
    const lesson = await repos.schedule.create({ eventType: "flight_lesson", date: "2099-01-01", title: "Synthetic lesson", status: "scheduled" });
    await repos.questions.create({ text: "Linked question", materialId: material.id, eventId: lesson.id });
    await repos.questions.create({ text: "Unlinked question" });
    await open();

    expect(screen.getByRole("link", { name: "Synthetic AIM chapter" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Synthetic lesson" }).length).toBeGreaterThan(0);

    await repos.documents.remove(material.id);
    await act(async () => {
      await context.refresh();
    });
    expect(screen.queryByRole("link", { name: "Synthetic AIM chapter" })).toBeNull();
    expect(screen.getAllByText("Source material unavailable")).toHaveLength(1);
  });
});
