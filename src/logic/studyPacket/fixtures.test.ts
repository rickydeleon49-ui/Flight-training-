import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { boundaryCases, compareOutcome, type ExpectedOutcome } from "@/testing/studyPackets";
import { validatePacketBytes, validatePacketText } from "./index";

const FIXTURES = new URL("../../testing/fixtures/study-packets/", import.meta.url);
const ACCEPTED = JSON.parse(readFileSync(new URL("../../testing/fixtures/study-packets-accepted.sha256.json", import.meta.url), "utf8")).files as Record<string, string>;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const expected = JSON.parse(readFileSync(new URL("expected-outcomes.json", FIXTURES), "utf8")).fixtures as Record<string, ExpectedOutcome>;
const fixtureNames = readdirSync(FIXTURES).filter((name) => name.endsWith(".json") && name !== "expected-outcomes.json").sort();

describe("study-packet fixtures (accepted contract)", () => {
  it("keeps the test copies byte-identical to the accepted contract fixtures", () => {
    const accepted = Object.keys(ACCEPTED).filter((name) => name !== "expected-outcomes.json").sort();
    expect(fixtureNames).toEqual(accepted);
    for (const name of [...accepted, "expected-outcomes.json"]) {
      expect(sha256(readFileSync(new URL(name, FIXTURES))), name).toBe(ACCEPTED[name]);
    }
  });

  it("has an expectation for every fixture and a fixture for every expectation", () => {
    expect(fixtureNames).toEqual(Object.keys(expected).sort());
    expect(fixtureNames).toHaveLength(56);
  });

  it.each(fixtureNames)("%s matches its expected outcome", (name) => {
    const result = validatePacketBytes(new Uint8Array(readFileSync(new URL(name, FIXTURES))));
    expect(compareOutcome(result, expected[name]!)).toEqual([]);
  });

  it.each(fixtureNames)("%s gives the same result through the text entry point", (name) => {
    const bytes = new Uint8Array(readFileSync(new URL(name, FIXTURES)));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    expect(validatePacketText(text)).toEqual(validatePacketBytes(bytes));
  });
});

describe("generated boundary, encoding and privacy cases", () => {
  const cases = boundaryCases();

  it("covers the 49 generated cases of the accepted reference", () => {
    expect(cases).toHaveLength(49);
    expect(new Set(cases.map((c) => c.name)).size).toBe(49);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, testCase) => {
    expect(compareOutcome(validatePacketBytes(testCase.bytes), testCase.expected)).toEqual([]);
  });
});
