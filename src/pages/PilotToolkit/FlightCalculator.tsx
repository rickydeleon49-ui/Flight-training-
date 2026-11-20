import { useState } from "react";

import { Button, Field, TextInput } from "@/components/ui";
import { formatMinutes, fuelForTime, timeForFuel, timeSpeedDistance } from "@/logic/e6b";
import { solveLeg, type NavLogLeg, type NavLogSolution } from "@/logic/navLog";
import { NAV_LEG_CAP } from "@/logic/savedNavLogs";
import { legFromInputs, parseLeg, type DraftLeg } from "./NavLogEditor";
import "./FlightComputer.css";

const DASH = "–";
const num = (v: string) => (v.trim() === "" ? NaN : Number(v));
const pad3 = (n: number) => String(n).padStart(3, "0");

export type WindInputs = {
  tc: string; tas: string; windDir: string; windSpeed: string;
  variation: string; side: "E" | "W"; deviation: string;
};

export type WindOutputs = { wca: string; th: string; mh: string; ch: string; gs: string };

/** Wind, magnetic and compass answers from solveLeg. Anything missing or bad shows a dash. */
export function windOutputs(i: WindInputs): WindOutputs {
  const out: WindOutputs = { wca: DASH, th: DASH, mh: DASH, ch: DASH, gs: DASH };
  // Distance and burn are not used here; 1 keeps solveLeg happy.
  const leg = (variation: number, deviation: number): NavLogSolution | null => {
    const l: NavLogLeg = {
      tc: num(i.tc), distanceNm: 1, tas: num(i.tas), windDir: num(i.windDir), windSpeed: num(i.windSpeed),
      variation, side: i.side, deviation, gph: 1,
    };
    return Object.values(l).every((v) => typeof v !== "number" || Number.isFinite(v)) ? solveLeg(l) : null;
  };
  const wind = leg(0, 0);
  if (wind) {
    out.wca = wind.wca === 0 ? "0°" : `${Math.abs(wind.wca)}° ${wind.wca > 0 ? "right" : "left"}`;
    out.th = pad3(wind.th);
    out.gs = `${wind.gs} kt`;
  }
  if (i.variation.trim() !== "") {
    const dev = i.deviation.trim() === "" ? 0 : num(i.deviation);
    const full = leg(num(i.variation), dev);
    if (full) {
      out.mh = pad3(full.mh);
      if (Number.isFinite(dev)) out.ch = pad3(full.ch);
    }
  }
  return out;
}

export function FlightCalculator({ onAddLeg, legCount = 0 }: { onAddLeg?: (leg: DraftLeg) => void; legCount?: number } = {}) {
  const [f, setF] = useState({
    tc: "", tas: "", windDir: "", windSpeed: "", variation: "", deviation: "",
    distance: "", speed: "", time: "", burn: "", minutes: "", fuel: "",
  });
  const [side, setSide] = useState<"E" | "W">("E");
  const [copied, setCopied] = useState("");
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const input = (k: keyof typeof f, label: string, signed = false) => (
    <Field label={label}>
      <TextInput type="number" inputMode="decimal" min={signed ? undefined : "0"} value={f[k]} onChange={(e) => set(k)(e.target.value)} />
    </Field>
  );

  const w = windOutputs({ ...f, side });
  const tsd = timeSpeedDistance(num(f.distance), num(f.speed), num(f.time));
  const tsdText = !tsd.ok
    ? DASH
    : tsd.solved === "time" ? formatMinutes(tsd.timeMinutes) : tsd.solved === "speed" ? `${tsd.speedKt} kt` : `${tsd.distanceNm} nm`;
  const tsdLabel = tsd.ok ? { time: "Time", speed: "Speed", distance: "Distance" }[tsd.solved] : "Answer";
  const fuelRes = f.fuel.trim() !== "" && f.minutes.trim() === ""
    ? timeForFuel(num(f.burn), num(f.fuel))
    : fuelForTime(num(f.burn), num(f.minutes));
  const fuelText = !fuelRes.ok
    ? DASH
    : f.fuel.trim() !== "" && f.minutes.trim() === "" ? formatMinutes(fuelRes.timeMinutes) : `${fuelRes.fuelGallons} gal`;
  const fuelLabel = f.fuel.trim() !== "" && f.minutes.trim() === "" ? "Time" : "Fuel";

  const text = [
    `Wind correction ${w.wca}, true heading ${w.th}, magnetic heading ${w.mh}, compass heading ${w.ch}, groundspeed ${w.gs}`,
    `${tsdLabel} ${tsdText}`,
    `${fuelLabel} ${fuelText}`,
  ].join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("Copied.");
    } catch {
      setCopied("Could not copy. Select the numbers instead.");
    }
  };

  const legDraft = legFromInputs({
    tc: f.tc, distanceNm: f.distance, tas: f.tas, windDir: f.windDir, windSpeed: f.windSpeed,
    variation: f.variation, deviation: f.deviation, gph: f.burn, side,
  });
  const legReady = parseLeg(legDraft) !== null;
  const legsFull = legCount >= NAV_LEG_CAP;

  const row = (label: string, value: string) => (
    <div className="flight-computer__row" key={label}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );

  return (
    <div className="flight-computer stack stack--3">
      <h3>Wind and headings</h3>
      <div className="form-grid">
        {input("tc", "True course (degrees)")}
        {input("tas", "True airspeed (kt)")}
        {input("windDir", "Wind from (degrees)")}
        {input("windSpeed", "Wind speed (knots)")}
        {input("variation", "Variation (degrees)")}
        <Field label="Variation is">
          <select className="select" value={side} onChange={(e) => setSide(e.target.value as "E" | "W")}>
            <option value="E">East (east is least)</option>
            <option value="W">West (west is best)</option>
          </select>
        </Field>
        {input("deviation", "Compass deviation (degrees, + or -)", true)}
      </div>
      <dl className="flight-computer__results">
        {row("Wind correction", w.wca)}
        {row("True heading", w.th)}
        {row("Magnetic heading", w.mh)}
        {row("Compass heading", w.ch)}
        {row("Groundspeed", w.gs)}
      </dl>
      <h3>Time, speed, distance</h3>
      <div className="form-grid">
        {input("distance", "Distance (nm)")}
        {input("speed", "Speed (kt)")}
        {input("time", "Time (minutes)")}
      </div>
      <dl className="flight-computer__results">{row(tsdLabel, tsdText)}</dl>
      <h3>Fuel</h3>
      <div className="form-grid">
        {input("burn", "Fuel burn (gallons per hour)")}
        {input("minutes", "Time (minutes)")}
        {input("fuel", "Fuel on board (gallons, to find the time)")}
      </div>
      <dl className="flight-computer__results">{row(fuelLabel, fuelText)}</dl>
      <div className="flight-computer__actions">
        <Button variant="secondary" onClick={copy}>Copy</Button>
        {onAddLeg ? (
          <Button variant="secondary" disabled={!legReady || legsFull} onClick={() => onAddLeg(legDraft)}>Add as a leg</Button>
        ) : null}
        <span role="status" className="tiny dim">{copied}</span>
      </div>
      {onAddLeg && legsFull ? <p className="tiny dim">{NAV_LEG_CAP} legs is the most in one log.</p> : null}
      {onAddLeg && !legReady ? <p className="tiny dim">To add a leg, fill in course, speed, wind, variation, distance and burn.</p> : null}
      <p className="tiny dim">A study aid. Check numbers with your instructor and your own plan.</p>
    </div>
  );
}
