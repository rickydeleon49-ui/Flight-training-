import { useMemo, useState } from "react";

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
import { Button } from "@/components/ui";

const ITEMS: [keyof TodayConditions, string, (n: number) => string][] = [
  ["ceilingFt", "Ceiling", (n) => `${n.toLocaleString("en-US")} ft`],
  ["visibilitySm", "Visibility", (n) => `${n} SM`],
  ["windKt", "Wind", (n) => `${n} kt`],
];

const verdictText = (v: MinimumVerdict | undefined) =>
  v === "outside" ? "outside your minimum" : v === "inside" ? "inside" : null;

/** Read a made-up METAR/TAF, check the answer, then see it next to the saved minimums. */
export function WeatherPractice({ minimums }: { minimums?: PersonalMinimums }) {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
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
  const summary = minimumsSummary(comparison);

  return (
    <div className="stack stack--2" aria-label="Weather practice">
      <p className="small muted">Made-up report {index % WEATHER_PRACTICE.length + 1} of {WEATHER_PRACTICE.length}. Read it first, then check.</p>
      <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{scenario.raw}</pre>
      <ul className="stack stack--2">
        {scenario.questions.map((q) => (
          <li key={q.question}>
            {q.question}
            {shown ? <> <strong>{q.answer}</strong></> : null}
          </li>
        ))}
      </ul>
      {shown ? (
        <div className="stack stack--2" aria-label="Practice answers">
          <ul className="stack stack--2" aria-label="Decoded practice groups">
            {tokens.map((token, i) => (
              <li key={i}>
                <strong>{token.raw}</strong>: {token.meaning}
              </li>
            ))}
          </ul>
          {minimums ? (
            <div className="stack stack--2" aria-label="Compared with your minimums">
              {ITEMS.map(([key, label, fmt]) => {
                const verdict = verdictText(comparison[key]);
                const value = today[key];
                return verdict && value !== undefined ? (
                  <p key={key} className="small">{label} {fmt(value)}: {verdict}</p>
                ) : null;
              })}
              {summary ? <p className="small">{summary}</p> : null}
            </div>
          ) : (
            <p className="small muted">No personal minimums saved yet. You can save them in Safety Check.</p>
          )}
        </div>
      ) : null}
      <div className="row">
        {shown ? null : <Button variant="secondary" onClick={() => setShown(true)}>Show answer</Button>}
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
    </div>
  );
}
