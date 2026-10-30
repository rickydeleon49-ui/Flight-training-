// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readDraft } from "@/lib/drafts";
import { useMaterialNotes } from "./useMaterialNotes";

function deferred() {
  let resolve!: (value?: unknown) => void;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const stored = (id = "a") =>
  readDraft<{ text: string }>(`material.${id}.notes`);

it("keeps newer text through a delayed autosave refresh and drains it in order", async () => {
  const first = deferred(),
    second = deferred();
  const save = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const hook = renderHook(({ saved }) => useMaterialNotes("a", saved, save), {
    initialProps: { saved: "original" },
  });
  act(() => hook.result.current.setNotes("first"));
  expect(readDraft<{ baseline: string }>("material.a.notes")?.baseline).toBe("original");
  await act(() => vi.advanceTimersByTimeAsync(700));
  act(() => hook.result.current.setNotes("newer"));
  hook.rerender({ saved: "first" });
  await act(async () => first.resolve());
  expect(hook.result.current.notes).toBe("newer");
  expect(hook.result.current.status).toBe("saving");
  expect(stored()?.text).toBe("newer");
  expect(readDraft<{ baseline: string }>("material.a.notes")?.baseline).toBe("first");
  expect(save.mock.calls).toEqual([["first"], ["newer"]]);
  await act(async () => second.resolve());
  expect(hook.result.current.status).toBe("saved");
  expect(stored()).toBeNull();
});

it("recovers the last keystroke after closing before the debounce or IPC finishes", () => {
  const save = () => new Promise(() => {});
  const hook = renderHook(() => useMaterialNotes("a", "old", save));
  act(() => hook.result.current.setNotes("last keystroke"));
  // Simulate a destroyed webview: no timers or save promises are allowed to finish.
  hook.unmount();
  const reopened = renderHook(() => useMaterialNotes("a", "old", save));
  expect(reopened.result.current.notes).toBe("last keystroke");
});

it("flushes on navigation and keeps materials separate", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const first = renderHook(() => useMaterialNotes("a", "old", save));
  act(() => first.result.current.setNotes("A notes"));
  await act(async () => first.unmount());
  const next = renderHook(() => useMaterialNotes("b", "B notes", save));
  expect(next.result.current.notes).toBe("B notes");
  expect(save).toHaveBeenCalledExactlyOnceWith("A notes");
});

it("retains failed saves and retries without losing the draft", async () => {
  const save = vi
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(undefined);
  const hook = renderHook(() => useMaterialNotes("a", "old", save));
  act(() => hook.result.current.setNotes("keep me"));
  await act(() => vi.advanceTimersByTimeAsync(700));
  expect(hook.result.current.status).toBe("error");
  expect(stored()?.text).toBe("keep me");
  await act(() => hook.result.current.retry());
  expect(stored()).toBeNull();
});

it("does not clear or overwrite a newer remounted editor's draft", async () => {
  const first = deferred();
  const oldSave = vi.fn().mockReturnValue(first.promise);
  const old = renderHook(() => useMaterialNotes("a", "base", oldSave));
  act(() => old.result.current.setNotes("in flight"));
  await act(() => vi.advanceTimersByTimeAsync(700));
  act(() => old.result.current.setNotes("old pending"));
  old.unmount();
  const newer = renderHook(() =>
    useMaterialNotes("a", "base", () => new Promise(() => {})),
  );
  act(() => newer.result.current.setNotes("new editor"));
  await act(async () => first.resolve());
  expect(stored()?.text).toBe("new editor");
  expect(oldSave).toHaveBeenCalledTimes(1);
});

it("saves an intentionally empty note even when it matches the preflight database value", async () => {
  const first = deferred();
  const save = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(undefined);
  const hook = renderHook(() => useMaterialNotes("a", "", save));
  act(() => hook.result.current.setNotes("temporary"));
  await act(() => vi.advanceTimersByTimeAsync(700));
  act(() => hook.result.current.setNotes(""));
  await act(async () => first.resolve());
  expect(save.mock.calls).toEqual([["temporary"], [""]]);
});

it("reports storage failure instead of claiming close recovery is available", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("full");
  });
  const hook = renderHook(() =>
    useMaterialNotes("a", "", () => new Promise(() => {})),
  );
  act(() => hook.result.current.setNotes("keep window open"));
  expect(hook.result.current.recoverable).toBe(false);
});

it("still saves newer text if storage fills after an earlier draft was kept", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() => useMaterialNotes("a", "", save));
  act(() => hook.result.current.setNotes("older recoverable draft"));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("full");
  });
  act(() => hook.result.current.setNotes("newest text"));
  await act(() => vi.advanceTimersByTimeAsync(700));
  expect(save).toHaveBeenCalledExactlyOnceWith("newest text");
  expect(hook.result.current.status).toBe("saved");
  expect(stored()).toBeNull();
});

it.each(["old baseline", undefined])("holds restored or legacy drafts until she chooses (%s)", async (baseline) => {
  localStorage.setItem("her-flight-deck.draft.material.a.notes", JSON.stringify({ text: "earlier typing", revision: "r", baseline }));
  const save = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() => useMaterialNotes("a", "restored saved notes", save));
  expect(hook.result.current.notes).toBe("earlier typing");
  await act(() => vi.advanceTimersByTimeAsync(1000));
  await act(() => hook.result.current.retry());
  expect(save).not.toHaveBeenCalled();
  expect(hook.result.current.conflict).toBe(true);
  hook.unmount();
  expect(stored()?.text).toBe("earlier typing");
  const reopened = renderHook(() => useMaterialNotes("a", "restored saved notes", save));
  await act(async () => reopened.result.current.keepDraft());
  expect(save).toHaveBeenCalledExactlyOnceWith("earlier typing");
  expect(stored()).toBeNull();
});

it("discards a conflicting draft only after Use the saved notes", async () => {
  localStorage.setItem("her-flight-deck.draft.material.a.notes", JSON.stringify({ text: "earlier", revision: "r", baseline: "old" }));
  const save = vi.fn();
  const hook = renderHook(() => useMaterialNotes("a", "restored", save));
  expect(stored()?.text).toBe("earlier");
  act(() => hook.result.current.useSaved());
  expect(hook.result.current.notes).toBe("restored");
  expect(hook.result.current.conflict).toBe(false);
  expect(stored()).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(1000));
  hook.unmount();
  expect(save).not.toHaveBeenCalled();
});

it("autosaves a recovered draft with the same baseline", async () => {
  localStorage.setItem("her-flight-deck.draft.material.a.notes", JSON.stringify({ text: "earlier", revision: "r", baseline: "saved" }));
  const save = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() => useMaterialNotes("a", "saved", save));
  expect(hook.result.current.conflict).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(700));
  expect(save).toHaveBeenCalledExactlyOnceWith("earlier");
});
