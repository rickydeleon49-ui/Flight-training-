/**
 * Where a split part came from, on its material page (M2 split lineage,
 * SL-D7). Shows the original document and, for a part of a part, the part it
 * was taken from; links to whichever is still in the library; the other parts
 * of the same edition; and a "copy page" button, because the Mac's PDF viewer
 * always opens a part at its own page 1.
 *
 * Whether each source is still the same copy is checked by fingerprinting its
 * current file natively, after render. Until that answer arrives, or in the
 * browser preview where it cannot be checked, the page says so plainly.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Badge, Button } from "@/components/ui";
import type { StudyMaterial } from "@/domain/types";
import {
  describePages,
  describeVerdict,
  immediateSource,
  isDirectSplit,
  lineageFilesToCheck,
  lineageVerdicts,
  originalSource,
  relatedParts,
  type Fingerprints,
  type SourceTarget,
} from "@/logic/splitLineage";
import { useAppData } from "@/state/AppDataContext";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyPage({ page, where }: { page: number; where: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <span className="row row--wrap" style={{ gap: "var(--space-2)", alignItems: "center" }}>
      <Button
        size="small"
        variant="ghost"
        aria-label={`Copy page ${page} of ${where}`}
        onClick={() => void copyText(String(page)).then((ok) => setState(ok ? "copied" : "failed"))}
      >
        Copy page {page}
      </Button>
      {state === "copied" ? <span className="tiny muted" role="status">Copied.</span> : null}
      {state === "failed" ? (
        <span className="tiny muted" role="status">
          Copying isn&rsquo;t available here — the page is {page}.
        </span>
      ) : null}
    </span>
  );
}

function SourceLine({
  label,
  target,
  live,
  note,
}: {
  label: string;
  target: SourceTarget;
  live: boolean;
  note: string | null;
}) {
  return (
    <div className="stack stack--1">
      <p className="small">
        <span className="muted">{label}: </span>
        {live && target.materialId ? (
          <Link to={`/study/${encodeURIComponent(target.materialId)}`}>{target.title}</Link>
        ) : (
          <span>{target.title}</span>
        )}
        {" — "}
        {describePages(target)}
      </p>
      {!live ? <Badge tone="neutral">Removed from your library</Badge> : null}
      {note ? <p className="tiny muted">{note}</p> : null}
    </div>
  );
}

export function SplitLineageDetails({
  material,
  materials,
}: {
  material: StudyMaterial;
  materials: readonly StudyMaterial[];
}) {
  const { repositories, dataRevision } = useAppData();
  const lineage = material.lineage ?? null;
  const byId = useMemo(() => new Map(materials.map((item) => [item.id, item])), [materials]);
  const toCheck = useMemo(
    () => (lineage ? lineageFilesToCheck(lineage, byId) : []),
    [lineage, byId],
  );
  const checkKey = toCheck.join("\0");
  const [fingerprints, setFingerprints] = useState<{ key: string; value: Fingerprints | null } | null>(
    null,
  );

  useEffect(() => {
    if (!lineage || toCheck.length === 0 || !repositories) return;
    let current = true;
    repositories.documents
      .fingerprintDocuments(toCheck)
      .then((value) => {
        if (current) setFingerprints({ key: checkKey, value });
      })
      .catch(() => {
        if (current) setFingerprints({ key: checkKey, value: null });
      });
    return () => {
      current = false;
    };
    // A new data snapshot (an edit, a replaced file) checks again.
  }, [checkKey, toCheck, repositories, dataRevision, lineage]);

  if (!lineage) return null;

  const known = fingerprints?.key === checkKey ? fingerprints.value : null;
  const verdicts = lineageVerdicts(lineage, byId, known);
  const direct = isDirectSplit(lineage);
  const original = originalSource(lineage);
  const parent = immediateSource(lineage);
  const originalLive = Boolean(original.materialId && byId.has(original.materialId));
  const parentLive = Boolean(parent.materialId && byId.has(parent.materialId));
  const related = relatedParts(material, materials);

  return (
    <section className="stack stack--3" aria-labelledby={`lineage-${material.id}`} style={{ marginTop: "var(--space-4)" }}>
      <h3 id={`lineage-${material.id}`} className="small strong">
        Where this part came from
      </h3>

      <SourceLine
        label="Original"
        target={original}
        live={originalLive}
        note={describeVerdict(verdicts.root, "The original was removed from your library. This part, its notes and its study history are all still here.")}
      />
      {!direct ? (
        <SourceLine
          label="Taken from"
          target={parent}
          live={parentLive}
          note={describeVerdict(verdicts.parent, "The part this was taken from was removed from your library. This part is still complete.")}
        />
      ) : null}

      <div className="stack stack--1">
        <p className="tiny muted">
          Your PDF viewer opens this part at its own page 1. In the original, that is page{" "}
          {original.firstPage}
          {!direct ? `; in ${parent.title}, page ${parent.firstPage}` : ""}.
        </p>
        <div className="row row--wrap" style={{ gap: "var(--space-2)" }}>
          <CopyPage page={original.firstPage} where="the original" />
          {!direct ? <CopyPage page={parent.firstPage} where={parent.title} /> : null}
        </div>
      </div>

      {related.length > 0 ? (
        <div className="stack stack--1">
          <p className="small muted">Other parts from the same copy</p>
          <ul className="stack stack--1" aria-label="Other parts from the same copy" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {related.map((part) => (
              <li key={part.id} className="small">
                <Link to={`/study/${encodeURIComponent(part.id)}`}>{part.title}</Link>
                <span className="tiny muted">
                  {" "}
                  · {describePages(direct ? originalSource(part.lineage!) : immediateSource(part.lineage!))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
