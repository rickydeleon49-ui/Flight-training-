import { useState } from "react";
import { Card, CardBody, CardHeader, Field, TextInput } from "@/components/ui";
import { densityAltitude, windComponents, type DensityResult } from "@/logic/performanceAid";

export function windSteps(runway: number, dir: number, speed: number): string[] {
  const heading = runway <= 36 ? runway * 10 : runway;
  const angle = (((dir - heading) % 360) + 360) % 360;
  const a = angle > 180 ? 360 - angle : angle;
  const rad = (a * Math.PI) / 180;
  return [
    `Study aid, worked steps. Runway heading ${heading}°, wind from ${dir}° at ${speed} kt, so the angle is ${a}°.`,
    `Crosswind = ${speed} × sin(${a}°) = ${Math.round(Math.abs(speed * Math.sin(rad)))} kt.`,
    `Headwind = ${speed} × cos(${a}°) = ${Math.round(speed * Math.cos(rad))} kt (negative means tailwind).`,
  ];
}

export function densitySteps(elev: number, alt: number, oat: number, d: DensityResult): string[] {
  return [
    `Study aid, worked steps. Pressure altitude = ${elev} + (29.92 − ${alt}) × 1,000 = ${d.pressureAltitude.toLocaleString("en-US")} ft.`,
    `ISA temperature = 15 − 2 × (${d.pressureAltitude.toLocaleString("en-US")} ÷ 1,000) = ${d.isaTemp} °C.`,
    `Density altitude = ${d.pressureAltitude.toLocaleString("en-US")} + 120 × (${oat} − ${d.isaTemp}) = about ${d.densityAltitude.toLocaleString("en-US")} ft (rounded to 10).`,
  ];
}

export function PerformanceAidCard() {
  const [runway, setRunway] = useState("");
  const [windDir, setWindDir] = useState("");
  const [windSpeed, setWindSpeed] = useState("");
  const [elevation, setElevation] = useState("");
  const [altimeter, setAltimeter] = useState("29.92");
  const [oat, setOat] = useState("");
  const num = (v: string) => (v.trim() === "" ? NaN : Number(v));
  const runwayNum = num(runway);
  const runwayBad = runway.trim() !== "" && !(Number.isInteger(runwayNum) && runwayNum >= 1 && runwayNum <= 36);
  const wind = runwayBad ? null : windComponents(runwayNum, num(windDir), num(windSpeed));
  const density = densityAltitude(num(elevation), num(altimeter), num(oat));
  const windText = runwayBad
    ? "Runway numbers are whole numbers from 1 to 36. Try again."
    : wind
    ? `${wind.crosswind === 0 ? "Crosswind 0 kt" : `Crosswind ${wind.crosswind} kt from the ${wind.side}`}, ${
        wind.headwind < 0 ? `tailwind ${-wind.headwind} kt` : `headwind ${wind.headwind} kt`
      }.`
    : "Enter a runway (1-36), wind direction and wind speed.";
  const fmt = (n: number) => n.toLocaleString("en-US");
  const densityText = density
    ? `Pressure altitude ${fmt(density.pressureAltitude)} ft, density altitude about ${fmt(density.densityAltitude)} ft.`
    : "Enter field elevation, altimeter setting and temperature.";
  return (
    <Card variant="grouped">
      <CardHeader title="Crosswind & density altitude" />
      <CardBody>
        <div className="stack stack--3">
          <div className="form-grid">
            <Field label="Runway (1-36)">
              <TextInput type="number" inputMode="numeric" min="1" max="36" step="1" value={runway} onChange={(e) => setRunway(e.target.value)} />
            </Field>
            <Field label="Wind direction (degrees)">
              <TextInput type="number" inputMode="numeric" min="0" max="360" value={windDir} onChange={(e) => setWindDir(e.target.value)} />
            </Field>
            <Field label="Wind speed (kt)">
              <TextInput type="number" inputMode="numeric" min="0" value={windSpeed} onChange={(e) => setWindSpeed(e.target.value)} />
            </Field>
          </div>
          <p className="small" role="status">{windText}</p>
          {wind && !runwayBad ? (
            <ul className="small muted" aria-label="Worked steps for crosswind">
              {windSteps(runwayNum, num(windDir), num(windSpeed)).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          <div className="form-grid">
            <Field label="Field elevation (ft)">
              <TextInput type="number" inputMode="numeric" value={elevation} onChange={(e) => setElevation(e.target.value)} />
            </Field>
            <Field label="Altimeter (inHg)">
              <TextInput type="number" inputMode="decimal" step="0.01" value={altimeter} onChange={(e) => setAltimeter(e.target.value)} />
            </Field>
            <Field label="Outside air temperature (°C)">
              <TextInput type="number" value={oat} onChange={(e) => setOat(e.target.value)} />
            </Field>
          </div>
          <p className="small" role="status">{densityText}</p>
          {density ? (
            <ul className="small muted" aria-label="Worked steps for density altitude">
              {densitySteps(num(elevation), num(altimeter), num(oat), density).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          <p className="small muted">
            High density altitude means a longer takeoff run and a weaker climb.
          </p>
          <p className="tiny dim">
            Study aid only. Use your POH performance charts and check with your instructor.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
