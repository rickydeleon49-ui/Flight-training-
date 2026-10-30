import { describe, expect, it } from "vitest";

import { buildAirportIndex, loadAirportIndex, nightHint, nightHintText } from "./nightHint";

const index = buildAirportIndex({
  rows: [
    "KPAO PAO|37.461|-122.115",
    "KJFK JFK|40.639|-73.779",
    "PANC ANC|61.179|-149.993",
    "PABR BRW|71.285|-156.766",
    "PAFA FAI|64.815|-147.856",
  ],
});

const TWO_MIN = 2 * 60 * 1000;
const near = (actual: Date | undefined, expectedIso: string) =>
  expect(Math.abs((actual?.getTime() ?? Number.NaN) - Date.parse(expectedIso))).toBeLessThanOrEqual(TWO_MIN);

/*
 * Reference values: the NOAA Solar Calculator equations (NOAA Global Monitoring
 * Laboratory, gml.noaa.gov/grad/solcalc, "NOAA_Solar_Calculations_day" sheet),
 * evaluated at the same coordinates with sunset at -0.833° and the end of civil
 * twilight at -6°. suncalc agreed with them within 5 seconds for every case;
 * the tests allow ±2 minutes.
 *   KPAO 2026-11-05: sunset 01:05:57Z (5:06 PM PST), civil dusk 01:33:14Z (5:33 PM PST)
 *   KJFK 2026-06-21: sunset 00:29:36Z (8:30 PM EDT), civil dusk 01:02:58Z (9:03 PM EDT)
 *   PANC 2026-12-21: sunset 00:42:12Z (3:42 PM AKST), civil dusk 01:44:26Z (4:44 PM AKST)
 */
describe("nightHint", () => {
  it("matches NOAA sunset and end of civil twilight at three airports", () => {
    const paloAlto = nightHint("2026-11-05", "KPAO", index);
    near(paloAlto?.sunset, "2026-11-06T01:05:57Z");
    near(paloAlto?.nightBegins, "2026-11-06T01:33:14Z");
    near(paloAlto?.currencyLandingsFrom, "2026-11-06T02:05:57Z");

    const kennedy = nightHint("2026-06-21", "KJFK", index);
    near(kennedy?.sunset, "2026-06-22T00:29:36Z");
    near(kennedy?.nightBegins, "2026-06-22T01:02:58Z");

    const anchorage = nightHint("2026-12-21", "PANC", index);
    near(anchorage?.sunset, "2026-12-22T00:42:12Z");
    near(anchorage?.nightBegins, "2026-12-22T01:44:26Z");
  });

  it("puts currency landings exactly one hour after sunset", () => {
    const hint = nightHint("2026-11-05", "KPAO", index)!;
    expect(hint.currencyLandingsFrom.getTime() - hint.sunset.getTime()).toBe(60 * 60 * 1000);
  });

  it("accepts lowercase and padded codes, and both KPAO and PAO", () => {
    const four = nightHint("2026-11-05", "KPAO", index);
    const three = nightHint("2026-11-05", " pao ", index);
    expect(three?.code).toBe("PAO");
    expect(three?.sunset.getTime()).toBe(four?.sunset.getTime());
    expect(nightHint("2026-11-05", "kpao", index)?.code).toBe("KPAO");
  });

  it("returns null for an unknown airport, an empty code or a bad date", () => {
    expect(nightHint("2026-11-05", "ZZZZ", index)).toBeNull();
    expect(nightHint("2026-11-05", "", index)).toBeNull();
    expect(nightHint("", "KPAO", index)).toBeNull();
    expect(nightHint("2026-02-30", "KPAO", index)).toBeNull();
    expect(nightHint("11/05/2026", "KPAO", index)).toBeNull();
  });

  it("returns null when the sun doesn't set or twilight doesn't end", () => {
    expect(nightHint("2026-12-21", "PABR", index)).toBeNull(); // polar night at Utqiagvik
    expect(nightHint("2026-06-21", "PABR", index)).toBeNull(); // midnight sun
    expect(nightHint("2026-06-21", "PAFA", index)).toBeNull(); // Fairbanks: twilight all night
    expect(nightHint("2026-12-21", "PAFA", index)).not.toBeNull();
  });

  it("writes one plain line in the given time zone", () => {
    const hint = nightHint("2026-11-05", "KPAO", index)!;
    expect(nightHintText(hint, "2026-11-05", "America/Los_Angeles")).toBe(
      "KPAO, Nov 5: sunset 5:06 PM. Night from 5:33 PM; night landings count from 6:06 PM (your Mac's time).",
    );
  });

  it("finds airports in the shipped table by every code she might type", async () => {
    const shipped = await loadAirportIndex();
    expect(shipped.get("KPAO")).toEqual({ lat: 37.461, lon: -122.115 });
    expect(shipped.get("PAO")).toBe(shipped.get("KPAO"));
    expect(shipped.get("SQL")?.lat).toBe(shipped.get("KSQL")?.lat);
    expect(shipped.get("TJSJ")?.lat).toBe(shipped.get("SJU")?.lat); // Puerto Rico
    expect(nightHint("2026-11-05", "pao", shipped)).not.toBeNull();
    expect(nightHint("2026-11-05", "EGLL", shipped)).toBeNull(); // US airports only
  });
});
