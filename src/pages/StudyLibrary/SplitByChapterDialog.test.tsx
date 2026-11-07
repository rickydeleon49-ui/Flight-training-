// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StudyMaterial } from "@/domain/types";
import * as pdf from "@/services/pdf";
import { SOURCE_LINES, SplitByChapterDialog, useChapterChoice } from "./SplitByChapterDialog";
import * as splitSave from "./splitSave";

vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ mutate: vi.fn(), repositories: null, refresh: vi.fn() }),
}));

const material = { id: "m1", title: "Book", filePath: "documents/book.pdf", originalFileName: "book.pdf" } as StudyMaterial;
const chapters = [
  { title: "Front pages", firstPage: 1, lastPage: 4 },
  { title: "Weather", firstPage: 5, lastPage: 20 },
  { title: "Maps", firstPage: 21, lastPage: 30 },
];
const outline = (source: "outline" | "text" | "chunks" = "outline"): pdf.PdfChapters => ({
  pages: 30,
  chapters,
  chapterSource: source,
});
const receipt = {
  core: { plan: [{ id: "p1", selection: { start: 5, end: 20 } }] },
  receiptHash: "h",
  operationId: "op",
} as never;

const setup = (source: "outline" | "text" | "chunks" = "outline") => {
  const onCreated = vi.fn();
  render(<SplitByChapterDialog open material={material} outline={outline(source)} onClose={vi.fn()} onCreated={onCreated} />);
  return onCreated;
};
const save = () => screen.getByRole("button", { name: /Save chapters|Saving chapters/ }) as HTMLButtonElement;
const first = (title: string) => screen.getByLabelText(`First page of ${title}`) as HTMLInputElement;
const last = (title: string) => screen.getByLabelText(`Last page of ${title}`) as HTMLInputElement;

beforeEach(() => {
  vi.spyOn(splitSave, "saveSplitParts").mockResolvedValue({ saved: true, ids: ["x"] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(["outline", "text", "chunks"] as const)("shows all chapters checked with the %s line", (source) => {
  setup(source);
  expect(screen.getByText(SOURCE_LINES[source])).toBeTruthy();
  const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
  expect(boxes).toHaveLength(3);
  expect(boxes.every((box) => box.checked)).toBe(true);
  expect(first("Weather").value).toBe("5");
  expect(last("Weather").value).toBe("20");
});

it("sends exactly the checked ranges once", async () => {
  const spy = vi.spyOn(pdf, "splitPdfRanges").mockResolvedValue(receipt);
  const onCreated = setup();
  fireEvent.click(screen.getAllByRole("checkbox")[0]!);
  fireEvent.change(last("Maps"), { target: { value: "28" } });
  fireEvent.click(save());
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(["x"]));
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0]![0]).toMatchObject({
    relativePath: "documents/book.pdf",
    sourceMaterialId: "m1",
    ranges: [
      { firstPage: 5, lastPage: 20, title: "Weather" },
      { firstPage: 21, lastPage: 28, title: "Maps" },
    ],
  });
});

it("flags overlap, reversed and out-of-book rows and disables Save", () => {
  setup();
  fireEvent.change(first("Maps"), { target: { value: "20" } });
  expect(screen.getByText(/also used by "Weather"/)).toBeTruthy();
  expect(save().disabled).toBe(true);
  fireEvent.change(first("Maps"), { target: { value: "21" } });
  expect(save().disabled).toBe(false);
  fireEvent.change(first("Maps"), { target: { value: "29" } });
  fireEvent.change(last("Maps"), { target: { value: "25" } });
  expect(screen.getByText(/comes after the last page/)).toBeTruthy();
  expect(save().disabled).toBe(true);
  fireEvent.change(first("Maps"), { target: { value: "21" } });
  fireEvent.change(last("Maps"), { target: { value: "31" } });
  expect(screen.getByText(/only 30 pages/)).toBeTruthy();
  expect(save().disabled).toBe(true);
});

it("shows the native error as-is and saves nothing", async () => {
  vi.spyOn(pdf, "splitPdfRanges").mockRejectedValue(new Error("Page 7 is too large"));
  setup();
  fireEvent.click(save());
  expect(await screen.findByText("Page 7 is too large")).toBeTruthy();
  expect(splitSave.saveSplitParts).not.toHaveBeenCalled();
});

it.each([
  [false, /nothing was changed/],
  [true, /restart the app/],
] as const)("tells her plainly when saving fails (cleanup failed: %s)", async (cleanupFailed, message) => {
  vi.spyOn(pdf, "splitPdfRanges").mockResolvedValue(receipt);
  vi.spyOn(splitSave, "saveSplitParts").mockResolvedValue({ saved: false, cleanupFailed });
  const onCreated = setup();
  fireEvent.click(save());
  await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
  expect(onCreated).not.toHaveBeenCalled();
});

it("blocks a second save while busy", async () => {
  let finish: (value: never) => void = () => {};
  const spy = vi.spyOn(pdf, "splitPdfRanges").mockReturnValue(new Promise((resolve) => { finish = resolve as never; }));
  setup();
  fireEvent.click(save());
  await waitFor(() => expect(save().textContent).toBe("Saving chapters…"));
  expect(save().disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(save());
  expect(spy).toHaveBeenCalledTimes(1);
  finish(receipt);
  await waitFor(() => expect(splitSave.saveSplitParts).toHaveBeenCalled());
});

it("offers no chapter choice when chapters are absent", async () => {
  vi.spyOn(pdf, "detectPdfChapters").mockResolvedValue({ pages: 30, chapters: [], chapterSource: "chunks" });
  const unavailable = vi.fn();
  const { result } = renderHook(() => useChapterChoice(material.filePath, true, unavailable));
  await waitFor(() => expect(unavailable).toHaveBeenCalledWith(expect.stringContaining("No chapters")));
  expect(result.current).toBeNull();
  const off = renderHook(() => useChapterChoice(material.filePath, false));
  expect(off.result.current).toBeNull();
});

it("does not read the PDF until she asks", () => {
  const spy = vi.spyOn(pdf, "detectPdfChapters").mockResolvedValue(outline());
  renderHook(() => useChapterChoice(material.filePath, false));
  expect(spy).not.toHaveBeenCalled();
});

it("offers the choice when chapters exist", async () => {
  vi.spyOn(pdf, "detectPdfChapters").mockResolvedValue(outline());
  const { result } = renderHook(() => useChapterChoice(material.filePath, true));
  await waitFor(() => expect(result.current).not.toBeNull());
});
