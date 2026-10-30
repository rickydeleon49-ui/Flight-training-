import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("third-party notice for the zod dependency", () => {
  it("pins exactly zod 4.6.7 as the only new production dependency it covers", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies.zod).toBe("4.6.7");
    const lock = JSON.parse(read("package-lock.json"));
    expect(lock.packages["node_modules/zod"].version).toBe("4.6.7");
    expect(lock.packages["node_modules/zod"].integrity).toBe(
      "sha512-g8W2D2kU6a8untc053fX1uVBKzM7yqAxW/3zwk83+6RyF2+SKOuV+c0wBDhUwzV1PaGapmZH+rmcUzPf+3CGwg==",
    );
  });

  it("ships the package's own copyright and permission text unchanged", () => {
    const notice = read("public/THIRD_PARTY_NOTICES.txt");
    const license = read("node_modules/zod/LICENSE");
    expect(license).toContain("Copyright (c) 2025 Colin McDonnell");
    expect(notice).toContain("zod 4.6.7");
    expect(notice).toContain(`zod 4.6.7\n`);
    expect(notice).toContain(`-\n\n${license}`);
  });
});

describe("third-party notice for the suncalc dependency", () => {
  it("pins exactly suncalc 2.1.1, which ships its own types", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies.suncalc).toBe("2.1.1");
    expect(pkg.devDependencies["@types/suncalc"]).toBeUndefined();
    const lock = JSON.parse(read("package-lock.json"));
    expect(lock.packages["node_modules/suncalc"].version).toBe("2.1.1");
    expect(lock.packages["node_modules/suncalc"].integrity).toBe(
      "sha512-ufMOPzYRk5aomEs3g+qeJGdCPZWC3TL94E0HQagoSusFnNXCvfuewWBroY3lxRHqA7IA8UGvgg7dcrSSDJsuEg==",
    );
  });

  it("ships the package's own BSD-2-Clause copyright and conditions unchanged", () => {
    const notice = read("public/THIRD_PARTY_NOTICES.txt");
    const license = read("node_modules/suncalc/LICENSE");
    expect(license).toContain("Copyright (c) 2026, Volodymyr Agafonkin");
    expect(notice).toContain("suncalc 2.1.1");
    expect(notice).toContain("License: BSD-2-Clause");
    expect(notice).toContain(`-\n\n${license}`);
  });
});

describe("notice for the OurAirports airport data", () => {
  it("names the public-domain source, pinned commit and checksum the build script uses", () => {
    const notice = read("public/THIRD_PARTY_NOTICES.txt");
    const script = read("scripts/build-airport-coords.mjs");
    const commit = /SOURCE_COMMIT = "([0-9a-f]{40})"/.exec(script)?.[1];
    const sha = /SOURCE_SHA256 = "([0-9a-f]{64})"/.exec(script)?.[1];
    expect(commit).toBeTruthy();
    expect(notice).toContain("https://github.com/davidmegginson/ourairports-data");
    expect(notice).toContain(`Commit: ${commit}`);
    expect(notice).toContain(`SHA-256 ${sha}`);
    expect(notice).toContain("License: public domain (The Unlicense)");
    expect(notice).toContain("This is free and unencumbered software released into the public domain.");
    const data = JSON.parse(read("src/data/airportCoords.json"));
    expect(data.source).toContain(commit);
  });
});

describe("third-party notice for the diff (jsdiff) dependency", () => {
  it("pins exactly diff 9.0.0, which has no dependencies of its own", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies.diff).toBe("9.0.0");
    const lock = JSON.parse(read("package-lock.json"));
    expect(lock.packages["node_modules/diff"].version).toBe("9.0.0");
    expect(lock.packages["node_modules/diff"].license).toBe("BSD-3-Clause");
    expect(lock.packages["node_modules/diff"].dependencies).toBeUndefined();
    expect(lock.packages["node_modules/diff"].integrity).toBe(
      "sha512-svtcdpS8CgJyqAjEQIXdb3OjhFVVYjzGAPO8WGCmRbrml64SPw/jJD4GoE98aR7r25A0XcgrK3F02yw9R/vhQw==",
    );
  });

  it("ships the package's own copyright and permission text unchanged", () => {
    const notice = read("public/THIRD_PARTY_NOTICES.txt");
    const license = read("node_modules/diff/LICENSE");
    expect(license).toContain("Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com>");
    expect(notice).toContain("diff 9.0.0 (jsdiff)");
    expect(notice).toContain(license);
  });
});

describe("third-party notice for the React Aria tabs dependencies", () => {
  it("pins exactly the two approved direct dependencies and their tarball integrity", () => {
    const pkg = JSON.parse(read("package.json"));
    const lock = JSON.parse(read("package-lock.json"));
    const pins = {
      "@react-aria/tabs": {
        version: "3.12.1",
        integrity: "sha512-fGMxbqSnqtn3GRiicLfnhWcnD6Auch0qCyt5ArfndYrISmSZkzq7PVZtDj85TEqC6p8WSw/M7HjWBBUX5/Of0g==",
      },
      "@react-stately/tabs": {
        version: "3.9.1",
        integrity: "sha512-xS9ByN7OMqvU9wyZJ8MnDvRTdsmB+GUP1whlRh4NmxWGmL4SDXKd4slSUGfb2lRi8lgT0OCAjd9om80HJP0p3w==",
      },
    };
    for (const [name, pin] of Object.entries(pins)) {
      expect(pkg.dependencies[name]).toBe(pin.version);
      expect(lock.packages[`node_modules/${name}`].version).toBe(pin.version);
      expect(lock.packages[`node_modules/${name}`].integrity).toBe(pin.integrity);
      expect(lock.packages[`node_modules/${name}`].license).toBe("Apache-2.0");
    }
    // Declared directly because components import Item and mergeProps from them (ARIA-01a, 01d).
    expect(pkg.dependencies["react-aria"]).toBe(lock.packages["node_modules/react-aria"].version);
    expect(pkg.dependencies["react-stately"]).toBe(lock.packages["node_modules/react-stately"].version);
    expect(pkg.dependencies["react-aria-components"]).toBeUndefined();
  });

  it("ships the identical monorepo license and names every installed Spectrum package", () => {
    const notice = read("public/THIRD_PARTY_NOTICES.txt");
    const license = read("node_modules/@react-aria/tabs/LICENSE");
    expect(license).toContain("Copyright 2019 Adobe");
    expect(notice).toContain("License: Apache-2.0");
    expect(notice).toContain(`-\n\n${license}`);
    const lock = JSON.parse(read("package-lock.json"));
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (!/^node_modules\/(?:@react-aria\/|@react-stately\/|@react-types\/|@internationalized\/|react-aria$|react-stately$)/.test(path)) continue;
      expect(read(`${path}/LICENSE`)).toBe(license);
      const name = path.replace("node_modules/", "");
      expect(notice).toContain(`${name} ${(entry as { version: string }).version}\n`);
    }
  });
});
