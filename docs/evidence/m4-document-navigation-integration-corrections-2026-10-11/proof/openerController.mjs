/**
 * Her Flight Deck - Opener Controller & Durable Save Ownership
 * M4-R11: Scope progress by material AND content identity.
 * Commit ownership fencing prevents obsolete persistence callbacks from overwriting newer progress.
 * Honest partial-save reporting and deliberate save-only recovery.
 */

export class OpenerController {
  /**
   * @param {object} [options]
   * @param {Function} [options.injectedOpener] async (filePath, targetPage) => void
   * @param {Function} [options.injectedPersistence] async (materialId, page, options) => void
   */
  constructor({ injectedOpener, injectedPersistence } = {}) {
    this.injectedOpener = injectedOpener || (async () => {});
    this.injectedPersistence = injectedPersistence || null;
    this.intentCounter = 0;
    this.currentIntentId = 0;
    this.state = "idle"; // 'idle' | 'opening' | 'opened' | 'failed' | 'aborted' | 'opened_unsaved'
    this.lastNotice = null;
    this.currentMaterialId = null;
    this.currentContentSha256 = null;

    // Scoped strictly by material ID AND content SHA-256
    // key: `${materialId}:${contentSha256 || 'unknown'}` -> { lastRequestedPage, confirmedRead }
    this.readingStateByContent = new Map();

    // Commit ownership fences per material ID
    this.activePersistFence = new Map(); // materialId -> intentId
    this.latestPersistedPageByMaterial = new Map(); // materialId -> page
  }

  /**
   * Helper to retrieve last requested page scoped by material AND content hash.
   *
   * @param {string | null} materialId
   * @param {string | null} [contentSha256]
   * @returns {number | null}
   */
  getLastRequestedPage(materialId, contentSha256) {
    if (!materialId) return null;
    const key = `${materialId}:${contentSha256 || "unknown"}`;
    return this.readingStateByContent.get(key)?.lastRequestedPage ?? null;
  }

  /**
   * Public progress accessor: returns the last requested page for the currently active route.
   * Strictly scoped to the currently active material and content identity.
   */
  get lastRequestedPage() {
    return this.getLastRequestedPage(this.currentMaterialId, this.currentContentSha256);
  }

  /**
   * Requests opening a material document at a target page.
   *
   * @param {object} material
   * @param {string} material.id
   * @param {string} [material.title]
   * @param {string | null} [material.filePath]
   * @param {string} [material.contentSha256]
   * @param {number} [material.totalPages]
   * @param {number} targetPage
   * @param {string | null} [pageLabel]
   * @returns {Promise<object>}
   */
  async requestOpen(material, targetPage, pageLabel = null) {
    // 1. Advance route and intent generation BEFORE validation and awaits
    const intentId = ++this.intentCounter;
    this.currentIntentId = intentId;
    this.state = "opening";
    this.lastNotice = null; // Clear stale notices immediately
    this.currentMaterialId = material?.id || null;
    this.currentContentSha256 = material?.contentSha256 || null;

    // 2. Validate material identity and file path
    if (!material || !material.id) {
      this.state = "failed";
      return {
        success: false,
        state: "failed",
        error: "Invalid material reference",
        lastRequestedPage: null,
      };
    }

    if (!material.filePath) {
      this.state = "failed";
      return {
        success: false,
        state: "failed",
        error: "Missing document file path",
        lastRequestedPage: null,
      };
    }

    // 3. Validate physical destination and bounds BEFORE invoking opener
    if (typeof targetPage !== "number" || !Number.isSafeInteger(targetPage) || targetPage < 1) {
      this.state = "failed";
      return {
        success: false,
        state: "failed",
        error: "Invalid physical page destination: must be a safe integer >= 1",
        lastRequestedPage: this.getLastRequestedPage(material.id, material.contentSha256),
      };
    }

    if (material.totalPages !== undefined && material.totalPages !== null) {
      if (!Number.isSafeInteger(material.totalPages) || material.totalPages < 1 || targetPage > material.totalPages) {
        this.state = "failed";
        return {
          success: false,
          state: "failed",
          error: `Destination page ${targetPage} exceeds total pages ${material.totalPages}`,
          lastRequestedPage: this.getLastRequestedPage(material.id, material.contentSha256),
        };
      }
    }

    // 4. Invoke injected native opener
    try {
      await this.injectedOpener(material.filePath, targetPage);
    } catch (err) {
      // If superseded while opener was in flight, abort silently
      if (this.currentIntentId !== intentId) {
        return {
          success: false,
          state: "aborted",
          superseded: true,
          lastRequestedPage: this.getLastRequestedPage(material.id, material.contentSha256),
        };
      }
      this.state = "failed";
      this.lastNotice = null;
      return {
        success: false,
        state: "failed",
        error: `Could not open document: ${err.message}`,
        lastRequestedPage: this.getLastRequestedPage(material.id, material.contentSha256),
      };
    }

    // 5. Check if operation was superseded while opener was awaiting
    if (this.currentIntentId !== intentId) {
      return {
        success: false,
        state: "aborted",
        superseded: true,
        lastRequestedPage: this.getLastRequestedPage(material.id, material.contentSha256),
      };
    }

    // 6. Invoke injected durable persistence boundary with commit ownership fence
    this.activePersistFence.set(material.id, intentId);
    let saveError = null;

    if (this.injectedPersistence) {
      try {
        await this.injectedPersistence(material.id, targetPage, {
          label: pageLabel,
          contentSha256: material.contentSha256,
          intentId,
        });
      } catch (pErr) {
        saveError = pErr.message;
      }
    }

    // 7. Check supersession and commit fence after persistence await
    const currentFence = this.activePersistFence.get(material.id);
    if (this.currentIntentId !== intentId || (currentFence !== undefined && currentFence !== intentId)) {
      // An obsolete save finished! If a newer save committed for this material,
      // enforce the fence on the database by restoring the newer page
      const newerPage = this.latestPersistedPageByMaterial.get(material.id);
      if (newerPage !== undefined && newerPage !== targetPage && this.injectedPersistence) {
        try {
          await this.injectedPersistence(material.id, newerPage, {
            label: pageLabel,
            contentSha256: material.contentSha256,
            intentId: currentFence,
          });
        } catch {
          // Ignore secondary repair errors
        }
      }
      return {
        success: false,
        state: "aborted",
        superseded: true,
        lastRequestedPage: newerPage ?? null,
      };
    }

    // 8. Commit successful opening state
    if (!saveError) {
      this.latestPersistedPageByMaterial.set(material.id, targetPage);
      const contentKey = `${material.id}:${material.contentSha256 || "unknown"}`;
      this.readingStateByContent.set(contentKey, {
        lastRequestedPage: targetPage,
        confirmedRead: false, // Opening NEVER marks reading confirmed
      });
    }

    const labelSnippet = pageLabel ? ` (printed '${pageLabel}')` : "";
    if (saveError) {
      this.state = "opened_unsaved";
      this.lastNotice = `Opened '${material.title || "document"}' in default viewer. Turn to page ${targetPage}${labelSnippet} (Warning: reading position could not be saved: ${saveError}).`;
      return {
        success: true,
        state: "opened_unsaved",
        notice: this.lastNotice,
        lastRequestedPage: targetPage,
        confirmedRead: false,
        saveError,
        savePending: true,
        retrySave: () => this.retrySave(material, targetPage, pageLabel, intentId),
      };
    }

    this.state = "opened";
    this.lastNotice = `Opened '${material.title || "document"}' in default viewer. Turn to page ${targetPage}${labelSnippet}.`;
    return {
      success: true,
      state: "opened",
      notice: this.lastNotice,
      lastRequestedPage: targetPage,
      confirmedRead: false,
      saveError: null,
    };
  }

  /**
   * Save-only retry for partial save failures:
   * Carries the same immutable valid ownership without re-invoking the native opener.
   *
   * @param {object} material
   * @param {number} targetPage
   * @param {string | null} [pageLabel]
   * @param {number} [originalIntentId]
   * @returns {Promise<object>}
   */
  async retrySave(material, targetPage, pageLabel = null, originalIntentId = null) {
    // Route ownership check: refuse retry if user switched material or content
    if (this.currentMaterialId !== material.id || this.currentContentSha256 !== material.contentSha256) {
      return { success: false, state: "aborted", error: "Route changed before retry" };
    }

    if (this.injectedPersistence) {
      try {
        await this.injectedPersistence(material.id, targetPage, {
          label: pageLabel,
          contentSha256: material.contentSha256,
          intentId: originalIntentId ?? this.currentIntentId,
        });
        this.latestPersistedPageByMaterial.set(material.id, targetPage);
        const contentKey = `${material.id}:${material.contentSha256 || "unknown"}`;
        this.readingStateByContent.set(contentKey, {
          lastRequestedPage: targetPage,
          confirmedRead: false,
        });
        this.state = "opened";
        return { success: true, lastRequestedPage: targetPage };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: "No persistence handler available" };
  }

  /**
   * Explicitly aborts any active in-flight open operation.
   */
  abort() {
    this.currentIntentId = ++this.intentCounter;
    this.state = "aborted";
    this.lastNotice = null;
  }
}
