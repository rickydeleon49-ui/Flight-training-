#!/usr/bin/env node
/**
 * validate-signing-proposal.mjs
 *
 * Validates the proposed macOS signing workflow patch:
 * 1. Verifies read-only patch application against active .github/workflows/release.yml (git apply --check)
 * 2. Parses the applied proposed workflow AST with YAML parser
 * 3. Asserts required job environment, step ordering, and fail-closed guards
 * 4. Extracts the actual shell scripts directly from the parsed YAML steps
 * 5. Exercises synthetic failure and success cases using isolated stubs (no real security/codesign/notarization calls)
 */

import { execSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../..");
const BASE_WORKFLOW = resolve(REPO_ROOT, ".github/workflows/release.yml");
const PATCH_FILE = resolve(__dirname, "proposed-macos-signing.patch");
const PROPOSED_WORKFLOW = resolve(__dirname, "proposed-release-workflow.yml");

console.log("=== 1. Validating Read-Only Patch Application ===");
const gitApplyCheck = spawnSync("git", ["apply", "--check", PATCH_FILE], {
  cwd: REPO_ROOT,
  encoding: "utf8",
});
if (gitApplyCheck.status !== 0) {
  console.error("FAIL: git apply --check failed:\n", gitApplyCheck.stderr);
  process.exit(1);
}
console.log("PASS: git apply --check exited 0 cleanly against base release.yml");

console.log("\n=== 2. Parsing Proposed Workflow YAML and Validating AST Structure ===");
const proposedYamlContent = readFileSync(PROPOSED_WORKFLOW, "utf8");
let doc;
try {
  doc = YAML.parse(proposedYamlContent);
  console.log("PASS: Proposed workflow parsed cleanly with zero syntax errors");
} catch (err) {
  console.error("FAIL: YAML parse error:\n", err);
  process.exit(1);
}

const buildJob = doc.jobs?.build;
if (!buildJob) {
  console.error("FAIL: jobs.build missing in proposed workflow");
  process.exit(1);
}

// Verify environment declaration
if (buildJob.environment !== "${{ matrix.os == 'macos-15' && 'macos-signing' || '' }}") {
  console.error("FAIL: jobs.build.environment must be '${{ matrix.os == 'macos-15' && 'macos-signing' || '' }}', got:", buildJob.environment);
  process.exit(1);
}
console.log("PASS: jobs.build.environment is conditionally scoped to macos-signing");

const steps = buildJob.steps || [];
const stepNames = steps.map((s, idx) => ({ idx, name: s.name || s.uses || s.run?.split("\n")[0] }));

const prereqStepIdx = steps.findIndex(s => s.name === "Check macOS signing prerequisites (fail-closed)");
const setupStepIdx = steps.findIndex(s => s.name === "Prepare temporary signing keychain (macOS)");
const buildStepIdx = steps.findIndex(s => s.run && s.run.includes("tauri build"));
const verifyStepIdx = steps.findIndex(s => s.name === "Verify signature, notarization and staple (strict, read-only)");
const uploadStepIdx = steps.findIndex(s => s.uses && s.uses.includes("upload-artifact"));
const cleanupStepIdx = steps.findIndex(s => s.name === "Clean up temporary signing credentials and keychain");

if (prereqStepIdx === -1) throw new Error("Prerequisites step missing");
if (setupStepIdx === -1) throw new Error("Keychain setup step missing");
if (buildStepIdx === -1) throw new Error("Tauri build step missing");
if (verifyStepIdx === -1) throw new Error("Strict verification step missing");
if (uploadStepIdx === -1) throw new Error("Artifact upload step missing");
if (cleanupStepIdx === -1) throw new Error("Cleanup step missing");

// Assert strict ordering: Prereq < Setup < Build < Verify < Upload
if (!(prereqStepIdx < setupStepIdx && setupStepIdx < buildStepIdx && buildStepIdx < verifyStepIdx && verifyStepIdx < uploadStepIdx)) {
  console.error("FAIL: Step ordering violation! Expected Prereq < Setup < Build < Verify < Upload");
  process.exit(1);
}
console.log("PASS: Step sequence strictly enforces Verification BEFORE Artifact Upload");

// Verify cleanup has always() condition
const cleanupStep = steps[cleanupStepIdx];
if (!cleanupStep.if || !cleanupStep.if.includes("always()")) {
  console.error("FAIL: Cleanup step must include if: always(), got:", cleanupStep.if);
  process.exit(1);
}
console.log("PASS: Cleanup step includes if: always() condition");

const prereqScript = steps[prereqStepIdx].run;
const setupScript = steps[setupStepIdx].run;
const verifyScript = steps[verifyStepIdx].run;
const cleanupScript = steps[cleanupStepIdx].run;

console.log("\n=== 3. Exercising Prerequisites Check (Fail-Closed Guards) ===");

function runPrereqCheck(envOverrides = {}) {
  const defaultEnv = {
    EVENT_NAME: "workflow_dispatch",
    REF_NAME: "main",
    APPLE_CERTIFICATE: "c3ludGhldGljLWNlcnQ=",
    APPLE_CERTIFICATE_PASSWORD: "synthetic-password",
    APPLE_SIGNING_IDENTITY: "Developer ID Application: Synthetic Team (SYNTH12345)",
    APPLE_TEAM_ID: "SYNTH12345",
    APPLE_API_KEY: "SYNTHKEY10",
    APPLE_API_KEY_P8: "-----BEGIN PRIVATE KEY-----\nSYNTHETIC\n-----END PRIVATE KEY-----",
    APPLE_API_ISSUER: "11111111-2222-3333-4444-555555555555",
    APPLE_ID: "",
    APPLE_PASSWORD: "",
  };
  const env = { ...process.env, ...defaultEnv, ...envOverrides };
  const res = spawnSync("bash", ["-c", prereqScript], { env, encoding: "utf8" });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

// Case 1: Tag push event
const tagRes = runPrereqCheck({ EVENT_NAME: "push" });
if (tagRes.status === 0 || !tagRes.stdout.includes("Signed macOS release builds are permitted only via manual workflow_dispatch")) {
  console.error("FAIL: Did not reject tag push event", tagRes);
  process.exit(1);
}
console.log("PASS: Correctly rejected push event (status %d)", tagRes.status);

// Case 2: Non-main branch
const branchRes = runPrereqCheck({ REF_NAME: "feature/unapproved" });
if (branchRes.status === 0 || !branchRes.stdout.includes("must be dispatched from main branch")) {
  console.error("FAIL: Did not reject non-main branch", branchRes);
  process.exit(1);
}
console.log("PASS: Correctly rejected non-main branch (status %d)", branchRes.status);

// Case 3: Missing certificate
const noCertRes = runPrereqCheck({ APPLE_CERTIFICATE: "" });
if (noCertRes.status === 0 || !noCertRes.stdout.includes("APPLE_CERTIFICATE")) {
  console.error("FAIL: Did not reject missing certificate", noCertRes);
  process.exit(1);
}
console.log("PASS: Correctly rejected missing APPLE_CERTIFICATE (status %d)", noCertRes.status);

// Case 4: Missing team ID
const noTeamRes = runPrereqCheck({ APPLE_TEAM_ID: "" });
if (noTeamRes.status === 0 || !noTeamRes.stdout.includes("APPLE_TEAM_ID")) {
  console.error("FAIL: Did not reject missing team ID", noTeamRes);
  process.exit(1);
}
console.log("PASS: Correctly rejected missing APPLE_TEAM_ID (status %d)", noTeamRes.status);

// Case 5: Missing all notarization auth
const noAuthRes = runPrereqCheck({ APPLE_API_KEY: "", APPLE_ID: "" });
if (noAuthRes.status === 0 || !noAuthRes.stdout.includes("Required macOS signing prerequisites are missing")) {
  console.error("FAIL: Did not reject missing notarization auth", noAuthRes);
  process.exit(1);
}
console.log("PASS: Correctly rejected missing notarization authentication (status %d)", noAuthRes.status);

// Case 6: Valid API key authentication
const validApiRes = runPrereqCheck();
if (validApiRes.status !== 0) {
  console.error("FAIL: Valid API key auth rejected", validApiRes);
  process.exit(1);
}
console.log("PASS: Accepted valid API key authentication (status 0)");

// Case 7: Valid password authentication
const validPwdRes = runPrereqCheck({
  APPLE_API_KEY: "",
  APPLE_API_KEY_P8: "",
  APPLE_API_ISSUER: "",
  APPLE_ID: "pilot@example.com",
  APPLE_PASSWORD: "app-specific-password",
});
if (validPwdRes.status !== 0) {
  console.error("FAIL: Valid app-specific password auth rejected", validPwdRes);
  process.exit(1);
}
console.log("PASS: Accepted valid app-specific password authentication (status 0)");

console.log("\n=== 4. Exercising Strict Verification with Synthetic Mock Stubs ===");

const testScratch = mkdtempSync(join(tmpdir(), "hfd-signing-test-"));

try {
  const mockBin = join(testScratch, "bin");
  mkdirSync(mockBin, { recursive: true });

  const runnerTemp = join(testScratch, "runner-temp");
  mkdirSync(runnerTemp, { recursive: true });

  const dmgDir = join(testScratch, "src-tauri/target/release/bundle/dmg");
  mkdirSync(dmgDir, { recursive: true });
  const dmgPath = join(dmgDir, "Her Flight Deck_0.5.3_aarch64.dmg");
  writeFileSync(dmgPath, "SYNTHETIC_DMG_CONTENT\n");

  const mockAppDir = join(testScratch, "mounted-app/Her Flight Deck.app/Contents");
  mkdirSync(join(mockAppDir, "MacOS"), { recursive: true });
  writeFileSync(join(mockAppDir, "MacOS/her-flight-deck"), "SYNTHETIC_EXEC\n");

  // Helper to configure mock command stubs
  function setupMocks(config = {}) {
    // codesign mock
    const codesignScript = `#!/bin/bash
TARGET="$1"
# If verifying
if [ "$1" = "--verify" ]; then
  if [ "$VERIFY_INTEGRITY_FAIL" = "1" ]; then
    echo "code has no resources but signature indicates they must be present" >&2
    exit 1
  fi
  if [ "$DMG_NOT_SIGNED" = "1" ] && [[ "$*" =~ .*dmg.* ]]; then
    echo "code object is not signed at all" >&2
    exit 1
  fi
  if [ "$APP_NOT_SIGNED" = "1" ] && [[ "$*" =~ .*app.* ]]; then
    echo "code object is not signed at all" >&2
    exit 1
  fi
  exit 0
fi

# If display (-dvv or -dv)
if [ "$DMG_NOT_SIGNED" = "1" ] && [[ "$*" =~ .*dmg.* ]]; then
  echo "code object is not signed at all" >&2
  exit 1
fi

if [[ "$*" =~ .*dmg.* ]]; then
  # DMG display
  if [ "$DMG_NO_AUTHORITY" = "1" ]; then
    echo "Authority=Ad-Hoc" >&2
  else
    echo "Authority=Developer ID Application: Synthetic Team (${config.dmgTeam || "SYNTH12345"})" >&2
  fi
  echo "TeamIdentifier=${config.dmgTeam || "SYNTH12345"}" >&2
  if [ "$DMG_NO_TIMESTAMP" != "1" ]; then
    echo "Timestamp=2026-10-04 15:30:00" >&2
  fi
  exit 0
fi

# App display
if [ "$APP_NO_AUTHORITY" = "1" ]; then
  echo "Authority=Ad-Hoc" >&2
else
  echo "Authority=Developer ID Application: Synthetic Team (${config.appTeam || "SYNTH12345"})" >&2
fi
echo "TeamIdentifier=${config.appTeam || "SYNTH12345"}" >&2
echo "Identifier=${config.appId || "com.herflightdeck.app"}" >&2
if [ "$APP_NO_RUNTIME" != "1" ]; then
  echo "CodeDirectory flags=0x10000(runtime)" >&2
fi
if [ "$APP_NO_TIMESTAMP" != "1" ]; then
  echo "Timestamp=2026-10-04 15:30:00" >&2
fi
exit 0
`;
    writeFileSync(join(mockBin, "codesign"), codesignScript);
    chmodSync(join(mockBin, "codesign"), 0o755);

    // stapler mock
    const staplerScript = `#!/bin/bash
if [ "$STAPLER_FAIL" = "1" ]; then
  echo "The validate action failed! Ticket was not found." >&2
  exit 1
fi
echo "The validate action worked!"
exit 0
`;
    writeFileSync(join(mockBin, "xcrun"), staplerScript);
    chmodSync(join(mockBin, "xcrun"), 0o755);

    // hdiutil mock
    const hdiutilScript = `#!/bin/bash
if [ "$1" = "attach" ]; then
  # Find mountpoint arg
  while [ $# -gt 0 ]; do
    if [ "$1" = "-mountpoint" ]; then
      MNT="$2"
      mkdir -p "$MNT"
      cp -R "${join(testScratch, "mounted-app")}/"* "$MNT/" 2>/dev/null || true
      break
    fi
    shift
  done
  exit 0
fi
if [ "$1" = "detach" ]; then
  exit 0
fi
exit 0
`;
    writeFileSync(join(mockBin, "hdiutil"), hdiutilScript);
    chmodSync(join(mockBin, "hdiutil"), 0o755);

    // file mock
    const fileScript = `#!/bin/bash
if [ "$FILE_NOT_ARM64" = "1" ]; then
  echo "Mach-O 64-bit executable x86_64"
else
  echo "Mach-O 64-bit executable arm64"
fi
exit 0
`;
    writeFileSync(join(mockBin, "file"), fileScript);
    chmodSync(join(mockBin, "file"), 0o755);

    // plutil mock
    const plutilScript = `#!/bin/bash
KEY="$2"
if [ "$KEY" = "CFBundleIdentifier" ]; then
  echo "${config.plistId || "com.herflightdeck.app"}"
elif [ "$KEY" = "CFBundleShortVersionString" ]; then
  echo "${config.plistVersion || "0.5.3"}"
elif [ "$KEY" = "LSMinimumSystemVersion" ]; then
  echo "${config.plistMinOs || "12.0"}"
fi
exit 0
`;
    writeFileSync(join(mockBin, "plutil"), plutilScript);
    chmodSync(join(mockBin, "plutil"), 0o755);

    // spctl mock
    const spctlScript = `#!/bin/bash
if [ "$SPCTL_FAIL" = "1" ]; then
  echo "rejected" >&2
  exit 1
fi
echo "accepted"
exit 0
`;
    writeFileSync(join(mockBin, "spctl"), spctlScript);
    chmodSync(join(mockBin, "spctl"), 0o755);
  }

  function runVerifyCheck(envOverrides = {}, mockConfig = {}) {
    setupMocks(mockConfig);
    const env = {
      ...process.env,
      PATH: `${mockBin}:${process.env.PATH}`,
      RUNNER_TEMP: runnerTemp,
      EXPECTED_TEAM_ID: "SYNTH12345",
      VERSION: "0.5.3",
      ...envOverrides,
    };
    const res = spawnSync("bash", ["-c", verifyScript], {
      cwd: testScratch,
      env,
      encoding: "utf8",
    });
    return { status: res.status, stdout: res.stdout, stderr: res.stderr };
  }

  // Probe 1: Unsigned DMG container
  const probeDmgUnsigned = runVerifyCheck({ DMG_NOT_SIGNED: "1" });
  if (probeDmgUnsigned.status === 0 || !probeDmgUnsigned.stderr.includes("code object is not signed at all")) {
    console.error("FAIL: Did not reject unsigned DMG container", probeDmgUnsigned);
    process.exit(1);
  }
  console.log("PASS: Correctly rejected unsigned DMG container (status %d)", probeDmgUnsigned.status);

  // Probe 2: DMG missing Developer ID authority
  const probeDmgNoAuth = runVerifyCheck({ DMG_NO_AUTHORITY: "1" });
  if (probeDmgNoAuth.status === 0 || !probeDmgNoAuth.stdout.includes("DMG container lacks Developer ID Application")) {
    console.error("FAIL: Did not reject DMG with missing Developer ID authority", probeDmgNoAuth);
    process.exit(1);
  }
  console.log("PASS: Correctly rejected DMG container without Developer ID authority (status %d)", probeDmgNoAuth.status);

  // Probe 3: DMG wrong team ID
  const probeDmgWrongTeam = runVerifyCheck({}, { dmgTeam: "WRONGTEAM" });
  if (probeDmgWrongTeam.status === 0 || !probeDmgWrongTeam.stdout.includes("DMG container TeamIdentifier does not match")) {
    console.error("FAIL: Did not reject DMG container with wrong team", probeDmgWrongTeam);
    process.exit(1);
  }
  console.log("PASS: Correctly rejected DMG container with wrong team ID (status %d)", probeDmgWrongTeam.status);

  // Probe 4: DMG missing timestamp
  const probeDmgNoTs = runVerifyCheck({ DMG_NO_TIMESTAMP: "1" });
  if (probeDmgNoTs.status === 0 || !probeDmgNoTs.stdout.includes("DMG container lacks secure timestamp")) {
    console.error("FAIL: Did not reject DMG container lacking timestamp", probeDmgNoTs);
    process.exit(1);
  }
  console.log("PASS: Correctly rejected DMG container lacking secure timestamp (status %d)", probeDmgNoTs.status);

  // Probe 5: Stapler validation failure on DMG
  const probeStapleFail = runVerifyCheck({ STAPLER_FAIL: "1" });
  if (probeStapleFail.status === 0) {
    console.error("FAIL: Did not reject DMG with failing stapler validation", probeStapleFail);
    process.exit(1);
  }
  console.log("PASS: Correctly rejected failing stapler validation (status %d)", probeStapleFail.status);

  // Probe 6: App architecture not arm64
  const probeNotArm64 = runVerifyCheck({ FILE_NOT_ARM64: "1" });
  if (probeNotArm64.status === 0 || !probeNotArm64.stdout.includes("Packaged executable is not arm64 architecture")) {
    console.error("FAIL: Did not reject non-arm64 executable", probeNotArm64);
    process.exit(1);
  }
  console.log("PASS: Correctly rejected non-arm64 executable (status %d)", probeNotArm64.status);

  // Probe 7: App bundle identifier mismatch
  const probeWrongId = runVerifyCheck({}, { plistId: "com.wrong.app" });
  if (probeWrongId.status === 0 || !probeWrongId.stdout.includes("does not match 'com.herflightdeck.app'")) {
    console.error("FAIL: Did not reject wrong app bundle identifier", probeWrongId);
    process.exit(1);
  }
  console.log("PASS: Correctly rejected wrong bundle identifier (status %d)", probeWrongId.status);

  // Probe 8: App strict integrity verification failure
  const probeIntegrityFail = runVerifyCheck({ VERIFY_INTEGRITY_FAIL: "1" });
  if (probeIntegrityFail.status === 0 || !probeIntegrityFail.stderr.includes("code has no resources")) {
    console.error("FAIL: Did not reject app failing strict integrity check", probeIntegrityFail);
    process.exit(1);
  }
  console.log("PASS: Correctly rejected app failing strict integrity check (status %d)", probeIntegrityFail.status);

  // Probe 9: App missing Developer ID authority
  const probeAppNoAuth = runVerifyCheck({ APP_NO_AUTHORITY: "1" });
  if (probeAppNoAuth.status === 0 || !probeAppNoAuth.stdout.includes("App bundle lacks Developer ID Application")) {
    console.error("FAIL: Did not reject app lacking Developer ID authority", probeAppNoAuth);
    process.exit(1);
  }
  console.log("PASS: Correctly rejected app lacking Developer ID authority (status %d)", probeAppNoAuth.status);

  // Probe 10: App wrong team ID (Codex's probe reproduction!)
  const probeAppWrongTeam = runVerifyCheck({}, { appTeam: "WRONGTEAM" });
  if (probeAppWrongTeam.status === 0 || !probeAppWrongTeam.stdout.includes("App bundle TeamIdentifier does not match")) {
    console.error("FAIL: Did not reject app with WRONGTEAM", probeAppWrongTeam);
    process.exit(1);
  }
  console.log("PASS: Correctly rejected app with WRONGTEAM (reproduced probe fixed, status %d)", probeAppWrongTeam.status);

  // Probe 11: App wrong code-signing identifier
  const probeAppSignId = runVerifyCheck({}, { appId: "com.other.app" });
  if (probeAppSignId.status === 0 || !probeAppSignId.stdout.includes("App signing identifier does not match com.herflightdeck.app")) {
    console.error("FAIL: Did not reject app with mismatched signing identifier", probeAppSignId);
    process.exit(1);
  }
  console.log("PASS: Correctly rejected app with mismatched signing identifier (status %d)", probeAppSignId.status);

  // Probe 12: App missing hardened runtime
  const probeAppNoRuntime = runVerifyCheck({ APP_NO_RUNTIME: "1" });
  if (probeAppNoRuntime.status === 0 || !probeAppNoRuntime.stdout.includes("App bundle lacks hardened runtime flag")) {
    console.error("FAIL: Did not reject app lacking hardened runtime", probeAppNoRuntime);
    process.exit(1);
  }
  console.log("PASS: Correctly rejected app lacking hardened runtime (status %d)", probeAppNoRuntime.status);

  // Probe 13: App missing timestamp
  const probeAppNoTs = runVerifyCheck({ APP_NO_TIMESTAMP: "1" });
  if (probeAppNoTs.status === 0 || !probeAppNoTs.stdout.includes("App bundle lacks secure timestamp")) {
    console.error("FAIL: Did not reject app lacking secure timestamp", probeAppNoTs);
    process.exit(1);
  }
  console.log("PASS: Correctly rejected app lacking secure timestamp (status %d)", probeAppNoTs.status);

  // Probe 14: Gatekeeper assessment rejected
  const probeSpctlFail = runVerifyCheck({ SPCTL_FAIL: "1" });
  if (probeSpctlFail.status === 0) {
    console.error("FAIL: Did not reject app failing Gatekeeper spctl assessment", probeSpctlFail);
    process.exit(1);
  }
  console.log("PASS: Correctly rejected app failing Gatekeeper spctl assessment (status %d)", probeSpctlFail.status);

  // Probe 15: Valid synthetic success path
  const probeValid = runVerifyCheck();
  if (probeValid.status !== 0) {
    console.error("FAIL: Valid synthetic success path failed", probeValid);
    process.exit(1);
  }
  console.log("PASS: Valid synthetic success path passed all container and app checks (status 0)");

  console.log("\n=== 5. Exercising Temporary Keychain and Material Cleanup ===");

  // Mock security command for cleanup testing
  const mockSecurityScript = `#!/bin/bash
if [ "$1" = "delete-keychain" ]; then
  if [ "$MOCK_DELETE_KEYCHAIN_FAIL" = "1" ]; then
    exit 1
  fi
  rm -f "$2" 2>/dev/null || true
  exit 0
fi
if [ "$1" = "list-keychains" ]; then
  exit 0
fi
exit 0
`;
  writeFileSync(join(mockBin, "security"), mockSecurityScript);
  chmodSync(join(mockBin, "security"), 0o755);

  // Test successful cleanup
  const dummyKc = join(runnerTemp, "hfd-signing.keychain-db");
  const dummyP8 = join(runnerTemp, "AuthKey.p8");
  const dummyP12 = join(runnerTemp, "cert.p12");
  writeFileSync(dummyKc, "DUMMY_KEYCHAIN");
  writeFileSync(dummyP8, "DUMMY_P8");
  writeFileSync(dummyP12, "DUMMY_P12");

  const cleanEnv = {
    PATH: `${mockBin}:${process.env.PATH}`,
    RUNNER_TEMP: runnerTemp,
    TEMP_KEYCHAIN: dummyKc,
    ORIG_KEYCHAINS: "login.keychain-db",
  };

  const cleanRes = spawnSync("bash", ["-c", cleanupScript], { env: cleanEnv, encoding: "utf8" });
  if (cleanRes.status !== 0 || existsSync(dummyKc) || existsSync(dummyP8) || existsSync(dummyP12)) {
    console.error("FAIL: Cleanup failed to remove temporary materials", cleanRes);
    process.exit(1);
  }
  console.log("PASS: Cleanup successfully removed temporary keychain, .p8, and .p12 files (status 0)");

  // Test failed cleanup reports error (not swallowed)
  writeFileSync(dummyKc, "DUMMY_KEYCHAIN");
  const failCleanRes = spawnSync("bash", ["-c", cleanupScript], {
    env: { ...cleanEnv, MOCK_DELETE_KEYCHAIN_FAIL: "1" },
    encoding: "utf8",
  });
  if (failCleanRes.status === 0 || !failCleanRes.stdout.includes("Signing cleanup encountered one or more errors")) {
    console.error("FAIL: Cleanup did not fail closed on delete-keychain error", failCleanRes);
    process.exit(1);
  }
  console.log("PASS: Cleanup correctly failed closed and reported error on keychain failure (status %d)", failCleanRes.status);

} finally {
  rmSync(testScratch, { recursive: true, force: true });
}

console.log("\nALL 24 PROPOSED SIGNING WORKFLOW VALIDATION CHECKS PASSED CLEANLY!");
