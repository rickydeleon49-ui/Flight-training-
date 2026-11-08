// @vitest-environment jsdom
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { AiStudySet, PracticeTest } from "@/domain/types";
import type { ExportSource } from "@/logic/studyExport";

const saveStudyExport = vi.fn();
vi.mock("@/services/studyExport", async (original) => ({
  ...(await original<typeof import("@/services/studyExport")>()),
  saveStudyExport: (...args: unknown[]) => saveStudyExport(...args),
}));

const packMocks = vi.hoisted(() => ({ native: true, choose: vi.fn(), exportPack: vi.fn() }));
vi.mock("@/data/studyPack", async (original) => ({
  ...(await original<typeof import("@/data/studyPack")>()),
  studyPacksAvailable: () => packMocks.native,
  chooseStudyPackDestination: packMocks.choose,
  exportStudyPack: packMocks.exportPack,
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
  it("opens a material shortcut with CSV and its material selected", () => {
    render(h(ExportCenterDialog, {open: true, sources: [sources[0]!], initialOutput: "csv", onClose: () => {}}));
    expect((screen.getByLabelText("Export cards (CSV)") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", {name:"Aviation Weather"}) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText("Crosswind")).toBeNull();
    expect(screen.getByRole("button", {name:"Save CSV…"}).hasAttribute("disabled")).toBe(false);
  });

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

  it("saves selected flashcards as CSV with safe-cell disclosure and correction filtering", () => {
    saveStudyExport.mockResolvedValue({ fileName: "Flashcards.csv", byteLength: 120 });
    const first: ExportSource = {
      ...sources[0]!,
      studySet: {
        ...set,
        flashcards: [
          { front: "=1+1", back: "Formula front", sourcePage: 3 },
          { front: "Instructor card", back: "Private correction", sourcePage: 4, origin: "instructor" },
        ],
      },
    };
    const second: ExportSource = {
      ...sources[1]!,
      studySet: { ...set, sourceMaterialId: "two", title: "Crosswind", flashcards: [{ front: "Crosswind card", back: "Second material", sourcePage: 9 }] },
    };
    open([first, second]);
    fireEvent.click(screen.getByLabelText("Export cards (CSV)"));
    expect(screen.getByText(/leading apostrophe for safety/).textContent).toContain("Some flashcard importers may show it.");
    fireEvent.click(screen.getByRole("button", { name: "Save CSV…" }));

    const [kind, fileName, csv] = saveStudyExport.mock.calls[0] as [string, string, string];
    expect(kind).toBe("csv");
    expect(fileName).toMatch(/\.csv$/);
    expect(csv.indexOf("'" + '"=1+1"')).toBeLessThan(csv.indexOf('"Crosswind card"'));
    expect(csv).toContain('"Aviation Weather"');
    expect(csv).toContain('"Crosswind"');
    expect(csv).not.toContain("Private correction");
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

it("on the phone saves cards CSV into Files with no ellipsis", async () => {
  const platform = await import("@/services/platform");
  const spy = vi.spyOn(platform, "deviceCan").mockReturnValue({ ...platform.deviceCan(), sharePrint: true, editStudyMaterial: true, revealFiles: false, splitFiles: false });
  try {
    saveStudyExport.mockResolvedValue({ fileName: "Flashcards.csv", byteLength: 120, inFiles: true });
    render(h(ExportCenterDialog, { open: true, sources: [sources[0]!], initialOutput: "csv", onClose: () => {} }));
    expect(screen.queryByRole("button", { name: "Save CSV…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save CSV" }));
    expect(await screen.findByText("Saved in Files → Your Flight Deck → Exports → Flashcards.csv.")).toBeTruthy();
  } finally { spy.mockRestore(); }
});

describe("Share a study pack", () => {
    const mat = (id: string, root: string | null = null) => ({ id, title: id === "book" ? "Big Book" : id, lineage: root ? { materialId: id, rootMaterialId: root } : null }) as never;
    const library = [mat("book"), mat("c1", "book"), mat("c2", "book"), mat("solo")];
    const openPack = () => render(h(ExportCenterDialog, { open: true, sources, materials: library, onClose: () => {} }));

    beforeEach(() => {
      packMocks.native = true;
      packMocks.choose.mockReset().mockResolvedValue("/dest/p.hfdpack");
      packMocks.exportPack.mockReset().mockResolvedValue({});
    });

    it("is not offered on the web build or without a library", () => {
      packMocks.native = false;
      openPack();
      expect(screen.queryByLabelText("Share a study pack")).toBeNull();
    });

    it("lists books with their chapters, has Select all, and needs a choice before saving", () => {
      openPack();
      fireEvent.click(screen.getByLabelText("Share a study pack"));
      expect(screen.getByRole("list", { name: "Chapters of Big Book" }).textContent).toContain("c1");
      expect(screen.getByText(/with its 2 chapters/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Save study pack…" }).hasAttribute("disabled")).toBe(true);
    });

    it("choosing a split book exports the book and every chapter", async () => {
      openPack();
      fireEvent.click(screen.getByLabelText("Share a study pack"));
      fireEvent.click(screen.getByRole("checkbox", { name: /Big Book/ }));
      fireEvent.click(screen.getByRole("button", { name: "Save study pack…" }));
      await screen.findByText("Your study pack is saved.");
      expect(packMocks.exportPack).toHaveBeenCalledWith("/dest/p.hfdpack", ["book", "c1", "c2"]);
    });

    it("Select all chooses every book and loose item", async () => {
      openPack();
      fireEvent.click(screen.getByLabelText("Share a study pack"));
      fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
      fireEvent.click(screen.getByRole("button", { name: "Save study pack…" }));
      await screen.findByText("Your study pack is saved.");
      expect(packMocks.exportPack.mock.calls[0]![1]).toEqual(["book", "c1", "c2", "solo"]);
    });

    it("Select all works for a large library, and deselecting a book drops its chapters", async () => {
      const big = [mat("bigbook"), ...Array.from({ length: 100 }, (_, i) => mat(`bc${i}`, "bigbook")), ...Array.from({ length: 111 }, (_, i) => mat(`pdf${i}`))];
      expect(big).toHaveLength(212);
      render(h(ExportCenterDialog, { open: true, sources, materials: big, onClose: () => {} }));
      fireEvent.click(screen.getByLabelText("Share a study pack"));
      fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
      fireEvent.click(screen.getByRole("button", { name: "Save study pack…" }));
      await screen.findByText("Your study pack is saved.");
      expect(packMocks.exportPack.mock.calls[0]![1]).toHaveLength(212);
      fireEvent.click(screen.getByRole("checkbox", { name: /bigbook/ }));
      fireEvent.click(screen.getByRole("button", { name: "Save study pack…" }));
      await waitFor(() => expect(packMocks.exportPack).toHaveBeenCalledTimes(2));
      const second = packMocks.exportPack.mock.calls[1]![1] as string[];
      expect(second).toHaveLength(111);
      expect(second.some((id) => id === "bigbook" || id.startsWith("bc"))).toBe(false);
    });

    it("leaves out materials with nothing to share, and Select all skips them", async () => {
      render(h(ExportCenterDialog, { open: true, sources, materials: library, packEligibleIds: new Set(["book", "c1", "c2"]), onClose: () => {} }));
      fireEvent.click(screen.getByLabelText("Share a study pack"));
      expect(screen.queryByRole("checkbox", { name: /solo/ })).toBeNull();
      fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
      fireEvent.click(screen.getByRole("button", { name: "Save study pack…" }));
      await screen.findByText("Your study pack is saved.");
      expect(packMocks.exportPack.mock.calls[0]![1]).toEqual(["book", "c1", "c2"]);
    });

    it("saves nothing when she cancels the save dialog, and shows an export sentence plainly", async () => {
      openPack();
      fireEvent.click(screen.getByLabelText("Share a study pack"));
      fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
      packMocks.choose.mockResolvedValueOnce(null);
      fireEvent.click(screen.getByRole("button", { name: "Save study pack…" }));
      await waitFor(() => expect(packMocks.choose).toHaveBeenCalled());
      expect(packMocks.exportPack).not.toHaveBeenCalled();
      packMocks.exportPack.mockRejectedValueOnce("That is too many items for one study pack.");
      fireEvent.click(screen.getByRole("button", { name: "Save study pack…" }));
      expect((await screen.findByRole("alert")).textContent).toBe("That is too many items for one study pack.");
    });
  });
