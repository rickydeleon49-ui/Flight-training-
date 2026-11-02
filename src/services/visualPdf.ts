import { invoke } from "@tauri-apps/api/core";
import type { PageSource } from "@/data/studyPageSources";
import { deviceCan } from "./platform";

export interface PageCapture {
  materialId: string;
  source: PageSource;
  imageSha256: string;
  imageWidth: number;
  imageHeight: number;
}

export async function renderPdfPage(materialId: string, pageIndex: number): Promise<PageCapture> {
  if (!deviceCan().renderPdfPage) throw Error("Only on the Mac");
  return invoke("render_pdf_page", { materialId, pageIndex, maxPx: 2048 });
}
