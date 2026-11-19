import { expect, it } from "vitest";

import { RADIO_DRILL } from "./radioDrill";

it("has at least 30 unique, complete items", () => {
  expect(RADIO_DRILL.length).toBeGreaterThanOrEqual(30);
  const ids = RADIO_DRILL.map((i) => i.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const i of RADIO_DRILL) {
    expect(i.situation && i.controllerCall && i.modelReply && i.tip).toBeTruthy();
  }
});

it("hold short calls are read back with hold short, and replies end with the call sign", () => {
  for (const i of RADIO_DRILL) {
    if (/hold short/i.test(i.controllerCall)) expect(i.modelReply.toLowerCase()).toContain("hold short");
    // Calls the pilot starts include the call sign up front; readbacks end with it.
    if (i.controllerCall.startsWith("(")) expect(i.modelReply).toContain("Skyhawk 4-5-6-7-Romeo");
    else expect(i.modelReply).toMatch(/Skyhawk 4-5-6-7-Romeo\.$/);
  }
});

it("never shortens the call sign (AIM 4-2-4: only after ATC does)", () => {
  for (const i of RADIO_DRILL) {
    expect(i.modelReply.replace("Skyhawk 4-5-6-7-Romeo", "")).not.toMatch(/7-Romeo/);
  }
});

it("atis-letter situation and reply give the same distance", () => {
  const i = RADIO_DRILL.find((x) => x.id === "atis-letter")!;
  expect(i.situation.toLowerCase()).toContain("ten miles");
  expect(i.modelReply.toLowerCase()).toContain("ten miles");
});
