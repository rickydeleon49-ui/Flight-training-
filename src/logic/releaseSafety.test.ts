import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error -- scripts/check-release-version.mjs is an untyped ESM script
import { validateReleaseVersion } from "../../scripts/check-release-version.mjs";

const SCRIPT_PATH = resolve(process.cwd(), "scripts/check-release-version.mjs");
const WORKFLOW_PATH = resolve(process.cwd(), ".github/workflows/release.yml");
const RELEASE_SH_PATH = resolve(process.cwd(), "scripts/release.sh");

function runValidator(arg: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT_PATH, arg], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error: unknown) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

describe("release version policy and validation", () => {
  it("permanently rejects withdrawn version 0.5.2 via CLI", () => {
    const result = runValidator("0.5.2");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("0.5.2 is permanently retired and must never be reused");
  });

  it("permanently rejects withdrawn version v0.5.2 with leading v", () => {
    const result = runValidator("v0.5.2");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("0.5.2 is permanently retired and must never be reused");
  });

  it("rejects malformed versions via CLI", () => {
    const malformed = ["abc", "0.5", "0.5.2.1", "1.0", "v1", ""];
    for (const candidate of malformed) {
      const result = runValidator(candidate);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/not a valid release version|No release version specified/);
    }
  });

  it("accepts valid non-retired versions like 0.5.3 via CLI", () => {
    const result = runValidator("0.5.3");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Version 0.5.3 is valid and eligible for release");
  });

  it("evaluates candidate versions correctly through module API", () => {
    const retired = validateReleaseVersion("0.5.2");
    expect(retired.valid).toBe(false);
    expect(retired.retired).toBe(true);
    expect(retired.error).toContain("0.5.2 is permanently retired and must never be reused");

    const valid = validateReleaseVersion("0.5.3");
    expect(valid.valid).toBe(true);
    expect(valid.version).toBe("0.5.3");

    const malformed = validateReleaseVersion("invalid");
    expect(malformed.valid).toBe(false);
    expect(malformed.error).toContain("not a valid release version");
  });

  it("ensures .github/workflows/release.yml calls check-release-version.mjs", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    expect(workflow).toContain("node scripts/check-release-version.mjs");
  });

  it("ensures scripts/release.sh calls check-release-version.mjs", () => {
    const script = readFileSync(RELEASE_SH_PATH, "utf8");
    expect(script).toContain("node scripts/check-release-version.mjs");
  });
});
