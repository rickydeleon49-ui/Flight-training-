// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HomeworkOperation, HomeworkSnapshot } from "@/domain/homework";
import { HomeworkError } from "@/domain/homework";
import { EMPTY_DATA } from "@/state/AppDataContext";
import { makeEvent, makeMaterial } from "@/testing/factories";
import { newHomework, newHomeworkActivity } from "./homeworkUi";
import { HomeworkEditor } from "./HomeworkEditor";

const materialId = "10000000-0000-4000-8000-000000000001";
const lesson = makeEvent();
const save = vi.fn<(op: HomeworkOperation) => Promise<void>>();
const get = vi.fn<(id: string) => Promise<HomeworkSnapshot>>();
const refresh = vi.fn(async () => {});
const inspect = vi.fn(async () => ({ contentSha256: "a".repeat(64), totalPages: 14 }));
vi.mock("@/state/AppDataContext", async (original) => ({
    ...await original<object>(),
    useAppData: () => ({
        data: { ...EMPTY_DATA, materials: [makeMaterial({ id: materialId })], events: [lesson] },
        repositories: { homework: { save, get }, navigation: { inspect } }, refresh,
    }),
}));
beforeEach(() => { vi.clearAllMocks(); save.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function reading(totalPages: number | null = 14) {
    const s = newHomework();
    s.assignment.title = "Prepare for a lesson";
    const e = newHomeworkActivity(s.assignment.id, 0, "read", s.assignment.created_at);
    Object.assign(e.record, { title: "AFH reading", material_id: materialId, source_material_id: materialId, source_revision: "a".repeat(64), page_start: 8, page_end: 25 });
    e.source = { title: "Synthetic AFH", total_pages: totalPages };
    s.activities.push(e);
    return s;
}
function editor(snapshot = reading(), creating = true) {
    const callbacks = { onSaved: vi.fn(), onReload: vi.fn(), onClose: vi.fn() };
    render(h(HomeworkEditor, { snapshot, creating, ...callbacks }));
    return callbacks;
}
const saveButton = () => screen.getByRole("button", { name: "Save homework" });
function fields() {
    return [...screen.getByRole("dialog").querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")];
}
function fillDraft() {
    const values: Record<string, string> = {
        Title: "Tomorrow's preparation", "Instructions (optional)": "Read slowly\nBring questions.",
        "Due date (optional)": "2026-11-01", "School (optional)": "My school", "Instructor (optional)": "My instructor",
        "Lesson (optional)": lesson.id, "Activity title": "AFH reading — final word", "Activity text": "Keep this entire sentence.",
        "Start page": "8", "End page": "25",
    };
    for (const [label, value] of Object.entries(values)) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    return fields().map(field => field.value);
}

it.each([false, true])("fast Save retains every field and dialog scroll on validation failure (double click: %s)", (twice) => {
    editor();
    const body = screen.getByRole("dialog").querySelector<HTMLElement>(".dialog__body")!;
    body.scrollTop = 700;
    const expected = fillDraft();
    fireEvent.click(saveButton());
    if (twice) fireEvent.click(saveButton());
    expect(fields().map(field => field.value)).toEqual(expected);
    expect(body.scrollTop).toBe(700);
    expect(save).not.toHaveBeenCalled();
});

it("typing all fields then immediately saving persists their latest values; rapid second Save submits once", async () => {
    const s = reading();
    s.activities[0]!.record.page_end = 14;
    editor(s);
    const expected = fillDraft();
    fireEvent.change(screen.getByLabelText("End page"), { target: { value: "14" } });
    expected[expected.length - 1] = "14";
    let finish!: () => void;
    save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    fireEvent.click(saveButton());
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
    expect(save).toHaveBeenCalledTimes(1);
    const next = save.mock.calls[0]![0].next;
    expect(next.assignment).toMatchObject({ title: "Tomorrow's preparation", instructions: "Read slowly\nBring questions.", due_date: "2026-11-01", school: "My school", instructor: "My instructor", lesson_id: lesson.id });
    expect(next.activities[0]!.record).toMatchObject({ title: "AFH reading — final word", body: "Keep this entire sentence.", page_start: 8, page_end: 14, kind: "read", material_id: materialId });
    expect(fields().map(field => field.value)).toEqual(expected);
    finish();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
});

it("identifies the activity and PDF bounds at Save, links only its invalid fields, and focuses and scrolls to its start", () => {
    const s = reading();
    const other = newHomeworkActivity(s.assignment.id, 1, "read", s.assignment.created_at);
    other.record.title = "Another reading";
    s.activities.push(other);
    editor(s);
    const start = screen.getAllByLabelText("Start page")[0]!;
    const focus = vi.spyOn(start, "focus");
    const scroll = vi.fn();
    Object.defineProperty(start, "scrollIntoView", { value: scroll });
    fireEvent.click(saveButton());
    const message = '“AFH reading”: pages 8–25 aren\'t in this PDF. It has 14 pages — choose pages 1–14.';
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toBe(message);
    const footer = saveButton().closest(".dialog__footer")!;
    const copy = within(footer as HTMLElement).getByText(message);
    expect(copy.getAttribute("aria-hidden")).toBe("true");
    for (const label of ["Start page", "End page"]) {
        const [invalid, valid] = screen.getAllByLabelText(label);
        expect(invalid!.getAttribute("aria-invalid")).toBe("true");
        const description = document.getElementById(invalid!.getAttribute("aria-describedby")!);
        expect(description?.textContent).toBe(message);
        expect(valid!.hasAttribute("aria-invalid")).toBe(false);
        expect(valid!.hasAttribute("aria-describedby")).toBe(false);
    }
    expect(document.activeElement).toBe(start);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    // A second validation attempt still directs attention to the same field.
    saveButton().focus();
    fireEvent.click(saveButton());
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(start);
    expect(save).not.toHaveBeenCalled();
});

it("uses plain guidance without invented page counts when the PDF length is unknown", () => {
    editor(reading(null));
    fireEvent.click(saveButton());
    expect(screen.getByRole("alert").textContent).toBe('“AFH reading”: choose a physical page range within this PDF. Check the PDF\'s pages in the desktop app first.');
    expect(screen.getByLabelText("Start page").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText("Start page"));
});

it("updates the footer for title and source problems and retains stale Reload / Open saved homework behavior", async () => {
    const s = reading();
    s.activities[0]!.record.page_end = 14;
    const callbacks = editor(s);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "" } });
    fireEvent.click(saveButton());
    const footer = saveButton().closest(".dialog__footer")!;
    expect(footer.textContent).toContain("Give your homework and each activity a title.");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Keep my draft" } });
    fireEvent.change(screen.getByLabelText("Material"), { target: { value: "" } });
    await waitFor(() => expect(footer.textContent).toContain("That source isn't available yet."));
    save.mockRejectedValueOnce(new HomeworkError("STALE"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(footer.textContent).toContain("This changed elsewhere. Reload to see the latest"));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    get.mockRejectedValueOnce(new Error("unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(footer.textContent).toContain("The latest homework could not be loaded. Your draft is still here."));
    get.mockResolvedValueOnce(s);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await screen.findByText(/Latest saved homework: Prepare for a lesson/);
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Keep my draft");
    fireEvent.click(screen.getByRole("button", { name: "Open saved homework" }));
    expect(callbacks.onReload).toHaveBeenCalledTimes(1);
});

it.each([
    [10, 5, "“AFH reading”: the end page must be the same as or after the start page."],
    [null, 25, "“AFH reading”: enter both a start page and an end page."],
])("names the real problem for a reversed or incomplete range (%s–%s)", (start, end, message) => {
    const s = reading();
    Object.assign(s.activities[0]!.record, { page_start: start, page_end: end });
    editor(s);
    fireEvent.click(saveButton());
    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(document.activeElement).toBe(screen.getByLabelText("Start page"));
    expect(save).not.toHaveBeenCalled();
});

it.each([
    [{ creating: true }, "Add homework"],
    [{ adding: true }, "Add activities"],
    [{}, "Edit homework"],
    [{ relink: true }, "Choose a source"],
])("names the dialog for its purpose: %s", (mode, title) => {
    render(h(HomeworkEditor, { snapshot: newHomework(), ...mode, onSaved: vi.fn(), onReload: vi.fn(), onClose: vi.fn() }));
    expect(screen.getByRole("dialog", { name: title })).toBeTruthy();
    expect(saveButton()).toBeTruthy();
});

it.each([true, false])("removes only a new duplicate, retains saved work and contiguous positions (creating: %s)", async (creating) => {
    const s = newHomework();
    s.assignment.title = "Before my lesson";
    const saved = newHomeworkActivity(s.assignment.id, 0, "reflection", s.assignment.created_at);
    saved.record.body = "Keep this prompt";
    saved.record.answer = "Keep this answer";
    if (!creating) { s.assignment.revision = 1; s.activities.push(saved); }
    const original = structuredClone(s);
    render(h(HomeworkEditor, { snapshot: s, creating, adding: !creating, onSaved: vi.fn(), onReload: vi.fn(), onClose: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: "Add questions" }));
    const first = screen.getByLabelText("Activity title");
    expect(document.activeElement).toBe(first);
    fireEvent.click(screen.getByRole("button", { name: "Add questions" }));
    const second = screen.getAllByLabelText("Activity title")[1]!;
    expect(document.activeElement).toBe(second);
    const sections = screen.getAllByRole("button", { name: "Remove Questions" }).map(b => b.closest("section")!);
    fireEvent.change(within(sections[1]!).getByLabelText("Activity text"), { target: { value: "Ask about crosswinds" } });
    // Remove the first of two same-kind entries: identity matters, and the next entry receives focus.
    fireEvent.click(within(sections[0]!).getByRole("button", { name: "Remove Questions" }));
    expect(screen.getAllByLabelText("Activity title")).toHaveLength(1);
    expect(document.activeElement).toBe(second);
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const next = save.mock.calls[0]![0].next;
    expect(next.activities).toHaveLength(creating ? 1 : 2);
    const questions = next.activities.find(e => e.record.kind === "questions")!;
    expect(questions.record).toMatchObject({ title: "Questions", body: "Ask about crosswinds", position: creating ? 0 : 1, removed_at: null });
    if (!creating) expect(next.activities.find(e => e.record.id === saved.record.id)).toEqual(saved);
    expect(s).toEqual(original);
});

it("moves focus to the previous activity, then back to Add when the last new activity is removed", () => {
    editor(newHomework());
    fireEvent.click(screen.getByRole("button", { name: "Add reflection" }));
    fireEvent.click(screen.getByRole("button", { name: "Add checklist" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Checklist" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Activity title"));
    fireEvent.change(screen.getByLabelText("Activity title"), { target: { value: "After landing" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove After landing" }));
    expect(screen.queryByLabelText("Activity title")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add reading" }));
    expect(save).not.toHaveBeenCalled();
});

it.each(["questions", "reflection", "checklist"] as const)("keeps untouched default %s visible, removable and included on Save", async kind => {
    const s = newHomework();
    s.assignment.title = "Before my lesson";
    editor(s);
    fireEvent.click(screen.getByRole("button", { name: `Add ${kind}` }));
    const title = (screen.getByLabelText("Activity title") as HTMLInputElement).value;
    expect(screen.getByRole("button", { name: `Remove ${title}` })).toBeTruthy();
    expect((screen.getByLabelText("Activity text") as HTMLTextAreaElement).value).toBe("");
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![0].next.activities).toHaveLength(1);
    expect(save.mock.calls[0]![0].next.activities[0]!.record).toMatchObject({ kind, title, body: "" });
    expect(screen.getByRole("button", { name: `Remove ${title}` })).toBeTruthy();
});

it("never offers draft removal for a saved activity being edited or relinked", () => {
    const s = reading();
    const props = { snapshot: s, activityId: s.activities[0]!.record.id, onSaved: vi.fn(), onReload: vi.fn(), onClose: vi.fn() };
    const view = render(h(HomeworkEditor, props));
    expect(screen.getByLabelText("Activity title")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    view.rerender(h(HomeworkEditor, { ...props, relink: true }));
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
});

it("disables removal while saving, and Cancel does not persist a draft removal", async () => {
    const s = newHomework();
    s.assignment.title = "Before my lesson";
    const callbacks = editor(s);
    fireEvent.click(screen.getByRole("button", { name: "Add questions" }));
    let finish!: () => void;
    save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    fireEvent.click(saveButton());
    const remove = screen.getByRole("button", { name: "Remove Questions" });
    expect(remove.closest("fieldset")!.disabled).toBe(true);
    fireEvent.click(remove);
    expect(screen.getByLabelText("Activity title")).toBeTruthy();
    finish();
    await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledTimes(1));
    cleanup(); save.mockClear();
    const cancelled = editor(s);
    fireEvent.click(screen.getByRole("button", { name: "Add questions" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Questions" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelled.onClose).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(s.activities).toEqual([]);
});
