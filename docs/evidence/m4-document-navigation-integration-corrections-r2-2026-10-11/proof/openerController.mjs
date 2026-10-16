/**
 * Her Flight Deck - Opener Controller & Durable Save Ownership (round 2)
 *
 * M4-R13: the controller hands the durable layer an immutable operation generation and CONSUMES
 *         the commit verdict. It never writes a second time to re-cover a stale commit, and it
 *         never swallows a persistence failure.
 * M4-R14: only the winning operation's own (page, content hash, printed label) tuple is committed.
 * M4-R17: the controller accepts only a validated destination record; bounds come from the trusted
 *         count inside that record (and are re-checked against the persisted identity when an
 *         identity provider is supplied), never from a self-reported caller page/count pair.
 *
 * M4-R37: a local request epoch retires older work synchronously at entry, before any ownership
 *         read or reservation can fail, so a newer failed request still supersedes a held opener,
 *         save or save-only retry. The epoch is never used as a durable token.
 *
 * Retained: route/intent ownership advanced before every await; progress and publication scoped by
 * material AND content; non-leaking public getter; unresolved labels get explicit native-open
 * guidance without inventing a persisted page; early missing-path supersession and abort; honest
 * partial-save reporting with a deliberate save-only retry that never replays the opener; opening
 * never marks reading confirmed.
 */
import { isResolvedDestination } from "./contractModel.mjs";

export class OpenerController {
  /**
   * @param {object} [options]
   * @param {Function} [options.injectedOpener] async (filePath, targetPage) => void
   * @param {Function} [options.injectedPersistence] async (destination, generation, opts) => commit verdict
   * @param {Function} [options.identityProvider] (materialId) => { contentSha256, totalPages, ownerGeneration, reserveOwnership?, cancelOperation? } | null
   * @param {Function} [options.generationSource] (materialId) => number | null
   */
  constructor({ injectedOpener, injectedPersistence, identityProvider, generationSource } = {}) {
    this.injectedOpener = injectedOpener || (async () => {});
    this.injectedPersistence = injectedPersistence || null;
    this.identityProvider = identityProvider || null;
    this.generationSource = generationSource || null;
    this.intentCounter = 0;
    this.currentIntentId = 0;
    this.state = "idle"; // idle | opening | opened | opened_unsaved | failed | aborted | unresolved
    this.lastNotice = null;
    this.currentMaterialId = null;
    this.currentContentSha256 = null;
    this.readingStateByContent = new Map(); // `${materialId}:${contentSha256}` -> {lastRequestedPage, confirmedRead}
    this.lastCommitVerdict = null;
    this.activeOperation = null;
    // M4-R37: a local request epoch, advanced synchronously on every requestOpen and abort. It is
    // NOT a durable operation token: it only lets a newer request retire older local work even
    // when that newer request then fails to obtain a durable token.
    this.requestEpoch = 0;
  }

  getLastRequestedPage(materialId, contentSha256) {
    if (!materialId) return null;
    return this.readingStateByContent.get(`${materialId}:${contentSha256 || "unknown"}`)?.lastRequestedPage ?? null;
  }

  /** Progress accessor for the currently active route only. */
  get lastRequestedPage() {
    return this.getLastRequestedPage(this.currentMaterialId, this.currentContentSha256);
  }

  /**
   * Requests opening a document at a validated destination.
   *
   * @param {object} material  { id, title?, filePath? }
   * @param {object} record    a resolveDestination()/translateSplitCoordinates() output
   */
  async requestOpen(material, record) {
    // 0. M4-R37: retire every older operation of this controller FIRST, synchronously, before any
    // ownership read or reservation can throw or return. The older operation's opener, save and
    // save-only retry are then refused at their next ownership check, and its live cancellation
    // flag is seen inside the durable commit transaction, whether or not this request goes on to
    // acquire a durable token. No token is invented here.
    const epoch = ++this.requestEpoch;
    this.#retireActiveOperation();

    // 1. Advance route and intent ownership BEFORE any validation or await (M4-R13, M4-R23, M4-R28).
    // An operation's generation is ordered against the durable store across controller instances and sessions.
    let persistedGen;
    try {
      persistedGen =
        (typeof this.generationSource === "function" ? this.generationSource(material?.id) : null) ??
        (typeof this.injectedPersistence?.getHighestGeneration === "function"
          ? this.injectedPersistence.getHighestGeneration(material?.id)
          : null) ??
        (typeof this.identityProvider === "function"
          ? this.identityProvider(material?.id)?.ownerGeneration
          : null) ??
        0;
    } catch (err) {
      // M4-R37: a failed preliminary ownership read is a reported failure, never an unhandled rejection.
      return this.#fail(`Failed to read operation ownership: ${err.message}`);
    }

    const baseGen = Math.max(
      this.intentCounter,
      Number(persistedGen) || 0
    );

    let reservedToken = null;
    let cancelFn = null;
    if (material?.id) {
      if (typeof this.identityProvider === "function") {
        try {
          const idObj = this.identityProvider(material.id);
          if (idObj) {
            if (typeof idObj.reserveOwnership === "function") {
              reservedToken = idObj.reserveOwnership(baseGen);
            }
            if (typeof idObj.cancelOperation === "function") {
              cancelFn = (g) => idObj.cancelOperation(g);
            }
          }
        } catch (err) {
          return this.#fail(`Failed to reserve operation ownership: ${err.message}`);
        }
      }
      if (reservedToken === null && typeof this.generationSource === "function") {
        try {
          const gen = this.generationSource(material.id);
          if (typeof gen === "number" && gen > 0) reservedToken = gen;
        } catch (err) {
          return this.#fail(`Failed to obtain generation from source: ${err.message}`);
        }
      }
      if (reservedToken === null && typeof this.injectedPersistence?.reserveOwnership === "function") {
        try {
          reservedToken = this.injectedPersistence.reserveOwnership(material.id, baseGen);
        } catch (err) {
          return this.#fail(`Failed to reserve operation ownership: ${err.message}`);
        }
      }
    }

    let intentId;
    if (reservedToken !== null) {
      if (!Number.isSafeInteger(reservedToken) || reservedToken >= Number.MAX_SAFE_INTEGER) {
        return this.#fail("Operation generation counter overflow");
      }
      intentId = reservedToken;
    } else {
      if (baseGen >= Number.MAX_SAFE_INTEGER - 1) {
        return this.#fail("Operation generation counter overflow");
      }
      intentId = baseGen + 1;
    }

    this.intentCounter = Math.max(this.intentCounter, intentId);
    this.currentIntentId = intentId;
    this.state = "opening";
    this.lastNotice = null;
    this.lastCommitVerdict = null;
    this.currentMaterialId = material?.id || null;
    this.currentContentSha256 = record?.destination?.contentSha256 ?? null;

    const activeOp = {
      intentId,
      epoch,
      materialId: material?.id ?? null,
      cancelled: false,
      cancel: (g) => {
        if (cancelFn) cancelFn(g);
      },
    };
    this.activeOperation = activeOp;

    if (!material || !material.id) return this.#fail("Invalid material reference");
    if (!material.filePath) return this.#fail("Missing document file path");

    // 2. Only a complete, bounded, content-bound destination may be opened (M4-R17).
    if (!isResolvedDestination(record)) {
      const guidance =
        record?.guidance ||
        `Destination is not verified (${record?.reason ?? "no resolved destination record"}). Open the document and turn to the page manually.`;
      this.state = "unresolved";
      this.lastNotice = guidance;
      return {
        success: false,
        state: "unresolved",
        error: record?.reason ?? "destination record is not resolved",
        guidance,
        openerInvoked: false,
        persistedPage: this.getLastRequestedPage(material.id, this.currentContentSha256),
        lastRequestedPage: this.getLastRequestedPage(material.id, this.currentContentSha256),
      };
    }

    const destination = record.destination;
    if (destination.materialId !== material.id) {
      return this.#fail(`Destination belongs to ${destination.materialId}, not the requested ${material.id}`);
    }

    // 3. Defense in depth: the record's trusted count must match persisted identity when reachable.
    if (this.identityProvider) {
      const identity = this.identityProvider(material.id);
      if (identity && (identity.totalPages !== destination.totalPages || identity.contentSha256 !== destination.contentSha256)) {
        return this.#fail(
          `Destination count ${destination.totalPages} / identity ${destination.contentSha256.slice(0, 8)} does not match persisted identity ${identity.totalPages}/${String(identity.contentSha256).slice(0, 8)}`
        );
      }
    }

    // M4-R29: bind live cancellation state to the destination record
    destination.isCancelled = () => activeOp.cancelled;

    // 4. Invoke the injected native opener.
    try {
      await this.injectedOpener(material.filePath, destination.physicalPage);
    } catch (err) {
      if (!this.#owns(activeOp, intentId, material.id)) {
        return this.#superseded(material.id);
      }
      return this.#fail(`Could not open document: ${err.message}`, destination);
    }

    // 5. Superseded while the opener was in flight: nothing was committed.
    if (!this.#owns(activeOp, intentId, material.id)) {
      return this.#superseded(material.id);
    }

    // 6. Durable commit with this operation's immutable ownership. The verdict is consumed, not re-covered.
    let verdict = { committed: true, status: "active", persistedPage: destination.physicalPage };
    if (this.injectedPersistence) {
      try {
        verdict = await this.injectedPersistence(destination, intentId, {
          label: destination.pageLabel,
          contentSha256: destination.contentSha256,
        });
      } catch (err) {
        if (!this.#owns(activeOp, intentId, material.id)) {
          return this.#superseded(material.id);
        }
        this.state = "opened_unsaved";
        this.lastCommitVerdict = { committed: false, error: err.message };
        // The page really was requested and the document really is open, so it is the route's last
        // requested page — but `saved:false` and the warning notice keep it from being read as saved.
        this.readingStateByContent.set(`${material.id}:${destination.contentSha256 || "unknown"}`, {
          lastRequestedPage: destination.physicalPage,
          confirmedRead: false,
        });
        this.lastNotice = `Opened '${material.title || "document"}' in default viewer. Turn to page ${destination.physicalPage}${labelSnippet(destination)}. (Warning: reading position could not be saved: ${err.message}).`;
        return {
          success: true,
          state: "opened_unsaved",
          notice: this.lastNotice,
          saved: false,
          saveError: err.message,
          savePending: true,
          lastRequestedPage: destination.physicalPage,
          confirmedRead: false,
          retrySave: () => this.retrySave(material, record, intentId, activeOp),
        };
      }
    }

    // M4-R30: check ownership after persistence await
    if (!this.#owns(activeOp, intentId, material.id)) {
      return this.#superseded(material.id, verdict?.persistedPage ?? null);
    }

    this.lastCommitVerdict = verdict;

    // 7. The durable layer rejected this generation: obsolete, and it never wrote.
    if (verdict && verdict.committed === false) {
      if (verdict.reason === "superseded" || verdict.reason === "cancelled") {
        return this.#superseded(material.id, verdict.persistedPage ?? null);
      }
      return this.#fail(`Durable save rejected: ${verdict.reason}`, destination);
    }

    // 8. Commit succeeded for this operation.
    const contentKey = `${material.id}:${destination.contentSha256 || "unknown"}`;
    this.readingStateByContent.set(contentKey, { lastRequestedPage: destination.physicalPage, confirmedRead: false });
    this.state = "opened";
    const savedClause = this.injectedPersistence ? "" : " (no persistence handler: position not saved)";
    this.lastNotice = `Opened '${material.title || "document"}' in default viewer. Turn to page ${destination.physicalPage}${labelSnippet(destination)}.${savedClause}`;
    return {
      success: true,
      state: "opened",
      notice: this.lastNotice,
      saved: Boolean(this.injectedPersistence),
      saveError: null,
      persistedStatus: verdict.status ?? null,
      lastRequestedPage: destination.physicalPage,
      confirmedRead: false,
    };
  }

  /**
   * Deliberate save-only recovery for a partial failure (M4-R11, M4-R24, M4-R30). Re-sends the SAME immutable ownership
   * of the retried operation and never re-invokes the native opener. Once that operation is superseded,
   * the retry is rejected and cannot overwrite newer durable progress.
   */
  async retrySave(material, record, originalIntentId = null, parentActiveOp = null) {
    if (this.currentMaterialId !== material?.id || !isResolvedDestination(record)) {
      return { success: false, state: "aborted", error: "Route changed or destination no longer validated before retry" };
    }
    const startIntent = this.currentIntentId;
    // M4-R37: the operation being retried, and the local request epoch it belongs to. A newer
    // request retires it even when that request fails before acquiring a durable token.
    const liveOp = parentActiveOp ?? this.activeOperation;
    const startEpoch = this.requestEpoch;
    if (liveOp && liveOp.epoch !== undefined && liveOp.epoch !== startEpoch) {
      return {
        success: false,
        state: "aborted",
        superseded: true,
        reason: "superseded",
        persistedPage: this.getLastRequestedPage(material.id, record.destination?.contentSha256),
      };
    }
    const generation = originalIntentId ?? this.currentIntentId;
    if (originalIntentId !== null && this.currentIntentId !== originalIntentId) {
      return {
        success: false,
        state: "aborted",
        superseded: true,
        reason: "superseded",
        persistedPage: this.getLastRequestedPage(material.id, record.destination?.contentSha256),
      };
    }
    if (liveOp?.cancelled) {
      return {
        success: false,
        state: "aborted",
        superseded: true,
        reason: "cancelled",
        persistedPage: this.getLastRequestedPage(material.id, record.destination?.contentSha256),
      };
    }
    if (!this.injectedPersistence) return { success: false, error: "No persistence handler available" };

    const destination = record.destination;
    destination.isCancelled = () => Boolean(liveOp?.cancelled);

    try {
      const verdict = await this.injectedPersistence(destination, generation, {
        label: destination.pageLabel,
        contentSha256: destination.contentSha256,
      });

      // M4-R30: check ownership after retry await
      if (this.currentIntentId !== startIntent || this.requestEpoch !== startEpoch || this.currentMaterialId !== material?.id || liveOp?.cancelled) {
        return {
          success: false,
          state: "aborted",
          superseded: true,
          reason: "superseded",
          persistedPage: this.getLastRequestedPage(material?.id, destination.contentSha256),
        };
      }

      this.lastCommitVerdict = verdict;
      if (verdict && verdict.committed === false) {
        return { success: false, state: "aborted", superseded: true, reason: verdict.reason, persistedPage: verdict.persistedPage ?? null };
      }
      this.readingStateByContent.set(`${material.id}:${destination.contentSha256 || "unknown"}`, {
        lastRequestedPage: destination.physicalPage,
        confirmedRead: false,
      });
      this.state = "opened";
      return { success: true, lastRequestedPage: destination.physicalPage, persistedStatus: verdict.status ?? null };
    } catch (err) {
      if (this.currentIntentId !== startIntent || this.requestEpoch !== startEpoch || this.currentMaterialId !== material?.id || liveOp?.cancelled) {
        return {
          success: false,
          state: "aborted",
          superseded: true,
          reason: "superseded",
          persistedPage: this.getLastRequestedPage(material?.id, destination.contentSha256),
        };
      }
      return { success: false, error: err.message };
    }
  }

  /** Explicitly abandons the in-flight operation; a later callback cannot commit over it (M4-R29). */
  abort() {
    if (this.activeOperation && !this.activeOperation.cancelled) {
      this.activeOperation.cancelled = true;
      try {
        this.activeOperation.cancel(this.activeOperation.intentId);
      } catch {}
    }
    this.requestEpoch++;
    this.currentIntentId = ++this.intentCounter;
    this.state = "aborted";
    this.lastNotice = null;
  }

  /**
   * M4-R37: marks the current operation superseded. Its local cancellation flag is what the durable
   * commit reads through destination.isCancelled(), so a held save cannot land after a newer request,
   * even one whose own reservation fails. Durable cancellation is left to an explicit abort().
   */
  #retireActiveOperation() {
    if (this.activeOperation && !this.activeOperation.cancelled) {
      this.activeOperation.cancelled = true;
    }
  }

  /** Whether an operation still owns the controller's route (M4-R13, M4-R30, M4-R37). */
  #owns(activeOp, intentId, materialId) {
    return (
      !activeOp.cancelled &&
      activeOp.epoch === this.requestEpoch &&
      this.activeOperation === activeOp &&
      this.currentIntentId === intentId &&
      this.currentMaterialId === materialId
    );
  }

  #fail(error, destination = null) {
    this.state = "failed";
    this.lastNotice = null;
    return {
      success: false,
      state: "failed",
      error,
      openerInvoked: false,
      lastRequestedPage: this.getLastRequestedPage(this.currentMaterialId, destination?.contentSha256 ?? this.currentContentSha256),
    };
  }

  /**
   * M4-R30: Returns an operation-local superseded result WITHOUT mutating current controller state,
   * notice, or winner's recorded progress.
   */
  #superseded(materialId, persistedPage = null) {
    const page = persistedPage ?? this.getLastRequestedPage(materialId, this.currentContentSha256);
    return {
      success: false,
      state: "aborted",
      superseded: true,
      lastRequestedPage: page,
      persistedPage: page,
    };
  }
}

function labelSnippet(destination) {
  return destination.pageLabel ? ` (printed '${destination.pageLabel}')` : "";
}
