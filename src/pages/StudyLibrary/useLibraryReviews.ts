/**
 * React ownership for the library-wide card review streams (M2-4 / C2).
 *
 * Each view owns one stream for its lifetime. Mounting activates it and
 * loads the first page; unmounting disposes it, so no read from a view she
 * has left can publish (React StrictMode's extra unmount/mount is covered by
 * the same rule). A change of filters, the local day or the published app
 * data revision is an authoritative invalidation with a freshly captured
 * clock.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { CardLibraryRepository } from "@/data/repositories/cardLibraryRepository";
import { currentTimeZone, nextLocalMidnightUtc } from "@/logic/localDay";

import {
  createDueStream,
  createHistoryStream,
  type DueOptions,
  type HistoryOptions,
} from "./deferredReviewRead";

/** One instant and its exclusive local-day end, captured together. */
export function captureClock(): { nowUtc: string; nextLocalMidnightUtc: string } {
  const nowUtc = new Date().toISOString();
  return { nowUtc, nextLocalMidnightUtc: nextLocalMidnightUtc(nowUtc, currentTimeZone()) };
}

export function useStreamState<T>(stream: { subscribe(listener: () => void): () => void; getSnapshot(): T }): T {
  return useSyncExternalStore(stream.subscribe, stream.getSnapshot, stream.getSnapshot);
}

interface OwnedStream {
  activate(): void;
  dispose(): void;
  invalidate(options?: object): void;
  loadNextPage(): Promise<void>;
  getSnapshot(): { pagesLoaded: number; loading: unknown; failedRead: unknown };
}

/**
 * Activate on mount, invalidate when `key` changes (with `options()` taken
 * then), and load the first page whenever nothing is loaded or loading.
 */
function useOwnedStream(
  stream: OwnedStream,
  key: string,
  options: () => object,
) {
  const appliedKey = useRef<string | null>(null);
  const latestOptions = useRef(options);
  latestOptions.current = options;
  useEffect(() => {
    stream.activate();
    if (appliedKey.current !== null && appliedKey.current !== key) stream.invalidate(latestOptions.current());
    appliedKey.current = key;
    const s = stream.getSnapshot();
    if (s.pagesLoaded === 0 && s.loading === null && s.failedRead === null) void stream.loadNextPage();
    return () => stream.dispose();
  }, [stream, key]);
}

export interface DueViewFilters {
  statusFilter: DueOptions["statusFilter"];
  topic: string | null;
}

export function useLibraryDueStream(
  repository: CardLibraryRepository,
  filters: DueViewFilters,
  dataRevision: number,
  limit = 50,
) {
  const [stream] = useState(() =>
    createDueStream((input) => repository.readReviewDue(input), { ...captureClock(), ...filters, limit }),
  );
  const state = useStreamState(stream);
  const options = () => ({ ...captureClock(), ...filters, limit });
  const latestOptions = useRef(options);
  latestOptions.current = options;
  useOwnedStream(stream, JSON.stringify([filters.statusFilter, filters.topic, dataRevision]), options);
  // What is due ends at the next local midnight of the zone the computer is
  // in now. A timer aims at that midnight, but timers stall during sleep and
  // the zone can change, so focus and a return to a visible window check
  // again. Only a different boundary starts over, with a new clock and the
  // current filters; otherwise loaded pages and a failed read are kept.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reconcile = () => {
      const next = latestOptions.current();
      if (next.nextLocalMidnightUtc !== stream.getSnapshot().options.nextLocalMidnightUtc) {
        stream.invalidate(next);
        void stream.loadNextPage();
      }
      clearTimeout(timer);
      const wait = Date.parse(next.nextLocalMidnightUtc) - Date.parse(next.nowUtc);
      timer = setTimeout(reconcile, Math.max(1_000, Math.min(wait + 1_000, 2_147_000_000)));
    };
    const onResume = () => {
      if (document.visibilityState !== "hidden") reconcile();
    };
    reconcile();
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [stream]);
  const refresh = () => {
    stream.invalidate(captureClock());
    void stream.loadNextPage();
  };
  return { stream, state, refresh };
}

export function useLibraryHistoryStream(
  repository: CardLibraryRepository,
  filters: Pick<HistoryOptions, "materialId" | "topic">,
  dataRevision: number,
) {
  const [stream] = useState(() =>
    createHistoryStream((input) => repository.readRecentReviews(input), { ...filters, limit: 20 }),
  );
  const state = useStreamState(stream);
  useOwnedStream(stream, JSON.stringify([filters.materialId, filters.topic, dataRevision]), () => ({ ...filters, limit: 20 }));
  const refresh = () => {
    stream.invalidate();
    void stream.loadNextPage();
  };
  return { stream, state, refresh };
}
