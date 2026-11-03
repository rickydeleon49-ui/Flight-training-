import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { allLicenseIds, electLicenses, matchStandard } from "./third-party-notices.mjs";

const text = (name) => readFileSync(new URL(`./license-texts/${name}`, import.meta.url), "utf8");
const mitBody = text("MIT.txt").split("\n").slice(4).join("\n");

test("elects the simplest, most permissive option and keeps every AND part", () => {
  assert.deepEqual(electLicenses("MIT OR Apache-2.0"), ["MIT"]);
  assert.deepEqual(electLicenses("MIT/Apache-2.0"), ["MIT"]);
  assert.deepEqual(electLicenses("Apache-2.0 / MIT"), ["MIT"]);
  assert.deepEqual(electLicenses("Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT"), ["MIT"]);
  assert.deepEqual(electLicenses("Apache-2.0 OR BSL-1.0"), ["Apache-2.0"]);
  assert.deepEqual(electLicenses("(MIT OR Apache-2.0) AND Unicode-3.0"), ["MIT", "Unicode-3.0"]);
  assert.deepEqual(electLicenses("Apache-2.0 AND ISC"), ["Apache-2.0", "ISC"]);
  assert.deepEqual(electLicenses("MIT OR Apache-2.0 OR LGPL-2.1-or-later"), ["MIT"]);
  assert.deepEqual(electLicenses("MPL-2.0"), ["MPL-2.0"]);
  assert.deepEqual(allLicenseIds("Apache-2.0 WITH LLVM-exception OR MIT"), ["Apache-2.0 WITH LLVM-exception", "MIT"]);
  assert.throws(() => electLicenses("MIT OR"), /Bad license expression/);
});

test("a standard MIT file yields only its copyright line", () => {
  const file = `The MIT License (MIT)\n\nCopyright (c) 2020 Jane Example\n\n${mitBody}`;
  assert.deepEqual(matchStandard(file, "MIT"), { copyrights: ["Copyright (c) 2020 Jane Example"], dropped: ["The MIT License (MIT)"] });
});

test("rewrapped lines and https links still count as the standard text", () => {
  const rewrapped = mitBody.replace(/\n/g, " ").replace(/ {2,}/g, " ");
  assert.ok(matchStandard(`Copyright 2021 A\n${rewrapped}`, "MIT"));
  const apache = text("Apache-2.0.txt").replace("http://www.apache.org/licenses/LICENSE-2.0", "https://www.apache.org/licenses/LICENSE-2.0");
  assert.ok(matchStandard(apache, "Apache-2.0"));
});

test("any extra term or a changed word makes the file verbatim (no match)", () => {
  assert.equal(matchStandard(`Copyright 2020 A\n\n${mitBody}\n\nYou may not use this for evil.`, "MIT"), null);
  assert.equal(matchStandard(`Copyright 2020 A\n\n${mitBody.replace("sublicense", "lease")}`, "MIT"), null);
  // 0BSD is ISC minus the notice condition: neither may stand in for the other.
  assert.equal(matchStandard(text("0BSD.txt"), "ISC"), null);
  assert.equal(matchStandard(text("ISC.txt"), "0BSD"), null);
  // Apache alone must not swallow the LLVM exception.
  assert.equal(matchStandard(`${text("Apache-2.0.txt")}\n\n${text("LLVM-exception.txt")}`, "Apache-2.0"), null);
  assert.ok(matchStandard(`${text("Apache-2.0.txt")}\n\n${text("LLVM-exception.txt")}`, "Apache-2.0 WITH LLVM-exception"));
});

test("only a bare heading is dropped, never a sentence about the license", () => {
  assert.equal(matchStandard(`This license applies to the parser only\nCopyright 2020 A\n\n${mitBody}`, "MIT"), null);
  assert.ok(matchStandard(`BSD 3-Clause License\n\nCopyright (c) 2020, A\n${text("BSD-3-Clause.txt").split("\n").slice(5).join("\n")}`, "BSD-3-Clause"));
});
