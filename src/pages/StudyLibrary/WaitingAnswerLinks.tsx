import { Link } from "react-router-dom";

import type { GeminiJob } from "@/state/GeminiJobs";

/** The start of the "several finished answers are waiting" refusal. */
const FULL_START = "Several finished answers are waiting";

/**
 * When a new request is refused because too many finished answers are waiting,
 * says which materials hold one and links to each, so nothing is hidden.
 */
export function WaitingAnswerLinks({
  message,
  jobs,
  materials,
  exceptId,
}: {
  message: string | null | undefined;
  jobs: GeminiJob[];
  materials: { id: string; title: string }[];
  exceptId?: string;
}) {
  if (!message?.startsWith(FULL_START)) return null;
  const waiting = new Set(
    jobs
      .filter((job) => job.phase === "recovered" || job.phase === "save-failed" || job.phase === "interrupted" || job.phase === "failed")
      .filter((job) => job.answer || job.sectionGuide || job.draft)
      .map((job) => job.materialId)
      .filter((id) => id !== exceptId),
  );
  const found = materials.filter((material) => waiting.has(material.id));
  if (found.length === 0) return null;
  return (
    <div className="stack stack--2">
      <p className="tiny">Open one of these to save or discard its answer:</p>
      <ul className="stack stack--1">
        {found.map((material) => (
          <li key={material.id}>
            <Link to={`/study/${encodeURIComponent(material.id)}`}>{material.title}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
