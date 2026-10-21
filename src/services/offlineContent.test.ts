import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * OFFLINE-ON-2b authorizes only the release workflows/script and the Vite
 * bridge. Other build/dev paths must not opt themselves in.
 */
describe("offline extraction has an explicit release opt-in", () => {
  const root = join(__dirname, "..", "..");
  const files = [
    ...readdirSync(join(root, ".github", "workflows")).filter(f => !["release.yml", "build-desktop.yml"].includes(f)).map((f) => join(".github", "workflows", f)),
    "package.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/build.rs",
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

vi.mock("@/data", () => ({ isTauri: () => desktop }));
let desktop = false;
afterEach(() => { desktop = false; vi.unstubAllEnvs(); });

it("release_build_enables_search_ui", async () => {
  vi.stubEnv("HFD_OFFLINE_EXTRACTION", "1");
  const { default: config } = await import("../../vite.config");
  expect(typeof config).toBe("function");
  const buildConfig = (config as import("vite").UserConfigFnObject)({ command: "build", mode: "production", isSsrBuild: false, isPreview: false });
  const flag = JSON.parse(buildConfig.define?.["import.meta.env.VITE_OFFLINE_EXTRACTION"]);
  expect(flag).toBe("1");
  vi.stubEnv("VITE_OFFLINE_EXTRACTION", flag);
  desktop = true;
  const { offlineStudyEnabled } = await import("./offlineContent");
  expect(offlineStudyEnabled()).toBe(true);
  desktop = false;
  expect(offlineStudyEnabled()).toBe(false);
});

it("unopted_release_and_debug_builds_preserve_their_gates", async () => {
  const { default: config } = await import("../../vite.config");
  const resolve = config as import("vite").UserConfigFnObject;
  const env = { mode: "production", isSsrBuild: false, isPreview: false };
  for (const flag of [undefined, "0", "true"]) {
    vi.stubEnv("HFD_OFFLINE_EXTRACTION", flag);
    vi.stubEnv("VITE_OFFLINE_EXTRACTION", undefined);
    const build = resolve({ ...env, command: "build" });
    expect(JSON.parse(build.define?.["import.meta.env.VITE_OFFLINE_EXTRACTION"])).toBe("");
  }
  vi.stubEnv("HFD_OFFLINE_EXTRACTION", "1");
  expect(resolve({ ...env, command: "serve" }).define).toEqual({});
  vi.stubEnv("HFD_OFFLINE_EXTRACTION", undefined);
  vi.stubEnv("VITE_OFFLINE_EXTRACTION", "1");
  expect(JSON.parse(resolve({ ...env, command: "build" }).define?.["import.meta.env.VITE_OFFLINE_EXTRACTION"])).toBe("1");
});
