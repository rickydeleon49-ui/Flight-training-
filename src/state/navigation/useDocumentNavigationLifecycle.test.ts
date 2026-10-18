// @vitest-environment jsdom
import { useEffect, useLayoutEffect } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { NavigationOperation, NavigationReadingState, NavigationState } from "@/domain/types";
import type { NavigationRepository } from "@/data/repositories/navigationRepository";
import { useMaterialNavigation, type MaterialNavigation } from "./useDocumentNavigation";

const A = "a".repeat(64), B = "b".repeat(64), C = "c".repeat(64);
const IDLE = { kind: "idle" as const, epoch: 0 };
function gate() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function snapshot(materialId: string, hash: string): NavigationState {
  return { materialId, identity: { materialId, contentSha256: hash, totalPages: 50, verifiedAt: "x" }, readingState: null, bookmarks: [] };
}
const reading: NavigationReadingState = { materialId: "m1", lastRequestedPage: 3, lastRequestedPageLabel: null, confirmedRead: false, originatingContentSha256: A, status: "active", ownerGeneration: 1, updatedAt: "x" };
const actions = ["checkPages", "setRead", "addBookmark", "deleteBookmark"] as const;
type Action = typeof actions[number];
function start(nav: MaterialNavigation, action: Action): Promise<unknown> {
  switch (action) {
    case "checkPages": return nav.checkPages();
    case "setRead": return nav.setRead(reading, true);
    case "addBookmark": return nav.addBookmark({ contentSha256: A, physicalPage: 3, pageLabel: null, title: "Synthetic", notes: "" });
    case "deleteBookmark": return nav.deleteBookmark("synthetic");
  }
}
function rig(hash: (id: string) => string, upstream = gate()) {
  const reads: string[] = [];
  let mutations = 0;
  let holdRead: ReturnType<typeof gate> | null = null;
  const work = async () => { mutations++; await upstream.promise; };
  const repo = {
    supported: () => true,
    inspect: async (id: string) => { await work(); return { ...snapshot(id, hash(id)).identity!, changed: false }; },
    operation: async (op: NavigationOperation) => {
      if (op.kind === "read") { reads.push(op.materialId); const held = holdRead; if (held) await held.promise; return snapshot(op.materialId, hash(op.materialId)); }
      await work(); return { deleted: true };
    },
  } as unknown as NavigationRepository;
  return { repo, reads, upstream, mutations: () => mutations, holdReads: (held: ReturnType<typeof gate>) => { holdRead = held; } };
}
afterEach(cleanup);

describe("R11: action ownership survives awaited work", () => {
  for (const action of actions) for (const context of ["repository", "material"] as const) for (const outcome of ["success", "error"] as const) {
    it(`${action}: old ${outcome} after ${context} change cannot dispatch a retired read`, async () => {
      const old = rig(id => id === "m1" ? A : B), next = rig(() => B);
      const { result, rerender } = renderHook(({ id, repo }) => useMaterialNavigation(id, repo, IDLE), { initialProps: { id: "m1", repo: old.repo } });
      await waitFor(() => expect(result.current.state?.identity?.contentSha256).toBe(A));
      let completed!: Promise<string>;
      act(() => { completed = start(result.current, action).then(() => "success", () => "error"); });
      expect(old.mutations()).toBe(1);
      const id = context === "material" ? "m2" : "m1";
      rerender({ id, repo: context === "repository" ? next.repo : old.repo });
      await waitFor(() => expect(result.current.state?.identity?.contentSha256).toBe(B));
      const readCount = old.reads.length;
      await act(async () => { if (outcome === "success") old.upstream.resolve(); else old.upstream.reject(new Error("old operation refused")); expect(await completed).toBe(outcome); });
      expect(old.reads).toHaveLength(readCount);
      expect(result.current.state?.materialId).toBe(id);
      expect(result.current.state?.identity?.contentSha256).toBe(B);
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  }
  it("retired follow-up work cannot invalidate a current read still in flight", async () => {
    const old = rig(() => A), next = rig(() => B), heldRead = gate();
    next.holdReads(heldRead);
    const { result, rerender } = renderHook(({ repo }) => useMaterialNavigation("m1", repo, IDLE), { initialProps: { repo: old.repo } });
    await waitFor(() => expect(result.current.state?.identity?.contentSha256).toBe(A));
    const done = result.current.deleteBookmark("synthetic");
    rerender({ repo: next.repo });
    await waitFor(() => expect(next.reads).toHaveLength(1));
    await act(async () => { old.upstream.resolve(); await done; });
    expect(result.current.loading).toBe(true);
    expect(result.current.state).toBeNull();
    expect(old.reads).toHaveLength(1);
    await act(async () => { heldRead.resolve(); });
    await waitFor(() => expect(result.current.state?.identity?.contentSha256).toBe(B));
  });
  for (const action of actions) it(`${action}: the current context still refreshes after completion`, async () => {
    let hash = A; const current = rig(() => hash);
    const { result } = renderHook(() => useMaterialNavigation("m1", current.repo, IDLE));
    await waitFor(() => expect(result.current.state?.identity?.contentSha256).toBe(A));
    const done = start(result.current, action);
    hash = C;
    await act(async () => { current.upstream.resolve(); await done; });
    expect(current.reads).toHaveLength(2);
    expect(result.current.state?.identity?.contentSha256).toBe(C);
  });
  it("a callback retained from a retired context cannot start another mutation", async () => {
    const old = rig(() => A), next = rig(() => B);
    const { result, rerender } = renderHook(({ repo }) => useMaterialNavigation("m1", repo, IDLE), { initialProps: { repo: old.repo } });
    await waitFor(() => expect(result.current.state?.identity?.contentSha256).toBe(A));
    const retired = result.current;
    rerender({ repo: next.repo });
    await waitFor(() => expect(result.current.state?.identity?.contentSha256).toBe(B));
    for (const action of actions) await expect(start(retired, action)).rejects.toMatchObject({ code: "STALE_STATE" });
    expect(old.mutations()).toBe(0);
  });
  it("unmount prevents follow-up reads after an already-dispatched action", async () => {
    const old = rig(() => A);
    const { result, unmount } = renderHook(() => useMaterialNavigation("m1", old.repo, IDLE));
    await waitFor(() => expect(old.reads).toHaveLength(1));
    const done = result.current.checkPages(); unmount();
    await act(async () => { old.upstream.resolve(); await done; });
    expect(old.reads).toHaveLength(1);
  });
  it("StrictMode's retired action cannot borrow the replayed lifetime's lease", async () => {
    const inspections: ReturnType<typeof gate>[] = [], completions: Promise<unknown>[] = [];
    let reads = 0;
    const repo = { supported: () => true, operation: async () => { reads++; return snapshot("m1", B); }, inspect: async () => { const held = gate(); inspections.push(held); await held.promise; return { ...snapshot("m1", B).identity!, changed: false }; } } as unknown as NavigationRepository;
    renderHook(() => { const nav = useMaterialNavigation("m1", repo, IDLE); useEffect(() => { completions.push(nav.checkPages()); }, []); return nav; }, { reactStrictMode: true });
    await waitFor(() => expect(inspections).toHaveLength(2));
    const initialReads = reads;
    await act(async () => { inspections[0]!.resolve(); await completions[0]; });
    expect(reads).toBe(initialReads);
    await act(async () => { inspections[1]!.resolve(); await completions[1]; });
    expect(reads).toBe(initialReads + 1);
  });
});

describe("a click on freshly shown controls is never refused as stale", () => {
  it("an action started before passive effects have run still runs and refreshes, and an older initial read cannot overwrite it", async () => {
    // Reads are answered by hand, in a chosen order, with distinguishable
    // snapshots: the initial read would report content A, the read after the
    // action content B.
    const reads: { hash: string; gate: ReturnType<typeof gate> }[] = [];
    let inspections = 0;
    let nextHash = A;
    const inspection = gate();
    const repo = {
      supported: () => true,
      inspect: async (id: string) => {
        inspections++;
        await inspection.promise;
        nextHash = B;
        return { ...snapshot(id, B).identity!, changed: true };
      },
      operation: async (op: NavigationOperation) => {
        if (op.kind !== "read") return { deleted: true };
        const entry = { hash: nextHash, gate: gate() };
        reads.push(entry);
        await entry.gate.promise;
        return snapshot(op.materialId, entry.hash);
      },
    } as unknown as NavigationRepository;
    let outcome: Promise<string> | null = null;
    // The probe's own layout effect runs during the commit, before any passive
    // effect: the earliest moment a user's click could reach the new controls.
    const { result } = renderHook(() => {
      const nav = useMaterialNavigation("m1", repo, IDLE);
      useLayoutEffect(() => {
        outcome ??= nav.checkPages().then(() => "ran", (error: unknown) => `refused: ${String((error as Error)?.message ?? error)}`);
      });
      return nav;
    });
    expect(outcome).not.toBeNull();
    // The initial read (content A) is dispatched while the inspection is held;
    // then the inspection finishes and the action's follow-up read (content B)
    // is dispatched. Both are pending.
    await waitFor(() => expect(reads).toHaveLength(1));
    await act(async () => inspection.resolve());
    await waitFor(() => expect(reads).toHaveLength(2));
    expect(inspections).toBe(1);
    const followUp = reads.find((r) => r.hash === B)!;
    const initial = reads.find((r) => r.hash === A)!;
    expect(followUp).toBeTruthy();
    expect(initial).toBeTruthy();
    // The newer read answers first; the older initial read answers last.
    await act(async () => {
      followUp.gate.resolve();
      expect(await outcome).toBe("ran");
    });
    await act(async () => {
      initial.gate.resolve();
      await initial.gate.promise;
    });
    expect(result.current.state?.identity?.contentSha256).toBe(B);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
