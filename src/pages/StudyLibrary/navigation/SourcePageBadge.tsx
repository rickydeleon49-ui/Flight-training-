/**
 * The source page a study aid cited, as an interactive badge (M4 Slice 1).
 *
 * Page numbers in generated study aids have unknown provenance: a study aid
 * may cite the printed page ("p. 3-12") rather than the PDF's own page count.
 * Under the approved OD-6 default such a number never resolves to a saved
 * position. The badge opens the material's file in the default reader, after
 * the desktop app has checked it, and tells her where to look; nothing is
 * saved. Without a file or outside the desktop app it stays a plain label.
 *
 * Leaving the view (unmount or a route change) retires a request this badge
 * started and is still checking, so its file is never opened afterwards
 * (M4S1-R8).
 */
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui";
import { useOptionalAppData } from "@/state/AppDataContext";
import { useNavigationController } from "@/state/navigation/useDocumentNavigation";
import type { NavigationController } from "@/state/navigation/controller";

export function sourceGuidance(page: number | string): string {
  return `Opened in your PDF reader. The study aid points to page ${page}, which may be the page number printed in the book rather than your reader's page count, so look for page ${page} there.`;
}

interface SourcePageBadgeProps {
  /** The page the study aid cited, if any. */
  page: number | string | null | undefined;
  /** The material whose file holds that page; null when it is gone. */
  materialId: string | null | undefined;
}

export function SourcePageBadge({ page, materialId }: SourcePageBadgeProps) {
  const materials = useOptionalAppData()?.data.materials ?? [];
  const { repo, controller, status } = useNavigationController();
  const hasFile = Boolean(materialId && materials.find((m) => m.id === materialId)?.filePath);
  const [shown, setShown] = useState<{ controller: NavigationController; epoch: number; materialId: string; page: number | string } | null>(null);
  const started = useRef<{ controller: NavigationController; epoch: number } | null>(null);

  useEffect(() => {
    if (!controller) return undefined;
    return () => {
      const request = started.current;
      if (request?.controller !== controller) return;
      const current = controller.status();
      if (current.epoch === request.epoch && current.kind === "working") controller.abort();
      if (started.current === request) started.current = null;
    };
  }, [controller, materialId, page]);

  if (page === null || page === undefined || page === "") return <Badge tone="study">Check source</Badge>;
  const label = `Source p. ${page}`;
  if (!materialId || !hasFile || !controller || !repo?.canCheckFiles()) return <Badge tone="study">{label}</Badge>;

  const busy = status.kind === "working" && "materialId" in status && status.materialId === materialId;
  const mine = shown?.controller === controller && shown.materialId === materialId && shown.page === page && status.epoch === shown.epoch ? status : null;
  const note = mine && (mine.kind === "guidance" || mine.kind === "failed") ? mine.message : null;

  return (
    <span className="source-badge">
      <button
        type="button"
        className="badge badge--study badge--button"
        disabled={busy}
        aria-label={`${label}: open the source document and look for page ${page}`}
        onClick={async () => {
          const pending = controller.openForGuidance(materialId, sourceGuidance(page));
          // The new request's epoch is published synchronously as it starts.
          const request = { controller, epoch: controller.status().epoch };
          started.current = request;
          setShown({ ...request, materialId, page });
          try {
            await pending;
          } finally {
            // A late completion belongs to this click, even if a replacement
            // controller happens to use the same numeric epoch.
            if (started.current === request) started.current = null;
          }
        }}
      >
        {label}
      </button>
      {note ? (
        <span className={`tiny source-badge__note${mine?.kind === "failed" ? " field__error" : " muted"}`} role="status">
          {note}
        </span>
      ) : null}
    </span>
  );
}
