/**
 * OFFLINE-03 §2.3: `card_versions.provider` is a compatibility placeholder (its
 * legacy CHECK allows only 'gemini' and 'import', so a set she wrote records
 * 'import'). Nothing may read it as the true author of a card; origin comes
 * from `card_item_origins` and `card_version_origins`. This scans every app
 * and native source file for a query that selects it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, pattern);
    return pattern.test(name) && !/\.test\.|_tests\.rs$|\/tests\.rs$/.test(path) ? [path] : [];
  });
}

/** The SELECT that each `FROM card_versions` belongs to. */
function selectsFromCardVersions(text: string): string[] {
  const found: string[] = [];
  let at = text.indexOf("FROM card_versions");
  while (at !== -1) {
    const start = text.lastIndexOf("SELECT", at);
    if (start !== -1 && at - start < 600) found.push(text.slice(start, at));
    at = text.indexOf("FROM card_versions", at + 1);
  }
  return found;
}

it("no app or native query reads card_versions.provider", () => {
  const sources = [...files("src", /\.(ts|tsx)$/), ...files("src-tauri/src", /\.rs$/)];
  expect(sources.length).toBeGreaterThan(50);
  const offenders = sources.flatMap((path) =>
    selectsFromCardVersions(readFileSync(path, "utf8"))
      .filter((select) => /\bprovider\b/.test(select) || /SELECT\s+\*/.test(select))
      .map((select) => `${path}: ${select.replace(/\s+/g, " ").slice(0, 120)}`),
  );
  expect(offenders).toEqual([]);
});
