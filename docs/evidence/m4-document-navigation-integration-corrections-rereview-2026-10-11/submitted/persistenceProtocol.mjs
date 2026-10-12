/**
 * Her Flight Deck - Persistence Protocol & Atomic Revalidation
 * M4-R10: Single transaction covering identity, bookmark validity, and reading-state validity.
 * Navigation writers enforce persisted content identity and bounds.
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
   * Atomically replaces content identity and reconciles navigation validity in one transaction.
   *
   * Transaction covers:
   * 1. Updating/inserting material_content_identities cache.
   * 2. Updating material_bookmarks: bookmarks with drifted hashes or out-of-bounds page indices
   *    become visibly 'unverified'.
   * 3. Updating material_reading_state: reading positions with drifted hashes or out-of-bounds
   *    pages become visibly 'unverified'.
   *
   * @param {string} materialId
   * @param {string} contentSha256
   * @param {number} totalPages
   * @returns {{ success: boolean, materialId: string, contentSha256: string, totalPages: number }}
   */
  replaceContentIdentity(materialId, contentSha256, totalPages) {
    if (!materialId || typeof materialId !== "string") {
      throw new TypeError("materialId must be a non-empty string");
    }
    if (!contentSha256 || typeof contentSha256 !== "string" || !/^[0-9a-fA-F]{64}$/.test(contentSha256)) {
      throw new TypeError("contentSha256 must be a 64-character hex string");
    }
    if (typeof totalPages !== "number" || !Number.isSafeInteger(totalPages) || totalPages < 1) {
      throw new TypeError("totalPages must be a safe integer >= 1");
    }

    const canonicalSha256 = contentSha256.toLowerCase();
    const now = new Date().toISOString();

    this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
      // 1. Update/insert content identity cache
      this.db.prepare(`
        INSERT INTO material_content_identities (material_id, content_sha256, total_pages, verified_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(material_id) DO UPDATE SET
          content_sha256 = excluded.content_sha256,
          total_pages = excluded.total_pages,
          verified_at = excluded.verified_at
      `).run(materialId, canonicalSha256, totalPages, now);

      // 2. Atomically invalidate drifted or out-of-bounds bookmarks
      this.db.prepare(`
        UPDATE material_bookmarks
        SET status = 'unverified', updated_at = ?
        WHERE material_id = ?
          AND (originating_content_sha256 != ? OR page_index > ? OR page_index < 1)
      `).run(now, materialId, canonicalSha256, totalPages);

      // 3. Atomically invalidate drifted or out-of-bounds reading state
      this.db.prepare(`
        UPDATE material_reading_state
        SET status = 'unverified', updated_at = ?
        WHERE material_id = ?
          AND (originating_content_sha256 != ? OR last_requested_page > ? OR last_requested_page < 1)
      `).run(now, materialId, canonicalSha256, totalPages);

      this.db.exec("COMMIT;");
      return { success: true, materialId, contentSha256: canonicalSha256, totalPages };
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }

  /**
   * Public identity saver: delegates directly to atomic replacement.
   *
   * @param {string} materialId
   * @param {string} contentSha256
   * @param {number} totalPages
   */
  saveContentIdentity(materialId, contentSha256, totalPages) {
    return this.replaceContentIdentity(materialId, contentSha256, totalPages);
  }

  /**
   * Adds a new bookmark bound to its originating document content hash.
   * Enforces persisted content identity: bookmarks exceeding persisted bounds
   * or matching incompatible hashes are persisted visibly as 'unverified'.
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

    // Consult persisted active content identity
    const identity = this.db.prepare(`
      SELECT content_sha256, total_pages
      FROM material_content_identities
      WHERE material_id = ?
    `).get(bookmark.materialId);

    let status = bookmark.status || "verified";

    // If no identity exists, or bounds exceeded, or hash mismatch, cannot be verified
    if (
      !identity ||
      !Number.isSafeInteger(identity.total_pages) ||
      identity.total_pages < 1 ||
      bookmark.pageIndex > identity.total_pages ||
      bookmark.originatingContentSha256.toLowerCase() !== identity.content_sha256.toLowerCase()
    ) {
      status = "unverified";
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
      status,
      now,
      now
    );
  }

  /**
   * Saves or updates reading state for a material.
   * Enforces persisted content identity: reading positions exceeding persisted bounds
   * or matching incompatible hashes cannot be persisted as 'active'.
   *
   * @param {string} materialId
   * @param {number} lastRequestedPage
   * @param {object} options
   * @param {string} [options.label]
   * @param {string} options.contentSha256
   * @param {boolean} [options.confirmedRead=false]
   */
  saveReadingState(materialId, lastRequestedPage, options = {}) {
    if (!Number.isSafeInteger(lastRequestedPage) || lastRequestedPage < 1) {
      throw new TypeError("lastRequestedPage must be a safe integer >= 1");
    }

    // Consult persisted content identity
    const identity = this.db.prepare(`
      SELECT content_sha256, total_pages
      FROM material_content_identities
      WHERE material_id = ?
    `).get(materialId);

    let status = "active";
    if (
      !identity ||
      !Number.isSafeInteger(identity.total_pages) ||
      identity.total_pages < 1 ||
      lastRequestedPage > identity.total_pages ||
      (options.contentSha256 && options.contentSha256.toLowerCase() !== identity.content_sha256.toLowerCase())
    ) {
      status = "unverified";
    }

    const confirmed = options.confirmedRead ? 1 : 0;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO material_reading_state (
        material_id, last_requested_page, last_requested_page_label,
        confirmed_read, originating_content_sha256, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(material_id) DO UPDATE SET
        last_requested_page = excluded.last_requested_page,
        last_requested_page_label = excluded.last_requested_page_label,
        confirmed_read = excluded.confirmed_read,
        originating_content_sha256 = excluded.originating_content_sha256,
        status = excluded.status,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      materialId,
      lastRequestedPage,
      options.label || null,
      confirmed,
      options.contentSha256,
      status,
      now
    );
  }

  /**
   * Reconciles all bookmarks for a material upon document replacement or update.
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
}
