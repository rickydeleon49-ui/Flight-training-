import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FAA_FIGURES, figureCredit, getFigure } from "./figures";

const ROOT = join(__dirname, "..", "assets", "figures");
const shipped = readdirSync(ROOT).filter((n) => n.endsWith(".webp"));

describe("FAA figure manifest", () => {
  it("resolves every entry to a file, with a unique id", () => {
    for (const fig of FAA_FIGURES) expect(existsSync(join(ROOT, fig.file)), fig.id).toBe(true);
    expect(new Set(FAA_FIGURES.map((x) => x.id)).size).toBe(FAA_FIGURES.length);
    expect(getFigure("faa-49")?.faaNumber).toBe(49);
    expect(getFigure("nope")).toBeUndefined();
  });

  it("matches the folder exactly", () => {
    expect(FAA_FIGURES.map((x) => x.file).sort()).toEqual([...shipped].sort());
    expect(FAA_FIGURES.length).toBeGreaterThanOrEqual(12);
    expect(FAA_FIGURES.length).toBeLessThanOrEqual(21);
    for (const fig of FAA_FIGURES) expect(fig.id).toBe(`faa-${fig.faaNumber}`);
  });

  it("keeps each file at 250 KB or less and the folder at 1.5 MB or less", () => {
    let total = 0;
    for (const n of shipped) {
      const size = statSync(join(ROOT, n)).size;
      expect(size, n).toBeLessThanOrEqual(250 * 1024);
      total += size;
    }
    expect(total).toBeLessThanOrEqual(1.5 * 1024 * 1024);
  });

  it("words the credit plainly", () => {
    expect(figureCredit(getFigure("faa-49")!)).toBe("FAA-CT-8080-2H (2018), Figure 49");
  });

  it("has useful alt text and real sizes", () => {
    for (const fig of FAA_FIGURES) {
      expect(fig.alt.length, fig.id).toBeGreaterThan(20);
      expect(fig.width, fig.id).toBeGreaterThan(500);
      expect(fig.height, fig.id).toBeGreaterThan(200);
    }
  });
});
