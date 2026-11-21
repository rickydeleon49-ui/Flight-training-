import { useMemo, useState } from "react";
import { Button, Card, CardBody, CardHeader, Field, TextArea, TextInput } from "@/components/ui";
import { type PersonalMinimums } from "@/domain/types";
import { explainMetar } from "@/logic/metarExplain";
import { explainTaf, looksLikeTaf } from "@/logic/tafExplain";
import { explainWindsAloft, feetText, levelsAround, looksLikeWindsAloft, type WindsAloftStation } from "@/logic/windsAloft";
import { explainPirep, looksLikePirep } from "@/logic/pirepExplain";
import { explainNotam, looksLikeNotam } from "@/logic/notamExplain";
import { WeatherPractice } from "./WeatherPractice";

const METAR_EXAMPLE = "METAR KSFO 141756Z 28012G20KT 10SM FEW008 BKN015 16/11 A3002 RMK AO2 SLP168";
const TAF_EXAMPLE =
  "TAF KSFO 141120Z 1412/1518 28012KT P6SM FEW008 BKN015 FM141800 29015G25KT P6SM SCT035 TEMPO 1420/1424 3SM -RA BKN012 BECMG 1500/1502 VRB03KT 2SM BR OVC006";

const FB_EXAMPLE = [
  "FT  3000    6000    9000   12000   18000   24000  30000  34000  39000",
  // Made-up values that follow the rules: no wind within 1,500 ft of the station, no temperature within 2,500 ft.
  "SFO 9900 2725+11 2734+05 2740-01 2752-13 2763-25 277340 278148 279054",
  "DEN              2214+05 2320-01 2427-13 2538-25 265240 265848 266154",
].join("\n");
// Made-up, well-formed domestic NOTAM (fictional numbers) following the order's App. A pattern.
const NOTAM_EXAMPLE = "!CLE 11/045 CLE TWY L CLSD 2611201300-2611202100";
const PIREP_EXAMPLE =
  "UA /OV OKC063064/TM 1522/FL080/TP C172/SK BKN065-TOP090/WX FV03SM HZ/TA M05/WV 270030KT/TB LGT-MOD CHOP/IC LGT RIME/RM SYNTHETIC EXAMPLE";

function TokenList({ tokens }: { tokens: { raw: string; meaning: string }[] }) {
  return (
    <ul className="stack stack--2">
      {tokens.map((token, index) => (
        <li key={index}>
          <strong>{token.raw}</strong>: {token.meaning}
        </li>
      ))}
    </ul>
  );
}

function WindsAloftView({ stations, cruise }: { stations: WindsAloftStation[]; cruise: string }) {
  const altitude = Number(cruise);
  const pick = cruise.trim() !== "" && Number.isFinite(altitude) && altitude > 0 ? altitude : null;
  return (
    <div className="stack stack--3" aria-label="Decoded winds aloft">
      {stations.map((station, index) => {
        const around = pick === null ? null : levelsAround(station, pick);
        return (
          <details key={station.station} open={index === 0} aria-label={`Station ${station.station}`}>
            <summary><strong>{station.station}</strong></summary>
            <div className="stack stack--2">
              <TokenList
                tokens={station.entries.map((entry) => ({
                  raw: entry.raw || "(blank)",
                  meaning: `${feetText(entry.altitude)}: ${entry.meaning}`,
                }))}
              />
              {station.unplaced.length ? <TokenList tokens={station.unplaced} /> : null}
              {around ? (
                <div aria-label={`Your altitude at ${station.station}`}>
                  <p>
                    {around.exact
                      ? `At ${feetText(pick!)}: ${around.exact.meaning}.`
                      : around.lower && around.upper
                        ? `Your ${feetText(pick!)} sits between the ${feetText(around.lower.altitude)} level (${around.lower.meaning}) and the ${feetText(around.upper.altitude)} level (${around.upper.meaning}). Read both; no estimate is made here.`
                        : "That altitude is outside the levels in this table."}
                  </p>
                </div>
              ) : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}

export function MetarTool({ minimums }: { minimums?: PersonalMinimums }) {
  const [text, setText] = useState("");
  const [cruise, setCruise] = useState("");
  // Detection order: NOTAM (the "!" is unambiguous), then PIREP, winds aloft, TAF, then METAR.
  const kind = looksLikeNotam(text)
    ? "notam"
    : looksLikePirep(text)
    ? "pirep"
    : looksLikeWindsAloft(text)
      ? "fb"
      : looksLikeTaf(text)
        ? "taf"
        : "metar";
  const result = useMemo(() => (kind === "metar" ? explainMetar(text) : null), [kind, text]);
  const taf = useMemo(() => (kind === "taf" ? explainTaf(text) : null), [kind, text]);
  const pirep = useMemo(() => (kind === "pirep" ? explainPirep(text) : null), [kind, text]);
  const notam = useMemo(() => (kind === "notam" ? explainNotam(text) : null), [kind, text]);
  const fb = useMemo(() => (kind === "fb" ? explainWindsAloft(text) : null), [kind, text]);
  return (
    <Card variant="grouped">
      <CardHeader
        title="Weather and NOTAM Explainer"
      />
      <CardBody>
        <p className="small muted">Study aid. Check official weather briefings and your instructor.</p>
        <Field label="Paste or type a METAR, TAF, winds aloft (FB), PIREP or NOTAM">
          <TextArea
            rows={3}
            value={text}
            placeholder="METAR KJFK 141651Z 28015G25KT 10SM FEW040 08/M02 A2992"
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <div className="row">
          <Button variant="secondary" onClick={() => setText(METAR_EXAMPLE)}>Try an example METAR</Button>
          <Button variant="secondary" onClick={() => setText(TAF_EXAMPLE)}>Try an example TAF</Button>
          <Button variant="secondary" onClick={() => setText(FB_EXAMPLE)}>Try an example winds aloft</Button>
          <Button variant="secondary" onClick={() => setText(PIREP_EXAMPLE)}>Try an example PIREP</Button>
          <Button variant="secondary" onClick={() => setText(NOTAM_EXAMPLE)}>Try an example NOTAM</Button>
        </div>
        <p className="small muted">
          AIRMETs for the lower 48 states are now graphical only (G-AIRMET), so look at them on aviationweather.gov.
        </p>
        {fb ? (
          <>
            <Field label="Your cruise altitude (ft MSL)" hint="Optional. Shows the two forecast levels around it. Winds aloft altitudes are MSL.">
              <TextInput
                inputMode="numeric"
                value={cruise}
                placeholder="e.g. 8000"
                onChange={(event) => setCruise(event.target.value)}
              />
            </Field>
            <WindsAloftView stations={fb.stations} cruise={cruise} />
          </>
        ) : notam ? (
          <div className="stack stack--3" aria-label="Decoded NOTAM">
            <TokenList tokens={notam.tokens} />
            <p className="small muted">
              The US plans to move to the ICAO NOTAM format in the coming years; this explainer reads today&apos;s US domestic format.
            </p>
          </div>
        ) : pirep ? (
          <div className="stack stack--3" aria-label="Decoded pilot report">
            <TokenList tokens={pirep.tokens} />
          </div>
        ) : taf ? (
          <div className="stack stack--3" aria-label="Decoded forecast">
            <TokenList tokens={taf.header} />
            {taf.periods.map((period, index) => (
              <section key={index} className="stack stack--2" aria-label={period.label}>
                <h3>{period.label}</h3>
                <p>{period.meaning}:</p>
                <TokenList tokens={period.tokens} />
                <p>{period.categoryNote}</p>
              </section>
            ))}
          </div>
        ) : result && result.tokens.length ? (
          <div className="stack stack--3" aria-label="Decoded groups">
            <TokenList tokens={result.tokens} />
            <p>{result.categoryNote}</p>
          </div>
        ) : null}
        <div className="stack stack--2">
          <h3>Weather practice</h3>
          <WeatherPractice minimums={minimums} />
        </div>
      </CardBody>
    </Card>
  );
}
