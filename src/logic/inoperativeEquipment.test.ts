import { expect, it } from "vitest";

import { INOP_CHECKS, INOP_START, inopAnswer, type InopState } from "./inoperativeEquipment";

it("MEL yes ends with MEL text", () => {
  const s = inopAnswer(INOP_START, true);
  expect(s).toMatchObject({ kind: "end", result: "mel" });
});

it("any single Yes in step 2 ends required", () => {
  for (let i = 0; i < INOP_CHECKS.length; i++) {
    let s: InopState = inopAnswer(INOP_START, false);
    for (let j = 0; j < i; j++) s = inopAnswer(s, false);
    expect(s).toMatchObject({ kind: "check", index: i });
    expect(inopAnswer(s, true)).toMatchObject({ kind: "end", result: "required" });
  }
});

it("all No ends with remove/deactivate text", () => {
  let s: InopState = inopAnswer(INOP_START, false);
  for (let i = 0; i < INOP_CHECKS.length; i++) s = inopAnswer(s, false);
  expect(s).toMatchObject({ kind: "end", result: "allNo" });
  if (s.kind === "end") expect(s.text).toMatch(/placard/);
});

it("wording avoids go/legal/safe claims", () => {
  let s: InopState = inopAnswer(INOP_START, false);
  for (let i = 0; i < INOP_CHECKS.length; i++) s = inopAnswer(s, false);
  if (s.kind === "end") expect(s.text).not.toMatch(/eligible|legal|airworthy|\bsafe\b/i);
});
