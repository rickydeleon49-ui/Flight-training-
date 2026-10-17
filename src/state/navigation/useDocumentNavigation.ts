/**
 * React access to document navigation (M4 Slice 1).
 *
 * One `NavigationController` is shared per repository set, so a newer page
 * request anywhere (a material's pages panel or a source badge in a study
 * view) retires older work everywhere. `useMaterialNavigation` reads one
 * material's saved place and bookmarks and performs the content-bound writes.
 *
 * Reads can overlap: a mutation, a page check and a settled request each
 * reload. Only the latest read publishes (M4S1-R7): every reload takes a new
 * number, and a completion (state, error or the end of loading) is applied
 * only while it is still the latest and the hook is mounted. A change of
 * material or repository, or unmounting, retires reads still in flight.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { NavigationBookmark, NavigationReadingState, NavigationState } from "@/domain/types";
import type { NavigationRepository } from "@/data/repositories/navigationRepository";
import { NAVIGATION_ERROR_MESSAGES, NavigationError } from "@/data/navigationTransaction";
import { useOptionalAppData } from "@/state/AppDataContext";

import { NavigationController, type NavigationStatus } from "./controller";

const controllers = new WeakMap<NavigationRepository, NavigationController>();

/** The shared controller for a repository set. */
export function navigationControllerFor(repo: NavigationRepository): NavigationController {
  let controller = controllers.get(repo);
  if (!controller) {
    controller = new NavigationController({
      inspect: (materialId) => repo.inspect(materialId),
      operation: (op) => repo.operation(op),
      open: (materialId, hash) => repo.open(materialId, hash),
    });
    controllers.set(repo, controller);
  }
  return controller;
}

const IDLE: NavigationStatus = { kind: "idle", epoch: 0 };
const noSubscription = () => () => {};

export function useNavigationController(): { repo: NavigationRepository | null; controller: NavigationController | null; status: NavigationStatus } {
  const repo = useOptionalAppData()?.repositories?.navigation ?? null;
  const controller = useMemo(() => (repo && repo.supported() ? navigationControllerFor(repo) : null), [repo]);
  const status = useSyncExternalStore(
    controller ? (listener) => controller.subscribe(listener) : noSubscription,
    () => controller?.status() ?? IDLE,
    () => IDLE,
  );
  return { repo, controller, status };
}

/** Plain words for a failed navigation call. */
export function navigationMessage(error: unknown): string {
  return error instanceof NavigationError ? error.message : NAVIGATION_ERROR_MESSAGES.STORAGE_FAILURE;
}

export interface MaterialNavigation {
  state: NavigationState | null;
  loading: boolean;
  error: string | null;
  reload(): Promise<void>;
  /** Check the file's pages now (desktop). Resolves with whether the file had changed. */
  checkPages(): Promise<boolean>;
  setRead(reading: NavigationReadingState, confirmed: boolean): Promise<void>;
  addBookmark(input: { contentSha256: string; physicalPage: number; pageLabel: string | null; title: string; notes: string }): Promise<NavigationBookmark>;
  deleteBookmark(bookmarkId: string): Promise<void>;
}

export function useMaterialNavigation(materialId: string, repo: NavigationRepository | null, status: NavigationStatus): MaterialNavigation {
  const [state, setState] = useState<NavigationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const mounted = useRef(false);

  // Declared before the first read so it is mounted when that read starts.
  // Cleanup retires reads in flight; StrictMode's replayed setup mounts again.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      latest.current += 1;
    };
  }, []);

  const reload = useCallback(async () => {
    const id = ++latest.current;
    const owns = () => mounted.current && latest.current === id;
    if (!repo?.supported()) {
      if (owns()) setLoading(false);
      return;
    }
    if (owns()) setLoading(true);
    try {
      const next = await repo.operation({ kind: "read", materialId });
      if (owns()) {
        setState(next);
        setError(null);
      }
    } catch (caught) {
      if (owns()) setError(navigationMessage(caught));
    } finally {
      if (owns()) setLoading(false);
    }
  }, [materialId, repo]);

  // Another material or repository: its state is not this one's.
  useEffect(() => {
    setState(null);
    setError(null);
    void reload();
  }, [reload]);

  // A save or a refusal for this material may have changed what is stored.
  const settledFor = "materialId" in status && status.materialId === materialId && status.kind !== "working" ? status.epoch : null;
  useEffect(() => {
    if (settledFor !== null) void reload();
  }, [settledFor, reload]);

  return {
    state,
    loading,
    error,
    reload,
    async checkPages() {
      if (!repo) throw new NavigationError("DESKTOP_ONLY", NAVIGATION_ERROR_MESSAGES.DESKTOP_ONLY);
      try {
        const identity = await repo.inspect(materialId);
        return identity.changed;
      } finally {
        await reload();
      }
    },
    async setRead(reading, confirmed) {
      if (!repo) throw new NavigationError("DESKTOP_ONLY", NAVIGATION_ERROR_MESSAGES.DESKTOP_ONLY);
      try {
        await repo.operation({
          kind: "set_read",
          materialId,
          expectedContentSha256: reading.originatingContentSha256 ?? "",
          expectedOwnerGeneration: reading.ownerGeneration,
          physicalPage: reading.lastRequestedPage,
          confirmed,
        });
      } finally {
        await reload();
      }
    },
    async addBookmark(input) {
      if (!repo) throw new NavigationError("DESKTOP_ONLY", NAVIGATION_ERROR_MESSAGES.DESKTOP_ONLY);
      try {
        return await repo.operation({
          kind: "add_bookmark",
          materialId,
          expectedContentSha256: input.contentSha256,
          bookmarkId: crypto.randomUUID(),
          physicalPage: input.physicalPage,
          pageLabel: input.pageLabel,
          title: input.title,
          notes: input.notes,
        });
      } finally {
        await reload();
      }
    },
    async deleteBookmark(bookmarkId) {
      if (!repo) throw new NavigationError("DESKTOP_ONLY", NAVIGATION_ERROR_MESSAGES.DESKTOP_ONLY);
      try {
        await repo.operation({ kind: "delete_bookmark", materialId, bookmarkId });
      } finally {
        await reload();
      }
    },
  };
}
