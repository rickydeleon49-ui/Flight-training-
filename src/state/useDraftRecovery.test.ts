// @vitest-environment jsdom
import { StrictMode, createElement, useState } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readDraft, writeDraft } from "@/lib/drafts";
import { useDraftRecovery } from "./useDraftRecovery";

beforeEach(() => localStorage.clear());
afterEach(cleanup);
function form() {
  const [value, setValue] = useState("initial");
  const recovery = useDraftRecovery("test", value, setValue);
  return { value, setValue, ...recovery };
}
it("keeps typing when navigation happens without advancing a debounce", () => {
  const hook = renderHook(form);
  act(() => hook.result.current.setValue("last letter"));
  hook.unmount();
  expect(renderHook(form).result.current.value).toBe("last letter");
});
it("restores before mirroring even under StrictMode", () => {
  writeDraft("test", "recovered text");
  const hook = renderHook(form, {
    wrapper: ({ children }) => createElement(StrictMode, null, children),
  });
  expect(hook.result.current.value).toBe("recovered text");
  expect(readDraft("test")).toBe("recovered text");
});
it("does not recreate a forgotten draft on unmount", () => {
  const hook = renderHook(form);
  act(() => hook.result.current.setValue("saved now"));
  act(() => hook.result.current.forget());
  hook.unmount();
  expect(readDraft("test")).toBeNull();
});
it("ASTRA-FIX-2 #1: a remounted form's newer draft survives the older form's forgetRevision", () => {
  const first = renderHook(form);
  act(() => first.result.current.setValue("A"));
  const submitted = first.result.current.revision();
  const finishLater = first.result.current.forgetRevision;
  first.unmount();
  const second = renderHook(form);
  act(() => second.result.current.setValue("A then B"));
  expect(finishLater(submitted)).toBe(false);
  expect(readDraft("test")).toBe("A then B");
  expect(second.result.current.forgetRevision(second.result.current.revision())).toBe(true);
  expect(readDraft("test")).toBeNull();
});
it("restores drafts stored before revisions existed", () => {
  writeDraft("test", "legacy text");
  expect(renderHook(form).result.current.value).toBe("legacy text");
});
