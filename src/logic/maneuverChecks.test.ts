import { describe, expect, it } from "vitest";

import { defaultToolkitState, normalizeToolkitState } from "./toolkit";
import {
  catalogLine,
  checkCounts,
  MANEUVER_CHECK_CAP,
  MANEUVER_FOOTER,
  MANEUVERS,
  normalizeManeuverChecks,
  recentChecks,
  toleranceLine,
} from "./maneuverChecks";

const BANNED = /\b(go|no-go|safe|legal|required|ready|pass|fail)\b|OK to fly|readiness score/i;
const ok = (over = {}) => ({
  task: "PA.V.A", date: "2026-11-19", items: [{ code: "PA.V.A.S5", label: "Altitude ±100 feet", rating: "Within" }], ...over,
});

describe("tolerances come from the ACS catalog", () => {
  it("includes steep turns and every task code resolves", () => {
    expect(MANEUVERS.map((m) => m.task)).toContain("PA.V.A");
    for (const m of MANEUVERS) expect(m.tolerances.length).toBeGreaterThan(0);
  });
  for (const m of MANEUVERS) {
    for (const t of m.tolerances) {
      it(`${m.task} ${t.label}: "${t.text}" is in ${t.code}`, () => {
        expect(t.code.startsWith(`${m.task}.S`)).toBe(true);
        const line = catalogLine(t.code);
        expect(line).toBeTruthy();
        expect(line).toContain(t.text);
        // every number shown appears in the catalog line
        for (const n of toleranceLine(t).match(/\d+/g) ?? []) expect(line).toContain(n);
      });
    }
  }
});

describe("wording", () => {
  it("has no banned words in titles, lines or footer", () => {
    const all = [MANEUVER_FOOTER, ...MANEUVERS.flatMap((m) => [m.title, ...m.tolerances.map(toleranceLine)])];
    for (const s of all) expect(s).not.toMatch(BANNED);
    expect(MANEUVER_FOOTER).toBe("Your own view. Your instructor decides.");
  });
});

describe("normalizeManeuverChecks", () => {
  it("returns undefined for non-arrays and empty results", () => {
    expect(normalizeManeuverChecks(undefined)).toBeUndefined();
    expect(normalizeManeuverChecks("x")).toBeUndefined();
    expect(normalizeManeuverChecks([])).toBeUndefined();
  });
  it("drops bad shapes and keeps good ones unchanged", () => {
    const good = ok({ note: "windy" });
    const out = normalizeManeuverChecks([
      good, null, 5, ok({ task: "" }), ok({ date: "19 Nov" }), ok({ items: [] }), ok({ items: "x" }),
      ok({ items: [{ code: "A", label: "L", rating: "Pass" }] }),
    ]);
    expect(out).toEqual([good]);
  });
  it("drops bad items inside a good check and trims long notes", () => {
    const out = normalizeManeuverChecks([
      ok({ items: [{ code: "", label: "x", rating: "Close" }, ok().items[0]], note: "n".repeat(500) }),
    ]);
    expect(out![0]!.items).toHaveLength(1);
    expect(out![0]!.note).toHaveLength(200);
  });
  it("caps to the newest", () => {
    const many = Array.from({ length: MANEUVER_CHECK_CAP + 5 }, (_, i) => ok({ date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, note: String(i) }));
    const out = normalizeManeuverChecks(many)!;
    expect(out).toHaveLength(MANEUVER_CHECK_CAP);
    expect(out.at(-1)!.note).toBe(String(MANEUVER_CHECK_CAP + 4));
  });
});

describe("toolkit integration", () => {
  it("old state has no field, version stays 1, and the field round-trips", () => {
    const old = normalizeToolkitState(defaultToolkitState());
    expect("maneuverChecks" in old).toBe(false);
    const withChecks = normalizeToolkitState({ ...defaultToolkitState(), maneuverChecks: [ok()] });
    expect(withChecks.version).toBe(1);
    expect(normalizeToolkitState(withChecks).maneuverChecks).toEqual([ok()]);
    expect("maneuverChecks" in normalizeToolkitState({ ...defaultToolkitState(), maneuverChecks: 3 })).toBe(false);
  });
});

describe("helpers", () => {
  it("counts and recent per maneuver", () => {
    const c = ok({ items: [
      { code: "a", label: "a", rating: "Within" }, { code: "b", label: "b", rating: "Close" }, { code: "c", label: "c", rating: "Not yet" }, { code: "d", label: "d", rating: "Close" },
    ] }) as never;
    expect(checkCounts(c)).toEqual({ Within: 1, Close: 2, "Not yet": 1 });
    const list = [ok({ date: "2026-01-01" }), ok({ task: "PA.V.B" }), ok({ date: "2026-01-02" }), ok({ date: "2026-01-03" }), ok({ date: "2026-01-04" })] as never[];
    const r = recentChecks(list, "PA.V.A");
    expect(r.map((x) => x.date)).toEqual(["2026-01-04", "2026-01-03", "2026-01-02"]);
  });
});
