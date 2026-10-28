import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/data";
export async function previewStudyPageSource(materialId: string): Promise<{contentSha256:string;totalPages:number}|null> {
  if (!isTauri()) return null;
  return invoke("preview_study_page_source", {materialId});
}
