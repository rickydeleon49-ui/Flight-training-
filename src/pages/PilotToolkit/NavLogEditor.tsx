import { useState } from "react";

import { Button, ConfirmDialog, Field, TextInput } from "@/components/ui";
import { formatMinutes, fuelForTime } from "@/logic/e6b";
import { navLogTotals, solveLeg } from "@/logic/navLog";
import { NAV_LEG_CAP, NAV_LOG_CAP } from "@/logic/savedNavLogs";
import { useOptionalAppData } from "@/state/AppDataContext";
import { updateToolkit } from "@/state/toolkitUpdate";
import type { SavedNavLeg, SavedNavLog } from "@/domain/types";
import "./FlightComputer.css";

const DASH = "–";
const pad3 = (n: number) => String(n).padStart(3, "0");
const NUMS = ["tc", "distanceNm", "tas", "windDir", "windSpeed", "variation", "deviation", "gph"] as const;
type Key = (typeof NUMS)[number];
const LABELS: Record<Key, string> = {
  tc: "True course", distanceNm: "Distance (nm)", tas: "True airspeed (kt)", windDir: "Wind from",
  windSpeed: "Wind speed (kt)", variation: "Variation", deviation: "Deviation (+ or -)", gph: "Burn (gph)",
};

/** A leg while typing: every number is text so a half-typed value is never lost. */
export type DraftLeg = Record<Key, string> & { side: "E" | "W" };
export type NavDraft = { id: string | null; name: string; aircraft: string; reserve: string; legs: DraftLeg[] };

export const emptyDraft = (): NavDraft => ({ id: null, name: "", aircraft: "", reserve: "45", legs: [] });
const toDraftLeg = (l: SavedNavLeg): DraftLeg => ({
  ...(Object.fromEntries(NUMS.map((k) => [k, String(l[k])])) as Record<Key, string>), side: l.side,
});
/** A leg as numbers, or null when any field is empty or not a number. */
export function parseLeg(l: DraftLeg): SavedNavLeg | null {
  const out: Record<string, unknown> = { side: l.side };
  for (const k of NUMS) {
    const v = l[k].trim() === "" ? NaN : Number(l[k]);
    if (!Number.isFinite(v)) return null;
    out[k] = v;
  }
  return out as unknown as SavedNavLeg;
}
export function legFromInputs(i: Record<Key, string> & { side: "E" | "W" }): DraftLeg {
  return { ...i, deviation: i.deviation.trim() === "" ? "0" : i.deviation };
}

/** The open log lives in E6bTrainer so switching tabs keeps it. */
export function useNavDraft() {
  const [draft, setDraft] = useState<NavDraft>(emptyDraft);
  const addLeg = (leg: DraftLeg) => setDraft((d) => (d.legs.length >= NAV_LEG_CAP ? d : { ...d, legs: [...d.legs, leg] }));
  return { draft, setDraft, addLeg };
}

export type Totals = { distanceNm: number; ete: number; fuel: number; reserveFuel: number | null; needed: number | null };
/** Totals from navLogTotals plus the reserve you chose, at the last leg's burn. */
export function logTotals(legs: SavedNavLeg[], reserveMinutes: number): Totals {
  const t = navLogTotals(legs);
  const last = legs[legs.length - 1];
  const r = last && Number.isFinite(reserveMinutes) ? fuelForTime(last.gph, reserveMinutes) : null;
  const reserveFuel = r && r.ok ? r.fuelGallons : reserveMinutes === 0 && last ? 0 : null;
  return { ...t, reserveFuel, needed: reserveFuel === null ? null : Math.round((t.fuel + reserveFuel) * 10) / 10 };
}

type Props = { draft: NavDraft; setDraft: (d: NavDraft) => void };

export function NavLogEditor({ draft, setDraft }: Props) {
  const app = useOptionalAppData();
  const saved: SavedNavLog[] = app?.data.toolkit.navLogs ?? [];
  const [note, setNote] = useState("");
  const [toDelete, setToDelete] = useState<SavedNavLog | null>(null);

  const parsed = draft.legs.map(parseLeg);
  const complete = parsed.filter((l): l is SavedNavLeg => l !== null);
  const reserve = draft.reserve.trim() === "" ? 0 : Number(draft.reserve);
  const reserveOk = Number.isFinite(reserve) && reserve >= 0;
  const totals = logTotals(complete, reserveOk ? reserve : NaN);
  const isNew = !saved.some((s) => s.id === draft.id);
  const logsFull = isNew && saved.length >= NAV_LOG_CAP;
  const legsFull = draft.legs.length >= NAV_LEG_CAP;
  const canSave = !!app && !logsFull && reserveOk && draft.legs.length > 0 && complete.length === draft.legs.length;

  const patch = (p: Partial<NavDraft>) => setDraft({ ...draft, ...p });
  const patchLeg = (i: number, p: Partial<DraftLeg>) =>
    patch({ legs: draft.legs.map((l, n) => (n === i ? { ...l, ...p } : l)) });
  const addBlank = () =>
    patch({ legs: [...draft.legs, { ...(Object.fromEntries(NUMS.map((k) => [k, ""])) as Record<Key, string>), deviation: "0", side: "E" }] });

  const save = async () => {
    if (!app || !canSave) return;
    const id = draft.id ?? `nav-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const log: SavedNavLog = {
      id, name: draft.name.trim() || "Untitled log", aircraft: draft.aircraft.trim(), reserveMinutes: reserve, legs: complete,
    };
    const result = await updateToolkit(app.mutate, (t) => {
      const list = t.navLogs ?? [];
      const next = list.some((s) => s.id === id) ? list.map((s) => (s.id === id ? log : s)) : [...list, log];
      return { ...t, navLogs: next.slice(0, NAV_LOG_CAP) };
    });
    if (result === null) { setNote("Could not save. Try again."); return; }
    setDraft({ ...draft, id });
    setNote("Saved.");
  };
  const remove = async () => {
    const target = toDelete;
    setToDelete(null);
    if (!app || !target) return;
    await updateToolkit(app.mutate, (t) => ({ ...t, navLogs: (t.navLogs ?? []).filter((s) => s.id !== target.id) }));
    if (draft.id === target.id) setDraft({ ...draft, id: null });
    setNote("Deleted.");
  };

  const dash = (v: number | null, unit: string) => (v === null || !Number.isFinite(v) ? DASH : `${v} ${unit}`);

  return (
    <div className="flight-computer stack stack--3">
      <h3>Nav log</h3>
      <div className="form-grid">
        <Field label="Name"><TextInput value={draft.name} maxLength={60} onChange={(e) => patch({ name: e.target.value })} /></Field>
        <Field label="Aircraft"><TextInput value={draft.aircraft} maxLength={40} onChange={(e) => patch({ aircraft: e.target.value })} /></Field>
        <Field label="Reserve you chose (minutes)">
          <TextInput type="number" inputMode="decimal" min="0" value={draft.reserve} onChange={(e) => patch({ reserve: e.target.value })} />
        </Field>
      </div>
      {draft.legs.map((leg, i) => {
        const p = parsed[i];
        const s = p ? solveLeg(p) : null;
        return (
          <fieldset className="navlog-leg" key={i}>
            <legend>Leg {i + 1}</legend>
            <div className="form-grid">
              {NUMS.map((k) => (
                <Field key={k} label={LABELS[k]}>
                  <TextInput type="number" inputMode="decimal" value={leg[k]} onChange={(e) => patchLeg(i, { [k]: e.target.value })} />
                </Field>
              ))}
              <Field label="Variation is">
                <select className="select" value={leg.side} onChange={(e) => patchLeg(i, { side: e.target.value as "E" | "W" })}>
                  <option value="E">East</option>
                  <option value="W">West</option>
                </select>
              </Field>
            </div>
            <p className="navlog-leg__out tiny">
              {s
                ? `TH ${pad3(s.th)} · MH ${pad3(s.mh)} · CH ${pad3(s.ch)} · GS ${s.gs} kt · ${formatMinutes(s.ete)} · ${s.fuel} gal`
                : `TH ${DASH} · MH ${DASH} · CH ${DASH} · GS ${DASH} · time ${DASH} · fuel ${DASH}`}
            </p>
            <Button variant="secondary" onClick={() => patch({ legs: draft.legs.filter((_, n) => n !== i) })}>Remove leg {i + 1}</Button>
          </fieldset>
        );
      })}
      <div className="flight-computer__actions">
        <Button variant="secondary" disabled={legsFull} onClick={addBlank}>Add a leg</Button>
        {legsFull ? <span className="tiny dim">{NAV_LEG_CAP} legs is the most in one log.</span> : null}
      </div>
      <dl className="flight-computer__results">
        <div className="flight-computer__row"><dt>Distance</dt><dd>{complete.length ? `${totals.distanceNm} nm` : DASH}</dd></div>
        <div className="flight-computer__row"><dt>Time</dt><dd>{complete.length ? formatMinutes(totals.ete) : DASH}</dd></div>
        <div className="flight-computer__row"><dt>Trip fuel</dt><dd>{complete.length ? `${totals.fuel} gal` : DASH}</dd></div>
        <div className="flight-computer__row"><dt>Reserve you chose</dt><dd>{reserveOk ? `${reserve} min (${dash(totals.reserveFuel, "gal")})` : DASH}</dd></div>
        <div className="flight-computer__row"><dt>Fuel on board needed</dt><dd>{dash(totals.needed, "gal")}</dd></div>
      </dl>
      <p className="tiny dim">Reserve fuel uses the burn on the last leg. Legs with a blank or bad number are left out of the totals.</p>
      <div className="flight-computer__actions">
        <Button onClick={save} disabled={!canSave}>Save</Button>
        <Button variant="secondary" onClick={() => { setDraft(emptyDraft()); setNote(""); }}>New log</Button>
        <span role="status" className="tiny dim">{note}</span>
      </div>
      {logsFull ? <p className="tiny dim">{NAV_LOG_CAP} saved logs is the most. Delete one to save a new log.</p> : null}
      {draft.legs.length > 0 && complete.length < draft.legs.length ? <p className="tiny dim">Fill in every field of every leg to save.</p> : null}
      <h3>Saved logs</h3>
      {saved.length === 0 ? <p className="tiny dim">Nothing saved yet.</p> : (
        <ul className="navlog-saved">
          {saved.map((s) => (
            <li key={s.id} className="flight-computer__row">
              <span>{s.name}{s.aircraft ? `, ${s.aircraft}` : ""} ({s.legs.length} legs)</span>
              <span className="flight-computer__actions">
                <Button variant="secondary" onClick={() => {
                  setDraft({ id: s.id, name: s.name, aircraft: s.aircraft, reserve: String(s.reserveMinutes), legs: s.legs.map(toDraftLeg) });
                  setNote("");
                }} aria-label={`Open ${s.name}`}>Open</Button>
                <Button variant="secondary" aria-label={`Delete ${s.name}`} onClick={() => setToDelete(s)}>Delete</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={toDelete !== null}
        title="Delete this nav log?"
        message={toDelete ? `"${toDelete.name}" will be removed from this device.` : ""}
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
      <p className="tiny dim">A study aid. Check numbers with your instructor and your own plan.</p>
    </div>
  );
}
