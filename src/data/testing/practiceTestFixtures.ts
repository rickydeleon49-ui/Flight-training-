/**
 * Test-only fixtures for the practice authoring contract (OFFLINE-03b).
 *
 * Seeding goes through the real transaction — receipts, history, versions,
 * origins and mirror alike — so a test database is exactly what production
 * writes produce. The provider default exists only here, for legacy
 * fixtures that predate explicit provenance; production callers must always
 * name the provider themselves.
 */
import type { PracticeQuestion, PracticeSaveResult } from "@/domain/types";
import { newId } from "@/lib/id";
import type { SqlDatabase } from "../db";
import { readCurrentSnapshot } from "../practiceAuthoring";

export interface SeedPracticeTestInput {
  sourceMaterialId: string;
  title: string;
  questions: PracticeQuestion[];
  model: string;
  provider?: "gemini" | "import" | "manual";
}

/** Save a practice test through the authoring contract, as the repository adapter does. */
export async function seedPracticeTest(
  db: SqlDatabase,
  input: SeedPracticeTestInput,
): Promise<PracticeSaveResult> {
  if (typeof db.savePracticeAuthoringAtomically !== "function") {
    throw new Error("Seeding a practice test requires a driver with the authoring writer.");
  }
  const current = await readCurrentSnapshot((sql, params) => db.select(sql, params), input.sourceMaterialId);
  return db.savePracticeAuthoringAtomically({
    operationId: newId(),
    sourceMaterialId: input.sourceMaterialId,
    reason: current ? "regenerate" : "create",
    expected: current,
    next: {
      title: input.title,
      provider: input.provider ?? "gemini",
      model: input.model,
      questions: input.questions.map((question) => ({ ...question, identity: newId() })),
      retired: current?.retired ?? [],
    },
  });
}
