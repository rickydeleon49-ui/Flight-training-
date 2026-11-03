import { isIOS } from "./platform";
import { invoke } from "@tauri-apps/api/core";

/** Native owns the PDF and its private snapshot until Done. Errors reach the caller's notice. */
export async function openNativePdf(materialId?: string): Promise<void> {
  if (!materialId) throw new Error("That PDF could not be opened. Please reopen it from your library.");
  try {
    await invoke("open_ios_pdf", { materialId });
  } catch {
    throw new Error("That PDF could not be opened. Please try again or import another copy.");
  }
}

/** Only a completed verified iOS jump gets page-success wording. */
export function openedPageMessage(page: number, desktopGuidance: string): string {
  return isIOS() ? `Opened at PDF page ${page}.` : desktopGuidance;
}
