// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HomeworkError, validateHomeworkTransition, type HomeworkSnapshot, type HomeworkOperation } from "@/domain/homework";
import { makeMaterial } from "@/testing/factories";
import { EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import { todayIso } from "@/lib/dates";
import { newHomework, newHomeworkActivity, homeworkOperation } from "./homeworkUi";
import { HomeworkView } from "./HomeworkView";
import { HomeworkEditor } from "./HomeworkEditor";
let appData: AppData;
let records: HomeworkSnapshot[], history: HomeworkOperation[], fail: string | null;
const save = vi.fn(async (op: HomeworkOperation) => {
    if (fail)
        throw new HomeworkError(fail as "STALE");
    const prior = records.find(s => s.assignment.id === op.assignmentId) ?? null;
    const next = validateHomeworkTransition(prior, op);
    records = [...records.filter(s => s.assignment.id !== op.assignmentId), structuredClone(next)];
    history.push(op);
    return { version: 1, assignmentId: op.assignmentId, revision: next.assignment.revision };
});
const repository = { save, list: async () => records.map(s => s.assignment), get: async (id: string) => structuredClone(records.find(s => s.assignment.id === id) ?? null), history: async () => history.map(op => ({ change_kind: op.changeKind, created_at: op.at, revision: op.next.assignment.revision })) };
const refresh = vi.fn(async () => { });
const sourceId = "10000000-0000-4000-8000-000000000001";
const quizId = "10000000-0000-4000-8000-000000000002";
const inspect = vi.fn(async () => ({ contentSha256: "a".repeat(64), totalPages: 8 }));
const openSaved = vi.fn(async () => null);
const repositories = { homework: repository, navigation: { inspect, canCheckFiles: () => true }, practiceSessions: { getActiveVersion: async () => ({ version: { id: quizId, contentHash: "b".repeat(64) } }), getVersion: async () => ({ id: quizId, contentHash: "b".repeat(64) }) } };
vi.mock("@/state/AppDataContext", async (importOriginal) => ({ ...await importOriginal<object>(), useAppData: () => ({ data: appData, dataRevision: 1, repositories, refresh }) }));
vi.mock("@/state/navigation/useDocumentNavigation", () => ({ useNavigationController: () => ({ controller: { openSaved, status: () => ({ kind: "idle", epoch: 0 }), abort: vi.fn() }, repo: null, status: { kind: "idle" } }) }));
function assignment(kinds: string[] = ["checklist"]) {
    const s = newHomework();
    s.assignment.title = "Weather preparation";
    s.activities = kinds.map((kind, i) => { const e = newHomeworkActivity(s.assignment.id, i, kind as "checklist", s.assignment.created_at); e.record.title = `${kind} work`; return e; }).sort((a, b) => a.record.id.localeCompare(b.record.id));
    records.push(s);
    return s;
}
function view(id?: string) { return render(h(MemoryRouter, { initialEntries: [id ? `/study/homework/${id}` : "/study/homework"] }, h(Routes, null, h(Route, { path: "/study/homework/:assignmentId?", element: h(HomeworkView) })))); }
function editor(s = newHomework()) { return render(h(HomeworkEditor, { snapshot: s, creating: true, onClose: vi.fn(), onSaved: vi.fn(), onReload: vi.fn() })); }
beforeEach(() => { appData = { ...EMPTY_DATA }; openSaved.mockClear(); records = []; history = []; fail = null; save.mockClear(); refresh.mockClear(); });
afterEach(cleanup);
it("homework_list_filters_and_empty_state_without_school", async () => {
    view();
    await screen.findByText("A little preparation, at your pace.");
    expect(screen.getByText(/No school, instructor or date needed/)).toBeTruthy();
    for (const name of ["Upcoming", "In progress", "Completed", "Archived"])
        expect(screen.getByRole("button", { name })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add homework" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
});
it("editor_all_six_kinds_and_optional_fields", async () => {
    editor();
    for (const label of ["Title", "Instructions (optional)", "Due date (optional)", "School (optional)", "Instructor (optional)", "Lesson (optional)"])
        expect(screen.getByLabelText(label)).toBeTruthy();
    for (const kind of ["Reading", "Cards", "Quiz", "Reflection", "Questions", "Checklist"]) {
        fireEvent.click(screen.getByRole("button", { name: `Add ${kind.toLowerCase()}` }));
    }
    expect(screen.getAllByLabelText("Activity title")).toHaveLength(6);
    fireEvent.change(screen.getByLabelText("Title"),{target:{value:"All kinds, sources later"}});
    fireEvent.click(screen.getByRole("button",{name:"Save homework"}));
    await waitFor(()=>expect(records[0]?.activities).toHaveLength(6));
    expect(records[0]!.activities.every(e=>e.record.material_id===null)).toBe(true);
});
it("editor_reorder_keyboard_accessible", async () => {
    const s = assignment(["checklist", "reflection"]);
    view(s.assignment.id);
    const up = await screen.findByRole("button", { name: "Move reflection work up" });
    up.focus();
    fireEvent.click(up);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![0].changeKind).toBe("reorder");
    expect(save.mock.calls[0]![0].next.activities.find(e => e.record.kind === "reflection")!.record.position).toBe(0);
    await waitFor(()=>expect(document.activeElement?.id).toBe(`homework-${s.activities.find(e=>e.record.kind==='reflection')!.record.id}`));
});
it("save_repeated_click_reuses_operation", async () => {
    fail = "STORAGE";
    editor();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My homework" } });
    fireEvent.click(screen.getByRole("button", { name: "Save homework" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Save homework" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[0]![0]).toEqual(save.mock.calls[1]![0]);
});
it("stale_save_keeps_draft_and_offers_reload", async () => {
    fail = "STALE";
    editor();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Keep my draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save homework" }));
    await screen.findByText("This changed elsewhere. Reload to see the latest");
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Keep my draft");
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
});
it("read_complete_requires_explicit_mark_not_opening", async () => {
    const s = assignment(["read"]);
    view(s.assignment.id);
    await screen.findByText("read work");
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Mark reading complete" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Mark reading complete" }) as HTMLButtonElement).disabled).toBe(true);
});
it("reflection_requires_nonblank_then_mark", async () => {
    const s = assignment(["reflection"]);
    view(s.assignment.id);
    const mark = await screen.findByRole("button", { name: "Mark complete" });
    expect((mark as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Edit reflection work" }));
    fireEvent.change(screen.getByLabelText("Activity text"), { target: { value: "I want to review fronts." } });
    fireEvent.click(screen.getByRole("button", { name: "Save homework" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: "Mark complete" }));
    await waitFor(() => expect(records[0]!.assignment.state).toBe("completed"));
});
it("cards_and_test_not_completable_in_this_slice", async () => {
    const s = assignment(["cards", "test"]);
    view(s.assignment.id);
    await screen.findByText("cards work");
    expect(screen.getAllByText("Completion is recorded automatically in a later update")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Mark complete" })).toBeNull();
});
it("reopen_and_archive_keep_history", async () => {
    const s = assignment();
    view(s.assignment.id);
    fireEvent.click(await screen.findByRole("checkbox"));
    await waitFor(() => expect(records[0]!.assignment.state).toBe("completed"));
    fireEvent.click(await screen.findByRole("button", { name: "Reopen checklist work" }));
    await waitFor(() => expect(records[0]!.assignment.state).toBe("reopened"));
    await waitFor(() => expect((screen.getByRole("button", { name: "Archive" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(records[0]!.assignment.archived).toBe(1));
    expect(history.map(op => op.changeKind)).toEqual(["complete", "reopen", "archive"]);
    expect(records[0]!.activities[0]!.record.cycle).toBe(2);
});
it("source_missing_repair_relinks", async () => {
    const s = assignment(["read"]);
    view(s.assignment.id);
    await screen.findByText("Source missing — choose a source to continue");
    fireEvent.click(screen.getByRole("button", { name: "Choose a source for read work" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText("Material")).toBeTruthy();
});
it("overdue_uses_local_civil_date", async () => {
    const s = assignment();
    s.assignment.due_date = "2001-01-01";
    view();
    await screen.findByText(/overdue/);
    expect(todayIso()).toMatch(/^\d{4}-\d\d-\d\d$/);
});
it("homework_wording_never_claims_mastery", async () => {
    const s = assignment();
    const ui = view(s.assignment.id);
    await screen.findByText("checklist work");
    expect(ui.container.textContent).not.toMatch(/mastery|proficien|ready to fly/i);
});
it("soft removal keeps activity and history", async () => {
    const s = assignment();
    view(s.assignment.id);
    fireEvent.click(await screen.findByRole("button", { name: "Remove checklist work" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove activity" }));
    await waitFor(() => expect(records[0]!.activities[0]!.record.removed_at).not.toBeNull());
    expect(records[0]!.assignment.state).toBe("upcoming");
});
it("saves all six kinds with verified sources and optional fields", async () => {
    appData = { ...EMPTY_DATA, materials: [makeMaterial({ id: sourceId, title: "Synthetic PDF" })], aiStudySets: [{ sourceMaterialId: sourceId, flashcards: [{ front: "Front", back: "Back", sourcePage: null }] } as AppData["aiStudySets"][number]] };
    editor();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Six kinds" } });
    for (const name of ["reading", "cards", "quiz", "reflection", "questions", "checklist"])
        fireEvent.click(screen.getByRole("button", { name: `Add ${name}` }));
    for (let i = 0; i < 3; i++) {
        fireEvent.change(screen.getAllByLabelText("Material")[i]!, { target: { value: sourceId } });
        await waitFor(() => expect((screen.getByRole("button", { name: "Save homework" }) as HTMLButtonElement).disabled).toBe(false));
    }
    fireEvent.change(screen.getByLabelText("End page"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save homework" }));
    await screen.findByText("Choose a physical page range within this PDF.");
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("End page"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save homework" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(records[0]!.activities).toHaveLength(6);
    expect(records[0]!.activities.find(e => e.record.kind === 'test')!.record.test_version_id).toBe(quizId);
    expect(records[0]!.assignment.school).toBeNull();
});
it("opening a verified read does not complete it; explicit mark stores the source", async () => {
    appData = { ...EMPTY_DATA, materials: [makeMaterial({ id: sourceId })] };
    const s = assignment(["read"]), e = s.activities[0]!;
    Object.assign(e.record, { material_id: sourceId, source_material_id: sourceId, source_revision: "a".repeat(64), page_start: 2, page_end: 4 });
    e.source = { title: "Synthetic source", total_pages: 8 };
    view(s.assignment.id);
    fireEvent.click(await screen.findByRole("button", { name: "Open PDF at page 2" }));
    await waitFor(() => expect(openSaved).toHaveBeenCalledWith({ materialId: sourceId, contentSha256: "a".repeat(64), physicalPage: 2, pageLabel: null }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Mark reading complete" }));
    await waitFor(() => expect(records[0]!.assignment.state).toBe("completed"));
    expect(records[0]!.activities[0]!.evidence!.page_start).toBe(2);
});
it("source repair saves a deliberate relink and a new cycle", async () => {
    appData = { ...EMPTY_DATA, materials: [makeMaterial({ id: sourceId })] };
    const s = assignment(["read"]);
    view(s.assignment.id);
    fireEvent.click(await screen.findByRole("button", { name: "Choose a source for read work" }));
    fireEvent.change(screen.getByLabelText("Material"), { target: { value: sourceId } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Save homework" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save homework" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![0].changeKind).toBe("relink");
    expect(records[0]!.activities[0]!.record.cycle).toBe(2);
    expect(records[0]!.activities[0]!.record.material_id).toBe(sourceId);
});
it("stale reload shows saved content while retaining the losing draft", async () => {
    const s = assignment();
    fail = "STALE";
    render(h(HomeworkEditor, { snapshot: s, onClose: vi.fn(), onSaved: vi.fn(), onReload: vi.fn() }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My losing draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save homework" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reload" }));
    await screen.findByText(/Latest saved homework: Weather preparation/);
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("My losing draft");
});
it("filters isolate completed and archived homework", async () => {
    const a = assignment(), b = assignment();
    a.assignment.title = "Upcoming work";
    b.assignment.title = "Archived work";
    b.assignment.archived = 1;
    const c = assignment();
    c.assignment.title = "Completed work";
    const d = structuredClone(c);
    d.activities[0]!.record.state = "completed";
    const completed = homeworkOperation(c, d, "complete").next;
    records = records.map(s => s.assignment.id === c.assignment.id ? completed : s);
    view();
    await screen.findByText("Upcoming work");
    expect(screen.queryByText("Archived work")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Completed" }));
    expect(screen.getByText("Completed work")).toBeTruthy();
    expect(screen.queryByText("Upcoming work")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(screen.getByText("Archived work")).toBeTruthy();
});
