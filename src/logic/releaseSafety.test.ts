import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
// @ts-expect-error -- scripts/inspect-backup-credentials.mjs is an untyped ESM script
import { inspectBackupArchive, readZipEntries } from "../../scripts/inspect-backup-credentials.mjs";
// @ts-expect-error -- scripts/generate-pdf-fixtures.mjs is an untyped ESM script
import { buildPdf, generateFixtures, FIXTURE_SPECS } from "../../scripts/generate-pdf-fixtures.mjs";

const SCRIPT_PATH = resolve(process.cwd(), "scripts/check-release-version.mjs");
const WORKFLOW_PATH = resolve(process.cwd(), ".github/workflows/release.yml");
const CHECKS_WORKFLOW_PATH = resolve(process.cwd(), ".github/workflows/checks.yml");
const RELEASE_SH_PATH = resolve(process.cwd(), "scripts/release.sh");
const POLICY_PATH = resolve(process.cwd(), "scripts/release-policy.json");
const NORMALIZE_SCRIPT_PATH = resolve(process.cwd(), "scripts/normalize-installer-filenames.mjs");
const INSPECT_SCRIPT_PATH = resolve(process.cwd(), "scripts/inspect-backup-credentials.mjs");
const MAC_CHECKLIST_PATH = resolve(process.cwd(), "docs/MAC_PARITY_CHECKLIST.md");
const GENERATE_FIXTURES_SCRIPT_PATH = resolve(process.cwd(), "scripts/generate-pdf-fixtures.mjs");

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
    expect(input.description).toContain("set true to create draft");
    expect(input.description).toContain("Git tag is created only upon publication");
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

  it("executes CLI invocation of normalize-installer-filenames.mjs to normalize files and generate manifest", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hfd-installer-cli-"));
    try {
      const sampleFile = "Her Flight Deck_0.5.3_aarch64.dmg";
      const sampleBytes = Buffer.from("%PDF-1.4 sample dmg bytes for CLI invocation testing");
      writeFileSync(join(tempDir, sampleFile), sampleBytes);

      const stdout = execFileSync(process.execPath, [NORMALIZE_SCRIPT_PATH, tempDir], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      expect(stdout).toContain(
        "Normalized installer filename: 'Her Flight Deck_0.5.3_aarch64.dmg' -> 'Her.Flight.Deck_0.5.3_aarch64.dmg'",
      );
      expect(stdout).toContain("Generated");
      expect(stdout).toContain("SHA256SUMS.txt");

      // Verify file was renamed on disk to downloadable name
      expect(readdirSync(tempDir)).toContain("Her.Flight.Deck_0.5.3_aarch64.dmg");
      expect(readdirSync(tempDir)).not.toContain("Her Flight Deck_0.5.3_aarch64.dmg");
      expect(readdirSync(tempDir)).toContain("SHA256SUMS.txt");

      // Verify manifest content on disk
      const manifest = readFileSync(join(tempDir, "SHA256SUMS.txt"), "utf8");
      const expectedHash = createHash("sha256").update(sampleBytes).digest("hex");
      expect(manifest.trim()).toBe(`${expectedHash}  Her.Flight.Deck_0.5.3_aarch64.dmg`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("exits with failure when CLI invocation encounters a collision or no installers", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hfd-installer-cli-fail-"));
    try {
      // Empty directory fails closed
      expect(() => {
        execFileSync(process.execPath, [NORMALIZE_SCRIPT_PATH, tempDir], {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
      }).toThrow();

      // Colliding directory fails closed
      writeFileSync(join(tempDir, "Her Flight Deck_0.5.3_aarch64.dmg"), "a");
      writeFileSync(join(tempDir, "Her.Flight.Deck_0.5.3_aarch64.dmg"), "b");
      expect(() => {
        execFileSync(process.execPath, [NORMALIZE_SCRIPT_PATH, tempDir], {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
      }).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function computeCrc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i]!;
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function createTestZip(entries: Record<string, string | Buffer>): Buffer {
    const localChunks: Buffer[] = [];
    const centralChunks: Buffer[] = [];
    let offset = 0;

    for (const [name, content] of Object.entries(entries)) {
      const nameBuf = Buffer.from(name, "utf8");
      const dataBuf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
      const crc = computeCrc32(dataBuf);
      const size = dataBuf.length;

      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0, 6);
      localHeader.writeUInt16LE(0, 8);
      localHeader.writeUInt16LE(0, 10);
      localHeader.writeUInt16LE(0, 12);
      localHeader.writeUInt32LE(crc, 14);
      localHeader.writeUInt32LE(size, 18);
      localHeader.writeUInt32LE(size, 22);
      localHeader.writeUInt16LE(nameBuf.length, 26);
      localHeader.writeUInt16LE(0, 28);
      localChunks.push(localHeader, nameBuf, dataBuf);

      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4);
      centralHeader.writeUInt16LE(20, 6);
      centralHeader.writeUInt16LE(0, 8);
      centralHeader.writeUInt16LE(0, 10);
      centralHeader.writeUInt16LE(0, 12);
      centralHeader.writeUInt32LE(crc, 16);
      centralHeader.writeUInt32LE(size, 20);
      centralHeader.writeUInt32LE(size, 24);
      centralHeader.writeUInt16LE(nameBuf.length, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(0, 36);
      centralHeader.writeUInt32LE(0, 38);
      centralHeader.writeUInt32LE(offset, 42);
      centralChunks.push(centralHeader, nameBuf);

      offset += 30 + nameBuf.length + size;
    }

    const centralOffset = offset;
    let centralSize = 0;
    for (const c of centralChunks) centralSize += c.length;

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(Object.keys(entries).length, 8);
    eocd.writeUInt16LE(Object.keys(entries).length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralOffset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localChunks, ...centralChunks, eocd]);
  }

  describe("backup archive credential-entry inspection fail-closed safety", () => {
    function runInspectorCli(target: string): { status: number; stdout: string; stderr: string } {
      try {
        const stdout = execFileSync(process.execPath, [INSPECT_SCRIPT_PATH, target], {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return { status: 0, stdout: stdout.trim(), stderr: "" };
      } catch (err: unknown) {
        const error = err as { status?: number; stdout?: string; stderr?: string };
        return {
          status: error.status ?? 1,
          stdout: (error.stdout ?? "").toString().trim(),
          stderr: (error.stderr ?? "").toString().trim(),
        };
      }
    }

    it("passes for a valid secret-free archive via module and CLI without sensitive output", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "hfd-cred-pass-"));
      try {
        const zipBuf = createTestZip({
          "manifest.json": JSON.stringify({ version: 3 }),
          "integrity.json": JSON.stringify({ files: {} }),
          "her-flight-deck.db": "SQLITE_DB_BYTES_MOCK",
          "documents/sample.pdf": "PDF_CONTENT_BYTES",
        });
        const zipPath = join(tempDir, "backup.hfdbackup");
        writeFileSync(zipPath, zipBuf);

        // Module check
        const modRes = inspectBackupArchive(zipPath);
        expect(modRes.status).toBe(0);
        expect(modRes.message).toBe("PASS: no credential entry names in archive");

        // CLI check
        const cliRes = runInspectorCli(zipPath);
        expect(cliRes.status).toBe(0);
        expect(cliRes.stdout).toBe("PASS: no credential entry names in archive");
        expect(cliRes.stderr).toBe("");

        // Non-disclosure verification
        const output = `${cliRes.stdout}\n${cliRes.stderr}`;
        expect(output).not.toContain("manifest.json");
        expect(output).not.toContain("her-flight-deck.db");
        expect(output).not.toContain("documents/sample.pdf");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("fails closed (status 1) when archive contains gemini-key entry without leaking content", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "hfd-cred-key-"));
      try {
        const secretContent = "SECRET_API_KEY_AIzaSyDO_NOT_PRINT";
        const zipBuf = createTestZip({
          "manifest.json": "{}",
          "her-flight-deck.db": "db",
          "gemini-key": secretContent,
        });
        const zipPath = join(tempDir, "backup.hfdbackup");
        writeFileSync(zipPath, zipBuf);

        const modRes = inspectBackupArchive(zipPath);
        expect(modRes.status).toBe(1);
        expect(modRes.message).toBe("FAIL: credential entry found in archive");

        const cliRes = runInspectorCli(zipPath);
        expect(cliRes.status).toBe(1);
        expect(cliRes.stdout).toBe("");
        expect(cliRes.stderr).toBe("FAIL: credential entry found in archive");

        // Non-disclosure
        expect(cliRes.stderr).not.toContain(secretContent);
        expect(cliRes.stderr).not.toContain("gemini-key");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("fails closed (status 1) when archive contains gemini-key.writing entry", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "hfd-cred-writing-"));
      try {
        const zipBuf = createTestZip({
          "manifest.json": "{}",
          "gemini-key.writing": "half_written_key",
        });
        const zipPath = join(tempDir, "backup.hfdbackup");
        writeFileSync(zipPath, zipBuf);

        const modRes = inspectBackupArchive(zipPath);
        expect(modRes.status).toBe(1);
        expect(modRes.message).toBe("FAIL: credential entry found in archive");

        const cliRes = runInspectorCli(zipPath);
        expect(cliRes.status).toBe(1);
        expect(cliRes.stderr).toBe("FAIL: credential entry found in archive");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("fails closed (status 1) when archive contains nested path containing credential name", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "hfd-cred-nested-"));
      try {
        const zipBuf = createTestZip({
          "manifest.json": "{}",
          "secrets/gemini-key": "nested_secret",
        });
        const zipPath = join(tempDir, "backup.hfdbackup");
        writeFileSync(zipPath, zipBuf);

        const modRes = inspectBackupArchive(zipPath);
        expect(modRes.status).toBe(1);
        expect(modRes.message).toBe("FAIL: credential entry found in archive");

        const cliRes = runInspectorCli(zipPath);
        expect(cliRes.status).toBe(1);
        expect(cliRes.stderr).toBe("FAIL: credential entry found in archive");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("reports inspection error (status 2) on missing archive file", () => {
      const missingPath = resolve(process.cwd(), "nonexistent-backup-target.hfdbackup");
      const modRes = inspectBackupArchive(missingPath);
      expect(modRes.status).toBe(2);
      expect(modRes.message).toBe("INSPECTION ERROR: archive missing, unreadable, or corrupted");

      const cliRes = runInspectorCli(missingPath);
      expect(cliRes.status).toBe(2);
      expect(cliRes.stdout).toBe("");
      expect(cliRes.stderr).toBe("INSPECTION ERROR: archive missing, unreadable, or corrupted");
    });

    it("reports inspection error (status 2) on corrupted or truncated ZIP", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "hfd-cred-corrupt-"));
      try {
        const corruptedPath = join(tempDir, "corrupted.hfdbackup");
        writeFileSync(corruptedPath, Buffer.from("PK\x03\x04 truncated random non-zip bytes"));

        const modRes = inspectBackupArchive(corruptedPath);
        expect(modRes.status).toBe(2);
        expect(modRes.message).toBe("INSPECTION ERROR: archive missing, unreadable, or corrupted");

        const cliRes = runInspectorCli(corruptedPath);
        expect(cliRes.status).toBe(2);
        expect(cliRes.stderr).toBe("INSPECTION ERROR: archive missing, unreadable, or corrupted");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("reports inspection error (status 2) when target is a directory", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "hfd-cred-dir-"));
      try {
        const modRes = inspectBackupArchive(tempDir);
        expect(modRes.status).toBe(2);
        expect(modRes.message).toBe("INSPECTION ERROR: archive missing, unreadable, or corrupted");

        const cliRes = runInspectorCli(tempDir);
        expect(cliRes.status).toBe(2);
        expect(cliRes.stderr).toBe("INSPECTION ERROR: archive missing, unreadable, or corrupted");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("handles archive paths containing spaces correctly", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "hfd-cred-spaces-"));
      try {
        const zipBuf = createTestZip({
          "manifest.json": "{}",
          "her-flight-deck.db": "db",
        });
        const zipPath = join(tempDir, "her flight deck backup with spaces.hfdbackup");
        writeFileSync(zipPath, zipBuf);

        const modRes = inspectBackupArchive(zipPath);
        expect(modRes.status).toBe(0);
        expect(modRes.message).toBe("PASS: no credential entry names in archive");

        const cliRes = runInspectorCli(zipPath);
        expect(cliRes.status).toBe(0);
        expect(cliRes.stdout).toBe("PASS: no credential entry names in archive");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("reports inspection error (status 2) on count-underreporting tamper reproductions (module and CLI)", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "hfd-cred-undercount-"));
      try {
        const secretZip = createTestZip({
          "manifest.json": "{}",
          "secrets/gemini-key": "synthetic placeholder only",
        });

        // Underreported count: 2 entries changed to 1
        const undercountBuf = Buffer.from(secretZip);
        undercountBuf.writeUInt16LE(1, undercountBuf.length - 22 + 8);
        undercountBuf.writeUInt16LE(1, undercountBuf.length - 22 + 10);
        const undercountPath = join(tempDir, "undercount.hfdbackup");
        writeFileSync(undercountPath, undercountBuf);

        const modUndercount = inspectBackupArchive(undercountPath);
        expect(modUndercount.status).toBe(2);
        expect(modUndercount.message).toBe("INSPECTION ERROR: archive missing, unreadable, or corrupted");

        const cliUndercount = runInspectorCli(undercountPath);
        expect(cliUndercount.status).toBe(2);
        expect(cliUndercount.stderr).toBe("INSPECTION ERROR: archive missing, unreadable, or corrupted");

        // Zero count: 2 entries changed to 0
        const zeroCountBuf = Buffer.from(secretZip);
        zeroCountBuf.writeUInt16LE(0, zeroCountBuf.length - 22 + 8);
        zeroCountBuf.writeUInt16LE(0, zeroCountBuf.length - 22 + 10);
        const zeroCountPath = join(tempDir, "zero-count.hfdbackup");
        writeFileSync(zeroCountPath, zeroCountBuf);

        const modZero = inspectBackupArchive(zeroCountPath);
        expect(modZero.status).toBe(2);
        expect(modZero.message).toBe("INSPECTION ERROR: archive missing, unreadable, or corrupted");

        const cliZero = runInspectorCli(zeroCountPath);
        expect(cliZero.status).toBe(2);
        expect(cliZero.stderr).toBe("INSPECTION ERROR: archive missing, unreadable, or corrupted");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("reports inspection error (status 2) on inconsistent declared directory size, truncated variable fields, malformed EOCD bounds, and unsupported layouts", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "hfd-cred-malformed-"));
      try {
        const baseZip = createTestZip({
          "manifest.json": "{}",
          "her-flight-deck.db": "database",
        });

        // 1. Inconsistent declared central directory size
        const tamperedSizeBuf = Buffer.from(baseZip);
        const origSize = tamperedSizeBuf.readUInt32LE(tamperedSizeBuf.length - 22 + 12);
        tamperedSizeBuf.writeUInt32LE(origSize - 10, tamperedSizeBuf.length - 22 + 12);
        const tamperedSizePath = join(tempDir, "tampered-size.hfdbackup");
        writeFileSync(tamperedSizePath, tamperedSizeBuf);

        expect(inspectBackupArchive(tamperedSizePath).status).toBe(2);
        expect(runInspectorCli(tamperedSizePath).status).toBe(2);

        // 2. Malformed EOCD bounds (declared comment length exceeds buffer)
        const tamperedCommentBuf = Buffer.from(baseZip);
        tamperedCommentBuf.writeUInt16LE(10, tamperedCommentBuf.length - 22 + 20);
        const tamperedCommentPath = join(tempDir, "tampered-comment.hfdbackup");
        writeFileSync(tamperedCommentPath, tamperedCommentBuf);

        expect(inspectBackupArchive(tamperedCommentPath).status).toBe(2);
        expect(runInspectorCli(tamperedCommentPath).status).toBe(2);

        // 3. Multi-disk archive rejection
        const multiDiskBuf = Buffer.from(baseZip);
        multiDiskBuf.writeUInt16LE(1, multiDiskBuf.length - 22 + 4);
        const multiDiskPath = join(tempDir, "multi-disk.hfdbackup");
        writeFileSync(multiDiskPath, multiDiskBuf);

        expect(inspectBackupArchive(multiDiskPath).status).toBe(2);
        expect(runInspectorCli(multiDiskPath).status).toBe(2);

        // 4. Archive with valid-looking EOCD and central directory, but local header signature mismatch
        const tamperedLocalBuf = Buffer.from(baseZip);
        tamperedLocalBuf.writeUInt32LE(0x00000000, 0);
        const tamperedLocalPath = join(tempDir, "tampered-local.hfdbackup");
        writeFileSync(tamperedLocalPath, tamperedLocalBuf);

        expect(inspectBackupArchive(tamperedLocalPath).status).toBe(2);
        expect(runInspectorCli(tamperedLocalPath).status).toBe(2);

        // 5. Truncated variable field in central directory
        const tamperedVarBuf = Buffer.from(baseZip);
        const cdOffset = tamperedVarBuf.readUInt32LE(tamperedVarBuf.length - 22 + 16);
        tamperedVarBuf.writeUInt16LE(60000, cdOffset + 30);
        const tamperedVarPath = join(tempDir, "tampered-var.hfdbackup");
        writeFileSync(tamperedVarPath, tamperedVarBuf);

        expect(inspectBackupArchive(tamperedVarPath).status).toBe(2);
        expect(runInspectorCli(tamperedVarPath).status).toBe(2);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("Mac parity checklist documentation integrity", () => {
    it("ensures fail-closed credential inspection routine is documented with trap and quiet listing", () => {
      const checklist = readFileSync(MAC_CHECKLIST_PATH, "utf8");
      expect(checklist).toContain("trap 'rm -f \"$TMP_LIST\"' EXIT INT TERM");
      expect(checklist).toContain("unzip -q -l \"$BACKUP_PATH\"");
      expect(checklist).toContain("INSPECTION ERROR: archive missing, unreadable, or corrupted");
      expect(checklist).toContain("FAIL: credential entry found in archive");
      expect(checklist).toContain("PASS: no credential entry names in archive");
      expect(checklist).toContain("node scripts/inspect-backup-credentials.mjs");
    });

    it("references actual Rust backup allowlist regression tests and eliminates non-existent names", () => {
      const checklist = readFileSync(MAC_CHECKLIST_PATH, "utf8");
      expect(checklist).toContain("an_archive_may_only_contain_her_database_and_documents");
      expect(checklist).toContain("secrets.rs");
      expect(checklist).toContain("complete_backup_keeps_the_pdf_plan_progress_provenance_and_ledger_and_retries_safely_after_restore");
      expect(checklist).not.toContain("allowed_archive_path_only_permits_our_files");
    });

    it("links full repository audit note and preserves frozen candidate status without claiming bounded RSS", () => {
      const checklist = readFileSync(MAC_CHECKLIST_PATH, "utf8");
      expect(checklist).toContain("FULL_REPOSITORY_AUDIT_2026-09-29.md");
      expect(checklist).toContain("v0.5.3 is a recorded frozen private candidate with known source defects");
      expect(checklist).toContain("v0.5.3 is not currently approvable merely by passing the Mac checklist");
      expect(checklist).toContain("Do not claim that windowing guarantees a source-independent or strictly bounded total memory footprint");
      expect(checklist).not.toContain("memory-bounded windowing keeps peak RSS stable");
    });

    function findBashExecutable(candidates: string[] = [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
      "bash",
    ]): string | null {
      return (
        candidates.find((candidate) => {
          try {
            const res = spawnSync(candidate, ["-c", "echo ok"], { encoding: "utf8" });
            return res.status === 0 && res.stdout.trim() === "ok";
          } catch {
            return false;
          }
        }) ?? null
      );
    }

    it("visibly marks shell execution as skipped when no bash executable is available", (ctx) => {
      const unavailableBash = findBashExecutable(["nonexistent-bash-executable-404.exe"]);
      expect(unavailableBash).toBeNull();
      ctx.skip("Deterministic availability seam: missing bash candidate correctly produces an explicit test skip");
    });

    it("executes the documented shell routine in a Windows-hosted Git Bash environment verifying status codes, non-disclosure, and cleanup", (ctx) => {
      const bashPath = findBashExecutable();
      if (!bashPath) {
        ctx.skip("Git Bash not found in environment; Windows-hosted shell verification is unavailable");
        return;
      }

      const checklist = readFileSync(MAC_CHECKLIST_PATH, "utf8");
      const routineMatch = checklist.match(/`(\(TMP_LIST=.*?exit 0\))`<br>/);
      expect(routineMatch).toBeTruthy();
      const routine = routineMatch![1]!.replace(/\\\|/g, "|");

      const tempDir = mkdtempSync(join(tmpdir(), "hfd-shell-test-"));
      const isolatedTmpDir = join(tempDir, "isolated-tmp");
      mkdirSync(isolatedTmpDir, { recursive: true });
      const observeFile = join(tempDir, "observe-mktemp.txt");

      try {
        const cleanZip = createTestZip({
          "manifest.json": "{}",
          "her-flight-deck.db": "synthetic database",
        });
        const cleanPath = join(tempDir, "clean.hfdbackup");
        writeFileSync(cleanPath, cleanZip);

        const secretZip = createTestZip({
          "manifest.json": "{}",
          "secrets/gemini-key": "secret",
        });
        const secretPath = join(tempDir, "secret.hfdbackup");
        writeFileSync(secretPath, secretZip);

        const spaceZipPath = join(tempDir, "backup with spaces.hfdbackup");
        writeFileSync(spaceZipPath, cleanZip);

        function execRoutine(archivePath: string, prefix = "", extraEnv: Record<string, string> = {}) {
          if (existsSync(observeFile)) {
            rmSync(observeFile, { force: true });
          }
          const hookPrefix = `TMPDIR="$(cd "$ISOLATED_TMP_DIR" && pwd)"; export TMPDIR; orig_mktemp() { command mktemp "$@"; }; mktemp() { f=$(orig_mktemp "$@") || return 1; echo "$f" > "$OBSERVE_FILE"; echo "$f"; }; ${prefix}`;
          return spawnSync(bashPath!, ["-c", `${hookPrefix}BACKUP_PATH="$AUDIT_ARCHIVE"; ${routine}`], {
            encoding: "utf8",
            env: {
              ...process.env,
              AUDIT_ARCHIVE: archivePath,
              ISOLATED_TMP_DIR: isolatedTmpDir,
              OBSERVE_FILE: observeFile,
              ...extraEnv,
            },
          });
        }

        // 1. Valid clean archive => status 0, generic PASS, no sensitive text, listing cleaned up
        const resClean = execRoutine(cleanPath);
        expect(resClean.status).toBe(0);
        expect(resClean.stdout.trim()).toBe("PASS: no credential entry names in archive");
        expect(resClean.stderr.trim()).toBe("");
        const createdClean = readFileSync(observeFile, "utf8").trim();
        expect(createdClean).toBeTruthy();
        expect(readdirSync(isolatedTmpDir)).toEqual([]);

        // 2. Valid credential entry => status 1, generic FAIL, listing cleaned up
        const resSecret = execRoutine(secretPath);
        expect(resSecret.status).toBe(1);
        expect(resSecret.stdout.trim()).toBe("");
        expect(resSecret.stderr.trim()).toBe("FAIL: credential entry found in archive");
        const createdSecret = readFileSync(observeFile, "utf8").trim();
        expect(createdSecret).toBeTruthy();
        expect(readdirSync(isolatedTmpDir)).toEqual([]);

        // 3. Search command error (grep returning 2) => status 2, INSPECTION ERROR, listing cleaned up
        const resGrepError = execRoutine(cleanPath, "grep() { return 2; }; ");
        expect(resGrepError.status).toBe(2);
        expect(resGrepError.stdout.trim()).toBe("");
        expect(resGrepError.stderr.trim()).toBe("INSPECTION ERROR: archive missing, unreadable, or corrupted");
        const createdGrepError = readFileSync(observeFile, "utf8").trim();
        expect(createdGrepError).toBeTruthy();
        expect(readdirSync(isolatedTmpDir)).toEqual([]);

        // 4. Missing search command (command not found -> 127) => status 2, listing cleaned up
        const resGrepMissing = execRoutine(cleanPath, "unset -f grep; grep() { return 127; }; ");
        expect(resGrepMissing.status).toBe(2);
        expect(resGrepMissing.stderr.trim()).toBe("INSPECTION ERROR: archive missing, unreadable, or corrupted");
        const createdGrepMissing = readFileSync(observeFile, "utf8").trim();
        expect(createdGrepMissing).toBeTruthy();
        expect(readdirSync(isolatedTmpDir)).toEqual([]);

        // 5. Missing / corrupt archive (unzip / listing failure) => status 2, listing cleaned up
        const resMissing = execRoutine(join(tempDir, "nonexistent.hfdbackup"));
        expect(resMissing.status).toBe(2);
        expect(resMissing.stderr.trim()).toBe("INSPECTION ERROR: archive missing, unreadable, or corrupted");
        const createdMissing = readFileSync(observeFile, "utf8").trim();
        expect(createdMissing).toBeTruthy();
        expect(readdirSync(isolatedTmpDir)).toEqual([]);

        // 6. Archive paths containing spaces => status 0, PASS, listing cleaned up
        const resSpace = execRoutine(spaceZipPath);
        expect(resSpace.status).toBe(0);
        expect(resSpace.stdout.trim()).toBe("PASS: no credential entry names in archive");
        expect(readdirSync(isolatedTmpDir)).toEqual([]);

        // 7. Failing mktemp => status 2, INSPECTION ERROR, no orphaned files
        const resMktempFail = execRoutine(cleanPath, "mktemp() { return 1; }; ");
        expect(resMktempFail.status).toBe(2);
        expect(resMktempFail.stderr.trim()).toBe("INSPECTION ERROR: archive missing, unreadable, or corrupted");
        expect(readdirSync(isolatedTmpDir)).toEqual([]);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("synthetic PDF test fixture generation determinism and specifications", () => {
    it("generates Fixture A (small checklist, 10 pages) deterministically matching accepted input metrics", () => {
      const buf1 = buildPdf(10, 0, 0, "Checklist");
      const buf2 = buildPdf(10, 0, 0, "Checklist");

      expect(buf1.length).toBe(3360);
      expect(buf2.length).toBe(3360);

      const hash1 = createHash("sha256").update(buf1).digest("hex");
      const hash2 = createHash("sha256").update(buf2).digest("hex");

      expect(hash1).toBe("f6c593f9d86de6e83bd476897cde7693a43cb5db785c6afbcf01eb1d8024b134");
      expect(hash2).toBe(hash1);

      // Verify distinct page IDs exist
      const text = buf1.toString("latin1");
      expect(text).toContain("Synthetic Checklist - Page 1 of 10 (ID: P0001)");
      expect(text).toContain("Synthetic Checklist - Page 10 of 10 (ID: P0010)");
    });

    it("generates Fixture B (long manual, 1,050 pages) deterministically matching accepted input metrics", () => {
      const buf1 = buildPdf(1050, 0, 0, "Handbook");
      const buf2 = buildPdf(1050, 0, 0, "Handbook");

      expect(buf1.length).toBe(330934);
      expect(buf2.length).toBe(330934);

      const hash1 = createHash("sha256").update(buf1).digest("hex");
      const hash2 = createHash("sha256").update(buf2).digest("hex");

      expect(hash1).toBe("0ba9a7e2c4b9e14aac2360fc410f5b4a05eab9b2c9ab4b23ea8ab7228f9692c1");
      expect(hash2).toBe(hash1);

      const text = buf1.toString("latin1");
      expect(text).toContain("Synthetic Handbook - Page 1 of 1050 (ID: P0001)");
      expect(text).toContain("Synthetic Handbook - Page 1050 of 1050 (ID: P1050)");
    });

    it("generates Fixture C (illustrated charts, 60 pages) deterministically matching accepted input metrics", () => {
      const buf1 = buildPdf(60, 600, 500, "Charts");
      const buf2 = buildPdf(60, 600, 500, "Charts");

      expect(buf1.length).toBe(54032644);
      expect(buf2.length).toBe(54032644);

      const hash1 = createHash("sha256").update(buf1).digest("hex");
      const hash2 = createHash("sha256").update(buf2).digest("hex");

      expect(hash1).toBe("b5651eb61a484dbe4876da2ff002d4884f414086080ee061b67f6fec01ab096d");
      expect(hash2).toBe(hash1);

      // Verify declared image dimensions and stream length: 600 * 500 * 3 = 900,000 bytes
      const rawText = buf1.toString("latin1");
      expect(rawText).toContain("/Width 600 /Height 500 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 900000");

      const text = buf1.toString("latin1");
      expect(text).toContain("Synthetic Charts - Page 1 of 60 (ID: P0001)");
      expect(text).toContain("Synthetic Charts - Page 60 of 60 (ID: P0060)");
    });

    it("verifies generateFixtures produces all three standard fixtures matching FIXTURE_SPECS", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "hfd-fixtures-test-"));
      try {
        const results = generateFixtures(tempDir);
        expect(results).toHaveLength(3);
        for (let i = 0; i < FIXTURE_SPECS.length; i++) {
          const spec = FIXTURE_SPECS[i];
          const res = results[i];
          expect(res.filename).toBe(spec.filename);
          expect(res.bytes).toBe(spec.expectedBytes);
          expect(res.sha256).toBe(spec.expectedSha256);
          expect(existsSync(res.filePath)).toBe(true);
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("executes generate-pdf-fixtures CLI script producing exact fixture output", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "hfd-fixtures-cli-"));
      try {
        const stdout = execFileSync(process.execPath, [GENERATE_FIXTURES_SCRIPT_PATH, tempDir], {
          encoding: "utf8",
        });
        expect(stdout).toContain("synthetic-small-checklist.pdf: 3360 bytes, SHA-256: f6c593f9d86de6e83bd476897cde7693a43cb5db785c6afbcf01eb1d8024b134");
        expect(stdout).toContain("synthetic-long-manual.pdf: 330934 bytes, SHA-256: 0ba9a7e2c4b9e14aac2360fc410f5b4a05eab9b2c9ab4b23ea8ab7228f9692c1");
        expect(stdout).toContain("synthetic-illustrated-charts.pdf: 54032644 bytes, SHA-256: b5651eb61a484dbe4876da2ff002d4884f414086080ee061b67f6fec01ab096d");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
