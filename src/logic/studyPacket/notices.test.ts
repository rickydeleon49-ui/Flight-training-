import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("third-party notice for the zod dependency", () => {
  it("pins exactly zod 4.6.5 as the only new production dependency it covers", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies.zod).toBe("4.6.5");
    const lock = JSON.parse(read("package-lock.json"));
    expect(lock.packages["node_modules/zod"].version).toBe("4.6.5");
    expect(lock.packages["node_modules/zod"].integrity).toBe(
      "sha512-v5l/aFXZQeai4awLbOpSoHecE9UiMrnfx75tEXLjNonXVARxQ5mOeipTjROUchszUNCqnE+hqAMujRsRHsut2Q==",
    );
  });

  it("ships the package's own copyright and permission text unchanged", () => {
    const notice = read("public/THIRD_PARTY_NOTICES.txt");
    const license = read("node_modules/zod/LICENSE");
    expect(license).toContain("Copyright (c) 2025 Colin McDonnell");
    expect(notice).toContain("zod 4.6.5");
    expect(notice.endsWith(license)).toBe(true);
  });
});
