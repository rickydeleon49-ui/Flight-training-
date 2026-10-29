// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { isOneOfNumbers, useRememberedState } from "./useRememberedState";

const counts = [20, 40, 60] as const;

describe("useRememberedState device scope", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("keeps a device preference on this computer and starts from the default", () => {
    const first = renderHook(() => useRememberedState<20 | 40 | 60>("test.cards", 40, isOneOfNumbers(counts), "device"));
    expect(first.result.current[0]).toBe(40);
    act(() => first.result.current[1](20));
    first.unmount();
    expect(sessionStorage.length).toBe(0);
    const again = renderHook(() => useRememberedState<20 | 40 | 60>("test.cards", 40, isOneOfNumbers(counts), "device"));
    expect(again.result.current[0]).toBe(20);
  });

  it("ignores a stored value that is not one of the choices", () => {
    localStorage.setItem("her-flight-deck.view.test.cards", "35");
    const { result } = renderHook(() => useRememberedState<20 | 40 | 60>("test.cards", 40, isOneOfNumbers(counts), "device"));
    expect(result.current[0]).toBe(40);
  });
});
