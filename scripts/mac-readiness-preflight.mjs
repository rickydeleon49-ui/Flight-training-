#!/usr/bin/env node
/**
 * Read-only Mac readiness preflight for Her Flight Deck.
 *
 * Reports what this checkout configures, what this Mac provides and, only for
 * an artifact path you pass explicitly, what that artifact is. It never builds,
 * mounts, installs, launches, signs, notarizes, changes a keychain or account,
 * triggers CI, or contacts a provider. Local signature verification
 * (`codesign --verify`) only reads. Optional Gatekeeper/stapler assessment of a
 * supplied artifact runs only with --assess, because macOS may perform Apple's
 * online notarization lookup during it.
 *
 * Public output uses fixed categories, never raw command output: certificate
 * holders, assessment sources, identifiers and paths are mapped to known values
 * or reported as "unknown" / "differs-from-expected" / "not recorded".
 *
 * A generated report is not a readiness verdict: account isolation, signing
 * decisions and every installed smoke check remain USER_ACTION or UNVERIFIED
 * until they are recorded through docs/MAC_INSTALLED_READINESS_PREPARATION_2026-10-03.md.
 *
 * Usage: node scripts/mac-readiness-preflight.mjs [options]   (see --help)
 * Reference: docs/MAC_READINESS_PREFLIGHT.md
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA = "hfd-mac-readiness-preflight/2";
export const STATUSES = ["PASS", "FAIL", "UNVERIFIED", "USER_ACTION"];
export const EXIT = { NO_FAIL: 0, HAS_FAIL: 1, USAGE: 2 };
export const EXPECTED_IDENTIFIER = "com.herflightdeck.app";
export const DEFAULT_SDK = "/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk";
/** SDK versions with recorded evidence for this project's native build (MAC_SMOKE_RESULTS_2026-10-02.md). */
export const EVIDENCED_SDK_VERSIONS = ["26.5"];
/** SDK versions recorded as failing this project's native build (default 27.0: TAPI link failure, 2 Oct 2026). */
export const KNOWN_INCOMPATIBLE_SDK_VERSIONS = ["27.0"];
export const COMMAND_TIMEOUT_MS = 10_000;
export const COMMAND_MAX_BYTES = 64 * 1024;

/** Artifact identities already recorded in the repository (never rebuilt or replaced here). */
export const KNOWN_ARTIFACTS = [
  {
    label: "frozen-private-v0.5.3-draft",
    fileName: "Her.Flight.Deck_0.5.3_aarch64.dmg",
    bytes: 4_511_142,
    sha256: "de81be50122275104ca9e6791162a7bac6cd43a672c5580d5fbc509b5d16efec",
  },
  {
    label: "local-source-evaluation-2026-10-02",
    fileName: "Her Flight Deck_0.5.3_aarch64.dmg",
    bytes: 4_525_420,
    sha256: "e50975dce2db564a3623209c8e73f124fbc0c0ebc6010e7df5cf7c435a05eb37",
  },
];

/** System tools looked up at fixed paths (no PATH search, no execution for presence). */
const SYSTEM_TOOLS = {
  sw_vers: "/usr/bin/sw_vers",
  uname: "/usr/bin/uname",
  sysctl: "/usr/sbin/sysctl",
  "xcode-select": "/usr/bin/xcode-select",
  xcrun: "/usr/bin/xcrun",
  codesign: "/usr/bin/codesign",
  spctl: "/usr/sbin/spctl",
  stapler: "/usr/bin/stapler",
  plutil: "/usr/bin/plutil",
  lipo: "/usr/bin/lipo",
  hdiutil: "/usr/bin/hdiutil",
  shasum: "/usr/bin/shasum",
  git: "/usr/bin/git",
};

/* ----------------------------------------------------------------------------------------- */
/* Fixed public categories (READINESS-R3). Anything else becomes "unknown".                    */
/* ----------------------------------------------------------------------------------------- */

/** Certificate authority lines: leaf names keep only their kind, never the holder. */
const AUTHORITY_CATEGORIES = [
  [/^Developer ID Application: /, "developer-id-application"],
  [/^Developer ID Installer: /, "developer-id-installer"],
  [/^Apple Development: /, "apple-development"],
  [/^Apple Distribution: /, "apple-distribution"],
  [/^Developer ID Certification Authority$/, "developer-id-certification-authority"],
  [/^Apple Root CA$/, "apple-root-ca"],
  [/^Apple Code Signing Certification Authority$/, "apple-code-signing-certification-authority"],
  [/^Apple Worldwide Developer Relations Certification Authority$/, "apple-wwdr-certification-authority"],
  [/^Software Signing$/, "apple-software-signing"],
];
/** `spctl` source= values. */
const ASSESSMENT_SOURCES = {
  "Notarized Developer ID": "notarized-developer-id",
  "Developer ID": "developer-id",
  "Unnotarized Developer ID": "unnotarized-developer-id",
  "no usable signature": "no-usable-signature",
  "Apple System": "apple-system",
  "Mac App Store": "mac-app-store",
};
const KNOWN_FLAGS = new Set(["adhoc", "linker-signed", "runtime", "library-validation", "restrict", "kill", "hard", "host", "expires", "enforcement"]);
const KNOWN_TRIPLES = new Set(["aarch64-apple-darwin", "x86_64-apple-darwin", "x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu", "x86_64-pc-windows-msvc"]);
const KNOWN_PLATFORMS = new Set(["darwin", "linux", "win32"]);
const KNOWN_ARCHS = new Set(["arm64", "x64", "ia32"]);

export function authorityCategory(line) {
  const value = String(line ?? "").trim();
  for (const [re, category] of AUTHORITY_CATEGORIES) if (re.test(value)) return category;
  return "unknown";
}
export function assessmentSourceCategory(value) {
  return ASSESSMENT_SOURCES[String(value ?? "").trim()] ?? "unknown";
}
const category = (value, set) => (set.has(value) ? value : "other");

/* ----------------------------------------------------------------------------------------- */
/* Default (real) dependencies. Tests inject replacements; nothing here is a mutable global.  */
/* ----------------------------------------------------------------------------------------- */

/**
 * Runs one command with a timeout and an output cap. Raw output is returned to the
 * caller's parser only; it is never written to a receipt or an error message.
 */
export function defaultRunCommand(file, args, { timeoutMs = COMMAND_TIMEOUT_MS, maxBytes = COMMAND_MAX_BYTES } = {}) {
  const env = {};
  for (const key of ["PATH", "HOME", "RUSTUP_HOME", "CARGO_HOME", "SDKROOT", "TMPDIR"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.LANG = "C";
  env.LC_ALL = "C";
  const result = spawnSync(file, args, { encoding: "utf8", timeout: timeoutMs, maxBuffer: maxBytes, env, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) {
    const code = result.error.code;
    if (code === "ENOENT") return { state: "missing" };
    if (code === "EACCES" || code === "EPERM") return { state: "denied" };
    if (code === "ETIMEDOUT") return { state: "timeout" };
    if (code === "ENOBUFS") return { state: "truncated" };
    return { state: "error" };
  }
  if (result.signal) return { state: "timeout" };
  return { state: "ok", code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function defaultHashFile(path) {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let read;
    while ((read = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

export function defaultDeps() {
  return {
    platform: process.platform,
    processArch: process.arch,
    nodeVersion: process.version,
    sdkrootEnv: process.env.SDKROOT,
    now: () => new Date().toISOString(),
    runCommand: defaultRunCommand,
    readText: (path) => readFileSync(path, "utf8"),
    listDir: (path) => readdirSync(path),
    exists: (path) => existsSync(path),
    stat: (path) => statSync(path),
    hashFile: defaultHashFile,
  };
}

/* ----------------------------------------------------------------------------------------- */
/* Allowlisted parsers: each returns only a validated token or a fixed category.             */
/* ----------------------------------------------------------------------------------------- */

const match = (text, re) => {
  const m = re.exec(text ?? "");
  return m ? m[1] : null;
};
const firstLine = (text) => String(text ?? "").split(/\r?\n/, 1)[0].trim();
const only = (value, re) => (value !== null && value !== undefined && re.test(value) ? value : null);
const VERSION_RE = /^\d+(\.\d+){0,2}$/;

/** stdout of a command that ran and exited 0; otherwise null (READINESS-R1 exit-code audit). */
const okOut = (result) => (result.state === "ok" && result.code === 0 ? result.stdout : null);

export const parse = {
  semver: (text) => only(firstLine(text), /^\d+\.\d+(\.\d+)?$/),
  macosVersion: (text) => only(firstLine(text), VERSION_RE),
  macosBuild: (text) => only(firstLine(text), /^[0-9A-Z]{4,10}[a-z]?$/),
  machineArch: (text) => only(firstLine(text), /^(arm64|x86_64|aarch64)$/),
  hwModel: (text) => only(firstLine(text), /^(Mac|MacBookAir|MacBookPro|Macmini|iMac|MacPro)\d+,\d+$/),
  cpuBrand: (text) => only(firstLine(text), /^Apple M\d+( (Pro|Max|Ultra))?$/),
  translated: (text) => only(firstLine(text), /^[01]$/),
  developerDir: (text) => {
    const dir = firstLine(text);
    if (dir === "/Library/Developer/CommandLineTools") return "CommandLineTools";
    if (dir === "/Applications/Xcode.app/Contents/Developer") return "Xcode.app";
    return dir ? "other location" : null;
  },
  rustc: (text) => {
    const host = match(text, /^host: (\S+)$/m);
    return { release: match(text, /^release: (\d+\.\d+\.\d+)$/m), host: host === null ? null : category(host, KNOWN_TRIPLES) };
  },
  cargo: (text) => match(text, /^cargo (\d+\.\d+\.\d+)\b/),
  gitSha: (text) => only(firstLine(text), /^[0-9a-f]{40}$/),
  gitBranch: (text) => {
    const b = firstLine(text);
    return /^(main|release\/\d+\.\d+\.\d+|(codex|claude|fix|feat|feature|polish|audit|harden|docs)\/[a-z0-9._-]{1,80})$/.test(b) ? b : b ? "other" : null;
  },
  bundleId: (text) => only(firstLine(text), /^[A-Za-z0-9.-]{1,100}$/),
  bundleVersion: (text) => only(firstLine(text), /^\d+(\.\d+){0,3}$/),
  executableName: (text) => only(firstLine(text), /^[A-Za-z0-9 ._-]{1,80}$/),
  archs: (text) => {
    const tokens = firstLine(text).split(/\s+/).filter(Boolean);
    return tokens.length && tokens.every((t) => /^(arm64|arm64e|x86_64|i386)$/.test(t)) ? tokens : null;
  },
  /**
   * `codesign -dv --verbose=2` (stderr). Fields are trusted only when the command exited 0;
   * a nonzero exit is "unsigned" (when codesign says so) or "display-failed", with no fields.
   */
  codesignDisplay: (result, expectedIdentifier) => {
    if (result.state !== "ok") return { state: result.state };
    const text = String(result.stderr ?? "");
    if (result.code !== 0) return { state: /not signed at all/i.test(text) ? "unsigned" : "display-failed" };
    const flags = (match(text, /flags=0x[0-9a-f]+\(([^)]*)\)/i) ?? "").split(",").filter(Boolean).map((f) => (KNOWN_FLAGS.has(f) ? f : "other"));
    const authorityKinds = [...text.matchAll(/^Authority=(.*)$/gm)].map((m) => authorityCategory(m[1]));
    const identifier = match(text, /^Identifier=(.*)$/m);
    const team = match(text, /^TeamIdentifier=(.*)$/m);
    return {
      state: "observed",
      signatureKind: /^Signature=adhoc$/m.test(text) ? "adhoc" : authorityKinds.length ? "certificate" : "unknown",
      identifier: identifier === null ? "absent" : expectedIdentifier === undefined ? "present" : identifier.trim() === expectedIdentifier ? "matches-expected" : "differs-from-expected",
      flags,
      hardenedRuntime: flags.includes("runtime"),
      teamIdentifier: team === null ? "absent" : team.trim() === "not set" ? "not set" : "present",
      authorityKinds,
      secureTimestamp: /^Timestamp=/m.test(text),
      sealedResourcesLine: /^Sealed Resources=none$/m.test(text) ? "none" : /^Sealed Resources version=/m.test(text) ? "present" : "absent",
    };
  },
  /** `codesign --verify --strict` result: only exit 0 counts as verified integrity. */
  codesignVerify: (result) => {
    if (result.state !== "ok") return { state: result.state };
    if (result.code === 0) return { state: "verified" };
    const text = String(result.stderr ?? "");
    const reason = /not signed at all/i.test(text)
      ? "not-signed"
      : /sealed resource is missing or invalid|file added|file modified|file missing/i.test(text)
        ? "sealed-resource-invalid"
        : /invalid signature|code or signature have been modified/i.test(text)
          ? "signature-invalid"
          : "verification-failed";
    return { state: "failed", reason };
  },
  /** `spctl --assess`: accepted needs exit 0, rejected needs a nonzero exit; else unverified. */
  spctl: (result) => {
    if (result.state !== "ok") return { verdict: result.state, source: "unknown" };
    const verdict = match(result.stderr, /: (accepted|rejected)\b/);
    const consistent = (verdict === "accepted" && result.code === 0) || (verdict === "rejected" && result.code !== 0);
    return { verdict: consistent ? verdict : "unparsed", source: consistent ? assessmentSourceCategory(match(result.stderr, /^source=(.*)$/m)) : "unknown" };
  },
  stapler: (result) => {
    if (result.state !== "ok") return result.state;
    if (result.code === 0 && /validate action worked/i.test(result.stdout ?? "")) return "stapled";
    if (result.code !== 0 && /does not have a ticket stapled/i.test(result.stdout ?? "")) return "not stapled";
    return "unknown";
  },
};

function versionAtLeast(version, minimum) {
  const a = version.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}
const majorMinor = (v) => v.split(".").slice(0, 2).concat(["0"]).slice(0, 2).join(".");

function commandNote(result) {
  return { missing: "command unavailable", denied: "permission denied", timeout: "timed out (bounded)", error: "could not run", truncated: "output exceeded the cap" }[result.state] ?? `exit ${result.code}`;
}

/* ----------------------------------------------------------------------------------------- */
/* The preflight                                                                              */
/* ----------------------------------------------------------------------------------------- */

/**
 * @param {object} options repo, artifact, app, expectedSha256, expectedSize, expectedIdentifier, sdk, assess
 * @param {object} deps    injected environment (see defaultDeps)
 * @returns {object} receipt following SCHEMA
 */
export function runPreflight(options = {}, deps = defaultDeps()) {
  const checks = [];
  const add = (id, cat, status, summary, observed = {}) => {
    if (!STATUSES.includes(status)) throw new Error(`invalid status ${status}`);
    checks.push({ id, category: cat, status, summary, observed });
  };
  const run = (tool, args) => {
    const file = SYSTEM_TOOLS[tool] ?? tool;
    if (SYSTEM_TOOLS[tool] && !deps.exists(file)) return { state: "missing" };
    return deps.runCommand(file, args, { timeoutMs: COMMAND_TIMEOUT_MS, maxBytes: COMMAND_MAX_BYTES });
  };
  const repo = resolve(options.repo ?? process.cwd());
  const expectedIdentifier = options.expectedIdentifier ?? EXPECTED_IDENTIFIER;

  /* ---------------- repository configuration ---------------- */
  const readJson = (rel) => {
    const path = join(repo, rel);
    if (!deps.exists(path)) return { error: "missing" };
    try {
      return { value: JSON.parse(deps.readText(path)) };
    } catch {
      return { error: "malformed" };
    }
  };
  const readTextFile = (rel) => {
    const path = join(repo, rel);
    if (!deps.exists(path)) return { error: "missing" };
    try {
      return { value: deps.readText(path) };
    } catch {
      return { error: "unreadable" };
    }
  };
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  const tauri = readJson("src-tauri/tauri.conf.json");
  const policy = readJson("scripts/release-policy.json");
  const cargoToml = readTextFile("src-tauri/Cargo.toml");
  const cargoLock = readTextFile("src-tauri/Cargo.lock");

  const versions = {
    "package.json": pkg.value?.version ?? pkg.error,
    "package-lock.json": lock.value?.version ?? lock.error,
    "src-tauri/tauri.conf.json": tauri.value?.version ?? tauri.error,
    "src-tauri/Cargo.toml": cargoToml.value ? match(cargoToml.value, /^version\s*=\s*"([^"]+)"/m) ?? "no version" : cargoToml.error,
    "src-tauri/Cargo.lock": cargoLock.value
      ? match(cargoLock.value, /\[\[package\]\]\s+name\s*=\s*"her-flight-deck"\s+version\s*=\s*"([^"]+)"/) ?? "no entry"
      : cargoLock.error,
  };
  for (const [file, value] of Object.entries(versions)) {
    if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) versions[file] = ["missing", "malformed", "unreadable", "no version", "no entry"].includes(value) ? value : "invalid";
  }
  const distinct = new Set(Object.values(versions));
  const repoVersion = distinct.size === 1 && /^\d+\.\d+\.\d+$/.test([...distinct][0]) ? [...distinct][0] : null;
  add("R-VERSION", "repository", repoVersion ? "PASS" : "FAIL", repoVersion ? `all five version sources agree on ${repoVersion}` : "version sources are missing, malformed or disagree", { versions });

  const identifier = tauri.value?.identifier;
  const identifierState = typeof identifier !== "string" ? tauri.error ?? "missing" : identifier === expectedIdentifier ? expectedIdentifier : "differs-from-expected";
  add("R-IDENTIFIER", "repository", identifier === expectedIdentifier ? "PASS" : "FAIL",
    identifier === expectedIdentifier ? `bundle identifier is ${expectedIdentifier}` : "bundle identifier differs from the project identity or is missing",
    { configured: identifierState, expected: expectedIdentifier });

  const macPolicy = policy.value?.platformDistribution?.macos;
  const rawMinOs = tauri.value?.bundle?.macOS?.minimumSystemVersion;
  const minOs = typeof rawMinOs === "string" && VERSION_RE.test(rawMinOs) ? rawMinOs : null;
  const policyMin = typeof macPolicy?.minimumSystemVersion === "string" && VERSION_RE.test(macPolicy.minimumSystemVersion) ? macPolicy.minimumSystemVersion : null;
  add("R-MIN-MACOS", "repository", minOs && policyMin && minOs === policyMin ? "PASS" : "FAIL",
    minOs && policyMin && minOs === policyMin ? `minimum macOS ${minOs} matches the release policy` : "minimum macOS is missing, invalid or differs from the release policy",
    { configured: minOs ?? (rawMinOs === undefined ? "missing" : "invalid"), policy: policyMin ?? (policy.error ?? (macPolicy?.minimumSystemVersion === undefined ? "missing" : "invalid")) });
  const candidate = typeof macPolicy?.candidateVersion === "string" && /^\d+\.\d+\.\d+$/.test(macPolicy.candidateVersion) ? macPolicy.candidateVersion : null;
  add("R-POLICY", "repository",
    repoVersion && candidate === repoVersion && macPolicy?.architecture === "aarch64" ? "PASS" : "FAIL",
    "release policy macOS candidate version and architecture against the repository version",
    {
      candidateVersion: candidate ?? (policy.error ?? "missing or invalid"),
      architecture: macPolicy?.architecture === "aarch64" ? "aarch64" : macPolicy?.architecture === undefined ? "missing" : "other",
      windows: category(policy.value?.platformDistribution?.windows?.status, new Set(["held", "active"])),
    });

  const macBundle = tauri.value?.bundle?.macOS ?? {};
  let workflowRefs = { checked: false };
  const workflowDir = join(repo, ".github/workflows");
  if (deps.exists(workflowDir)) {
    try {
      const text = deps.listDir(workflowDir).filter((f) => /\.ya?ml$/.test(f)).map((f) => deps.readText(join(workflowDir, f))).join("\n");
      workflowRefs = {
        checked: true,
        signingSecretNames: ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY", "KEYCHAIN_PASSWORD"].filter((n) => new RegExp(`\\b${n}\\b`).test(text)),
        notarizationSecretNames: ["APPLE_API_ISSUER", "APPLE_API_KEY", "APPLE_API_KEY_PATH", "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"].filter((n) => new RegExp(`\\b${n}\\b`).test(text)),
      };
    } catch {
      workflowRefs = { checked: false, note: "workflows unreadable" };
    }
  }
  add("R-SIGNING-CONFIG", "repository", "USER_ACTION",
    "signing/notarization configuration recorded; a Developer ID decision and credentials are owner actions. Absent workflow references do not prove secrets are absent.",
    {
      signingIdentityConfigured: typeof macBundle.signingIdentity === "string" ? (macBundle.signingIdentity === "-" ? "ad hoc" : "set") : "not set",
      hardenedRuntimeConfigured: macBundle.hardenedRuntime === undefined ? "default (not set)" : macBundle.hardenedRuntime === true ? true : macBundle.hardenedRuntime === false ? false : "invalid",
      entitlementsConfigured: macBundle.entitlements ? "set" : "not set",
      providerShortNameConfigured: macBundle.providerShortName ? "set" : "not set",
      workflowReferences: workflowRefs,
    });

  const sha = run("git", ["-C", repo, "rev-parse", "HEAD"]);
  const branch = run("git", ["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"]);
  const porcelain = run("git", ["-C", repo, "status", "--porcelain=v1"]);
  const shaOut = okOut(sha);
  const porcelainOut = okOut(porcelain);
  if (shaOut !== null && porcelainOut !== null && parse.gitSha(shaOut)) {
    const lines = porcelainOut.split("\n").filter(Boolean);
    const changes = { modified: lines.filter((l) => !l.startsWith("??")).length, untracked: lines.filter((l) => l.startsWith("??")).length };
    const clean = lines.length === 0;
    add("R-SOURCE", "repository", clean ? "PASS" : "UNVERIFIED",
      clean ? "source is a clean commit" : "working tree has uncommitted changes; the tested source is HEAD plus local changes",
      { head: parse.gitSha(shaOut), branch: okOut(branch) !== null ? parse.gitBranch(okOut(branch)) ?? "unparsed" : "unknown", ...changes });
  } else {
    add("R-SOURCE", "repository", "UNVERIFIED", `source identity unavailable (${commandNote(shaOut === null ? sha : porcelain)})`);
  }

  /* ---------------- host ---------------- */
  const isMac = deps.platform === "darwin";
  if (!isMac) {
    add("H-OS", "host", "FAIL", "unsupported platform for Mac readiness; host checks skipped", { platform: category(deps.platform, KNOWN_PLATFORMS) });
  } else {
    const ver = run("sw_vers", ["-productVersion"]);
    const build = run("sw_vers", ["-buildVersion"]);
    const version = okOut(ver) !== null ? parse.macosVersion(okOut(ver)) : null;
    const observed = { productVersion: version ?? "unknown", buildVersion: okOut(build) !== null ? parse.macosBuild(okOut(build)) ?? "unparsed" : "unknown", configuredMinimum: minOs ?? "invalid or missing", note: "a current macOS observation never certifies macOS 12" };
    if (!version) add("H-OS", "host", "UNVERIFIED", `macOS version unavailable (${commandNote(ver)})`, observed);
    else if (!minOs) add("H-OS", "host", "UNVERIFIED", "configured minimum macOS is missing or invalid, so the host cannot be compared", observed);
    else add("H-OS", "host", versionAtLeast(version, minOs) ? "PASS" : "FAIL", `macOS ${version} ${versionAtLeast(version, minOs) ? "meets" : "is below"} the configured minimum ${minOs}`, observed);

    const machine = run("uname", ["-m"]);
    const model = run("sysctl", ["-n", "hw.model"]);
    const brand = run("sysctl", ["-n", "machdep.cpu.brand_string"]);
    const translated = run("sysctl", ["-n", "sysctl.proc_translated"]);
    const machineArch = okOut(machine) !== null ? parse.machineArch(okOut(machine)) : null;
    const isTranslated = okOut(translated) !== null ? parse.translated(okOut(translated)) : null;
    const nodeArch = category(deps.processArch, KNOWN_ARCHS);
    add("H-ARCH", "host",
      machineArch === "arm64" && nodeArch === "arm64" && isTranslated !== "1" ? "PASS" : machineArch ? "FAIL" : "UNVERIFIED",
      "Apple Silicon host with a native (not translated) Node process",
      { machine: machineArch ?? "unknown", nodeProcess: nodeArch, rosettaTranslated: isTranslated ?? "unknown", model: okOut(model) !== null ? parse.hwModel(okOut(model)) ?? "unparsed" : "unknown", chip: okOut(brand) !== null ? parse.cpuBrand(okOut(brand)) ?? "unparsed" : "unknown" });
  }

  const npm = isMac ? run("npm", ["--version"]) : { state: "skipped" };
  const rustc = isMac ? run("rustc", ["-vV"]) : { state: "skipped" };
  const cargo = isMac ? run("cargo", ["--version"]) : { state: "skipped" };
  const rust = okOut(rustc) !== null ? parse.rustc(okOut(rustc)) : { release: null, host: null };
  const nodeVersion = only(deps.nodeVersion, /^v\d+\.\d+\.\d+$/);
  const describe = (r, parsed) => (parsed ?? (r.state === "skipped" ? "not checked" : r.state === "ok" ? (r.code === 0 ? "unparsed" : commandNote(r)) : commandNote(r)));
  const toolchain = {
    node: nodeVersion ?? "unknown",
    npm: describe(npm, okOut(npm) !== null ? parse.semver(okOut(npm)) : null),
    rustc: describe(rustc, rust.release),
    rustHost: rust.host ?? "unknown",
    cargo: describe(cargo, okOut(cargo) !== null ? parse.cargo(okOut(cargo)) : null),
  };
  const toolchainComplete = nodeVersion && /^\d/.test(toolchain.npm) && /^\d/.test(toolchain.rustc) && /^\d/.test(toolchain.cargo);
  add("H-TOOLCHAIN", "host",
    toolchainComplete && nodeVersion.startsWith("v22.") && rust.host === "aarch64-apple-darwin" ? "PASS" : "UNVERIFIED",
    toolchainComplete ? "Node, npm, Rust and Cargo identified (project lanes use Node 22 and aarch64-apple-darwin)" : "one or more toolchain commands unavailable, failed, timed out or unparsed",
    toolchain);

  /* ---------------- explicit SDK (READINESS-R2) ---------------- */
  const sdkSource = options.sdk !== undefined ? "--sdk" : deps.sdkrootEnv ? "SDKROOT" : "default";
  const sdk = options.sdk ?? deps.sdkrootEnv ?? DEFAULT_SDK;
  const sdkPathCategory = /^\/Library\/Developer\/CommandLineTools\/SDKs\/MacOSX\d+(\.\d+)?\.sdk$/.test(sdk)
    ? sdk
    : /^\/Applications\/Xcode\.app\/Contents\/Developer\/Platforms\/MacOSX\.platform\/Developer\/SDKs\/MacOSX\d+(\.\d+)?\.sdk$/.test(sdk)
      ? sdk
      : "other location (not recorded)";
  const inspectable = /^\/(Library|Applications)\/[A-Za-z0-9 ._/-]{1,200}\.sdk$/.test(sdk) && !sdk.includes("..");
  if (!isMac) {
    add("H-SDK", "host", "UNVERIFIED", "SDK check needs macOS", { selectedBy: sdkSource });
  } else {
    const defaultSdk = run("xcrun", ["--show-sdk-version"]);
    const developerDir = run("xcode-select", ["-p"]);
    const sdkObserved = {
      selectedBy: sdkSource,
      explicitSdk: sdkPathCategory,
      evidencedVersions: EVIDENCED_SDK_VERSIONS,
      knownIncompatibleVersions: KNOWN_INCOMPATIBLE_SDK_VERSIONS,
      defaultSdkVersion: okOut(defaultSdk) !== null ? parse.macosVersion(okOut(defaultSdk)) ?? "unparsed" : commandNote(defaultSdk),
      developerDir: okOut(developerDir) !== null ? parse.developerDir(okOut(developerDir)) ?? "unparsed" : commandNote(developerDir),
      note: "identifying the default SDK is not proof that a native build links; only explicit SDK versions with recorded build evidence pass",
    };
    const sdkResult = (status, summary, extra) => add("H-SDK", "host", status, summary, { ...sdkObserved, ...extra });
    let st = null;
    let statFailed = false;
    if (inspectable && deps.exists(sdk)) {
      try {
        st = deps.stat(sdk);
      } catch {
        statFailed = true;
      }
    }
    if (!inspectable) sdkResult("UNVERIFIED", "explicit SDK path is outside the system developer locations; not inspected", { presence: "not inspected" });
    else if (!deps.exists(sdk)) sdkResult("FAIL", "explicit SDK not found; report the environment prerequisite, do not change system developer settings", { presence: "absent" });
    else if (statFailed) sdkResult("UNVERIFIED", "explicit SDK path could not be inspected", { presence: "unreadable" });
    else if (!st.isDirectory()) sdkResult("FAIL", "explicit SDK path is not a directory", { presence: "not a directory" });
    else {
      const settingsPath = join(sdk, "SDKSettings.json");
      let metadata = "missing";
      let version = null;
      if (deps.exists(settingsPath)) {
        let text = null;
        try {
          text = deps.readText(settingsPath);
        } catch {
          metadata = "unreadable";
        }
        if (text !== null) {
          try {
            const raw = JSON.parse(text)?.Version;
            version = typeof raw === "string" && VERSION_RE.test(raw) ? raw : null;
            metadata = version ? "readable" : "no valid Version";
          } catch {
            metadata = "malformed";
          }
        }
      }
      const extra = { presence: "directory", metadata, explicitSdkVersion: version ?? "unidentified" };
      if (!version) sdkResult("UNVERIFIED", `explicit SDK present but its version is unidentified (metadata ${metadata})`, extra);
      else if (EVIDENCED_SDK_VERSIONS.includes(version)) sdkResult("PASS", `explicit SDK ${version} is the version with recorded native-build evidence`, extra);
      else if (KNOWN_INCOMPATIBLE_SDK_VERSIONS.includes(majorMinor(version))) sdkResult("FAIL", `explicit SDK ${version} is recorded as failing this project's native build`, extra);
      else sdkResult("UNVERIFIED", `explicit SDK ${version} has no recorded native-build evidence`, extra);
    }
    const missingTools = Object.entries(SYSTEM_TOOLS).filter(([, path]) => !deps.exists(path)).map(([name]) => name);
    add("H-TOOLS", "host", missingTools.length ? "UNVERIFIED" : "PASS",
      missingTools.length ? "some read-only inspection tools are unavailable" : "read-only inspection tools present at their system paths",
      { missing: missingTools });
  }

  /* ---------------- owner prerequisites (never satisfied by this tool) ---------------- */
  add("P-TEST-ACCOUNT", "owner", "USER_ACTION",
    "a dedicated standard synthetic test account and its isolation evidence must be provided and recorded (runbook §3); no flag or command here can establish it");
  add("P-SIGNING", "owner", "USER_ACTION",
    "Developer ID signing/notarization decision, Apple Developer Program team and credential provisioning are owner actions (runbook §4)");
  add("P-INSTALLED-SMOKE", "owner", "UNVERIFIED",
    "installed smoke phases 1-8 have no recorded execution; this tool never installs, launches or tests the app", { phases: 8, recorded: 0 });
  add("P-A2-SOURCE", "owner", "UNVERIFIED",
    "A2-dependent installed checks wait for the Windows owner's independently accepted source");

  /* ---------------- explicit artifact inspection ---------------- */
  let artifact = null;
  const target = options.artifact ?? options.app;
  if (target) {
    const path = resolve(target);
    const name = basename(path);
    const isApp = Boolean(options.app);
    const isDmg = !isApp && /\.dmg$/i.test(name);
    artifact = {
      kind: isApp ? "app" : isDmg ? "disk-image" : "file",
      name: KNOWN_ARTIFACTS.some((k) => k.fileName === name) || name === "Her Flight Deck.app" ? name : "not recorded",
      pathRecorded: "never",
    };
    let st = null;
    try {
      st = deps.exists(path) ? deps.stat(path) : null;
    } catch {
      st = null;
    }
    const kindOk = st && (isApp ? st.isDirectory() : st.isFile());
    add("A-EXISTS", "artifact", kindOk ? "PASS" : "FAIL",
      kindOk ? "the supplied artifact path exists" : isApp ? "the supplied --app path is missing or not an app bundle directory" : "the supplied --artifact path is missing or not a regular file");
    if (kindOk && !isApp) {
      const bytes = st.size;
      let sha256 = null;
      try {
        sha256 = deps.hashFile(path);
      } catch {
        sha256 = null;
      }
      artifact.bytes = bytes;
      artifact.sha256 = sha256 ?? "unreadable";
      const known = KNOWN_ARTIFACTS.find((k) => k.sha256 === sha256 && k.bytes === bytes);
      artifact.knownIdentity = known ? known.label : "not a recorded identity";
      add("A-SIZE", "artifact", options.expectedSize === undefined ? "UNVERIFIED" : Number(options.expectedSize) === bytes ? "PASS" : "FAIL",
        options.expectedSize === undefined ? "byte size observed; no expected size supplied" : Number(options.expectedSize) === bytes ? "byte size matches the expected size" : "byte size differs from the expected size",
        { bytes, expected: options.expectedSize === undefined ? "not supplied" : Number(options.expectedSize) });
      const expectedSha = options.expectedSha256?.toLowerCase();
      add("A-SHA256", "artifact", !sha256 ? "FAIL" : expectedSha === undefined ? "UNVERIFIED" : expectedSha === sha256 ? "PASS" : "FAIL",
        !sha256 ? "the artifact could not be read for hashing" : expectedSha === undefined ? "SHA-256 observed; no expected hash supplied" : expectedSha === sha256 ? "SHA-256 matches the expected identity" : "SHA-256 differs from the expected identity",
        { sha256: sha256 ?? "unreadable", expected: expectedSha ?? "not supplied", knownIdentity: artifact.knownIdentity });
      if (isDmg) {
        add("A-APP-METADATA", "artifact", "UNVERIFIED",
          "the app inside a disk image is not inspected: this tool never mounts. Use the runbook's read-only mount recipe, then pass --app");
        add("A-INNER-APP-SIGNATURE", "artifact", "UNVERIFIED",
          "the inner app's signature, runtime and identifier are not inspected: a disk-image signature never certifies its unopened app");
      }
    }
    if (kindOk && isMac && (isApp || isDmg)) {
      if (isApp) {
        const plist = join(path, "Contents/Info.plist");
        const extract = (key) => okOut(run("plutil", ["-extract", key, "raw", "-o", "-", plist]));
        const id = parse.bundleId(extract("CFBundleIdentifier"));
        const minimum = parse.macosVersion(extract("LSMinimumSystemVersion"));
        const version = parse.bundleVersion(extract("CFBundleShortVersionString"));
        const executable = parse.executableName(extract("CFBundleExecutable"));
        const lipoOut = executable ? okOut(run("lipo", ["-archs", join(path, "Contents/MacOS", executable)])) : null;
        const archList = lipoOut !== null ? parse.archs(lipoOut) : null;
        const pub = {
          bundleIdentifier: id === null ? "unread" : id === expectedIdentifier ? id : "differs-from-expected",
          minimumSystemVersion: minimum ?? "unread",
          version: version ?? "unread",
          executableArchitectures: archList ?? "unread",
        };
        Object.assign(artifact, pub);
        const unread = !id || !minimum || !version || !archList;
        const metaOk = id === expectedIdentifier && minimum === minOs && version === repoVersion && archList?.includes("arm64");
        add("A-APP-METADATA", "artifact", unread ? "UNVERIFIED" : metaOk ? "PASS" : "FAIL",
          metaOk ? "bundle identifier, minimum macOS, version and arm64 executable match the repository" : unread ? "some bundle metadata could not be read" : "bundle metadata differs from the repository configuration",
          { ...pub, expected: { bundleIdentifier: expectedIdentifier, minimumSystemVersion: minOs ?? "invalid or missing", version: repoVersion ?? "unknown", architecture: "arm64" } });
      }

      // READINESS-R1: displayed identity and verified integrity are separate observations.
      const display = parse.codesignDisplay(run("codesign", ["-dv", "--verbose=2", path]), isApp ? expectedIdentifier : undefined);
      const verifyArgs = isApp ? ["--verify", "--deep", "--strict", "--verbose=2", path] : ["--verify", "--strict", "--verbose=2", path];
      const integrity = parse.codesignVerify(run("codesign", verifyArgs));
      artifact.signing = { display, integrity };
      const id = isApp ? "A-APP-SIGNATURE" : "A-DMG-SIGNATURE";
      const what = isApp ? "app" : "disk-image container";
      const problems = [];
      if (display.state === "observed") {
        if (display.signatureKind === "adhoc") problems.push("ad hoc signature");
        else if (!display.authorityKinds.includes("developer-id-application")) problems.push("not a Developer ID Application signature");
        if (display.teamIdentifier !== "present") problems.push("no team identifier");
        if (!display.secureTimestamp) problems.push("no secure timestamp");
        if (isApp && !display.hardenedRuntime) problems.push("no hardened runtime");
        if (isApp && display.identifier !== "matches-expected") problems.push("signature identifier differs from the bundle identity");
      }
      if (display.state === "unsigned" || integrity.state === "failed") {
        if (display.state === "unsigned" || integrity.reason === "not-signed") problems.push("not signed");
        else problems.push(`integrity verification failed (${integrity.reason})`);
      }
      let status;
      let summary;
      if (problems.length) {
        status = "FAIL";
        summary = `${what}: ${[...new Set(problems)].join("; ")}`;
      } else if (display.state !== "observed") {
        status = "UNVERIFIED";
        summary = `${what} signature not observed (display ${display.state === "display-failed" ? "command failed; no fields trusted" : commandNote({ state: display.state })})`;
      } else if (integrity.state !== "verified") {
        status = "UNVERIFIED";
        summary = `${what} integrity not verified (${commandNote({ state: integrity.state })})`;
      } else {
        status = "PASS";
        summary = isApp
          ? "app: strict deep verification passed; Developer ID Application, expected identifier, hardened runtime, team and secure timestamp"
          : "disk-image container: strict verification passed; Developer ID Application, team and secure timestamp (inner app not inspected)";
      }
      add(id, "artifact", status, summary, { display, integrity });

      if (options.assess) {
        const spctl = parse.spctl(run("spctl", isApp ? ["--assess", "--type", "execute", "-vv", path] : ["--assess", "--type", "open", "--context", "context:primary-signature", "-vv", path]));
        const stapled = parse.stapler(run("stapler", ["validate", path]));
        artifact.assessment = { gatekeeper: spctl.verdict, source: spctl.source, stapledTicket: stapled };
        add("A-GATEKEEPER", "artifact",
          spctl.verdict === "accepted" && stapled === "stapled" ? "PASS" : spctl.verdict === "rejected" || (spctl.verdict === "accepted" && stapled === "not stapled") ? "FAIL" : "UNVERIFIED",
          "read-only Gatekeeper assessment and stapled-ticket validation of the supplied artifact (may use Apple's online lookup)",
          artifact.assessment);
      } else {
        add("A-GATEKEEPER", "artifact", "UNVERIFIED", "Gatekeeper/stapler assessment not run (opt in with --assess)");
      }
    } else if (kindOk && (isApp || isDmg)) {
      add(isApp ? "A-APP-SIGNATURE" : "A-DMG-SIGNATURE", "artifact", "UNVERIFIED", "signature inspection needs macOS");
    }
  }

  /* ---------------- summary ---------------- */
  const counts = Object.fromEntries(STATUSES.map((s) => [s, checks.filter((c) => c.status === s).length]));
  const exitCode = counts.FAIL > 0 ? EXIT.HAS_FAIL : EXIT.NO_FAIL;
  return {
    schema: SCHEMA,
    generatedAt: deps.now(),
    tool: "scripts/mac-readiness-preflight.mjs",
    mode: { artifactInspection: Boolean(target), assess: Boolean(options.assess) },
    repository: {
      package: pkg.value?.name === "her-flight-deck" ? "her-flight-deck" : "unrecognized",
      version: repoVersion ?? "unresolved",
      identifier: identifierState,
      minimumSystemVersion: minOs ?? "invalid or missing",
    },
    artifact,
    checks,
    summary: {
      counts,
      exitCode,
      readyForInstalledUse: false,
      notReadyBecause: checks.filter((c) => c.status !== "PASS").map((c) => `${c.id}: ${c.status}`),
    },
    safety: {
      mounted: false, installed: false, launched: false, built: false, signed: false, notarized: false,
      keychainOrAccountChanged: false, ciTriggered: false, providerContacted: false,
      appleOnlineLookupPossible: Boolean(options.assess && target),
      appProfileInspected: false,
    },
  };
}

export function formatHuman(receipt) {
  const lines = [`Her Flight Deck Mac readiness preflight (${receipt.schema})`, `generated ${receipt.generatedAt}`, ""];
  for (const c of receipt.checks) lines.push(`[${c.status.padEnd(11)}] ${c.id.padEnd(21)} ${c.summary}`);
  const { counts } = receipt.summary;
  lines.push("", `PASS ${counts.PASS} · FAIL ${counts.FAIL} · UNVERIFIED ${counts.UNVERIFIED} · USER_ACTION ${counts.USER_ACTION}`);
  lines.push("Not a readiness verdict: installed use stays unverified until the runbook's phases are executed and recorded.");
  return lines.join("\n");
}

/* ----------------------------------------------------------------------------------------- */
/* CLI                                                                                        */
/* ----------------------------------------------------------------------------------------- */

const HELP = `Usage: node scripts/mac-readiness-preflight.mjs [options]

Read-only. Never builds, mounts, installs, launches, signs, notarizes, edits keychains
or accounts, triggers CI or contacts a provider.

  --repo <dir>                 checkout to inspect (default: current directory)
  --artifact <file>            hash this one file; for a .dmg also read and strictly verify the
                               disk-image signature (the inner app is never mounted or inspected)
  --app <dir>                  inspect an already-available .app bundle read-only, including
                               strict deep signature verification
  --expected-sha256 <hex>      expected SHA-256 for --artifact
  --expected-size <bytes>      expected byte size for --artifact
  --expected-identifier <id>   bundle identifier to expect (default ${EXPECTED_IDENTIFIER})
  --sdk <path>                 explicit SDK to check (default $SDKROOT or ${DEFAULT_SDK})
  --assess                     also run spctl/stapler on the supplied artifact (may use Apple's online lookup)
  --json                       print the JSON receipt instead of text
  --receipt <file>             also write the JSON receipt to this new file
  --help                       show this help

Exit codes: 0 report produced with no FAIL (USER_ACTION/UNVERIFIED may remain: NOT a
readiness verdict); 1 at least one FAIL; 2 usage or internal error.`;

/** Usage errors never echo the argument values a user typed (they may be private paths). */
export function parseArgs(argv) {
  const options = {};
  const valueFlags = { "--repo": "repo", "--artifact": "artifact", "--app": "app", "--expected-sha256": "expectedSha256", "--expected-size": "expectedSize", "--expected-identifier": "expectedIdentifier", "--sdk": "sdk", "--receipt": "receipt" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--assess") options.assess = true;
    else if (Object.hasOwn(valueFlags, arg)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      options[valueFlags[arg]] = value;
    } else throw new Error(`unknown option at position ${i + 1} (value not shown)`);
  }
  if (options.artifact && options.app) throw new Error("use --artifact or --app, not both");
  if (options.expectedSha256 !== undefined && !/^[0-9a-fA-F]{64}$/.test(options.expectedSha256)) throw new Error("--expected-sha256 must be 64 hex characters");
  if (options.expectedSize !== undefined && !/^\d+$/.test(options.expectedSize)) throw new Error("--expected-size must be a whole number of bytes");
  if ((options.expectedSha256 || options.expectedSize) && !options.artifact) throw new Error("--expected-sha256/--expected-size need --artifact");
  if (options.assess && !options.artifact && !options.app) throw new Error("--assess needs --artifact or --app");
  if (options.expectedIdentifier !== undefined && !/^[A-Za-z0-9.-]{1,100}$/.test(options.expectedIdentifier)) throw new Error("--expected-identifier must be a bundle identifier");
  return options;
}

const SAFE_ERROR_CODES = new Set(["EEXIST", "EACCES", "EPERM", "ENOENT", "EISDIR", "ENOTDIR", "EROFS", "ENOSPC"]);

export function main(argv = process.argv.slice(2), deps = defaultDeps(), io = { out: (s) => process.stdout.write(`${s}\n`), err: (s) => process.stderr.write(`${s}\n`), writeFile: (p, s) => writeFileSync(p, s, { flag: "wx" }) }) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.err(`mac-readiness-preflight: ${error.message}\n\n${HELP}`);
    return EXIT.USAGE;
  }
  if (options.help) {
    io.out(HELP);
    return EXIT.NO_FAIL;
  }
  let receipt;
  try {
    receipt = runPreflight(options, deps);
  } catch (error) {
    io.err(`mac-readiness-preflight: internal error (${SAFE_ERROR_CODES.has(error?.code) ? error.code : "unexpected"})`);
    return EXIT.USAGE;
  }
  const json = JSON.stringify(receipt, null, 2);
  if (options.receipt) {
    try {
      io.writeFile(options.receipt, `${json}\n`);
    } catch (error) {
      io.err(`mac-readiness-preflight: could not write the receipt file (${SAFE_ERROR_CODES.has(error?.code) ? error.code : "unexpected"}; it is never overwritten)`);
      return EXIT.USAGE;
    }
  }
  io.out(options.json ? json : formatHuman(receipt));
  return receipt.summary.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
