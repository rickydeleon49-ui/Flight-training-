// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PdfViewerDialog } from "./PdfViewerDialog";
import { closePdfViewer, openInAppViewer } from "@/services/pdfViewer";
afterEach(() => { cleanup(); closePdfViewer(); vi.unstubAllGlobals(); });
function setup() {
  const revoke = vi.fn();
  vi.stubGlobal("URL", { revokeObjectURL: revoke });
  return revoke;
}
it("shows the material title and iframe, revoking its URL on close", async () => {
  const revoke = setup();
  render(<PdfViewerDialog />);
  await act(() => openInAppViewer("Synthetic handbook", async () => "blob:pdf"));
  expect(screen.getByTitle("Synthetic handbook").getAttribute("src")).toBe("blob:pdf");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByTitle("Synthetic handbook")).toBeNull();
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:pdf");
});
it("revokes on unmount and replacement", async () => {
  const revoke = setup();
  const view = render(<PdfViewerDialog />);
  await act(() => openInAppViewer("One", async () => "blob:one"));
  await act(() => openInAppViewer("Two", async () => "blob:two"));
  expect(revoke).toHaveBeenCalledWith("blob:one");
  view.unmount();
  expect(revoke).toHaveBeenCalledWith("blob:two");
});
it("shows Opening and discards a read completed after closing", async () => {
  const revoke = setup();
  render(<PdfViewerDialog />);
  let resolve!: (url: string) => void;
  let opening!: Promise<void>;
  act(() => { opening = openInAppViewer("Slow", () => new Promise(r => { resolve = r; })); });
  expect(screen.getByRole("status").textContent).toBe("Opening…");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await act(async () => { resolve("blob:late"); await opening; });
  expect(revoke).toHaveBeenCalledWith("blob:late");
  expect(screen.queryByTitle("Slow")).toBeNull();
});
it("shows a calm error when the read fails", async () => {
  setup(); render(<PdfViewerDialog />);
  await act(() => openInAppViewer("Failed", async () => { throw new Error("private path"); }));
  expect(screen.getByRole("alert").textContent).toBe("That PDF could not be opened. Please try again.");
});
