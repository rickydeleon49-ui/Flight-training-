import { nowIso } from "@/lib/dates";
import type { Topic } from "@/domain/types";
import type { FaaDownloaded } from "@/services/faaDownloads";
import type { SqlDatabase } from "../db";
import type { documentRepository } from "./documentRepository";

/** Where a handbook copy came from. Never written into her notes. */
export interface FaaDownloadRecord {
  materialId: string;
  documentId: string;
  sourceUrl: string;
  edition: string;
  contentSha256: string;
  bytes: number;
  httpLastModified: string | null;
  downloadedAt: string;
}

interface Row {
  materialId: string;
  documentId: string;
  sourceUrl: string;
  edition: string;
  contentSha256: string;
  bytes: number;
  httpLastModified: string | null;
  downloadedAt: string;
}

const COLUMNS = `material_id AS materialId, document_id AS documentId, source_url AS sourceUrl, edition,
  content_sha256 AS contentSha256, bytes, http_last_modified AS httpLastModified, downloaded_at AS downloadedAt`;

/** Provenance of handbooks downloaded from faa.gov (one row per saved copy). */
export function faaDownloadRepository(db: SqlDatabase, documents: ReturnType<typeof documentRepository>) {
  return {
    /**
     * Save a finished download as a study material plus its provenance row.
     * The two writes are separate (the material save owns its own atomic
     * transaction), so if the provenance row fails the new material is removed
     * again and the error is passed on: no half-saved copy is left on her shelf.
     * The caller still owns the downloaded file.
     */
    async record(input: { materialId: string; title: string; topic?: Topic; downloaded: FaaDownloaded }): Promise<FaaDownloadRecord> {
      const { downloaded } = input;
      await documents.create({
        id: input.materialId,
        title: input.title,
        materialType: "reference",
        ...(input.topic ? { topic: input.topic } : {}),
        filePath: downloaded.document.relativePath,
        originalFileName: downloaded.document.originalFileName,
        fileSize: downloaded.document.fileSize,
      });
      const record: FaaDownloadRecord = {
        materialId: input.materialId,
        documentId: downloaded.manifestId,
        sourceUrl: downloaded.sourceUrl,
        edition: downloaded.edition,
        contentSha256: downloaded.sha256,
        bytes: downloaded.bytes,
        httpLastModified: downloaded.httpLastModified,
        downloadedAt: nowIso(),
      };
      try {
        await db.execute(
          `INSERT INTO faa_downloads (material_id, document_id, source_url, edition, content_sha256, bytes, http_last_modified, downloaded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [record.materialId, record.documentId, record.sourceUrl, record.edition, record.contentSha256,
            record.bytes, record.httpLastModified, record.downloadedAt]);
      } catch (error) {
        try { await documents.remove(input.materialId); } catch { /* the original error is the one to report */ }
        throw error;
      }
      return record;
    },
    async get(materialId: string): Promise<FaaDownloadRecord | null> {
      const rows = await db.select<Row>(`SELECT ${COLUMNS} FROM faa_downloads WHERE material_id = ?`, [materialId]);
      return rows[0] ?? null;
    },
    async list(): Promise<FaaDownloadRecord[]> {
      return db.select<Row>(`SELECT ${COLUMNS} FROM faa_downloads ORDER BY downloaded_at ASC, material_id ASC`, []);
    },
  };
}
