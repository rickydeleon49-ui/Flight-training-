import { describe, expect, it } from "vitest";
import { explainMetar, flightCategory, NOT_EXPLAINED } from "./metarExplain";

const meaning = (r: ReturnType<typeof explainMetar>, raw: string) => r.tokens.find((t) => t.raw === raw)?.meaning;

describe("explainMetar", () => {
  it("decodes a full report", () => {
    const r = explainMetar("METAR KJFK 141651Z AUTO 28015G25KT 250V310 1 1/2SM R04R/2000FT -RA BR BKN008 OVC015CB 08/M02 A2992 RMK AO2 SLP132 T00831022=");
    expect(meaning(r, "METAR")).toMatch(/Routine/);
    expect(meaning(r, "KJFK")).toBe("Station KJFK");
    expect(meaning(r, "141651Z")).toBe("Day 14 of the month, 1651 Zulu (UTC)");
    expect(meaning(r, "AUTO")).toMatch(/automated/);
    expect(meaning(r, "28015G25KT")).toBe("Wind from 280° true at 15 knots, gusting 25 knots");
    expect(meaning(r, "250V310")).toMatch(/between 250 and 310/);
    expect(meaning(r, "1 1/2SM")).toBe("Visibility 1 1/2 statute miles");
    expect(meaning(r, "R04R/2000FT")).toBe("Runway 04R visual range 2000 ft");
    expect(meaning(r, "-RA")).toBe("Light rain");
    expect(meaning(r, "BR")).toBe("Mist");
    expect(meaning(r, "BKN008")).toMatch(/Broken.* at 800 ft/);
    expect(meaning(r, "OVC015CB")).toMatch(/cumulonimbus/);
    expect(meaning(r, "08/M02")).toBe("Temperature 8 C, dew point -2 C");
    expect(meaning(r, "A2992")).toBe("Altimeter setting 29.92 inches of mercury");
    expect(meaning(r, "RMK")).toBe("Remarks");
    expect(meaning(r, "AO2")).toMatch(/precipitation sensor/);
    expect(meaning(r, "SLP132")).toBe("Sea-level pressure 1013.2 hPa");
    expect(meaning(r, "T00831022")).toBe("Exact temperature 8.3 C and dew point -2.2 C");
    expect(r.category).toBe("IFR");
  });

  it("handles calm, variable wind, SPECI, COR, minus visibility, negatives", () => {
    const a = explainMetar("SPECI KORD 010000Z COR 00000KT M1/4SM FG VV002 M05/M06 A3001");
    expect(meaning(a, "SPECI")).toMatch(/Special/);
    expect(meaning(a, "COR")).toBe("Corrected report");
    expect(meaning(a, "00000KT")).toBe("Calm wind");
    expect(meaning(a, "M1/4SM")).toBe("Visibility less than 1/4 statute mile");
    expect(meaning(a, "VV002")).toMatch(/vertical visibility 200 ft/);
    expect(meaning(a, "M05/M06")).toBe("Temperature -5 C, dew point -6 C");
    expect(a.category).toBe("LIFR");
    const b = explainMetar("KDEN 021200Z VRB04KT 10SM CLR 20/05 A3010");
    expect(meaning(b, "VRB04KT")).toMatch(/variable in direction at 4 knots/);
    expect(meaning(b, "CLR")).toMatch(/Clear below/);
    expect(b.category).toBe("VFR");
  });

  it("explains weather combinations and sky types", () => {
    const r = explainMetar("KMCO 011800Z 18010KT 3SM +TSRA VCSH FEW040TCU SCT250 30/24 A2995");
    expect(meaning(r, "+TSRA")).toBe("Heavy thunderstorm with rain");
    expect(meaning(r, "VCSH")).toBe("In the vicinity: showers");
    expect(meaning(r, "FEW040TCU")).toMatch(/towering cumulus/);
    expect(meaning(r, "SCT250")).toMatch(/Scattered clouds.* at 25,000 ft/);
    expect(r.category).toBe("MVFR");
    expect(meaning(explainMetar("KAAA 011800Z FZFG"), "FZFG")).toBe("Freezing fog");
    expect(meaning(explainMetar("KAAA 011800Z 1SM"), "1SM")).toBe("Visibility 1 statute mile");
  });

  it("never guesses unknown tokens", () => {
    const r = explainMetar("KABC 011800Z 18010KT 10SM XYZ123 FOO RMK AO2 PK WND 28030/1655");
    expect(meaning(r, "XYZ123")).toBe(NOT_EXPLAINED);
    expect(meaning(r, "FOO")).toBe(NOT_EXPLAINED);
    expect(meaning(r, "PK")).toMatch(/Remark/);
    expect(meaning(explainMetar("KABC 011800Z NOPE"), "NOPE")).toBe(NOT_EXPLAINED);
  });

  it("returns no tokens for empty input", () => {
    expect(explainMetar("  ").tokens).toEqual([]);
    expect(explainMetar("").category).toBeNull();
  });
});

describe("flightCategory thresholds", () => {
  const c = (ceil: number | null, vis: number | null) => flightCategory(ceil, vis).category;
  it("ceiling edges", () => {
    expect(c(3001, 10)).toBe("VFR");
    expect(c(3000, 10)).toBe("MVFR");
    expect(c(1000, 10)).toBe("MVFR");
    expect(c(999, 10)).toBe("IFR");
    expect(c(500, 10)).toBe("IFR");
    expect(c(499, 10)).toBe("LIFR");
  });
  it("visibility edges", () => {
    expect(c(null, 6)).toBe("VFR");
    expect(c(null, 5)).toBe("MVFR");
    expect(c(null, 3)).toBe("MVFR");
    expect(c(null, 2.9)).toBe("IFR");
    expect(c(null, 1)).toBe("IFR");
    expect(c(null, 0.75)).toBe("LIFR");
  });
  it("worse of the two wins; nothing gives null", () => {
    expect(c(5000, 2)).toBe("IFR");
    expect(c(400, 10)).toBe("LIFR");
    expect(c(null, null)).toBeNull();
  });
});

describe("weather group wording", () => {
  const m = (t: string, raw: string) => explainMetar(`KAAA 011800Z ${t}`).tokens.find((x) => x.raw === raw)!.meaning;
  it("only says with/of when a type follows", () => {
    expect(m("TS", "TS")).toBe("Thunderstorm");
    expect(m("VCTS", "VCTS")).toBe("In the vicinity: thunderstorm");
    expect(m("TSRA", "TSRA")).toBe("Thunderstorm with rain");
  });
  it("decodes +FC, CAVOK and CLR/SKC", () => {
    expect(m("+FC", "+FC")).toBe("Tornado or waterspout");
    expect(m("CAVOK", "CAVOK")).toMatch(/^Ceiling and visibility OK/);
    expect(m("SKC", "SKC")).toBe("Sky clear");
  });
});
