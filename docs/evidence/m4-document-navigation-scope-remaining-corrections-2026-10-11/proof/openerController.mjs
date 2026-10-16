/**
 * Her Flight Deck - Opener Controller State Machine (Corrected for M4-R7)
 *
 * Implements:
 * - Intent-generation advancement BEFORE input validation (R7)
 * - Supersession: newer missing-path or invalid requests supersede earlier pending opens (R7)
 * - Clear stale notices on all failure and abort paths (R7)
 * - Material-scoped reading progress: failing material B never exposes material A's page (R7)
 * - Destination pre-validation before opener invocation (R7)
 * - Injected durable persistence with partial failure handling ("opened but position not saved") (R7)
 * - Explicit abort handling
 */

export class OpenerController {
  /**
   * @param {object} [options]
   * @param {Function} [options.injectedOpener] Async function (filePath, targetPage) => Promise<void>
   * @param {Function} [options.injectedPersistence] Async function (materialId, targetPage, meta) => Promise<void>
   */
  constructor({ injectedOpener, injectedPersistence } = {}) {
    this.injectedOpener = injectedOpener || (async () => {});
    this.injectedPersistence = injectedPersistence || null;
    this.intentCounter = 0;
    this.currentIntentId = 0;
    this.state = "idle"; // 'idle' | 'opening' | 'opened' | 'failed' | 'aborted'
    this.lastNotice = null;
    this.currentMaterialId = null;
    this.readingStateByMaterial = new Map(); // materialId -> { lastRequestedPage, confirmedRead }
  }

  /**
   * Requests opening a material document at a target page.
   *
   * @param {object} material
   * @param {string} material.id
   * @param {string} material.title
   * @param {string | null} material.filePath
   * @param {string} [material.contentSha256]
   * @param {number} targetPage
   * @param {string | null} [pageLabel]
   * @returns {Promise<object>}
   */
  async requestOpen(material, targetPage, pageLabel = null) {
    // 1. Advance intent generation BEFORE validation (R7)
    const intentId = ++this.intentCounter;
    this.currentIntentId = intentId;
    this.state = "opening";
    this.lastNotice = null; // Clear stale notice immediately

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

    // 3. Validate physical destination before calling opener (R7)
    if (typeof targetPage !== "number" || !Number.isSafeInteger(targetPage) || targetPage < 1) {
      this.state = "failed";
      return {
        success: false,
        state: "failed",
        error: "Invalid physical page destination: must be a safe integer >= 1",
        lastRequestedPage: this.readingStateByMaterial.get(material.id)?.lastRequestedPage ?? null,
      };
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
          lastRequestedPage: this.readingStateByMaterial.get(material.id)?.lastRequestedPage ?? null,
        };
      }
      this.state = "failed";
      this.lastNotice = null;
      return {
        success: false,
        state: "failed",
        error: `Could not open document: ${err.message}`,
        lastRequestedPage: this.readingStateByMaterial.get(material.id)?.lastRequestedPage ?? null,
      };
    }

    // 5. Check if operation was superseded or aborted while opener was awaiting
    if (this.currentIntentId !== intentId) {
      return {
        success: false,
        state: "aborted",
        superseded: true,
        lastRequestedPage: this.readingStateByMaterial.get(material.id)?.lastRequestedPage ?? null,
      };
    }

    // 6. Invoke injected durable persistence boundary (R7)
    let saveError = null;
    if (this.injectedPersistence) {
      try {
        await this.injectedPersistence(material.id, targetPage, {
          label: pageLabel,
          contentSha256: material.contentSha256,
        });
      } catch (pErr) {
        saveError = pErr.message;
      }
    }

    // 7. Check supersession again after persistence await
    if (this.currentIntentId !== intentId) {
      return {
        success: false,
        state: "aborted",
        superseded: true,
        lastRequestedPage: this.readingStateByMaterial.get(material.id)?.lastRequestedPage ?? null,
      };
    }

    // 8. Commit successful opening state
    this.state = "opened";
    this.currentMaterialId = material.id;
    this.readingStateByMaterial.set(material.id, {
      lastRequestedPage: targetPage,
      confirmedRead: false, // Opening NEVER marks reading confirmed (R4/R7)
    });

    const labelSnippet = pageLabel ? ` (printed '${pageLabel}')` : "";
    if (saveError) {
      this.lastNotice = `Opened '${material.title}' in default viewer. Turn to page ${targetPage}${labelSnippet} (Warning: reading position could not be saved: ${saveError}).`;
    } else {
      this.lastNotice = `Opened '${material.title}' in default viewer. Turn to page ${targetPage}${labelSnippet}.`;
    }

    return {
      success: true,
      state: "opened",
      notice: this.lastNotice,
      lastRequestedPage: targetPage,
      confirmedRead: false,
      saveError,
    };
  }

  /**
   * Explicitly aborts any active in-flight open operation.
   */
  abort() {
    this.currentIntentId = ++this.intentCounter;
    this.state = "aborted";
    this.lastNotice = null;
  }

  /**
   * Returns the last requested page for the currently active material.
   * Scoped to the material; returns null if no material is active or on failure.
   */
  get lastRequestedPage() {
    if (!this.currentMaterialId) return null;
    return this.readingStateByMaterial.get(this.currentMaterialId)?.lastRequestedPage ?? null;
  }
}
