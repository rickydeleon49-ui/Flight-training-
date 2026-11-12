// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import type { CardLibraryRepository } from "@/data/repositories/cardLibraryRepository";
import type { LibraryReviewDueResult, LibraryReviewMaterialEntry } from "@/domain/types";

import { TodayReviewCard, dueCardCount, fromLine, reviewTitle } from "./TodayReviewCard";

afterEach(cleanup);

const row = (id: string, title: string, totalDueCount: number): LibraryReviewMaterialEntry => ({
  materialId: id,
  title,
  topic: "weather",
  priority: "normal",
  updatedAt: "2026-11-01T00:00:00Z",
  cardCount: 20,
  againCount: 0,
  dayCount: totalDueCount,
  newCount: 0,
  totalDueCount,
  retainedCardCount: 10,
  earliestDueAt: null,
});

function repoWith(materials: LibraryReviewMaterialEntry[]): CardLibraryRepository {
  const result = {
    materials,
    nextCursor: null,
    issues: [],
    summary: {},
  } as unknown as LibraryReviewDueResult;
  return { readReviewDue: async () => result } as unknown as CardLibraryRepository;
}

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function show(repo: CardLibraryRepository | undefined, tests = 0) {
  return render(
    <MemoryRouter>
      <TodayReviewCard repository={repo} dataRevision={1} testsThisWeek={tests} />
      <Where />
    </MemoryRouter>,
  );
}

describe("helpers", () => {
  it("builds the title and From line", () => {
    expect(reviewTitle(18, 1)).toBe("18 cards due · 1 practice test done this week");
    expect(reviewTitle(1, 0)).toBe("1 card due");
    expect(reviewTitle(2, 3)).toBe("2 cards due · 3 practice tests done this week");
    expect(fromLine([{ title: "A" }, { title: "B" }, { title: "C" }, { title: "D" }])).toBe("From A, B and 2 more");
    expect(fromLine([{ title: "A" }, { title: "B" }])).toBe("From A and B");
    expect(dueCardCount([{ againCount: 1, dayCount: 2, newCount: 2 }, { againCount: 0, dayCount: 13, newCount: 0 }])).toBe(18);
  });
});

describe("TodayReviewCard", () => {
  it("shows counts, a time guess and exactly one filled button", async () => {
    const { container } = show(repoWith([row("m1", "Weather services", 12), row("m2", "Airspace", 6), row("m3", "Pitot", 0)]), 1);
    expect(await screen.findByText("18 cards due · 1 practice test done this week")).toBeTruthy();
    expect(screen.getByText(/From Weather services and Airspace/)).toBeTruthy();
    expect(screen.getByText(/about 3 min/)).toBeTruthy();
    expect(container.querySelectorAll(".button--primary")).toHaveLength(1);
  });

  it("starts the most urgent material's review", async () => {
    show(repoWith([row("m1", "Weather services", 12)]));
    fireEvent.click(await screen.findByRole("button", { name: "Start today’s review" }));
    expect(screen.getByTestId("where").textContent).toBe("/study/m1");
  });

  it("opens the Review due tab to choose", async () => {
    show(repoWith([row("m1", "Weather services", 12)]));
    fireEvent.click(await screen.findByRole("button", { name: "Choose what to study" }));
    expect(screen.getByTestId("where").textContent).toBe("/study?tab=due");
  });

  it("says nothing is due, with no filled button", async () => {
    const { container } = show(repoWith([]));
    expect(await screen.findByText("Nothing due. Nice work.")).toBeTruthy();
    expect(container.querySelectorAll(".button--primary")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Open Study Library" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/study"));
  });

  it("counts new cards as due, like the Review due tab", async () => {
    const newOnly = { ...row("m1", "Weather services", 0), newCount: 7 };
    show(repoWith([newOnly]));
    expect(await screen.findByText("7 cards due")).toBeTruthy();
    expect(screen.queryByText("Nothing due. Nice work.")).toBeNull();
  });

  it("does not say nothing is due before every page is read", async () => {
    const never = new Promise<LibraryReviewDueResult>(() => {});
    let calls = 0;
    const repo = {
      readReviewDue: async () => {
        calls += 1;
        if (calls === 1) {
          return { materials: [], nextCursor: "c1", issues: [], summary: {} } as unknown as LibraryReviewDueResult;
        }
        return never;
      },
    } as unknown as CardLibraryRepository;
    show(repo);
    await waitFor(() => expect(calls).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Nothing due. Nice work.")).toBeNull();
  });

  it("renders nothing without a card library", () => {
    const { container } = show(undefined);
    expect(container.querySelector(".today-review")).toBeNull();
  });
});
