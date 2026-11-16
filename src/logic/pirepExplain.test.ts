import { describe, expect, it } from "vitest";

import { NOT_EXPLAINED } from "./metarExplain";
import { explainPirep, looksLikePirep } from "./pirepExplain";

const meaning = (text: string, raw: string) => explainPirep(text).tokens.find((t) => t.raw === raw)?.meaning;

describe("looksLikePirep", () => {
  it.each([
    ["UA /OV OKC063064/TM 1522/FL080/TP C172", true],
    ["UUA /OV OKC/TM 1522/FL080/TP C172/TB SEV", true],
    ["OKC UA /OV OKC063064/TM 1522", true],
    ["KSFO UUA /OV SFO", true],
    ["METAR KSFO 141756Z 28012G20KT 10SM FEW008 BKN015 16/11 A3002", false],
    ["", false],
  ])("%s", (text, expected) => expect(looksLikePirep(text)).toBe(expected));
});

describe("explainPirep", () => {
  it("decodes a routine report", () => {
    const text = "UA /OV OKC063064/TM 1522/FL080/TP C172/SK BKN065-TOP090/WX FV03SM HZ/TA M05/WV 270030KT/TB NEG/IC NEG/RM SMOOTH";
    const t = explainPirep(text).tokens;
    expect(t[0]).toEqual({ raw: "UA", meaning: "Routine pilot report" });
    expect(meaning(text, "OV OKC063064")).toBe("Location: 64 nautical miles from OKC on the 063° bearing");
    expect(meaning(text, "TM 1522")).toBe("Time 1522 Zulu (UTC)");
    expect(meaning(text, "FL080")).toBe("Altitude 8,000 ft (flight level in hundreds of feet)");
    expect(meaning(text, "TP C172")).toBe("Aircraft type C172");
    expect(meaning(text, "SK BKN065-TOP090")).toContain("base 6,500 ft, top 9,000 ft");
    expect(meaning(text, "WX FV03SM HZ")).toBe("FV03SM: Flight visibility 3 statute miles; HZ: Haze");
    expect(meaning(text, "TA M05")).toBe("Outside air temperature -5 °C");
    expect(meaning(text, "WV 270030KT")).toBe("Wind from 270° at 30 kt");
    expect(meaning(text, "TB NEG")).toBe("No turbulence reported");
    expect(meaning(text, "IC NEG")).toBe("No icing reported");
    expect(meaning(text, "RM SMOOTH")).toBe("Remarks: SMOOTH");
  });

  it("decodes an urgent report with turbulence and icing", () => {
    const text = "OKC UUA /OV OKC/TM 1530/FL UNKN/TP B737/TB OCNL SEV CAT 090-110/IC MOD-SEV RIME BLO 050";
    const t = explainPirep(text).tokens;
    expect(t[0]).toEqual({ raw: "OKC", meaning: "Station OKC" });
    expect(t[1]).toEqual({ raw: "UUA", meaning: "Urgent pilot report" });
    expect(meaning(text, "OV OKC")).toBe("Location: over OKC");
    expect(meaning(text, "FL UNKN")).toBe("Altitude not known");
    expect(meaning(text, "TB OCNL SEV CAT 090-110")).toBe("Occasional severe clear-air turbulence at 9,000 to 11,000 ft");
    expect(meaning(text, "IC MOD-SEV RIME BLO 050")).toBe("Moderate to severe rime ice icing at below 5,000 ft");
  });

  it("says so for an unknown field and a bad value", () => {
    const text = "UA /OV OKC/TM 1522/ZZ 123/FL 9X/TB LGT FOO";
    expect(meaning(text, "ZZ 123")).toBe(NOT_EXPLAINED);
    expect(meaning(text, "FL 9X")).toBe(NOT_EXPLAINED);
    expect(meaning(text, "TB LGT FOO")).toContain(`FOO: ${NOT_EXPLAINED}`);
  });

  it("keeps a slash inside the remarks", () => {
    expect(meaning("UA /OV OKC/TM 1522/RM SMOOTH/CLR ABV", "RM SMOOTH/CLR ABV")).toBe("Remarks: SMOOTH/CLR ABV");
  });
});
