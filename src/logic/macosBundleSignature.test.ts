import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const read = (path: string) => readFileSync(resolve(path), "utf8");
const script = "scripts/verify-macos-bundle-signature.sh";

describe("macOS release bundle signing", () => {
  it("requests a full ad-hoc bundle signature without changing app identity or minimum OS", () => {
    const config = JSON.parse(read("src-tauri/tauri.conf.json"));
    expect(config.bundle.macOS.signingIdentity).toBe("-");
    expect(config.bundle.macOS.minimumSystemVersion).toBe("12.0");
    expect(config.identifier).toBe("com.herflightdeck.app");
  });

  it.each([
    [".github/workflows/release.yml", "build"],
    [".github/workflows/build-desktop.yml", "build-macos"],
  ])("%s gates macOS immediately after build and before upload", (path, job) => {
    const workflow = YAML.parse(read(path));
    const steps = workflow.jobs[job].steps as Array<{
      run?: string; uses?: string; if?: string; shell?: string;
      "continue-on-error"?: boolean;
    }>;
    const build = steps.findIndex((step) => step.run?.includes("npm run tauri build"));
    const gate = steps.findIndex((step) => step.run?.includes(script));
    const upload = steps.findIndex((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(build).toBeGreaterThanOrEqual(0);
    expect(gate).toBe(build + 1);
    expect(upload).toBeGreaterThan(gate);
    const signatureStep = steps[gate];
    if (!signatureStep) throw new Error("Signature gate missing");
    expect(signatureStep.run).toBe(`bash ${script} src-tauri/target/release/bundle/dmg`);
    expect(signatureStep.shell).toBe("bash");
    expect(signatureStep["continue-on-error"]).toBeUndefined();
    if (job === "build") expect(signatureStep.if).toBe("runner.os == 'macOS'");
    else expect(signatureStep.if).toBeUndefined();
  });

  it("keeps strict verification and all signature metadata guards in the script", () => {
    const source = read(script);
    for (const guard of ["set -euo pipefail", "--verify --deep --strict", "codesign -dvvv", "Sealed Resources version=", "linker-signed", "Info.plist=not bound", "trap cleanup EXIT", "hdiutil attach -nobrowse -readonly -mountpoint"]) {
      expect(source).toContain(guard);
    }
  });

  it("permanently retires damaged 0.5.8 and rejects it through the actual CLI", () => {
    const policy = JSON.parse(read("scripts/release-policy.json"));
    const entry = policy.retiredVersions.find((item: { version: string }) => item.version === "0.5.8");
    expect(entry?.retiredAt).toBe("2026-10-21");
    expect(entry?.reason).toMatch(/linker-signed.*damaged/);
    expect(entry?.reason).toMatch(/superseded by 0\.5\.9.*never.*reused/);
    const result = spawnSync(process.execPath, [resolve("scripts/check-release-version.mjs"), "0.5.8"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("0.5.8 is permanently retired");
  });

  it("sets the Mac release candidate to 0.5.9", () => {
    expect(JSON.parse(read("scripts/release-policy.json")).platformDistribution.macos.candidateVersion).toBe("0.5.9");
  });

  it("adds checksum-first owner-assisted first-launch guidance only to the macOS-only notes", () => {
    const workflow = read(".github/workflows/release.yml");
    const macOnly = workflow.slice(workflow.indexOf('if [ "$HAS_MAC" = true ] && [ "$HAS_WIN" = false ]; then'), workflow.indexOf('elif [ "$HAS_MAC" = true ]'));
    expect(macOnly).toContain("On first launch, macOS may say it can't verify the developer");
    expect(macOnly).toContain("after the checksum matches, I'll help you open it through System Settings → Privacy & Security → Open Anyway.");
  });

  it.each([".github/workflows/release.yml", ".github/workflows/build-desktop.yml", "docs/RELEASE_NOTES_0.5.9.md", script])("%s contains no prohibited platform-protection commands", (path) => {
    expect(read(path)).not.toMatch(/xattr|com\.apple\.quarantine|spctl/i);
  });
});

const sealed = "Signature=adhoc\nSealed Resources version=2 rules=13 files=5\nInfo.plist entries=20\n";

// These doubles exercise the actual shell script, including mount cleanup,
// without mounting images or signing/launching any application.
function audit(options: {
  details?: string; verifyExit?: string; displayExit?: string;
  staged?: boolean; noApp?: boolean;
  noDmg?: boolean; attachExit?: string; detachExit?: string;
  secondDetails?: string;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "hfd-signature-test-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "calls.log");
  const executable = (name: string, body: string) => writeFileSync(join(bin, name), `#!${process.execPath}\n${body}`, { mode: 0o755 });
  executable("codesign", `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.AUDIT_LOG, JSON.stringify(['codesign', ...args]) + '\\n');
if (args[0] === '--verify') {
  if (!['--deep', '--strict', '--verbose=2'].every(flag => args.includes(flag))) process.exit(9);
  process.exit(Number(process.env.VERIFY_EXIT));
}
if (args[0] !== '-dvvv') process.exit(8);
process.stderr.write(process.env.DETAILS);
process.exit(Number(process.env.DISPLAY_EXIT));
`);
  executable("hdiutil", `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.AUDIT_LOG, JSON.stringify(['hdiutil', ...args]) + '\\n');
if (args[0] === 'attach') {
  if (process.env.ATTACH_EXIT !== '0') process.exit(Number(process.env.ATTACH_EXIT));
  if (process.env.NO_APP !== 'true') fs.mkdirSync(path.join(args[args.indexOf('-mountpoint') + 1], 'Her Flight Deck.app'));
} else if (args[0] === 'detach') {
  if (process.env.DETACH_EXIT !== '0') process.exit(Number(process.env.DETACH_EXIT));
  fs.rmSync(path.join(args[1], 'Her Flight Deck.app'), { recursive: true, force: true });
} else process.exit(7);
`);
  // For multiple DMGs the codesign double chooses metadata using the attach log.
  if (options.secondDetails !== undefined) {
    const path = join(bin, "codesign");
    writeFileSync(path, readFileSync(path, "utf8").replace("process.stderr.write(process.env.DETAILS);", "process.stderr.write(fs.readFileSync(process.env.AUDIT_LOG, 'utf8').includes('second.dmg') ? process.env.SECOND_DETAILS : process.env.DETAILS);"));
  }
  const dmgDir = join(root, "images");
  mkdirSync(dmgDir);
  if (!options.noDmg) writeFileSync(join(dmgDir, "first.dmg"), "synthetic image");
  if (options.secondDetails !== undefined) writeFileSync(join(dmgDir, "second.dmg"), "synthetic image");
  if (options.staged) mkdirSync(join(root, "src-tauri/target/release/bundle/macos/Staged.app"), { recursive: true });
  try {
    const result = spawnSync("bash", [resolve(script), dmgDir], {
      cwd: root, encoding: "utf8", env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root,
        AUDIT_LOG: log, DETAILS: options.details ?? sealed,
        VERIFY_EXIT: options.verifyExit ?? "0", DISPLAY_EXIT: options.displayExit ?? "0",
        ATTACH_EXIT: options.attachExit ?? "0", DETACH_EXIT: options.detachExit ?? "0",
        NO_APP: String(options.noApp ?? false), SECOND_DETAILS: options.secondDetails,
      },
    });
    let calls: string[][] = [];
    try { calls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)); } catch { /* No tool calls for invalid inputs. */ }
    return { status: result.status, output: result.stdout + result.stderr, calls };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("signature gate execution", () => {
  it("verifies both staged and packaged bundles using strict deep verification", () => {
    const result = audit({ staged: true });
    expect(result.status, result.output).toBe(0);
    const verifies = result.calls.filter((args) => args[1] === "--verify");
    expect(verifies).toHaveLength(2);
    expect(verifies[0]?.at(-1)).toContain("/bundle/macos/Staged.app");
    expect(verifies[1]?.at(-1)).toContain("/Her Flight Deck.app");
    expect(result.calls.filter((args) => args[0] === "hdiutil").map((args) => args[1])).toEqual(["attach", "detach"]);
  });

  it.each([
    ["missing resource seal", { details: "Signature=adhoc\nInfo.plist entries=20\n" }, "Missing Sealed Resources"],
    ["linker signature even with a seal", { details: sealed + "flags=0x20002(adhoc,linker-signed)\n" }, "Rejected linker-signed"],
    ["unbound plist even with a seal", { details: sealed + "Info.plist=not bound\n" }, "Info.plist=not bound"],
    ["invalid strict verification", { verifyExit: "1" }, "Strict bundle signature verification failed"],
    ["failed signature inspection", { displayExit: "1" }, "Could not inspect bundle signature"],
    ["missing app inside image", { noApp: true }, "No .app found inside DMG"],
    ["failed image attachment", { attachExit: "1" }, "Could not attach DMG"],
    ["failed image detachment", { detachExit: "1" }, "Could not detach DMG"],
  ] as const)("fails closed for %s and attempts detach", (_label, options, message) => {
    const result = audit(options);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain(`::error::${message}`);
    expect(result.calls.some((args) => args[0] === "hdiutil" && args[1] === "detach")).toBe(true);
  });

  it("does not skip a broken second DMG", () => {
    const result = audit({ secondDetails: "flags=0x20002(adhoc,linker-signed)\nInfo.plist=not bound\n" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("Rejected linker-signed");
    expect(result.calls.filter((args) => args[1] === "attach")).toHaveLength(2);
    expect(result.calls.filter((args) => args[1] === "detach")).toHaveLength(2);
  });

  it("accepts a missing staged app when the DMG passes", () => {
    const result = audit();
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("No staged .app found");
    expect(result.output).toContain("continuing with mandatory DMG verification");
    expect(result.output).not.toContain("::error::");
    const verifies = result.calls.filter((args) => args[1] === "--verify");
    expect(verifies).toHaveLength(1);
    expect(verifies[0]).toEqual(["codesign", "--verify", "--deep", "--strict", "--verbose=2", expect.stringContaining("/Her Flight Deck.app")]);
    expect(result.calls.filter((args) => args[1] === "-dvvv")).toHaveLength(1);
    expect(result.calls.filter((args) => args[0] === "hdiutil").map((args) => args[1])).toEqual(["attach", "detach"]);
  });

  it("fails closed when no DMG was produced", () => {
    const result = audit({ noDmg: true });
    expect(result.status).toBe(1);
    expect(result.output).toContain("::error::No DMGs found");
  });
});
