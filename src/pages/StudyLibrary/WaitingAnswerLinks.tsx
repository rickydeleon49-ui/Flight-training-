import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { listPdfStudyKitJobs } from "@/services/documents";
import type { GeminiJob } from "@/state/GeminiJobs";

/** The start of the "several finished answers are waiting" refusal. */
const FULL_START = "Several finished answers are waiting";
/** The start of the "a finished answer for this document is waiting" refusal. */
const WAITING_START = "A finished answer for this document is waiting";
const PHASES = ["recovered", "save-failed", "interrupted", "failed", "waiting-for-her", "discard-failed"];

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
  const matched = !!message && (message.startsWith(FULL_START) || message.startsWith(WAITING_START));
  const [kitMaterialIds, setKitMaterialIds] = useState<string[]>([]);
  useEffect(() => {
    if (!matched) return;
    let alive = true;
    listPdfStudyKitJobs()
      .then((list) => alive && setKitMaterialIds(list.map((job) => job.materialId)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [matched]);
  if (!matched) return null;
  const waiting = new Set([
    ...jobs
      .filter((job) => PHASES.includes(job.phase))
      .filter((job) => job.answer || job.sectionGuide || job.draft)
      .map((job) => job.materialId),
    ...kitMaterialIds,
  ]);
  const isWaitingMsg = message!.startsWith(WAITING_START);
  // The "waiting" refusal is about this very document, so it may be the one shown.
  if (!isWaitingMsg && exceptId) waiting.delete(exceptId);
  const found = materials.filter((material) => waiting.has(material.id));
  if (found.length === 0) {
    return <p className="tiny">Open Study Library &gt; Waiting answers to save or discard it.</p>;
  }
  if (isWaitingMsg) {
    return (
      <p className="tiny">
        <Link to={`/study/${encodeURIComponent(found[0]!.id)}`}>Show me</Link>
      </p>
    );
  }
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
