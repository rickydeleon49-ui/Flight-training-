import type { StudyContentProvenanceInput } from "@/logic/studyContentProvenance";
import { formatStudyContentProvenance } from "@/logic/studyContentProvenance";

export interface StudyContentProvenanceProps {
  sourceMaterialTitle: string | null | undefined;
  content: StudyContentProvenanceInput | null | undefined;
  kind: "study-aid" | "practice-test";
}

/**
 * Exposes the persisted provenance already stored for a saved study aid (guide/flashcards)
 * or saved practice test in Material Detail (ROADMAP.md §7.C).
 *
 * Shows:
 * 1. Source material title
 * 2. Origin ("Gemini" or "Imported study packet")
 * 3. Stored model (for Gemini content, or "Model unavailable" when empty; omitted for imports)
 * 4. Locally formatted date ("Generated <date>" or "Imported <date>")
 *
 * Labelled specifically as provenance of the saved content, not an in-progress or historical attempt.
 */
export function StudyContentProvenance({
  sourceMaterialTitle,
  content,
  kind,
}: StudyContentProvenanceProps) {
  const provenance = formatStudyContentProvenance(sourceMaterialTitle, content);
  const headingText =
    kind === "practice-test"
      ? "Saved practice test provenance"
      : "Saved study aid provenance";

  return (
    <div className="study-provenance" aria-label={headingText}>
      <p className="study-provenance__heading">{headingText}</p>
      <div className="study-provenance__meta">
        <span className="study-provenance__item">
          <span className="study-provenance__label">Source material:</span>{" "}
          <span className="study-provenance__value">{provenance.sourceMaterialTitle}</span>
        </span>
        <span className="study-provenance__sep" aria-hidden="true">
          ·
        </span>
        <span className="study-provenance__item">
          <span className="study-provenance__label">Origin:</span>{" "}
          <span className="study-provenance__value">{provenance.originLabel}</span>
        </span>
        {provenance.modelLabel ? (
          <>
            <span className="study-provenance__sep" aria-hidden="true">
              ·
            </span>
            <span className="study-provenance__item">
              <span className="study-provenance__label">Model:</span>{" "}
              <span className="study-provenance__value">{provenance.modelLabel}</span>
            </span>
          </>
        ) : null}
        <span className="study-provenance__sep" aria-hidden="true">
          ·
        </span>
        <span className="study-provenance__item">
          <span className="study-provenance__value">{provenance.dateText}</span>
        </span>
        {provenance.pdfNote ? (
          <>
            <span className="study-provenance__sep" aria-hidden="true">
              ·
            </span>
            <span className="study-provenance__item">
              <span className="study-provenance__value">{provenance.pdfNote}</span>
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
