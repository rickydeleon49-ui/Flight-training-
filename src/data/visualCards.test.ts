import { afterEach, describe, it, expect, vi } from "vitest";
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm` }));
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";
import { createSqlJsDatabase } from "./sqlJsDb";
import { documentRepository } from "./repositories/documentRepository";
import { cardReviewRepository } from "./repositories/cardReviewRepository";
import { visualRegionHash, decodeVisualRegion, readVisualRegion, validateVisualReferences, type VisualRegion } from "./visualCards";
import { validateApplicationDatabase } from "./practiceStateValidation";
import { cardSourceFingerprint } from "./studyPageSources";
import { cardVersion, parseSavedCards } from "@/logic/cardIdentity";
import { authoringStateOf, nextSetOf, frameOf } from "@/logic/studySetEditing";
import type { SqlDatabase } from "./db";
import type { StudySetSaveOperation } from "./studySetTransaction";
let handles: TestDatabase[] = [];
afterEach(() => {
  handles.forEach((h) => h.close());
  handles = [];
  vi.unstubAllGlobals();
});
const uid = () => crypto.randomUUID();
async function setup(engine: string) {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  const db: SqlDatabase = engine === "node" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
  if (engine === "node") handles.push(db as TestDatabase);
  const docs = documentRepository(db);
  await docs.create({ id: "owner", title: "Synthetic" });
  await docs.create({ id: "image", title: "Panel", filePath: "panel.png" });
  const descriptor = {
    ownerMaterialId: "owner",
    imageMaterialId: "image",
    imageSha256: "a".repeat(64),
    imageWidth: 600,
    imageHeight: 400,
    x: 40,
    y: 30,
    w: 90,
    h: 20,
    rotation: 0 as const,
  };
  const region: VisualRegion = { ...descriptor, id: await visualRegionHash(descriptor) };
  const op: StudySetSaveOperation = {
    operationId: uid(),
    materialId: "owner",
    reason: "create",
    expected: null,
    visualRegions: [region],
    next: {
      title: "Synthetic",
      summary: "",
      summaryOrigin: null,
      sections: [],
      flashcards: [
        {
          front: "Which middle label?",
          back: "Bravo",
          sourcePage: null,
          itemId: "cover-1",
          origin: "user",
          visualRegionId: region.id,
        },
      ],
      sourceNotes: "",
      provider: "manual",
      model: "",
      retired: [],
    },
  };
  const query = (sql: string, p: import("./db").SqlValue[]) => db.select<Record<string, unknown>>(sql, p);
  return { db, docs, op, region, query, repo: cardReviewRepository(db) };
}
for (const engine of ["node", "sql.js"]) {
  describe(`visual cards ${engine}`, () => {
    it("saves atomically, binds exact retry, freezes the sidecar and retains history after image deletion", async () => {
      const { db, docs, op, region, query, repo } = await setup(engine);
      expect(await docs.saveStudySet(op)).toEqual({ status: "saved" });
      expect(await docs.saveStudySet(op)).toEqual({ status: "already_saved" });
      await expect(docs.saveStudySet({ ...op, next: { ...op.next!, title: "Changed" } })).rejects.toMatchObject({ code: "CONFLICT" });
      const snapshot = await repo.getCardReviewSnapshot("owner");
      if (snapshot.current.status !== "ok") throw Error();
      expect(snapshot.current.items[0]?.visualRegionId).toBe(region.id);
      const action = {
        operationId: uid(),
        action: "rate" as const,
        materialId: "owner",
        versionContentHash: snapshot.current.contentHash,
        itemId: snapshot.current.items[0]!.itemId,
        expectedGeneration: 0,
        expectedRevision: 0,
        rating: "good" as const,
      };
      await repo.saveAction(action);
      expect(await db.select("SELECT region_id FROM card_item_visual_regions")).toEqual([{ region_id: region.id }]);
      const opened = (await docs.readStudySetForEdit("owner"))!;
      expect(nextSetOf(frameOf(opened.set), authoringStateOf(opened.set)).flashcards[0]?.visualRegionId).toBe(region.id);
      await validateApplicationDatabase(query, query);
      await docs.remove("image");
      expect((await readVisualRegion(query, region.id, "owner")).imageMaterialId).toBeNull();
      await expect(repo.saveAction({ ...action, operationId: uid(), expectedRevision: 1 })).rejects.toMatchObject({ code: "INVALID_STATE" });
      expect(await db.select("SELECT COUNT(*) AS n FROM card_review_events")).toEqual([{ n: 1 }]);
      await validateApplicationDatabase(query, query);
      await docs.remove("owner");
      expect(await db.select("SELECT * FROM visual_card_regions")).toEqual([]);
    });
    it("image, bounds and rotation change content identity and fingerprints while A→B→A recovers A", async () => {
      const { region, op } = await setup(engine);
      const c = op.next!.flashcards[0]!;
      const first = await cardVersion("owner", [c]);
      const changes = [{ ...region, x: 41 }, { ...region, rotation: 90 as const }, { ...region, imageSha256: "b".repeat(64) }];
      for (const changed of changes) {
        const visualRegionId = await visualRegionHash(changed);
        expect(visualRegionId).not.toBe(region.id);
        expect((await cardVersion("owner", [{ ...c, visualRegionId }])).versionId).not.toBe(first.versionId);
        expect(await cardSourceFingerprint({ ...c, visualRegionId })).not.toBe(await cardSourceFingerprint(c));
      }
      expect(await cardVersion("owner", [c])).toEqual(first);
    });
    it("refuses damaged descriptor hashes, bounds, owners, dangling references and missing frozen bindings", async () => {
      const { docs, db, op, region, query, repo } = await setup(engine);
      expect(() => decodeVisualRegion({ ...region, x: 600 })).toThrow();
      await expect(
        docs.saveStudySet({ ...op, visualRegions: [{ ...region, imageSha256: "b".repeat(64) }] }),
      ).rejects.toBeDefined();
      expect(await db.select("SELECT * FROM visual_card_regions")).toEqual([]);
      await docs.saveStudySet(op);
      await db.execute("UPDATE visual_card_regions SET image_sha256=?", ["b".repeat(64)]);
      await expect(validateVisualReferences(query)).rejects.toThrow();
      await db.execute("UPDATE visual_card_regions SET image_sha256=?", [region.imageSha256]);
      const snap = await repo.getCardReviewSnapshot("owner");
      if (snap.current.status !== "ok") throw Error();
      await repo.saveAction({
        operationId: uid(),
        action: "rate",
        materialId: "owner",
        versionContentHash: snap.current.contentHash,
        itemId: snap.current.items[0]!.itemId,
        expectedGeneration: 0,
        expectedRevision: 0,
        rating: "good",
      });
      await db.execute("DELETE FROM card_item_visual_regions");
      await expect(validateApplicationDatabase(query, query)).rejects.toThrow(/hash/);
    });
    it("limits the current image to twenty covers without collecting retained descriptors", async () => {
      const { docs, op, region, db } = await setup(engine);
      op.next!.flashcards = Array.from({ length: 21 }, (_, i) => ({
        ...op.next!.flashcards[0]!,
        itemId: `c-${i}`,
      }));
      await expect(docs.saveStudySet(op)).rejects.toBeDefined();
      expect(await db.select("SELECT * FROM visual_card_regions")).toEqual([]);
      op.next!.flashcards.pop();
      await docs.saveStudySet(op);
      expect(await db.select("SELECT COUNT(*) AS n FROM visual_card_regions")).toEqual([{ n: 1 }]);
      const invalid = JSON.stringify([{ front: "Q", back: "A", sourcePage: null, visualRegionId: "invalid" }]);
      expect(parseSavedCards(invalid).status).toBe("malformed");
      expect(await visualRegionHash({ ...region, imageMaterialId: "different" })).toBe(region.id);
    });
  });
}

for (const engine of ["node", "sql.js"]) {
  it(`retains detached visuals while reviewing text and permits pausing/retiring them on ${engine}`, async () => {
    const { docs, op, db, repo, query } = await setup(engine);
    await docs.saveStudySet(op);
    await docs.remove("image");
    const read = (await docs.readStudySetForEdit("owner"))!;
    const next = {
      ...op.next!,
      flashcards: [
        ...op.next!.flashcards,
        { front: "Text Q", back: "Text A", sourcePage: null, itemId: "text-1", origin: "user" as const },
      ],
    };
    await docs.saveStudySet({ operationId: uid(), materialId: "owner", reason: "edit", expected: read.stored, next });
    const snapshot = await repo.getCardReviewSnapshot("owner");
    if (snapshot.current.status !== "ok") throw Error();
    await repo.saveAction({
      operationId: uid(),
      action: "rate",
      materialId: "owner",
      versionContentHash: snapshot.current.contentHash,
      itemId: snapshot.current.items[1]!.itemId,
      expectedGeneration: 0,
      expectedRevision: 0,
      rating: "good",
    });
    await repo.saveAction({
      operationId: uid(),
      action: "suspend",
      materialId: "owner",
      versionContentHash: snapshot.current.contentHash,
      itemId: snapshot.current.items[0]!.itemId,
      expectedGeneration: 0,
      expectedRevision: 0,
    });
    expect(await db.select("SELECT COUNT(*) AS n FROM card_review_events")).toEqual([{ n: 1 }]);
    const current = (await docs.readStudySetForEdit("owner"))!;
    await docs.saveStudySet({
      operationId: uid(),
      materialId: "owner",
      reason: "delete",
      expected: current.stored,
      next: { ...next, flashcards: [next.flashcards[1]!] },
    });
    await validateApplicationDatabase(query, query);
    expect(await db.select("SELECT COUNT(*) AS n FROM card_item_visual_regions")).toEqual([{ n: 1 }]);
  });
}
