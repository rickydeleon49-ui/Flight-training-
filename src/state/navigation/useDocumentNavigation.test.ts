// @vitest-environment jsdom
/**
 * The navigation hook's read ownership (M4S1-R7) and guidance opening through
 * the real `navigationControllerFor` port composition (M4S1-R8). Repositories
 * are deterministic stand-ins whose reads, inspections and opens can be held;
 * no timer, file, reader or database is involved.
 */
import { act, cleanup, configure, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { InspectedNavigationIdentity, NavigationState } from "@/domain/types";
import { NAVIGATION_ERROR_MESSAGES, NavigationError } from "@/data/navigationTransaction";
import type { NavigationRepository } from "@/data/repositories/navigationRepository";

import type { NavigationStatus } from "./controller";
import { navigationControllerFor, useMaterialNavigation } from "./useDocumentNavigation";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const state = (hash: string, materialId = "m"): NavigationState => ({
  materialId,
  identity: { materialId, contentSha256: hash, totalPages: 50, verifiedAt: "x" },
  readingState: null,
  bookmarks: [],
});

const identity = (materialId: string, hash: string): InspectedNavigationIdentity => ({ materialId, contentSha256: hash, totalPages: 5, verifiedAt: "x", changed: false });

const IDLE: NavigationStatus = { kind: "idle", epoch: 0 };

/** A repository whose reads are answered, in order, by queued gates. */
function readRepo() {
  const reads: { materialId: string; gate: ReturnType<typeof gate<NavigationState>> }[] = [];
  const repo = {
    supported: () => true,
    canCheckFiles: () => true,
    operation: async (op: { kind: string; materialId: string }) => {
      if (op.kind === "read") {
        const g = gate<NavigationState>();
        reads.push({ materialId: op.materialId, gate: g });
        return g.promise;
      }
      return {};
    },
    inspect: async (materialId: string) => identity(materialId, A),
    open: async () => undefined,
  } as unknown as NavigationRepository;
  return { repo, reads };
}

const hashOf = (nav: { state: NavigationState | null }) => nav.state?.identity?.contentSha256 ?? null;

afterEach(cleanup);

describe("only the latest read publishes (M4S1-R7)", () => {
  it("an older material reload cannot overwrite newer content state", async () => {
    // Promoted from the frozen review diagnostic.
    const { repo, reads } = readRepo();
    const { result } = renderHook(() => useMaterialNavigation("m", repo, IDLE));
    await waitFor(() => expect(reads).toHaveLength(1));
    let newer!: Promise<void>;
    act(() => {
      newer = result.current.reload();
    });
    await act(async () => {
      reads[1]!.gate.resolve(state(B));
      await newer;
    });
    expect(hashOf(result.current)).toBe(B);
    await act(async () => {
      reads[0]!.gate.resolve(state(A));
      await reads[0]!.gate.promise;
    });
    expect(hashOf(result.current), "late A must not replace B").toBe(B);
  });

  it("a stale error does not erase a later success", async () => {
    const { repo, reads } = readRepo();
    const { result } = renderHook(() => useMaterialNavigation("m", repo, IDLE));
    await waitFor(() => expect(reads).toHaveLength(1));
    await act(async () => {
      const newer = result.current.reload();
      reads[1]!.gate.resolve(state(B));
      await newer;
    });
    await act(async () => {
      reads[0]!.gate.reject(new NavigationError("STORAGE_FAILURE", NAVIGATION_ERROR_MESSAGES.STORAGE_FAILURE));
      await reads[0]!.gate.promise.catch(() => undefined);
    });
    expect(hashOf(result.current)).toBe(B);
    expect(result.current.error).toBeNull();
  });

  it("a stale completion does not end the latest read's loading", async () => {
    const { repo, reads } = readRepo();
    const { result } = renderHook(() => useMaterialNavigation("m", repo, IDLE));
    await waitFor(() => expect(reads).toHaveLength(1));
    let newer!: Promise<void>;
    act(() => {
      newer = result.current.reload();
    });
    await act(async () => {
      reads[0]!.gate.resolve(state(A));
      await reads[0]!.gate.promise;
    });
    expect(result.current.loading, "the newer read is still loading").toBe(true);
    expect(hashOf(result.current)).toBeNull();
    await act(async () => {
      reads[1]!.gate.resolve(state(B));
      await newer;
    });
    expect(result.current.loading).toBe(false);
    expect(hashOf(result.current)).toBe(B);
  });

  it("a change of material retires the old material's read and clears its state", async () => {
    const { repo, reads } = readRepo();
    const { result, rerender } = renderHook(({ id }) => useMaterialNavigation(id, repo, IDLE), { initialProps: { id: "m1" } });
    await waitFor(() => expect(reads).toHaveLength(1));
    await act(async () => {
      reads[0]!.gate.resolve(state(A, "m1"));
    });
    expect(hashOf(result.current)).toBe(A);
    let held!: ReturnType<typeof gate<NavigationState>>;
    await act(async () => {
      void result.current.reload();
    });
    held = reads[1]!.gate;
    rerender({ id: "m2" });
    expect(result.current.state, "m1's state is not shown for m2").toBeNull();
    await waitFor(() => expect(reads).toHaveLength(3));
    await act(async () => {
      reads[2]!.gate.resolve(state(B, "m2"));
    });
    await act(async () => {
      held.resolve(state(C, "m1"));
    });
    expect(result.current.state?.materialId).toBe("m2");
    expect(hashOf(result.current)).toBe(B);
  });

  it("a change of repository retires reads from the old one", async () => {
    const first = readRepo();
    const second = readRepo();
    const { result, rerender } = renderHook(({ repo }) => useMaterialNavigation("m", repo, IDLE), { initialProps: { repo: first.repo } });
    await waitFor(() => expect(first.reads).toHaveLength(1));
    rerender({ repo: second.repo });
    await waitFor(() => expect(second.reads).toHaveLength(1));
    await act(async () => {
      second.reads[0]!.gate.resolve(state(B));
    });
    await act(async () => {
      first.reads[0]!.gate.resolve(state(A));
    });
    expect(hashOf(result.current)).toBe(B);
  });

  it("follow-up reads after a mutation and after a settled request still win over an older read", async () => {
    const { repo, reads } = readRepo();
    const { result, rerender } = renderHook(({ status }) => useMaterialNavigation("m", repo, status), { initialProps: { status: IDLE as NavigationStatus } });
    await waitFor(() => expect(reads).toHaveLength(1));
    let deleting!: Promise<void>;
    act(() => {
      deleting = result.current.deleteBookmark("bm");
    });
    await waitFor(() => expect(reads).toHaveLength(2));
    await act(async () => {
      reads[1]!.gate.resolve(state(B));
      await deleting;
    });
    await act(async () => {
      reads[0]!.gate.resolve(state(A));
    });
    expect(hashOf(result.current)).toBe(B);

    // A request for this material settles while an older reload is held.
    act(() => {
      void result.current.reload();
    });
    rerender({ status: { kind: "guidance", epoch: 7, materialId: "m", message: "x" } });
    await waitFor(() => expect(reads).toHaveLength(4));
    await act(async () => {
      reads[3]!.gate.resolve(state(C));
    });
    await act(async () => {
      reads[2]!.gate.resolve(state(A));
    });
    expect(hashOf(result.current)).toBe(C);
  });

  it("a page check's follow-up read is owned the same way", async () => {
    const { repo, reads } = readRepo();
    const { result } = renderHook(() => useMaterialNavigation("m", repo, IDLE));
    await waitFor(() => expect(reads).toHaveLength(1));
    let checking!: Promise<boolean>;
    act(() => {
      checking = result.current.checkPages();
    });
    await waitFor(() => expect(reads).toHaveLength(2));
    await act(async () => {
      reads[1]!.gate.resolve(state(B));
      await checking;
    });
    await act(async () => {
      reads[0]!.gate.resolve(state(A));
    });
    expect(hashOf(result.current)).toBe(B);
  });

  it("nothing publishes after unmount", async () => {
    const { repo, reads } = readRepo();
    const { result, unmount } = renderHook(() => useMaterialNavigation("m", repo, IDLE));
    await waitFor(() => expect(reads).toHaveLength(1));
    const before = result.current;
    unmount();
    await act(async () => {
      reads[0]!.gate.resolve(state(A));
    });
    expect(result.current).toBe(before);
    expect(hashOf(result.current)).toBeNull();
  });

  it("under StrictMode the replayed read wins and the hook keeps working afterwards", async () => {
    const { repo, reads } = readRepo();
    // The library's own StrictMode root: setup, cleanup and setup again.
    configure({ reactStrictMode: true });
    let rendered: ReturnType<typeof renderHook<ReturnType<typeof useMaterialNavigation>, unknown>>;
    try {
      rendered = renderHook(() => useMaterialNavigation("m", repo, IDLE));
    } finally {
      configure({ reactStrictMode: false });
    }
    const { result } = rendered;
    await waitFor(() => expect(reads).toHaveLength(2));
    await act(async () => {
      reads[1]!.gate.resolve(state(B));
    });
    await act(async () => {
      reads[0]!.gate.resolve(state(A));
    });
    expect(hashOf(result.current), "the read retired by StrictMode's cleanup does not publish").toBe(B);
    expect(result.current.loading).toBe(false);
    await act(async () => {
      const later = result.current.reload();
      reads[2]!.gate.resolve(state(C));
      await later;
    });
    expect(hashOf(result.current), "not left permanently unmounted").toBe(C);
  });
});

/** A repository whose inspections can be held per material and whose opens are recorded. */
function guidanceRepo() {
  const inspections = new Map<string, ReturnType<typeof gate<InspectedNavigationIdentity>>>();
  const inspectFails = new Map<string, unknown>();
  const opened: string[] = [];
  const writes: string[] = [];
  const repo = {
    supported: () => true,
    canCheckFiles: () => true,
    inspect: async (materialId: string) => {
      const failure = inspectFails.get(materialId);
      if (failure) throw failure;
      const held = inspections.get(materialId);
      return held ? held.promise : identity(materialId, B);
    },
    open: async (materialId: string, hash: string) => {
      opened.push(`${materialId}:${hash.slice(0, 1)}`);
    },
    operation: async (op: { kind: string }) => {
      writes.push(op.kind);
      throw new Error("guidance must not write");
    },
  } as unknown as NavigationRepository;
  const hold = (materialId: string) => {
    const g = gate<InspectedNavigationIdentity>();
    inspections.set(materialId, g);
    return g;
  };
  return { repo, opened, writes, hold, inspectFails };
}

describe("guidance opens only while it is current, on the real port composition (M4S1-R8)", () => {
  it("a superseded guidance inspection must not launch its old document", async () => {
    // Promoted from the frozen review diagnostic.
    const r = guidanceRepo();
    const first = r.hold("m1");
    const controller = navigationControllerFor(r.repo);
    const older = controller.openForGuidance("m1", "A");
    await controller.openForGuidance("m2", "B");
    first.resolve(identity("m1", A));
    expect(await older).toBeNull();
    expect(r.opened, "retired guidance A must not open after B").toEqual(["m2:b"]);
    expect(r.writes).toEqual([]);
  });

  it("legitimate guidance opens the inspected content and saves, reserves and confirms nothing", async () => {
    const r = guidanceRepo();
    const controller = navigationControllerFor(r.repo);
    expect(await controller.openForGuidance("m1", "Look for page 12.")).toMatchObject({ kind: "guidance", materialId: "m1", message: "Look for page 12." });
    expect(r.opened).toEqual(["m1:b"]);
    expect(r.writes).toEqual([]);
  });

  it("abort while the inspection is held: nothing opens", async () => {
    const r = guidanceRepo();
    const held = r.hold("m1");
    const controller = navigationControllerFor(r.repo);
    const pending = controller.openForGuidance("m1", "A");
    controller.abort();
    held.resolve(identity("m1", A));
    expect(await pending).toBeNull();
    expect(r.opened).toEqual([]);
    expect(controller.status().kind).toBe("idle");
  });

  it("dispose while the inspection is held: nothing opens", async () => {
    const r = guidanceRepo();
    const held = r.hold("m1");
    const controller = navigationControllerFor(r.repo);
    const pending = controller.openForGuidance("m1", "A");
    controller.dispose();
    held.resolve(identity("m1", A));
    expect(await pending).toBeNull();
    expect(r.opened).toEqual([]);
  });

  it("a newer request that fails still retires the older guidance", async () => {
    const r = guidanceRepo();
    const held = r.hold("m1");
    r.inspectFails.set("m2", new NavigationError("FILE_MISSING", NAVIGATION_ERROR_MESSAGES.FILE_MISSING));
    const controller = navigationControllerFor(r.repo);
    const older = controller.openForGuidance("m1", "A");
    expect(await controller.openForGuidance("m2", "B")).toMatchObject({ kind: "failed", code: "FILE_MISSING" });
    held.resolve(identity("m1", A));
    expect(await older).toBeNull();
    expect(r.opened).toEqual([]);
    expect(controller.status()).toMatchObject({ kind: "failed", materialId: "m2" });
  });

  it("a newer page request retires older guidance before its open", async () => {
    const r = guidanceRepo();
    const held = r.hold("m1");
    const controller = navigationControllerFor(r.repo);
    const older = controller.openForGuidance("m1", "A");
    // The page request is refused before any write (page 9 of 5), but it is newer.
    expect(await controller.request({ materialId: "m2", reference: 9, provenance: "physical_index" })).toMatchObject({ kind: "refused" });
    held.resolve(identity("m1", A));
    expect(await older).toBeNull();
    expect(r.opened).toEqual([]);
  });
});
