import { describe, expect, it } from "vitest";

import { NOT_EXPLAINED } from "./metarExplain";
import { looksLikePirep } from "./pirepExplain";
import { explainWindsAloft, levelsAround, looksLikeWindsAloft } from "./windsAloft";
import { looksLikeTaf } from "./tafExplain";

const HEADER = "FT  3000    6000    9000   12000   18000   24000  30000  34000  39000";
/** Build a row with each cell starting under the start of its header column (blank = skipped). */
function row(station: string, cells: Record<number, string>): string {
  let line = station;
  for (const m of HEADER.matchAll(/\d{4,5}/g)) {
    const cell = cells[Number(m[0])];
    if (!cell) continue;
    line = line.padEnd(m.index!, " ") + cell;
  }
  return line;
}
const table = (...rows: string[]) => [HEADER, ...rows].join("\n");
const meaningAt = (text: string, altitude: number, station = 0) =>
  explainWindsAloft(text).stations[station]!.entries.find((e) => e.altitude === altitude)!;

describe("explainWindsAloft", () => {
  const cases: Array<[string, Record<number, string>, number, string, string]> = [
    ["normal", { 6000: "2714+08" }, 6000, "2714+08", "From 270° true at 14 kt, temperature +8 °C"],
    ["negative temperature", { 12000: "2427-06" }, 12000, "2427-06", "From 240° true at 27 kt, temperature -6 °C"],
    ["3000 ft has no temperature", { 3000: "1807" }, 3000, "1807", "From 180° true at 7 kt"],
    ["light and variable", { 3000: "9900" }, 3000, "9900", "Light and variable (less than 5 kt)"],
    ["light and variable with temperature", { 6000: "9900+05" }, 6000, "9900+05", "Light and variable (less than 5 kt), temperature +5 °C"],
    ["100 kt or more rule (7319)", { 18000: "7319-25" }, 18000, "7319-25", "From 230° true at 119 kt, temperature -25 °C"],
    ["199 kt or more", { 18000: "7699-40" }, 18000, "7699-40", "From 260° true at 199 kt or more, temperature -40 °C"],
    ["sign omitted above 24,000 ft", { 30000: "765855" }, 30000, "765855", "From 260° true at 158 kt, temperature -55 °C"],
    ["sign omitted, ordinary speed", { 39000: "270535" }, 39000, "270535", "From 270° true at 5 kt, temperature -35 °C"],
    ["unknown group", { 9000: "ABCD" }, 9000, "ABCD", NOT_EXPLAINED],
    ["bad direction code", { 9000: "4020" }, 9000, "4020", NOT_EXPLAINED],
    ["unsigned 6-digit at or below 24,000 ft", { 18000: "270535" }, 18000, "270535", NOT_EXPLAINED],
  ];
  it.each(cases)("%s", (_name, cells, altitude, raw, meaning) => {
    const entry = meaningAt(table(row("DEN", cells)), altitude);
    expect(entry.raw).toBe(raw);
    expect(entry.meaning).toBe(meaning);
  });

  it("leaves a blank 3000 ft cell as no forecast and keeps later cells in their columns", () => {
    const text = table(row("DEN", { 6000: "2214+05", 9000: "2320+01" }));
    const { entries } = explainWindsAloft(text).stations[0]!;
    expect(entries).toHaveLength(9);
    expect(entries[0]).toMatchObject({ altitude: 3000, raw: "", meaning: "No forecast for this level (blank)" });
    expect(entries[1]!.raw).toBe("2214+05");
    expect(entries[2]!.raw).toBe("2320+01");
  });

  it("uses position, not word order, when middle cells are blank", () => {
    const text = table(row("SLC", { 3000: "1807", 12000: "2427-06", 34000: "766158" }));
    const entries = explainWindsAloft(text).stations[0]!.entries;
    expect(entries.map((e) => e.raw)).toEqual(["1807", "", "", "2427-06", "", "", "", "766158", ""]);
    expect(entries[7]!.meaning).toBe("From 260° true at 161 kt, temperature -58 °C");
  });

  it("reads several stations and a header with a single station row", () => {
    const two = table(row("DEN", { 6000: "2214+05" }), row("SLC", { 6000: "1807+08" }));
    expect(explainWindsAloft(two).stations.map((s) => s.station)).toEqual(["DEN", "SLC"]);
    expect(looksLikeWindsAloft(table(row("DEN", { 6000: "2214+05" })))).toBe(true);
  });

  it("skips bulletin lines around the table", () => {
    const text = `FBUS31 KWNO 161200\nDATA BASED ON 161200Z\nVALID 161800Z   FOR USE 1400-2100Z. TEMPS NEG ABV 24000\n${table(row("DEN", { 6000: "2214+05" }))}`;
    expect(looksLikeWindsAloft(text)).toBe(true);
    expect(explainWindsAloft(text).stations).toHaveLength(1);
  });

  it("does not place a cell far from every column", () => {
    const text = table("DEN" + " ".repeat(90) + "2214+05");
    const station = explainWindsAloft(text).stations[0]!;
    expect(station.unplaced).toEqual([{ raw: "2214+05", meaning: NOT_EXPLAINED }]);
  });

  it("finds the two levels around a cruise altitude without estimating", () => {
    const station = explainWindsAloft(table(row("DEN", { 6000: "2214+05", 9000: "2320+01" }))).stations[0]!;
    const around = levelsAround(station, 8000);
    expect([around.lower!.altitude, around.upper!.altitude]).toEqual([6000, 9000]);
    expect(around.exact).toBeNull();
    expect(levelsAround(station, 9000).exact!.altitude).toBe(9000);
  });
});

describe("winds aloft detection", () => {
  it("is not triggered by a METAR, TAF or PIREP", () => {
    expect(looksLikeWindsAloft("METAR KSFO 141756Z 28012G20KT 10SM FEW008 BKN015 16/11 A3002")).toBe(false);
    expect(looksLikeWindsAloft("TAF KSFO 141120Z 1412/1518 28012KT P6SM FEW008")).toBe(false);
    expect(looksLikeWindsAloft("UA /OV OKC063064/TM 1522/FL080/TP C172")).toBe(false);
    expect(looksLikeWindsAloft("FT 3000 6000")).toBe(false);
  });
  it("a METAR is not taken for a PIREP, and a TAF is still a TAF", () => {
    expect(looksLikePirep("METAR KSFO 141756Z 28012G20KT 10SM FEW008 BKN015 16/11 A3002")).toBe(false);
    expect(looksLikePirep("TAF KSFO 141120Z 1412/1518 28012KT P6SM FEW008 BKN015")).toBe(false);
    expect(looksLikeTaf("TAF KSFO 141120Z 1412/1518 28012KT P6SM FEW008")).toBe(true);
  });
});

it("places every cell of a real-layout FB table (station elevation blanks)", () => {
  const fb = [
    "FT  3000    6000    9000   12000   18000   24000  30000  34000  39000",
    "ABI      2109+19 2213+13 2315+08 2526-07 2532-18 254833 255443 256054",
    "ABQ              2309+09 2614+03 2626-12 2638-24 275039 275448 275355",
  ].join("\n");
  const [abi, abq] = explainWindsAloft(fb).stations;
  expect(abi!.unplaced).toEqual([]);
  expect(abi!.entries.map((e) => e.raw)).toEqual(["", "2109+19", "2213+13", "2315+08", "2526-07", "2532-18", "254833", "255443", "256054"]);
  expect(abq!.entries.slice(0, 3).map((e) => e.raw)).toEqual(["", "", "2309+09"]);
  expect(abq!.entries[6]!.meaning).toBe("From 270° true at 50 kt, temperature -39 °C");
});

describe("tab-separated paste (BH-13)", () => {
  it("places cells by column when the table was copied with tabs", () => {
    const text = ["FT\t3000\t6000\t9000", "ABQ\t\t2309+09\t2512+05", "ABI\t1807\t2109+19\t2213+13"].join("\n");
    const out = explainWindsAloft(text);
    const at = (s: number, a: number) => out.stations[s]!.entries.find((e) => e.altitude === a)!;
    expect(at(0, 3000).raw).toBe("");
    expect(at(0, 6000).raw).toBe("2309+09");
    expect(at(0, 9000).raw).toBe("2512+05");
    expect(at(1, 3000).raw).toBe("1807");
  });
});
