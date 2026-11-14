import { describe, expect, it } from "vitest";
import {
  WB_PRACTICE,
  calculateWeightBalance,
  emptyWbInput,
} from "./weightBalance";

describe("calculateWeightBalance", () => {
  it("computes problem 1 by hand: 2070 lb, moment 180500, CG 87.20", () => {
    const r = calculateWeightBalance(WB_PRACTICE[0]!.input);
    expect(r.ok && r.totalWeight).toBe(2070);
    expect(r.ok && r.totalMoment).toBe(180500);
    expect(r.ok && r.cg).toBe(87.2);
    expect(r.ok && r.verdict).toBe("Within the limits you entered.");
  });
  it("converts fuel gallons at 6 lb/gal", () => {
    const r = calculateWeightBalance(WB_PRACTICE[0]!.input);
    expect(r.ok && r.rows.find((x) => x.key === "fuel")).toMatchObject({ weight: 180, moment: 17100 });
  });
  it("flags max gross", () => {
    const r = calculateWeightBalance(WB_PRACTICE[1]!.input);
    expect(r.ok && r.cg).toBe(93.17);
    expect(r.ok && r.verdict).toBe("Over max gross weight by 110 lb.");
  });
  it("flags aft and forward limits", () => {
    const aft = calculateWeightBalance(WB_PRACTICE[2]!.input);
    expect(aft.ok && aft.cg).toBe(88.41);
    expect(aft.ok && aft.verdict).toContain("0.91 in behind the aft limit");
    const fwdIn = { ...WB_PRACTICE[0]!.input, forwardLimit: "88" };
    const fwd = calculateWeightBalance(fwdIn);
    expect(fwd.ok && fwd.verdict).toContain("ahead of the forward limit");
  });
  it("skips limit checks when none entered", () => {
    const input = { ...WB_PRACTICE[0]!.input, maxGross: "", forwardLimit: "", aftLimit: "" };
    const r = calculateWeightBalance(input);
    expect(r.ok && r.withinLimits).toBe(true);
    expect(r.ok && r.limitsEntered).toBe(false);
  });
  it("rejects bad input", () => {
    const base = () => JSON.parse(JSON.stringify(WB_PRACTICE[0]!.input));
    const nan = base();
    nan.rows.front.amount = "abc";
    expect(calculateWeightBalance(nan).ok).toBe(false);
    const neg = base();
    neg.rows.baggage.amount = "-5";
    expect(calculateWeightBalance(neg).ok).toBe(false);
    expect(calculateWeightBalance(emptyWbInput()).ok).toBe(false);
    const zero = base();
    zero.rows.empty = { amount: "0", arm: "85" };
    zero.rows.front = { amount: "0", arm: "85" };
    zero.rows.fuel = { amount: "", arm: "" };
    zero.rows.baggage = { amount: "", arm: "" };
    expect(calculateWeightBalance(zero)).toEqual({ ok: false, error: "Total weight must be more than zero." });
    const badLimit = base();
    badLimit.aftLimit = "x";
    expect(calculateWeightBalance(badLimit).ok).toBe(false);
  });
});
