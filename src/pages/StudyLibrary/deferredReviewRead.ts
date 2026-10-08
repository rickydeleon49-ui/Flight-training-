/**
 * Owned, bounded page streams for the library-wide Review due and History
 * views (M2-4 / C2, C2-D5).
 *
 * - One operation at a time: a synchronous lock is installed with a unique
 *   operation token before the reader is called. A same-turn second request
 *   gets the operation already in flight.
 * - Every operation belongs to a generation. Invalidation (filters, content,
 *   reset, delete, restore, clock) starts a new generation and clears rows,
 *   issues, cursor, summaries and the failed read; an older completion or
 *   failure — synchronous or asynchronous — can never publish, record a
 *   failure, or release a newer lock.
 * - Each dispatch captures an immutable snapshot of its options and cursor
 *   (or targets). A failed read is one discriminated descriptor holding that
 *   snapshot; Retry repeats exactly it, read-only.
 * - Counters are reported per call: the latest page summary and the latest
 *   enrichment summary are kept separately from loaded-view counts, and none
 *   of them is a whole-library total.
 */
import type {
  HistoryMaterialEnrichmentRecord,
  LibraryRecentReviewEntry,
  LibraryRecentReviewsInput,
  LibraryRecentReviewsResult,
  LibraryRecentReviewsSummary,
  LibraryReviewDueInput,
  LibraryReviewDueResult,
  LibraryReviewDueSummary,
  LibraryReviewMaterialEntry,
  LibraryReviewOversizeIssue,
} from "@/domain/types";
import { MAX_HISTORY_TARGETS } from "@/logic/cardLibrary";

export type FailedRead<Options> =
  | { kind: "page"; generation: number; options: Readonly<Options>; cursor: string | null }
  | { kind: "enrich"; generation: number; options: Readonly<Options>; targets: readonly string[] };

export interface ReadStreamState<Row, Options, PageSummary, EnrichSummary> {
  generation: number;
  options: Readonly<Options>;
  rows: readonly Row[];
  issues: readonly LibraryReviewOversizeIssue[];
  cursor: string | null;
  isComplete: boolean;
  loading: "page" | "enrich" | null;
  error: unknown;
  failedRead: FailedRead<Options> | null;
  /** The latest page call's own counters. */
  lastPageSummary: PageSummary | null;
  /** The latest enrichment call's own counters. */
  lastEnrichmentSummary: EnrichSummary | null;
  pagesLoaded: number;
  enrichmentCalls: number;
}

interface Operation {
  token: symbol;
  generation: number;
  promise: Promise<void>;
}

interface StreamSpec<Row, Options, PageResult, PageSummary, EnrichSummary> {
  key(row: Row): string;
  readPage(options: Readonly<Options>, cursor: string | null): Promise<PageResult>;
  rowsOf(result: PageResult): Row[];
  nextOf(result: PageResult): string | null;
  issuesOf(result: PageResult): LibraryReviewOversizeIssue[];
  pageSummaryOf(result: PageResult): PageSummary;
  /** History only: enrichment of loaded rows. */
  enrich?: {
    read(options: Readonly<Options>, targets: readonly string[]): Promise<{ records: HistoryMaterialEnrichmentRecord[]; summary: EnrichSummary }>;
    pendingTargets(rows: readonly Row[]): string[];
    apply(rows: readonly Row[], records: HistoryMaterialEnrichmentRecord[]): Row[];
  };
  /** Records delivered with a page (combined page + targets). */
  pageEnrichmentOf?(result: PageResult): HistoryMaterialEnrichmentRecord[] | null;
}

export class DeferredReadStream<Row, Options extends object, PageResult, PageSummary, EnrichSummary = never> {
  private state: ReadStreamState<Row, Options, PageSummary, EnrichSummary>;
  private operation: Operation | null = null;
  private disposed = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly spec: StreamSpec<Row, Options, PageResult, PageSummary, EnrichSummary>,
    options: Options,
  ) {
    this.state = this.freshState(0, options);
  }

  private freshState(generation: number, options: Options): ReadStreamState<Row, Options, PageSummary, EnrichSummary> {
    return {
      generation,
      options: Object.freeze({ ...options }),
      rows: [],
      issues: [],
      cursor: null,
      isComplete: false,
      loading: null,
      error: null,
      failedRead: null,
      lastPageSummary: null,
      lastEnrichmentSummary: null,
      pagesLoaded: 0,
      enrichmentCalls: 0,
    };
  }

  /* ----------------------------- store ----------------------------- */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ReadStreamState<Row, Options, PageSummary, EnrichSummary> => this.state;

  private publish(next: Partial<ReadStreamState<Row, Options, PageSummary, EnrichSummary>>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  get isCaughtUp(): boolean {
    const s = this.state;
    return s.isComplete && s.rows.length === 0 && s.issues.length === 0 && s.loading === null && s.failedRead === null;
  }

  get busy(): boolean {
    return this.operation !== null;
  }

  /* --------------------------- lifecycle --------------------------- */

  /** (Re)activate after mount; React StrictMode unmounts and mounts again. */
  activate() {
    this.disposed = false;
  }

  dispose() {
    this.disposed = true;
    this.operation = null;
    this.publish({ generation: this.state.generation + 1, loading: null });
  }

  /**
   * Authoritative invalidation: a new generation with nothing loaded, the
   * given options (filters, a fresh clock) and no failed read. Any read in
   * flight becomes obsolete and the lock is released for the new generation.
   */
  invalidate(options?: Partial<Options>) {
    this.operation = null;
    this.state = this.freshState(this.state.generation + 1, { ...this.state.options, ...options } as Options);
    for (const listener of this.listeners) listener();
  }

  /* --------------------------- operations -------------------------- */

  private run(
    kind: "page" | "enrich",
    start: (owns: () => boolean) => Promise<void>,
    onFail: () => FailedRead<Options>,
  ): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.operation) return this.operation.promise;
    const token = Symbol(kind);
    const generation = this.state.generation;
    // Only this operation, in its own live generation, may publish or unlock.
    const owns = () => !this.disposed && this.operation?.token === token && this.state.generation === generation;
    let settle!: () => void;
    const promise = new Promise<void>((resolve) => (settle = resolve));
    this.operation = { token, generation, promise };
    this.publish({ loading: kind, error: null });
    const fail = (error: unknown) => {
      if (owns()) {
        this.operation = null;
        this.publish({ loading: null, error, failedRead: onFail() });
      }
      settle();
    };
    let started: Promise<void>;
    try {
      started = start(owns);
    } catch (error) {
      fail(error);
      return promise;
    }
    started.then(() => settle(), fail);
    return promise;
  }

  /** Load the next page (or the first). Duplicate calls share the one in flight. */
  loadNextPage(): Promise<void> {
    if (this.state.isComplete) return Promise.resolve();
    return this.dispatchPage(this.state.options, this.state.cursor);
  }

  private dispatchPage(options: Readonly<Options>, cursor: string | null): Promise<void> {
    const generation = this.state.generation;
    return this.run(
      "page",
      async (owns) => {
        const result = await this.spec.readPage(options, cursor);
        if (!owns()) return;
        let rows = mergeRows(this.state.rows, this.spec.rowsOf(result), this.spec.key);
        const records = this.spec.pageEnrichmentOf?.(result);
        if (records && this.spec.enrich) rows = this.spec.enrich.apply(rows, records);
        const next = this.spec.nextOf(result);
        this.operation = null;
        this.publish({
          rows,
          issues: mergeIssues(this.state.issues, this.spec.issuesOf(result)),
          cursor: next,
          isComplete: next === null,
          loading: null,
          error: null,
          failedRead: null,
          lastPageSummary: this.spec.pageSummaryOf(result),
          pagesLoaded: this.state.pagesLoaded + 1,
        });
      },
      () => ({ kind: "page", generation, options, cursor }),
    );
  }

  /** Targets still awaiting provenance among loaded rows (oversize excluded). */
  pendingTargets(): string[] {
    return this.spec.enrich ? this.spec.enrich.pendingTargets(this.state.rows) : [];
  }

  /**
   * Resolve pending provenance for loaded rows, at most 250 targets per call,
   * keeping event order, IDs and the page cursor. Callable after pagination
   * has finished; what this call leaves pending stays for the next one.
   */
  enrichPending(targets?: readonly string[]): Promise<void> {
    const enrich = this.spec.enrich;
    if (!enrich) return Promise.resolve();
    const chosen = [...new Set(targets ?? enrich.pendingTargets(this.state.rows))].slice(0, MAX_HISTORY_TARGETS);
    if (chosen.length === 0) return Promise.resolve();
    return this.dispatchEnrich(this.state.options, chosen);
  }

  private dispatchEnrich(options: Readonly<Options>, targets: readonly string[]): Promise<void> {
    const enrich = this.spec.enrich!;
    const generation = this.state.generation;
    const frozenTargets = Object.freeze([...targets]);
    return this.run(
      "enrich",
      async (owns) => {
        const { records, summary } = await enrich.read(options, frozenTargets);
        if (!owns()) return;
        this.operation = null;
        this.publish({
          rows: enrich.apply(this.state.rows, records),
          loading: null,
          error: null,
          failedRead: null,
          lastEnrichmentSummary: summary,
          enrichmentCalls: this.state.enrichmentCalls + 1,
        });
      },
      () => ({ kind: "enrich", generation, options, targets: frozenTargets }),
    );
  }

  /** Repeat exactly the most recent failed read of this generation, read-only. */
  retryRead(): Promise<void> {
    const failed = this.state.failedRead;
    if (!failed || failed.generation !== this.state.generation || this.operation) return Promise.resolve();
    return failed.kind === "page" ? this.dispatchPage(failed.options, failed.cursor) : this.dispatchEnrich(failed.options, failed.targets);
  }
}

function mergeRows<Row>(existing: readonly Row[], incoming: Row[], key: (row: Row) => string): Row[] {
  const rows = [...existing];
  const index = new Map(rows.map((row, i) => [key(row), i]));
  for (const row of incoming) {
    const at = index.get(key(row));
    if (at === undefined) {
      index.set(key(row), rows.length);
      rows.push(row);
    } else {
      rows[at] = row;
    }
  }
  return rows;
}

function mergeIssues(existing: readonly LibraryReviewOversizeIssue[], incoming: LibraryReviewOversizeIssue[]) {
  const issues = [...existing];
  const seen = new Set(issues.map((issue) => `${issue.materialId}:${issue.code}`));
  for (const issue of incoming) {
    const key = `${issue.materialId}:${issue.code}`;
    if (!seen.has(key)) {
      seen.add(key);
      issues.push(issue);
    }
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* History provenance patches                                          */
/* ------------------------------------------------------------------ */

/**
 * Apply target-only provenance to loaded history rows. Untargeted rows keep
 * their resolved fields. A readable current identity is compared against
 * each event's own version; an unread (pending) one leaves provenance
 * unknown. Resolution clears an obsolete blocking reason and action.
 */
export function applyHistoryEnrichment(
  rows: readonly LibraryRecentReviewEntry[],
  records: HistoryMaterialEnrichmentRecord[],
): LibraryRecentReviewEntry[] {
  const byMaterial = new Map(records.map((record) => [record.materialId, record]));
  return rows.map((row) => {
    const record = byMaterial.get(row.materialId);
    if (!record) return row;
    if (record.contentStatus === "current" && record.currentVersionId) {
      const earlier = row.versionId !== record.currentVersionId;
      return {
        ...row,
        currentVersionId: record.currentVersionId,
        isEarlierVersion: earlier,
        contentStatus: earlier ? "earlier" : "current",
        blockedReason: null,
        inspectionTarget: null,
      };
    }
    if (record.contentStatus === "pending") {
      return {
        ...row,
        contentStatus: "pending",
        isEarlierVersion: null,
        currentVersionId: null,
        blockedReason: record.reason,
        inspectionTarget: record.inspectionTarget,
      };
    }
    return {
      ...row,
      contentStatus: record.contentStatus,
      isEarlierVersion: true,
      currentVersionId: null,
      blockedReason: record.contentStatus === "valid_empty" ? null : record.reason,
      inspectionTarget: record.inspectionTarget,
    };
  });
}

export function pendingHistoryTargets(rows: readonly LibraryRecentReviewEntry[]): string[] {
  const targets: string[] = [];
  for (const row of rows) {
    if (row.contentStatus === "pending" && row.blockedReason !== "oversize" && !targets.includes(row.materialId)) {
      targets.push(row.materialId);
    }
  }
  return targets;
}

/* ------------------------------------------------------------------ */
/* The two concrete streams                                            */
/* ------------------------------------------------------------------ */

export type DueOptions = Omit<LibraryReviewDueInput, "cursor">;
export type HistoryOptions = Omit<LibraryRecentReviewsInput, "cursor" | "enrichMaterialIds" | "enrichmentOnly">;

export type DueStream = DeferredReadStream<LibraryReviewMaterialEntry, DueOptions, LibraryReviewDueResult, LibraryReviewDueSummary>;
export type HistoryStream = DeferredReadStream<
  LibraryRecentReviewEntry,
  HistoryOptions,
  LibraryRecentReviewsResult,
  LibraryRecentReviewsSummary,
  LibraryRecentReviewsSummary
>;

export function createDueStream(read: (input: LibraryReviewDueInput) => Promise<LibraryReviewDueResult>, options: DueOptions): DueStream {
  return new DeferredReadStream(
    {
      key: (row) => row.materialId,
      readPage: (opts, cursor) => read({ ...opts, cursor }),
      rowsOf: (result) => result.materials,
      nextOf: (result) => result.nextCursor,
      issuesOf: (result) => result.issues,
      pageSummaryOf: (result) => result.summary,
    },
    options,
  );
}

export function createHistoryStream(
  read: (input: LibraryRecentReviewsInput) => Promise<LibraryRecentReviewsResult>,
  options: HistoryOptions,
): HistoryStream {
  return new DeferredReadStream(
    {
      key: (row) => row.id,
      readPage: (opts, cursor) => read({ ...opts, cursor }),
      rowsOf: (result) => result.rows,
      nextOf: (result) => result.next,
      issuesOf: () => [],
      pageSummaryOf: (result) => result.summary,
      pageEnrichmentOf: (result) => result.enrichment,
      enrich: {
        read: async (opts, targets) => {
          const result = await read({ ...opts, enrichmentOnly: true, limit: 0, enrichMaterialIds: [...targets] });
          return { records: result.enrichment ?? [], summary: result.summary };
        },
        pendingTargets: pendingHistoryTargets,
        apply: applyHistoryEnrichment,
      },
    },
    options,
  );
}
