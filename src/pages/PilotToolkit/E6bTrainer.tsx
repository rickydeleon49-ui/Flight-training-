import { useState } from "react";

import { Button, Card, CardBody, CardHeader, Field, TextInput } from "@/components/ui";
import {
  E6B_PRACTICE,
  describeE6bPractice,
  e6bAnswerBoxes,
  e6bExpected,
  gradeE6bAnswer,
  summarizeE6bGrades,
  type E6bAnswerId,
  type E6bEntry,
  type E6bGrade,
  formatMinutes,
  fuelForTime,
  timeForFuel,
  timeSpeedDistance,
  trueToMagnetic,
  windTriangle,
  type E6bPractice,
} from "@/logic/e6b";

type Mode = "wind" | "tsd" | "fuel";
const MODES: { id: Mode; label: string }[] = [
  { id: "wind", label: "Wind" },
  { id: "tsd", label: "Time-speed-distance" },
  { id: "fuel", label: "Fuel" },
];

const num = (v: string) => (v.trim() === "" ? NaN : Number(v));
const pad3 = (n: number) => String(n).padStart(3, "0");

export function E6bTrainer() {
  const [mode, setMode] = useState<Mode>("wind");
  const [course, setCourse] = useState("");
  const [tas, setTas] = useState("");
  const [windDir, setWindDir] = useState("");
  const [windSpeed, setWindSpeed] = useState("");
  const [variation, setVariation] = useState("");
  const [side, setSide] = useState<"E" | "W">("E");
  const [distance, setDistance] = useState("");
  const [speed, setSpeed] = useState("");
  const [time, setTime] = useState("");
  const [burn, setBurn] = useState("");
  const [minutes, setMinutes] = useState("");
  const [fuel, setFuel] = useState("");
  const [practice, setPractice] = useState<E6bPractice | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [entries, setEntries] = useState<Partial<Record<E6bAnswerId, E6bEntry>>>({});
  const [grades, setGrades] = useState<Partial<Record<E6bAnswerId, E6bGrade>> | null>(null);

  const fill = (p: E6bPractice) => {
    setMode(p.mode);
    if (p.mode === "wind") {
      setCourse(p.values.course);
      setTas(p.values.tas);
      setWindDir(p.values.windDir);
      setWindSpeed(p.values.windSpeed);
      setVariation(p.values.variation);
      setSide(p.values.side);
    } else if (p.mode === "tsd") {
      setDistance(p.values.distance);
      setSpeed(p.values.speed);
      setTime(p.values.time);
    } else {
      setBurn(p.values.burn);
      setMinutes(p.values.minutes);
      setFuel("");
    }
    setPractice(p);
    setShowAnswer(false);
    setEntries({});
    setGrades(null);
  };

  let result: string;
  if (mode === "wind") {
    const untouched = [course, tas, windDir, windSpeed].every((v) => v.trim() === "");
    const w = windTriangle(num(course), num(tas), num(windDir), num(windSpeed));
    if (untouched) result = "Enter your numbers, or fill in a practice problem below.";
    else if (!w.ok) result = w.error;
    else {
      const wca =
        w.wcaDegrees === 0
          ? "No wind correction needed"
          : `Wind correction angle ${Math.abs(w.wcaDegrees)} degrees ${w.wcaDegrees > 0 ? "right" : "left"}`;
      result = `${wca}. True heading ${pad3(w.trueHeading)}, groundspeed ${w.groundSpeed} kt.`;
      if (variation.trim() !== "") {
        const m = trueToMagnetic(w.trueHeading, num(variation), side);
        result += m.ok
          ? ` With ${variation} degrees ${side === "E" ? "east" : "west"} variation, magnetic heading ${pad3(m.magneticHeading)}.`
          : ` ${m.error}`;
      }
    }
  } else if (mode === "tsd") {
    const untouched = [distance, speed, time].every((v) => v.trim() === "");
    const r = timeSpeedDistance(num(distance), num(speed), num(time));
    if (untouched) result = "Enter any two, or fill in a practice problem below.";
    else if (!r.ok) result = r.error;
    else if (r.solved === "time") result = `Time: ${formatMinutes(r.timeMinutes)} (${r.timeMinutes} minutes).`;
    else if (r.solved === "speed") result = `Speed: ${r.speedKt} kt.`;
    else result = `Distance: ${r.distanceNm} nm.`;
  } else {
    const untouched = [burn, minutes, fuel].every((v) => v.trim() === "");
    if (untouched) result = "Enter a burn rate and a time or a fuel amount.";
    else if (fuel.trim() !== "" && minutes.trim() === "") {
      const r = timeForFuel(num(burn), num(fuel));
      result = r.ok ? `That fuel lasts ${formatMinutes(r.timeMinutes)} (${r.timeMinutes} minutes).` : r.error;
    } else {
      const r = fuelForTime(num(burn), num(minutes));
      result = r.ok ? `You burn about ${r.fuelGallons} gallons in ${formatMinutes(r.timeMinutes)}.` : r.error;
    }
  }

  const boxes = practice ? e6bAnswerBoxes(practice) : [];
  const setEntry = (id: E6bAnswerId, patch: Partial<E6bEntry>) => {
    setEntries((prev) => ({ ...prev, [id]: { value: "", ...prev[id], ...patch } }));
    setGrades((prev) => (prev ? { ...prev, [id]: undefined } : prev));
  };
  const check = () => {
    if (!practice) return;
    const expected = e6bExpected(practice);
    const next: Partial<Record<E6bAnswerId, E6bGrade>> = {};
    for (const b of boxes) next[b.id] = gradeE6bAnswer(b.id, entries[b.id] ?? { value: "" }, practice, expected);
    setGrades(next);
  };
  const graded = grades ? boxes.map((b) => grades[b.id]).filter((g): g is E6bGrade => !!g) : [];
  // The worked result would give the answer away, so hold it back until the user asks.
  const hideResult = practice !== null && !showAnswer;

  const numInput = (value: string, set: (v: string) => void) => (
    <TextInput type="number" inputMode="decimal" min="0" value={value} onChange={(e) => set(e.target.value)} />
  );

  return (
    <Card variant="grouped">
      <CardHeader title="E6B practice" eyebrow="Study aid only" />
      <CardBody>
        <div className="stack stack--3">
          <div role="group" aria-label="E6B practice type" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {MODES.map((m) => (
              <Button
                key={m.id}
                variant={mode === m.id ? "primary" : "secondary"}
                aria-pressed={mode === m.id}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </Button>
            ))}
          </div>
          {practice ? <p><strong>{practice.title}.</strong> {describeE6bPractice(practice)}</p> : null}
          {mode === "wind" ? (
            <div className="form-grid">
              <Field label="True course (degrees)">{numInput(course, setCourse)}</Field>
              <Field label="True airspeed (kt)">{numInput(tas, setTas)}</Field>
              <Field label="Wind from (degrees)">{numInput(windDir, setWindDir)}</Field>
              <Field label="Wind speed (knots)">{numInput(windSpeed, setWindSpeed)}</Field>
              <Field label="Variation (degrees, optional)">{numInput(variation, setVariation)}</Field>
              <Field label="Variation is">
                <select className="select" value={side} onChange={(e) => setSide(e.target.value as "E" | "W")}>
                  <option value="E">East (east is least)</option>
                  <option value="W">West (west is best)</option>
                </select>
              </Field>
            </div>
          ) : null}
          {mode === "tsd" ? (
            <div className="form-grid">
              <Field label="Distance (nm)">{numInput(distance, setDistance)}</Field>
              <Field label="Speed (kt)">{numInput(speed, setSpeed)}</Field>
              <Field label="Time (minutes)">{numInput(time, setTime)}</Field>
            </div>
          ) : null}
          {mode === "fuel" ? (
            <div className="form-grid">
              <Field label="Fuel burn (gallons per hour)">{numInput(burn, setBurn)}</Field>
              <Field label="Time (minutes)">{numInput(minutes, setMinutes)}</Field>
              <Field label="Fuel on board (gallons, to find the time)">{numInput(fuel, setFuel)}</Field>
            </div>
          ) : null}
          <div aria-live="polite" role="status" style={{ overflowX: "auto" }}>
            <p style={{ overflowWrap: "anywhere" }}>
              {hideResult ? "Work the problem below on your E6B, then type what you get." : result}
            </p>
          </div>
          <h3>Try this</h3>
          <p>Practice numbers, not a real flight.</p>
          <div className="stack stack--3">
            {E6B_PRACTICE.map((p) => (
              <div key={p.id}>
                <strong>{p.title}</strong>
                <div>
                  <Button variant="secondary" onClick={() => fill(p)}>
                    Fill in {p.title.split(":")[0]}
                  </Button>
                </div>
                {practice?.id === p.id ? (
                  <div className="e6b-check stack stack--3">
                    <div className="e6b-check__grid">
                      {boxes.map((b) => {
                        const g = grades?.[b.id];
                        const status = g && g.status !== "empty" ? g.status : undefined;
                        const entry = entries[b.id];
                        const inputId = `e6b-answer-${b.id}`;
                        return (
                          <div key={b.id} className="e6b-check__item">
                            <label htmlFor={inputId} className="e6b-check__label">{b.label}</label>
                            <div className="e6b-check__row">
                              <TextInput
                                id={inputId}
                                type="number"
                                inputMode="decimal"
                                value={entry?.value ?? ""}
                                className={status ? `e6b-check__input e6b-check__input--${status}` : "e6b-check__input"}
                                onChange={(e) => setEntry(b.id, { value: e.target.value })}
                              />
                              {b.hasSide ? (
                                <div role="group" aria-label="Left or right" className="e6b-check__side">
                                  {(["L", "R"] as const).map((s) => (
                                    <button
                                      key={s}
                                      type="button"
                                      aria-pressed={entry?.side === s}
                                      aria-label={s === "L" ? "Left" : "Right"}
                                      className="e6b-check__side-btn"
                                      onClick={() => setEntry(b.id, { side: s })}
                                    >
                                      {s}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            {status ? (
                              <p className={`e6b-check__result e6b-check__result--${status}`}>
                                {status === "right" ? "\u2713 " : ""}
                                {g?.message}
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    <div className="e6b-check__actions">
                      <Button variant="primary" onClick={check}>Check my answers</Button>
                      <Button variant="secondary" onClick={() => setShowAnswer((s) => !s)}>
                        {showAnswer ? "Hide answer" : "Show answer"}
                      </Button>
                      {graded.length > 0 ? (
                        <span role="status" className="tiny dim">{summarizeE6bGrades(graded)}</span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {practice?.id === p.id && showAnswer ? <p>{p.answer}</p> : null}
              </div>
            ))}
          </div>
          <p className="tiny dim">Study aid. Check your answers with your E6B or instructor.</p>
        </div>
      </CardBody>
    </Card>
  );
}
