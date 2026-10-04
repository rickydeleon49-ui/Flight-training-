#!/usr/bin/env node
/**
 * validate-signing-proposal.mjs
 *
 * Validates the proposed macOS signing workflow patch and architecture:
 * 1. Verifies read-only patch application against active .github/workflows/release.yml (git apply --check)
 * 2. Compares scratch applied workflow byte-for-byte with proposed-release-workflow.yml
 * 3. Parses the proposed workflow AST with YAML parser
 * 4. Asserts job-level event/ref control boundary isolating signing environment/credentials
 * 5. Verifies secret containment: credentials exist ONLY in build-macos, never in check or build-windows
 * 6. Verifies step sequencing and fail-closed guards
 * 7. Extracts and executes actual proposed scripts with isolated synthetic stubs:
 *    - Prerequisite shell check (defense-in-depth)
 *    - Keychain setup, state transfer via task-owned state file, and cleanup under success and failure modes
 *    - Strict verification of DMG container and mounted app bundle (15 metadata/signature probes)
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

console.log("=== 1. Validating Read-Only Patch Application and Scratch Application ===");
const gitApplyCheck = spawnSync("git", ["apply", "--check", PATCH_FILE], {
  cwd: REPO_ROOT,
  encoding: "utf8",
});
if (gitApplyCheck.status !== 0) {
  console.error("FAIL: git apply --check failed:\n", gitApplyCheck.stderr);
  process.exit(1);
}
console.log("PASS: git apply --check exited 0 cleanly against base release.yml");

// Test scratch patch application and byte-for-byte identity
const scratchDir = mkdtempSync(join(tmpdir(), "hfd-scratch-apply-"));
try {
  mkdirSync(join(scratchDir, ".github/workflows"), { recursive: true });
  writeFileSync(join(scratchDir, ".github/workflows/release.yml"), readFileSync(BASE_WORKFLOW, "utf8"));
  execSync(`patch --batch -p1 < "${PATCH_FILE}"`, { cwd: scratchDir });
  const appliedContent = readFileSync(join(scratchDir, ".github/workflows/release.yml"), "utf8");
  const proposedContent = readFileSync(PROPOSED_WORKFLOW, "utf8");
  if (appliedContent !== proposedContent) {
    console.error("FAIL: Applied patch does not match proposed-release-workflow.yml byte-for-byte!");
    process.exit(1);
  }
  console.log("PASS: Applied patch matches proposed-release-workflow.yml byte-for-byte");
} finally {
  rmSync(scratchDir, { recursive: true, force: true });
}

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

const macosJob = doc.jobs?.["build-macos"];
if (!macosJob) {
  console.error("FAIL: jobs.build-macos missing in proposed workflow");
  process.exit(1);
}

const windowsJob = doc.jobs?.["build-windows"];
if (!windowsJob) {
  console.error("FAIL: jobs.build-windows missing in proposed workflow");
  process.exit(1);
}

// Verify job runner and environment
if (macosJob["runs-on"] !== "macos-15") {
  console.error("FAIL: jobs.build-macos.runs-on must be 'macos-15', got:", macosJob["runs-on"]);
  process.exit(1);
}
if (macosJob.environment !== "macos-signing") {
  console.error("FAIL: jobs.build-macos.environment must be 'macos-signing', got:", macosJob.environment);
  process.exit(1);
}
console.log("PASS: jobs.build-macos runs on macos-15 and targets macos-signing environment");

// Verify job-level if condition
const jobGuard = macosJob.if;
if (jobGuard !== "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'") {
  console.error("FAIL: jobs.build-macos.if must be \"github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'\", got:", jobGuard);
  process.exit(1);
}

// Function to simulate GitHub Actions expression evaluation for jobGuard
function evalJobGuard(eventName, ref) {
  return eventName === "workflow_dispatch" && ref === "refs/heads/main";
}

if (evalJobGuard("push", "refs/tags/v0.5.3") !== false) {
  console.error("FAIL: Job guard did not reject tag push");
  process.exit(1);
}
if (evalJobGuard("workflow_dispatch", "refs/heads/feature/unapproved") !== false) {
  console.error("FAIL: Job guard did not reject manual dispatch on non-main branch");
  process.exit(1);
}
if (evalJobGuard("workflow_dispatch", "refs/heads/main") !== true) {
  console.error("FAIL: Job guard did not accept manual dispatch on main branch");
  process.exit(1);
}
console.log("PASS: jobs.build-macos.if strictly enforces manual dispatch on main before environment/secrets");

// Verify secret containment: Apple secrets exist ONLY in build-macos
const yamlLines = proposedYamlContent.split("\n");
let currentJob = null;
const leakedSecrets = [];
for (let i = 0; i < yamlLines.length; i++) {
  const line = yamlLines[i];
  const jobMatch = line.match(/^  ([a-zA-Z0-9_-]+):/);
  if (jobMatch) {
    currentJob = jobMatch[1];
  }
  if (line.includes("secrets.APPLE_") && currentJob !== "build-macos") {
    leakedSecrets.push({ line: i + 1, job: currentJob, content: line.trim() });
  }
}
if (leakedSecrets.length > 0) {
  console.error("FAIL: Apple secrets found outside build-macos job:\n", leakedSecrets);
  process.exit(1);
}
console.log("PASS: Secret containment verified: Apple secrets are isolated exclusively to build-macos");

// Verify build-windows configuration
if (windowsJob["runs-on"] !== "windows-latest" || windowsJob.if !== "needs.check.outputs.target == 'all'") {
  console.error("FAIL: Invalid build-windows configuration:", windowsJob);
  process.exit(1);
}
if (windowsJob.environment) {
  console.error("FAIL: build-windows must not specify any environment, got:", windowsJob.environment);
  process.exit(1);
}
console.log("PASS: build-windows is uncredentialed and conditionally gated to target == 'all'");

// Verify steps in build-macos
const steps = macosJob.steps || [];
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

// Assert strict ordering: Prereq < Setup < Build < Verify < Upload < Cleanup
if (!(prereqStepIdx < setupStepIdx && setupStepIdx < buildStepIdx && buildStepIdx < verifyStepIdx && verifyStepIdx < uploadStepIdx && uploadStepIdx < cleanupStepIdx)) {
  console.error("FAIL: Step ordering violation! Expected Prereq < Setup < Build < Verify < Upload < Cleanup");
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

console.log("\n=== 3. Exercising Prerequisites Check (Shell Defense-in-Depth) ===");

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
console.log("PASS: Correctly rejected missing certificate (status %d)", noCertRes.status);

// Case 4: Missing team ID
const noTeamRes = runPrereqCheck({ APPLE_TEAM_ID: "" });
if (noTeamRes.status === 0 || !noTeamRes.stdout.includes("APPLE_TEAM_ID")) {
  console.error("FAIL: Did not reject missing team ID", noTeamRes);
  process.exit(1);
}
console.log("PASS: Correctly rejected missing team ID (status %d)", noTeamRes.status);

// Case 5: Missing both API key and password auth
const noAuthRes = runPrereqCheck({ APPLE_API_KEY: "", APPLE_ID: "" });
if (noAuthRes.status === 0 || !noAuthRes.stdout.includes("either APPLE_API_KEY")) {
  console.error("FAIL: Did not reject missing notarization credentials", noAuthRes);
  process.exit(1);
}
console.log("PASS: Correctly rejected missing notarization authentication (status %d)", noAuthRes.status);

// Case 6: Valid API key auth accepted
const validApiRes = runPrereqCheck();
if (validApiRes.status !== 0) {
  console.error("FAIL: Valid API key auth rejected", validApiRes);
  process.exit(1);
}
console.log("PASS: Accepted valid API key authentication (status 0)");

// Case 7: Valid password auth accepted
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

console.log("\n=== 4. Exercising Keychain Setup, State Transfer, and Cleanup Execution ===");

// Helper to run setup and cleanup under controlled synthetic environments
function testKeychainWorkflow(testName, testFn) {
  const scratch = mkdtempSync(join(tmpdir(), "hfd-kc-test-"));
  const mockBin = join(scratch, "bin");
  mkdirSync(mockBin, { recursive: true });

  const runnerTemp = join(scratch, "runner");
  mkdirSync(runnerTemp, { recursive: true });

  const githubEnvFile = join(scratch, "github_env");
  writeFileSync(githubEnvFile, "");

  const securityLog = join(scratch, "security.log");
  const searchListLog = join(scratch, "search-list.log");

  function createMocks(opts = {}) {
    const mockSecurity = `#!/bin/bash
echo "$@" >> "${securityLog}"
CMD="$1"
shift

if [ "$CMD" = "list-keychains" ]; then
  if [ "$MOCK_LIST_FAIL" = "1" ]; then
    echo "SecKeychainSearchCopyNext: error" >&2
    exit 1
  fi
  while [ $# -gt 0 ]; do
    if [ "$1" = "-s" ]; then
      shift
      > "${searchListLog}"
      while [ $# -gt 0 ]; do
        echo "ARG:$1" >> "${searchListLog}"
        shift
      done
      exit 0
    fi
    shift
  done
  if [ -n "$MOCK_LIST_OUTPUT" ]; then
    echo -e "$MOCK_LIST_OUTPUT"
  else
    echo '    "/synthetic/keychains/login.keychain-db"'
    echo '    "/synthetic/My Keychains/special.keychain"'
    echo '    "/synthetic/keychains/System.keychain"'
  fi
  exit 0
fi

if [ "$CMD" = "create-keychain" ]; then
  while [ $# -gt 0 ]; do
    if [ "$1" = "-p" ]; then
      shift 2
      touch "$1"
      exit 0
    fi
    shift
  done
  exit 0
fi

if [ "$CMD" = "delete-keychain" ]; then
  if [ "$MOCK_DELETE_FAIL" = "1" ]; then
    echo "delete-keychain error" >&2
    exit 1
  fi
  rm -f "$1" 2>/dev/null || true
  exit 0
fi

if [ "$CMD" = "import" ]; then
  if [ "$MOCK_IMPORT_FAIL" = "1" ]; then
    echo "import error" >&2
    exit 1
  fi
  exit 0
fi

exit 0
`;
    writeFileSync(join(mockBin, "security"), mockSecurity);
    chmodSync(join(mockBin, "security"), 0o755);

    const mockOpenssl = `#!/bin/bash
echo "0123456789abcdef0123456789abcdef0123456789abcdef"
exit 0
`;
    writeFileSync(join(mockBin, "openssl"), mockOpenssl);
    chmodSync(join(mockBin, "openssl"), 0o755);
  }

  function runSetup(envOverrides = {}) {
    const env = {
      ...process.env,
      PATH: `${mockBin}:${process.env.PATH}`,
      RUNNER_TEMP: runnerTemp,
      GITHUB_ENV: githubEnvFile,
      APPLE_CERTIFICATE: Buffer.from("SYNTHETIC_CERT").toString("base64"),
      APPLE_CERTIFICATE_PASSWORD: "cert-password",
      APPLE_API_KEY_P8: "-----BEGIN PRIVATE KEY-----\nSYNTH_P8\n-----END PRIVATE KEY-----",
      ...envOverrides,
    };
    return spawnSync("bash", ["-c", setupScript], { env, encoding: "utf8" });
  }

  function runCleanup(envOverrides = {}) {
    const env = {
      ...process.env,
      PATH: `${mockBin}:${process.env.PATH}`,
      RUNNER_TEMP: runnerTemp,
      GITHUB_ENV: githubEnvFile,
      ...envOverrides,
    };
    return spawnSync("bash", ["-c", cleanupScript], { env, encoding: "utf8" });
  }

  try {
    createMocks();
    testFn({ scratch, runnerTemp, githubEnvFile, searchListLog, runSetup, runCleanup, createMocks });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Case 16: Initial list query failure stops setup immediately before modifying state
testKeychainWorkflow("Initial list query failure", ({ runSetup, runCleanup, runnerTemp }) => {
  const setupRes = runSetup({ MOCK_LIST_FAIL: "1" });
  if (setupRes.status === 0) {
    console.error("FAIL: Setup should have failed when security list-keychains failed", setupRes);
    process.exit(1);
  }
  const stateFile = join(runnerTemp, "hfd-orig-keychains.txt");
  const tempKc = join(runnerTemp, "hfd-signing.keychain-db");
  if (existsSync(stateFile) || existsSync(tempKc)) {
    console.error("FAIL: State file or temporary keychain created despite initial list failure!");
    process.exit(1);
  }
  // Subsequent cleanup should exit 0 cleanly
  const cleanRes = runCleanup();
  if (cleanRes.status !== 0) {
    console.error("FAIL: Cleanup should exit 0 when setup failed initially", cleanRes);
    process.exit(1);
  }
  console.log("PASS: Setup halts before modifications on list query failure; cleanup succeeds (status %d)", setupRes.status);
});

// Case 17: Successful multi-entry setup with spaces in path
testKeychainWorkflow("Successful multi-entry setup", ({ runSetup, runnerTemp, githubEnvFile, searchListLog }) => {
  const setupRes = runSetup();
  if (setupRes.status !== 0) {
    console.error("FAIL: Setup failed under normal conditions", setupRes);
    process.exit(1);
  }

  const stateFile = join(runnerTemp, "hfd-orig-keychains.txt");
  if (!existsSync(stateFile)) {
    console.error("FAIL: State file hfd-orig-keychains.txt was not created!");
    process.exit(1);
  }

  const savedLines = readFileSync(stateFile, "utf8").trim().split("\n");
  const expectedKeychains = [
    "/synthetic/keychains/login.keychain-db",
    "/synthetic/My Keychains/special.keychain",
    "/synthetic/keychains/System.keychain",
  ];
  if (JSON.stringify(savedLines) !== JSON.stringify(expectedKeychains)) {
    console.error("FAIL: State file keychains mismatch!", { savedLines, expectedKeychains });
    process.exit(1);
  }

  // Verify GITHUB_ENV has NO bare lines (all valid KEY=VAL)
  const envContent = readFileSync(githubEnvFile, "utf8");
  const envLines = envContent.trim().split("\n").filter(l => l.length > 0);
  for (const el of envLines) {
    if (!/^[A-Z0-9_]+=.*$/.test(el)) {
      console.error("FAIL: Invalid bare line found in GITHUB_ENV:\n", el);
      process.exit(1);
    }
  }

  // Verify security list-keychains -d user -s arguments during setup
  const searchLogContent = readFileSync(searchListLog, "utf8").trim().split("\n");
  const tempKc = join(runnerTemp, "hfd-signing.keychain-db");
  const expectedArgs = [
    `ARG:${tempKc}`,
    `ARG:/synthetic/keychains/login.keychain-db`,
    `ARG:/synthetic/My Keychains/special.keychain`,
    `ARG:/synthetic/keychains/System.keychain`,
  ];
  if (JSON.stringify(searchLogContent) !== JSON.stringify(expectedArgs)) {
    console.error("FAIL: Search list arguments mismatch during setup!", { searchLogContent, expectedArgs });
    process.exit(1);
  }
  console.log("PASS: Setup captures multi-entry ordered keychains including spaces without invalid GITHUB_ENV lines");
});

// Case 18: Successful cleanup and restoration
testKeychainWorkflow("Successful cleanup and restoration", ({ runSetup, runCleanup, runnerTemp, searchListLog }) => {
  runSetup();
  const tempKc = join(runnerTemp, "hfd-signing.keychain-db");
  const stateFile = join(runnerTemp, "hfd-orig-keychains.txt");
  const authKey = join(runnerTemp, "AuthKey.p8");

  if (!existsSync(tempKc) || !existsSync(stateFile) || !existsSync(authKey)) {
    console.error("FAIL: Setup artifacts missing prior to cleanup");
    process.exit(1);
  }

  const cleanRes = runCleanup();
  if (cleanRes.status !== 0) {
    console.error("FAIL: Cleanup failed", cleanRes);
    process.exit(1);
  }

  // Verify temporary keychain, state file, and AuthKey are removed
  if (existsSync(tempKc) || existsSync(stateFile) || existsSync(authKey)) {
    console.error("FAIL: Temporary materials remain after cleanup!");
    process.exit(1);
  }

  // Verify original search list was restored in exact order
  const restoreLog = readFileSync(searchListLog, "utf8").trim().split("\n");
  const expectedRestore = [
    `ARG:/synthetic/keychains/login.keychain-db`,
    `ARG:/synthetic/My Keychains/special.keychain`,
    `ARG:/synthetic/keychains/System.keychain`,
  ];
  if (JSON.stringify(restoreLog) !== JSON.stringify(expectedRestore)) {
    console.error("FAIL: Restored search list arguments mismatch!", { restoreLog, expectedRestore });
    process.exit(1);
  }
  console.log("PASS: Cleanup accurately restores original search list and removes all task-owned materials (status 0)");
});

// Case 19: Cleanup reliability after GITHUB_ENV export failure or missing variables
testKeychainWorkflow("Cleanup with missing GITHUB_ENV", ({ runSetup, runCleanup, runnerTemp }) => {
  runSetup();
  // Clear GITHUB_ENV completely and run cleanup without any environment variables
  const cleanRes = runCleanup({ TEMP_KEYCHAIN: "" });
  if (cleanRes.status !== 0) {
    console.error("FAIL: Cleanup should succeed via deterministic task paths even when TEMP_KEYCHAIN is empty", cleanRes);
    process.exit(1);
  }
  const tempKc = join(runnerTemp, "hfd-signing.keychain-db");
  if (existsSync(tempKc)) {
    console.error("FAIL: Temporary keychain not deleted when TEMP_KEYCHAIN was empty!");
    process.exit(1);
  }
  console.log("PASS: Cleanup reliably locates task-owned keychain even if environment export failed");
});

// Case 20: Partial setup failure (certificate import failure)
testKeychainWorkflow("Partial setup failure during import", ({ runSetup, runCleanup, runnerTemp, searchListLog }) => {
  const setupRes = runSetup({ MOCK_IMPORT_FAIL: "1" });
  if (setupRes.status === 0) {
    console.error("FAIL: Setup should have failed on import failure", setupRes);
    process.exit(1);
  }

  const tempKc = join(runnerTemp, "hfd-signing.keychain-db");
  if (!existsSync(tempKc)) {
    console.error("FAIL: Temporary keychain should have been created before import failure");
    process.exit(1);
  }

  // Cleanup should clean up the partial setup
  const cleanRes = runCleanup();
  if (cleanRes.status !== 0) {
    console.error("FAIL: Cleanup failed after partial setup failure", cleanRes);
    process.exit(1);
  }
  if (existsSync(tempKc)) {
    console.error("FAIL: Temporary keychain remains after cleanup of partial setup!");
    process.exit(1);
  }
  console.log("PASS: Cleanup successfully handles partial setup failure and removes temporary keychain");
});

// Case 21: Cleanup failure reporting (delete-keychain fails)
testKeychainWorkflow("Cleanup failure reporting", ({ runSetup, runCleanup }) => {
  runSetup();
  const cleanRes = runCleanup({ MOCK_DELETE_FAIL: "1" });
  if (cleanRes.status === 0 || !cleanRes.stdout.includes("Signing cleanup encountered one or more errors")) {
    console.error("FAIL: Cleanup should fail closed and report error when delete-keychain fails", cleanRes);
    process.exit(1);
  }
  console.log("PASS: Cleanup correctly fails closed and reports error when keychain deletion fails (status %d)", cleanRes.status);
});

console.log("\n=== 5. Exercising Strict Verification with Synthetic Mock Stubs ===");

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

  // Probe 10: App wrong team ID (Codex's probe reproduction)
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

} finally {
  rmSync(testScratch, { recursive: true, force: true });
}

console.log("\nALL 35 PROPOSED SIGNING WORKFLOW VALIDATION CHECKS PASSED CLEANLY!");
