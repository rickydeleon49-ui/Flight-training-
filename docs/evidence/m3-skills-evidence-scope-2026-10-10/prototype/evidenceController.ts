/**
 * Candidate M3 view controller: owns request identity and publication for
 * the evidence history and the observation form. Framework-free, so the
 * same rules hold for any screen that uses it (React adapter in the UI
 * specimen).
 *
 * Rules (scope document, "Operation and publication ownership"):
 * - Each open(skillId) starts a new generation. A response is published only
 *   while its generation is current, so A -> B -> A never shows B's or the
 *   first A's late answer.
 * - A form draft keeps its operation and observation ids while its content is
 *   unchanged: Try again resends the same request (a replay if it landed).
 *   A second click while saving joins the request already in flight.
 * - Changed content after an unknown outcome is not sent blindly: the
 *   controller first reads whether the earlier observation exists.
 * - A save that was acknowledged is never resent. If the refresh after it
 *   fails, the screen says "saved" and retryRead() only reads.
 * - dispose() stops all publication; late answers are ignored.
 *
 * DISPOSABLE PROTOTYPE.
 */
import { canonicalJson } from "@/logic/cardIdentity";

import type {
  Attribution,
  EvidenceItem,
  EvidencePage,
  EvidencePageInput,
  ObservationRevision,
  SkillEvidenceAction,
  SkillEvidenceOutcome,
  SkillSummary,
  SourceField,
} from "./types";

export interface EvidenceClient {
  page(input: EvidencePageInput): Promise<EvidencePage>;
  summary(skillId: string): Promise<SkillSummary | null>;
  act(action: SkillEvidenceAction): Promise<SkillEvidenceOutcome>;
  history(observationId: string): Promise<ObservationRevision[]>;
}

export interface ObservationDraft {
  skillId: string;
  journalId: string;
  sourceField: SourceField;
  wording: string;
  observedOn: string;
  attribution: Attribution;
  instructorName: string;
}

export interface EvidenceViewState {
  skillId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  items: EvidenceItem[];
  nextCursor: string | null;
  loadingMore: boolean;
  summary: SkillSummary | null;
  readError: string | null;
  saving: boolean;
  /** "saved_stale": the save landed, the refresh did not. */
  notice: null | "saved" | "saved_stale" | "already_saved";
  writeError: { code: string; message: string } | null;
}

const INITIAL: EvidenceViewState = {
  skillId: null, status: "idle", items: [], nextCursor: null, loadingMore: false, summary: null,
  readError: null, saving: false, notice: null, writeError: null,
};

interface DraftIdentity {
  fingerprint: string;
  operationId: string;
  observationId: string;
  /** null while in flight; "unknown" after a failure whose outcome we cannot know. */
  outcome: null | "unknown" | "refused";
  inFlight: Promise<boolean> | null;
}

const REFUSALS_THAT_WROTE_NOTHING = new Set([
  "INVALID_ARGUMENT", "LIMIT_EXCEEDED", "NOT_FOUND", "SOURCE_MISSING", "SKILL_RETIRED", "BUILTIN_READ_ONLY",
  "DUPLICATE_LABEL", "STALE_REVISION", "OPERATION_CONFLICT", "ERASED",
]);

export function createEvidenceController(client: EvidenceClient, options: { newId: () => string; pageSize?: number }) {
  let state = INITIAL;
  let generation = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  const drafts = new Map<string, DraftIdentity>();

  const publish = (next: Partial<EvidenceViewState>) => {
    if (disposed) return;
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  async function readFirstPage(skillId: string, mine: number): Promise<void> {
    try {
      const [page, summary] = await Promise.all([
        client.page({ skillId, limit: options.pageSize }),
        client.summary(skillId),
      ]);
      if (mine !== generation) return;
      publish({ status: "ready", items: page.items, nextCursor: page.nextCursor, summary, readError: null });
    } catch (error) {
      if (mine !== generation) return;
      publish({ status: "error", readError: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  const api = {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Show one skill's evidence. Earlier requests become obsolete. */
    async open(skillId: string): Promise<void> {
      const mine = ++generation;
      publish({ ...INITIAL, skillId, status: "loading", notice: state.notice, saving: state.saving });
      await readFirstPage(skillId, mine).catch(() => undefined);
    },

    /** Next page; ignored while one is loading or when there is none. */
    async loadMore(): Promise<void> {
      if (state.loadingMore || !state.nextCursor || !state.skillId) return;
      const mine = generation;
      const cursor = state.nextCursor;
      publish({ loadingMore: true });
      try {
        const page = await client.page({ skillId: state.skillId, cursor, limit: options.pageSize });
        if (mine !== generation) return;
        publish({ items: [...state.items, ...page.items], nextCursor: page.nextCursor, loadingMore: false });
      } catch (error) {
        if (mine !== generation) return;
        publish({ loadingMore: false, readError: error instanceof Error ? error.message : String(error) });
      }
    },

    /** Reads again. Never resends a write. */
    async retryRead(): Promise<void> {
      if (!state.skillId) return;
      const mine = ++generation;
      publish({ status: "loading", readError: null });
      try {
        await readFirstPage(state.skillId, mine);
        if (mine === generation && state.notice === "saved_stale") publish({ notice: "saved" });
      } catch {
        // state already says error
      }
    },

    /**
     * Save one observation from a draft. Resolves true when the observation
     * is stored (applied or replayed), false when refused or unknown.
     */
    submitObservation(draftKey: string, draft: ObservationDraft): Promise<boolean> {
      const fingerprint = canonicalJson(draft);
      let identity = drafts.get(draftKey);
      if (identity?.inFlight) return identity.inFlight; // double click joins the request in flight
      const run = async (): Promise<boolean> => {
        if (identity && identity.fingerprint !== fingerprint && identity.outcome === "unknown") {
          // The earlier attempt may have landed: look before sending different content.
          const earlier = await client.history(identity.observationId).catch(() => null);
          if (earlier === null) {
            publish({ saving: false, writeError: { code: "STORAGE_FAILURE", message: "We couldn't check your earlier save. Try again." } });
            return false;
          }
          if (earlier.length > 0) {
            drafts.delete(draftKey);
            publish({ saving: false, notice: "already_saved", writeError: null });
            await api.retryRead();
            return true;
          }
        }
        if (!identity || identity.fingerprint !== fingerprint) {
          identity = { fingerprint, operationId: options.newId(), observationId: options.newId(), outcome: null, inFlight: null };
          drafts.set(draftKey, identity);
        }
        const request: SkillEvidenceAction = {
          action: "create_observation",
          operationId: identity.operationId,
          observationId: identity.observationId,
          ...draft,
        };
        publish({ saving: true, writeError: null, notice: null });
        try {
          await client.act(request);
        } catch (error) {
          const code = (error as { code?: string }).code ?? "STORAGE_FAILURE";
          identity.outcome = REFUSALS_THAT_WROTE_NOTHING.has(code) ? "refused" : "unknown";
          if (identity.outcome === "refused" && code !== "OPERATION_CONFLICT") drafts.delete(draftKey);
          publish({ saving: false, writeError: { code, message: error instanceof Error ? error.message : String(error) } });
          return false;
        }
        // Acknowledged: this draft is done and must never be resent.
        drafts.delete(draftKey);
        publish({ saving: false, notice: "saved", writeError: null });
        if (state.skillId) {
          const mine = ++generation;
          try {
            await readFirstPage(state.skillId, mine);
          } catch {
            if (mine === generation) publish({ status: "ready", readError: null, notice: "saved_stale" });
          }
        }
        return true;
      };
      const flight = run().finally(() => {
        if (identity) identity.inFlight = null;
      });
      // run() has created or reused the identity synchronously, before its first await.
      if (identity) identity.inFlight = flight;
      return flight;
    },

    /** The ids a draft would send now (for tests and diagnostics). */
    draftIdentity(draftKey: string) {
      const d = drafts.get(draftKey);
      return d ? { operationId: d.operationId, observationId: d.observationId } : null;
    },

    dispose() {
      disposed = true;
      generation += 1;
      listeners.clear();
    },
  };
  return api;
}

export type EvidenceController = ReturnType<typeof createEvidenceController>;
