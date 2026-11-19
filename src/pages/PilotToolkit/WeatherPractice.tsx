import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { PersonalMinimums } from "@/domain/types";
import { explainMetar } from "@/logic/metarExplain";
import { explainTaf } from "@/logic/tafExplain";
import {
  compareToMinimums,
  minimumsSummary,
  type MinimumVerdict,
  type TodayConditions,
} from "@/logic/personalMinimums";
import { WEATHER_PRACTICE } from "@/logic/weatherPractice";
import {
  compareLiveToMinimums,
  practiceFromLiveReport,
} from "@/logic/liveWeatherPractice";
import { normalizeIcao } from "@/logic/weather";
import { airportWeather } from "@/services/weather";
import { isTauri } from "@/data";
import { Badge, Button, Field, TextInput } from "@/components/ui";

const ITEMS: [keyof TodayConditions, string, (n: number) => string][] = [
  ["ceilingFt", "Ceiling", (n) => `${n.toLocaleString("en-US")} ft`],
  ["visibilitySm", "Visibility", (n) => `${n} SM`],
  ["windKt", "Wind", (n) => `${n} kt`],
];

const verdictText = (v: MinimumVerdict | undefined) =>
  v === "outside" ? "outside your minimum" : v === "inside" ? "inside" : null;

/** Four letters, or three letters read as a US airport (K + code). */
function airportCode(input: string): string | null {
  const t = input.trim();
  return normalizeIcao(/^[A-Za-z]{3}$/.test(t) ? `K${t}` : t);
}

/** Optional real report for the same practice flow. Uses the Settings weather switch and the existing weather service. */
function RealReport({
  minimums,
  onLeave,
  onActive,
}: {
  minimums?: PersonalMinimums;
  onLeave: () => void;
  onActive: (on: boolean) => void;
}) {
  const view = useSyncExternalStore(
    airportWeather.subscribe,
    airportWeather.snapshot,
  );
  const [code, setCode] = useState("");
  const [asked, setAsked] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => airportWeather.open(), []);
  useEffect(() => {
    const timer = setInterval(airportWeather.tick, 1000);
    return () => clearInterval(timer);
  }, []);
  const station = airportCode(code);
  const item = view.metar;
  const report =
    asked && item.report && !item.report.unavailable ? item.report : null;
  const live = useMemo(
    () => (report ? practiceFromLiveReport(report, view.now) : null),
    [report, view.now],
  );
  const tokens = useMemo(
    () => (report ? explainMetar(report.raw).tokens : []),
    [report],
  );
  const hasReport = !!report;
  useEffect(() => onActive(hasReport), [hasReport, onActive]);
  const compared = live ? compareLiveToMinimums(minimums, live) : null;
  const paused = view.mono < Math.max(view.until, item.until);
  const fetch = () => {
    if (!station) return;
    setAsked(true);
    setShown(false);
    airportWeather.setStation(station);
    void airportWeather.request("metar");
  };
  const leave = () => {
    setAsked(false);
    setShown(false);
    airportWeather.clear();
    onLeave();
  };

  let note: string | null = null;
  if (!isTauri())
    note = "Real weather works in the Mac app. Made-up reports still work.";
  else if (!view.enabled)
    note =
      "Real weather needs the weather setting in Settings. Made-up reports still work.";
  if (note) return <p className="small muted">{note}</p>;

  const observed =
    live?.observedAt != null
      ? new Date(live.observedAt).toISOString().slice(11, 16)
      : null;
  const age =
    live?.ageMinutes != null
      ? `${live.ageMinutes} minute${live.ageMinutes === 1 ? "" : "s"} ago`
      : null;
  const failure =
    asked &&
    !report &&
    !view.busy &&
    item.status &&
    item.status !== "Getting report…"
      ? item.status.replace(/ Try again after$/, " Try again in a minute.")
      : null;

  return (
    <div className="stack stack--2" aria-label="Real airport report">
      <Field
        label="Try a real airport (optional)"
        hint="Leave it empty to keep using made-up reports. Uses the weather setting you turned on in Settings."
      >
        <TextInput
          value={code}
          maxLength={4}
          autoCapitalize="characters"
          spellCheck={false}
          autoComplete="off"
          placeholder="e.g. KSEA"
          onChange={(e) =>
            setCode(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())
          }
        />
      </Field>
      <div className="row">
        <Button
          variant="secondary"
          disabled={!station || !!view.busy || paused}
          onClick={fetch}
        >
          Get report
        </Button>
      </div>
      {asked && view.busy ? (
        <p className="small muted" role="status">
          Getting report…
        </p>
      ) : null}
      {failure ? (
        <p className="small" role="status">
          {failure} Made-up practice still works.
        </p>
      ) : null}
      {report && live && compared ? (
        <div className="stack stack--2">
          <h4>Real report, {report.station}</h4>
          {observed ? (
            <p className="small">
              Observed {observed}Z{age ? `, ${age}` : ""}
            </p>
          ) : null}
          {live.stale ? (
            <p
              className="small"
              role="status"
              style={{ color: "var(--status-due-today)" }}
            >
              {live.ageMinutes != null
                ? "This report is over 90 minutes old. Get a fresh one."
                : "Can't tell how old this report is. Get a fresh one."}
            </p>
          ) : null}
          <pre
            className="mono"
            style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          >
            {report.raw}
          </pre>
          {shown ? (
            <div className="stack stack--2" aria-label="Real report answers">
              <ul
                className="stack stack--2"
                aria-label="Decoded real report groups"
              >
                {tokens.map((token, i) => (
                  <li key={i}>
                    <strong>{token.raw}</strong>: {token.meaning}
                  </li>
                ))}
              </ul>
              {minimums ? (
                <div
                  className="stack stack--2"
                  aria-label="Compared with your personal minimums"
                >
                  <h5>Compared with your personal minimums</h5>
                  {ITEMS.map(([key, label, fmt]) => {
                    const verdict = verdictText(compared.comparison[key]);
                    const value = (live as unknown as Partial<Record<keyof TodayConditions, number>>)[key];
                    if (!verdict) return null;
                    const shownValue =
                      key === "ceilingFt" && value === undefined
                        ? "none reported"
                        : value !== undefined
                          ? fmt(value)
                          : null;
                    return shownValue ? (
                      <p key={key} className="small">
                        {label} {shownValue}: {verdict}
                      </p>
                    ) : null;
                  })}
                  {compared.cantTell.map((line) => (
                    <p key={line} className="small">
                      {line}
                    </p>
                  ))}
                  {compared.summary ? (
                    <p className="small">{compared.summary}</p>
                  ) : null}
                </div>
              ) : (
                <p className="small muted">
                  No personal minimums saved yet. You can save them in Safety
                  Check.
                </p>
              )}
              <p className="small muted">
                This is practice reading a report. Your instructor decides about
                real flights.
              </p>
            </div>
          ) : null}
          <div className="row">
            {shown ? null : (
              <Button variant="secondary" onClick={() => setShown(true)}>
                Show answer
              </Button>
            )}
            <Button variant="secondary" onClick={leave}>
              Next made-up report
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Read a made-up METAR/TAF, check the answer, then see it next to the saved minimums. */
export function WeatherPractice({ minimums }: { minimums?: PersonalMinimums }) {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const [liveOn, setLiveOn] = useState(false);
  const scenario = WEATHER_PRACTICE[index % WEATHER_PRACTICE.length]!;

  const tokens = useMemo(() => {
    if (scenario.kind === "taf") {
      const taf = explainTaf(scenario.raw);
      return [...taf.header, ...(taf.periods[0]?.tokens ?? [])];
    }
    return explainMetar(scenario.raw).tokens;
  }, [scenario]);

  const today: TodayConditions = {
    ceilingFt: scenario.ceilingFt,
    visibilitySm: scenario.visibilitySm,
    windKt: scenario.windKt,
  };
  const comparison = compareToMinimums(minimums, today);
  // A practice report with no ceiling layer is above any ceiling minimum, like a live one.
  if (scenario.ceilingFt === undefined && minimums?.ceilingFt !== undefined) comparison.ceilingFt = "inside";
  const summary = minimumsSummary(comparison);

  return (
    <div className="stack stack--2" aria-label="Weather practice">
      <div className="row row--wrap">
        <Badge>Practice only, not for flight</Badge>
      </div>
      <RealReport
        minimums={minimums}
        onActive={setLiveOn}
        onLeave={() => {
          setIndex((i) => (i + 1) % WEATHER_PRACTICE.length);
          setShown(false);
        }}
      />
      {liveOn ? null : (
        <>
          <p className="small muted">
            Made-up report {(index % WEATHER_PRACTICE.length) + 1} of{" "}
            {WEATHER_PRACTICE.length}. Read it first, then check.
          </p>
          <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>
            {scenario.raw}
          </pre>
          <ul className="stack stack--2">
            {scenario.questions.map((q) => (
              <li key={q.question}>
                {q.question}
                {shown ? (
                  <>
                    {" "}
                    <strong>{q.answer}</strong>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          {shown ? (
            <div className="stack stack--2" aria-label="Practice answers">
              <ul
                className="stack stack--2"
                aria-label="Decoded practice groups"
              >
                {tokens.map((token, i) => (
                  <li key={i}>
                    <strong>{token.raw}</strong>: {token.meaning}
                  </li>
                ))}
              </ul>
              {minimums ? (
                <div
                  className="stack stack--2"
                  aria-label="Compared with your minimums"
                >
                  {ITEMS.map(([key, label, fmt]) => {
                    const verdict = verdictText(comparison[key]);
                    const value = today[key];
                    const shownValue =
                      key === "ceilingFt" && value === undefined ? "none reported" : value !== undefined ? fmt(value) : null;
                    return verdict && shownValue !== null ? (
                      <p key={key} className="small">
                        {label} {shownValue}: {verdict}
                      </p>
                    ) : null;
                  })}
                  {summary ? <p className="small">{summary}</p> : null}
                </div>
              ) : (
                <p className="small muted">
                  No personal minimums saved yet. You can save them in Safety
                  Check.
                </p>
              )}
            </div>
          ) : null}
          <div className="row">
            {shown ? null : (
              <Button variant="secondary" onClick={() => setShown(true)}>
                Show answer
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => {
                setIndex((i) => (i + 1) % WEATHER_PRACTICE.length);
                setShown(false);
              }}
            >
              Next scenario
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
