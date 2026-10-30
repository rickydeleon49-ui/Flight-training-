/**
 * Deterministic synthetic Study Library for measurement and its answer key.
 *
 * Every material is derived from its index alone, so the expected result of a
 * search, filter or sort can be stated from the fixture definition instead of
 * being read back from the code under test. Synthetic data only: no real
 * titles, notes, files or profiles.
 *
 * Coverage built in by construction (n = material count):
 * - "Airspace class B/C/D/E review" titles on every 10th material (matching
 *   and narrowing queries); "class b" only on every 40th.
 * - Unicode: uppercase accented "MÉTÉO" titles and a lowercase "météo" tag on
 *   i % 10 === 1, with CJK "航空" added on i % 20 === 1.
 * - Exact duplicate titles ("Weight and balance worksheet") on i % 10 === 2.
 * - Tags "checkride" (i % 3 === 0), "xc-planning" (i % 4 === 0).
 * - Notes mentioning "fuel planning" on i % 7 === 0.
 * - A stored file on i % 4 === 0; of those, i % 8 === 0 is the MOCKED
 *   missing-file case. File status is a labelled mock, never a real file.
 * - Distinct, shuffled creation times, so every sort order is fully defined.
 */
import type { SqlDatabase } from "@/data/db";
import {
  MATERIAL_TYPE_LABELS,
  TOPIC_LABELS,
  type MaterialType,
  type Priority,
  type ReviewStatus,
  type StudyMaterial,
  type Topic,
} from "@/domain/types";
import type { MaterialSort } from "@/logic/library";

const TOPICS = Object.keys(TOPIC_LABELS) as Topic[];
const TYPES = Object.keys(MATERIAL_TYPE_LABELS) as MaterialType[];
const STATUSES: ReviewStatus[] = ["needs_review", "studying", "confident", "reference_only"];
const PRIORITIES: Priority[] = ["next_up", "important", "later"];
const CLASSES = ["B", "C", "D", "E"] as const;
const CREATED_BASE_MS = Date.UTC(2026, 0, 1);
/** Prime multiplier: (i * 7919) mod n is a permutation for every tier size used. */
const CREATED_SHUFFLE = 7_919;

export interface FixtureMaterial {
  id: string;
  index: number;
  title: string;
  notes: string;
  topic: Topic;
  materialType: MaterialType;
  reviewStatus: ReviewStatus;
  priority: Priority;
  tags: string[];
  filePath: string | null;
  fileSize: number | null;
  createdAt: string;
  /** MOCK file status for the missing-file scenario; not filesystem evidence. */
  mockFileMissing: boolean;
}

export function materialId(index: number): string {
  return `m-${index}`;
}

export function fixtureMaterial(index: number, total: number): FixtureMaterial {
  const i = index;
  let title: string;
  if (i % 10 === 0) title = `Airspace class ${CLASSES[(i / 10) % 4]} review ${i}`;
  else if (i % 10 === 1) title = i % 20 === 1 ? `MÉTÉO vent traversier 航空 ${i}` : `MÉTÉO vent traversier ${i}`;
  else if (i % 10 === 2) title = "Weight and balance worksheet";
  else title = `Ground lesson ${i}`;

  const tags: string[] = [];
  if (i % 3 === 0) tags.push("checkride");
  if (i % 10 === 1) tags.push("météo");
  if (i % 4 === 0) tags.push("xc-planning");

  const hasFile = i % 4 === 0;
  const createdMs = CREATED_BASE_MS + ((i * CREATED_SHUFFLE) % total) * 60_000;
  return {
    id: materialId(i),
    index: i,
    title,
    notes: i % 7 === 0 ? "Fuel planning for the cross-country leg." : `Synthetic study notes, set ${i % 5}.`,
    topic: TOPICS[i % TOPICS.length]!,
    materialType: TYPES[Math.floor(i / 12) % TYPES.length]!,
    reviewStatus: STATUSES[Math.floor(i / 5) % STATUSES.length]!,
    priority: PRIORITIES[Math.floor(i / 2) % PRIORITIES.length]!,
    tags,
    filePath: hasFile ? `documents/${materialId(i)}.pdf` : null,
    fileSize: hasFile ? 1024 * ((i % 50) + 1) : null,
    createdAt: new Date(createdMs).toISOString(),
    mockFileMissing: hasFile && i % 8 === 0,
  };
}

export function fixtureLibrary(total: number): FixtureMaterial[] {
  return Array.from({ length: total }, (_, index) => fixtureMaterial(index, total));
}

/** Hash of the generated records, so a report names exactly which fixture it measured. */
export async function fixtureIdentity(materials: FixtureMaterial[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(materials));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Insert the fixture through the real schema. Inserted directly rather than
 * through the repository so creation times are deterministic and seeding
 * stays linear; the timed operations all go through the real app code.
 *
 * Uses the driver's supported atomic batch operation (`saveMaterialsAtomically`).
 */
export async function seedFixtureMaterials(db: SqlDatabase, materials: FixtureMaterial[]): Promise<void> {
  if (!db.saveMaterialsAtomically) {
    throw new Error("Database driver does not support atomic batch material saving");
  }
  const studyMaterials: StudyMaterial[] = materials.map((m) => ({
    id: m.id,
    title: m.title,
    materialType: m.materialType,
    topic: m.topic,
    reviewStatus: m.reviewStatus,
    priority: m.priority,
    goalId: null,
    eventId: null,
    notes: m.notes,
    filePath: m.filePath,
    originalFileName: m.filePath ? `${m.id}.pdf` : null,
    fileSize: m.fileSize,
    createdAt: m.createdAt,
    updatedAt: m.createdAt,
    lastReviewedAt: null,
    tags: m.tags,
  }));
  await db.saveMaterialsAtomically(studyMaterials);
}

export type StatusChip = "Everything" | "Next Up" | "Studying" | "Review again" | "Confident" | "Reference Only";

export interface LibraryView {
  query: string;
  topic: Topic | "";
  type: MaterialType | "";
  status: StatusChip;
  sort: MaterialSort;
}

export const DEFAULT_VIEW: LibraryView = { query: "", topic: "", type: "", status: "Everything", sort: "recent" };

const CHIP_STATUS: Record<Exclude<StatusChip, "Everything" | "Next Up">, ReviewStatus> = {
  Studying: "studying",
  "Review again": "needs_review",
  Confident: "confident",
  "Reference Only": "reference_only",
};

/**
 * The answer key: which fixture materials the library should list for a view,
 * in order. Written from the documented behavior (case-insensitive substring
 * over title, notes, topic label, type label and tags; recent = newest first;
 * priority = Next Up, Important, Later then newest; title = locale order,
 * duplicates newest first). It works from the generator, not from the loaded
 * records, so it also checks the database round trip.
 */
export function expectedIds(materials: FixtureMaterial[], view: LibraryView): string[] {
  const query = view.query.trim().toLowerCase();
  const matches = materials.filter((m) => {
    if (view.status === "Next Up" && m.priority !== "next_up") return false;
    if (view.status !== "Everything" && view.status !== "Next Up" && m.reviewStatus !== CHIP_STATUS[view.status]) return false;
    if (view.topic && m.topic !== view.topic) return false;
    if (view.type && m.materialType !== view.type) return false;
    if (!query) return true;
    // Fields are searched as one space-joined text, so a query may span two fields.
    const fields = [m.title, m.notes, TOPIC_LABELS[m.topic], MATERIAL_TYPE_LABELS[m.materialType], ...m.tags];
    return fields.join(" ").toLowerCase().includes(query);
  });
  const rank: Record<Priority, number> = { next_up: 0, important: 1, later: 2 };
  const newestFirst = (a: FixtureMaterial, b: FixtureMaterial) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);
  const compare =
    view.sort === "title"
      ? (a: FixtureMaterial, b: FixtureMaterial) => a.title.localeCompare(b.title) || newestFirst(a, b)
      : view.sort === "priority"
        ? (a: FixtureMaterial, b: FixtureMaterial) => rank[a.priority] - rank[b.priority] || newestFirst(a, b)
        : newestFirst;
  return matches.sort(compare).map((m) => m.id);
}

/** How many indexes in [0, total) satisfy i % every === remainder. */
function countEvery(total: number, every: number, remainder: number): number {
  return remainder >= total ? 0 : Math.floor((total - 1 - remainder) / every) + 1;
}

/**
 * Result counts known from the generator rules alone, independent of both the
 * app and expectedIds. Each query token appears only in the field noted.
 */
export function analyticCounts(total: number): Record<string, number> {
  return {
    "airspace": countEvery(total, 10, 0),
    "airspace class b": countEvery(total, 40, 0),
    "MÉTÉO": countEvery(total, 10, 1),
    "航空": countEvery(total, 20, 1),
    "weight and balance": countEvery(total, 10, 2),
    "xc-planning": countEvery(total, 4, 0),
    "fuel planning": countEvery(total, 7, 0),
    "xylophone": 0,
    // Decomposed é (e + U+0301). The library does not normalize Unicode, so this
    // does not match the precomposed fixture text; recorded as current behavior.
    "météo": 0,
  };
}

/**
 * Verbatim copy of the filter in StudyLibrary's `visible` memo, used only to
 * time the index-free search/filter work apart from React. Each benchmark
 * scenario checks that it agrees with the rendered page and the answer key,
 * so a drift between this copy and the page fails the run.
 */
export function pageFilterReplica(materials: StudyMaterial[], view: LibraryView): StudyMaterial[] {
  const status =
    view.status === "Everything" ? "all" : view.status === "Next Up" ? "next_up" : CHIP_STATUS[view.status];
  const { topic, type } = view;
  const query = view.query.trim().toLowerCase();
  return materials.filter((material) => {
    if (status === "next_up" && material.priority !== "next_up") return false;
    if (status !== "all" && status !== "next_up" && material.reviewStatus !== status) return false;
    if (topic && material.topic !== topic) return false;
    if (type && material.materialType !== type) return false;
    if (query) {
      const haystack = [
        material.title,
        material.notes,
        TOPIC_LABELS[material.topic],
        MATERIAL_TYPE_LABELS[material.materialType],
        ...material.tags,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}
