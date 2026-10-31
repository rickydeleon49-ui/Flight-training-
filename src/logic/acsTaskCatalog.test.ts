import { describe, expect, it } from "vitest";
import rust from "../../src-tauri/src/acs_tasks.rs?raw";
import { ACS_TASK_CATALOG, normalizeAcsTask } from "./acsTaskCatalog";

describe("ACS task catalog", () => {
  it("mirrors all 61 native codes and short titles from the existing catalog", () => {
    const native = [...rust.matchAll(/\("(PA\.[IVX]+\.[A-Z])",\s*"([^"]+)"\)/g)].map(([, code, title]) => ({ code, title }));
    expect(ACS_TASK_CATALOG).toHaveLength(61);
    expect(new Set(ACS_TASK_CATALOG.map(t => t.code)).size).toBe(61);
    expect(native).toEqual(ACS_TASK_CATALOG);
  });
  it("normalizes case and surrounding whitespace without guessing", () => {
    expect(normalizeAcsTask("  pa.ii.a \n")).toBe("PA.II.A");
    for (const bad of [undefined, null, 1, "PA.II.Z", "PA.II.A.K1", "garbage", "PA. II.A"]) expect(normalizeAcsTask(bad)).toBeUndefined();
  });
});
