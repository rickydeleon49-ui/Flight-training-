import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? cssFiles(path) : path.endsWith(".css") ? [path] : [];
  });
}

it("no border-radius literal above 20px except capsules and circles", () => {
  const root = new URL("..", import.meta.url).pathname;
  for (const file of cssFiles(root)) {
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/(?:border(?:-[a-z]+)*-radius|--radius-[a-z]+|--glass-radius)\s*:\s*([^;}]+)/g)) {
      for (const n of m[1]!.matchAll(/(\d*\.?\d+)(px|rem)/g)) {
        const px = Number(n[1]) * (n[2] === "rem" ? 16 : 1);
        if (px === 999) continue;
        expect(px, `${file}: ${m[0]}`).toBeLessThanOrEqual(20);
      }
    }
  }
});
