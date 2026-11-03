#!/usr/bin/env node
// Generates public/THIRD_PARTY_NOTICES.txt from the lockfiles.
//
//   node scripts/third-party-notices.mjs            rewrite the notices file
//   node scripts/third-party-notices.mjs --check    exit 1 if the file is stale
//   node scripts/third-party-notices.mjs --report   also list how each license file was read
//
// Inputs: package-lock.json production packages (read from node_modules, so run
// `npm ci` first), `cargo metadata --locked` for every crate in Cargo.lock, the
// standard license texts in scripts/license-texts/, and the hand-written entries
// for bundled data below. The output is deterministic: no dates, no local paths.
//
// A package license file is shown as "standard text" only when it contains the
// whole standard text for a license the package declares and every other line
// is a copyright line, a title, or boilerplate from that same license. Anything
// else is copied verbatim, so no extra terms are ever dropped.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const NOTICES_PATH = "public/THIRD_PARTY_NOTICES.txt";
const TEXTS_DIR = join(ROOT, "scripts/license-texts");
const RULE = "-".repeat(79);

// Packages whose metadata lacks a license id. Keyed by exact version so an
// upgrade forces someone to look at the new release's license again.
export const LICENSE_OVERRIDES = {
  "npm:suncalc@2.1.1": {
    license: "BSD-2-Clause",
    reason: "package.json has no license field; its LICENSE file is the BSD 2-Clause text",
  },
};

// Order of preference when a package offers a choice (A OR B).
const PREFERENCE = [
  "MIT", "Apache-2.0", "BSD-3-Clause", "BSD-2-Clause", "ISC", "Zlib", "0BSD", "MIT-0",
  "Unlicense", "BSL-1.0", "CC0-1.0", "Unicode-3.0", "Apache-2.0 WITH LLVM-exception", "MPL-2.0",
  "CDLA-Permissive-2.0", "OFL-1.1",
];

// Standard texts. `core` lists [start, end] phrases; that span of the standard
// text must appear, unchanged apart from spacing and punctuation, in a package
// file for the file to count as that license.
const CANON = {
  MIT: { files: ["MIT.txt"], core: [["Permission is hereby granted", "DEALINGS IN THE SOFTWARE"]] },
  "Apache-2.0": { files: ["Apache-2.0.txt"], core: [["TERMS AND CONDITIONS FOR USE", "END OF TERMS AND CONDITIONS"]] },
  "Apache-2.0 WITH LLVM-exception": {
    files: ["Apache-2.0.txt", "LLVM-exception.txt"],
    core: [
      ["TERMS AND CONDITIONS FOR USE", "END OF TERMS AND CONDITIONS"],
      ["As an exception, if, as a result", "with respect to the Combined Software"],
    ],
  },
  "BSD-2-Clause": { files: ["BSD-2-Clause.txt"], core: [["Redistribution and use", "SUCH DAMAGE"]] },
  "BSD-3-Clause": { files: ["BSD-3-Clause.txt"], core: [["Redistribution and use", "SUCH DAMAGE"]] },
  ISC: { files: ["ISC.txt"], core: [["Permission to use", "PERFORMANCE OF THIS SOFTWARE"]] },
  "0BSD": { files: ["0BSD.txt"], core: [["Permission to use", "PERFORMANCE OF THIS SOFTWARE"]] },
  Zlib: { files: ["Zlib.txt"], core: [["This software is provided", "any source distribution"]] },
  Unlicense: { files: ["Unlicense.txt"], core: [["This is free and unencumbered", "OTHER DEALINGS IN THE SOFTWARE"]] },
  "BSL-1.0": { files: ["BSL-1.0.txt"], core: [["Permission is hereby granted", "DEALINGS IN THE SOFTWARE"]] },
  "CC0-1.0": { files: ["CC0-1.0.txt"], core: [["Statement of Purpose", "the Work"]] },
  "MPL-2.0": { files: ["MPL-2.0.txt"], core: [["1. Definitions", "defined by the Mozilla Public License, v. 2.0"]] },
  "CDLA-Permissive-2.0": { files: ["CDLA-Permissive-2.0.txt"], core: [["This is the Community Data License", "models' insights"]] },
  "Unicode-3.0": { files: ["Unicode-3.0.txt"], core: [["NOTICE TO USER", "authorization of the copyright holder"]] },
  "OFL-1.1": { files: ["OFL-1.1.txt"], core: [["PREAMBLE", "OTHER DEALINGS IN THE FONT SOFTWARE"]] },
};

const LICENSE_FILE_RE = /^(licen[cs]e|copying|copyright|notice|unlicense|authors|patents)/i;

// "https" and "http" links count as the same text.
export const norm = (s) => s.toLowerCase().replace(/https:\/\//g, "http://").replace(/[^a-z0-9]/g, "");
const clean = (s) => s.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
const tidy = (s) => clean(s).split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/^\n+|\n+$/g, "");
const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- SPDX ----

export function parseSpdx(expression) {
  const src = expression.replace(/\s*\/\s*/g, " OR ");
  const tokens = src.match(/\(|\)|[A-Za-z0-9.+-]+/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const take = (want) => {
    const t = tokens[i++];
    if (want && t !== want) throw new Error(`Bad license expression "${expression}"`);
    return t;
  };
  const atom = () => {
    if (peek() === "(") {
      take("(");
      const inner = or();
      take(")");
      return inner;
    }
    const id = take();
    if (!id || ["AND", "OR", "WITH", ")"].includes(id)) throw new Error(`Bad license expression "${expression}"`);
    if (peek() === "WITH") {
      take("WITH");
      return { id: `${id} WITH ${take()}` };
    }
    return { id };
  };
  const and = () => {
    const parts = [atom()];
    while (peek() === "AND") { take(); parts.push(atom()); }
    return parts.length === 1 ? parts[0] : { and: parts };
  };
  const or = () => {
    const parts = [and()];
    while (peek() === "OR") { take(); parts.push(and()); }
    return parts.length === 1 ? parts[0] : { or: parts };
  };
  const tree = or();
  if (i !== tokens.length) throw new Error(`Bad license expression "${expression}"`);
  return tree;
}

const rank = (id) => {
  const r = PREFERENCE.indexOf(id);
  return r === -1 ? 1000 : r;
};

/** The license ids this app uses a package under (all must be honoured). */
export function electLicenses(expression) {
  const pick = (node) => {
    if (node.id) return [node.id];
    if (node.and) return [...new Set(node.and.flatMap(pick))];
    const options = node.or.map(pick);
    const score = (ids) => [ids.length, ids.reduce((s, id) => s + rank(id), 0)];
    options.sort((a, b) => {
      const [la, ra] = score(a);
      const [lb, rb] = score(b);
      return la - lb || ra - rb;
    });
    return options[0];
  };
  return pick(parseSpdx(expression));
}

/** Every id the expression mentions (a file may carry any of them). */
export function allLicenseIds(expression) {
  const walk = (node) => (node.id ? [node.id] : (node.and ?? node.or).flatMap(walk));
  return [...new Set(walk(parseSpdx(expression)))];
}

// -------------------------------------------------------- classifying ----

const canonCache = new Map();
function canon(id, textsDir = TEXTS_DIR) {
  const key = `${textsDir}\0${id}`;
  if (canonCache.has(key)) return canonCache.get(key);
  const def = CANON[id];
  let value = null;
  if (def) {
    const full = def.files.map((f) => tidy(readFileSync(join(textsDir, f), "utf8"))).join("\n\n");
    const fullNorm = norm(full);
    let from = 0;
    const core = def.core.map(([start, end]) => {
      const s = fullNorm.indexOf(norm(start), from);
      const e = fullNorm.lastIndexOf(norm(end));
      if (s < 0 || e < s) throw new Error(`Standard text for ${id} lacks its marker phrases`);
      from = e + norm(end).length;
      return fullNorm.slice(s, from);
    });
    value = { full, fullNorm, core };
  }
  canonCache.set(key, value);
  return value;
}

const isCopyrightLine = (line) => /copyright|\(c\)|©|all rights reserved/i.test(line);
// In a verbatim file only lines that open like a real notice ("Copyright 2019 X",
// "Copyright (c) X", "(c) 2020 X") are lifted into the entry; the file itself is in Part 5.
const isNoticeLine = (line) => /^(copyright\s*(\(c\)|©|\d)|\(c\)\s*\d|©\s*\d)/i.test(line);
// A bare heading such as "The MIT License (MIT)" or "BSD 3-Clause License": it must
// end with the word License (plus an optional short id in brackets) and be short.
const isTitleLine = (line) =>
  /^[#\s(]*(the\s+)?[A-Za-z0-9.\- ]{1,30}\s+licen[cs]e(\s*\([A-Za-z0-9.\-]+\))?\)?\s*$/i.test(line) && line.trim().split(/\s+/).length <= 6;

/**
 * Returns { copyrights, dropped } when `text` is the standard `id` text plus
 * copyright/title/boilerplate lines, else null.
 */
export function matchStandard(text, id, textsDir = TEXTS_DIR) {
  const c = canon(id, textsDir);
  if (!c) return null;
  const lines = tidy(text).split("\n");
  const norms = lines.map(norm);
  const starts = [];
  let F = "";
  for (const n of norms) { starts.push(F.length); F += n; }
  const ranges = [];
  let pos = 0;
  for (const seg of c.core) {
    const at = F.indexOf(seg, pos);
    if (at < 0) return null;
    ranges.push([at, at + seg.length]);
    pos = at + seg.length;
  }
  const copyrights = [];
  const dropped = [];
  for (let i = 0; i < lines.length; i++) {
    if (!norms[i]) continue;
    const a = starts[i];
    const b = a + norms[i].length;
    let outside = "";
    let cursor = a;
    for (const [rs, re] of ranges) {
      if (re <= cursor || rs >= b) continue;
      if (rs > cursor) outside += F.slice(cursor, rs);
      cursor = Math.max(cursor, re);
    }
    if (cursor < b) outside += F.slice(cursor, b);
    if (!outside) continue;
    const line = lines[i].trim();
    if (outside.length === norms[i].length) {
      if (c.fullNorm.includes(outside)) continue;
      if (isCopyrightLine(line)) { copyrights.push(line); continue; }
      if (isTitleLine(line)) { dropped.push(line); continue; }
      return null;
    }
    if (!c.fullNorm.includes(outside)) return null;
  }
  return { copyrights, dropped };
}

/** Reads a package's license files: standard ones become references, others are kept verbatim. */
export function readLicenseFiles(dir, ids, textsDir = TEXTS_DIR) {
  const files = existsSync(dir)
    ? readdirSync(dir).filter((f) => LICENSE_FILE_RE.test(f) && !/\.spdx$/i.test(f) && statSync(join(dir, f)).isFile()).sort(byKey)
    : [];
  const ordered = [...ids].sort((a, b) => (b.includes(" WITH ") ? 1 : 0) - (a.includes(" WITH ") ? 1 : 0) || rank(a) - rank(b));
  const out = [];
  for (const file of files) {
    const text = clean(readFileSync(join(dir, file), "utf8"));
    if (!text.trim()) continue;
    let hit = null;
    for (const id of ordered) {
      const m = matchStandard(text, id, textsDir);
      if (m) { hit = { file, id, ...m }; break; }
    }
    out.push(hit ?? { file, verbatim: tidy(text), copyrights: tidy(text).split("\n").map((l) => l.trim()).filter(isNoticeLine) });
  }
  return out;
}

// ------------------------------------------------------------ packages ----

const repoUrl = (repo) => {
  const raw = typeof repo === "string" ? repo : repo?.url;
  if (!raw) return null;
  return raw.replace(/^git\+/, "").replace(/\.git$/, "").replace(/^git:\/\//, "https://").replace(/^github:/, "https://github.com/");
};
const personName = (p) => (typeof p === "string" ? p : p?.name ? [p.name, p.email && `<${p.email}>`].filter(Boolean).join(" ") : null);

function npmPackages(root) {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const out = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || entry.dev || entry.devOptional || entry.link) continue;
    const name = entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    const dir = join(root, path);
    if (!existsSync(join(dir, "package.json"))) {
      throw new Error(`${name} ${entry.version} is a production dependency but ${path} is missing; run npm ci`);
    }
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const declared = entry.license ?? (typeof pkg.license === "string" ? pkg.license : null);
    const key = `npm:${name}@${entry.version}`;
    const override = LICENSE_OVERRIDES[key];
    if (declared && override) throw new Error(`${key} now declares "${declared}"; remove its LICENSE_OVERRIDES entry`);
    const license = declared ?? override?.license;
    if (!license) throw new Error(`${key} declares no license; check it by hand and add a LICENSE_OVERRIDES entry`);
    out.push({
      eco: "npm",
      name,
      version: entry.version,
      license,
      note: override?.reason ?? null,
      source: entry.resolved ?? null,
      repository: repoUrl(pkg.repository),
      authors: [personName(pkg.author)].filter(Boolean),
      dir,
      testOnly: false,
    });
  }
  return out;
}

function cargoPackages(meta) {
  const members = new Set(meta.workspace_members);
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const shipped = new Set();
  const stack = [...members];
  while (stack.length) {
    const id = stack.pop();
    if (shipped.has(id)) continue;
    shipped.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      const kinds = dep.dep_kinds.map((k) => k.kind);
      if (members.has(id) && kinds.every((k) => k === "dev")) continue;
      stack.push(dep.pkg);
    }
  }
  return meta.packages
    .filter((p) => !members.has(p.id))
    .map((p) => {
      const key = `crate:${p.name}@${p.version}`;
      const license = p.license ?? LICENSE_OVERRIDES[key]?.license;
      if (!license) throw new Error(`${key} declares no SPDX license; check it by hand and add a LICENSE_OVERRIDES entry`);
      const fromRegistry = p.source?.startsWith("registry+");
      return {
        eco: "crate",
        name: p.name,
        version: p.version,
        license,
        note: LICENSE_OVERRIDES[key]?.reason ?? null,
        source: fromRegistry ? `https://crates.io/crates/${p.name}/${p.version}` : p.source,
        download: fromRegistry ? `https://static.crates.io/crates/${p.name}/${p.name}-${p.version}.crate` : null,
        repository: p.repository ?? null,
        authors: p.authors ?? [],
        dir: dirname(p.manifest_path),
        testOnly: !shipped.has(p.id),
      };
    });
}

function loadCargoMetadata(root) {
  const json = execFileSync(
    "cargo",
    ["metadata", "--format-version", "1", "--locked", "--manifest-path", join(root, "src-tauri/Cargo.toml")],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] },
  );
  return JSON.parse(json);
}

// -------------------------------------------------------- bundled data ----

function bundledEntries(root, packages) {
  const find = (eco, name) => packages.find((p) => p.eco === eco && p.name === name);
  const airport = readFileSync(join(root, "scripts/build-airport-coords.mjs"), "utf8");
  const commit = /SOURCE_COMMIT = "([0-9a-f]{40})"/.exec(airport)?.[1];
  const sha = /SOURCE_SHA256 = "([0-9a-f]{64})"/.exec(airport)?.[1];
  if (!commit || !sha) throw new Error("scripts/build-airport-coords.mjs lost its SOURCE_COMMIT/SOURCE_SHA256");
  const entries = [];

  for (const [pkgName, family] of [["@fontsource/inter", "Inter"], ["@fontsource-variable/fraunces", "Fraunces"]]) {
    const p = find("npm", pkgName);
    if (!p) throw new Error(`${pkgName} is no longer a production dependency; update bundledEntries()`);
    const files = readLicenseFiles(p.dir, ["OFL-1.1"]);
    const copyrights = [...new Set(files.flatMap((f) => f.copyrights))];
    entries.push([
      `${family} typeface (font files bundled via ${pkgName} ${p.version})`,
      `License: OFL-1.1 (SIL Open Font License 1.1; full text in Part 6)`,
      ...copyrights,
      "The fonts are embedded in the app unchanged. They may be bundled with software but",
      "not sold by themselves; see the license for the full terms.",
    ]);
  }

  const sqlite = find("crate", "libsqlite3-sys");
  if (sqlite) {
    const header = join(sqlite.dir, "sqlite3/sqlite3.h");
    const version = existsSync(header) ? /#define SQLITE_VERSION\s+"([^"]+)"/.exec(readFileSync(header, "utf8"))?.[1] : null;
    entries.push([
      `SQLite${version ? ` ${version}` : ""} (compiled into the app by libsqlite3-sys ${sqlite.version}; also inside sql.js)`,
      "https://sqlite.org/copyright.html",
      "License: public domain. The SQLite source reads:",
      "",
      "  The author disclaims copyright to this source code.  In place of",
      "  a legal notice, here is a blessing:",
      "",
      "     May you do good and not evil.",
      "     May you find forgiveness for yourself and forgive others.",
      "     May you share freely, never taking more than you give.",
    ]);
  }

  entries.push([
    "OurAirports airport data (src/data/airportCoords.json, built by scripts/build-airport-coords.mjs)",
    "https://ourairports.com/data/",
    "Source: https://github.com/davidmegginson/ourairports-data",
    `Commit: ${commit} (airports.csv, SHA-256 ${sha})`,
    "License: public domain (The Unlicense). The repository's LICENSE file is the Unlicense text in Part 6.",
  ]);

  entries.push([
    "FAA Airman Certification Standards excerpts (src/logic/currentAcs*Catalog.ts)",
    "https://www.faa.gov/training_testing/testing/acs",
    "A work of the U.S. Federal Aviation Administration, not subject to copyright in the United",
    "States (17 U.S.C. 105). Listed for attribution; FAA handbooks are downloaded, not bundled.",
  ]);
  return entries;
}

// -------------------------------------------------------------- output ----

export function buildNotices({ root = ROOT, cargoMetadata, report } = {}) {
  const meta = cargoMetadata ?? loadCargoMetadata(root);
  const packages = [...npmPackages(root), ...cargoPackages(meta)];
  packages.sort((a, b) => byKey(a.eco, b.eco) || byKey(a.name, b.name) || byKey(a.version, b.version));

  const verbatim = new Map(); // text -> { label, users: [] }
  const usedIds = new Set(["OFL-1.1", "Unlicense"]);
  const mpl = [];
  const blocks = { npm: [], crate: [] };

  for (const p of packages) {
    const elected = electLicenses(p.license);
    for (const id of elected) {
      if (!canon(id)) throw new Error(`${p.name} ${p.version} uses ${id}, which has no standard text in scripts/license-texts; add one after checking it by hand`);
      usedIds.add(id);
    }
    if (allLicenseIds(p.license).includes("MPL-2.0")) mpl.push(p);
    const files = readLicenseFiles(p.dir, allLicenseIds(p.license));
    const copyrights = [...new Set(files.flatMap((f) => f.copyrights))];
    const lines = [RULE, `${p.name} ${p.version}`, `From: ${p.eco === "npm" ? "npm" : "crates.io"}${p.testOnly ? " (test-only: not part of the shipped app)" : ""}`];
    const choice = elected.join(" AND ");
    lines.push(`License: ${p.license}${norm(choice) === norm(p.license) ? "" : ` (used under ${choice})`}`);
    if (p.note) lines.push(`License note: ${p.note}`);
    if (p.source) lines.push(`Source: ${p.source}`);
    if (p.repository) lines.push(`Repository: ${p.repository}`);
    if (p.authors.length) lines.push(`Authors: ${p.authors.join(", ")}`);
    if (copyrights.length) lines.push(...copyrights);
    else if (files.some((f) => f.verbatim)) lines.push("Copyright: see the package's license files reproduced in Part 5.");
    else lines.push("Copyright: no copyright line in the package's license files (see Authors and Repository).");
    const standard = files.filter((f) => f.id);
    for (const f of standard) report?.push(`std  ${p.eco} ${p.name}@${p.version} ${f.file} = ${f.id}${f.dropped.length ? ` (dropped titles: ${f.dropped.join(" | ")})` : ""}`);
    for (const f of files.filter((f) => f.verbatim)) {
      if (!verbatim.has(f.verbatim)) verbatim.set(f.verbatim, { label: null, users: [] });
      const v = verbatim.get(f.verbatim);
      v.users.push(`${p.name} ${p.version} (${f.file})`);
      f.ref = v;
      report?.push(`verb ${p.eco} ${p.name}@${p.version} ${f.file}`);
    }
    if (!files.length) report?.push(`none ${p.eco} ${p.name}@${p.version}`);
    lines.push(`License text: ${elected.join(" and ")} standard text in Part 6.`);
    lines.push(files.length ? `Package license files: ${files.map((f) => (f.id ? `${f.file} (standard ${f.id})` : `${f.file} [@VERBATIM@]`)).join(", ")}` : "Package license files: none in the published package.");
    lines.fileRefs = files.filter((f) => f.verbatim);
    blocks[p.eco].push(lines);
  }

  // Label verbatim texts in order of first use, then fill the references.
  let n = 0;
  for (const eco of ["npm", "crate"]) {
    for (const lines of blocks[eco]) {
      for (const f of lines.fileRefs) if (!f.ref.label) f.ref.label = `T${++n}`;
      const last = lines.length - 1;
      let refs = lines.fileRefs.map((f) => f.ref.label);
      lines[last] = lines[last].replace(/\[@VERBATIM@\]/g, () => `(verbatim in Part 5 as [${refs.shift()}])`);
    }
  }

  const npmCount = blocks.npm.length;
  const crateCount = blocks.crate.length;
  const testOnly = packages.filter((p) => p.testOnly).length;
  const out = [];
  out.push(
    "Third-party notices for Her Flight Deck",
    "=======================================",
    "",
    "Her Flight Deck is licensed under the MIT License (see LICENSE in the source repository).",
    "It includes the third-party software and data listed below, each under its own license.",
    "",
    "This file is generated by scripts/third-party-notices.mjs from package-lock.json (production",
    "packages) and Cargo.lock (via `cargo metadata`). Do not edit it by hand: run",
    "`node scripts/third-party-notices.mjs` after changing dependencies. CI runs it with --check.",
    "Vite copies public/ into dist/, and Tauri embeds dist/, so this file ships inside every build.",
    "",
    `Contents: ${npmCount} npm packages, ${crateCount} Rust crates (${testOnly} of them test-only), bundled fonts and data.`,
    "The Rust list covers every target platform (macOS, Windows, Linux, iOS, Android); a given",
    "build contains only the crates for its platform. Where a package offers a choice of licenses,",
    "the entry says which one this app uses.",
    "",
    "  Part 1  Bundled fonts and data",
    "  Part 2  JavaScript packages (npm)",
    "  Part 3  Rust crates (crates.io)",
    "  Part 4  MPL-2.0 components: where to get their source code",
    "  Part 5  License files reproduced verbatim from packages",
    "  Part 6  Standard license texts",
    "",
    "",
    "PART 1  BUNDLED FONTS AND DATA",
    "==============================",
    "",
  );
  for (const e of bundledEntries(root, packages)) out.push(RULE, ...e, "");
  out.push("", "PART 2  JAVASCRIPT PACKAGES (npm)", "================================", "");
  for (const lines of blocks.npm) out.push(...lines, "");
  out.push("", "PART 3  RUST CRATES (crates.io)", "===============================", "");
  for (const lines of blocks.crate) out.push(...lines, "");
  out.push(
    "",
    "PART 4  MPL-2.0 COMPONENTS: SOURCE CODE",
    "=======================================",
    "",
    "These crates are covered by the Mozilla Public License 2.0 and are used unmodified. Their",
    "Source Code Form is available from the locations below; the license text is in Part 6.",
    "",
  );
  for (const p of mpl) {
    out.push(`${p.name} ${p.version}`);
    if (p.download) out.push(`  Source archive: ${p.download}`);
    if (p.repository) out.push(`  Repository: ${p.repository}`);
  }
  out.push("", "", "PART 5  LICENSE FILES REPRODUCED VERBATIM", "=========================================", "");
  out.push("These package files are not (only) a standard license text, so they are copied unchanged.", "");
  const labelled = [...verbatim.entries()].sort((a, b) => Number(a[1].label.slice(1)) - Number(b[1].label.slice(1)));
  for (const [text, v] of labelled) {
    out.push(RULE, `[${v.label}] used by: ${v.users.join(", ")}`, RULE, "", text, "");
  }
  out.push("", "PART 6  STANDARD LICENSE TEXTS", "==============================", "");
  out.push("Copyright lines for each package are in its entry above; <year> and <copyright holder>", "placeholders in these texts stand for them.", "");
  for (const id of [...usedIds].sort((a, b) => rank(a) - rank(b) || byKey(a, b))) {
    out.push(RULE, id, RULE, "", canon(id).full, "");
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n\n").trimEnd()}\n`;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const report = args.has("--report") ? [] : undefined;
  const text = buildNotices({ report });
  if (report) console.log(report.join("\n"));
  const target = join(ROOT, NOTICES_PATH);
  if (args.has("--check")) {
    const current = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (current !== text) {
      console.error(`${NOTICES_PATH} is stale or incomplete. Run: node scripts/third-party-notices.mjs`);
      process.exit(1);
    }
    console.log(`${NOTICES_PATH} is current.`);
    return;
  }
  writeFileSync(target, text);
  console.log(`Wrote ${NOTICES_PATH} (${text.split("\n").length} lines).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
