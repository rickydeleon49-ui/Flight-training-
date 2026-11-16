import { useMemo, useState } from "react";

import { Button, Field, TextInput } from "@/components/ui";
import {
  NAV_LOG_FIELDS,
  generateLeg,
  generateTrip,
  gradeNavLogBox,
  navLogTotals,
  solveLeg,
  type NavLogField,
  type NavLogGrade,
  type NavLogLeg,
} from "@/logic/navLog";

const LABELS: Record<NavLogField, string> = {
  wca: "WCA (+ right, − left)",
  th: "TH (true heading)",
  mh: "MH (magnetic heading)",
  ch: "CH (compass heading)",
  gs: "GS (kt)",
  ete: "ETE (minutes)",
  fuel: "Fuel (gallons)",
};
const SHORT: Record<NavLogField, string> = { wca: "WCA", th: "TH", mh: "MH", ch: "CH", gs: "GS", ete: "ETE", fuel: "Fuel" };

const pad3 = (n: number) => String(n).padStart(3, "0");
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const newSeed = () => Math.floor(Math.random() * 1_000_000) + 1;

function describeLeg(l: NavLogLeg): string {
  return `TC ${pad3(l.tc)}°, ${l.distanceNm} NM, TAS ${l.tas} kt, wind ${pad3(l.windDir)}° at ${l.windSpeed} kt, variation ${l.variation}° ${l.side === "E" ? "east" : "west"}, deviation ${signed(l.deviation)}°, burn ${l.gph} GPH.`;
}

type Totals = "totalEte" | "totalFuel";

/** "Nav log" mode: a guided single leg, or a small whole-trip table. State resets on leaving the mode. */
export function NavLogPractice() {
  const [trip, setTrip] = useState(false);
  const [seed, setSeed] = useState(newSeed);
  const [legCount, setLegCount] = useState(3);
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [grades, setGrades] = useState<Record<string, NavLogGrade> | null>(null);
  const [edited, setEdited] = useState<Record<string, boolean>>({});

  const legs = useMemo(() => (trip ? generateTrip(seed, legCount) : [generateLeg(seed)]), [trip, seed, legCount]);
  const solutions = useMemo(() => legs.map(solveLeg), [legs]);
  const totals = useMemo(() => navLogTotals(legs), [legs]);

  const reset = () => {
    setEntries({});
    setGrades(null);
    setEdited({});
  };
  const setEntry = (key: string, value: string) => {
    setEntries((p) => ({ ...p, [key]: value }));
    setEdited((p) => ({ ...p, [key]: true }));
  };
  const check = () => {
    const next: Record<string, NavLogGrade> = {};
    legs.forEach((leg, i) => {
      const s = solutions[i];
      if (!s) return;
      for (const f of NAV_LOG_FIELDS) next[`${i}-${f}`] = gradeNavLogBox(f, entries[`${i}-${f}`] ?? "", s[f], leg);
    });
    if (trip) {
      next.totalEte = gradeNavLogBox("ete", entries.totalEte ?? "", totals.ete, legs[0]!, legs.length);
      next.totalFuel = gradeNavLogBox("fuel", entries.totalFuel ?? "", totals.fuel, legs[0]!, legs.length);
    }
    setGrades(next);
    setEdited({});
  };

  const feedback = (key: string) => {
    const g = grades?.[key];
    if (!g || g.status === "empty") return null;
    const stale = !!edited[key];
    return (
      <p
        className={`e6b-check__result e6b-check__result--${g.status}`}
        style={stale ? { visibility: "hidden" } : undefined}
        aria-hidden={stale || undefined}
      >
        {g.status === "right" ? "✓ " : ""}
        {g.message}
      </p>
    );
  };
  const inputClass = (key: string) => {
    const g = grades?.[key];
    return g && g.status !== "empty" && !edited[key] ? `e6b-check__input e6b-check__input--${g.status}` : "e6b-check__input";
  };
  const box = (key: string, label: string, aria?: string) => (
    <TextInput
      type="number"
      inputMode="decimal"
      aria-label={aria}
      id={aria ? undefined : `navlog-${key}`}
      value={entries[key] ?? ""}
      className={inputClass(key)}
      aria-describedby={undefined}
      title={label}
      onChange={(e) => setEntry(key, e.target.value)}
    />
  );

  const graded = grades ? Object.values(grades).filter((g) => g.status !== "empty") : [];
  const summary =
    grades && graded.length > 0
      ? `${graded.filter((g) => g.status === "right").length} right, ${graded.filter((g) => g.status === "close").length} close, ${graded.filter((g) => g.status === "wrong").length} to fix`
      : null;

  return (
    <div className="stack stack--3">
      <div role="group" aria-label="Nav log view" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Button variant={trip ? "secondary" : "primary"} aria-pressed={!trip} onClick={() => { setTrip(false); reset(); }}>
          One leg
        </Button>
        <Button variant={trip ? "primary" : "secondary"} aria-pressed={trip} onClick={() => { setTrip(true); reset(); }}>
          Whole trip
        </Button>
        {trip ? (
          <select
            className="select"
            aria-label="Number of legs"
            value={legCount}
            onChange={(e) => { setLegCount(Number(e.target.value)); reset(); }}
          >
            {[2, 3, 4].map((n) => (
              <option key={n} value={n}>{n} legs</option>
            ))}
          </select>
        ) : null}
        <Button variant="secondary" onClick={() => { setSeed(newSeed()); reset(); }}>
          {trip ? "New trip" : "New leg"}
        </Button>
      </div>
      <p className="tiny dim">Practice numbers, not for flight. Use your own charts, POH and weather with your instructor.</p>
      <p><strong>Memory aid:</strong> East is least, West is best (variation).</p>

      {!trip ? (
        <>
          <p><strong>Given:</strong> {describeLeg(legs[0]!)} Fill the boxes in order.</p>
          <div className="e6b-check__grid">
            {NAV_LOG_FIELDS.map((f) => (
              <div key={f} className="e6b-check__item">
                <Field label={LABELS[f]}>{box(`0-${f}`, LABELS[f])}</Field>
                {feedback(`0-${f}`)}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="navlog-table" style={{ borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                {["Leg", "TC", "NM", "TAS", "Wind", "Var", "Dev", "GPH", ...NAV_LOG_FIELDS.map((f) => SHORT[f])].map((h) => (
                  <th key={h} scope="col" style={{ textAlign: "left", padding: "4px 6px" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {legs.map((l, i) => (
                <tr key={i}>
                  <th scope="row" style={{ textAlign: "left", padding: "4px 6px" }}>{i + 1}</th>
                  <td style={{ padding: "4px 6px" }}>{pad3(l.tc)}°</td>
                  <td style={{ padding: "4px 6px" }}>{l.distanceNm}</td>
                  <td style={{ padding: "4px 6px" }}>{l.tas}</td>
                  <td style={{ padding: "4px 6px" }}>{pad3(l.windDir)}/{l.windSpeed}</td>
                  <td style={{ padding: "4px 6px" }}>{l.variation}° {l.side}</td>
                  <td style={{ padding: "4px 6px" }}>{signed(l.deviation)}</td>
                  <td style={{ padding: "4px 6px" }}>{l.gph}</td>
                  {NAV_LOG_FIELDS.map((f) => (
                    <td key={f} style={{ padding: "4px 6px", minWidth: 72 }}>
                      {box(`${i}-${f}`, LABELS[f], `Leg ${i + 1} ${SHORT[f]}`)}
                      {feedback(`${i}-${f}`)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" style={{ textAlign: "left", padding: "4px 6px" }}>Total</th>
                <td />
                <td style={{ padding: "4px 6px" }}>{totals.distanceNm}</td>
                <td colSpan={9} />
                <td style={{ padding: "4px 6px", minWidth: 72 }}>
                  {box("totalEte", "Total ETE", "Total ETE (minutes)")}
                  {feedback("totalEte" satisfies Totals)}
                </td>
                <td style={{ padding: "4px 6px", minWidth: 72 }}>
                  {box("totalFuel", "Total fuel", "Total fuel (gallons)")}
                  {feedback("totalFuel" satisfies Totals)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="e6b-check__actions">
        <Button variant="primary" onClick={check}>Check my nav log</Button>
        {summary && Object.keys(edited).length === 0 ? <span role="status" className="tiny dim">{summary}</span> : null}
      </div>
    </div>
  );
}
