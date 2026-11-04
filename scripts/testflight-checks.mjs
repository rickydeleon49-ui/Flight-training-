// Pre-upload checks for a TestFlight .ipa. Pure helpers are exported for tests;
// the CLI unpacks the ipa with system tools: node scripts/testflight-checks.mjs <ipa> <lastBuildFile> [--record]
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

export const REQUIRED_INFO_KEYS = [
  "CFBundleIdentifier",
  "CFBundleShortVersionString",
  "CFBundleVersion",
  "ITSAppUsesNonExemptEncryption",
  "UILaunchStoryboardName",
  "MinimumOSVersion",
];

export function checkInfoPlist(info) {
  const problems = REQUIRED_INFO_KEYS.filter((key) => info?.[key] === undefined).map((key) => `Info.plist is missing ${key}`);
  if (info?.CFBundleIdentifier && info.CFBundleIdentifier !== "com.herflightdeck.app") {
    problems.push(`bundle id is ${info.CFBundleIdentifier}, expected com.herflightdeck.app`);
  }
  if (info?.CFBundleVersion !== undefined && !/^\d+$/.test(String(info.CFBundleVersion))) {
    problems.push(`CFBundleVersion ${info.CFBundleVersion} is not a whole number`);
  }
  return problems;
}

// PNG color type 4 (gray+alpha) or 6 (RGBA), or a tRNS chunk, means transparency.
export function pngHasAlpha(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length < 33 || signature.some((byte, i) => buffer[i] !== byte)) {
    throw new Error("not a PNG file");
  }
  const colorType = buffer[25];
  if (colorType === 4 || colorType === 6) return true;
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    if (type === "tRNS") return true;
    if (type === "IDAT") break;
    offset += 12 + length;
  }
  return false;
}

export function checkBuildIncreased(build, lastBuild) {
  const now = Number(build);
  if (!Number.isInteger(now)) return [`build number ${build} is not a whole number`];
  if (lastBuild === undefined || lastBuild === null || lastBuild === "") return [];
  const last = Number(lastBuild);
  return now > last ? [] : [`build ${now} is not greater than the last recorded upload ${last}`];
}

export function checkSigning(codesignOutput) {
  return /Authority=Apple Distribution/.test(codesignOutput) ? [] : ["codesign does not show an Apple Distribution authority"];
}

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function runWithStderr(command, args) {
  try {
    const out = execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return out;
  } catch (err) {
    return `${err.stdout || ""}${err.stderr || ""}`;
  }
}

export function checkIpa(ipa, lastBuildFile) {
  const dir = mkdtempSync(join(tmpdir(), "hfd-ipa-"));
  const problems = [];
  let build;
  try {
    run("unzip", ["-q", ipa, "-d", dir]);
    const appDir = join(dir, "Payload", readdirSync(join(dir, "Payload")).find((n) => n.endsWith(".app")));
    if (!existsSync(join(appDir, "PrivacyInfo.xcprivacy"))) problems.push("PrivacyInfo.xcprivacy is not in the app");
    const info = JSON.parse(run("plutil", ["-convert", "json", "-o", "-", join(appDir, "Info.plist")]));
    problems.push(...checkInfoPlist(info));
    build = info.CFBundleVersion;
    const icons = readdirSync(appDir).filter((n) => /^AppIcon.*\.png$/.test(n));
    if (icons.length === 0) console.warn("note: no loose AppIcon png in the app (icons are in Assets.car); alpha not checked here");
    for (const icon of icons) {
      if (pngHasAlpha(readFileSync(join(appDir, icon)))) problems.push(`${icon} has an alpha channel`);
    }
    problems.push(...checkSigning(runWithStderr("codesign", ["-dv", "--verbose=4", appDir])));
    const last = existsSync(lastBuildFile) ? readFileSync(lastBuildFile, "utf8").trim() : undefined;
    problems.push(...checkBuildIncreased(build, last));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { problems, build };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [ipa, lastBuildFile, flag] = process.argv.slice(2);
  if (!ipa || !lastBuildFile) {
    console.error("Usage: node scripts/testflight-checks.mjs <ipa> <last-build-file> [--record]");
    exit(2);
  }
  try {
    const { problems, build } = checkIpa(ipa, lastBuildFile);
    if (problems.length) {
      for (const p of problems) console.error(`FAIL: ${p}`);
      exit(1);
    }
    console.log(`OK: ipa passes the pre-upload checks (build ${build})`);
    if (flag === "--record") {
      writeFileSync(lastBuildFile, `${build}\n`);
      console.log(`Recorded build ${build} in ${lastBuildFile}`);
    }
  } catch (err) {
    console.error(`FAIL: ${err.message}`);
    exit(1);
  }
}
