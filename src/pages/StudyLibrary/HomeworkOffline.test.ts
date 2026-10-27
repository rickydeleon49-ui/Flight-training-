// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type HomeworkSnapshot, type HomeworkOperation } from "@/domain/homework";
import { makeMaterial } from "@/testing/factories";
import { EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import { newHomework, newHomeworkActivity } from "./homeworkUi";
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

const sourceId = "10000000-0000-4000-8000-000000000001";
const quizId = "10000000-0000-4000-8000-000000000002";

const inspect = vi.fn(async () => inspectDeferred.promise);
const openSaved = vi.fn(async () => null);

const repository = {
  save: vi.fn(async (op: HomeworkOperation) => ({ version: 1, assignmentId: op.assignmentId, revision: op.next.assignment.revision })),
  list: async () => records.map((s) => s.assignment),
  get: vi.fn(async (id: string) => structuredClone(records.find((s) => s.assignment.id === id) ?? null)),
  history: async () => [],
};

const repositories = {
  homework: repository,
  navigation: {
    inspect,
    canCheckFiles: () => canCheckFilesFlag,
  },
  practiceSessions: {
    getActiveVersion: async () => ({ version: { id: quizId, contentHash: "b".repeat(64) } }),
    getVersion: async () => ({ id: quizId, contentHash: "b".repeat(64) }),
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

  afterEach(cleanup);

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
