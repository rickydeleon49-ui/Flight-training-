import type { Queue, QueueItem, QueueState } from "@/state/kitQueueLogic";
import type { SqlDatabase } from "../db";

interface QueueRow { id: string; provider: string; createdAt: string; state: QueueState; consentAt: string | null }
interface ItemRow {
  position: number; materialId: string; sourceSha256: string; status: QueueItem["status"];
  requestId: string | null; jobId: string | null; updatedAt: string;
}

/**
 * The study-kit queue (SOURCE-01b). Ids, checksums and status only: it never holds
 * keys, credentials, answers or page text. Local to this Mac; not synced.
 */
export function kitQueueRepository(db: SqlDatabase) {
  async function itemsOf(queueId: string): Promise<QueueItem[]> {
    return db.select<ItemRow>(
      `SELECT position, material_id AS materialId, source_sha256 AS sourceSha256, status,
              request_id AS requestId, job_id AS jobId, updated_at AS updatedAt
       FROM kit_queue_item WHERE queue_id = ? ORDER BY position ASC`, [queueId]);
  }
  return {
    /** Writes the whole queue: the row and every item. */
    async save(queue: Queue): Promise<void> {
      await db.execute(`INSERT INTO kit_queue (id, provider, created_at, state, consent_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, state = excluded.state, consent_at = excluded.consent_at`,
      [queue.id, queue.provider, queue.createdAt, queue.state, queue.consentAt]);
      for (const item of queue.items) {
        await db.execute(`INSERT INTO kit_queue_item (queue_id, position, material_id, source_sha256, status, request_id, job_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(queue_id, position) DO UPDATE SET status = excluded.status, request_id = excluded.request_id,
            job_id = excluded.job_id, updated_at = excluded.updated_at`,
        [queue.id, item.position, item.materialId, item.sourceSha256, item.status, item.requestId, item.jobId, item.updatedAt]);
      }
    },
    /** The newest queue that is not finished (active or paused), or null. */
    async findOpen(): Promise<Queue | null> {
      const rows = await db.select<QueueRow>(
        `SELECT id, provider, created_at AS createdAt, state, consent_at AS consentAt FROM kit_queue
         WHERE state IN ('active', 'paused') ORDER BY created_at DESC, id DESC LIMIT 1`, []);
      const row = rows[0];
      return row ? { ...row, items: await itemsOf(row.id) } : null;
    },
    /** The newest queue of any state, for showing how it ended. */
    async latest(): Promise<Queue | null> {
      const rows = await db.select<QueueRow>(
        `SELECT id, provider, created_at AS createdAt, state, consent_at AS consentAt FROM kit_queue
         ORDER BY created_at DESC, id DESC LIMIT 1`, []);
      const row = rows[0];
      return row ? { ...row, items: await itemsOf(row.id) } : null;
    },
    async remove(id: string): Promise<void> {
      await db.execute("DELETE FROM kit_queue WHERE id = ?", [id]);
    },
  };
}
