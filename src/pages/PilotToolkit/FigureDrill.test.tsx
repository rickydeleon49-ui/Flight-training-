// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, configure, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider } from "@/state/AppDataContext";
import * as geminiService from "@/services/gemini";
import { FigureDrill } from "./FigureDrill";

// The drill draws up to 10 questions from the pool; pin a 3-question pool (all answer index 0) so the counts stay exact.
vi.mock("@/logic/figureQuestions", async (orig) => {
  const real = await orig<typeof import("@/logic/figureQuestions")>();
  return { ...real, FIGURE_QUESTIONS: real.FIGURE_QUESTIONS.filter((q) => q.correctIndex === 0).slice(0, 3) };
});

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
configure({ asyncUtilTimeout: 20_000 });
const SLOW = { timeout: 20_000 };

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([]);
  vi.spyOn(geminiService, "watchGeminiJobs").mockResolvedValue(() => {});
});
afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });

const cardsOf = async () => {
  const rows = await db.select<{ flashcards_json: string }>("SELECT flashcards_json FROM ai_study_sets");
  return rows.flatMap((r) => JSON.parse(r.flashcards_json) as { front: string; back: string }[]);
};

describe("FigureDrill", { timeout: 60_000 }, () => {
  it("starts into a question with its figure", async () => {
    render(h(AppDataProvider, null, h(FigureDrill)));
    expect(await screen.findByText("FAA figure drill", {}, SLOW)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByRole("img")).toBeTruthy();
    expect(screen.getByText(/Question 1 of 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });

  it("adds misses to review cards once and reports repeats as already there", async () => {
    render(h(AppDataProvider, null, h(FigureDrill)));
    const run = async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Start" }, SLOW));
      for (let i = 0; i < 3; i++) {
        fireEvent.click(screen.getByRole("button", { name: /^2\. / }));
        fireEvent.click(screen.getByRole("button", { name: i === 2 ? "See score" : "Continue" }));
      }
      fireEvent.click(await screen.findByRole("button", { name: "Add 3 missed to your review cards" }));
    };
    await run();
    expect(await screen.findByText("Added to your review cards", {}, SLOW)).toBeTruthy();
    expect(await cardsOf()).toHaveLength(3);
    expect((await cardsOf())[0]!.front).toMatch(/^Figure \d+ \(FAA-CT-8080-2H\): /);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await run();
    expect(await screen.findByText("Already in your review cards", {}, SLOW)).toBeTruthy();
    expect(await cardsOf()).toHaveLength(3);
  });
});
