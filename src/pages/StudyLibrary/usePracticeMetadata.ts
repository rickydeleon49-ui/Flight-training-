/**
 * Practice metadata for one material: its legacy conversion status and how
 * many completed attempts it has. Both are optional, read-only facts shown
 * around the practice panel, so a failed read must never look like a clean
 * status or a count of zero, and must never go unhandled.
 *
 * Every read belongs to a request. Only the newest request for the material
 * on screen may publish; a route change, unmount or newer request makes any
 * older read stale, so its late success or failure changes nothing. Retry is
 * synchronously locked while a request is in flight and performs only these
 * two reads.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { PracticeSessionRepository } from "@/data/repositories/practiceSessionRepository";

export interface PracticeConversionStatus {
  legacyMigratedAt: string | null;
  legacyError: string | null;
}

export type PracticeMetadata =
  | { phase: "loading" }
  | { phase: "failed" }
  | { phase: "loaded"; conversionStatus: PracticeConversionStatus | null; completedCount: number };

type Owned = PracticeMetadata & { materialId: string | undefined };

export function usePracticeMetadata(
  materialId: string | undefined,
  practiceSessions: PracticeSessionRepository | undefined,
): { metadata: PracticeMetadata; retry: () => void } {
  const [state, setState] = useState<Owned>({ phase: "loading", materialId });
  /** Id of the request allowed to publish; bumping it makes every older read stale. */
  const currentRequest = useRef(0);
  /** Id of the request still in flight, or null; locks Retry synchronously. */
  const inFlight = useRef<number | null>(null);

  const load = useCallback(() => {
    if (!materialId || !practiceSessions) return;
    const request = ++currentRequest.current;
    inFlight.current = request;
    setState({ phase: "loading", materialId });
    Promise.all([
      practiceSessions.getConversionStatus(materialId),
      practiceSessions.getCompletedHistory(materialId),
    ]).then(
      ([conversionStatus, history]) => {
        if (currentRequest.current !== request) return;
        inFlight.current = null;
        setState({ phase: "loaded", materialId, conversionStatus, completedCount: history.length });
      },
      () => {
        // Consumed here on purpose: the failure is shown as sanitized,
        // retryable status, never as raw database text.
        if (currentRequest.current !== request) return;
        inFlight.current = null;
        setState({ phase: "failed", materialId });
      },
    );
  }, [materialId, practiceSessions]);

  useEffect(() => {
    load();
    return () => {
      currentRequest.current++;
      inFlight.current = null;
    };
  }, [load]);

  const retry = useCallback(() => {
    if (inFlight.current !== null) return;
    load();
  }, [load]);

  // State from a previous material is never shown for this one, even for
  // the render before the effect starts the new request.
  const metadata: PracticeMetadata = state.materialId === materialId ? state : { phase: "loading" };
  return { metadata, retry };
}
