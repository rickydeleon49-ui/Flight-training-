import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { deviceCan } from "./platform";
import { renderPdfPage } from "./visualPdf";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./platform", () => ({ deviceCan: vi.fn() }));
afterEach(() => vi.resetAllMocks());
it("requests one physical page at the bounded native size and returns the capture", async () => {
  vi.mocked(deviceCan).mockReturnValue({ renderPdfPage: true } as ReturnType<typeof deviceCan>);
  const capture = { materialId: "picture", source: { materialId: "pdf", physicalPage: 3 } };
  vi.mocked(invoke).mockResolvedValue(capture);
  expect(await renderPdfPage("pdf", 3)).toBe(capture);
  expect(invoke).toHaveBeenCalledWith("render_pdf_page", { materialId: "pdf", pageIndex: 3, maxPx: 2048 });
});
it("refuses before IPC when this device cannot render a page", async () => {
  vi.mocked(deviceCan).mockReturnValue({ renderPdfPage: false } as ReturnType<typeof deviceCan>);
  await expect(renderPdfPage("pdf", 3)).rejects.toThrow("Only on the Mac");
  expect(invoke).not.toHaveBeenCalled();
});
