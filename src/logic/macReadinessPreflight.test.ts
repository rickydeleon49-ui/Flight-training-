import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error -- scripts/mac-readiness-preflight.mjs is an untyped ESM script
import * as preflight from "../../scripts/mac-readiness-preflight.mjs";

const { runPreflight, formatHuman, parseArgs, main, defaultRunCommand, DEFAULT_SDK, EXIT } = preflight;
// Resolved from this file so an isolated copy of the tree tests its own copy of the script.
const SCRIPT = fileURLToPath(new URL("../../scripts/mac-readiness-preflight.mjs", import.meta.url));

type Result = { state: string; code?: number; stdout?: string; stderr?: string };
type Check = { id: string; status: string; summary: string; observed: Record<string, unknown> };
type Receipt = { schema: string; checks: Check[]; summary: { counts: Record<string, number>; exitCode: number; readyForInstalledUse: boolean }; artifact: Record<string, unknown> | null; safety: Record<string, unknown> };

const fixtures: string[] = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(label: string) {
  const dir = mkdtempSync(join(tmpdir(), `hfd-preflight-${label}-`));
  fixtures.push(dir);
  return dir;
}

interface RepoSpec {
  version?: string;
  tauriVersion?: string;
  identifier?: string;
  minOs?: string;
  omitTauri?: boolean;
  malformedPackage?: string;
  windowsStatus?: string;
}
function writeRepo(spec: RepoSpec = {}) {
  const dir = tempDir("repo");
  const v = spec.version ?? "0.5.3";
  const write = (rel: string, text: string) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  write("package.json", spec.malformedPackage ?? JSON.stringify({ name: "her-flight-deck", version: v }));
  write("package-lock.json", JSON.stringify({ name: "her-flight-deck", version: v }));
  if (!spec.omitTauri) {
    write("src-tauri/tauri.conf.json", JSON.stringify({ version: spec.tauriVersion ?? v, identifier: spec.identifier ?? "com.herflightdeck.app", bundle: { macOS: { minimumSystemVersion: spec.minOs ?? "12.0" } } }));
  }
  write("src-tauri/Cargo.toml", `[package]\nname = "her-flight-deck"\nversion = "${v}"\n`);
  write("src-tauri/Cargo.lock", `[[package]]\nname = "her-flight-deck"\nversion = "${v}"\n`);
  write("scripts/release-policy.json", JSON.stringify({ platformDistribution: { macos: { status: "active", architecture: "aarch64", minimumSystemVersion: "12.0", candidateVersion: "0.5.3" }, windows: { status: spec.windowsStatus ?? "held" } } }));
  write(".github/workflows/build.yml", "name: synthetic\njobs: {}\n");
  return dir;
}

const SYSTEM_PATHS = ["/usr/bin/sw_vers", "/usr/bin/uname", "/usr/sbin/sysctl", "/usr/bin/xcode-select", "/usr/bin/xcrun", "/usr/bin/codesign", "/usr/sbin/spctl", "/usr/bin/stapler", "/usr/bin/plutil", "/usr/bin/lipo", "/usr/bin/hdiutil", "/usr/bin/shasum", "/usr/bin/git"];
const SDK_ROOT_PREFIXES = ["/Library/", "/Applications/"];
const SDK_27 = "/Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk";

/** Synthetic SDK filesystem: paths under /Library or /Applications never reach the physical Mac. */
type SdkEntry = { type: "dir" | "file"; text?: string; unreadable?: boolean };
const sdkDir = (version: string | null, settings?: Partial<SdkEntry>): Record<string, SdkEntry> => (version === null ? {} : {
  [`__SDK__`]: { type: "dir" },
  [`__SDK__/SDKSettings.json`]: { type: "file", text: JSON.stringify({ Version: version, CanonicalName: `macosx${version}` }), ...settings },
});
function sdkFs(path: string, entries: Record<string, SdkEntry>) {
  return Object.fromEntries(Object.entries(entries).map(([k, v]) => [k.replace("__SDK__", path), v]));
}

const DEVELOPER_ID_DISPLAY = "Executable=/Applications/Her Flight Deck.app/Contents/MacOS/her-flight-deck\nIdentifier=com.herflightdeck.app\nFormat=app bundle with Mach-O thin (arm64)\nCodeDirectory v=20500 size=1 flags=0x10000(runtime) hashes=1+7 location=embedded\nAuthority=Developer ID Application: Synthetic Team (ABCDE12345)\nAuthority=Developer ID Certification Authority\nAuthority=Apple Root CA\nTimestamp=3 Oct 2026 at 10:00:00\nInfo.plist entries=20\nTeamIdentifier=ABCDE12345\nSealed Resources version=2 rules=13 files=3\n";
const ADHOC_DISPLAY = "Identifier=com.herflightdeck.app\nFormat=app bundle with Mach-O thin (arm64)\nCodeDirectory v=20400 size=1 flags=0x20002(adhoc,linker-signed) hashes=1+0 location=embedded\nSignature=adhoc\nInfo.plist=not bound\nTeamIdentifier=not set\nSealed Resources=none\n";
const DMG_DISPLAY = "Executable=/tmp/x.dmg\nIdentifier=com.example.synthetic-image\nFormat=disk image\nCodeDirectory v=20100 size=1 flags=0x0(none) hashes=1+6 location=embedded\nAuthority=Developer ID Application: Synthetic Team (ABCDE12345)\nAuthority=Developer ID Certification Authority\nAuthority=Apple Root CA\nTimestamp=3 Oct 2026 at 10:00:00\nTeamIdentifier=ABCDE12345\n";
const ok = (stdout = "", stderr = "", code = 0): Result => ({ state: "ok", code, stdout, stderr });

type Responder = (name: string, args: string[]) => Result | undefined;
interface Healthy {
  display?: Result;
  verify?: Result;
  plist?: Record<string, string>;
}
function healthyResponder(extra: Responder = () => undefined, h: Healthy = {}): Responder {
  const info = { CFBundleIdentifier: "com.herflightdeck.app", LSMinimumSystemVersion: "12.0", CFBundleShortVersionString: "0.5.3", CFBundleExecutable: "her-flight-deck", ...h.plist };
  return (name, args) => {
    const custom = extra(name, args);
    if (custom) return custom;
    const a = args.join(" ");
    if (name === "git" && a.endsWith("rev-parse HEAD")) return ok(`${"a".repeat(40)}\n`);
    if (name === "git" && a.includes("--abbrev-ref")) return ok("main\n");
    if (name === "git" && a.includes("status")) return ok("");
    if (name === "sw_vers") return ok(args[0] === "-productVersion" ? "27.0.1\n" : "26A434\n");
    if (name === "uname") return ok("arm64\n");
    if (name === "sysctl") return ok({ "hw.model": "Mac17,3\n", "machdep.cpu.brand_string": "Apple M5\n", "sysctl.proc_translated": "0\n" }[args[1]!] ?? "");
    if (name === "npm") return ok("10.9.9\n");
    if (name === "rustc") return ok("rustc 1.99.0 (b940084d7 2026-09-28)\nhost: aarch64-apple-darwin\nrelease: 1.99.0\n");
    if (name === "cargo") return ok("cargo 1.99.0 (5f94df478 2026-08-27)\n");
    if (name === "xcrun") return ok("27.0\n");
    if (name === "xcode-select") return ok("/Library/Developer/CommandLineTools\n");
    if (name === "plutil") return ok(`${info[args[1] as keyof typeof info] ?? ""}\n`);
    if (name === "lipo") return ok("arm64\n");
    if (name === "codesign" && args.includes("--verify")) return h.verify ?? ok("", "x: valid on disk\nx: satisfies its Designated Requirement\n", 0);
    if (name === "codesign") return h.display ?? ok("", ADHOC_DISPLAY, 0);
    if (name === "spctl") return ok("", `${args.at(-1)}: rejected\nsource=no usable signature\n`, 3);
    if (name === "stapler") return ok("Processing: x\nx does not have a ticket stapled to it.\n", "", 65);
    return { state: "missing" };
  };
}

interface DepsOptions {
  responder?: Responder;
  platform?: string;
  missingTools?: string[];
  sdkEntries?: Record<string, SdkEntry>;
  sdkrootEnv?: string;
}
function deps(options: DepsOptions = {}) {
  const calls: Array<{ name: string; args: string[]; opts: { timeoutMs: number; maxBytes: number } }> = [];
  const reads: string[] = [];
  const responder = options.responder ?? healthyResponder();
  const systemPaths = new Set(SYSTEM_PATHS.filter((p) => !(options.missingTools ?? []).some((t) => p.endsWith(`/${t}`))));
  const sdk = options.sdkEntries ?? sdkFs(DEFAULT_SDK, sdkDir("26.5"));
  const isSynthetic = (p: string) => SDK_ROOT_PREFIXES.some((prefix) => p.startsWith(prefix));
  const d = {
    platform: options.platform ?? "darwin",
    processArch: "arm64",
    nodeVersion: "v22.23.3",
    sdkrootEnv: options.sdkrootEnv,
    now: () => "2026-10-03T00:00:00.000Z",
    runCommand: (file: string, args: string[], opts: { timeoutMs: number; maxBytes: number }) => {
      const name = file.split("/").pop()!;
      calls.push({ name, args, opts });
      return responder(name, args) ?? { state: "missing" };
    },
    readText: (path: string) => {
      reads.push(path);
      if (isSynthetic(path)) {
        const e = sdk[path];
        if (!e || e.type !== "file") throw Object.assign(new Error("ENOENT synthetic"), { code: "ENOENT" });
        if (e.unreadable) throw Object.assign(new Error("EACCES /Users/private-sentinel/sdk"), { code: "EACCES" });
        return e.text ?? "";
      }
      return readFileSync(path, "utf8");
    },
    listDir: (path: string) => readdirSync(path),
    exists: (path: string) => (SYSTEM_PATHS.includes(path) ? systemPaths.has(path) : isSynthetic(path) ? path in sdk : existsSync(path)),
    stat: (path: string) => {
      if (isSynthetic(path)) {
        const e = sdk[path];
        if (!e) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return { isDirectory: () => e.type === "dir", isFile: () => e.type === "file", size: 0 };
      }
      return statSync(path);
    },
    hashFile: (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
  return { d, calls, reads };
}

const byId = (r: Receipt, id: string) => {
  const c = r.checks.find((x) => x.id === id);
  if (!c) throw new Error(`no check ${id}`);
  return c;
};
function syntheticApp(name = "Her Flight Deck.app") {
  const app = join(tempDir("app"), name);
  mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
  writeFileSync(join(app, "Contents/Info.plist"), "<plist/>");
  writeFileSync(join(app, "Contents/MacOS/her-flight-deck"), "synthetic");
  return app;
}
function syntheticDmg(name = "Synthetic_0.5.3_aarch64.dmg", bytes = "synthetic artifact bytes") {
  const file = join(tempDir("dmg"), name);
  writeFileSync(file, bytes);
  return file;
}

describe("Mac readiness preflight: repository configuration", () => {
  it("passes a consistent synthetic configuration while owner prerequisites stay open", () => {
    const { d } = deps();
    const r: Receipt = runPreflight({ repo: writeRepo() }, d);
    expect(["R-VERSION", "R-IDENTIFIER", "R-MIN-MACOS", "R-POLICY", "R-SOURCE", "H-OS", "H-ARCH", "H-TOOLCHAIN", "H-SDK", "H-TOOLS"].map((id) => byId(r, id).status)).toEqual(Array(10).fill("PASS"));
    expect(byId(r, "P-TEST-ACCOUNT").status).toBe("USER_ACTION");
    expect(byId(r, "P-SIGNING").status).toBe("USER_ACTION");
    expect(byId(r, "R-SIGNING-CONFIG")).toMatchObject({ status: "USER_ACTION", observed: { signingIdentityConfigured: "not set" } });
    expect(byId(r, "P-INSTALLED-SMOKE")).toMatchObject({ status: "UNVERIFIED", observed: { phases: 8, recorded: 0 } });
    expect(r.summary).toMatchObject({ exitCode: EXIT.NO_FAIL, readyForInstalledUse: false });
  });

  it("reports missing and malformed configuration without echoing file contents", () => {
    const { d } = deps();
    const r: Receipt = runPreflight({ repo: writeRepo({ omitTauri: true, malformedPackage: "{ not json SECRET_IN_FILE" }) }, d);
    expect(byId(r, "R-VERSION")).toMatchObject({ status: "FAIL", observed: { versions: { "package.json": "malformed", "src-tauri/tauri.conf.json": "missing" } } });
    expect(byId(r, "R-IDENTIFIER").status).toBe("FAIL");
    expect(byId(r, "R-MIN-MACOS").status).toBe("FAIL");
    expect(JSON.stringify(r)).not.toContain("SECRET_IN_FILE");
    expect(r.summary.exitCode).toBe(EXIT.HAS_FAIL);
  });

  it("fails a version disagreement and a bundle-identity mismatch", () => {
    const { d } = deps();
    const r: Receipt = runPreflight({ repo: writeRepo({ tauriVersion: "0.5.4", identifier: "com.example.other" }) }, d);
    expect(byId(r, "R-VERSION").status).toBe("FAIL");
    expect(byId(r, "R-POLICY").status).toBe("FAIL");
    expect(byId(r, "R-IDENTIFIER")).toMatchObject({ status: "FAIL", observed: { configured: "differs-from-expected", expected: "com.herflightdeck.app" } });
  });

  it("does not treat a dirty working tree as clean source identity", () => {
    const { d } = deps({ responder: healthyResponder((n, a) => (n === "git" && a.includes("status") ? ok(" M STATUS.md\n?? new.txt\n") : undefined)) });
    const r: Receipt = runPreflight({ repo: writeRepo() }, d);
    expect(byId(r, "R-SOURCE")).toMatchObject({ status: "UNVERIFIED", observed: { modified: 1, untracked: 1 } });
    expect(JSON.stringify(r)).not.toContain("STATUS.md");
  });

  it("R2: a malformed configured minimum macOS is reported as invalid and never compared", () => {
    const { d } = deps();
    const r: Receipt = runPreflight({ repo: writeRepo({ minOs: "twelve" }) }, d);
    expect(byId(r, "R-MIN-MACOS")).toMatchObject({ status: "FAIL", observed: { configured: "invalid" } });
    expect(byId(r, "H-OS").status).toBe("UNVERIFIED");
  });
});

describe("Mac readiness preflight: host and bounded commands", () => {
  it("fails an unsupported OS and runs no host or toolchain commands there", () => {
    const { d, calls } = deps({ platform: "linux" });
    const r: Receipt = runPreflight({ repo: writeRepo() }, d);
    expect(byId(r, "H-OS").status).toBe("FAIL");
    expect(byId(r, "H-SDK").status).toBe("UNVERIFIED");
    expect(calls.map((c) => c.name).filter((n) => n !== "git")).toEqual([]);
  });

  it("reports missing, permission-denied and timed-out commands truthfully as UNVERIFIED", () => {
    const responder = healthyResponder((n) => ({ rustc: { state: "timeout" }, cargo: { state: "missing" }, npm: { state: "denied" } } as Record<string, Result>)[n]);
    const { d } = deps({ responder, missingTools: ["spctl"] });
    const r: Receipt = runPreflight({ repo: writeRepo() }, d);
    expect(byId(r, "H-TOOLCHAIN")).toMatchObject({ status: "UNVERIFIED", observed: { rustc: "timed out (bounded)", cargo: "command unavailable", npm: "permission denied" } });
    expect(byId(r, "H-TOOLS")).toMatchObject({ status: "UNVERIFIED", observed: { missing: ["spctl"] } });
    expect(r.summary.exitCode).toBe(EXIT.NO_FAIL);
  });

  it("R1: observation commands that exit nonzero never yield PASS from their printed output", () => {
    const responder = healthyResponder((n, a) => {
      if (n === "sw_vers") return ok("27.0.1\n", "", 1);
      if (n === "git" && a.join(" ").endsWith("rev-parse HEAD")) return ok(`${"b".repeat(40)}\n`, "", 128);
      if (n === "npm") return ok("10.9.9\n", "", 1);
      return undefined;
    });
    const { d } = deps({ responder });
    const r: Receipt = runPreflight({ repo: writeRepo() }, d);
    expect(byId(r, "H-OS").status).toBe("UNVERIFIED");
    expect(byId(r, "R-SOURCE").status).toBe("UNVERIFIED");
    expect(byId(r, "H-TOOLCHAIN")).toMatchObject({ status: "UNVERIFIED", observed: { npm: "exit 1" } });
  });

  it("passes every command a timeout and an output cap", () => {
    const { d, calls } = deps();
    runPreflight({ repo: writeRepo(), app: syntheticApp(), assess: true }, d);
    expect(calls.length).toBeGreaterThan(10);
    for (const c of calls) expect(c.opts).toEqual({ timeoutMs: 10_000, maxBytes: 65_536 });
  });

  it("the real runner enforces its timeout, output cap and missing-command result", () => {
    const started = Date.now();
    expect(defaultRunCommand(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { timeoutMs: 200 }).state).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(4000);
    const big = defaultRunCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(200000))"], { maxBytes: 1024 });
    expect(big.state).toBe("truncated");
    expect(big.stdout ?? "").toBe("");
    expect(defaultRunCommand("/nonexistent/hfd-synthetic-tool", []).state).toBe("missing");
  });
});

describe("Mac readiness preflight: explicit SDK compatibility (READINESS-R2)", () => {
  const sdkCase = (opts: { sdk?: string; env?: string; entries: Record<string, SdkEntry> }) => {
    const { d } = deps({ sdkEntries: opts.entries, sdkrootEnv: opts.env });
    const r: Receipt = runPreflight({ repo: writeRepo(), ...(opts.sdk ? { sdk: opts.sdk } : {}) }, d);
    return byId(r, "H-SDK");
  };

  it("R2: only the evidenced SDK 26.5 passes, selected by --sdk or by an inherited SDKROOT", () => {
    expect(sdkCase({ sdk: DEFAULT_SDK, entries: sdkFs(DEFAULT_SDK, sdkDir("26.5")) })).toMatchObject({ status: "PASS", observed: { selectedBy: "--sdk", explicitSdkVersion: "26.5", metadata: "readable" } });
    expect(sdkCase({ env: DEFAULT_SDK, entries: sdkFs(DEFAULT_SDK, sdkDir("26.5")) })).toMatchObject({ status: "PASS", observed: { selectedBy: "SDKROOT" } });
  });

  it("R2: the recorded incompatible SDK 27.0 fails whether selected by --sdk or SDKROOT", () => {
    expect(sdkCase({ sdk: SDK_27, entries: sdkFs(SDK_27, sdkDir("27.0")) })).toMatchObject({ status: "FAIL", observed: { explicitSdkVersion: "27.0", selectedBy: "--sdk" } });
    expect(sdkCase({ env: SDK_27, entries: sdkFs(SDK_27, sdkDir("27.0")) })).toMatchObject({ status: "FAIL", observed: { selectedBy: "SDKROOT" } });
  });

  it("R2: another present version without build evidence is UNVERIFIED, not PASS", () => {
    const sdk = "/Library/Developer/CommandLineTools/SDKs/MacOSX26.4.sdk";
    expect(sdkCase({ sdk, entries: sdkFs(sdk, sdkDir("26.4")) })).toMatchObject({ status: "UNVERIFIED", observed: { explicitSdkVersion: "26.4" } });
  });

  it("R2: missing, malformed and unreadable SDK metadata never pass", () => {
    const noSettings = { [DEFAULT_SDK]: { type: "dir" as const } };
    expect(sdkCase({ sdk: DEFAULT_SDK, entries: noSettings })).toMatchObject({ status: "UNVERIFIED", observed: { metadata: "missing", explicitSdkVersion: "unidentified" } });
    expect(sdkCase({ sdk: DEFAULT_SDK, entries: sdkFs(DEFAULT_SDK, sdkDir("26.5", { text: "{ malformed" })) })).toMatchObject({ status: "UNVERIFIED", observed: { metadata: "malformed" } });
    expect(sdkCase({ sdk: DEFAULT_SDK, entries: sdkFs(DEFAULT_SDK, sdkDir("26.5", { unreadable: true })) })).toMatchObject({ status: "UNVERIFIED", observed: { metadata: "unreadable" } });
    expect(sdkCase({ sdk: DEFAULT_SDK, entries: sdkFs(DEFAULT_SDK, sdkDir("26.5", { text: JSON.stringify({ Version: "not a version" }) })) })).toMatchObject({ status: "UNVERIFIED", observed: { metadata: "no valid Version" } });
  });

  it("R2: an absent path and a regular file fail, and synthetic absence never falls through to this Mac's SDK", () => {
    // DEFAULT_SDK exists on the physical development Mac; an absent synthetic entry must still be absent.
    expect(sdkCase({ sdk: DEFAULT_SDK, entries: {} })).toMatchObject({ status: "FAIL", observed: { presence: "absent" } });
    expect(sdkCase({ sdk: DEFAULT_SDK, entries: { [DEFAULT_SDK]: { type: "file" } } })).toMatchObject({ status: "FAIL", observed: { presence: "not a directory" } });
  });
});

describe("Mac readiness preflight: app and disk-image signatures (READINESS-R1)", () => {
  const appCase = (h: Healthy, missingTools: string[] = [], expectedIdentifier?: string) => {
    const { d, calls } = deps({ responder: healthyResponder(undefined, h), missingTools });
    const r: Receipt = runPreflight({ repo: writeRepo(), app: syntheticApp(), ...(expectedIdentifier ? { expectedIdentifier } : {}) }, d);
    return { r, calls, sig: byId(r, "A-APP-SIGNATURE") };
  };
  const display = ok("", DEVELOPER_ID_DISPLAY, 0);

  it("R1: a healthy Developer ID app passes only after display and strict deep verification both succeed", () => {
    const { r, calls, sig } = appCase({ display });
    expect(sig).toMatchObject({ status: "PASS", observed: { display: { state: "observed", identifier: "matches-expected", hardenedRuntime: true, teamIdentifier: "present", secureTimestamp: true }, integrity: { state: "verified" } } });
    expect(calls.filter((c) => c.name === "codesign").map((c) => c.args.slice(0, -1).join(" "))).toEqual(["-dv --verbose=2", "--verify --deep --strict --verbose=2"]);
    expect(byId(r, "A-APP-METADATA").status).toBe("PASS");
    expect(byId(r, "P-INSTALLED-SMOKE").status).toBe("UNVERIFIED");
    expect(r.summary.readyForInstalledUse).toBe(false);
  });

  it("R1: intact display metadata with a failed strict verification (sealed resource) is FAIL", () => {
    const { sig } = appCase({ display, verify: ok("", "x: a sealed resource is missing or invalid\nfile modified: x/Contents/Resources/y\n", 1) });
    expect(sig).toMatchObject({ status: "FAIL", observed: { integrity: { state: "failed", reason: "sealed-resource-invalid" } } });
  });

  it("R1: a nonzero display command with plausible metadata is UNVERIFIED and contributes no fields", () => {
    const { sig } = appCase({ display: ok("", DEVELOPER_ID_DISPLAY, 1) });
    expect(sig.status).toBe("UNVERIFIED");
    expect(sig.observed.display).toEqual({ state: "display-failed" });
  });

  it("R1: missing codesign, and a bounded verification timeout or truncation, stay UNVERIFIED", () => {
    expect(appCase({ display }, ["codesign"]).sig).toMatchObject({ status: "UNVERIFIED", observed: { display: { state: "missing" }, integrity: { state: "missing" } } });
    expect(appCase({ display, verify: { state: "timeout" } }).sig).toMatchObject({ status: "UNVERIFIED", observed: { integrity: { state: "timeout" } } });
    expect(appCase({ display, verify: { state: "truncated" } }).sig.status).toBe("UNVERIFIED");
    expect(appCase({ display, verify: { state: "denied" } }).sig.status).toBe("UNVERIFIED");
  });

  it("R1: a wrong signature identifier on the app is FAIL even with verified integrity", () => {
    const { sig } = appCase({ display: ok("", DEVELOPER_ID_DISPLAY.replace("Identifier=com.herflightdeck.app", "Identifier=com.example.other"), 0) });
    expect(sig).toMatchObject({ status: "FAIL", observed: { display: { identifier: "differs-from-expected" } } });
    expect(sig.summary).toContain("signature identifier differs");
  });

  it("R1: ad hoc and unsigned apps remain FAIL", () => {
    expect(appCase({}).sig).toMatchObject({ status: "FAIL", observed: { display: { signatureKind: "adhoc", teamIdentifier: "not set", hardenedRuntime: false } } });
    expect(appCase({ display: ok("", "x: code object is not signed at all\n", 1), verify: ok("", "x: code object is not signed at all\n", 1) }).sig).toMatchObject({ status: "FAIL", observed: { display: { state: "unsigned" } } });
  });

  it("R1: a healthy signed disk image without an app runtime flag passes as a container; its inner app stays UNVERIFIED", () => {
    const responder = healthyResponder(undefined, { display: ok("", DMG_DISPLAY, 0) });
    const { d, calls } = deps({ responder });
    const r: Receipt = runPreflight({ repo: writeRepo(), artifact: syntheticDmg() }, d);
    expect(byId(r, "A-DMG-SIGNATURE")).toMatchObject({ status: "PASS", observed: { display: { hardenedRuntime: false, identifier: "present" }, integrity: { state: "verified" } } });
    expect(byId(r, "A-INNER-APP-SIGNATURE").status).toBe("UNVERIFIED");
    expect(byId(r, "A-APP-METADATA").status).toBe("UNVERIFIED");
    expect(calls.filter((c) => c.name === "codesign").map((c) => c.args.slice(0, -1).join(" "))).toEqual(["-dv --verbose=2", "--verify --strict --verbose=2"]);
    expect(calls.some((c) => c.name === "hdiutil")).toBe(false);
  });

  it("R1: an unsigned disk image is FAIL; a container failing verification is FAIL", () => {
    const unsigned = healthyResponder(undefined, { display: ok("", "x.dmg: code object is not signed at all\n", 1), verify: ok("", "x.dmg: code object is not signed at all\n", 1) });
    let r: Receipt = runPreflight({ repo: writeRepo(), artifact: syntheticDmg() }, deps({ responder: unsigned }).d);
    expect(byId(r, "A-DMG-SIGNATURE")).toMatchObject({ status: "FAIL", observed: { display: { state: "unsigned" } } });
    const broken = healthyResponder(undefined, { display: ok("", DMG_DISPLAY, 0), verify: ok("", "x.dmg: invalid signature (code or signature have been modified)\n", 3) });
    r = runPreflight({ repo: writeRepo(), artifact: syntheticDmg() }, deps({ responder: broken }).d);
    expect(byId(r, "A-DMG-SIGNATURE")).toMatchObject({ status: "FAIL", observed: { integrity: { state: "failed", reason: "signature-invalid" } } });
  });

  it("fails a bundle metadata mismatch, and Gatekeeper output is trusted only with a consistent exit code", () => {
    const { d } = deps({ responder: healthyResponder(undefined, { plist: { CFBundleIdentifier: "com.example.other" } }) });
    const r: Receipt = runPreflight({ repo: writeRepo(), app: syntheticApp(), assess: true }, d);
    expect(byId(r, "A-APP-METADATA")).toMatchObject({ status: "FAIL", observed: { bundleIdentifier: "differs-from-expected" } });
    expect(byId(r, "A-GATEKEEPER")).toMatchObject({ status: "FAIL", observed: { gatekeeper: "rejected", source: "no-usable-signature", stapledTicket: "not stapled" } });
    const inconsistent = healthyResponder((n) => (n === "spctl" ? ok("", "x: accepted\nsource=Notarized Developer ID\n", 3) : n === "stapler" ? ok("does not have a ticket stapled\n", "", 0) : undefined));
    const r2: Receipt = runPreflight({ repo: writeRepo(), app: syntheticApp(), assess: true }, deps({ responder: inconsistent }).d);
    expect(byId(r2, "A-GATEKEEPER")).toMatchObject({ status: "UNVERIFIED", observed: { gatekeeper: "unparsed", source: "unknown", stapledTicket: "unknown" } });
  });

  it("R1: plutil and lipo results count only when they exit 0", () => {
    const responder = healthyResponder((n) => (n === "plutil" ? ok("com.herflightdeck.app\n", "", 1) : undefined));
    const r: Receipt = runPreflight({ repo: writeRepo(), app: syntheticApp() }, deps({ responder }).d);
    expect(byId(r, "A-APP-METADATA").status).toBe("UNVERIFIED");
  });

  it("fails a missing artifact path", () => {
    const { d } = deps();
    const r: Receipt = runPreflight({ repo: writeRepo(), artifact: join(tempDir("none"), "absent.dmg") }, d);
    expect(byId(r, "A-EXISTS").status).toBe("FAIL");
    expect(r.summary.exitCode).toBe(EXIT.HAS_FAIL);
  });

  it("hashes only the supplied file and compares its size and SHA-256; a DMG is never mounted", () => {
    const file = syntheticDmg();
    const sha = createHash("sha256").update("synthetic artifact bytes").digest("hex");
    const { d, calls } = deps();
    const wrong: Receipt = runPreflight({ repo: writeRepo(), artifact: file, expectedSha256: "0".repeat(64), expectedSize: "1" }, d);
    expect(byId(wrong, "A-SHA256")).toMatchObject({ status: "FAIL", observed: { sha256: sha } });
    expect(byId(wrong, "A-SIZE")).toMatchObject({ status: "FAIL", observed: { bytes: 24, expected: 1 } });
    const right: Receipt = runPreflight({ repo: writeRepo(), artifact: file, expectedSha256: sha, expectedSize: "24" }, d);
    expect([byId(right, "A-SHA256").status, byId(right, "A-SIZE").status]).toEqual(["PASS", "PASS"]);
    expect(right.artifact).toMatchObject({ knownIdentity: "not a recorded identity", pathRecorded: "never", name: "not recorded" });
    expect(calls.some((c) => c.name === "hdiutil")).toBe(false);
  });
});

describe("Mac readiness preflight: privacy and read-only behavior (READINESS-R3)", () => {
  const SENTINELS = ["Private Sentinel", "Other Holder Name", "ZZZ999", "O'Brien", "secret@example.com", "private-sentinel", "sentinelflag", "/Users/", "TEAMSECRET1", "SECRET_SENTINEL", ".npmrc", "Secret Folder"];
  const expectClean = (text: string) => {
    for (const s of SENTINELS) expect(text, s).not.toContain(s);
  };

  it("R3: unknown certificate holders, authorities and assessment sources become fixed categories in JSON and text", () => {
    const leakyDisplay = [
      "Executable=/Users/private-sentinel/Secret Folder/Her.app/Contents/MacOS/x SECRET_SENTINEL",
      "Identifier=com.herflightdeck.app",
      "CodeDirectory v=1 size=1 flags=0x10000(runtime,sentinelflag) hashes=1",
      "Authority=Developer ID Application: Other Holder Name (ZZZ999)",
      "Authority=Private Sentinel Person",
      "Authority=O'Brien-Sentinel, Ltd. <secret@example.com>",
      "Authority=Apple Root CA",
      "Timestamp=now",
      "TeamIdentifier=TEAMSECRET1",
    ].join("\n");
    const responder = healthyResponder((n, a) => {
      if (n === "npm") return ok("10.9.9\nSECRET_SENTINEL token=abc /Users/private-sentinel/.npmrc\n");
      if (n === "xcode-select") return ok("/Users/private-sentinel/Developer\n");
      if (n === "sysctl") return ok("Private Sentinel\n");
      if (n === "git" && a.includes("--abbrev-ref")) return ok("private-sentinel/secret-branch\n");
      if (n === "rustc") return ok("release: 1.99.0\nhost: private-sentinel-apple-darwin\n");
      if (n === "spctl") return ok("", "/Users/private-sentinel/x: rejected\nsource=Private Sentinel Person\n", 3);
      return undefined;
    }, { display: ok("", leakyDisplay, 0) });
    const { d } = deps({ responder });
    const r: Receipt = runPreflight({ repo: writeRepo({ windowsStatus: "Private Sentinel held" }), app: syntheticApp("private-sentinel Her Flight Deck.app"), assess: true }, d);
    expectClean(JSON.stringify(r));
    expectClean(formatHuman(r));
    expect(byId(r, "A-APP-SIGNATURE").observed.display).toMatchObject({ authorityKinds: ["developer-id-application", "unknown", "unknown", "apple-root-ca"], flags: ["runtime", "other"], teamIdentifier: "present" });
    expect(byId(r, "A-GATEKEEPER").observed).toMatchObject({ gatekeeper: "rejected", source: "unknown" });
    expect(byId(r, "H-TOOLCHAIN").observed).toMatchObject({ npm: "10.9.9", rustHost: "other" });
    expect(byId(r, "R-SOURCE").observed.branch).toBe("other");
    expect(byId(r, "R-POLICY").observed.windows).toBe("other");
    expect(r.artifact).toMatchObject({ name: "not recorded" });
  });

  it("R3: recognized authority and assessment categories remain useful", () => {
    expect(preflight.authorityCategory("Developer ID Application: Anyone (ABCDE12345)")).toBe("developer-id-application");
    expect(preflight.authorityCategory("Developer ID Certification Authority")).toBe("developer-id-certification-authority");
    expect(preflight.authorityCategory("Apple Root CA")).toBe("apple-root-ca");
    expect(preflight.authorityCategory("Apple Root CA impersonator")).toBe("unknown");
    expect(preflight.assessmentSourceCategory("Notarized Developer ID")).toBe("notarized-developer-id");
    expect(preflight.assessmentSourceCategory("Unnotarized Developer ID")).toBe("unnotarized-developer-id");
    expect(preflight.assessmentSourceCategory("Private Sentinel Person")).toBe("unknown");
    const accepted = healthyResponder((n) => (n === "spctl" ? ok("", "x: accepted\nsource=Notarized Developer ID\n", 0) : n === "stapler" ? ok("The validate action worked!\n") : undefined), { display: ok("", DEVELOPER_ID_DISPLAY, 0) });
    const r: Receipt = runPreflight({ repo: writeRepo(), app: syntheticApp(), assess: true }, deps({ responder: accepted }).d);
    expect(byId(r, "A-GATEKEEPER")).toMatchObject({ status: "PASS", observed: { gatekeeper: "accepted", source: "notarized-developer-id", stapledTicket: "stapled" } });
  });

  it("R3: CLI errors never echo argument values, private paths or raw error messages", () => {
    const errors: string[] = [];
    const io = { out: () => undefined, err: (s: string) => errors.push(s), writeFile: () => { throw Object.assign(new Error("EEXIST: /Users/private-sentinel/Secret Folder/receipt.json"), { code: "EEXIST" }); } };
    expect(main(["--/Users/private-sentinel/Secret Folder"], deps().d, io)).toBe(EXIT.USAGE);
    expect(main(["--expected-sha256", "O'Brien-Sentinel <secret@example.com>", "--artifact", "x"], deps().d, io)).toBe(EXIT.USAGE);
    expect(main(["--repo", writeRepo(), "--receipt", "/Users/private-sentinel/Secret Folder/receipt.json"], deps().d, io)).toBe(EXIT.USAGE);
    const throwing = { ...deps().d, now: () => { throw new Error("SECRET_SENTINEL at /Users/private-sentinel"); } };
    expect(main(["--repo", writeRepo()], throwing, io)).toBe(EXIT.USAGE);
    expect(errors.length).toBe(4);
    expectClean(errors.join("\n"));
    expect(errors.join("\n")).toContain("EEXIST");
  });

  const ALLOWED = [
    /^git -C .+ (rev-parse HEAD|rev-parse --abbrev-ref HEAD|status --porcelain=v1)$/,
    /^sw_vers -(productVersion|buildVersion)$/,
    /^uname -m$/,
    /^sysctl -n (hw\.model|machdep\.cpu\.brand_string|sysctl\.proc_translated)$/,
    /^npm --version$/, /^rustc -vV$/, /^cargo --version$/,
    /^xcrun --show-sdk-version$/, /^xcode-select -p$/,
    /^plutil -extract (CFBundleIdentifier|LSMinimumSystemVersion|CFBundleShortVersionString|CFBundleExecutable) raw -o - .+Info\.plist$/,
    /^lipo -archs .+$/,
    /^codesign -dv --verbose=2 .+$/,
    /^codesign --verify (--deep )?--strict --verbose=2 .+$/,
  ];
  const ASSESS_ONLY = [/^spctl --assess --type (execute|open)( --context context:primary-signature)? -vv .+$/, /^stapler validate .+$/];

  it("default and artifact runs invoke only read-only allowlisted commands; assessment needs --assess", () => {
    const repo = writeRepo();
    const app = syntheticApp();
    for (const [assess, allowed] of [[false, ALLOWED], [true, [...ALLOWED, ...ASSESS_ONLY]]] as const) {
      const { d, calls, reads } = deps();
      runPreflight({ repo, app, assess }, d);
      for (const c of calls) {
        const line = `${c.name} ${c.args.join(" ")}`;
        expect(allowed.some((re) => re.test(line)), line).toBe(true);
        expect(line).not.toMatch(/hdiutil|attach|\bopen\b(?! --context)|installer|ditto|\bsecurity\b|notarytool|tauri|npm run|cargo build|--sign|\s-s\s|--force|\bgh\b|curl|defaults write|launchctl/);
      }
      expect(calls.some((c) => c.name === "spctl" || c.name === "stapler")).toBe(assess);
      for (const path of reads) expect(path.startsWith(repo) || path === `${DEFAULT_SDK}/SDKSettings.json`, path).toBe(true);
      expect(reads.some((p) => p.includes("Application Support") || p.includes("/Library/Containers"))).toBe(false);
    }
    const { d, calls } = deps();
    runPreflight({ repo }, d);
    expect(calls.some((c) => ["plutil", "lipo", "codesign", "spctl", "stapler"].includes(c.name))).toBe(false);
  });

  it("writes nothing unless --receipt names a file, and records safety flags as false", () => {
    const writes: string[] = [];
    const io = { out: () => undefined, err: () => undefined, writeFile: (p: string) => { writes.push(p); } };
    const { d } = deps();
    const repo = writeRepo();
    expect(main(["--repo", repo], d, io)).toBe(EXIT.NO_FAIL);
    expect(writes).toEqual([]);
    const receiptPath = join(tempDir("out"), "receipt.json");
    main(["--repo", repo, "--receipt", receiptPath], d, io);
    expect(writes).toEqual([receiptPath]);
    const r: Receipt = runPreflight({ repo }, d);
    expect(r.safety).toEqual({ mounted: false, installed: false, launched: false, built: false, signed: false, notarized: false, keychainOrAccountChanged: false, ciTriggered: false, providerContacted: false, appleOnlineLookupPossible: false, appProfileInspected: false });
  });
});

describe("Mac readiness preflight: CLI contract", () => {
  it("validates arguments", () => {
    expect(() => parseArgs(["--expected-sha256", "abc", "--artifact", "x"])).toThrow(/64 hex/);
    expect(() => parseArgs(["--assess"])).toThrow(/needs --artifact or --app/);
    expect(() => parseArgs(["--artifact", "a", "--app", "b"])).toThrow(/not both/);
    expect(() => parseArgs(["--expected-size", "12"])).toThrow(/need --artifact/);
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown option/);
  });

  it("documents its exit codes through the real script: usage 2, help 0, a FAIL 1 with a parseable receipt", () => {
    const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", timeout: 60_000 });
    const usage = run(["--bogus-/Users/private-sentinel"]);
    expect(usage.status).toBe(2);
    expect(usage.stderr).not.toContain("private-sentinel");
    const help = run(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Exit codes");
    const mismatch = run(["--repo", writeRepo({ tauriVersion: "9.9.9" }), "--json"]);
    expect(mismatch.status).toBe(1);
    const receipt = JSON.parse(mismatch.stdout) as Receipt;
    expect(receipt.schema).toBe("hfd-mac-readiness-preflight/2");
    expect(receipt.checks.find((c) => c.id === "R-VERSION")?.status).toBe("FAIL");
  });
});
