// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as pdf from "@/services/pdf";
import { SCANNED_PDF_LINE, ScannedPdfLine, ScannedPdfNote, resetScannedPdfCache } from "./ScannedPdfNote";

afterEach(() => { cleanup(); vi.restoreAllMocks(); resetScannedPdfCache(); });

it("shows the line only when flagged", () => {
  const { rerender } = render(<ScannedPdfLine flagged={false} />);
  expect(screen.queryByText(SCANNED_PDF_LINE)).toBeNull();
  rerender(<ScannedPdfLine flagged />);
  expect(screen.getByText(SCANNED_PDF_LINE)).toBeTruthy();
});

it("asks the PDF and shows the line for a picture-only PDF", async () => {
  vi.spyOn(pdf, "inspectPdf").mockResolvedValue({ pages: 9, maxPagesPerSplit: 1000, mostlyPictures: true });
  render(<ScannedPdfNote filePath="documents/a.pdf" />);
  await waitFor(() => expect(screen.getByText(SCANNED_PDF_LINE)).toBeTruthy());
});

it("stays quiet for a text PDF, old data and failures", async () => {
  const spy = vi.spyOn(pdf, "inspectPdf").mockResolvedValue({ pages: 9, maxPagesPerSplit: 1000 });
  render(<ScannedPdfNote filePath="documents/a.pdf" />);
  await waitFor(() => expect(spy).toHaveBeenCalled());
  spy.mockRejectedValue(new Error("x"));
  cleanup();
  render(<ScannedPdfNote filePath="documents/b.pdf" />);
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(SCANNED_PDF_LINE)).toBeNull();
});

it("checks each file only once per session", async () => {
  const spy = vi.spyOn(pdf, "inspectPdf").mockResolvedValue({ pages: 9, maxPagesPerSplit: 1000, mostlyPictures: true });
  const first = render(<ScannedPdfNote filePath="documents/once.pdf" />);
  expect(await screen.findByText(SCANNED_PDF_LINE)).toBeTruthy();
  first.unmount();
  render(<ScannedPdfNote filePath="documents/once.pdf" />);
  expect(await screen.findByText(SCANNED_PDF_LINE)).toBeTruthy();
  expect(spy).toHaveBeenCalledTimes(1);
});
