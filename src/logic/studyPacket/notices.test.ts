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
    expect(notice.endsWith(license)).toBe(true);
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
