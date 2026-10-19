// @vitest-environment jsdom
/**
 * A link from offline search (OFFLINE-02c) opens one question or note:
 * shown even when the page's filter or paging would hide it, highlighted,
 * and an id that no longer exists says so.
 */
import { createElement as h } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { Notes } from "@/pages/Notes/Notes";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

import { QUESTION_PAGE_SIZE, Questions } from "./Questions";

/**
 * Seeding 146 questions and rendering past the first page takes well under a
 * second alone, but much longer when the whole suite runs files in parallel
 * on a slow runner. Longer waits for these tests only; no assertion relaxed.
 */
const SLOW_RUNNER = { timeout: 10_000 };

let db: TestDatabase;
let repos: Repositories;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

function Ready({ page }: { page: "questions" | "notes" }) {
  return useAppData().status === "ready" ? h(page === "questions" ? Questions : Notes) : null;
}
function open(page: "questions" | "notes", url: string) {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: [url] }, h(Ready, { page }))));
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  db = await createNodeSqliteDatabase();
  repos = createRepositories(db);
  await repos.app.set("airline_starter_pack", "skipped-for-tests");
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  db.close();
});

describe("opening a question from offline search", () => {
  it("shows it past the first page and outside the remembered filter, highlighted", { timeout: 20_000 }, async () => {
    // The oldest question is listed last, beyond the first page.
    const target = await repos.questions.create({ text: "The linked crosswind question", status: "answered", answer: "Yes" });
    for (let i = 0; i < QUESTION_PAGE_SIZE + 5; i++) {
      await repos.questions.create({ text: `Synthetic question ${i}`, status: "to_ask", answer: "" });
    }
    // Her remembered filter would hide it (answered, filter "to ask").
    sessionStorage.setItem("her-flight-deck.view.questions.filter", JSON.stringify("to_ask"));
    open("questions", `/questions?question=${target.id}`);
    const text = await screen.findByText("The linked crosswind question", {}, SLOW_RUNNER);
    const row = document.getElementById(`question-${target.id}`);
    expect(row?.contains(text)).toBe(true);
    expect(row?.classList.contains("search-target")).toBe(true);
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled(), SLOW_RUNNER);
  });

  it("says so when the question is gone", { timeout: 20_000 }, async () => {
    open("questions", "/questions?question=missing-id");
    expect(await screen.findByText("That item isn't here any more.", {}, SLOW_RUNNER)).toBeTruthy();
  });
});

describe("opening a note from offline search", () => {
  it("clears a note search that would hide it, and highlights it", { timeout: 20_000 }, async () => {
    const target = await repos.notes.create({ title: "Checkride", body: "Bring the crosswind chart" });
    await repos.notes.create({ title: "Other", body: "Something else entirely" });
    // Her remembered note search would hide it.
    sessionStorage.setItem("her-flight-deck.view.notes.search", JSON.stringify("something else"));
    open("notes", `/notes?note=${target.id}`);
    await waitFor(() => expect(document.getElementById(`note-${target.id}`)).toBeTruthy(), SLOW_RUNNER);
    expect(document.getElementById(`note-${target.id}`)?.classList.contains("search-target")).toBe(true);
  });

  it("says so when the note is gone", { timeout: 20_000 }, async () => {
    open("notes", "/notes?note=missing-id");
    expect(await screen.findByText("That item isn't here any more.", {}, SLOW_RUNNER)).toBeTruthy();
  });
});
