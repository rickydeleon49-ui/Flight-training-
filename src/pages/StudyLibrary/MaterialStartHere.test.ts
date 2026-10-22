// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AiStudySet, StudyMaterial } from "@/domain/types";
import * as documents from "@/services/documents";
import * as offline from "@/services/offlineContent";
import { MaterialStartHere } from "./MaterialStartHere";

let desktop = true;
let pages: number | null = 500;
vi.mock("@/data", () => ({ isTauri: () => desktop }));
vi.mock("@/state/navigation/useDocumentNavigation", () => ({
  useNavigationController: () => ({ repo: null, status: { kind: "idle" } }),
  useMaterialNavigation: () => ({ state: { identity: pages ? { totalPages: pages } : null } }),
}));
const material: StudyMaterial = {
  id: "handbook", title: "Synthetic handbook", originalFileName: "synthetic.pdf", filePath: "documents/synthetic.pdf",
  fileSize: Math.round(204.7 * 1024 * 1024), materialType: "study_guide", topic: "general", reviewStatus: "needs_review",
  priority: "later", goalId: null, eventId: null, notes: "", createdAt: "2026-10-21", updatedAt: "2026-10-21", lastReviewedAt: null, tags: [],
};
const saved: AiStudySet = { sourceMaterialId: material.id, title: "Saved guide", summary: "Saved", sections: [], flashcards: [], sourceNotes: "", model: "test", provider: "gemini", generatedAt: "2026-10-21", updatedAt: "2026-10-21" };
function open(overrides: Partial<Parameters<typeof MaterialStartHere>[0]> = {}) {
  return render(h(MemoryRouter, null, h(MaterialStartHere, { material, materials: [], geminiDraftWaiting: false, fileMissing: false, ...overrides })));
}
function steps() { return within(screen.getByRole("list", { name: "PDF study steps" })).getAllByRole("listitem"); }
beforeEach(() => {
  localStorage.clear(); desktop = true; pages = 500;
  vi.spyOn(offline, "offlineStudyEnabled").mockReturnValue(true);
  vi.spyOn(offline, "offlineContentReadiness").mockResolvedValue([{ materialId: material.id, readiness: { state: "notPrepared" } }]);
  vi.spyOn(documents, "listPdfStudyKitJobs").mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("guides a large unsplit PDF toward parts using the real limits", async () => {
  open();
  await act(async () => {});
  expect(steps()).toHaveLength(4);
  expect(steps()[0]!.textContent).toContain("Do this next");
  expect(steps()[0]!.textContent).toContain("204.7 MB, 500 pages");
  expect(steps()[0]!.textContent).toContain("50 MB or 1,000 pages");
  expect(steps()[0]!.textContent).toContain("Choose a study-size PDF");
  expect(steps()[1]!.textContent).toContain("Ask Gemini for a study guide");
  expect(steps()[1]!.textContent).not.toContain("study guide and flashcards");
  expect(steps()[1]!.textContent).toContain("Her Flight Deck sends this file to Google after you confirm");
  expect(steps()[1]!.textContent).not.toContain("Gemini sends this file to Google");
  expect(steps()[1]!.textContent).toContain("section by section");
  expect(steps()[1]!.textContent).not.toContain("flashcard target");
  expect(steps()[1]!.textContent).toContain("Open a study-size part first");
  expect(screen.queryByText("What's been done with this PDF")).toBeNull();
  const target = document.createElement("div"); target.id = "material-file-actions"; target.tabIndex = -1;
  target.scrollIntoView = vi.fn(); document.body.append(target);
  fireEvent.click(screen.getByRole("button", { name: "See split and open options" }));
  expect(target.scrollIntoView).toHaveBeenCalled(); expect(document.activeElement).toBe(target); target.remove();
});

it("shows saved parts in page order and links to the first part", () => {
  const part = (id: string, start: number): StudyMaterial => ({ ...material, id, title: `Part ${id}`, lineage: {
    materialId: id, rootMaterialId: material.id, parentMaterialId: null, nestedLevel: 1,
    sourcePageStart: start, sourcePageEnd: start + 9, childPageCount: 10, sourceFileName: "synthetic.pdf", sourceTitle: material.title,
    sourceContentSha256: "a".repeat(64), sourceTotalPages: 500, parentPageStart: null, parentPageEnd: null,
    parentFileName: null, parentTitle: null, parentContentSha256: null, parentTotalPages: null, createdAt: "2026-10-21",
  } });
  open({ materials: [part("2", 11), part("1", 1), { ...part("unrelated", 1), lineage: { ...part("x", 1).lineage!, rootMaterialId: "other" } }] });
  expect(steps()[0]!.textContent).toContain("Done");
  expect(screen.getByText("2 saved parts made from this PDF.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open first part: Part 1" }).getAttribute("href")).toBe("/study/1");
  expect(steps()[0]!.textContent).toContain("earlier copy");
});

it("shows text read and a kit waiting, then takes her to draft review", async () => {
  pages = 12;
  vi.mocked(offline.offlineContentReadiness).mockResolvedValue([{ materialId: material.id, readiness: { state: "searchable", pages: 12 } }]);
  vi.mocked(documents.listPdfStudyKitJobs).mockResolvedValue([{ id: "kit", materialId: material.id, stage: "received", createdAt: 1 }]);
  open({ material: { ...material, fileSize: 2048 } });
  await screen.findByText("A study kit is waiting for review.");
  expect(steps()[0]!.textContent).toContain("Done");
  expect(steps()[1]!.textContent).toContain("Do this next");
  expect(steps()[2]!.textContent).toContain("Do this next");
  expect(steps()[3]!.textContent).toContain("optional");
  expect(screen.getByText("Text read on this Mac: 12 pages.")).toBeTruthy();
  const target = document.createElement("div"); target.id = "material-pdf-kit"; target.scrollIntoView = vi.fn(); document.body.append(target);
  fireEvent.click(screen.getByRole("button", { name: "Go to draft review" })); expect(target.scrollIntoView).toHaveBeenCalled(); target.remove();
});

it("does not show a guide or request PDF status for a non-PDF material", () => {
  open({ material: { ...material, filePath: "documents/note.txt", originalFileName: "note.txt" } });
  expect(screen.queryByRole("heading", { name: "Start here" })).toBeNull();
  expect(documents.listPdfStudyKitJobs).not.toHaveBeenCalled(); expect(offline.offlineContentReadiness).not.toHaveBeenCalled();
});

it("remembers hide and show for this viewer across material visits", () => {
  const first = open(); fireEvent.click(screen.getByRole("button", { name: "Hide tips" }));
  expect(screen.queryByRole("list", { name: "PDF study steps" })).toBeNull(); first.unmount();
  const second = open({ material: { ...material, id: "another" } });
  expect(screen.getByRole("button", { name: "Show tips" }).getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Show tips" })); expect(steps()).toHaveLength(4); second.unmount();
  open(); expect(screen.getByRole("button", { name: "Hide tips" }).getAttribute("aria-expanded")).toBe("true");
});

it("keeps hide and show usable when localStorage reads and writes throw", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  const uncaught = vi.fn((event: ErrorEvent) => event.preventDefault());
  window.addEventListener("error", uncaught);
  try {
    open(); expect(steps()).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Hide tips" })); expect(screen.queryByRole("list", { name: "PDF study steps" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show tips" })); expect(steps()).toHaveLength(4);
    expect(uncaught).not.toHaveBeenCalled();
  } finally { window.removeEventListener("error", uncaught); }
});

it("explains desktop-only steps in browser mode without calling native services", () => {
  desktop = false; open();
  expect(screen.getAllByText(/Works in the desktop app/)).toHaveLength(3);
  for (const button of screen.getAllByRole("button").filter(b => b.textContent !== "Hide tips")) expect(button.hasAttribute("disabled")).toBe(true);
  expect(offline.offlineContentReadiness).not.toHaveBeenCalled(); expect(documents.listPdfStudyKitJobs).not.toHaveBeenCalled();
});

it("reports partial reading honestly and distinguishes running or cancelled kits from review", async () => {
  vi.mocked(offline.offlineContentReadiness).mockResolvedValue([{ materialId: material.id, readiness: { state: "partial", pages: 12, searchable: 8, imagePages: 4, reason: "imagePages" } }]);
  vi.mocked(documents.listPdfStudyKitJobs).mockResolvedValue([{ id: "cancelled", materialId: material.id, stage: "cancelled", createdAt: 2 }, { id: "running", materialId: material.id, stage: "running", createdAt: 1 }]);
  const view = open({ material: { ...material, fileSize: 2048 } });
  await screen.findByText("Text read on this Mac: 8 of 12 pages.");
  expect(steps()[1]!.textContent).toContain("Do this next");
  expect(steps()[2]!.textContent).toContain("Ask for a guide first");
  view.unmount();
  vi.mocked(documents.listPdfStudyKitJobs).mockResolvedValue([{ id: "cancelled", materialId: material.id, stage: "cancelled", createdAt: 2 }]);
  open({ material: { ...material, fileSize: 2048 } });
  await act(async () => {});
  expect(steps()[1]!.textContent).toContain("Do this next");
});

it("shows a saved Gemini guide and leaves a new draft ready to review", async () => {
  open({ studySet: saved, geminiDraftWaiting: true, material: { ...material, fileSize: 2048 } });
  await screen.findByText("Gemini guide saved."); expect(screen.getByText("A Gemini draft is waiting for review.")).toBeTruthy();
  expect(steps()[1]!.textContent).toContain("Done");
  expect(steps()[2]!.textContent).toContain("Do this next");
});

it("refreshes panel work and ignores a retired file's late answer", async () => {
  vi.useFakeTimers();
  let finish!: (value: Awaited<ReturnType<typeof offline.offlineContentReadiness>>) => void;
  vi.mocked(offline.offlineContentReadiness).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = open();
  view.rerender(h(MemoryRouter, null, h(MaterialStartHere, { material: { ...material, fileSize: 1024, updatedAt: "new" }, materials: [], geminiDraftWaiting: false, fileMissing: false })));
  await act(async () => {});
  await act(async () => finish([{ materialId: material.id, readiness: { state: "searchable", pages: 500 } }]));
  expect(screen.queryByText("Text read on this Mac: 500 pages.")).toBeNull();
  vi.mocked(offline.offlineContentReadiness).mockResolvedValue([{ materialId: material.id, readiness: { state: "searchable", pages: 12 } }]);
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(screen.getByText("Text read on this Mac: 12 pages.")).toBeTruthy();
  // The retired request must not start another polling loop after unmount.
  expect(offline.offlineContentReadiness).toHaveBeenCalledTimes(3);
});

it("uses page count as well as bytes when recommending a split", async () => {
  pages = 1001; open({ material: { ...material, fileSize: 1024 } });
  await screen.findByText(/Open a study-size part first/);
  expect(steps()[0]!.textContent).toContain("Do this next");
  expect(steps()[0]!.textContent).toContain("1,001 pages");
});

it("accepts the exact Gemini limits and recommends parts above them", async () => {
  pages = 1000;
  const view = open({ material: { ...material, fileSize: 50 * 1024 * 1024 } });
  expect(steps()[0]!.textContent).toContain("Done"); view.unmount();
  open({ material: { ...material, fileSize: 128 * 1024 * 1024 } });
  await waitFor(() => expect(steps()[1]!.textContent).toContain("Open a study-size part first"));
  expect(within(steps()[1]!).getByRole("button").hasAttribute("disabled")).toBe(false);
});

it("explains missing files and keeps Gemini available when backup text reading is unavailable", async () => {
  const first = open({ fileMissing: true });
  expect(steps()[1]!.textContent).toContain("Restore this PDF's file first");
  expect(within(steps()[0]!).getByRole("button").hasAttribute("disabled")).toBe(true); first.unmount();
  vi.mocked(offline.offlineStudyEnabled).mockReturnValue(false);
  open({ material: { ...material, fileSize: 1024 } });
  await act(async () => {});
  expect(steps()[1]!.textContent).toContain("Do this next");
  expect(within(steps()[1]!).getByRole("button").hasAttribute("disabled")).toBe(false);
});

it("does not turn failed status reads into done or a kit waiting for review", async () => {
  vi.mocked(offline.offlineContentReadiness).mockRejectedValue(new Error("unavailable"));
  vi.mocked(documents.listPdfStudyKitJobs).mockRejectedValue(new Error("unavailable"));
  open({ material: { ...material, fileSize: 1024 } });
  await act(async () => {});
  expect(steps()[1]!.textContent).toContain("Do this next");
  expect(steps()[2]!.textContent).toContain("Ask for a guide first");
  expect(screen.queryByText("What's been done with this PDF")).toBeNull();
});


it("links the backup and optional practice step to their sections", async () => {
  open({ material: { ...material, fileSize: 2048 }, practiceTestSaved: true });
  expect(steps()[3]!.textContent).toContain("Done");
  for (const [id, name] of [["material-mac-backup", "Use the on-Mac study kit at the bottom of this page."], ["material-practice-test", "Go to practice test"]]) {
    const target = document.createElement("section"); target.id = id!; target.tabIndex = -1; target.scrollIntoView = vi.fn(); document.body.append(target);
    if (id === "material-mac-backup") {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe("#material-mac-backup"); fireEvent.click(link);
    } else fireEvent.click(screen.getByRole("button", { name }));
    expect(target.scrollIntoView).toHaveBeenCalled(); expect(document.activeElement).toBe(target); target.remove();
  }
});

it("takes a Gemini draft to Gemini review even when a backup kit also waits", async () => {
  vi.mocked(documents.listPdfStudyKitJobs).mockResolvedValue([{ id: "kit", materialId: material.id, stage: "received", createdAt: 1 }]);
  open({ material: { ...material, fileSize: 2048 }, geminiDraftWaiting: true });
  await screen.findByText("A study kit is waiting for review.");
  const target = document.createElement("div"); target.id = "material-study-guide"; target.scrollIntoView = vi.fn(); document.body.append(target);
  fireEvent.click(screen.getByRole("button", { name: "Go to draft review" })); expect(target.scrollIntoView).toHaveBeenCalled(); target.remove();
});
