// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import { expect, it } from "vitest";
import { useStickyCardHeight } from "./useStickyCardHeight";

it("keeps the tallest side as the minimum height and resets for a new card", () => {
  const el = document.createElement("button");
  let height = 100;
  Object.defineProperty(el, "offsetHeight", { get: () => Math.max(height, parseFloat(el.style.minHeight || "0")) });
  const ref = createRef<HTMLElement>() as { current: HTMLElement | null };
  ref.current = el;
  const { rerender } = renderHook(({ k, r }) => useStickyCardHeight(ref, k, r), { initialProps: { k: 0, r: false } });
  expect(el.style.minHeight).toBe("100px");
  height = 180; rerender({ k: 0, r: true });
  expect(el.style.minHeight).toBe("180px");
  height = 100; rerender({ k: 0, r: false });
  expect(el.style.minHeight).toBe("180px");
  rerender({ k: 1, r: false });
  expect(el.style.minHeight).toBe("100px");
});
