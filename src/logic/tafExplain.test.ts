import { describe, expect, it } from "vitest";
import { explainTaf, looksLikeTaf } from "./tafExplain";

const SAMPLE =
  "TAF KSFO 141120Z 1412/1518 28012KT P6SM FEW008 BKN015 FM141800 29015G25KT P6SM SCT035 TEMPO 1420/1424 3SM -RA BKN012 BECMG 1500/1502 VRB03KT 2SM BR OVC006 PROB30 1504/1507 1/2SM FG VV002 FM151000 CAVOK=";

describe("explainTaf", () => {
  const r = explainTaf(SAMPLE);
  it("recognises the header", () => {
    expect(looksLikeTaf(SAMPLE)).toBe(true);
    expect(looksLikeTaf("METAR KSFO 141756Z")).toBe(false);
    const meaning = (raw: string) => r.header.find((t) => t.raw === raw)?.meaning;
    expect(meaning("TAF")).toMatch(/forecast/i);
    expect(meaning("KSFO")).toBe("Station KSFO");
    expect(meaning("141120Z")).toBe("Issued on the 14th at 1120 Zulu");
    expect(meaning("1412/1518")).toBe("Forecast is valid from the 14th at 1200 Zulu until the 15th at 1800 Zulu");
  });
  it("explains 24Z and change groups", () => {
    const x = explainTaf("TAF KAAA 141120Z 1418/1524 VRB03KT 6SM SKC");
    expect(x.header.find((t) => t.raw === "1418/1524")?.meaning).toContain("until the 15th at 2400 (end of the day) Zulu");
    expect(r.periods.map((p) => p.label)).toEqual([
      "Starting conditions",
      "From (FM)",
      "Temporary (TEMPO)",
      "Becoming (BECMG)",
      "30% chance (PROB30)",
      "From (FM)",
    ]);
    expect(r.periods[1]!.meaning).toContain("the 14th at 1800 Zulu");
    expect(r.periods[2]!.meaning).toContain("from the 14th at 2000 Zulu until the 14th at 2400 (end of the day) Zulu");
  });
  it("gives a flight category per period", () => {
    expect(r.periods.map((p) => p.category)).toEqual(["MVFR", "VFR", "MVFR", "IFR", "LIFR", "VFR"]);
    expect(r.periods[0]!.tokens.find((t) => t.raw === "28012KT")?.meaning).toBe("Wind from 280 degrees at 12 knots");
  });
  it("handles PROB40 TEMPO and temperatures", () => {
    const x = explainTaf("TAF KBBB 010500Z 0106/0206 18010KT 9999 NSW PROB40 TEMPO 0110/0114 TSRA TX25/0121Z");
    expect(x.periods[1]!.label).toBe("40% chance, temporary (PROB40 TEMPO)");
    expect(x.periods[1]!.tokens[0]!.meaning).toBe("Thunderstorm with rain");
    expect(x.periods[1]!.tokens.some((t) => t.meaning.startsWith("Expected highest temperature 25 C"))).toBe(true);
  });
});
