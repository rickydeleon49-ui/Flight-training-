import { describe, expect, it } from "vitest";
import cases from "./videoUrlParity.json";
import { validateVideoUrl } from "@/data/repositories/materialVideoLinkRepository";

// The same list runs in Rust (study_pack::validate::tests) so the app and the
// study pack agree on which video links are valid.
describe("video link parity cases", () => {
  it.each(cases.map((c) => [c.input, c.expected] as const))("%j", (input, expected) => {
    if (expected === null) expect(() => validateVideoUrl(input)).toThrow();
    else expect(validateVideoUrl(input)).toBe(expected);
  });
});
