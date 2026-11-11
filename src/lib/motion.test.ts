// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollBehavior } from "./motion";
import { focusRenderedAction } from "../components/dailyPlan/startAction";

const mockMedia = (reduce: boolean) =>
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (q: string) => ({ matches: reduce && q.includes("reduce") }) });

afterEach(() => vi.unstubAllGlobals());

describe("scrollBehavior", () => {
  it("is auto when reduced motion matches", () => {
    mockMedia(true);
    expect(scrollBehavior()).toBe("auto");
  });
  it("is smooth otherwise", () => {
    mockMedia(false);
    expect(scrollBehavior()).toBe("smooth");
  });
  it("startAction scrolls with auto under reduced motion", () => {
    mockMedia(true);
    const scrollIntoView = vi.fn();
    const button = { focus: vi.fn() };
    const container = { scrollIntoView, querySelector: () => button };
    const doc = { getElementById: () => container, activeElement: button } as unknown as Document;
    expect(focusRenderedAction("x", doc)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "center" });
  });
});
