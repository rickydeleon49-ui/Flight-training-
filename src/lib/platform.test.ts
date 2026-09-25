import { describe, expect, it } from "vitest";

import { isMacOS, isWindowsOS } from "./platform";

describe("platform detection", () => {
  it("identifies macOS platforms while rejecting iOS, Windows, Linux, and unknown strings", () => {
    // Required test cases:
    expect(isMacOS("MacIntel")).toBe(true);
    expect(isMacOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(true);
    expect(isMacOS("Win32")).toBe(false);
    expect(isMacOS("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
    expect(isMacOS("iPhone")).toBe(false);
    expect(isMacOS("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(false);
    expect(isMacOS("iPad")).toBe(false);
    expect(isMacOS("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe(false);
    expect(isMacOS("Linux")).toBe(false);
    expect(isMacOS("Linux x86_64")).toBe(false);
    expect(isMacOS("")).toBe(false);
    expect(isMacOS("unknown platform string")).toBe(false);
  });

  it("identifies Windows platforms while rejecting macOS, iOS, Linux, and unknown strings", () => {
    // Required test cases:
    expect(isWindowsOS("Win32")).toBe(true);
    expect(isWindowsOS("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(true);
    expect(isWindowsOS("MacIntel")).toBe(false);
    expect(isWindowsOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(false);
    expect(isWindowsOS("iPhone")).toBe(false);
    expect(isWindowsOS("iPad")).toBe(false);
    expect(isWindowsOS("Linux")).toBe(false);
    expect(isWindowsOS("Linux x86_64")).toBe(false);
    expect(isWindowsOS("")).toBe(false);
    expect(isWindowsOS("unknown platform string")).toBe(false);
  });
});
