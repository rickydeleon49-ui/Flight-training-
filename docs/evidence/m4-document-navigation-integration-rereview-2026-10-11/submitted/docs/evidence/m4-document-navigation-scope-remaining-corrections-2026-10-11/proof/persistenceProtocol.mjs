/**
 * Her Flight Deck - Persistence Protocol & Revalidation Helper (Corrected for M4-R6)
 *
 * Implements:
 * - Candidate DDL execution and verification
 * - Bounded bookmark revalidation with originating hash retention
 * - Reading position persistence with last_requested_page vs confirmed_read
 * - Reusable SQLite operations for file-backed lifecycle tests
 */
import { DatabaseSync } from "node:sqlite";
import { reconcileBookmarksOnContentDrift } from "./contractModel.mjs";

export class DocumentPersistenceProtocol {
  /**
   * @param {DatabaseSync} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Applies candidate migration 0015 DDL to the active database.
   * @param {string} ddlSql
   */
  applyCandidateDdl(ddlSql) {
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(ddlSql);
  }

  /**
   * Saves or updates reading state for a material.
   *
   * @param {string} materialId
   * @param {number} lastRequestedPage
   * @param {object} options
   * @param {string} [options.label]
   * @param {string} options.contentSha256
   * @param {boolean} [options.confirmedRead=false]
   */
  saveReadingState(materialId, lastRequestedPage, options) {
    if (!Number.isSafeInteger(lastRequestedPage) || lastRequestedPage < 1) {
      throw new TypeError("lastRequestedPage must be a safe integer >= 1");
    }
    const confirmed = options.confirmedRead ? 1 : 0;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO material_reading_state (
        material_id, last_requested_page, last_requested_page_label,
        confirmed_read, originating_content_sha256, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?)
      ON CONFLICT(material_id) DO UPDATE SET
        last_requested_page = excluded.last_requested_page,
        last_requested_page_label = excluded.last_requested_page_label,
        confirmed_read = excluded.confirmed_read,
        originating_content_sha256 = excluded.originating_content_sha256,
        status = excluded.status,
        updated_at = excluded.updated_at
    `);
    stmt.run(materialId, lastRequestedPage, options.label || null, confirmed, options.contentSha256, now);
  }

  /**
   * Adds a new bookmark bound to its originating document content hash.
   *
   * @param {object} bookmark
   * @param {string} bookmark.id
   * @param {string} bookmark.materialId
   * @param {number} bookmark.pageIndex
   * @param {string | null} [bookmark.pageLabel]
   * @param {string} bookmark.originatingContentSha256
   * @param {string} bookmark.title
   * @param {string} [bookmark.notes]
   * @param {string} [bookmark.status='verified']
   */
  addBookmark(bookmark) {
    if (!Number.isSafeInteger(bookmark.pageIndex) || bookmark.pageIndex < 1) {
      throw new TypeError("Bookmark pageIndex must be a safe integer >= 1");
    }
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO material_bookmarks (
        id, material_id, page_index, page_label,
        originating_content_sha256, title, notes, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      bookmark.id,
      bookmark.materialId,
      bookmark.pageIndex,
      bookmark.pageLabel || null,
      bookmark.originatingContentSha256,
      bookmark.title,
      bookmark.notes || "",
      bookmark.status || "verified",
      now,
      now
    );
  }

  /**
   * Reconciles all bookmarks for a material upon document replacement or update.
   *
   * Persists 'unverified' status for bookmarks that drift or exceed known document bounds,
   * while preserving the original originating_content_sha256 value.
   *
   * @param {string} materialId
   * @param {string} currentSha256
   * @param {object} [options]
   * @param {number} [options.totalPages]
   * @returns {{ total: number, verified: number, unverified: number }}
   */
  reconcileBookmarksOnContentUpdate(materialId, currentSha256, options = {}) {
    const rows = this.db.prepare(`
      SELECT id, material_id, page_index, page_label, originating_content_sha256, title, notes, status
      FROM material_bookmarks
      WHERE material_id = ?
    `).all(materialId);

    const bookmarks = rows.map((r) => ({
      id: r.id,
      materialId: r.material_id,
      pageIndex: r.page_index,
      pageLabel: r.page_label,
      originatingContentSha256: r.originating_content_sha256,
      title: r.title,
      notes: r.notes,
      status: r.status,
    }));

    const reconciled = reconcileBookmarksOnContentDrift(bookmarks, currentSha256, options);
    const now = new Date().toISOString();

    this.db.exec("BEGIN TRANSACTION;");
    try {
      const updateStmt = this.db.prepare(`
        UPDATE material_bookmarks
        SET status = ?, updated_at = ?
        WHERE id = ?
      `);

      let verifiedCount = 0;
      let unverifiedCount = 0;

      for (const b of reconciled) {
        updateStmt.run(b.status, now, b.id);
        if (b.status === "verified") verifiedCount++;
        else unverifiedCount++;
      }

      this.db.exec("COMMIT;");
      return { total: reconciled.length, verified: verifiedCount, unverified: unverifiedCount };
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }

  /**
   * Records or updates content identity cache.
   *
   * @param {string} materialId
   * @param {string} contentSha256
   * @param {number} totalPages
   */
  saveContentIdentity(materialId, contentSha256, totalPages) {
    if (!Number.isSafeInteger(totalPages) || totalPages < 1) {
      throw new TypeError("totalPages must be a safe integer >= 1");
    }
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO material_content_identities (material_id, content_sha256, total_pages, verified_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(material_id) DO UPDATE SET
        content_sha256 = excluded.content_sha256,
        total_pages = excluded.total_pages,
        verified_at = excluded.verified_at
    `);
    stmt.run(materialId, contentSha256, totalPages, now);
  }
}
