/**
 * Her Flight Deck - Persistence Protocol & Atomic Revalidation (round 2)
 *
 * M4-R13: navigation commits are fenced by a durable owner generation. An obsolete in-flight save
 *         is rejected INSIDE the transaction and the protocol reports whether it committed, so the
 *         controller never has to re-cover a write that already landed.
 * M4-R14: the page, content hash and printed label are written as one immutable tuple belonging to
 *         the winning operation; nothing here accepts a caller-chosen "verified/active" status.
 * M4-R19: hashes are canonicalized at the boundary; unknown/missing/malformed identity is persisted
 *         as `unverified` with a NULL hash instead of throwing an engine-dependent SQLite error.
 *
 * Retained from the accepted round: the single BEGIN IMMEDIATE replacement transaction that updates
 * identity and invalidates drifted/out-of-bounds bookmarks and reading state together, bound- and
 * identity-checking navigation writers, and reconciliation that cannot reverify without bounds.
 */
import { DatabaseSync } from "node:sqlite";
import { canonicalContentHash, isSafeCount, reconcileBookmarksOnContentDrift } from "./contractModel.mjs";

export class DocumentPersistenceProtocol {
  /** @param {DatabaseSync} db */
  constructor(db) {
    this.db = db;
  }

  /** Applies candidate migration 0015 DDL to the active (disposable) database. */
  applyCandidateDdl(ddlSql) {
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(ddlSql);
  }

  /** Trusted persisted identity for a material, or null when nothing has been verified yet. */
  getCurrentIdentity(materialId) {
    if (typeof materialId !== "string" || materialId.length === 0) return null;
    const row = this.db
      .prepare("SELECT content_sha256, total_pages FROM material_content_identities WHERE material_id = ?")
      .get(materialId);
    if (!row) return null;
    const hash = canonicalContentHash(row.content_sha256);
    if (!hash || !isSafeCount(row.total_pages)) return null;
    return {
      contentSha256: hash,
      totalPages: row.total_pages,
      ownerGeneration: this.getOwnerGeneration(materialId),
      reserveOwnership: (base) => this.reserveOperationOwnership(materialId, base),
      cancelOperation: (gen) => this.cancelOperation(materialId, gen),
    };
  }

  /** The durable owner generation currently recorded for a material (0 when absent). */
  getOwnerGeneration(materialId) {
    if (!materialId || typeof materialId !== "string") return 0;
    const row = this.db
      .prepare("SELECT owner_generation FROM material_reading_state WHERE material_id = ?")
      .get(materialId);
    return row ? Number(row.owner_generation) : 0;
  }

  /** Highest durable owner generation recorded across the database (or for a material). */
  getHighestGeneration(materialId = null) {
    if (materialId) return this.getOwnerGeneration(materialId);
    const row = this.db.prepare("SELECT MAX(owner_generation) AS max_gen FROM material_reading_state").get();
    return row && row.max_gen !== null ? Number(row.max_gen) : 0;
  }

  /**
   * M4-R28/R33: reserves the next durable operation token under the database write lock.
   *
   * The token is returned only after its claim row has committed. Any failure to read the claim or
   * reading state, or to write the claim (a missing claims table, a constraint, an ABORT trigger),
   * rolls the transaction back and is thrown to the caller. No token is ever issued that is not
   * durably recorded, so two callers can never both be told they own the same generation.
   * Tokens are strictly increasing per material: max(saved owner, latest claim, client base) + 1.
   * M4-R38: before committing, the write must change exactly one row and a read-back inside the same
   * transaction must find that exact token persisted.
   */
  reserveOperationOwnership(materialId, clientBase = null) {
    if (!materialId || typeof materialId !== "string") {
      throw new TypeError("materialId must be a non-empty string");
    }
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
      const claimRow = this.db
        .prepare("SELECT reserved_generation FROM material_operation_claims WHERE material_id = ?")
        .get(materialId);
      const reservedGen = claimRow ? Number(claimRow.reserved_generation) : 0;
      const stateRow = this.db
        .prepare("SELECT owner_generation FROM material_reading_state WHERE material_id = ?")
        .get(materialId);
      const savedGen = stateRow ? Number(stateRow.owner_generation) : 0;
      const client = clientBase !== null && Number.isSafeInteger(clientBase) && clientBase > 0 ? clientBase : 0;

      const base = Math.max(savedGen, reservedGen, client);
      if (base >= Number.MAX_SAFE_INTEGER - 1) {
        throw new RangeError("Operation generation counter overflow");
      }
      const nextGen = base + 1;

      const write = this.db.prepare(`
        INSERT INTO material_operation_claims (material_id, reserved_generation, cancelled_generation, updated_at)
        VALUES (?, ?, 0, ?)
        ON CONFLICT(material_id) DO UPDATE SET
          reserved_generation = excluded.reserved_generation,
          updated_at = excluded.updated_at
      `).run(materialId, nextGen, now);

      // M4-R38: a statement that runs without error is not proof that the claim exists. A
      // RAISE(IGNORE) trigger, for example, skips the write silently. Require exactly one row to
      // change, then read the claim back inside this same transaction and require it to hold
      // exactly the token about to be issued. Anything else rolls back and is thrown.
      if (Number(write?.changes) !== 1) {
        throw new Error(`Claim write did not take effect (${Number(write?.changes) || 0} rows changed); no token issued`);
      }
      const persisted = this.db
        .prepare("SELECT reserved_generation FROM material_operation_claims WHERE material_id = ?")
        .get(materialId);
      if (!persisted || Number(persisted.reserved_generation) !== nextGen) {
        throw new Error(
          `Claim did not persist token ${nextGen} (found ${persisted ? Number(persisted.reserved_generation) : "no claim"}); no token issued`
        );
      }

      this.db.exec("COMMIT;");
      return nextGen;
    } catch (err) {
      try { this.db.exec("ROLLBACK;"); } catch { /* already rolled back by an ABORT trigger */ }
      throw err;
    }
  }

  /**
   * M4-R29: Cancels an in-flight operation token under write lock so it cannot commit to storage even if released late.
   */
  cancelOperation(materialId, generation) {
    if (!materialId || typeof materialId !== "string" || !Number.isSafeInteger(generation) || generation < 1) {
      return false;
    }
    const now = new Date().toISOString();
    try {
      this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
      this.db.prepare(`
        INSERT INTO material_operation_claims (material_id, reserved_generation, cancelled_generation, updated_at)
        VALUES (?, 0, ?, ?)
        ON CONFLICT(material_id) DO UPDATE SET
          cancelled_generation = MAX(material_operation_claims.cancelled_generation, excluded.cancelled_generation),
          updated_at = excluded.updated_at
      `).run(materialId, generation, now);
      this.db.exec("COMMIT;");
      return true;
    } catch {
      try { this.db.exec("ROLLBACK;"); } catch {}
      return false;
    }
  }

  /**
   * Atomically replaces content identity and reconciles navigation validity in one transaction.
   * Identity upsert, bookmark invalidation and reading-state invalidation commit or roll back
   * together; prior rows keep their original hashes and coordinates and become visibly unverified.
   */
  replaceContentIdentity(materialId, contentSha256, totalPages) {
    if (!materialId || typeof materialId !== "string") {
      throw new TypeError("materialId must be a non-empty string");
    }
    const canonical = canonicalContentHash(contentSha256);
    if (!canonical) throw new TypeError("contentSha256 must be a 64-character hex string");
    if (!isSafeCount(totalPages)) throw new TypeError("totalPages must be a safe integer >= 1");

    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
      this.db.prepare(`
        INSERT INTO material_content_identities (material_id, content_sha256, total_pages, verified_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(material_id) DO UPDATE SET
          content_sha256 = excluded.content_sha256,
          total_pages = excluded.total_pages,
          verified_at = excluded.verified_at
      `).run(materialId, canonical, totalPages, now);

      this.db.prepare(`
        UPDATE material_bookmarks
        SET status = 'unverified', updated_at = ?
        WHERE material_id = ?
          AND (originating_content_sha256 IS NULL
               OR originating_content_sha256 != ?
               OR page_index > ? OR page_index < 1)
      `).run(now, materialId, canonical, totalPages);

      this.db.prepare(`
        UPDATE material_reading_state
        SET status = 'unverified', updated_at = ?
        WHERE material_id = ?
          AND (originating_content_sha256 IS NULL
               OR originating_content_sha256 != ?
               OR last_requested_page > ? OR last_requested_page < 1)
      `).run(now, materialId, canonical, totalPages);

      this.db.exec("COMMIT;");
      return { success: true, materialId, contentSha256: canonical, totalPages };
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }

  /** Public identity saver: delegates directly to the atomic replacement. */
  saveContentIdentity(materialId, contentSha256, totalPages) {
    return this.replaceContentIdentity(materialId, contentSha256, totalPages);
  }

  /**
   * M4-R13/R14/R19: the only durable navigation writer.
   *
   * Ownership is validated inside the transaction: the stored row's `owner_generation` is read
   * under the write lock and an incoming save whose generation is older than the recorded owner is
   * rejected without touching the row. The page, content hash and printed label always move
   * together as one tuple belonging to the winning operation, and `status` is derived here from
   * the trusted persisted identity — callers cannot choose it.
   *
   * The strict complete-record requirement lives on the opener path (`isResolvedDestination`);
   * here a destination that lacks a trusted count or a usable hash is still persisted, but only as
   * `unverified`, so an unknown identity is a visible durable state rather than a thrown error.
   *
   * @returns {{committed: boolean, status: string|null, persistedPage: number|null, reason?: string}}
   */
  commitNavigation(destination, generation, opts = {}) {
    if (!Number.isSafeInteger(generation) || generation < 1) {
      return { committed: false, status: null, persistedPage: null, reason: "generation must be a safe integer >= 1" };
    }
    if (!destination || typeof destination !== "object") {
      return { committed: false, status: null, persistedPage: null, reason: "destination record is required" };
    }
    const { materialId, contentSha256, physicalPage, pageLabel } = destination;
    if (typeof materialId !== "string" || materialId.length === 0) {
      return { committed: false, status: null, persistedPage: null, reason: "material identity missing" };
    }
    if (!Number.isSafeInteger(physicalPage) || physicalPage < 1) {
      return { committed: false, status: null, persistedPage: null, reason: "physical page must be a safe integer >= 1" };
    }
    const hash = canonicalContentHash(contentSha256);
    const now = new Date().toISOString();
    const confirmed = opts.confirmedRead ? 1 : 0;

    this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
      const current = this.db
        .prepare("SELECT owner_generation, last_requested_page FROM material_reading_state WHERE material_id = ?")
        .get(materialId);
      const savedGen = current ? Number(current.owner_generation) : 0;

      // M4-R34: ownership is read inside this write transaction. A read failure is a rejection,
      // never a silent "no claim" that lets the write through.
      let claimRow;
      try {
        claimRow = this.db
          .prepare("SELECT reserved_generation, cancelled_generation FROM material_operation_claims WHERE material_id = ?")
          .get(materialId);
      } catch (err) {
        try { this.db.exec("ROLLBACK;"); } catch { /* nothing to roll back */ }
        return {
          committed: false,
          status: null,
          persistedPage: current ? Number(current.last_requested_page) : null,
          reason: `ownership-unreadable: ${err.message}`,
        };
      }

      // M4-R29: a cancelled destination or token cannot commit, even if released late.
      const isCancelled = (typeof destination.isCancelled === "function" && destination.isCancelled()) ||
        (claimRow && Number(claimRow.cancelled_generation) >= generation);
      if (isCancelled) {
        this.db.prepare(`
          INSERT INTO material_operation_claims (material_id, reserved_generation, cancelled_generation, updated_at)
          VALUES (?, 0, ?, ?)
          ON CONFLICT(material_id) DO UPDATE SET
            cancelled_generation = MAX(material_operation_claims.cancelled_generation, excluded.cancelled_generation),
            updated_at = excluded.updated_at
        `).run(materialId, generation, now);
        this.db.exec("COMMIT;");
        return {
          committed: false,
          status: null,
          persistedPage: current ? Number(current.last_requested_page) : null,
          reason: "cancelled",
        };
      }

      // M4-R34: only the exact, currently reserved token may write. No claim, an older token
      // (superseded by a later reservation) and a never-reserved future token are all rejected.
      const reservedGen = claimRow ? Number(claimRow.reserved_generation) : 0;
      if (!claimRow || reservedGen !== generation) {
        this.db.exec("COMMIT;");
        return {
          committed: false,
          status: null,
          persistedPage: current ? Number(current.last_requested_page) : null,
          ownerGeneration: reservedGen,
          reason: !claimRow ? "unreserved" : reservedGen > generation ? "superseded" : "unreserved",
        };
      }

      if (current && Number(current.owner_generation) >= generation) {
        this.db.exec("COMMIT;");
        return {
          committed: false,
          status: null,
          persistedPage: Number(current.last_requested_page),
          ownerGeneration: Number(current.owner_generation),
          reason: "superseded",
        };
      }

      // Status is derived from the trusted persisted identity, never from the caller.
      const identity = this.getCurrentIdentity(materialId);
      let status = "active";
      if (!identity || !hash || hash !== identity.contentSha256 || physicalPage > identity.totalPages) {
        status = "unverified";
      }

      this.db.prepare(`
        INSERT INTO material_reading_state (
          material_id, last_requested_page, last_requested_page_label,
          confirmed_read, originating_content_sha256, status, owner_generation, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(material_id) DO UPDATE SET
          last_requested_page = excluded.last_requested_page,
          last_requested_page_label = excluded.last_requested_page_label,
          confirmed_read = excluded.confirmed_read,
          originating_content_sha256 = excluded.originating_content_sha256,
          status = excluded.status,
          owner_generation = excluded.owner_generation,
          updated_at = excluded.updated_at
      `).run(materialId, physicalPage, pageLabel ?? null, confirmed, hash, status, generation, now);

      // The claim is left as it is: tokens only ever increase, so a committed token can never be
      // reused, and the saved owner check above rejects any repeat of it.
      const persisted = this.db
        .prepare("SELECT last_requested_page FROM material_reading_state WHERE material_id = ?")
        .get(materialId);
      this.db.exec("COMMIT;");
      return { committed: true, status, persistedPage: Number(persisted.last_requested_page), ownerGeneration: generation };
    } catch (err) {
      try { this.db.exec("ROLLBACK;"); } catch { /* already rolled back by an ABORT trigger */ }
      throw err;
    }
  }

  /**
   * Adds a bookmark bound to its originating content. Unknown/missing/malformed identity yields a
   * visible `unverified` row rather than an exception (M4-R19); out-of-bounds pages likewise.
   *
   * @returns {{status: string, reason: string|null}}
   */
  addBookmark(bookmark) {
    if (!Number.isSafeInteger(bookmark.pageIndex) || bookmark.pageIndex < 1) {
      throw new TypeError("Bookmark pageIndex must be a safe integer >= 1");
    }
    const origin = canonicalContentHash(bookmark.originatingContentSha256);
    const identity = this.getCurrentIdentity(bookmark.materialId);

    let status = bookmark.status && bookmark.status !== "verified" ? bookmark.status : "verified";
    let reason = null;
    if (!origin) {
      status = "unverified";
      reason = "content identity missing or malformed";
    } else if (!identity) {
      status = "unverified";
      reason = "no trusted content identity recorded";
    } else if (origin !== identity.contentSha256) {
      status = "unverified";
      reason = "originating hash differs from active identity";
    } else if (bookmark.pageIndex > identity.totalPages) {
      status = "unverified";
      reason = `page ${bookmark.pageIndex} exceeds persisted ${identity.totalPages}`;
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO material_bookmarks (
        id, material_id, page_index, page_label,
        originating_content_sha256, title, notes, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      bookmark.id,
      bookmark.materialId,
      bookmark.pageIndex,
      bookmark.pageLabel || null,
      origin, // NULL when unknown: a defined state, never a fabricated digest
      bookmark.title,
      bookmark.notes || "",
      status,
      now,
      now
    );
    return { status, reason };
  }

  /**
   * Reading-state saver kept for direct callers: routes through the fenced commit so it cannot
   * bypass ownership. `options.generation` is mandatory — a save without an operation token is
   * rejected rather than committed, which is what keeps R13 from regressing through this path.
   */
  saveReadingState(materialId, lastRequestedPage, options = {}) {
    const destination = {
      materialId,
      coordinateSpace: "material_physical",
      contentSha256: options.contentSha256 ?? null,
      physicalPage: lastRequestedPage,
      totalPages: options.totalPages ?? null,
      pageLabel: options.label ?? null,
      provenance: "physical_index",
    };
    return this.commitNavigation(destination, options.generation ?? 0, { confirmedRead: options.confirmedRead });
  }

  /**
   * Reconciles all bookmarks for a material upon document replacement or update, in one transaction.
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

    this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
      const updateStmt = this.db.prepare("UPDATE material_bookmarks SET status = ?, updated_at = ? WHERE id = ?");
      let verifiedCount = 0;
      let unverifiedCount = 0;
      for (const b of reconciled) {
        updateStmt.run(b.status, now, b.id);
        if (b.status === "verified") verifiedCount += 1;
        else unverifiedCount += 1;
      }
      this.db.exec("COMMIT;");
      return { total: reconciled.length, verified: verifiedCount, unverified: unverifiedCount };
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }
}
