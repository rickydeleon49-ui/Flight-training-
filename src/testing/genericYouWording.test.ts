import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const PRONOUN = /\b(she|her|hers|herself)\b/i;

// Wire-format text sent to the provider, byte-matched by a Rust test fixture
// (maxContext); changing it is a provider-contract change, not wording.
const ALLOWED_LINES = [/"Her chosen answer: "/];

// Product name and stored identifiers (hyphenated storage keys, persisted job
// state "waiting-for-her", db file names) are allowed; nothing else is.
function scrub(line: string): string {
  return line
    .replace(/Her Flight Deck/gi, "")
    .replace(/[\w.-]*her-flight-deck[\w.-]*/gi, "")
    .replace(/waiting-for-her/g, "");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("generic second-person wording", () => {
  it("has no she/her/hers/herself in non-test source", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        if (PRONOUN.test(scrub(line)) && !ALLOWED_LINES.some((re) => re.test(line))) hits.push(`${relative(SRC, file)}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
