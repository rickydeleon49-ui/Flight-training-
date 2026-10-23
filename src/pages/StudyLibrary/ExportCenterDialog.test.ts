// @vitest-environment jsdom
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import type { AiStudySet, PracticeTest } from "@/domain/types";
import type { ExportSource } from "@/logic/studyExport";

const saveStudyExport = vi.fn();
vi.mock("@/services/studyExport", async (original) => ({
  ...(await original<typeof import("@/services/studyExport")>()),
  saveStudyExport: (...args: unknown[]) => saveStudyExport(...args),
}));

const { ExportCenterDialog } = await import("./ExportCenterDialog");

const set: AiStudySet = {
  sourceMaterialId: "one",
  title: "Weather",
  summary: "Weather summary",
  sections: [{ heading: "METARs", body: "Read the station code." }],
  flashcards: [{ front: "BKN?", back: "Broken", sourcePage: 12 }],
  sourceNotes: "",
  provider: "gemini",
  model: "gemini-3.5-flash",
  generatedAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-01T10:00:00Z",
};
const test: PracticeTest = {
  sourceMaterialId: "one",
  title: "Weather practice",
  questions: [{ question: "Which is a ceiling?", options: ["Few", "Broken"], correctIndex: 1, explanation: "Broken layers are ceilings.", sourcePage: null }],
  provider: "gemini",
  model: "gemini-3.5-flash",
  generatedAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-01T10:00:00Z",
};

const sources: ExportSource[] = [
  { material: { title: "Aviation Weather" }, studySet: set, practiceTest: test },
  { material: { title: "Crosswind" }, studySet: { ...set, sourceMaterialId: "two", summary: "Crosswind summary", sections: [], flashcards: [] }, practiceTest: null },
];

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  saveStudyExport.mockReset();
});
afterEach(cleanup);

const open = (items = sources) => render(h(ExportCenterDialog, { open: true, sources: items, onClose: () => {} }));

describe("Study Library export center", () => {
  it("saves selected materials in order with the chosen parts", async () => {
    saveStudyExport.mockResolvedValue({ fileName: "Study handout.html", byteLength: 10 });
    open();
    fireEvent.click(within(screen.getByRole("region", { name: "Aviation Weather" })).getByLabelText(/Study guide/));
    fireEvent.click(screen.getByRole("button", { name: "Save handout…" }));
    const [, , html] = saveStudyExport.mock.calls[0] as [string, string, string];
    expect(html.indexOf("Aviation Weather")).toBeLessThan(html.indexOf("Crosswind"));
    expect(html).not.toContain("METARs");
    expect(html).toContain("BKN?");
    expect(html).toContain("Crosswind summary");
    expect((await screen.findByRole("status")).textContent).toContain("Saved");
  });

  it("leaves corrections out by default and includes them only when chosen", () => {
    saveStudyExport.mockResolvedValue({ fileName: "Study handout.html", byteLength: 10 });
    const corrected = {
      ...sources[0]!,
      studySet: { ...set, sections: [...set.sections, { heading: "Private instructor note", body: "Use right rudder.", origin: "instructor" as const }] },
    };
    open([corrected]);
    fireEvent.click(screen.getByRole("button", { name: "Save handout…" }));
    const [, , excluded] = saveStudyExport.mock.calls[0] as [string, string, string];
    expect(excluded).not.toContain("Private instructor note");
    saveStudyExport.mockClear();
    cleanup();
    open([corrected]);
    fireEvent.click(screen.getByLabelText(/Include instructor corrections/));
    fireEvent.click(screen.getByRole("button", { name: "Save handout…" }));
    const [, , included] = saveStudyExport.mock.calls[0] as [string, string, string];
    expect(included).toContain("Private instructor note");
  });

  it("omits answer and explanation data when the answer key is turned off", () => {
    open([sources[0]!]);
    fireEvent.click(screen.getByLabelText(/Add one answer key at the end/));
    fireEvent.click(screen.getByRole("button", { name: "Save handout…" }));
    const [, , html] = saveStudyExport.mock.calls[0] as [string, string, string];
    expect(html).not.toContain("Broken layers are ceilings.");
    expect(html).not.toContain("class=\"answer-key\"");
  });

  it("disables saving when there are no sources and reports save failures", async () => {
    const empty = open([]);
    expect(screen.getByRole("button", { name: "Save handout…" }).hasAttribute("disabled")).toBe(true);
    empty.unmount();
    saveStudyExport.mockRejectedValueOnce(new Error("write failed"));
    open([sources[0]!]);
    fireEvent.click(screen.getByRole("button", { name: "Save handout…" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Nothing was changed");
  });
});
