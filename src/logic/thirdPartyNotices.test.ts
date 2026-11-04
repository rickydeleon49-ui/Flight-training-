import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Coverage gate for public/THIRD_PARTY_NOTICES.txt. It needs no cargo: it reads
// the lockfiles directly. CI also runs `node scripts/third-party-notices.mjs
// --check`, which regenerates the whole file and fails if anything changed.

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const notice = read("public/THIRD_PARTY_NOTICES.txt");
const part = (from: string, to: string) => notice.slice(notice.indexOf(from), notice.indexOf(to));

type LockEntry = { version: string; dev?: boolean; devOptional?: boolean; link?: boolean; name?: string };

function npmProductionPackages() {
  const lock = JSON.parse(read("package-lock.json")) as { packages: Record<string, LockEntry> };
  return Object.entries(lock.packages)
    .filter(([path, e]) => path && !e.dev && !e.devOptional && !e.link)
    .map(([path, e]) => ({ name: e.name ?? path.slice(path.lastIndexOf("node_modules/") + 13), version: e.version }));
}

function cargoLockPackages() {
  const lock = read("src-tauri/Cargo.lock");
  return [...lock.matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"\n(source = )?/g)]
    .filter((m) => m[3]) // the app crate itself has no source
    .map((m) => ({ name: m[1] ?? "", version: m[2] ?? "" }));
}

function entry(name: string, version: string) {
  const start = notice.indexOf(`\n${name} ${version}\nFrom: `);
  if (start < 0) return null;
  return notice.slice(start + 1, notice.indexOf("\n\n", start + 1));
}

describe("third-party notices cover every shipped dependency", () => {
  it("has an entry with a license for every production npm package in package-lock.json", () => {
    const packages = npmProductionPackages();
    expect(packages.length).toBeGreaterThan(20);
    const npm = part("PART 2 ", "PART 3 ");
    for (const { name, version } of packages) {
      const e = entry(name, version);
      expect(e, `${name} ${version} has no notice entry; run node scripts/third-party-notices.mjs`).not.toBeNull();
      expect(npm).toContain(`\n${name} ${version}\nFrom: npm\nLicense: `);
      expect(e).toMatch(/\nLicense text: .+ standard text in Part 6\./);
    }
  });

  it("has an entry with a license for every crate in Cargo.lock", () => {
    const crates = cargoLockPackages();
    expect(crates.length).toBeGreaterThan(500);
    const rust = part("PART 3 ", "PART 4 ");
    for (const { name, version } of crates) {
      expect(rust, `${name} ${version} has no notice entry; run node scripts/third-party-notices.mjs`).toContain(
        `\n${name} ${version}\nFrom: crates.io`,
      );
      expect(entry(name, version)).toMatch(/\nLicense: \S/);
    }
  });

  it("lists no package that is no longer locked", () => {
    const locked = new Set([...npmProductionPackages(), ...cargoLockPackages()].map((p) => `${p.name} ${p.version}`));
    const listed = [...notice.matchAll(/\n([^\n]+)\nFrom: (?:npm|crates\.io)/g)].map((m) => m[1] ?? "");
    expect(listed.length).toBe(locked.size);
    for (const name of listed) expect(locked.has(name), `${name} is listed but not locked`).toBe(true);
  });

  it("includes every standard license text an entry points to", () => {
    const texts = notice.slice(notice.indexOf("PART 6 "));
    const used = new Set([...notice.matchAll(/\nLicense text: (.+) standard text in Part 6\./g)].flatMap((m) => (m[1] ?? "").split(" and ")));
    for (const id of used) expect(texts, `missing standard text for ${id}`).toContain(`\n${"-".repeat(79)}\n${id}\n${"-".repeat(79)}\n`);
    // Every verbatim reference resolves.
    for (const m of notice.matchAll(/verbatim in Part 5 as \[(T\d+)\]/g)) expect(notice).toContain(`\n[${m[1]}] used by: `);
  });
});

describe("notices for licenses with extra obligations", () => {
  it("ships the full SIL Open Font License with the Inter and Fraunces copyright lines", () => {
    expect(notice).toContain("SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007");
    expect(notice).toContain("5) The Font Software, modified or unmodified, in part or in whole,");
    expect(part("PART 1 ", "PART 2 ")).toContain("Copyright 2016 The Inter Project Authors");
    expect(part("PART 1 ", "PART 2 ")).toContain("Copyright 2020 The Fraunces Project Authors");
  });

  it("lists every MPL-2.0 crate with where to get its source", () => {
    const mpl = part("PART 4 ", "PART 5 ");
    const lock = cargoLockPackages();
    const mplCrates = [...notice.matchAll(/\n([^\n]+) ([^\s]+)\nFrom: crates\.io[^\n]*\nLicense: [^\n]*MPL-2\.0/g)];
    expect(mplCrates.length).toBeGreaterThanOrEqual(5);
    for (const [, name, version] of mplCrates) {
      expect(lock.some((p) => p.name === name && p.version === version)).toBe(true);
      expect(mpl).toContain(`${name} ${version}\n  Source archive: https://static.crates.io/crates/${name}/${name}-${version}.crate`);
    }
    expect(notice).toContain("Mozilla Public License Version 2.0");
  });

  it("names suncalc's BSD-2-Clause license even though its package.json has none", () => {
    expect(entry("suncalc", "2.1.1")).toContain("License: BSD-2-Clause\nLicense note: package.json has no license field");
  });
});

describe("the app's own license", () => {
  it("is MIT, and the bundle copyright names the same holder", () => {
    const license = read("LICENSE");
    expect(license.startsWith("MIT License\n\nCopyright (c) 2026 the Flight Deck authors\n")).toBe(true);
    expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND');
    const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
    expect(conf.bundle.copyright).toBe("Copyright © 2026 the Flight Deck authors. MIT License.");
    expect(notice).toContain("Your Flight Deck is licensed under the MIT License");
  });
});
