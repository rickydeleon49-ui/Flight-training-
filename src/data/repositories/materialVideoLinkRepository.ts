import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import type { SqlDatabase } from "../db";

export const BAD_VIDEO_URL = "That doesn't look like a web link. Copy it from the browser's address bar.";
export interface MaterialVideoLink {
  id: string;
  materialId: string;
  url: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export function validateVideoUrl(input: string): string {
  let url = input.trim();
  try {
    const parsed = new URL(url);
    // Only https opens (owner 31 Oct); an http link is quietly upgraded.
    if (parsed.protocol === "http:") url = "https:" + url.slice(url.indexOf(":") + 1);
    else if (parsed.protocol !== "https:") throw new Error();
    if (url.length > 2000) throw new Error();
  } catch { throw new Error(BAD_VIDEO_URL); }
  return url;
}
function validateTitle(input: string): string {
  const title = input.trim();
  if (title.length > 200) throw new Error("Keep the name to 200 characters or fewer.");
  return title;
}
export function videoLinkLabel(link: Pick<MaterialVideoLink, "title" | "url">): string {
  if (link.title) return link.title;
  try {
    const url = new URL(link.url);
    const label = url.host + url.pathname;
    return label.length > 80 ? label.slice(0, 77) + "…" : label;
  } catch { return "Saved video link"; }
}
export function materialVideoLinkRepository(db: SqlDatabase) {
  return {
    async list(materialId: string): Promise<MaterialVideoLink[]> {
      return db.select<MaterialVideoLink>(`SELECT id, material_id AS materialId, url, title,
        created_at AS createdAt, updated_at AS updatedAt FROM material_video_links
        WHERE material_id = ? ORDER BY created_at ASC, rowid ASC`, [materialId]);
    },
    async add(materialId: string, inputUrl: string, inputTitle = ""): Promise<MaterialVideoLink> {
      const url = validateVideoUrl(inputUrl);
      const title = validateTitle(inputTitle);
      const timestamp = nowIso();
      const link = { id: newId(), materialId, url, title, createdAt: timestamp, updatedAt: timestamp };
      await db.execute(`INSERT INTO material_video_links (id, material_id, url, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`, [link.id, materialId, url, title, timestamp, timestamp]);
      return link;
    },
    async rename(id: string, title: string): Promise<void> {
      await db.execute("UPDATE material_video_links SET title = ?, updated_at = ? WHERE id = ?", [validateTitle(title), nowIso(), id]);
    },
    async remove(id: string): Promise<void> {
      await db.execute("DELETE FROM material_video_links WHERE id = ?", [id]);
    },
  };
}
