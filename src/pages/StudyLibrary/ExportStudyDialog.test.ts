// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiStudySet, PracticeTest } from "@/domain/types";
import { validatePacketText } from "@/logic/studyPacket";
import { DesktopOnlyError } from "@/services/documents";
import { makeMaterial } from "@/testing/factories";

const saveStudyExport = vi.fn();
vi.mock("@/services/studyExport", async (original) => ({
  ...(await original<typeof import("@/services/studyExport")>()),
  saveStudyExport: (...args: unknown[]) => saveStudyExport(...args),
}));

const { ExportStudyDialog, EXPORT_DESKTOP_ONLY } = await import("./ExportStudyDialog");
const { StudyExportError } = await import("@/services/studyExport");

const set: AiStudySet = {
  sourceMaterialId: "m",
  title: "Weather",
  summary: "Summary",
  sections: [{ heading: "METARs", body: "- Station\n- Time" }],
  flashcards: [{ front: "BKN?", back: "Broken", sourcePage: null }],
  sourceNotes: "",
  provider: "gemini",
  model: "gemini-3.5-flash",
  generatedAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-01T10:00:00Z",
};
const test: PracticeTest = {
  sourceMaterialId: "m",
  title: "Practice",
  questions: [{ question: "Ceiling?", options: ["Few", "Broken"], correctIndex: 1, explanation: "Broken is.", sourcePage: null }],
  provider: "gemini",
  model: "gemini-3.5-flash",
  generatedAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-01T10:00:00Z",
};
const source = { material: makeMaterial({ title: "Aviation Weather" }), studySet: set, practiceTest: test };

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  saveStudyExport.mockReset();
});
afterEach(cleanup);

const open = () => render(h(ExportStudyDialog, { open: true, source, onClose: () => {} }));

describe("Share or print", () => {
  it("saves a handout with the chosen parts and an answer key by default", async () => {
    saveStudyExport.mockResolvedValue({ fileName: "Aviation Weather.html", byteLength: 10 });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    await screen.findByText("Saved “Aviation Weather.html”.");
    const [kind, name, contents] = saveStudyExport.mock.calls[0] as [string, string, string];
    expect(kind).toBe("handout");
    expect(name).toBe("Aviation Weather.html");
    expect(contents).toContain('class="answer-key"');
    expect(contents).toContain("Practice questions");
  });

  it("saves a study packet that the import accepts", async () => {
    saveStudyExport.mockResolvedValue({ fileName: "Aviation Weather.json", byteLength: 10 });
    open();
    fireEvent.click(screen.getByLabelText(/Study packet \(\.json\)/));
    fireEvent.click(screen.getByLabelText(/^Flashcards/));
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    await screen.findByText("Saved “Aviation Weather.json”.");
    const [kind, name, contents] = saveStudyExport.mock.calls[0] as [string, string, string];
    expect(kind).toBe("packet");
    expect(name).toBe("Aviation Weather.json");
    const validation = validatePacketText(contents);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.payload.studySet?.flashcards).toEqual([]);
      expect(validation.payload.practiceTest?.questions).toHaveLength(1);
    }
  });

  it("says nothing when she cancels the save dialog", async () => {
    saveStudyExport.mockResolvedValue(null);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save…" }).hasAttribute("disabled")).toBe(false));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains a failed save", async () => {
    saveStudyExport.mockRejectedValue(new StudyExportError("write_failed"));
    open();
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Nothing was changed");
  });

  it("explains that saving needs the desktop app", async () => {
    saveStudyExport.mockRejectedValue(new DesktopOnlyError());
    open();
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect((await screen.findByRole("alert")).textContent).toBe(EXPORT_DESKTOP_ONLY);
  });

  it("can't save with nothing chosen", () => {
    open();
    for (const label of [/^Study guide/, /^Flashcards/, /^Practice questions/]) fireEvent.click(screen.getByLabelText(label));
    expect(screen.getByRole("button", { name: "Save…" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows a packet refusal without opening the save dialog", async () => {
    const leaked = { ...source, studySet: { ...set, summary: `AIza${"B".repeat(35)}` } };
    render(h(ExportStudyDialog, { open: true, source: leaked, onClose: () => {} }));
    fireEvent.click(screen.getByLabelText(/Study packet \(\.json\)/));
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect((await screen.findByRole("alert")).textContent).toContain("looks like a password or access key");
    expect(saveStudyExport).not.toHaveBeenCalled();
  });
});
