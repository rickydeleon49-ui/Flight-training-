// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScrollDirection } from "./useScrollDirection";

let y = 0;
function scrollTo(next: number) {
  y = next;
  act(() => {
    window.dispatchEvent(new Event("scroll"));
    vi.runAllTimers();
  });
}

beforeEach(() => {
  y = 0;
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 3000 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("useScrollDirection", () => {
  it("goes compact scrolling down and expands scrolling up", () => {
    const { result } = renderHook(() => useScrollDirection("/"));
    expect(result.current).toBe(false);
    scrollTo(60);
    expect(result.current).toBe(false);
    scrollTo(200);
    expect(result.current).toBe(true);
    scrollTo(180);
    expect(result.current).toBe(false);
  });

  it("ignores events at the top and at the bottom edge", () => {
    const { result } = renderHook(() => useScrollDirection("/"));
    scrollTo(300);
    expect(result.current).toBe(true);
    scrollTo(-20);
    scrollTo(0);
    expect(result.current).toBe(true);
    scrollTo(3000 - 800 - 1);
    scrollTo(3000 - 800 + 20);
    expect(result.current).toBe(true);
  });

  it("needs 8px of movement before changing", () => {
    const { result } = renderHook(() => useScrollDirection("/"));
    scrollTo(300);
    expect(result.current).toBe(true);
    scrollTo(295);
    expect(result.current).toBe(true);
    scrollTo(291);
    expect(result.current).toBe(false);
  });

  it("resets to expanded on a route change", () => {
    const { result, rerender } = renderHook(({ key }) => useScrollDirection(key), { initialProps: { key: "/a" } });
    scrollTo(300);
    expect(result.current).toBe(true);
    rerender({ key: "/b" });
    expect(result.current).toBe(false);
  });

  it("listens passively and removes the listener on unmount", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useScrollDirection("/"));
    const call = add.mock.calls.find((c) => c[0] === "scroll");
    expect(call?.[2]).toEqual({ passive: true });
    unmount();
    expect(remove.mock.calls.some((c) => c[0] === "scroll" && c[1] === call?.[1])).toBe(true);
  });
});
