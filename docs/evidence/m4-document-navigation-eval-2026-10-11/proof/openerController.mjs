/**
 * M4 Injected Opener Controller (R4)
 *
 * Implements pure lifecycle state machine for document opening & navigation:
 * 1. Tracks states: idle -> opening (pending) -> opened (success) | failed (error) | aborted (cancelled).
 * 2. Honest reading semantics:
 *    - Opening initiates a request, but does NOT mark the page as read (confirmed_read stays 0).
 *    - Updates last_requested_page ONLY upon successful opening.
 * 3. Failure handling:
 *    - An opener error (e.g. missing file, OS failure) transitions to failed.
 *    - Does NOT announce "Opened" and does NOT advance reading progress.
 *    - Missing-file recovery workflow remains accessible.
 * 4. Route / Material Change:
 *    - If the user navigates to another material or page while openDocument is in flight,
 *      the pending operation is aborted; late callbacks do not update state or emit stale notices.
 */

export class OpenerController {
  constructor(options = {}) {
    this.injectedOpener = options.injectedOpener ?? (async () => {});
    this.state = "idle";
    this.lastRequestedPage = null;
    this.lastNotice = null;
    this.lastError = null;
    this.activeOperationId = 0;
    this.activeMaterialId = null;
  }

  /**
   * Request opening a material to a physical page and optional label.
   */
  async requestOpen(material, pageIndex, pageLabel = null) {
    if (!material || !material.filePath) {
      this.state = "failed";
      this.lastError = "Cannot open document: file path is missing.";
      return { success: false, state: this.state, error: this.lastError };
    }

    const opId = ++this.activeOperationId;
    this.activeMaterialId = material.id;
    this.state = "opening";
    this.lastError = null;
    this.lastNotice = `Opening '${material.title}' in system viewer…`;

    try {
      await this.injectedOpener(material.filePath);

      // Check if aborted or superseded during asynchronous open
      if (opId !== this.activeOperationId || this.activeMaterialId !== material.id) {
        return { success: false, state: "aborted", error: "Operation was aborted or superseded." };
      }

      this.state = "opened";
      this.lastRequestedPage = pageIndex;
      const pageDisp = pageLabel && pageLabel !== String(pageIndex)
        ? `page ${pageIndex} (printed '${pageLabel}')`
        : `page ${pageIndex}`;
      this.lastNotice = `Opened '${material.title}' in system viewer. Turn to ${pageDisp}.`;

      return {
        success: true,
        state: this.state,
        notice: this.lastNotice,
        lastRequestedPage: this.lastRequestedPage,
        confirmedRead: false, // Honest reading state: requested is not confirmed read
      };
    } catch (err) {
      if (opId !== this.activeOperationId || this.activeMaterialId !== material.id) {
        return { success: false, state: "aborted", error: "Operation was aborted or superseded." };
      }

      this.state = "failed";
      this.lastError = err instanceof Error ? err.message : String(err);
      this.lastNotice = null;

      return {
        success: false,
        state: this.state,
        error: this.lastError,
        lastRequestedPage: this.lastRequestedPage, // Remains unchanged on failure
      };
    }
  }

  /**
   * Cancel or abort any in-flight opening operation (e.g. on unmount or navigation).
   */
  abort() {
    this.activeOperationId++;
    this.state = "idle";
    this.lastNotice = null;
    this.lastError = null;
  }
}
