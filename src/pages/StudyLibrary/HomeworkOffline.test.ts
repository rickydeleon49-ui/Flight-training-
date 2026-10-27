// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type HomeworkSnapshot, type HomeworkOperation } from "@/domain/homework";
import { makeMaterial } from "@/testing/factories";
import { EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import { newHomework, newHomeworkActivity } from "./homeworkUi";
import { cardVersion } from "@/logic/cardIdentity";
import { HomeworkView } from "./HomeworkView";

let appData: AppData;
let records: HomeworkSnapshot[];
let dataRevision = 1;
let canCheckFilesFlag = true;
let inspectDeferred: { promise: Promise<{ contentSha256: string; totalPages: number }>; resolve: (val: { contentSha256: string; totalPages: number }) => void };

function createDeferred() {
  let resolve!: (val: { contentSha256: string; totalPages: number }) => void;
  const promise = new Promise<{ contentSha256: string; totalPages: number }>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

vi.mock("@/logic/cardIdentity", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cardVersion: vi.fn((...args: Parameters<typeof cardVersion>) =>
    importOriginal<typeof import("@/logic/cardIdentity")>().then(m => m.cardVersion(...args))),
}));

const sourceId = "10000000-0000-4000-8000-000000000001";
const quizId = "10000000-0000-4000-8000-000000000002";

const inspect = vi.fn(async () => inspectDeferred.promise);
const openSaved = vi.fn(async () => null);

const repository = {
  save: vi.fn(async (op: HomeworkOperation) => ({ version: 1, assignmentId: op.assignmentId, revision: op.next.assignment.revision })),
  list: async () => records.map((s) => s.assignment),
  get: vi.fn(async (id: string) => structuredClone(records.find((s) => s.assignment.id === id) ?? null)),
  history: vi.fn(async () => []),
};

const repositories = {
  homework: repository,
  navigation: {
    inspect,
    canCheckFiles: () => canCheckFilesFlag,
  },
  practiceSessions: {
    getActiveVersion: vi.fn(async () => ({ version: { id: quizId, contentHash: "b".repeat(64) } })),
    getVersion: vi.fn(async () => ({ id: quizId, contentHash: "b".repeat(64) })),
  },
};

vi.mock("@/state/AppDataContext", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAppData: () => ({ data: appData, dataRevision, repositories, refresh: vi.fn() }),
}));

vi.mock("@/state/navigation/useDocumentNavigation", () => ({
  useNavigationController: () => ({
    controller: { openSaved, status: () => ({ kind: "idle", epoch: 0 }), abort: vi.fn() },
    repo: null,
    status: { kind: "idle" },
  }),
}));

function SwitchAssignment() {
  const navigate = useNavigate();
  return h("button", { onClick: () => navigate("/study/homework/missing-assignment") }, "Switch assignment");
}

function view(id?: string) {
  return (
    h(
      MemoryRouter,
      { initialEntries: [id ? `/study/homework/${id}` : "/study/homework"] },
      h(SwitchAssignment),
      h(Routes, null, h(Route, { path: "/study/homework/:assignmentId?", element: h(HomeworkView) })),
    )
  );
}

function renderView(id?: string) {
  return render(view(id));
}

function readingAssignment() {
  const s = newHomework();
  const e = newHomeworkActivity(s.assignment.id, 0, "read", s.assignment.created_at);
  e.record.title = "Aerodynamics reading";
  Object.assign(e.record, { material_id: sourceId, source_material_id: sourceId, source_revision: "a".repeat(64), page_start: 1, page_end: 5 });
  e.source = { title: "Test Handbook", total_pages: 10 };
  s.activities = [e];
  records.push(s);
  return s;
}

describe("Homework offline summary UI (PACKS-01b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dataRevision = 1;
    canCheckFilesFlag = true;
    inspectDeferred = createDeferred();
    appData = {
      ...EMPTY_DATA,
      materials: [makeMaterial({ id: sourceId, title: "Test Handbook" })],
    };
    records = [];
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function returnToHomework() {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    fireEvent(window, new Event("focus"));
  }

  it("resume_rechecks_changed_pdf_without_data_revision", async () => {
    const s = readingAssignment();
    const original = structuredClone(s);
    renderView(s.assignment.id);
    inspectDeferred.resolve({ contentSha256: "a".repeat(64), totalPages: 10 });
    await screen.findByText("Everything here works without internet.");
    const reads = repository.get.mock.calls.length;
    const histories = repository.history.mock.calls.length;
    inspectDeferred = createDeferred();
    vi.useFakeTimers();
    returnToHomework();
    // The paired browser events schedule exactly one refresh.
    expect(vi.getTimerCount()).toBe(1);
    expect(screen.getByText("Checking what works without internet…")).toBeTruthy();
    expect(screen.queryByText("Works offline")).toBeNull();
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    vi.useRealTimers();
    await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(2));
    await act(async () => inspectDeferred.resolve({ contentSha256: "c".repeat(64), totalPages: 10 }));
    await screen.findByText("1 of 1 needs a fix before you study offline.");
    expect(screen.getByText("Needs a fix")).toBeTruthy();
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(repository.get).toHaveBeenCalledTimes(reads);
    expect(repository.history).toHaveBeenCalledTimes(histories);
    expect(repository.save).not.toHaveBeenCalled();
    expect(openSaved).not.toHaveBeenCalled();
    expect(records).toEqual([original]);
    expect(dataRevision).toBe(1);
  });

  it("resume older-run-finishes-late cannot overwrite the new result", async () => {
    const s = readingAssignment();
    renderView(s.assignment.id);
    await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(1));
    const old = inspectDeferred;
    inspectDeferred = createDeferred();
    vi.useFakeTimers();
    returnToHomework();
    // Even a completion before the coalesced refresh must stay obsolete.
    await act(async () => old.resolve({ contentSha256: "c".repeat(64), totalPages: 10 }));
    expect(screen.getByText("Checking what works without internet…")).toBeTruthy();
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    vi.useRealTimers();
    await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(2));
    await act(async () => inspectDeferred.resolve({ contentSha256: "a".repeat(64), totalPages: 10 }));
    await screen.findByText("Everything here works without internet.");
    expect(screen.queryByText("Needs a fix")).toBeNull();
  });

  it.each(["focus", "visibilitychange"])("resume rechecks on %s alone", async (event) => {
    const s = readingAssignment();
    renderView(s.assignment.id);
    inspectDeferred.resolve({ contentSha256: "a".repeat(64), totalPages: 10 });
    await screen.findByText("Everything here works without internet.");
    inspectDeferred = createDeferred();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    fireEvent(event === "focus" ? window : document, new Event(event));
    expect(screen.getByText("Checking what works without internet…")).toBeTruthy();
    await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(2));
    await act(async () => inspectDeferred.resolve({ contentSha256: "a".repeat(64), totalPages: 10 }));
    await screen.findByText("Everything here works without internet.");
  });

  it("resume older-run-finishes-late after the new check stays ignored", async () => {
    const s = readingAssignment();
    renderView(s.assignment.id);
    await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(1));
    const old = inspectDeferred;
    inspectDeferred = createDeferred();
    returnToHomework();
    await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(2));
    await act(async () => inspectDeferred.resolve({ contentSha256: "a".repeat(64), totalPages: 10 }));
    await screen.findByText("Everything here works without internet.");
    await act(async () => old.resolve({ contentSha256: "c".repeat(64), totalPages: 10 }));
    expect(screen.getByText("Everything here works without internet.")).toBeTruthy();
    expect(screen.queryByText("Needs a fix")).toBeNull();
  });

  it("resume unmount cleanup removes listeners and cancels a queued recheck", async () => {
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const removeDocument = vi.spyOn(document, "removeEventListener");
    const addWindow = vi.spyOn(window, "addEventListener");
    const addDocument = vi.spyOn(document, "addEventListener");
    const clearTimer = vi.spyOn(window, "clearTimeout");
    const setTimer = vi.spyOn(window, "setTimeout");
    const s = readingAssignment();
    const rendered = renderView(s.assignment.id);
    await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(1));
    const focusListeners = addWindow.mock.calls.filter(([type]) => type === "focus").map(([, listener]) => listener);
    const visibleListeners = addDocument.mock.calls.filter(([type]) => type === "visibilitychange").map(([, listener]) => listener);
    returnToHomework();
    const queuedTimer = setTimer.mock.results.at(-1)!.value;
    rendered.unmount();
    for (const listener of focusListeners) expect(removeWindow).toHaveBeenCalledWith("focus", listener);
    for (const listener of visibleListeners) expect(removeDocument).toHaveBeenCalledWith("visibilitychange", listener);
    expect(clearTimer).toHaveBeenCalledWith(queuedTimer);
    returnToHomework();
    await act(async () => inspectDeferred.resolve({ contentSha256: "a".repeat(64), totalPages: 10 }));
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("shared_sources_are_checked_once_per_run", async () => {
    const s = readingAssignment();
    const cards = [{ front: "Q1", back: "A1", sourcePage: null }];
    const hash = (await cardVersion(sourceId, cards)).contentHash;
    vi.mocked(cardVersion).mockClear();
    appData.aiStudySets = [{ sourceMaterialId: sourceId, flashcards: cards } as AppData["aiStudySets"][number]];
    const secondReading = structuredClone(s.activities[0]!);
    secondReading.record.id = "second-reading";
    secondReading.record.title = "Other reading";
    secondReading.record.source_revision = "c".repeat(64);
    s.activities.push(secondReading);
    for (const kind of ["cards", "test"] as const) {
      for (let i = 0; i < 2; i++) {
        const e = newHomeworkActivity(s.assignment.id, s.activities.length, kind, s.assignment.created_at);
        e.record.title = `${kind} ${i}`;
        Object.assign(e.record, { material_id: sourceId, source_material_id: sourceId,
          source_revision: i === 0 ? (kind === "cards" ? hash : "b".repeat(64)) : "different",
          card_set_id: "saved-cards", test_version_id: quizId });
        e.source = { title: "Test Handbook", total_pages: 10 };
        s.activities.push(e);
      }
    }
    renderView(s.assignment.id);
    inspectDeferred.resolve({ contentSha256: "a".repeat(64), totalPages: 10 });
    await screen.findByText("3 of 6 need a fix before you study offline.");
    const counts = (n: number) => {
      expect(inspect).toHaveBeenCalledTimes(n);
      expect(cardVersion).toHaveBeenCalledTimes(n);
      expect(repositories.practiceSessions.getVersion).toHaveBeenCalledTimes(n);
      expect(repositories.practiceSessions.getActiveVersion).toHaveBeenCalledTimes(n);
    };
    counts(1);
    expect(screen.getAllByText("Works offline")).toHaveLength(3);
    expect(screen.getAllByText("Needs a fix")).toHaveLength(3);
    inspectDeferred = createDeferred();
    returnToHomework();
    expect(screen.getByText("Checking what works without internet…")).toBeTruthy();
    await vi.waitFor(() => counts(2));
    await act(async () => inspectDeferred.resolve({ contentSha256: "c".repeat(64), totalPages: 10 }));
    await screen.findByText("3 of 6 need a fix before you study offline.");
    counts(2);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it.each([[1, 11], [0, 5], [5, 4], [1.5, 5]])("matching_hash_out_of_range_reading_never_ready (%s–%s)", async (start, end) => {
    const s = readingAssignment();
    const invalid = structuredClone(s.activities[0]!);
    invalid.record.id = "invalid-reading";
    invalid.record.title = "Range to repair";
    invalid.record.page_start = start;
    invalid.record.page_end = end;
    s.activities.push(invalid);
    renderView(s.assignment.id);
    inspectDeferred.resolve({ contentSha256: "a".repeat(64), totalPages: 10 });
    await screen.findByText("1 of 2 needs a fix before you study offline.");
    expect(screen.getAllByText("Needs a fix")).toHaveLength(1);
    expect(await screen.findAllByText("Works offline")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Choose a source for Range to repair" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Choose a source for Aerodynamics reading" })).toBeNull();
    expect(screen.queryByText("Everything here works without internet.")).toBeNull();
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it("an all-healthy assignment shows 'Everything here works without internet.' only after checks finish", async () => {
    const s = newHomework();
    s.assignment.title = "Pre-flight preparation";
    const e = newHomeworkActivity(s.assignment.id, 0, "read", s.assignment.created_at);
    e.record.title = "Aerodynamics reading";
    Object.assign(e.record, {
      material_id: sourceId,
      source_material_id: sourceId,
      source_revision: "a".repeat(64),
      page_start: 1,
      page_end: 5,
    });
    e.source = { title: "Test Handbook", total_pages: 10 };
    s.activities = [e];
    records.push(s);

    renderView(s.assignment.id);

    // Initial state before inspect resolves: must be checking, never ready
    expect(await screen.findByText("Checking what works without internet…")).toBeTruthy();
    expect(screen.getByText("Checking…")).toBeTruthy();
    expect(screen.queryByText("Everything here works without internet.")).toBeNull();
    expect(screen.queryByText("Works offline")).toBeNull();

    // Now complete the check
    inspectDeferred.resolve({ contentSha256: "a".repeat(64), totalPages: 10 });

    // After checks finish: summary shows ready
    expect(await screen.findByText("Everything here works without internet.")).toBeTruthy();
    expect(screen.getByText("Works offline")).toBeTruthy();
    expect(screen.queryByText("Checking what works without internet…")).toBeNull();
  });

  it.each(["missing", "unavailable"])("%s source needs a fix and never shows ready", async (failure) => {
    const s = readingAssignment();
    if (failure === "missing") s.activities[0]!.record.material_id = null;
    else inspect.mockRejectedValueOnce(new Error("Inspection failed"));
    renderView(s.assignment.id);
    if (failure === "missing") inspectDeferred.resolve({ contentSha256: "a".repeat(64), totalPages: 10 });
    expect(await screen.findByText("1 of 1 needs a fix before you study offline.")).toBeTruthy();
    expect(screen.getByText("Needs a fix")).toBeTruthy();
    expect(screen.queryByText("Everything here works without internet.")).toBeNull();
  });

  it.each(["study sets", "data revision", "reload"])("shows checking during a %s recheck after ready", async (trigger) => {
    const s = readingAssignment();
    const rendered = renderView(s.assignment.id);
    inspectDeferred.resolve({ contentSha256: "a".repeat(64), totalPages: 10 });
    await screen.findByText("Everything here works without internet.");
    inspectDeferred = createDeferred();
    if (trigger === "study sets") {
      appData = { ...appData, aiStudySets: [...appData.aiStudySets] };
      rendered.rerender(view(s.assignment.id));
    } else {
      // Failed reload keeps the same snapshot identity: only the check run changes.
      repository.get.mockRejectedValueOnce(new Error("Load failed"));
      dataRevision++;
      rendered.rerender(view(s.assignment.id));
      await screen.findByText("Homework couldn't be loaded. Try reloading.");
      if (trigger === "reload") {
        inspectDeferred.resolve({ contentSha256: "a".repeat(64), totalPages: 10 });
        await screen.findByText("Everything here works without internet.");
        inspectDeferred = createDeferred();
        repository.get.mockRejectedValueOnce(new Error("Load failed again"));
        fireEvent.click(screen.getByRole("button", { name: "Reload" }));
        await screen.findByText("Homework couldn't be loaded. Try reloading.");
      }
    }
    expect(await screen.findByText("Checking what works without internet…")).toBeTruthy();
    expect(screen.queryByText("Everything here works without internet.")).toBeNull();
    await act(async () => inspectDeferred.resolve({ contentSha256: "a".repeat(64), totalPages: 10 }));
    expect(await screen.findByText("Everything here works without internet.")).toBeTruthy();
  });

  it("an obsolete check completion cannot mark the current run ready", async () => {
    const s = readingAssignment();
    const rendered = renderView(s.assignment.id);
    await screen.findByText("Checking what works without internet…");
    const oldCheck = inspectDeferred;
    inspectDeferred = createDeferred();
    appData = { ...appData, aiStudySets: [...appData.aiStudySets] };
    rendered.rerender(view(s.assignment.id));
    await act(async () => oldCheck.resolve({ contentSha256: "a".repeat(64), totalPages: 10 }));
    expect(screen.getByText("Checking what works without internet…")).toBeTruthy();
    expect(screen.queryByText("Everything here works without internet.")).toBeNull();
    inspectDeferred.resolve({ contentSha256: "a".repeat(64), totalPages: 10 });
    expect(await screen.findByText("Everything here works without internet.")).toBeTruthy();
  });

  it("failed assignment switch shows no previous assignment summary", async () => {
    const s = readingAssignment();
    renderView(s.assignment.id);
    inspectDeferred.resolve({ contentSha256: "a".repeat(64), totalPages: 10 });
    await screen.findByText("Everything here works without internet.");
    repository.get.mockRejectedValueOnce(new Error("Navigation failed"));
    fireEvent.click(screen.getByRole("button", { name: "Switch assignment" }));
    await screen.findByText("Homework couldn't be loaded. Try reloading.");
    expect(screen.queryByText("Before you go offline")).toBeNull();
    expect(screen.queryByText("Everything here works without internet.")).toBeNull();
  });

  it("keeps activity heading name and focus target; summary is polite and wraps", async () => {
    const s = readingAssignment();
    renderView(s.assignment.id);
    const text = await screen.findByText("Checking what works without internet…");
    const summary = text.closest("p")!;
    expect(summary.getAttribute("role")).toBe("status");
    expect(summary.getAttribute("aria-live")).toBe("polite");
    expect(summary.classList.contains("wrap-anywhere")).toBe(true);
    const heading = screen.getByRole("heading", { level: 3, name: "Aerodynamics reading" });
    expect(heading.id).toBe(`homework-${s.activities[0]!.record.id}`);
    expect(heading.getAttribute("tabindex")).toBe("-1");
    expect(within(heading).queryByText("Checking…")).toBeNull();
    const note = screen.getByText("Checking…").closest("p")!;
    expect(note.classList.contains("muted")).toBe(true);
    expect(note.classList.contains("wrap-anywhere")).toBe(true);
    expect(note.textContent).toBe("Reading · To do · Checking…");
    inspectDeferred.resolve({ contentSha256: "a".repeat(64), totalPages: 10 });
    await screen.findByText("Everything here works without internet.");
    expect(screen.getByRole("heading", { level: 3, name: "Aerodynamics reading" })).toBe(heading);
    expect(note.textContent).toBe("Reading · To do · Works offline");
  });

  it("a changed card set shows '1 of N needs a fix…' and that activity's 'Needs a fix'", async () => {
    const cards = [{ front: "Q1", back: "A1", sourcePage: null }];
    appData = {
      ...EMPTY_DATA,
      materials: [makeMaterial({ id: sourceId, title: "Test Handbook" })],
      aiStudySets: [
        {
          sourceMaterialId: sourceId,
          flashcards: cards,
        } as AppData["aiStudySets"][number],
      ],
    };

    const s = newHomework();
    s.assignment.title = "Flashcard review";
    const e = newHomeworkActivity(s.assignment.id, 0, "cards", s.assignment.created_at);
    e.record.title = "Systems cards";
    // Deliberately different content hash
    Object.assign(e.record, {
      material_id: sourceId,
      source_material_id: sourceId,
      source_revision: "different-revision-hash",
      card_set_id: "dummy-set-id",
    });
    e.source = { title: "Test Handbook", total_pages: null };
    s.activities = [e];
    records.push(s);

    renderView(s.assignment.id);

    // Once effect runs, sourceStates will contain "changed"
    expect(await screen.findByText("1 of 1 needs a fix before you study offline.")).toBeTruthy();
    expect(screen.getByText("Needs a fix")).toBeTruthy();
    expect(screen.queryByText("Everything here works without internet.")).toBeNull();
  });

  it("browser mode (canCheckFiles false) with a read shows the cannot-check text, never the ready text", async () => {
    canCheckFilesFlag = false;

    const s = newHomework();
    s.assignment.title = "Browser reading check";
    const eRead = newHomeworkActivity(s.assignment.id, 0, "read", s.assignment.created_at);
    eRead.record.title = "FAR Part 61";
    Object.assign(eRead.record, {
      material_id: sourceId,
      source_material_id: sourceId,
      source_revision: "a".repeat(64),
      page_start: 1,
      page_end: 10,
    });
    eRead.source = { title: "Test Handbook", total_pages: 50 };

    const eChecklist = newHomeworkActivity(s.assignment.id, 1, "checklist", s.assignment.created_at);
    eChecklist.record.title = "Pre-flight checklist";

    s.activities = [eRead, eChecklist];
    records.push(s);

    renderView(s.assignment.id);

    // After checks finish in browser mode:
    expect(await screen.findByText("PDF readings can only be checked in the Mac app.")).toBeTruthy();
    expect(screen.getByText("Check in the Mac app")).toBeTruthy();
    expect(screen.getByText("Works offline")).toBeTruthy(); // checklist is ready
    expect(screen.queryByText("Everything here works without internet.")).toBeNull();
  });

  it("does not render offline summary claim when activity list is empty", async () => {
    const s = newHomework();
    s.assignment.title = "Empty homework";
    s.activities = [];
    records.push(s);

    renderView(s.assignment.id);

    await screen.findByText("Empty homework");
    expect(screen.queryByText(/Before you go offline/)).toBeNull();
    expect(screen.queryByText("Everything here works without internet.")).toBeNull();
  });

  it("does not render offline summary on homework list view", async () => {
    const s = newHomework();
    s.assignment.title = "Some homework";
    s.activities = [];
    records.push(s);

    renderView(); // No assignment ID -> list view

    await screen.findByText("A little preparation, at your pace.");
    expect(screen.queryByText(/Before you go offline/)).toBeNull();
  });
});
