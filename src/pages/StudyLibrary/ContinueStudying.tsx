import { Link } from "react-router-dom";

import type { StudyMaterial } from "@/domain/types";
import { TOPIC_LABELS } from "@/domain/types";

/** The last few things she opened, one tap to go back (hidden when there are none). */
export function ContinueStudying({ materials }: { materials: StudyMaterial[] }) {
  if (materials.length === 0) return null;
  return (
    <section className="library__continue" aria-label="Continue studying">
      <h2 className="library__continue-title">Continue studying</h2>
      <div className="library__continue-cards">
        {materials.map((material) => (
          <Link
            key={material.id}
            to={`/study/${encodeURIComponent(material.id)}`}
            className="library__continue-card"
            aria-label={material.title}
          >
            <span className="library__continue-name">{material.title}</span>
            <span className="library__continue-topic small muted">{TOPIC_LABELS[material.topic]}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
