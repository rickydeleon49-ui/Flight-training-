import { describe, expect, it } from "vitest";
import { skippedPagesMessage } from "./splitSave";

describe("pages left out message", () => {
  it("has no warning when every page fits", () => {
    expect(skippedPagesMessage([])).toBeNull();
  });
  it("lists five pages in full", () => {
    expect(skippedPagesMessage([2, 4, 6, 8, 10])).toBe("Pages 2, 4, 6, 8 and 10 were left out because they're too large by themselves (likely big pictures). They're still in your original PDF.");
  });
});
