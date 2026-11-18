import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("card styles", () => {
  it("keeps hero cards plain: no accent card style anywhere", () => {
    const offenders = sourceFiles("src").filter((path) =>
      /card--accent|variant="accent"/.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
