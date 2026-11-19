/** Hand-written US-style reports in FAA format (made-up stations/times). Never fetched from the network. */
import type { Conditions, WeatherReport } from "../weather";

export interface LiveFixture { id: string; raw: string }

export const LIVE_METARS: LiveFixture[] = [
  { id: "rmk-routine", raw: "METAR KDEM 171753Z 18008KT 10SM FEW050 SCT090 22/10 A3002 RMK AO2 SLP165 T02220100" },
  { id: "auto-bkn", raw: "METAR KABC 171853Z AUTO 16010KT 10SM BKN025 18/16 A2995 RMK AO2" },
  { id: "vrb-light", raw: "METAR KDEF 171953Z VRB03KT 10SM CLR 20/08 A3010 RMK AO2" },
  { id: "variable-dir", raw: "METAR KGHI 172053Z 24012KT 240V300 10SM SCT060 25/12 A2998 RMK AO2" },
  { id: "gusts", raw: "METAR KJKL 172153Z 27015G26KT 10SM FEW040 BKN070 19/05 A2985 RMK AO2 PK WND 27030/2141" },
  { id: "vis-quarter", raw: "METAR KMNO 172253Z 00000KT M1/4SM FG VV002 08/08 A3001 RMK AO2" },
  { id: "vis-one-half", raw: "METAR KPQR 172353Z 04005KT 1 1/2SM BR OVC008 10/09 A2992 RMK AO2" },
  { id: "p6sm", raw: "METAR KSTU 180053Z 31007KT P6SM SKC 15/02 A3020 RMK AO2" },
  { id: "vv-obscured", raw: "METAR KVWX 180153Z 03004KT 1/2SM FG VV001 07/07 A3005 RMK AO2" },
  { id: "skc-manual", raw: "METAR KYZA 180253Z 36006KT 10SM SKC 12/01 A3015" },
  { id: "overcast-only", raw: "METAR KBCD 180353Z 12009KT 9SM OVC035 14/11 A2990 RMK AO2" },
  { id: "ovc-cb", raw: "METAR KEFG 180453Z 20014G22KT 4SM +TSRA BKN015CB OVC030 22/20 A2975 RMK AO2 TSB43 SLP085" },
  { id: "multi-layer", raw: "METAR KHIJ 180553Z 22008KT 10SM FEW015 SCT025 BKN040 OVC080 16/12 A2999 RMK AO2" },
  { id: "rvr", raw: "METAR KKLM 180653Z 09005KT 1/2SM R09/2400FT FG OVC003 05/05 A3003 RMK AO2" },
  { id: "light-rain-mist", raw: "METAR KNOP 180753Z 14008KT 3SM -RA BR BKN012 OVC020 11/10 A2988 RMK AO2 P0004" },
  { id: "fzfg", raw: "METAR KQRS 180853Z 00000KT 1/4SM FZFG VV001 M03/M03 A3025 RMK AO2" },
  { id: "missing-temp", raw: "METAR KTUV 180953Z 18006KT 10SM FEW100 M/M A3000 RMK AO2" },
  { id: "speci", raw: "SPECI KWXY 181012Z 21018G30KT 2SM TSRA BKN020CB 19/18 A2968 RMK AO2" },
  { id: "cor", raw: "METAR KZAB 181053Z COR 25010KT 10SM SCT045 BKN090 21/09 A3004 RMK AO2" },
  { id: "auto-clr", raw: "METAR KCDE 181153Z AUTO 33008KT 10SM CLR 09/M02 A3022 RMK AO2" },
  { id: "calm-few", raw: "METAR KFGH 181253Z 00000KT 10SM FEW250 13/04 A3018 RMK AO2" },
  { id: "strong-gust", raw: "METAR KIJK 181353Z 30022G35KT 10SM SCT050 11/M03 A2962 RMK AO2" },
  { id: "haze-smoke", raw: "METAR KLMN 181453Z 14006KT 4SM HZ FU SCT030 24/12 A2996 RMK AO2" },
  { id: "snow-shsn", raw: "METAR KOPQ 181553Z 33014G24KT 2 1/2SM -SHSN BKN018 M02/M06 A2990 RMK AO2" },
  { id: "dz-bkn", raw: "METAR KRST 181653Z 10004KT 2SM -DZ BR OVC006 09/08 A2999 RMK AO2" },
  { id: "tcu-vc", raw: "METAR KUVW 181753Z 19009KT 9SM VCTS FEW030TCU SCT050 28/21 A2991 RMK AO2" },
  { id: "tenth-vis", raw: "METAR KXYZ 181853Z 22007KT 3/4SM BR OVC004 10/10 A3000 RMK AO2" },
  // Missing or unreadable fields: stay unknown.
  { id: "no-vis-group", raw: "METAR KAAA 181953Z 18008KT FEW050 20/10 A3000 RMK AO2" },
  { id: "no-wind-group", raw: "METAR KBBB 182053Z 10SM SCT050 20/10 A3000 RMK AO2" },
  { id: "no-sky-group", raw: "METAR KCCC 182153Z AUTO 18008KT 10SM 20/10 A3000 RMK AO2" },
  { id: "sensor-down", raw: "METAR KDDD 182253Z AUTO 18008KT 10SM FEW050 20/10 A3000 RMK AO2 VISNO" },
];

export const LIVE_TAFS: LiveFixture[] = [
  { id: "taf-tempo", raw: "TAF KDEM 171720Z 1718/1818 18008KT P6SM SCT050 TEMPO 1720/1724 3SM -RA BKN020" },
  { id: "taf-fm-becmg", raw: "TAF KABC 171730Z 1718/1824 16010KT P6SM FEW040 BECMG 1800/1802 22012G20KT FM180600 27008KT P6SM SCT080" },
  { id: "taf-prob", raw: "TAF KDEF 171720Z 1718/1818 VRB04KT P6SM SKC PROB30 1806/1810 1SM BR OVC005" },
  { id: "taf-amd-multi", raw: "TAF AMD KGHI 171900Z 1719/1824 24012G22KT 6SM BR OVC008 TEMPO 1720/1722 1/2SM FG VV002 FM180000 30010KT P6SM BKN040" },
  { id: "taf-nil", raw: "TAF KJKL 171720Z NIL" },
];

const num = (s: string) => {
  const m = /^(?:(\d+) )?(\d+)\/(\d+)$/.exec(s);
  return m ? Number(m[1] ?? 0) + Number(m[2]) / Number(m[3]) : Number(s);
};

/**
 * Builds the conditions the way the weather service reports them (wdir/wspd/wgst/visib/clouds/vertVis).
 * A group that is absent from the raw text stays absent; nothing is filled in.
 */
export function reportFromRaw(raw: string): WeatherReport {
  const body = raw.split(" RMK ")[0]!.replace(/\s+/g, " ");
  const c: Conditions = {};
  let m: RegExpExecArray | null;
  if ((m = /\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/.exec(body))) {
    c.wdir = m[1] === "VRB" ? "VRB" : Number(m[1]);
    c.wspd = Number(m[2]);
    if (m[3]) c.wgst = Number(m[3]);
  }
  if ((m = /(?:^| )(?:(\d) )?(M|P)?(\d+(?:\/\d+)?)SM\b/.exec(body))) {
    const v = m[1] ? num(`${m[1]} ${m[3]}`) : num(m[3]!);
    c.visib = m[2] === "P" ? `${v}+` : m[2] === "M" ? v - 0.0001 : v;
  }
  const clouds: Conditions[] = [];
  let sky = false;
  for (const w of body.split(" ")) {
    let k: RegExpExecArray | null;
    if (w === "CLR" || w === "SKC") { clouds.push({ cover: w, base: null }); sky = true; }
    else if ((k = /^(FEW|SCT|BKN|OVC)(\d{3})(?:CB|TCU)?$/.exec(w))) { clouds.push({ cover: k[1], base: Number(k[2]) * 100 }); sky = true; }
    else if ((k = /^VV(\d{3})$/.exec(w))) { c.vertVis = Number(k[1]) * 100; sky = true; }
  }
  if (sky) c.clouds = clouds;
  const day = /\b(\d{2})(\d{2})(\d{2})Z\b/.exec(body);
  const reportTime = day ? Date.UTC(2026, 10, Number(day[1]), Number(day[2]), Number(day[3])) : null;
  return {
    station: /\b[A-Z]{4}\b/.exec(body.replace(/^(METAR|SPECI)/, ""))?.[0] ?? "", name: null, raw,
    reportTime, validFrom: null, validTo: null, unavailable: false, conditions: c, periods: [],
  };
}
