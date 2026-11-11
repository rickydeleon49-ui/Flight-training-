import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith(".tsx") && !path.endsWith(".test.tsx") ? [path] : [];
  });
}

it("no live region uses display: contents (older WebKit drops it from the accessibility tree)", () => {
  for (const path of files("src")) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/<[a-z]+\b[^>]*(?:role="status"|aria-live)[^>]*>/g)) {
      expect(match[0], path).not.toMatch(/display:\s*"?contents/);
    }
  }
});

it("live-region helper classes keep empty regions out of flex and grid gaps", () => {
  const css = readFileSync("src/components/ui/ui.css", "utf8");
  expect(css).toMatch(/\.live-region:empty\s*{[^}]*position: absolute/);
  expect(css).toMatch(/\.live-region--detached\s*{[^}]*position: fixed/);
});
