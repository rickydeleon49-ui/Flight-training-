import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FaaDownloaded } from "@/services/faaDownloads";
import { createNodeSqliteDatabase, type TestDatabase } from "../testing/nodeSqliteDb";
import { createRepositories, type Repositories } from "./index";

const SHA = "a".repeat(64);
function downloaded(over: Partial<FaaDownloaded> = {}): FaaDownloaded {
  return {
    document: { relativePath: "documents/m1.pdf", originalFileName: "afh_ch01.pdf", fileSize: 1234 },
    manifestId: "afh-ch-01", sourceUrl: "https://www.faa.gov/afh_ch01.pdf", edition: "FAA-H-8083-3C",
    sha256: SHA, bytes: 1234, httpLastModified: "Tue, 01 Jan 2030 00:00:00 GMT", ...over,
  };
}

describe("FAA download provenance", () => {
  let db: TestDatabase;
  let repos: Repositories;
  beforeEach(async () => { db = await createNodeSqliteDatabase(); repos = createRepositories(db); });
  afterEach(() => db.close());

  it("saves the material and its provenance, and keeps her notes empty", async () => {
    const record = await repos.faaDownloads.record({ materialId: "m1", title: "Airplane Flying Handbook, chapter 1", downloaded: downloaded() });
    expect(await repos.faaDownloads.get("m1")).toEqual(record);
    expect(record).toMatchObject({ documentId: "afh-ch-01", edition: "FAA-H-8083-3C", contentSha256: SHA, bytes: 1234 });
    expect(await repos.faaDownloads.list()).toEqual([record]);
    const material = (await repos.documents.list()).find((m) => m.id === "m1");
    expect(material).toMatchObject({ filePath: "documents/m1.pdf", originalFileName: "afh_ch01.pdf", fileSize: 1234 });
    expect(material?.notes ?? "").toBe("");
    expect(JSON.stringify(material)).not.toContain(SHA);
  });
  it("round-trips the full PHAK 25C provenance without changing the schema", async () => {
    const copy = downloaded({ manifestId: "phak-25c-full", edition: "FAA-H-8083-25C", bytes: 74_000_000,
      sourceUrl: "https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/faa-h-8083-25c.pdf" });
    const record = await repos.faaDownloads.record({ materialId: "phak", title: "PHAK 25C", downloaded: copy });
    expect(await repos.faaDownloads.get("phak")).toEqual(record);
    expect(record).toMatchObject({ documentId: copy.manifestId, bytes: 74_000_000, edition: copy.edition });
  });
  it("allows a missing Last-Modified", async () => {
    await repos.faaDownloads.record({ materialId: "m1", title: "AFH", downloaded: downloaded({ httpLastModified: null }) });
    expect((await repos.faaDownloads.get("m1"))?.httpLastModified).toBeNull();
  });
  it("removes the new material when the provenance row is refused", async () => {
    await expect(repos.faaDownloads.record({ materialId: "m1", title: "AFH", downloaded: downloaded({ sha256: "short" }) })).rejects.toThrow();
    expect((await repos.documents.list()).some((m) => m.id === "m1")).toBe(false);
    expect(await repos.faaDownloads.list()).toEqual([]);
  });
  it("deletes the provenance with the material", async () => {
    await repos.faaDownloads.record({ materialId: "m1", title: "AFH", downloaded: downloaded() });
    await repos.documents.remove("m1");
    expect(await repos.faaDownloads.get("m1")).toBeNull();
  });
});
