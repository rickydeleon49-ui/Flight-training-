// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { validateHomeworkSnapshot, type HomeworkOperation, type HomeworkSnapshot } from "@/domain/homework";
import type { CardReviewRepository } from "@/data/repositories/cardReviewRepository";
import type { AiStudySet, CardReviewSnapshot } from "@/domain/types";
import { cardVersion, type CardVersion } from "@/logic/cardIdentity";
import { makeMaterial } from "@/testing/factories";
import { EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import { HomeworkView } from "./HomeworkView";

const F = JSON.parse(
  readFileSync("src-tauri/fixtures/homework-validation/cases.json", "utf8"),
) as { operations: Record<string, HomeworkOperation> };

let appData: AppData;
let currentSnapshot: HomeworkSnapshot;
let cachedVersion: CardVersion;
let deferSaveAction: Promise<void> | null = null;
let deferGet: Promise<void> | null = null;

const saveActionMock = vi.fn(async () => {
  if (deferSaveAction) await deferSaveAction;
  return {};
});

const homeworkRepo = {
  get: vi.fn(async (id: string) => {
    if (deferGet) await deferGet;
    if (id === currentSnapshot?.assignment.id) {
      return structuredClone(currentSnapshot);
    }
    return null;
  }),
  history: vi.fn(async () => []),
  save: vi.fn(async () => ({ ok: true })),
  list: vi.fn(async () => (currentSnapshot ? [currentSnapshot.assignment] : [])),
};

const cardReviewsRepo = {
  getCardReviewSnapshot: vi.fn(async (materialId: string): Promise<CardReviewSnapshot> => ({
    materialId,
    generation: 0,
    current: { status: "ok", ...cachedVersion },
    states: {},
  })),
  getDueQueue: vi.fn(async () =>
    cachedVersion.items.map((i) => ({ itemId: i.itemId, ordinal: i.ordinal, kind: "new" as const, dueAt: null })),
  ),
  saveAction: saveActionMock,
};

const repositories = {
  homework: homeworkRepo,
  cardReviews: cardReviewsRepo as unknown as CardReviewRepository,
  navigation: {
    inspect: vi.fn(async () => ({ contentSha256: "a".repeat(64), totalPages: 5 })),
    canCheckFiles: () => false,
  },
  practiceSessions: {
    getActiveVersion: vi.fn(async () => null),
    getVersion: vi.fn(async () => null),
  },
};

const refreshMock = vi.fn(async () => {});

vi.mock("@/state/AppDataContext", async (importOriginal) => ({
  ...await importOriginal<object>(),
  useAppData: () => ({
    data: appData,
    dataRevision: 1,
    repositories,
    refresh: refreshMock,
  }),
}));

vi.mock("@/state/navigation/useDocumentNavigation", () => ({
  useNavigationController: () => ({
    controller: null,
    repo: null,
    status: { kind: "idle" },
  }),
}));

let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

beforeEach(async () => {
  originalScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

describe("HomeworkCardReviewFlow integration with HomeworkView", () => {
  const materialId = "00000000-0000-4000-8000-000000000005";
  const flashcards = [
    { front: "One", back: "First", sourcePage: null },
    { front: "Two", back: "Second", sourcePage: null },
  ];

  beforeEach(async () => {
    deferSaveAction = null;
    deferGet = null;
    saveActionMock.mockClear();
    homeworkRepo.get.mockClear();
    homeworkRepo.save.mockClear();
    homeworkRepo.history.mockClear();
    homeworkRepo.list.mockClear();
    cardReviewsRepo.getCardReviewSnapshot.mockClear();
    cardReviewsRepo.getDueQueue.mockClear();
    refreshMock.mockClear();

    cachedVersion = await cardVersion(materialId, flashcards);

    const studySet: AiStudySet = {
      sourceMaterialId: materialId,
      title: "Synthetic study set",
      summary: "Synthetic summary",
      sections: [],
      flashcards,
      sourceNotes: "",
      provider: "import",
      model: "",
      generatedAt: "2026-10-21T10:01:00.000Z",
      updatedAt: "2026-10-21T10:01:00.000Z",
    };

    appData = {
      ...EMPTY_DATA,
      materials: [
        makeMaterial({
          id: materialId,
          title: "Synthetic source",
          createdAt: "2026-10-21T10:00:00.000Z",
          updatedAt: "2026-10-21T10:00:00.000Z",
        }),
      ],
      aiStudySets: [studySet],
    };
  });

  it("restores focus to child heading across real parent reload, source recheck, unmount, and remount (confirmed two-card keyboard continuity)", async () => {
    currentSnapshot = validateHomeworkSnapshot(structuredClone(F.operations["card_start"]!.next));
    const assignmentId = currentSnapshot.assignment.id;
    const activityId = currentSnapshot.activities[0]!.record.id;
    const headingId = `homework-cards-heading-${activityId}`;

    render(
      h(MemoryRouter, { initialEntries: [`/study/homework/${assignmentId}?activity=${activityId}`] },
        h(Routes, null,
          h(Route, { path: "/study/homework/:assignmentId?", element: h(HomeworkView) })
        )
      )
    );

    // Initial mount and card load: Card One front displayed
    await screen.findByText("One");
    const sessionRegion = screen.getByLabelText(/Card review session/i);

    // Prove initial query focus targeted the URL-specified activity heading
    await waitFor(() => {
      expect(document.activeElement?.id).toBe(`homework-${activityId}`);
    });

    // Space reveals card One
    fireEvent.keyDown(sessionRegion, { key: " " });
    await screen.findByText("First");

    // Rate card One via key 3 (Good); transition snapshot to canonical card_partial
    currentSnapshot = validateHomeworkSnapshot(structuredClone(F.operations["card_partial"]!.next));
    fireEvent.keyDown(sessionRegion, { key: "3" });
    await waitFor(() => expect(saveActionMock).toHaveBeenCalledTimes(1));

    // Remounted child displays Card Two front
    await screen.findByText("Two");

    // Confirmed rating count derived honestly from refreshed run evidence
    const status = await screen.findByText(/1 card rating saved/);
    expect(status.getAttribute("role")).toBe("status");

    // Focus restored to child heading for Card Two
    await waitFor(() => {
      expect(document.activeElement?.id).toBe(headingId);
    });

    // Continue keyboard review on Card Two: Space reveals answer
    const sessionRegionTwo = screen.getByLabelText(/Card review session/i);
    fireEvent.keyDown(sessionRegionTwo, { key: " " });
    await screen.findByText("Second");

    // Rate card Two via key 4 (Easy); transition snapshot to canonical card_finished
    currentSnapshot = validateHomeworkSnapshot(structuredClone(F.operations["card_finished"]!.next));
    fireEvent.keyDown(sessionRegionTwo, { key: "4" });
    await waitFor(() => expect(saveActionMock).toHaveBeenCalledTimes(2));

    // Finished path: displays complete banner and restores focus to existing activity heading
    await screen.findByText(/Review complete · 2 linked cards rated/);
    await waitFor(() => {
      expect(document.activeElement?.id).toBe(`homework-${activityId}`);
    });
  });

  it("supports two-card keyboard continuity on route without activity query parameter", async () => {
    currentSnapshot = validateHomeworkSnapshot(structuredClone(F.operations["card_start"]!.next));
    const assignmentId = currentSnapshot.assignment.id;
    const activityId = currentSnapshot.activities[0]!.record.id;
    const headingId = `homework-cards-heading-${activityId}`;

    render(
      h(MemoryRouter, { initialEntries: [`/study/homework/${assignmentId}`] },
        h(Routes, null,
          h(Route, { path: "/study/homework/:assignmentId?", element: h(HomeworkView) })
        )
      )
    );

    await screen.findByText("One");
    const sessionRegion = screen.getByLabelText(/Card review session/i);

    fireEvent.keyDown(sessionRegion, { key: " " });
    await screen.findByText("First");

    currentSnapshot = validateHomeworkSnapshot(structuredClone(F.operations["card_partial"]!.next));
    fireEvent.keyDown(sessionRegion, { key: "3" });
    await waitFor(() => expect(saveActionMock).toHaveBeenCalledTimes(1));

    await screen.findByText("Two");
    const status = await screen.findByText(/1 card rating saved/);
    expect(status.getAttribute("role")).toBe("status");

    await waitFor(() => {
      expect(document.activeElement?.id).toBe(headingId);
    });

    const sessionRegionTwo = screen.getByLabelText(/Card review session/i);
    fireEvent.keyDown(sessionRegionTwo, { key: " " });
    await screen.findByText("Second");

    currentSnapshot = validateHomeworkSnapshot(structuredClone(F.operations["card_finished"]!.next));
    fireEvent.keyDown(sessionRegionTwo, { key: "4" });
    await waitFor(() => expect(saveActionMock).toHaveBeenCalledTimes(2));

    await screen.findByText(/Review complete · 2 linked cards rated/);
    await waitFor(() => {
      expect(document.activeElement?.id).toBe(`homework-${activityId}`);
    });
  });

  it("does not steal focus when user moves focus to Edit homework internal control before save ack", async () => {
    currentSnapshot = validateHomeworkSnapshot(structuredClone(F.operations["card_start"]!.next));
    const assignmentId = currentSnapshot.assignment.id;
    const activityId = currentSnapshot.activities[0]!.record.id;
    const headingId = `homework-cards-heading-${activityId}`;

    let resolveSaveAction!: () => void;
    deferSaveAction = new Promise<void>((resolve) => {
      resolveSaveAction = resolve;
    });

    render(
      h(MemoryRouter, { initialEntries: [`/study/homework/${assignmentId}?activity=${activityId}`] },
        h(Routes, null,
          h(Route, { path: "/study/homework/:assignmentId?", element: h(HomeworkView) })
        )
      )
    );

    await screen.findByText("One");
    const sessionRegion = screen.getByLabelText(/Card review session/i);

    fireEvent.keyDown(sessionRegion, { key: " " });
    await screen.findByText("First");

    // Rate card One (saveAction is deferred)
    fireEvent.keyDown(sessionRegion, { key: "3" });
    await waitFor(() => expect(saveActionMock).toHaveBeenCalledTimes(1));

    // User moves focus to internal 'Edit homework' button before save ack
    const editBtn = screen.getByRole("button", { name: "Edit homework" });
    editBtn.focus();
    expect(document.activeElement).toBe(editBtn);

    // Defer homework.get for the upcoming reload separately before resolving save
    let resolveGet!: () => void;
    deferGet = new Promise<void>((resolve) => {
      resolveGet = resolve;
    });

    // Transition snapshot to canonical card_partial and resolve save ack
    currentSnapshot = validateHomeworkSnapshot(structuredClone(F.operations["card_partial"]!.next));
    deferSaveAction = null;
    resolveSaveAction();

    // Await actual 'Loading homework…' and prove old Edit button is disconnected from DOM
    await screen.findByText("Loading homework…");
    expect(editBtn.isConnected).toBe(false);

    // Now resolve get/source check
    deferGet = null;
    resolveGet();

    // Remounted child displays Card Two
    await screen.findByText("Two");

    // Focus must NOT be stolen to the child heading or outer activity heading
    expect(document.activeElement?.id).not.toBe(headingId);
    expect(document.activeElement?.id).not.toBe(`homework-${activityId}`);
  });

  it("does not steal focus when user moves focus outside during separately deferred get/reload", async () => {
    currentSnapshot = validateHomeworkSnapshot(structuredClone(F.operations["card_start"]!.next));
    const assignmentId = currentSnapshot.assignment.id;
    const activityId = currentSnapshot.activities[0]!.record.id;
    const headingId = `homework-cards-heading-${activityId}`;

    let resolveGet!: () => void;

    render(
      h(MemoryRouter, { initialEntries: [`/study/homework/${assignmentId}?activity=${activityId}`] },
        h(Routes, null,
          h(Route, { path: "/study/homework/:assignmentId?", element: h(HomeworkView) })
        )
      )
    );

    await screen.findByText("One");
    const sessionRegion = screen.getByLabelText(/Card review session/i);

    fireEvent.keyDown(sessionRegion, { key: " " });
    await screen.findByText("First");

    // Set deferred get for the subsequent reload call (not the initial load)
    deferGet = new Promise<void>((resolve) => {
      resolveGet = resolve;
    });

    currentSnapshot = validateHomeworkSnapshot(structuredClone(F.operations["card_partial"]!.next));
    fireEvent.keyDown(sessionRegion, { key: "3" });

    // Save ack completes, but get is deferred, showing loading indicator
    await screen.findByText("Loading homework…");

    // While deferred reload is loading, user moves focus outside to 'Add homework' button
    const addHwBtn = screen.getByRole("button", { name: "Add homework" });
    addHwBtn.focus();
    expect(document.activeElement).toBe(addHwBtn);

    // Now resolve deferred get
    deferGet = null;
    resolveGet();

    // Reload finishes, displaying Card Two
    await screen.findByText("Two");

    // Focus must remain on Add homework and NOT be stolen by the card heading or outer activity heading
    expect(document.activeElement).toBe(addHwBtn);
    expect(document.activeElement?.id).not.toBe(headingId);
    expect(document.activeElement?.id).not.toBe(`homework-${activityId}`);
  });

  it("does not create stale focus intent or error when route/assignment changes before save ack", async () => {
    currentSnapshot = validateHomeworkSnapshot(structuredClone(F.operations["card_start"]!.next));
    const assignmentId = currentSnapshot.assignment.id;
    const activityId = currentSnapshot.activities[0]!.record.id;

    let resolveSaveAction!: () => void;
    deferSaveAction = new Promise<void>((resolve) => {
      resolveSaveAction = resolve;
    });

    render(
      h(MemoryRouter, { initialEntries: [`/study/homework/${assignmentId}?activity=${activityId}`] },
        h(Routes, null,
          h(Route, { path: "/study/homework/:assignmentId?", element: h(HomeworkView) })
        )
      )
    );

    await screen.findByText("One");
    const sessionRegion = screen.getByLabelText(/Card review session/i);

    fireEvent.keyDown(sessionRegion, { key: " " });
    await screen.findByText("First");

    fireEvent.keyDown(sessionRegion, { key: "3" });
    await waitFor(() => expect(saveActionMock).toHaveBeenCalledTimes(1));

    // User navigates away to all homework before save ack
    const allHwLink = screen.getByRole("link", { name: "All homework" });
    fireEvent.click(allHwLink);

    await screen.findByText("A little preparation, at your pace.");

    // Now resolve the deferred saveAction on the unmounted card run
    deferSaveAction = null;
    resolveSaveAction();

    // Verify view remains on All homework without stale errors or focus stealing
    expect(screen.getByText("A little preparation, at your pace.")).toBeTruthy();
    expect(document.activeElement?.id).not.toContain("homework-cards-heading");
    expect(document.activeElement?.id).not.toBe(`homework-${activityId}`);
  });

  it("proves initial query focus works on deep-link and same-selection snapshot refresh does not steal focus", async () => {
    currentSnapshot = validateHomeworkSnapshot(structuredClone(F.operations["card_start"]!.next));
    const assignmentId = currentSnapshot.assignment.id;
    const activityId = currentSnapshot.activities[0]!.record.id;
    const headingId = `homework-cards-heading-${activityId}`;

    render(
      h(MemoryRouter, { initialEntries: [`/study/homework/${assignmentId}?activity=${activityId}`] },
        h(Routes, null,
          h(Route, { path: "/study/homework/:assignmentId?", element: h(HomeworkView) })
        )
      )
    );

    // Initial mount with ?activity=<activityId> focuses the outer activity heading
    await waitFor(() => {
      expect(document.activeElement?.id).toBe(`homework-${activityId}`);
    });

    // Await item loaded state before firing key event
    await screen.findByText("One");

    // Space reveals card One
    const sessionRegion = screen.getByLabelText(/Card review session/i);
    fireEvent.keyDown(sessionRegion, { key: " " });
    await screen.findByText("First");

    // Rate card One and refresh snapshot
    currentSnapshot = validateHomeworkSnapshot(structuredClone(F.operations["card_partial"]!.next));
    fireEvent.keyDown(sessionRegion, { key: "3" });
    await waitFor(() => expect(saveActionMock).toHaveBeenCalledTimes(1));

    // Remount displays Card Two
    await screen.findByText("Two");

    // Verify Card Two child heading received focus and outer activity H3 was NOT re-focused by the snapshot refresh
    await waitFor(() => {
      expect(document.activeElement?.id).toBe(headingId);
    });
    expect(document.activeElement?.id).not.toBe(`homework-${activityId}`);
  });
});
