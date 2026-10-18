#!/usr/bin/env node
/**
 * Records the scratch engine actually installed in THIS pack: exact resolution from the committed
 * lockfile, digest of every artifact the proof loads, license inventory read from the installed
 * package itself, and the measured behaviour of each entrypoint on the current engine.
 *
 * Usage: node scripts/record-scratch-artifacts.mjs
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packRoot = path.resolve(here, "..");
const engineDir = path.join(packRoot, "scratch", "pdfjs-engine");
const nm = path.join(engineDir, "node_modules");
const pkgDir = path.join(nm, "pdfjs-dist");
const lock = JSON.parse(fs.readFileSync(path.join(engineDir, "package-lock.json"), "utf8"));
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

if (!fs.existsSync(pkgDir)) {
  console.error(`scratch engine not installed at ${pkgDir}; run npm ci --prefix ${path.relative(process.cwd(), engineDir)}`);
  process.exit(1);
}

const installed = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const packages = {};
for (const [key, val] of Object.entries(lock.packages ?? {})) {
  if (!key.startsWith("node_modules/")) continue;
  const name = key.replace("node_modules/", "");
  if (name.includes("/node_modules/")) continue; // record only top-level resolutions
  packages[name] = { version: val.version, integrity: val.integrity ?? null, resolved: val.resolved ?? null, optional: Boolean(val.optional) };
}

const assetPaths = [
  "build/pdf.mjs",
  "build/pdf.worker.mjs",
  "legacy/build/pdf.mjs",
  "legacy/build/pdf.worker.mjs",
  "LICENSE",
];
const evaluated_assets = {};
for (const rel of assetPaths) {
  const p = path.join(pkgDir, rel);
  if (!fs.existsSync(p)) continue;
  evaluated_assets[rel] = { sha256: sha(p), bytes: fs.statSync(p).size };
}

// License inventory read from the installed package, not from a moving URL.
const licenseFiles = ["LICENSE"].filter((f) => fs.existsSync(path.join(pkgDir, f))).map((f) => {
  const p = path.join(pkgDir, f);
  return { path: `pdfjs-dist/${f}`, sha256: sha(p), firstLine: fs.readFileSync(p, "utf8").split("\n")[0].trim() };
});
for (const [name, meta] of Object.entries(packages)) {
  const p = path.join(nm, name, "LICENSE");
  if (fs.existsSync(p) && !licenseFiles.some((x) => x.path === `${name}/LICENSE`)) {
    licenseFiles.push({ path: `${name}/LICENSE`, sha256: sha(p), firstLine: fs.readFileSync(p, "utf8").split("\n")[0].trim() });
  }
}

// Measure this engine's behaviour per entrypoint, one process each.
const measure = (entryRel) => {
  const r = spawnSync(
    process.execPath,
    [path.join(packRoot, "scripts", "parser-entrypoint.mjs"), entryRel === "legacy/build/pdf.mjs" ? "legacy" : "modern"],
    { encoding: "utf-8", cwd: packRoot }
  );
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* crash output is not JSON */ }
  return {
    entrypoint: entryRel,
    runtime: `Node.js ${process.version}`,
    exit: r.status,
    status: r.status === 0 ? "PASS" : parsed?.status === "ENGINE_FAILURE" || r.status !== 0 ? "ENGINE_FAILURE" : "FAIL",
    fixtures: parsed?.results?.map((x) => ({ file: x.file, pageCount: x.pageCount ?? null, rejected: x.errorType ?? null, success: x.success })) ?? null,
    corruption: parsed?.corruption ?? null,
    error: parsed?.error ?? (r.status === 0 ? null : r.stderr.split("\n").find((l) => /TypeError|Error:/.test(l)) ?? null),
  };
};

const out = {
  engine: "pdfjs-dist",
  version: installed.version,
  scope: `scratch evaluation; installed into ${path.relative(process.cwd(), engineDir)}/node_modules by npm ci from the committed lockfile`,
  production_impact: "None. No dependency added to the root package.json or src-tauri/Cargo.toml.",
  // A description only (M4-R35). This recorder never runs npm, so it records no exit status and
  // proves nothing about an install. Reuse is attested only by the runner's install-execution.json.
  installCommand: `npm ci --prefix ${path.relative(process.cwd(), engineDir)} --no-audit --no-fund`,
  installNodeVersion: process.version,
  installEvidence: "not recorded here; see scratch/pdfjs-engine/install-execution.json written by run_integration_proof.mjs --install",
  recordedAt: new Date().toISOString(),
  lockfile: { path: "scratch/pdfjs-engine/package-lock.json", sha256: sha(path.join(engineDir, "package-lock.json")) },
  packageJson: { path: "scratch/pdfjs-engine/package.json", sha256: sha(path.join(engineDir, "package.json")), pins: installed.dependencies },
  packages,
  evaluated_assets,
  license_files: licenseFiles,
  runtime_evaluation: { legacy: measure("legacy/build/pdf.mjs"), modern: measure("build/pdf.mjs") },
  limitations: [
    "Node parsing only: no measurement of browser buffer release, canvas rasterisation or WKWebView compatibility.",
    "Task handles are destroyed in finally on both the success and the rejection path; that is a resource-ownership statement, not a measured buffer-release claim.",
  ],
};

const target = path.join(engineDir, "scratch-artifacts.json");
fs.writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
console.log(`scratch-artifacts.json recorded: version ${out.version}, ${Object.keys(packages).length} packages, ${Object.keys(evaluated_assets).length} assets, legacy=${out.runtime_evaluation.legacy.status} modern=${out.runtime_evaluation.modern.status}`);
