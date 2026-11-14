import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// BL-07: Finances and Schedule empty cards must match Notes (compact, 26px icon).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("empty state sizing", () => {
  it.each([
    ["Finances", "./Finances.tsx"],
    ["Schedule", "../Schedule/Schedule.tsx"],
    ["Notes", "../Notes/Notes.tsx"],
  ])("%s uses the compact EmptyState with a 26px icon", (_n, p) => {
    const src = read(p);
    const m = src.match(/<EmptyState\s[^>]*?icon=\{<\w+ size=\{(\d+)\}/s);
    expect(src).toMatch(/<EmptyState\s+compact/);
    expect(m?.[1]).toBe("26");
  });
});
