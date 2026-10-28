import { useEffect, useSyncExternalStore } from "react";
import { isTauri } from "@/data";
import { Button, Checkbox, Field, TextInput } from "@/components/ui";
import { airportWeather, type ProductView, type WeatherView } from "@/services/weather";
import { conditionsSummary, localTimeText, normalizeIcao, periodLabel, timeText, weatherAges, WEATHER_NOTE, WEATHER_SOURCE, WEATHER_SOURCE_URL, type WeatherProduct } from "@/logic/weather";

export function WeatherPreference() {
  const view = useSyncExternalStore(airportWeather.subscribe, airportWeather.snapshot);
  return <div className="stack stack--3">
    <Checkbox label="Show airport weather" checked={view.enabled} onChange={airportWeather.setEnabled} strikethrough={false} />
    <p className="small muted">Gets reports from NOAA/NWS for the airport you enter.</p>
    <p className="small muted">{WEATHER_NOTE}</p>
  </div>;
}
function Times({ label, value, local = false }: { label: string; value: number | null; local?: boolean }) {
  return <p className="small wrap-anywhere">{label}: {timeText(value)}{local ? <><br /><span className="muted">{localTimeText(value)}</span></> : null}</p>;
}
function Report({ product, item, view }: { product: WeatherProduct; item: ProductView; view: WeatherView }) {
  const report = item.report;
  // Nothing asked for yet: no empty heading.
  if (!report && !item.status) return null;
  return <div className="stack stack--3" aria-label={product === "metar" ? "Observation" : "Forecast"}>
    <h4>{product === "metar" ? "Observation (METAR)" : "Forecast (TAF)"}</h4>
    <p role="status">{item.status}{item.status.endsWith("after") ? ` ${timeText(view.now + Math.max(0, view.until - view.mono))}.` : ""}</p>
    {report && <>
      {item.previous && <p className="small strong">Previous report · not updated</p>}
      <p className="strong wrap-anywhere">{report.station} · {report.name || "Station name not returned"}</p>
      {!report.unavailable && <>
        <p className="small">Partial {product === "metar" ? "observation" : "forecast"} summary</p>
        {product === "metar" ? <p>{conditionsSummary(report.conditions)}</p> : report.periods.length ? report.periods.map((period, index) => <div className="stack stack--2" key={index}>
          <p className="strong">{periodLabel(period)}</p>
          <Times label="Period starts" value={typeof period.from === "number" ? period.from : null} />
          <Times label="Period ends" value={typeof period.to === "number" ? period.to : null} />
          {typeof period.timeBec === "number" && <Times label="Becoming by" value={period.timeBec * 1000} />}
          <p>{periodLabel(period).startsWith("Period details") ? "Some details are only in the original report." : conditionsSummary(period)}</p>
        </div>) : <p>Some details are only in the original report.</p>}
      </>}
      <Times label={product === "metar" ? "Observed" : "Issued"} value={report.reportTime} local />
      {product === "taf" && <><Times label="Validity starts" value={report.validFrom} /><Times label="Validity ends" value={report.validTo} /></>}
      <Times label="Last successful fetch" value={item.fetchedAt} />
      {weatherAges(report, product, item.fetchedAt, view.now, view.confident && item.timeConfident).map(label => <p className="small muted" key={label}>{label}</p>)}
      <p className="small strong">Full original report</p>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "inherit", maxWidth: "100%" }}>{report.raw}</pre>
    </>}
  </div>;
}
export function AirportWeather() {
  const view = useSyncExternalStore(airportWeather.subscribe, airportWeather.snapshot);
  useEffect(() => airportWeather.open(), []);
  useEffect(() => { const timer = setInterval(airportWeather.tick, 1000); return () => clearInterval(timer); }, []);
  if (!view.enabled) return null;
  const desktop = isTauri();
  return <section tabIndex={-1} id="airport-weather" aria-labelledby="airport-weather-title" className="stack stack--4" style={{ scrollMarginTop: "2rem", minWidth: 0 }}>
    <h3 id="airport-weather-title">Airport weather</h3>
    <p className="small muted">{WEATHER_NOTE}</p>
    <p className="small">{WEATHER_SOURCE}</p>
    <p className="tiny muted wrap-anywhere">Official source: {WEATHER_SOURCE_URL}</p>
    {!desktop && <p role="status">Weather works in the Mac app.</p>}
    <Field label="Airport ICAO code" hint="Enter the airport's four-letter ICAO code to look at its reports.">
      <TextInput value={view.station} autoCapitalize="characters" spellCheck={false} autoComplete="off" onChange={e => airportWeather.setStation(e.target.value)} />
    </Field>
    {view.station && !normalizeIcao(view.station) && <p className="small">Use four letters for the airport ICAO code.</p>}
    <div className="row row--wrap">
      {(["metar", "taf"] as const).map(product => <Button key={product} disabled={!desktop || !normalizeIcao(view.station) || !!view.busy || view.mono < Math.max(view.until, view[product].until)} onClick={() => void airportWeather.request(product)}>{product === "metar" ? "Get observation" : "Get forecast"}</Button>)}
    </div>
    {desktop && view.mono < Math.max(view.until, view.metar.until, view.taf.until) && <p className="small muted">Requests pause briefly between checks. Choose a report again when its button is available.</p>}
    <Report product="metar" item={view.metar} view={view} />
    <Report product="taf" item={view.taf} view={view} />
  </section>;
}
