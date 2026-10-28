/** Immutable picture identity. Paths and the detachable image lookup never enter the hash. */
import { canonicalJson, sha256Hex, parseSavedCards } from "@/logic/cardIdentity";
import type { SqlValue } from "./db";
import type { Turn } from "@/logic/visualCover";

export interface VisualRegion {
  id: string;
  ownerMaterialId: string;
  imageMaterialId: string | null;
  imageSha256: string;
  imageWidth: number;
  imageHeight: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: Turn;
}

export type VisualQuery = (
  sql: string,
  params: SqlValue[],
) => Promise<Record<string, unknown>[]> | Record<string, unknown>[];

type Run = (sql: string, params: SqlValue[]) => Promise<void> | void;

const REGION_KEYS = "h,id,imageHeight,imageMaterialId,imageSha256,imageWidth,ownerMaterialId,rotation,w,x,y";
const SHA256 = /^[0-9a-f]{64}$/;

export function visualDescriptor(r: Omit<VisualRegion, "id">) {
  return {
    version: 1,
    ownerMaterialId: r.ownerMaterialId,
    imageSha256: r.imageSha256,
    imageWidth: r.imageWidth,
    imageHeight: r.imageHeight,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    rotation: r.rotation,
  };
}

export const visualRegionHash = (r: Omit<VisualRegion, "id">) => sha256Hex(canonicalJson(visualDescriptor(r)));

export function decodeVisualRegion(value: unknown): VisualRegion {
  const r = value as VisualRegion;
  if (
    !r ||
    Object.keys(r).sort().join() !== REGION_KEYS ||
    !SHA256.test(r.id) ||
    !SHA256.test(r.imageSha256) ||
    typeof r.ownerMaterialId !== "string" ||
    !r.ownerMaterialId ||
    r.ownerMaterialId.length > 200 ||
    (r.imageMaterialId !== null &&
      (typeof r.imageMaterialId !== "string" || !r.imageMaterialId || r.imageMaterialId.length > 200)) ||
    ![r.imageWidth, r.imageHeight, r.x, r.y, r.w, r.h, r.rotation].every(Number.isSafeInteger) ||
    r.imageWidth < 1 ||
    r.imageHeight < 1 ||
    r.imageWidth > 4096 ||
    r.imageHeight > 4096 ||
    r.imageWidth * r.imageHeight > 4000000 ||
    r.x < 0 ||
    r.y < 0 ||
    r.w < 1 ||
    r.h < 1 ||
    r.x + r.w > r.imageWidth ||
    r.y + r.h > r.imageHeight ||
    ![0, 90, 180, 270].includes(r.rotation)
  ) {
    throw Error("Damaged picture card.");
  }
  return r;
}

export function regionFromRow(r: Record<string, unknown>): VisualRegion {
  return decodeVisualRegion({
    id: r.id,
    ownerMaterialId: r.owner_material_id,
    imageMaterialId: r.image_material_id,
    imageSha256: r.image_sha256,
    imageWidth: r.image_width,
    imageHeight: r.image_height,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    rotation: r.rotation,
  });
}

export async function readVisualRegion(query: VisualQuery, id: string, owner: string): Promise<VisualRegion> {
  const [row] = await query("SELECT * FROM visual_card_regions WHERE id = ?", [id]);
  if (!row) throw Error("Picture card unavailable.");
  const r = regionFromRow(row);
  if (r.ownerMaterialId !== owner || (await visualRegionHash(r)) !== id) {
    throw Error("Damaged picture card.");
  }
  return r;
}

export async function writeVisualRegions(
  run: Run,
  query: VisualQuery,
  owner: string,
  regions: VisualRegion[],
  cards: { visualRegionId?: string }[],
) {
  for (const value of regions) {
    const r = decodeVisualRegion(value);
    if (
      r.ownerMaterialId !== owner ||
      (await visualRegionHash(r)) !== r.id ||
      !r.imageMaterialId ||
      !cards.some((c) => c.visualRegionId === r.id)
    ) {
      throw Error("INVALID_ARGUMENT");
    }
    const [old] = await query("SELECT * FROM visual_card_regions WHERE id = ?", [r.id]);
    if (old) {
      if (canonicalJson(regionFromRow(old)) !== canonicalJson(r)) throw Error("INVALID_ARGUMENT");
    } else {
      await run(
        "INSERT INTO visual_card_regions (id,owner_material_id,image_material_id,image_sha256,image_width,image_height,x,y,w,h,rotation) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [r.id, owner, r.imageMaterialId, r.imageSha256, r.imageWidth, r.imageHeight, r.x, r.y, r.w, r.h, r.rotation],
      );
    }
  }
  const counts = new Map<string, number>();
  // Other materials may share this image. Retained history does not consume the authoring limit.
  const all = [...cards];
  for (const row of await query("SELECT flashcards_json FROM ai_study_sets WHERE source_material_id != ?", [owner])) {
    const parsed = parseSavedCards(String(row.flashcards_json));
    if (parsed.status === "ok") all.push(...parsed.cards);
  }
  for (const c of all) {
    if (!c.visualRegionId) continue;
    const [row] = await query("SELECT * FROM visual_card_regions WHERE id = ?", [c.visualRegionId]);
    if (!row) throw Error("INVALID_ARGUMENT");
    const r = regionFromRow(row);
    if (cards.includes(c)) await readVisualRegion(query, c.visualRegionId, owner);
    if (!r.imageMaterialId) continue; // detached cards have no active image budget
    const key = r.imageMaterialId;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    if (n > 20) throw Error("INVALID_ARGUMENT");
  }
}

export async function validateVisualReferences(query: VisualQuery) {
  const regions = new Map<string, VisualRegion>();
  for (const row of await query("SELECT * FROM visual_card_regions", [])) {
    const r = regionFromRow(row);
    if ((await visualRegionHash(r)) !== r.id) throw Error("Damaged picture descriptor hash.");
    regions.set(r.id, r);
  }

  const currentCounts = new Map<string, number>();
  for (const row of await query("SELECT flashcards_json FROM ai_study_sets", [])) {
    const parsed = parseSavedCards(String(row.flashcards_json));
    if (parsed.status !== "ok") continue;
    for (const c of parsed.cards) {
      if (!c.visualRegionId) continue;
      const r = regions.get(c.visualRegionId);
      if (!r) throw Error("Damaged picture reference.");
      if (!r.imageMaterialId) continue; // detached cards have no active image budget
      const key = r.imageMaterialId;
      const n = (currentCounts.get(key) ?? 0) + 1;
      if (n > 20) throw Error("Too many picture cards.");
      currentCounts.set(key, n);
    }
  }

  const sets = await query(
    "SELECT source_material_id AS owner,flashcards_json AS cards FROM ai_study_sets UNION ALL SELECT material_id AS owner,json_extract(previous_json,'$.flashcards_json') AS cards FROM study_set_history WHERE kind='study_set'",
    [],
  );
  for (const row of sets) {
    const parsed = parseSavedCards(String(row.cards));
    if (parsed.status === "malformed") throw Error("Damaged picture cards.");
    if (parsed.status !== "ok") continue;
    for (const c of parsed.cards) {
      if (c.visualRegionId && regions.get(c.visualRegionId)?.ownerMaterialId !== row.owner) {
        throw Error("Damaged picture owner.");
      }
    }
  }

  const frozen = await query(
    "SELECT b.*,v.source_material_id AS owner FROM card_item_visual_regions b JOIN card_items i ON i.id=b.item_id JOIN card_versions v ON v.id=i.version_id",
    [],
  );
  for (const row of frozen) {
    if (regions.get(String(row.region_id))?.ownerMaterialId !== row.owner) {
      throw Error("Damaged frozen picture owner.");
    }
  }
}
