import { describe, expect, it } from "vitest";
import { clockIsConsistent, conditionsSummary, localTimeText, normalizeIcao, PARTIAL, periodLabel, timeText, weatherAges, type WeatherReport } from "./weather";
export const syntheticReport: WeatherReport = {
  station: "KZZZ", name: "Imaginary Learning Field", raw: "METAR KZZZ 281200Z 22007G12KT P6SM FEW040 M02/M05 RMK SYNTHETIC",
  reportTime: Date.parse("2026-10-28T12:00:00Z"), validFrom: null, validTo: null, unavailable: false,
  conditions: { wdir: 220, wspd: 7, wgst: 12, visib: "6+", clouds: [{ cover: "FEW", base: 4000 }], temp: -2, altim: 1013.2 }, periods: [],
};
describe("weather identity and deterministic partial words", () => {
  it("normalizes only four ASCII letters without inference", () => {
    expect(normalizeIcao(" kZzZ ")).toBe("KZZZ");
    for (const code of ["ZZZ", "KZZ1", "KZZZ,KZZB", "https://KZZZ", "ＫZZZ", "KßZ", "KZ\nZ", "\nKZZZ", "KZZZ\t", "@CA", ""]) expect(normalizeIcao(code)).toBeNull();
  });
  it("uses explicit units and preserves uncertainty", () => {
    const text = conditionsSummary(syntheticReport.conditions);
    expect(text).toContain("Wind from 220° at 7 knots, gusting to 12.");
    expect(text).toContain("Visibility greater than 6 statute miles.");
    expect(text).toContain("Few clouds at 4000 feet.");
    expect(text).toContain("Temperature -2°C.");
    expect(text).toContain("Altimeter 1013.2 hPa.");
    expect(text).toContain(PARTIAL); expect(text).not.toContain("inHg");
    expect(text).not.toMatch(/safe|suitable|cleared|ready|VFR|IFR|fly/i);
  });
  it("distinguishes calm, variable and missing winds", () => {
    expect(conditionsSummary({ wdir: 0, wspd: 0 })).toContain("Wind calm.");
    expect(conditionsSummary({ wdir: "VRB", wspd: 4, wgst: 9 })).toContain("Wind direction variable at 4 knots, gusting to 9.");
    for (const c of [{}, { wspd: null }, { wspd: -1 }, { wspd: NaN }]) { expect(conditionsSummary(c)).toContain("Wind not reported."); expect(conditionsSummary(c)).not.toContain("calm"); }
    expect(conditionsSummary({ wspd: 0, wdir: null })).toContain("Wind direction not reported.");
  });
  it("handles fractional visibility, null cloud bases, VV and undecoded CAVOK without inventions", () => {
    expect(conditionsSummary({ visib: "1 1/2", clouds: [{ cover: "BKN", base: null }] })).toContain("Visibility 1 1/2 statute miles.");
    expect(conditionsSummary({ clouds: [{ cover: "BKN", base: null }] })).toContain("Broken clouds; base not reported.");
    expect(conditionsSummary({ vertVis: 500 })).toContain("Vertical visibility 500 feet.");
    for (const visib of [null, "CAVOK", "unknown", "1/0", -1]) { const text = conditionsSummary({ visib }); expect(text).not.toContain("clear"); expect(text).toContain(PARTIAL); }
  });
  it("keeps change and probability qualifiers distinct, with unknown groups raw-only", () => {
    for (const change of ["FM", "TEMPO", "BECMG", "PROB30", "PROB40"]) expect(periodLabel({ fcstChange: change })).toContain(change);
    expect(periodLabel({ fcstChange: "TEMPO", probability: 30 })).toBe("Temporary (TEMPO) · 30% probability");
    expect(periodLabel({ fcstChange: "UNKNOWN" })).toBe("Period details are only in the original report.");
  });
});
describe("weather report age is independent of fetch age", () => {
  const time = syntheticReport.reportTime!;
  it("uses exact conservative boundaries", () => {
    expect(weatherAges(syntheticReport, "metar", time, time + 90 * 60_000, true)).not.toContain("Older observation");
    expect(weatherAges(syntheticReport, "metar", time + 91 * 60_000, time + 91 * 60_000, true)).toContain("Older observation");
    expect(weatherAges(syntheticReport, "metar", time, time + 15 * 60_000, true)).not.toContain("Last check is old");
    expect(weatherAges(syntheticReport, "metar", time, time + 15 * 60_000 + 1, true)).toContain("Last check is old");
    expect(weatherAges(syntheticReport, "taf", time, time + 6 * 3600_000, true)).not.toContain("Older forecast");
    expect(weatherAges(syntheticReport, "taf", time, time + 6 * 3600_000 + 1, true)).toContain("Older forecast");
  });
  it("marks validity separately with an exclusive end", () => {
    const report = { ...syntheticReport, validFrom: time, validTo: time + 3600_000 };
    expect(weatherAges(report, "taf", time, time - 1, true).some(s => s.startsWith("Forecast starts"))).toBe(true);
    expect(weatherAges(report, "taf", time, time, true)).not.toContain("Forecast has ended");
    expect(weatherAges(report, "taf", time, time + 3600_000, true)).toContain("Forecast has ended");
  });
  it("does not use receipt time or clamp a future report to just now", () => {
    for (const reportTime of [null, time + 1, time + 300001]) {
      const labels = weatherAges({ ...syntheticReport, reportTime }, "metar", time, time, true);
      expect(labels).toContain("Report time couldn't be checked"); expect(labels.join(" ")).not.toContain("Observation age");
    }
    expect(weatherAges(syntheticReport, "metar", time + 1, time, true)).toContain("Last check time couldn't be checked");
  });
  it("invalidates confidence on rollback/forward jumps but accepts sleep with elapsed monotonic time", () => {
    expect(clockIsConsistent(time - 10000, 1000, time, 0)).toBe(false);
    expect(clockIsConsistent(time + 100000, 1000, time, 0)).toBe(false);
    expect(clockIsConsistent(time + 3600_000, 3600_000, time, 0)).toBe(true);
    expect(weatherAges(syntheticReport, "taf", time, time + 3600_000, false)).toContain("Report time couldn't be checked");
  });
  it("shows full UTC dates across midnight, leap and year rollovers and labels local DST", () => {
    for (const date of ["2024-02-29T23:59:59Z", "2026-12-31T23:59:59Z", "2027-01-01T00:00:00Z"]) expect(timeText(Date.parse(date))).toContain(date.slice(0, 4));
    const before = localTimeText(Date.parse("2026-11-01T08:30:00Z"), "America/Los_Angeles");
    const after = localTimeText(Date.parse("2026-11-01T09:30:00Z"), "America/Los_Angeles");
    expect(before).toContain("Local:"); expect(before).toContain("01:30:00"); expect(after).toContain("01:30:00"); expect(before).not.toBe(after);
    expect(timeText(Date.parse("2026-11-01T08:30:00Z"))).toContain("UTC");
    expect(timeText(Number.MAX_VALUE)).toBe("Time couldn't be checked");
  });
});
