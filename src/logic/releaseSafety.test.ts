import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

// @ts-expect-error -- scripts/check-release-version.mjs is an untyped ESM script
import { validateReleaseVersion } from "../../scripts/check-release-version.mjs";
// @ts-expect-error -- scripts/bump-version.mjs is an untyped ESM script
import { bumpVersions } from "../../scripts/bump-version.mjs";
// @ts-expect-error -- scripts/test-cargo-lock-sync.mjs is an untyped ESM script
import { checkCargoLockSync } from "../../scripts/test-cargo-lock-sync.mjs";
// @ts-expect-error -- scripts/normalize-installer-filenames.mjs is an untyped ESM script
import { generateChecksumManifest, normalizeInstallerFilename, prepareReleaseInstallers } from "../../scripts/normalize-installer-filenames.mjs";

const SCRIPT_PATH = resolve(process.cwd(), "scripts/check-release-version.mjs");
const WORKFLOW_PATH = resolve(process.cwd(), ".github/workflows/release.yml");
const CHECKS_WORKFLOW_PATH = resolve(process.cwd(), ".github/workflows/checks.yml");
const RELEASE_SH_PATH = resolve(process.cwd(), "scripts/release.sh");
const POLICY_PATH = resolve(process.cwd(), "scripts/release-policy.json");

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

/** Evaluates the build matrix logic identical to .github/workflows/release.yml */
function evaluateBuildMatrix(target: string, policy: { platformDistribution?: { windows?: { status?: string; holdReason?: string } } }) {
  if (target !== "macos-only" && target !== "all") {
    throw new Error(`Target '${target}' is not recognized. Allowed targets: macos-only, all.`);
  }

  const winStatus = policy.platformDistribution?.windows?.status;
  const winReason = policy.platformDistribution?.windows?.holdReason || "Windows distribution is held";

  if (target === "all" && winStatus !== "active") {
    throw new Error(`Windows distribution is not active (status: "${winStatus}", reason: "${winReason}"). Selecting target "all" is forbidden.`);
  }

  if (target === "macos-only") {
    return {
      include: [
        {
          os: "macos-15",
          name: "macOS",
          bundles: "dmg",
          pattern: "src-tauri/target/release/bundle/dmg/*.dmg",
        },
      ],
    };
  }

  return {
    include: [
      {
        os: "macos-15",
        name: "macOS",
        bundles: "dmg",
        pattern: "src-tauri/target/release/bundle/dmg/*.dmg",
      },
      {
        os: "windows-latest",
        name: "Windows",
        bundles: "nsis",
        pattern: "src-tauri/target/release/bundle/nsis/*-setup.exe",
      },
    ],
  };
}

/** Evaluates the CREATE_DRAFT resolution logic identical to .github/workflows/release.yml */
function resolveCreateDraft(eventName: string, inputCreateDraft?: unknown): "true" | "false" {
  let createDraft = String(inputCreateDraft ?? "");
  if (eventName === "push") {
    createDraft = "true";
  } else if (createDraft !== "true") {
    createDraft = "false";
  }
  return createDraft as "true" | "false";
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

  it("verifies consistency across all 5 active repository version files without hardcoding a specific version", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")).version;
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    const lockVer = lock.version;
    const lockPkgVer = lock.packages?.[""]?.version;
    const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
    const cargoMatch = readFileSync("src-tauri/Cargo.toml", "utf8").match(/^version\s*=\s*"([^"]+)"/m);
    const cargo = cargoMatch ? cargoMatch[1] : "";
    const cargoLockMatch = readFileSync("src-tauri/Cargo.lock", "utf8").match(
      /\[\[package\]\]\s+name\s*=\s*"her-flight-deck"\s+version\s*=\s*"([^"]+)"/,
    );
    const cargoLock = cargoLockMatch ? cargoLockMatch[1] : "";

    expect(pkg).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lockVer).toBe(pkg);
    expect(lockPkgVer).toBe(pkg);
    expect(tauri).toBe(pkg);
    expect(cargo).toBe(pkg);
    expect(cargoLock).toBe(pkg);
  });

  it("explicitly verifies that 0.5.2 is permanently retired in release-policy.json and rejected by validator", () => {
    const policy = JSON.parse(readFileSync(POLICY_PATH, "utf8"));
    expect(policy.retiredVersions).toBeDefined();
    const entry052 = (policy.retiredVersions as Array<{ version: string; reason: string }>).find(
      (r) => r.version === "0.5.2",
    );
    expect(entry052).toBeDefined();
    expect(entry052?.reason).toContain("Wacatac.B!ml");

    const retired = validateReleaseVersion("0.5.2");
    expect(retired.valid).toBe(false);
    expect(retired.retired).toBe(true);
    expect(retired.error).toContain("0.5.2 is permanently retired");
  });

  it("tests bumpVersions on a disposable temporary copy without touching the real checkout or invoking cargo", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hfd-bump-test-"));
    const initialPkg = JSON.parse(readFileSync("package.json", "utf8")).version;

    try {
      copyFileSync("package.json", join(tempDir, "package.json"));
      copyFileSync("package-lock.json", join(tempDir, "package-lock.json"));
      mkdirSync(join(tempDir, "src-tauri"), { recursive: true });
      copyFileSync("src-tauri/tauri.conf.json", join(tempDir, "src-tauri/tauri.conf.json"));
      copyFileSync("src-tauri/Cargo.toml", join(tempDir, "src-tauri/Cargo.toml"));
      copyFileSync("src-tauri/Cargo.lock", join(tempDir, "src-tauri/Cargo.lock"));

      const bumped = bumpVersions("0.5.99", tempDir, { syncCargoLockDirectly: true });
      expect(bumped.version).toBe("0.5.99");
      expect(bumped.packageJson).toBe("0.5.99");
      expect(bumped.packageLock).toBe("0.5.99");
      expect(bumped.tauriConf).toBe("0.5.99");
      expect(bumped.cargoToml).toBe("0.5.99");
      expect(bumped.cargoLock).toBe("0.5.99");

      // Verify both package-lock.json entries in fixture
      const fixtureLock = JSON.parse(readFileSync(join(tempDir, "package-lock.json"), "utf8"));
      expect(fixtureLock.version).toBe("0.5.99");
      expect(fixtureLock.packages[""].version).toBe("0.5.99");

      // Verify Cargo.lock package entry in fixture
      const fixtureCargoLock = readFileSync(join(tempDir, "src-tauri/Cargo.lock"), "utf8");
      const match = fixtureCargoLock.match(
        /\[\[package\]\]\s+name\s*=\s*"her-flight-deck"\s+version\s*=\s*"([^"]+)"/,
      );
      expect(match?.[1]).toBe("0.5.99");

      // Real checkout must remain completely untouched
      const realPkg = JSON.parse(readFileSync("package.json", "utf8")).version;
      expect(realPkg).toBe(initialPkg);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("ensures a failed Cargo.lock update fails visibly and throws an error", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hfd-fail-test-"));
    try {
      copyFileSync("package.json", join(tempDir, "package.json"));
      copyFileSync("package-lock.json", join(tempDir, "package-lock.json"));
      mkdirSync(join(tempDir, "src-tauri"), { recursive: true });
      copyFileSync("src-tauri/tauri.conf.json", join(tempDir, "src-tauri/tauri.conf.json"));
      copyFileSync("src-tauri/Cargo.toml", join(tempDir, "src-tauri/Cargo.toml"));
      copyFileSync("src-tauri/Cargo.lock", join(tempDir, "src-tauri/Cargo.lock"));

      expect(() =>
        bumpVersions("0.5.99", tempDir, {
          cargoRunner: () => {
            throw new Error("simulated cargo check lockfile update failure");
          },
        }),
      ).toThrow(/simulated cargo check lockfile update failure/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("ensures bumpVersions detects when Cargo.lock was not updated and aborts", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hfd-mismatch-test-"));
    try {
      copyFileSync("package.json", join(tempDir, "package.json"));
      copyFileSync("package-lock.json", join(tempDir, "package-lock.json"));
      mkdirSync(join(tempDir, "src-tauri"), { recursive: true });
      copyFileSync("src-tauri/tauri.conf.json", join(tempDir, "src-tauri/tauri.conf.json"));
      copyFileSync("src-tauri/Cargo.toml", join(tempDir, "src-tauri/Cargo.toml"));
      copyFileSync("src-tauri/Cargo.lock", join(tempDir, "src-tauri/Cargo.lock"));

      // cargoRunner does nothing, so Cargo.lock remains on old version
      expect(() =>
        bumpVersions("0.5.99", tempDir, {
          cargoRunner: () => {},
        }),
      ).toThrow(/Version synchronization verification failed/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("ensures bumpVersions rejects retired versions and malformed versions before touching disk", () => {
    expect(() => bumpVersions("0.5.2")).toThrow("0.5.2 is permanently retired and must never be reused");
    expect(() => bumpVersions("invalid")).toThrow("not a valid release version");
  });

  it("ensures .github/workflows/release.yml calls check-release-version.mjs", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    expect(workflow).toContain("node scripts/check-release-version.mjs");
  });

  it("ensures scripts/release.sh calls check-release-version.mjs and bump-version.mjs", () => {
    const script = readFileSync(RELEASE_SH_PATH, "utf8");
    expect(script).toContain("node scripts/check-release-version.mjs");
    expect(script).toContain("node scripts/bump-version.mjs");
    expect(script).toContain("Cargo.lock");
  });

  it("ensures release policy documents Mac-only active candidate and Windows distribution hold", () => {
    const policy = JSON.parse(readFileSync(POLICY_PATH, "utf8"));
    expect(policy.platformDistribution).toBeDefined();
    expect(policy.platformDistribution.macos.status).toBe("active");
    expect(policy.platformDistribution.macos.bundle).toBe("dmg");
    expect(policy.platformDistribution.windows.status).toBe("held");
    expect(policy.platformDistribution.windows.currentPublishedVersion).toBe("0.5.1");
    expect(policy.platformDistribution.windows.holdReason).toContain("Microsoft Defender");
  });

  it("evaluates workflow matrix resolution: macos-only produces only macOS Apple Silicon runner", () => {
    const policy = JSON.parse(readFileSync(POLICY_PATH, "utf8"));
    const matrix = evaluateBuildMatrix("macos-only", policy);
    expect(matrix.include).toHaveLength(1);
    const entry = matrix.include[0];
    expect(entry).toBeDefined();
    expect(entry?.name).toBe("macOS");
    expect(entry?.os).toBe("macos-15");
    expect(entry?.bundles).toBe("dmg");
  });

  it("evaluates workflow matrix resolution: forbids 'all' target unless Windows is explicitly active", () => {
    const heldPolicy = JSON.parse(readFileSync(POLICY_PATH, "utf8"));
    expect(() => evaluateBuildMatrix("all", heldPolicy)).toThrow(/Windows distribution is not active/);

    const missingStatusPolicy = { platformDistribution: { windows: {} } };
    expect(() => evaluateBuildMatrix("all", missingStatusPolicy)).toThrow(/Windows distribution is not active/);

    const pendingStatusPolicy = { platformDistribution: { windows: { status: "pending" } } };
    expect(() => evaluateBuildMatrix("all", pendingStatusPolicy)).toThrow(/Windows distribution is not active/);

    const activePolicy = { platformDistribution: { windows: { status: "active" } } };
    const matrix = evaluateBuildMatrix("all", activePolicy);
    expect(matrix.include).toHaveLength(2);
    expect(matrix.include.map((m) => m.name)).toEqual(["macOS", "Windows"]);
  });

  it("evaluates workflow matrix resolution: rejects unknown targets", () => {
    const policy = JSON.parse(readFileSync(POLICY_PATH, "utf8"));
    expect(() => evaluateBuildMatrix("linux", policy)).toThrow(/Target 'linux' is not recognized/);
    expect(() => evaluateBuildMatrix("", policy)).toThrow(/Target '' is not recognized/);
  });

  it("validates GitHub Actions workflow syntax and AST structure using declared YAML parser", () => {
    // Parse YAML without suppressing errors (throws immediately on invalid syntax)
    const releaseContent = readFileSync(WORKFLOW_PATH, "utf8");
    const doc = YAML.parse(releaseContent);

    expect(doc).toBeDefined();
    expect(doc.name).toBe("Release");
    expect(doc.on.workflow_dispatch.inputs.target.default).toBe("macos-only");
    expect(doc.on.workflow_dispatch.inputs.create_draft.default).toBe(false);

    expect(doc.jobs.check.outputs.matrix).toBe("${{ steps.resolve.outputs.matrix }}");
    expect(doc.jobs.check.outputs.create_draft).toBe("${{ steps.resolve.outputs.create_draft }}");

    expect(doc.jobs.build.strategy.matrix).toBe("${{ fromJSON(needs.check.outputs.matrix) }}");
    expect(doc.jobs.build.if).toBeUndefined();

    expect(doc.jobs.publish.if).toBe("needs.check.outputs.create_draft == 'true'");
    expect(doc.jobs.publish.needs).toEqual(["check", "build"]);

    // Also validate checks.yml
    const checksContent = readFileSync(CHECKS_WORKFLOW_PATH, "utf8");
    const checksDoc = YAML.parse(checksContent);
    expect(checksDoc).toBeDefined();
    expect(checksDoc.name).toBe("Checks");
    expect(checksDoc.jobs.checks).toBeDefined();
  });

  it("ensures .github/workflows/release.yml enforces 5-file version check including Cargo.lock", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    expect(workflow).toContain("CARGO_LOCK=");
    expect(workflow).toContain("Cargo.lock");
    expect(workflow).toContain("node scripts/bump-version.mjs $VERSION, or release $PKG.");
  });

  it("ensures .github/workflows/release.yml supports create_draft gate defaulting to false", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    expect(workflow).toContain("create_draft:");
    expect(workflow).toContain("default: false");
    expect(workflow).toContain("if: needs.check.outputs.create_draft == 'true'");

    // Workflow input specification
    const doc = YAML.parse(workflow);
    const input = doc.on.workflow_dispatch.inputs.create_draft;
    expect(input.type).toBe("boolean");
    expect(input.default).toBe(false);
    expect(input.description).toContain("default: false produces private CI artifacts only");
    expect(input.description).toContain("set true to create tag and draft");
  });

  it("evaluates create_draft resolution logic and ensures publish job gate defaults to private CI artifact", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    const doc = YAML.parse(workflow);

    // create_draft resolution logic
    expect(resolveCreateDraft("push")).toBe("true");
    expect(resolveCreateDraft("push", false)).toBe("true");
    expect(resolveCreateDraft("workflow_dispatch", true)).toBe("true");
    expect(resolveCreateDraft("workflow_dispatch", "true")).toBe("true");
    expect(resolveCreateDraft("workflow_dispatch", false)).toBe("false");
    expect(resolveCreateDraft("workflow_dispatch", "false")).toBe("false");
    expect(resolveCreateDraft("workflow_dispatch", undefined)).toBe("false");
    expect(resolveCreateDraft("workflow_dispatch", "invalid")).toBe("false");

    // Publish gate: publish job runs ONLY when create_draft is 'true'
    expect(doc.jobs.publish.if).toBe("needs.check.outputs.create_draft == 'true'");

    // Verify tag creation and draft creation exist ONLY in the publish job
    const buildSteps = doc.jobs.build.steps || [];
    const buildScript = JSON.stringify(buildSteps);
    expect(buildScript).not.toContain("git tag");
    expect(buildScript).not.toContain("gh release create");

    const publishSteps = doc.jobs.publish.steps || [];
    const publishScript = JSON.stringify(publishSteps);
    expect(publishScript).toContain('gh release create \\"$TAG\\"');
    expect(publishScript).toContain('--target \\"$GITHUB_SHA\\"');
  });

  it("ensures .github/workflows/release.yml uses dynamic matrix from check job and fail-closed publish step", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    // Matrix output in check job
    expect(workflow).toContain("matrix: ${{ steps.resolve.outputs.matrix }}");
    // Matrix consumed in build job without job-level matrix.name check
    expect(workflow).toContain("matrix: ${{ fromJSON(needs.check.outputs.matrix) }}");
    expect(workflow).not.toContain("if: matrix.name ==");

    // Fail-closed publish checks
    expect(workflow).toContain("Verify artifacts and fail closed");
    expect(workflow).toContain("Expected macOS DMG installer was not produced");
    expect(workflow).toContain("winStatus !== \"active\" && hasExe");
    expect(workflow).toContain("Unexpected Windows installer appeared in release artifacts while Windows distribution is not active");

    // Dynamic release notes
    expect(workflow).toContain("Windows distribution is held on v0.5.1 pending separate Microsoft Defender");
    expect(workflow).toContain('TITLE="Her Flight Deck $VERSION (macOS)"');
  });

  it("ensures Cargo lockfile check fails on stale committed state in disposable fixture without rewriting lockfile", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hfd-stale-lock-"));
    try {
      mkdirSync(join(tempDir, "src-tauri"), { recursive: true });
      copyFileSync("src-tauri/Cargo.toml", join(tempDir, "src-tauri/Cargo.toml"));

      // Create stale Cargo.lock with version 0.5.1
      const realLock = readFileSync("src-tauri/Cargo.lock", "utf8");
      const staleLock = realLock.replace(
        /(\[\[package\]\]\s+name\s*=\s*"her-flight-deck"\s+version\s*=\s*)"[^"]+"/,
        '$1"0.5.1"',
      );
      const staleLockPath = join(tempDir, "src-tauri/Cargo.lock");
      writeFileSync(staleLockPath, staleLock, "utf8");

      const initialContent = readFileSync(staleLockPath, "utf8");
      expect(initialContent).toMatch(/name\s*=\s*"her-flight-deck"\s+version\s*=\s*"0\.5\.1"/);

      // Check must fail on stale lockfile
      expect(() => checkCargoLockSync(tempDir)).toThrow(/Cargo lockfile is stale\/out of sync/);

      // Verify the fixture lockfile was NOT modified or rewritten by the check
      const postContent = readFileSync(staleLockPath, "utf8");
      expect(postContent).toBe(initialContent);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("forbids direct interpolation of inputs inside run: shell blocks across workflow definitions", () => {
    const workflowFiles = [WORKFLOW_PATH, CHECKS_WORKFLOW_PATH];

    for (const filePath of workflowFiles) {
      const content = readFileSync(filePath, "utf8");
      const doc = YAML.parse(content);
      const jobs = doc.jobs || {};

      for (const [jobId, job] of Object.entries(jobs)) {
        const steps = (job as { steps?: Array<{ name?: string; run?: string; env?: Record<string, unknown> }> }).steps || [];
        for (const step of steps) {
          if (step.run) {
            // Unsafe patterns: ${{ inputs... }} or ${{ github.event... }} directly interpolated in run: shell
            const unsafeMatches = step.run.match(/\$\{\{\s*(inputs\.|github\.event\.)[^}]+\}\}/g);
            if (unsafeMatches) {
              throw new Error(
                `Security violation in ${filePath} (job '${jobId}', step '${step.name || "unnamed"}'): ` +
                `Direct interpolation of inputs inside run: shell code is forbidden: ${unsafeMatches.join(", ")}. ` +
                `Pass values safely via step 'env:' instead.`,
              );
            }
          }
        }
      }
    }
  });

  it("ensures Cargo commands in checks.yml and release.yml use --locked to prevent silent lockfile mutation", () => {
    const checks = readFileSync(CHECKS_WORKFLOW_PATH, "utf8");
    expect(checks).toContain("cargo clippy --locked");
    expect(checks).toContain("cargo test --locked");

    const release = readFileSync(WORKFLOW_PATH, "utf8");
    expect(release).toContain("cargo test --locked");
  });

  it("reproduces asset filename vs manifest mismatch when filenames have spaces, and verifies normalization fix", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hfd-manifest-norm-"));
    try {
      // 1. Reproduce the bug: build produces DMG with spaces in name (e.g. 'Her Flight Deck_0.5.3_aarch64.dmg')
      const buildName = "Her Flight Deck_0.5.3_aarch64.dmg";
      const sampleBytes = Buffer.from("%PDF-1.4 sample dmg bytes for checksum testing");
      writeFileSync(join(tempDir, buildName), sampleBytes);

      // In the buggy behavior, sha256sum ran directly on the unnormalized file with spaces:
      const rawManifestLine = generateChecksumManifest(tempDir).trim();
      expect(rawManifestLine).toContain("Her Flight Deck_0.5.3_aarch64.dmg");

      // But when uploaded to GitHub Releases, GitHub normalizes asset names by replacing spaces with periods:
      const downloadedName = normalizeInstallerFilename(buildName);
      expect(downloadedName).toBe("Her.Flight.Deck_0.5.3_aarch64.dmg");

      // A user downloading the GitHub asset receives 'Her.Flight.Deck_0.5.3_aarch64.dmg'.
      // If they verify against the old raw manifest, it fails because the filenames don't match:
      expect(rawManifestLine.endsWith(downloadedName)).toBe(false);

      // 2. Now verify the fix: prepareReleaseInstallers normalizes filenames before hashing
      const { renames, manifest } = prepareReleaseInstallers(tempDir);
      expect(renames).toEqual([
        { from: "Her Flight Deck_0.5.3_aarch64.dmg", to: "Her.Flight.Deck_0.5.3_aarch64.dmg" },
      ]);

      // The file on disk was renamed to the exact downloadable name:
      expect(readdirSync(tempDir)).toContain("Her.Flight.Deck_0.5.3_aarch64.dmg");
      expect(readdirSync(tempDir)).not.toContain("Her Flight Deck_0.5.3_aarch64.dmg");

      // The manifest references the exact downloadable name:
      expect(manifest.trim()).toBe(
        `${createHash("sha256").update(sampleBytes).digest("hex")}  Her.Flight.Deck_0.5.3_aarch64.dmg`,
      );

      // The manifest written to disk matches the generated manifest:
      const diskManifest = readFileSync(join(tempDir, "SHA256SUMS.txt"), "utf8");
      expect(diskManifest).toBe(manifest);

      // Verifying against the downloaded file succeeds:
      const [expectedHash, manifestFile] = diskManifest.trim().split(/\s+/);
      const downloadedBytes = readFileSync(join(tempDir, manifestFile!));
      const actualHash = createHash("sha256").update(downloadedBytes).digest("hex");
      expect(actualHash).toBe(expectedHash);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("normalizes Windows installer filenames when spaces are present and preserves normalized names", () => {
    expect(normalizeInstallerFilename("Her Flight Deck_0.5.3_x64-setup.exe")).toBe(
      "Her.Flight.Deck_0.5.3_x64-setup.exe",
    );
    expect(normalizeInstallerFilename("Her.Flight.Deck_0.5.3_aarch64.dmg")).toBe(
      "Her.Flight.Deck_0.5.3_aarch64.dmg",
    );
    expect(normalizeInstallerFilename("her-flight-deck_0.5.3_aarch64.dmg")).toBe(
      "her-flight-deck_0.5.3_aarch64.dmg",
    );
  });

  it("rejects colliding installer names before changing either file", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hfd-installer-collision-"));
    try {
      writeFileSync(join(tempDir, "Her Flight Deck_0.5.3_aarch64.dmg"), "first");
      writeFileSync(join(tempDir, "Her.Flight.Deck_0.5.3_aarch64.dmg"), "second");
      expect(() => prepareReleaseInstallers(tempDir)).toThrow(/collision/);
      expect(readFileSync(join(tempDir, "Her Flight Deck_0.5.3_aarch64.dmg"), "utf8")).toBe("first");
      expect(readFileSync(join(tempDir, "Her.Flight.Deck_0.5.3_aarch64.dmg"), "utf8")).toBe("second");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails closed when no installer or an unexpected artifact is present", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hfd-installer-empty-"));
    try {
      expect(() => prepareReleaseInstallers(tempDir)).toThrow(/No installers/);
      writeFileSync(join(tempDir, "unexpected.txt"), "not an installer");
      expect(() => prepareReleaseInstallers(tempDir)).toThrow(/Unexpected release artifact/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("ensures .github/workflows/release.yml normalizes filenames before checksum generation and embeds manifest", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    expect(workflow).toContain("node scripts/normalize-installer-filenames.mjs installers");
    expect(workflow).toContain("cat installers/SHA256SUMS.txt");
  });
});
