import { describe, expect, it } from "vitest";
import { applyMyAirplane, emptyWbInput, myAirplaneFromInput, normalizeMyAirplane } from "./weightBalance";

const good = {
  name: "Trainer", emptyWeight: 1500, emptyArm: 85, maxGross: 2300, frontArm: 80,
  rearArm: 118, fuelArm: 95, baggageArm: 142, forwardLimit: 82, aftLimit: 95,
};

describe("my airplane", () => {
  it("accepts good data and round trips", () => {
    expect(normalizeMyAirplane(good)).toEqual(good);
    expect(normalizeMyAirplane(normalizeMyAirplane(good))).toEqual(good);
  });
  it("rejects bad numbers and limits", () => {
    expect(normalizeMyAirplane(null)).toBeUndefined();
    expect(normalizeMyAirplane({ ...good, emptyArm: NaN })).toBeUndefined();
    expect(normalizeMyAirplane({ ...good, maxGross: Infinity })).toBeUndefined();
    expect(normalizeMyAirplane({ ...good, emptyWeight: 0 })).toBeUndefined();
    expect(normalizeMyAirplane({ ...good, maxGross: -5 })).toBeUndefined();
    expect(normalizeMyAirplane({ ...good, forwardLimit: 95 })).toBeUndefined();
    expect(normalizeMyAirplane({ ...good, rearArm: "118" })).toBeUndefined();
  });
  it("trims, caps and drops the name", () => {
    expect(normalizeMyAirplane({ ...good, name: "  " })).not.toHaveProperty("name");
    expect(normalizeMyAirplane({ ...good, name: "  Bird " })?.name).toBe("Bird");
    expect(normalizeMyAirplane({ ...good, name: "x".repeat(60) })?.name).toHaveLength(40);
  });
  it("applies to input and keeps per-flight amounts", () => {
    const base = emptyWbInput();
    base.rows.front.amount = "340";
    base.rows.fuel.amount = "30";
    const out = applyMyAirplane(base, good);
    expect(out.rows.front).toEqual({ amount: "340", arm: "80" });
    expect(out.rows.fuel.amount).toBe("30");
    expect(out.rows.empty).toEqual({ amount: "1500", arm: "85" });
    expect(out.maxGross).toBe("2300");
    expect(out.aftLimit).toBe("95");
  });
  it("reads typed text and explains errors", () => {
    const filled = applyMyAirplane(emptyWbInput(), good);
    expect(myAirplaneFromInput(filled, " Trainer ")).toEqual(good);
    expect(myAirplaneFromInput(emptyWbInput())).toHaveProperty("error");
    expect(myAirplaneFromInput({ ...filled, aftLimit: "80" })).toHaveProperty("error");
    expect(myAirplaneFromInput(filled, "x".repeat(41))).toHaveProperty("error");
  });
});
