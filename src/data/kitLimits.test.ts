import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STUDY_SET_LIMITS } from "./studySetTransaction";

/** The kit's "ready" check (Rust) must use the same limits as storage (TS). */
describe("study kit card limits", () => {
  const rust = readFileSync(new URL("../../src-tauri/src/study_kit.rs", import.meta.url), "utf8");
  const limit = (name: string) => {
    const match = new RegExp(`const ${name}: usize = ([0-9_]+);`).exec(rust);
    expect(match, name).not.toBeNull();
    return Number(match![1]!.replaceAll("_", ""));
  };

  it("matches STUDY_SET_LIMITS front and back", () => {
    expect(limit("KIT_CARD_FRONT_MAX")).toBe(STUDY_SET_LIMITS.front);
    expect(limit("KIT_CARD_BACK_MAX")).toBe(STUDY_SET_LIMITS.back);
  });
});
