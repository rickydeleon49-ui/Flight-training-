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
 * 7. Extracts and executes actual proposed scripts with isolated synthetic stubs using
 *    GitHub Actions actual explicit Bash settings: bash --noprofile --norc -eo pipefail:
 *    - Prerequisite shell check (defense-in-depth)
 *    - Keychain setup, state transfer via task-owned state file, and cleanup under success and failure modes:
 *      * Initial list query failure
 *      * Multi-entry preservation with spaces in path
 *      * Full cleanup and search list restoration
 *      * Cleanup with missing GITHUB_ENV exports
 *      * Partial setup failure recovery
 *      * Keychain deletion failure reporting
 *      * Genuine setup environment-write failure (directory GITHUB_ENV)
 *      * State file removal failure with independent credential removal
 *      * State file read failure with independent credential removal
 *      * Independent credential file removal failure
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

let totalAssertions = 0;
let executableCases = 0;
let structuralChecks = 0;

function recordPass(msg, isExecutable = false) {
  totalAssertions++;
  if (isExecutable) {
    executableCases++;
  } else {
    structuralChecks++;
  }
  console.log(`PASS: ${msg}`);
}

console.log("=== 1. Validating Read-Only Patch Application and Scratch Application ===");
const gitApplyCheck = spawnSync("git", ["apply", "--check", PATCH_FILE], {
  cwd: REPO_ROOT,
  encoding: "utf8",
});
if (gitApplyCheck.status !== 0) {
  console.error("FAIL: git apply --check failed:\n", gitApplyCheck.stderr);
  process.exit(1);
}
recordPass("git apply --check exited 0 cleanly against base release.yml", false);

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
  recordPass("Applied patch matches proposed-release-workflow.yml byte-for-byte", false);
} finally {
  rmSync(scratchDir, { recursive: true, force: true });
}

console.log("\n=== 2. Parsing Proposed Workflow YAML and Validating AST Structure ===");
const proposedYamlContent = readFileSync(PROPOSED_WORKFLOW, "utf8");
let doc;
try {
  doc = YAML.parse(proposedYamlContent);
  recordPass("Proposed workflow parsed cleanly with zero syntax errors", false);
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
recordPass("jobs.build-macos runs on macos-15 and targets macos-signing environment", false);

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
recordPass("jobs.build-macos.if strictly enforces manual dispatch on main before environment/secrets", false);

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
recordPass("Secret containment verified: Apple secrets are isolated exclusively to build-macos", false);

// Verify build-windows configuration
if (windowsJob["runs-on"] !== "windows-latest" || windowsJob.if !== "needs.check.outputs.target == 'all'") {
  console.error("FAIL: Invalid build-windows configuration:", windowsJob);
  process.exit(1);
}
if (windowsJob.environment) {
  console.error("FAIL: build-windows must not specify any environment, got:", windowsJob.environment);
  process.exit(1);
}
recordPass("build-windows is uncredentialed and conditionally gated to target == 'all'", false);

// Find steps in build-macos
const macosSteps = macosJob.steps || [];
const prereqStep = macosSteps.find(s => s.name?.includes("Check macOS signing prerequisites"));
const setupStep = macosSteps.find(s => s.name?.includes("Prepare temporary signing keychain"));
const verifyStep = macosSteps.find(s => s.name?.includes("Verify signature, notarization and staple"));
const uploadStep = macosSteps.find(s => s.uses?.startsWith("actions/upload-artifact"));
const cleanupStep = macosSteps.find(s => s.name?.includes("Clean up temporary signing credentials"));

if (!prereqStep || !setupStep || !verifyStep || !uploadStep || !cleanupStep) {
  console.error("FAIL: Missing required steps in jobs.build-macos");
  process.exit(1);
}

// Step sequencing: Verify before upload
const verifyIdx = macosSteps.indexOf(verifyStep);
const uploadIdx = macosSteps.indexOf(uploadStep);
const cleanupIdx = macosSteps.indexOf(cleanupStep);

if (verifyIdx >= uploadIdx) {
  console.error("FAIL: Verification step must strictly precede upload step!");
  process.exit(1);
}
recordPass("Step sequence strictly enforces Verification BEFORE Artifact Upload", false);

if (cleanupStep.if !== "always()") {
  console.error("FAIL: Cleanup step must have if: always(), got:", cleanupStep.if);
  process.exit(1);
}
recordPass("Cleanup step includes if: always() condition", false);

console.log("\n=== 3. Exercising Prerequisites Check (Shell Defense-in-Depth) ===");
const prereqScript = prereqStep.run;
const prereqScratch = mkdtempSync(join(tmpdir(), "hfd-prereq-"));
const prereqScriptFile = join(prereqScratch, "prereq.sh");
writeFileSync(prereqScriptFile, prereqScript);
chmodSync(prereqScriptFile, 0o755);

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
  const res = spawnSync("/bin/bash", ["--noprofile", "--norc", "-eo", "pipefail", prereqScriptFile], {
    cwd: prereqScratch,
    env,
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

try {
  // Case 1: Tag push event
  const tagRes = runPrereqCheck({ EVENT_NAME: "push" });
  if (tagRes.status === 0 || !tagRes.stdout.includes("Signed macOS release builds are permitted only via manual workflow_dispatch")) {
    console.error("FAIL: Did not reject tag push event", tagRes);
    process.exit(1);
  }
  recordPass(`Correctly rejected push event (status ${tagRes.status})`, true);

  // Case 2: Non-main branch
  const branchRes = runPrereqCheck({ REF_NAME: "feature/unapproved" });
  if (branchRes.status === 0 || !branchRes.stdout.includes("must be dispatched from main branch")) {
    console.error("FAIL: Did not reject non-main branch", branchRes);
    process.exit(1);
  }
  recordPass(`Correctly rejected non-main branch (status ${branchRes.status})`, true);

  // Case 3: Missing certificate
  const noCertRes = runPrereqCheck({ APPLE_CERTIFICATE: "" });
  if (noCertRes.status === 0 || !noCertRes.stdout.includes("APPLE_CERTIFICATE")) {
    console.error("FAIL: Did not reject missing certificate", noCertRes);
    process.exit(1);
  }
  recordPass(`Correctly rejected missing certificate (status ${noCertRes.status})`, true);

  // Case 4: Missing team ID
  const noTeamRes = runPrereqCheck({ APPLE_TEAM_ID: "" });
  if (noTeamRes.status === 0 || !noTeamRes.stdout.includes("APPLE_TEAM_ID")) {
    console.error("FAIL: Did not reject missing team ID", noTeamRes);
    process.exit(1);
  }
  recordPass(`Correctly rejected missing team ID (status ${noTeamRes.status})`, true);

  // Case 5: Missing both API key and Apple ID
  const noAuthRes = runPrereqCheck({ APPLE_API_KEY: "", APPLE_ID: "" });
  if (noAuthRes.status === 0 || !noAuthRes.stdout.includes("Required macOS signing prerequisites are missing")) {
    console.error("FAIL: Did not reject missing notarization authentication", noAuthRes);
    process.exit(1);
  }
  recordPass(`Correctly rejected missing notarization authentication (status ${noAuthRes.status})`, true);

  // Case 6: Valid API key auth
  const validApiRes = runPrereqCheck();
  if (validApiRes.status !== 0) {
    console.error("FAIL: Rejected valid API key configuration", validApiRes);
    process.exit(1);
  }
  recordPass(`Accepted valid API key authentication (status ${validApiRes.status})`, true);

  // Case 7: Valid App-specific password auth
  const validPwdRes = runPrereqCheck({
    APPLE_API_KEY: "",
    APPLE_API_KEY_P8: "",
    APPLE_API_ISSUER: "",
    APPLE_ID: "pilot@example.com",
    APPLE_PASSWORD: "app-spec-password",
  });
  if (validPwdRes.status !== 0) {
    console.error("FAIL: Rejected valid password authentication", validPwdRes);
    process.exit(1);
  }
  recordPass(`Accepted valid app-specific password authentication (status ${validPwdRes.status})`, true);
} finally {
  rmSync(prereqScratch, { recursive: true, force: true });
}

console.log("\n=== 4. Exercising Keychain Setup, State Transfer, and Cleanup Execution ===");
const setupScript = setupStep.run;
const cleanupScript = cleanupStep.run;

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

  function createMocks() {
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

    const mockRm = `#!/bin/bash
for a in "$@"; do
  if [ "$MOCK_FAIL_STATE_RM" = "1" ] && [ "$a" = "$RUNNER_TEMP/hfd-orig-keychains.txt" ]; then
    echo "synthetic state removal denied" >&2
    exit 73
  fi
  if [ "$MOCK_FAIL_AUTH_RM" = "1" ] && [ "$a" = "$RUNNER_TEMP/AuthKey.p8" ]; then
    echo "synthetic authkey removal denied" >&2
    exit 74
  fi
  if [ "$MOCK_FAIL_CERT_RM" = "1" ] && [ "$a" = "$RUNNER_TEMP/cert.p12" ]; then
    echo "synthetic cert removal denied" >&2
    exit 75
  fi
done
exec /bin/rm "$@"
`;
    writeFileSync(join(mockBin, "rm"), mockRm);
    chmodSync(join(mockBin, "rm"), 0o755);
  }

  const setupScriptFile = join(scratch, "setup.sh");
  writeFileSync(setupScriptFile, setupScript);
  chmodSync(setupScriptFile, 0o755);

  const cleanupScriptFile = join(scratch, "cleanup.sh");
  writeFileSync(cleanupScriptFile, cleanupScript);
  chmodSync(cleanupScriptFile, 0o755);

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
    return spawnSync("/bin/bash", ["--noprofile", "--norc", "-eo", "pipefail", setupScriptFile], {
      cwd: scratch,
      env,
      encoding: "utf8",
    });
  }

  function runCleanup(envOverrides = {}) {
    const env = {
      ...process.env,
      PATH: `${mockBin}:${process.env.PATH}`,
      RUNNER_TEMP: runnerTemp,
      GITHUB_ENV: githubEnvFile,
      ...envOverrides,
    };
    return spawnSync("/bin/bash", ["--noprofile", "--norc", "-eo", "pipefail", cleanupScriptFile], {
      cwd: scratch,
      env,
      encoding: "utf8",
    });
  }

  try {
    createMocks();
    testFn({ scratch, runnerTemp, githubEnvFile, searchListLog, runSetup, runCleanup, createMocks });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Case 8: Initial list query failure stops setup immediately before modifying state
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
  recordPass(`Setup halts before modifications on list query failure; cleanup succeeds (status ${setupRes.status})`, true);
});

// Case 9: Successful multi-entry setup with spaces in path
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
  recordPass("Setup captures multi-entry ordered keychains including spaces without invalid GITHUB_ENV lines", true);
});

// Case 10: Successful cleanup and restoration
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
  recordPass("Cleanup accurately restores original search list and removes all task-owned materials (status 0)", true);
});

// Case 11: Cleanup reliability after GITHUB_ENV export failure or missing variables
testKeychainWorkflow("Cleanup with missing GITHUB_ENV", ({ runSetup, runCleanup, runnerTemp }) => {
  runSetup();
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
  recordPass("Cleanup reliably locates task-owned keychain even if environment export failed", true);
});

// Case 12: Partial setup failure (certificate import failure)
testKeychainWorkflow("Partial setup failure during import", ({ runSetup, runCleanup, runnerTemp }) => {
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

  const cleanRes = runCleanup();
  if (cleanRes.status !== 0) {
    console.error("FAIL: Cleanup failed after partial setup failure", cleanRes);
    process.exit(1);
  }
  if (existsSync(tempKc)) {
    console.error("FAIL: Temporary keychain remains after cleanup of partial setup!");
    process.exit(1);
  }
  recordPass("Cleanup successfully handles partial setup failure and removes temporary keychain", true);
});

// Case 13: Cleanup failure reporting (delete-keychain fails)
testKeychainWorkflow("Cleanup failure reporting", ({ runSetup, runCleanup }) => {
  runSetup();
  const cleanRes = runCleanup({ MOCK_DELETE_FAIL: "1" });
  if (cleanRes.status === 0 || !cleanRes.stdout.includes("Signing cleanup encountered one or more errors")) {
    console.error("FAIL: Cleanup should fail closed and report error when delete-keychain fails", cleanRes);
    process.exit(1);
  }
  recordPass(`Cleanup correctly fails closed and reports error when keychain deletion fails (status ${cleanRes.status})`, true);
});

// Case 14: Genuine setup environment-write failure (GITHUB_ENV directory probe)
testKeychainWorkflow("Genuine setup environment-write failure", ({ runSetup, runCleanup, runnerTemp, githubEnvFile }) => {
  rmSync(githubEnvFile);
  mkdirSync(githubEnvFile); // GITHUB_ENV is now a directory, so >> $GITHUB_ENV fails immediately!
  const setupRes = runSetup();
  if (setupRes.status === 0) {
    console.error("FAIL: Setup should fail closed when GITHUB_ENV write fails", setupRes);
    process.exit(1);
  }
  const tempKc = join(runnerTemp, "hfd-signing.keychain-db");
  const authKey = join(runnerTemp, "AuthKey.p8");
  if (existsSync(tempKc) || existsSync(authKey)) {
    console.error("FAIL: Temporary keychain or credentials created despite GITHUB_ENV write failure!");
    process.exit(1);
  }
  const cleanRes = runCleanup();
  if (cleanRes.status !== 0) {
    console.error("FAIL: Cleanup should succeed after genuine environment-write failure", cleanRes);
    process.exit(1);
  }
  recordPass(`Genuine environment-write failure stops setup before keychain creation; cleanup succeeds (status ${setupRes.status})`, true);
});

// Case 15: State-file removal failure allows remaining credential cleanup, records warning, and exits nonzero
testKeychainWorkflow("State file removal failure", ({ runSetup, runCleanup, runnerTemp }) => {
  runSetup();
  const tempKc = join(runnerTemp, "hfd-signing.keychain-db");
  const stateFile = join(runnerTemp, "hfd-orig-keychains.txt");
  const authKey = join(runnerTemp, "AuthKey.p8");
  const cert = join(runnerTemp, "cert.p12");
  writeFileSync(cert, "SYNTHETIC_CERT_LEFTOVER");

  const cleanRes = runCleanup({ MOCK_FAIL_STATE_RM: "1" });
  if (cleanRes.status === 0 || !cleanRes.stdout.includes("Signing cleanup encountered one or more errors")) {
    console.error("FAIL: Cleanup should exit nonzero and report error on state file rm failure", cleanRes);
    process.exit(1);
  }
  if (!cleanRes.stdout.includes("Failed to remove keychain state file")) {
    console.error("FAIL: Missing warning for state file removal failure", cleanRes);
    process.exit(1);
  }
  // Assert exact file outcomes: credentials and keychain removed, state file remained
  if (existsSync(tempKc)) {
    console.error("FAIL: Keychain should have been removed!");
    process.exit(1);
  }
  if (!existsSync(stateFile)) {
    console.error("FAIL: State file should have remained due to mock rm failure!");
    process.exit(1);
  }
  if (existsSync(authKey)) {
    console.error("FAIL: AuthKey.p8 should have been removed despite state rm failure!");
    process.exit(1);
  }
  if (existsSync(cert)) {
    console.error("FAIL: cert.p12 should have been removed despite state rm failure!");
    process.exit(1);
  }
  recordPass(`State file removal failure permits remaining credential removals and exits nonzero (status ${cleanRes.status})`, true);
});

// Case 16: State-file read failure records warning, cleans credentials, and exits nonzero
testKeychainWorkflow("State file read failure", ({ runSetup, runCleanup, runnerTemp }) => {
  runSetup();
  const stateFile = join(runnerTemp, "hfd-orig-keychains.txt");
  const authKey = join(runnerTemp, "AuthKey.p8");
  const cert = join(runnerTemp, "cert.p12");
  writeFileSync(cert, "SYNTHETIC_CERT_LEFTOVER");
  chmodSync(stateFile, 0o000); // make state file unreadable

  const cleanRes = runCleanup();
  if (cleanRes.status === 0 || !cleanRes.stdout.includes("Signing cleanup encountered one or more errors")) {
    console.error("FAIL: Cleanup should exit nonzero on state file read failure", cleanRes);
    process.exit(1);
  }
  if (!cleanRes.stdout.includes("Failed to read keychain state file")) {
    console.error("FAIL: Missing warning for state file read failure", cleanRes);
    process.exit(1);
  }
  if (existsSync(authKey) || existsSync(cert)) {
    console.error("FAIL: Credentials should have been removed despite state read failure!");
    process.exit(1);
  }
  recordPass(`State file read failure records warning, executes remaining cleanup, and exits nonzero (status ${cleanRes.status})`, true);
});

// Case 17: Independent credential removal failure (AuthKey fails, cert.p12 still removed)
testKeychainWorkflow("Independent credential removal failure", ({ runSetup, runCleanup, runnerTemp }) => {
  runSetup();
  const authKey = join(runnerTemp, "AuthKey.p8");
  const cert = join(runnerTemp, "cert.p12");
  writeFileSync(cert, "SYNTHETIC_CERT_LEFTOVER");

  const cleanRes = runCleanup({ MOCK_FAIL_AUTH_RM: "1" });
  if (cleanRes.status === 0 || !cleanRes.stdout.includes("Signing cleanup encountered one or more errors")) {
    console.error("FAIL: Cleanup should exit nonzero on authkey rm failure", cleanRes);
    process.exit(1);
  }
  if (!cleanRes.stdout.includes("Failed to remove AuthKey.p8")) {
    console.error("FAIL: Missing warning for AuthKey removal failure", cleanRes);
    process.exit(1);
  }
  if (!existsSync(authKey)) {
    console.error("FAIL: AuthKey.p8 should remain due to mock rm failure!");
    process.exit(1);
  }
  if (existsSync(cert)) {
    console.error("FAIL: cert.p12 should have been removed despite AuthKey rm failure!");
    process.exit(1);
  }
  recordPass(`Independent credential removal failure preserves remaining cleanup and exits nonzero (status ${cleanRes.status})`, true);
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
if [[ "$*" == *"--verify"* ]]; then
  if [ "$VERIFY_INTEGRITY_FAIL" = "1" ]; then
    echo "code has no resources but signature indicates they must be present" >&2
    exit 1
  fi
  if [ "$DMG_NOT_SIGNED" = "1" ]; then
    echo "code object is not signed at all" >&2
    exit 1
  fi
  exit 0
fi

if [[ "$*" == *"-dv"* ]]; then
  TARGET="\${@: -1}"
  if [[ "$TARGET" == *.dmg ]]; then
    if [ "$DMG_NOT_SIGNED" = "1" ]; then
      echo "code object is not signed at all" >&2
      exit 1
    fi
    echo "Executable=$TARGET" >&2
    echo "Identifier=her-flight-deck-dmg" >&2
    echo "Format=disk image" >&2
    if [ "$DMG_NO_AUTHORITY" != "1" ]; then
      echo "Authority=Developer ID Application: Synthetic Team (${config.dmgTeam || "SYNTH12345"})" >&2
      echo "Authority=Developer ID Certification Authority" >&2
      echo "Authority=Apple Root CA" >&2
    fi
    echo "TeamIdentifier=${config.dmgTeam || "SYNTH12345"}" >&2
    if [ "$DMG_NO_TIMESTAMP" != "1" ]; then
      echo "Timestamp=Oct 4, 2026 at 1:00:00 PM" >&2
    fi
    exit 0
  fi

  if [[ "$TARGET" == *.app* ]]; then
    if [ "$APP_NO_AUTHORITY" = "1" ]; then
      echo "Identifier=com.herflightdeck.app" >&2
      echo "TeamIdentifier=not set" >&2
      exit 0
    fi
    echo "Executable=$TARGET/Contents/MacOS/her-flight-deck" >&2
    echo "Identifier=${config.appIdentifier || "com.herflightdeck.app"}" >&2
    echo "Format=app bundle with Mach-O thin (arm64)" >&2
    echo "Authority=Developer ID Application: Synthetic Team (${config.appTeam || "SYNTH12345"})" >&2
    echo "Authority=Developer ID Certification Authority" >&2
    echo "Authority=Apple Root CA" >&2
    if [ "$APP_NO_TIMESTAMP" != "1" ]; then
      echo "Timestamp=Oct 4, 2026 at 1:00:00 PM" >&2
    fi
    echo "TeamIdentifier=${config.appTeam || "SYNTH12345"}" >&2
    if [ "$APP_NO_HARDENED" != "1" ]; then
      echo "CodeDirectory v=20500 size=800 flags=0x10000(runtime) hashes=10+5 location=embedded" >&2
    else
      echo "CodeDirectory v=20500 size=800 flags=0x0(none) hashes=10+5 location=embedded" >&2
    fi
    exit 0
  fi
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
    writeFileSync(join(mockBin, "stapler"), staplerScript);
    chmodSync(join(mockBin, "stapler"), 0o755);

    // xcrun mock
    const xcrunScript = `#!/bin/bash
CMD="$1"
shift
if [ "$CMD" = "stapler" ]; then
  exec stapler "$@"
fi
exec /usr/bin/xcrun "$CMD" "$@"
`;
    writeFileSync(join(mockBin, "xcrun"), xcrunScript);
    chmodSync(join(mockBin, "xcrun"), 0o755);

    // hdiutil mock
    const hdiutilScript = `#!/bin/bash
CMD="$1"
shift
if [ "$CMD" = "attach" ]; then
  # Find mountpoint arg
  while [ $# -gt 0 ]; do
    if [ "$1" = "-mountpoint" ]; then
      MNT="$2"
      mkdir -p "$MNT"
      cp -R "${testScratch}/mounted-app/Her Flight Deck.app" "$MNT/"
      exit 0
    fi
    shift
  done
fi
if [ "$CMD" = "detach" ]; then
  exit 0
fi
exit 0
`;
    writeFileSync(join(mockBin, "hdiutil"), hdiutilScript);
    chmodSync(join(mockBin, "hdiutil"), 0o755);

    // file mock
    const fileScript = `#!/bin/bash
if [ "$FILE_NOT_ARM64" = "1" ]; then
  echo "$1: Mach-O 64-bit x86_64 executable"
  exit 0
fi
echo "$1: Mach-O 64-bit arm64 executable"
exit 0
`;
    writeFileSync(join(mockBin, "file"), fileScript);
    chmodSync(join(mockBin, "file"), 0o755);

    // plutil mock
    const plutilScript = `#!/bin/bash
KEY="$2"
if [ "$KEY" = "CFBundleIdentifier" ]; then
  echo "${config.bundleId || "com.herflightdeck.app"}"
  exit 0
fi
if [ "$KEY" = "CFBundleShortVersionString" ]; then
  echo "${config.bundleVersion || "0.5.3"}"
  exit 0
fi
if [ "$KEY" = "LSMinimumSystemVersion" ]; then
  echo "${config.bundleMinOs || "12.0"}"
  exit 0
fi
exit 0
`;
    writeFileSync(join(mockBin, "plutil"), plutilScript);
    chmodSync(join(mockBin, "plutil"), 0o755);

    // spctl mock
    const spctlScript = `#!/bin/bash
if [ "$SPCTL_FAIL" = "1" ]; then
  echo "$1: rejected" >&2
  exit 1
fi
echo "$1: accepted"
echo "source=Notarized Developer ID"
exit 0
`;
    writeFileSync(join(mockBin, "spctl"), spctlScript);
    chmodSync(join(mockBin, "spctl"), 0o755);
  }

  const verifyScript = verifyStep.run;
  const verifyScriptFile = join(testScratch, "verify.sh");
  writeFileSync(verifyScriptFile, verifyScript);
  chmodSync(verifyScriptFile, 0o755);

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
    const res = spawnSync("/bin/bash", ["--noprofile", "--norc", "-eo", "pipefail", verifyScriptFile], {
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
  recordPass(`Correctly rejected unsigned DMG container (status ${probeDmgUnsigned.status})`, true);

  // Probe 2: DMG missing Developer ID authority
  const probeDmgNoAuth = runVerifyCheck({ DMG_NO_AUTHORITY: "1" });
  if (probeDmgNoAuth.status === 0 || !probeDmgNoAuth.stdout.includes("DMG container lacks Developer ID Application")) {
    console.error("FAIL: Did not reject DMG with missing Developer ID authority", probeDmgNoAuth);
    process.exit(1);
  }
  recordPass(`Correctly rejected DMG container without Developer ID authority (status ${probeDmgNoAuth.status})`, true);

  // Probe 3: DMG wrong team ID
  const probeDmgWrongTeam = runVerifyCheck({}, { dmgTeam: "WRONGTEAM" });
  if (probeDmgWrongTeam.status === 0 || !probeDmgWrongTeam.stdout.includes("DMG container TeamIdentifier does not match")) {
    console.error("FAIL: Did not reject DMG container with wrong team", probeDmgWrongTeam);
    process.exit(1);
  }
  recordPass(`Correctly rejected DMG container with wrong team ID (status ${probeDmgWrongTeam.status})`, true);

  // Probe 4: DMG missing timestamp
  const probeDmgNoTs = runVerifyCheck({ DMG_NO_TIMESTAMP: "1" });
  if (probeDmgNoTs.status === 0 || !probeDmgNoTs.stdout.includes("DMG container lacks secure timestamp")) {
    console.error("FAIL: Did not reject DMG lacking secure timestamp", probeDmgNoTs);
    process.exit(1);
  }
  recordPass(`Correctly rejected DMG container lacking secure timestamp (status ${probeDmgNoTs.status})`, true);

  // Probe 5: Stapler validation failure
  const probeStaplerFail = runVerifyCheck({ STAPLER_FAIL: "1" });
  if (probeStaplerFail.status === 0 || !probeStaplerFail.stderr.includes("The validate action failed")) {
    console.error("FAIL: Did not reject failing stapler validation", probeStaplerFail);
    process.exit(1);
  }
  recordPass(`Correctly rejected failing stapler validation (status ${probeStaplerFail.status})`, true);

  // Probe 6: Non-arm64 executable
  const probeNotArm = runVerifyCheck({ FILE_NOT_ARM64: "1" });
  if (probeNotArm.status === 0 || !probeNotArm.stdout.includes("is not arm64")) {
    console.error("FAIL: Did not reject non-arm64 executable", probeNotArm);
    process.exit(1);
  }
  recordPass(`Correctly rejected non-arm64 executable (status ${probeNotArm.status})`, true);

  // Probe 7: Wrong bundle identifier
  const probeWrongBundle = runVerifyCheck({}, { bundleId: "com.malicious.app" });
  if (probeWrongBundle.status === 0 || !probeWrongBundle.stdout.includes("does not match 'com.herflightdeck.app'")) {
    console.error("FAIL: Did not reject wrong bundle identifier", probeWrongBundle);
    process.exit(1);
  }
  recordPass(`Correctly rejected wrong bundle identifier (status ${probeWrongBundle.status})`, true);

  // Probe 8: Strict verification failure
  const probeVerifyFail = runVerifyCheck({ VERIFY_INTEGRITY_FAIL: "1" });
  if (probeVerifyFail.status === 0 || !probeVerifyFail.stderr.includes("code has no resources but signature indicates they must be present")) {
    console.error("FAIL: Did not reject app failing strict codesign verification", probeVerifyFail);
    process.exit(1);
  }
  recordPass(`Correctly rejected app failing strict integrity check (status ${probeVerifyFail.status})`, true);

  // Probe 9: App lacking Developer ID authority
  const probeAppNoAuth = runVerifyCheck({ APP_NO_AUTHORITY: "1" });
  if (probeAppNoAuth.status === 0 || !probeAppNoAuth.stdout.includes("App bundle lacks Developer ID Application")) {
    console.error("FAIL: Did not reject app bundle lacking Developer ID authority", probeAppNoAuth);
    process.exit(1);
  }
  recordPass(`Correctly rejected app lacking Developer ID authority (status ${probeAppNoAuth.status})`, true);

  // Probe 10: App with WRONGTEAM
  const probeAppWrongTeam = runVerifyCheck({}, { appTeam: "WRONGTEAM" });
  if (probeAppWrongTeam.status === 0 || !probeAppWrongTeam.stdout.includes("App bundle TeamIdentifier does not match")) {
    console.error("FAIL: Did not reject app bundle with wrong team", probeAppWrongTeam);
    process.exit(1);
  }
  recordPass(`Correctly rejected app with WRONGTEAM (status ${probeAppWrongTeam.status})`, true);

  // Probe 11: App with mismatched signing identifier
  const probeAppWrongId = runVerifyCheck({}, { appIdentifier: "her_flight_deck_compromised" });
  if (probeAppWrongId.status === 0 || !probeAppWrongId.stdout.includes("App signing identifier does not match")) {
    console.error("FAIL: Did not reject app with mismatched identifier", probeAppWrongId);
    process.exit(1);
  }
  recordPass(`Correctly rejected app with mismatched signing identifier (status ${probeAppWrongId.status})`, true);

  // Probe 12: App lacking hardened runtime
  const probeAppNoHardened = runVerifyCheck({ APP_NO_HARDENED: "1" });
  if (probeAppNoHardened.status === 0 || !probeAppNoHardened.stdout.includes("App bundle lacks hardened runtime")) {
    console.error("FAIL: Did not reject app lacking hardened runtime", probeAppNoHardened);
    process.exit(1);
  }
  recordPass(`Correctly rejected app lacking hardened runtime (status ${probeAppNoHardened.status})`, true);

  // Probe 13: App lacking secure timestamp
  const probeAppNoTs = runVerifyCheck({ APP_NO_TIMESTAMP: "1" });
  if (probeAppNoTs.status === 0 || !probeAppNoTs.stdout.includes("App bundle lacks secure timestamp")) {
    console.error("FAIL: Did not reject app lacking secure timestamp", probeAppNoTs);
    process.exit(1);
  }
  recordPass(`Correctly rejected app lacking secure timestamp (status ${probeAppNoTs.status})`, true);

  // Probe 14: Gatekeeper assessment rejected
  const probeSpctlFail = runVerifyCheck({ SPCTL_FAIL: "1" });
  if (probeSpctlFail.status === 0) {
    console.error("FAIL: Did not reject app failing Gatekeeper spctl assessment", probeSpctlFail);
    process.exit(1);
  }
  recordPass(`Correctly rejected app failing Gatekeeper spctl assessment (status ${probeSpctlFail.status})`, true);

  // Probe 15: Valid synthetic success path
  const probeValid = runVerifyCheck();
  if (probeValid.status !== 0) {
    console.error("FAIL: Valid synthetic success path failed", probeValid);
    process.exit(1);
  }
  recordPass(`Valid synthetic success path passed all container and app checks (status ${probeValid.status})`, true);

} finally {
  rmSync(testScratch, { recursive: true, force: true });
}

console.log(`\nALL ${totalAssertions} PROPOSED SIGNING WORKFLOW VALIDATION CHECKS PASSED CLEANLY! (${executableCases} executable behavior cases, ${structuralChecks} structural/ordering checks)`);
