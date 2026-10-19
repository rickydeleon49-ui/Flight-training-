import { useEffect, useMemo, useState } from "react";

import type { StudyMaterial } from "@/domain/types";
import { describeReadiness, type ReadinessTone } from "@/logic/offlineReadiness";
import { offlineContentReadiness, offlineStudyEnabled } from "@/services/offlineContent";

export interface OfflineBadge {
  label: string;
  tone: ReadinessTone;
}

/**
 * Offline-study badges for the documents on screen (OFFLINE-01b): one
 * readiness request per change of the shown set. Empty unless this build
 * opted in. "Checking" and "not a PDF" show no badge, to keep cards quiet.
 */
export function useOfflineBadges(shown: StudyMaterial[]): Map<string, OfflineBadge> {
  const ids = useMemo(
    () => shown.filter((m) => m.filePath?.toLowerCase().endsWith(".pdf")).map((m) => m.id),
    [shown],
  );
  const key = ids.join("\0");
  const [badges, setBadges] = useState<Map<string, OfflineBadge>>(() => new Map());

  useEffect(() => {
    if (!offlineStudyEnabled() || ids.length === 0) {
      setBadges(new Map());
      return;
    }
    let live = true;
    offlineContentReadiness(ids)
      .then((rows) => {
        if (!live) return;
        const next = new Map<string, OfflineBadge>();
        for (const { materialId, readiness } of rows) {
          if (readiness.state === "checking" || readiness.state === "unsupported") continue;
          const { label, tone } = describeReadiness(readiness);
          next.set(materialId, { label, tone });
        }
        setBadges(next);
      })
      .catch(() => {
        if (live) setBadges(new Map());
      });
    return () => {
      live = false;
    };
    // `key` captures the shown PDF ids; `ids` itself is a new array each render.
  }, [key]);

  return badges;
}
