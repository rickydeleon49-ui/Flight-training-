import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "@/data";
import { validateVideoUrl } from "@/data/repositories/materialVideoLinkRepository";

/** Opens an https link in the browser (Tauri opener in the app, a new tab on the web). Throws if the link is not valid. */
export async function openExternalLink(url: string): Promise<void> {
  const safeUrl = validateVideoUrl(url);
  if (isTauri()) await openUrl(safeUrl);
  else window.open(safeUrl, "_blank", "noopener,noreferrer");
}
