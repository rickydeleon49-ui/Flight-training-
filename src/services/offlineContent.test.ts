import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Offline extraction stays off in releases until a reviewer accepts the
 * worker's memory cap (docs/OFFLINE_01C_REPORT_2026-10-19.md §6). Turning it
 * on means setting a build flag; nothing checked in may set either one.
 */
describe("offline extraction stays dormant", () => {
  const root = join(__dirname, "..", "..");
  const files = [
    ...readdirSync(join(root, ".github", "workflows")).map((f) => join(".github", "workflows", f)),
    "package.json",
    "vite.config.ts",
    "src-tauri/tauri.conf.json",
    "src-tauri/build.rs",
    "scripts/release.sh",
  ];

  it.each(files)("%s doesn't switch it on", (file) => {
    let text = "";
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      return;
    }
    expect(text).not.toMatch(/VITE_OFFLINE_EXTRACTION|HFD_OFFLINE_EXTRACTION/);
  });

  it("is off in tests and browser mode", async () => {
    const { offlineStudyEnabled, offlineContentReadiness } = await import("./offlineContent");
    expect(offlineStudyEnabled()).toBe(false);
    await expect(offlineContentReadiness(["m1"])).resolves.toEqual([]);
  });
});
