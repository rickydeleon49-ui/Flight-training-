import { describe, expect, it } from "vitest";

import { NOT_EXPLAINED } from "./metarExplain";
import { explainNotam, looksLikeNotam, NOTAM_GLOSSARY } from "./notamExplain";
import { looksLikePirep } from "./pirepExplain";
import { looksLikeTaf } from "./tafExplain";
import { looksLikeWindsAloft } from "./windsAloft";

const meaning = (text: string, raw: string) => explainNotam(text).tokens.find((t) => t.raw === raw)?.meaning;

const METAR = "METAR KSFO 141756Z 28012G20KT 10SM FEW008 BKN015 16/11 A3002 RMK AO2 SLP168";
const TAF = "TAF KSFO 141120Z 1412/1518 28012KT P6SM FEW008 BKN015 FM141800 29015G25KT P6SM SCT035";
const FB = ["FT  3000    6000    9000", "SFO 9900 2725+11 2734+05"].join("\n");
const PIREP = "UA /OV OKC063064/TM 1522/FL080/TP C172/SK BKN065-TOP090/WX FV03SM HZ/TA M05/WV 270030KT/TB LGT-MOD CHOP/IC LGT RIME";
const NOTAM = "!CLE 11/045 CLE TWY L CLSD 2611201300-2611202100";

describe("looksLikeNotam", () => {
  it.each([
    [NOTAM, true],
    ["!FDC 6/1323 PWK IAP CHICAGO", true],
    ["!SUAW mm/nnn ZSE AIRSPACE", true],
    ["  !ILN ILN NAV MXQ VOR U/S", true],
    ["!CLE", true],
    ["!AB CLE", false],
    ["!ABCDEF CLE", false],
    ["CLE 11/045 TWY L CLSD", false],
    ["", false],
  ])("%s", (text, expected) => expect(looksLikeNotam(text)).toBe(expected));
});

describe("detection stays apart", () => {
  it.each([METAR, TAF, FB, PIREP])("a report is not a NOTAM: %s", (text) => expect(looksLikeNotam(text)).toBe(false));
  it("a NOTAM is not a METAR-family report", () => {
    expect(looksLikePirep(NOTAM)).toBe(false);
    expect(looksLikeTaf(NOTAM)).toBe(false);
    expect(looksLikeWindsAloft(NOTAM)).toBe(false);
  });
});

describe("explainNotam", () => {
  it("decodes a NOTAM D with a number", () => {
    const t = explainNotam(NOTAM).tokens;
    expect(t[0]).toEqual({ raw: "!CLE", meaning: "Accountability location CLE (keeps the NOTAM numbering)" });
    expect(t[1]).toEqual({ raw: "11/045", meaning: "NOTAM number 045 for month 11 (November)" });
    expect(t[2]!.meaning).toMatch(/^Location CLE/);
    expect(t[3]).toMatchObject({ raw: "TWY" });
    expect(t[3]!.meaning).toMatch(/^Taxiway/);
    expect(t[4]).toEqual({ raw: "L", meaning: "Taxiway L" });
    expect(t[5]).toEqual({ raw: "CLSD", meaning: "closed" });
    expect(t[6]).toEqual({
      raw: "2611201300-2611202100",
      meaning: "From 20 Nov 2026 13:00 UTC until 20 Nov 2026 21:00 UTC (all NOTAMs end at their end time unless PERM)",
    });
  });

  it("names the runway right after RWY", () => {
    const text = "!CLE 11/046 CLE RWY 13/31 CLSD";
    expect(meaning(text, "13/31")).toBe("Runway 13/31");
    expect(meaning(text, "CLSD")).toBe("closed");
  });

  it("decodes a NOTAM without a number (App. A style)", () => {
    const text = "!ILN ILN NAV MXQ VOR U/S";
    const t = explainNotam(text).tokens;
    expect(t.map((x) => x.raw)).toEqual(["!ILN", "ILN", "NAV", "MXQ", "VOR", "U/S"]);
    expect(t[2]!.meaning).toMatch(/^Navigation aid/);
    expect(meaning(text, "VOR")).toBe("VHF omnidirectional radio range");
    expect(meaning(text, "U/S")).toBe("unserviceable (out of service)");
  });

  it("decodes an FDC NOTAM with Y/NNNN", () => {
    const text = "!FDC 6/1323 PWK IAP CHICAGO EXECUTIVE, IL. VOR RWY 16, ORIG-B";
    expect(meaning(text, "!FDC")).toMatch(/^Flight Data Center NOTAM/);
    expect(meaning(text, "6/1323")).toBe("FDC NOTAM number 1323 (6 = year of issuance)");
    expect(meaning(text, "IAP")).toBe("Instrument approach procedure");
  });

  it("decodes OBST heights as MSL and AGL", () => {
    const text = "!CLE 11/050 ZOB OBST WIND TURBINE FARM WI AN AREA DEFINED AS 4NM RADIUS OF 411931N0822776W 2820FT (410FT AGL) LGT U/S 2611201300-2611202100";
    expect(meaning(text, "2820FT")).toBe("2,820 ft MSL");
    expect(meaning(text, "(410FT AGL)")).toBe("410 ft above ground level");
    expect(meaning(text, "4NM")).toBe("4 nautical miles");
    expect(meaning(text, "WI")).toBe("within");
  });

  it("decodes an airspace range", () => {
    const text = "!SUAW 11/012 ZSE AIRSPACE OKANOGAN C MOA ACT SFC-3500FT 2611201500-2611202245";
    expect(meaning(text, "SFC-3500FT")).toBe("From surface up to 3,500 ft MSL");
    expect(meaning(text, "MOA")).toBe("military operations area");
  });

  it("decodes FICON codes", () => {
    const text = "!LGA 11/101 LGA RWY 13 FICON 4/4/4 100 PCT WET ICE 2611201300-2611202100";
    expect(meaning(text, "4/4/4")).toBe("Runway condition codes (0-6) for the first, middle and last third of the runway");
    expect(meaning(text, "PCT")).toBe("percent");
    expect(meaning(text, "FICON")).toBe("field condition");
  });

  it("explains EST after the end time", () => {
    const t = explainNotam("!CLE 11/045 CLE TWY L CLSD 2611201300-2611202100EST").tokens;
    expect(t.at(-1)!.raw).toBe("EST");
    expect(t.at(-1)!.meaning).toMatch(/estimated end: it may be cancelled earlier, and it ends at this time anyway if not/);
    expect(t.at(-2)!.meaning).toMatch(/until 20 Nov 2026 21:00 UTC/);
  });

  it("explains PERM and a spaced validity", () => {
    expect(meaning("!CLE 11/045 CLE TWY L CLSD 2611201300-PERM", "2611201300-PERM")).toBe(
      "From 20 Nov 2026 13:00 UTC. PERM: permanent (does not expire on its own)",
    );
    expect(explainNotam("!CLE 11/045 CLE TWY L CLSD 2611201300 - 2611202100").tokens.at(-1)!.raw).toBe("2611201300-2611202100");
  });

  it("reads schedule words", () => {
    const text = "!CLE 11/045 CLE AD AP CLSD DLY EXC SR-SS";
    expect(meaning(text, "DLY")).toBe("daily");
    expect(meaning(text, "EXC")).toBe("except");
    expect(meaning(text, "SR-SS")).toBe("sunrise to sunset");
  });

  it("marks an unverified keyword", () => {
    expect(meaning("!CLE 11/045 CLE (U) RWY 04 CLSD", "(U)")).toMatch(/^unverified/);
  });

  it("does not guess an unknown keyword", () => {
    expect(meaning("!CLE 11/045 CLE FOO TWY L CLSD", "FOO")).toBe(NOT_EXPLAINED);
  });

  it("does not guess placeholder numbers or dates", () => {
    expect(meaning("!FDC x/xxxx ZHU AIRSPACE SFC-UNL", "x/xxxx".toUpperCase())).toBe(NOT_EXPLAINED);
    expect(meaning("!SUAW mm/nnn ZSE AIRSPACE X", "MM/NNN")).toBe(NOT_EXPLAINED);
    expect(meaning("!CLE CLE TWY L UNSAFE YYMMDDHHMM-YYMMDDHHMM", "YYMMDDHHMM-YYMMDDHHMM")).toBe(NOT_EXPLAINED);
    expect(meaning("!CLE 13/045 CLE TWY L CLSD", "13/045")).toBe(NOT_EXPLAINED);
  });
});

describe("glossary", () => {
  it("has no empty meanings", () => {
    expect(Object.values(NOTAM_GLOSSARY).every((v) => v.length > 0)).toBe(true);
  });
});

describe("NOTAM dates", () => {
  it("rejects a day that does not exist in the month", () => {
    expect(explainNotam("!ABC 02/001 ZZZ AIRSPACE TEST 2602311300-2602312100").tokens.map((t) => t.meaning).join(" ")).not.toContain("31 Feb");
    expect(explainNotam("!ABC 02/001 ZZZ AIRSPACE TEST 2604301300-2604302100").tokens.map((t) => t.meaning).join(" ")).toContain("30 Apr 2026");
  });
});

describe("height range datum (BH-12)", () => {
  it("reads both ends of an AGL range as AGL", () => {
    const text = "!ABC 02/001 ZZZ AIRSPACE TEST 1000FT-3000FT AGL 2602011300-2602012100";
    const t = explainNotam(text).tokens.find((x) => x.raw.startsWith("1000FT-3000FT"));
    expect(t?.meaning).not.toMatch(/MSL/);
    expect(t?.meaning).toMatch(/above ground level/);
  });
});
