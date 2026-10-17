// @vitest-environment jsdom
/**
 * The lesson brief dialog (P54-05 part A): choices start unticked and live
 * only in the dialog, the preview is the exact page that is saved, one click
 * saves once, controls stay fixed while a save is pending, failures can be
 * retried, and the browser build prints instead of saving. The native save
 * is a stand-in; jsdom does not lay out or print the preview.
 */
import { createElement as h, type ContextType } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";
import { makeEvent, makeJournalEntry, makePrepItem } from "@/testing/factories";

let desktop = true;
vi.mock("@/data", async (original) => ({ ...(await original<typeof import("@/data")>()), isTauri: () => desktop }));
const saveStudyExport = vi.fn();
vi.mock("@/services/studyExport", async (original) => ({
  ...(await original<typeof import("@/services/studyExport")>()),
  saveStudyExport: (...args: unknown[]) => saveStudyExport(...args),
}));

const { LessonBriefDialog } = await import("./LessonBriefDialog");
const { StudyExportError } = await import("@/services/studyExport");

const lesson = makeEvent({ id: "lesson", title: "Pattern work", date: "2026-10-24", notes: "SENTINEL_LESSON_NOTES" });
const data = {
  ...EMPTY_DATA,
  events: [lesson],
  prepItems: [makePrepItem({ eventId: "lesson", title: "Check weather" })],
  journalEntries: [makeJournalEntry({ date: "2026-10-17", questionsForNextTime: "Crab or slip?\nFlap settings?", wentWell: "SENTINEL_WENT_WELL" })],
};

beforeEach(() => {
  desktop = true;
  saveStudyExport.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

function open(props: { open?: boolean } = {}) {
  const value = { repositories: null, data, status: "ready", error: null, mutate: async () => null, deleteWithUndo: () => undefined } as unknown as ContextType<
    typeof AppDataContext
  >;
  const element = (isOpen: boolean) => h(AppDataContext.Provider, { value }, h(LessonBriefDialog, { open: isOpen, event: lesson, onClose: () => {} }));
  const view = render(element(props.open ?? true));
  return { view, rerender: (isOpen: boolean) => view.rerender(element(isOpen)) };
}

const preview = () => screen.getByTitle("Lesson brief preview").getAttribute("srcdoc") ?? "";

function heldSave() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => (resolve = done));
  saveStudyExport.mockReturnValueOnce(promise);
  return { resolve, promise };
}

describe("Lesson brief", () => {
  it("starts with every follow-up unticked and previews only what is ticked", () => {
    open();
    const choices = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(choices.map((choice) => choice.checked)).toEqual([false, false]);
    expect(preview()).toContain("Check weather");
    expect(preview()).not.toContain("Crab or slip?");
    fireEvent.click(screen.getByLabelText(/Crab or slip\?/));
    expect(preview()).toContain("Crab or slip?");
    expect(preview()).not.toContain("Flap settings?");
    for (const sentinel of ["SENTINEL_LESSON_NOTES", "SENTINEL_WENT_WELL"]) expect(preview()).not.toContain(sentinel);
  });

  it("saves exactly the previewed page as a lesson brief", async () => {
    saveStudyExport.mockResolvedValue({ fileName: "Lesson brief.html", byteLength: 10 });
    open();
    fireEvent.click(screen.getByLabelText(/Flap settings\?/));
    const shown = preview();
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect((await screen.findByRole("status")).textContent).toBe("Saved “Lesson brief.html”.");
    expect(saveStudyExport).toHaveBeenCalledWith("brief", "Lesson brief 2026-10-24 Pattern work.html", shown);
  });

  it("dispatches one save for two clicks in the same render", async () => {
    const held = heldSave();
    open();
    const button = screen.getByRole("button", { name: "Save…" });
    try {
      act(() => {
        button.click();
        button.click();
      });
      expect(saveStudyExport).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        held.resolve(null);
        await held.promise;
      });
    }
  });

  it("keeps the choices fixed while a save is pending, so they match the page being saved", async () => {
    const held = heldSave();
    open();
    fireEvent.click(screen.getByLabelText(/Crab or slip\?/));
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    const dispatched = saveStudyExport.mock.calls[0]?.[2] as string;
    try {
      for (const choice of screen.getAllByRole("checkbox")) expect(choice.matches(":disabled")).toBe(true);
      expect(screen.getByRole("button", { name: "Saving…" }).hasAttribute("disabled")).toBe(true);
      expect(preview()).toBe(dispatched);
    } finally {
      await act(async () => {
        held.resolve(null);
        await held.promise;
      });
    }
    for (const choice of screen.getAllByRole("checkbox")) expect(choice.matches(":disabled")).toBe(false);
  });

  it("says nothing when the save dialog is cancelled", async () => {
    saveStudyExport.mockResolvedValue(null);
    open();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save…" })));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains a refused save and lets her try again", async () => {
    saveStudyExport.mockRejectedValueOnce(new StudyExportError("too_large"));
    saveStudyExport.mockResolvedValueOnce({ fileName: "retry.html", byteLength: 10 });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This export is too large to save. Choose fewer parts.");
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect((await screen.findByRole("status")).textContent).toContain("retry.html");
    expect(saveStudyExport).toHaveBeenCalledTimes(2);
  });

  it("forgets its choices when it is opened again", () => {
    const { rerender } = open();
    fireEvent.click(screen.getByLabelText(/Crab or slip\?/));
    rerender(false);
    rerender(true);
    expect((screen.getAllByRole("checkbox") as HTMLInputElement[]).every((choice) => !choice.checked)).toBe(true);
  });

  it("prints the preview in the browser build, which cannot save files", () => {
    desktop = false;
    open();
    expect(screen.queryByRole("button", { name: "Save…" })).toBeNull();
    const frame = screen.getByTitle("Lesson brief preview") as HTMLIFrameElement;
    const print = vi.fn();
    Object.defineProperty(frame.contentWindow!, "print", { value: print, configurable: true });
    fireEvent.click(screen.getByRole("button", { name: "Print…" }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(saveStudyExport).not.toHaveBeenCalled();
  });

  it("previews a page that can run nothing", () => {
    open();
    const frame = screen.getByTitle("Lesson brief preview");
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin allow-modals");
    expect(preview()).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`);
  });
});
