// @vitest-environment jsdom
// ASTRA-FIX-2 #1 and #2: Notes drafts survive a save that finishes after she
// left and came back, and an existing note's old draft never silently
// replaces what is saved now (for example after a restore).
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Note } from "@/domain/types";
import { readDraft, writeDraft } from "@/lib/drafts";
import { EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import { makeNote } from "@/testing/factories";

let notes: Note[] = [];
const create = vi.fn();
const update = vi.fn();
/** Each mutate waits until the test settles it. */
let pending: Array<(value: unknown) => void> = [];
const mutate = vi.fn(async (run: (repos: unknown) => unknown) => {
  await run({ notes: { create, update } });
  return new Promise((resolve) => pending.push(resolve));
});
vi.mock("@/state/AppDataContext", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAppData: () => ({ data: { ...(EMPTY_DATA as AppData), notes }, mutate, deleteWithUndo: vi.fn() }),
}));

import { Notes } from "./Notes";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  pending = [];
  notes = [];
  create.mockReset();
  update.mockReset();
  mutate.mockClear();
});
afterEach(cleanup);

const page = () => h(MemoryRouter, null, h(Notes));
const box = (name: string) => screen.getAllByRole("textbox", { name })[0] as HTMLTextAreaElement;
/** A field in the open note editor (the new-note box above has the same labels). */
const edit = (name: string) =>
  within(document.querySelector<HTMLElement>(".note-row--editing")!).getByRole("textbox", { name }) as HTMLTextAreaElement;
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const settle = async (value: unknown) => {
  await waitFor(() => expect(pending.length).toBeGreaterThan(0));
  await act(async () => {
    pending.shift()!(value);
  });
};
type Stored = { title: string; body: string; baseline?: { title: string; body: string } | null };

it("#1 a new-note save finishing after she left and came back keeps her newer typing", async () => {
  const first = render(page());
  fireEvent.change(box("Note"), { target: { value: "Draft A" } });
  fireEvent.click(button("Save note"));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  first.unmount(); // navigate away while it saves

  render(page()); // come back: A is recovered
  expect(box("Note").value).toBe("Draft A");
  fireEvent.change(box("Note"), { target: { value: "Draft A, then B" } });

  await settle({ id: "n1" }); // the first page's save finishes now
  expect(readDraft<Stored>("notes.new")?.body).toBe("Draft A, then B");
  expect(box("Note").value).toBe("Draft A, then B");
});

it("#1 a finished save still clears its own draft", async () => {
  render(page());
  fireEvent.change(box("Note"), { target: { value: "Saved for real" } });
  fireEvent.click(button("Save note"));
  await settle({ id: "n1" });
  expect(box("Note").value).toBe("");
  expect(readDraft("notes.new")).toBeNull();
});

it("#1 an edit save finishing after a remount keeps the newer edit draft", async () => {
  notes = [makeNote({ id: "n1", title: "Call school", body: "Original" })];
  const first = render(page());
  fireEvent.click(button("Edit"));
  fireEvent.change(edit("Note"), { target: { value: "Edit A" } });
  fireEvent.click(button("Save changes"));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  first.unmount();

  render(page());
  fireEvent.click(button("Edit"));
  expect(edit("Note").value).toBe("Edit A");
  fireEvent.change(edit("Note"), { target: { value: "Edit A, then B" } });
  await settle({ id: "n1" });
  expect(readDraft<Stored>("notes.n1")?.body).toBe("Edit A, then B");
  expect(edit("Note").value).toBe("Edit A, then B");
});

it("#1 an editor closed while saving does not close the editor she opened next", async () => {
  notes = [
    makeNote({ id: "n1", title: "First", body: "One" }),
    makeNote({ id: "n2", title: "Second", body: "Two" }),
  ];
  render(page());
  fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
  fireEvent.change(edit("Note"), { target: { value: "One, edited" } });
  fireEvent.click(button("Save changes"));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  fireEvent.click(button("Edit")); // the other note's Edit
  expect(edit("Note").value).toBe("Two");
  await settle({ id: "n1" });
  expect(edit("Note").value).toBe("Two");
});

it("#2 a draft from before a restore asks first: Use the saved notes", async () => {
  notes = [makeNote({ id: "n1", title: "Call school", body: "Restored body" })];
  writeDraft<Stored>("notes.n1", {
    title: "Call school",
    body: "Earlier typing",
    baseline: { title: "Call school", body: "Body before the restore" },
  });
  render(page());
  fireEvent.click(button("Edit"));
  expect(screen.getByText("You have unsaved notes from earlier.")).toBeTruthy();
  expect(edit("Note").value).toBe("Earlier typing");
  expect(edit("Note").readOnly).toBe(true);
  expect(button("Save changes").disabled).toBe(true);
  fireEvent.click(button("Use the saved notes"));
  expect(edit("Note").value).toBe("Restored body");
  expect(screen.queryByText("You have unsaved notes from earlier.")).toBeNull();
  expect(readDraft("notes.n1")).toBeNull();
});

it("#2 Keep these adopts the restored note as the starting point, then saves", async () => {
  notes = [makeNote({ id: "n1", title: "Call school", body: "Restored body" })];
  writeDraft<Stored>("notes.n1", {
    title: "Call school",
    body: "Earlier typing",
    baseline: { title: "Call school", body: "Body before the restore" },
  });
  render(page());
  fireEvent.click(button("Edit"));
  fireEvent.click(button("Keep these"));
  expect(edit("Note").readOnly).toBe(false);
  fireEvent.click(button("Save changes"));
  await waitFor(() => expect(update).toHaveBeenCalledWith("n1", { body: "Earlier typing" }));
});

it("#2 a legacy draft without a baseline is a conflict, not a silent swap", () => {
  notes = [makeNote({ id: "n1", title: "Call school", body: "Restored body" })];
  writeDraft("notes.n1", { title: "Call school", body: "Legacy typing" });
  render(page());
  fireEvent.click(button("Edit"));
  expect(screen.getByText("You have unsaved notes from earlier.")).toBeTruthy();
  expect(button("Save changes").disabled).toBe(true);
});

it("#2 a title-only change never writes the body", async () => {
  notes = [makeNote({ id: "n1", title: "Old title", body: "Restored body" })];
  render(page());
  fireEvent.click(button("Edit"));
  fireEvent.change(edit("Title (optional)"), { target: { value: "New title" } });
  fireEvent.click(button("Save changes"));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update).toHaveBeenCalledWith("n1", { title: "New title" });
});

it("#2 the saved note changing under an open editor asks before saving", () => {
  notes = [makeNote({ id: "n1", title: "Call school", body: "Before" })];
  const ui = render(page());
  fireEvent.click(button("Edit"));
  fireEvent.change(edit("Note"), { target: { value: "My edit" } });
  notes = [makeNote({ id: "n1", title: "Call school", body: "Restored meanwhile" })];
  ui.rerender(page());
  expect(screen.getByText("You have unsaved notes from earlier.")).toBeTruthy();
  expect(button("Save changes").disabled).toBe(true);
});

it("#1 coming back mid-save without typing: the saved note is not saved twice", async () => {
  const first = render(page());
  fireEvent.change(box("Note"), { target: { value: "Draft A" } });
  fireEvent.click(button("Save note"));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  first.unmount();

  render(page());
  expect(box("Note").value).toBe("Draft A");
  await settle({ id: "n1" });
  expect(box("Note").value).toBe("");
  expect(readDraft("notes.new")).toBeNull();
  expect(button("Save note").disabled).toBe(true);
  fireEvent.click(button("Save note"));
  expect(create).toHaveBeenCalledTimes(1);
});

it("#1 coming back to an edit mid-save without typing closes it as saved", async () => {
  notes = [makeNote({ id: "n1", title: "Call school", body: "Original" })];
  const first = render(page());
  fireEvent.click(button("Edit"));
  fireEvent.change(edit("Note"), { target: { value: "Edit A" } });
  fireEvent.click(button("Save changes"));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  first.unmount();

  render(page());
  fireEvent.click(button("Edit"));
  expect(edit("Note").value).toBe("Edit A");
  await settle({ id: "n1" });
  expect(document.querySelector(".note-row--editing")).toBeNull();
  expect(update).toHaveBeenCalledTimes(1);
  expect(readDraft("notes.n1")).toBeNull();
});

it("labels note deletion with visible text and an aria-label", () => {
  notes = [makeNote({id:"polish-note", title:"Call the school", body:"Ask about lessons."})];
  render(page());
  const button = screen.getByRole("button", {name:"Delete note: Call the school"});
  expect(button.textContent).toContain("Delete");
  expect(button.getAttribute("aria-label")).toBe("Delete note: Call the school");
});
