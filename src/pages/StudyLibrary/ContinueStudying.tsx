import { Link } from "react-router-dom";

import type { StudyMaterial } from "@/domain/types";
import { TOPIC_LABELS } from "@/domain/types";
import { ProgressLine, progressLabel, type MaterialProgress } from "./LibrarySections";

/** The newest thing you opened as one card with Continue, then up to 2 older rows (hidden when none). */
export function ContinueStudying({
  materials,
  progressOf,
}: {
  materials: StudyMaterial[];
  progressOf?: (materialId: string) => MaterialProgress | null;
}) {
  const [latest, ...older] = materials;
  if (!latest) return null;
  const progress = progressOf?.(latest.id) ?? null;
  return (
    <section className="library__continue" aria-label="Continue studying">
      <h2 className="library__continue-title">Continue studying</h2>
      <div className="library__continue-card">
        <span className="library__continue-name">{latest.title}</span>
        <span className="library__continue-topic small muted">{TOPIC_LABELS[latest.topic]}</span>
        {progress ? (
          <>
            <ProgressLine progress={progress} />
            <span className="tiny muted">{progressLabel(progress)}</span>
          </>
        ) : null}
        <Link
          to={`/study/${encodeURIComponent(latest.id)}`}
          className="button button--primary library__continue-go"
          aria-label={`Continue ${latest.title}`}
        >
          Continue
        </Link>
      </div>
      {older.length > 0 ? (
        <div className="library__continue-rows">
          {older.slice(0, 2).map((material) => (
            <Link
              key={material.id}
              to={`/study/${encodeURIComponent(material.id)}`}
              className="library__continue-row"
              aria-label={material.title}
            >
              <span className="library__continue-name">{material.title}</span>
              <span className="library__continue-topic small muted">{TOPIC_LABELS[material.topic]}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
