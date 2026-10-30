/**
 * Skills and feedback evidence (M3). Every write is one atomic driver call;
 * every read is a bounded driver read. Drivers without the methods refuse:
 * nothing falls back to separate statements or unbounded selects.
 *
 * Not loaded through AppDataContext: screens read this on demand through
 * `useSkillEvidence` and `useSkillList`.
 */
import type {
  EvidencePage,
  EvidencePageInput,
  ObservationHistoryInput,
  ObservationHistoryPage,
  SkillEvidenceAction,
  SkillEvidenceOutcome,
  SkillListEntry,
  SkillSummary,
} from "@/domain/types";

import type { SqlDatabase } from "../db";
import { SkillEvidenceError } from "../skillEvidenceTransaction";

const UNSUPPORTED = "Skill evidence isn't available with this storage, so nothing was changed.";

function unsupported(): never {
  throw new SkillEvidenceError("INVALID_ARGUMENT", UNSUPPORTED);
}

export function skillEvidenceRepository(db: SqlDatabase) {
  return {
    /** Whether this driver can store skill evidence at all. */
    supported(): boolean {
      return (
        typeof db.saveSkillEvidenceAtomically === "function" &&
        typeof db.readSkillEvidencePage === "function" &&
        typeof db.readSkillSummary === "function" &&
        typeof db.listSkills === "function" &&
        typeof db.readObservationHistory === "function"
      );
    },
    act(action: SkillEvidenceAction): Promise<SkillEvidenceOutcome> {
      if (typeof db.saveSkillEvidenceAtomically !== "function") unsupported();
      return db.saveSkillEvidenceAtomically(action);
    },
    page(input: EvidencePageInput): Promise<EvidencePage> {
      if (typeof db.readSkillEvidencePage !== "function") unsupported();
      return db.readSkillEvidencePage(input);
    },
    summary(skillId: string): Promise<SkillSummary | null> {
      if (typeof db.readSkillSummary !== "function") unsupported();
      return db.readSkillSummary(skillId);
    },
    skills(options: { includeRetired?: boolean } = {}): Promise<SkillListEntry[]> {
      if (typeof db.listSkills !== "function") unsupported();
      return db.listSkills(options);
    },
    history(input: ObservationHistoryInput): Promise<ObservationHistoryPage> {
      if (typeof db.readObservationHistory !== "function") unsupported();
      return db.readObservationHistory(input);
    },
  };
}
