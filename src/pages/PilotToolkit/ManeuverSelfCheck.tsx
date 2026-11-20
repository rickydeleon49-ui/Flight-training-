import { useState } from "react";

import { Button, Select, TextInput } from "@/components/ui";
import type { ManeuverCheck, ManeuverCheckRating } from "@/domain/types";
import { formatLongDate, todayIso } from "@/lib/dates";
import {
  catalogLine,
  checkCounts,
  MANEUVER_CHECK_CAP,
  MANEUVER_FOOTER,
  MANEUVER_NOTE_MAX,
  MANEUVER_RATINGS,
  MANEUVERS,
  recentChecks,
  toleranceLine,
} from "@/logic/maneuverChecks";
import { useAppData } from "@/state/AppDataContext";
import { updateToolkit } from "@/state/toolkitUpdate";

export function ManeuverSelfCheck() {
  const { data, mutate } = useAppData();
  const [task, setTask] = useState<string>(MANEUVERS[0]!.task);
  const [picked, setPicked] = useState<Record<string, ManeuverCheckRating>>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<"idle" | "saved" | "failed">("idle");

  const maneuver = MANEUVERS.find((m) => m.task === task) ?? MANEUVERS[0]!;
  const key = (i: number) => `${maneuver.task}:${i}`;
  const complete = maneuver.tolerances.every((_, i) => picked[key(i)]);
  const recent = recentChecks(data.toolkit.maneuverChecks ?? [], maneuver.task);

  const choose = (value: string) => {
    setTask(value);
    setPicked({});
    setNote("");
    setState("idle");
  };

  const save = async () => {
    if (!complete || saving) return;
    setSaving(true);
    setState("idle");
    const entry: ManeuverCheck = {
      task: maneuver.task,
      date: todayIso(),
      items: maneuver.tolerances.map((t, i) => ({ code: t.code, label: toleranceLine(t), rating: picked[key(i)]! })),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const result = await updateToolkit(mutate, (current) => ({
      ...current,
      maneuverChecks: [...(current.maneuverChecks ?? []), entry].slice(-MANEUVER_CHECK_CAP),
    }));
    setSaving(false);
    if (result === null) {
      setState("failed");
      return;
    }
    setState("saved");
    setPicked({});
    setNote("");
  };

  return (
    <div className="stack stack--3" data-testid="maneuver-self-check">
      <Select
        aria-label="Maneuver"
        value={task}
        onChange={choose}
        options={MANEUVERS.map((m) => ({ value: m.task, label: `${m.title} (${m.task})` }))}
      />
      <ul className="acs-list" aria-label="Tolerances">
        {maneuver.tolerances.map((t, i) => (
          <li className="acs-list__row" key={key(i)}>
            <span className="small strong">{toleranceLine(t)}</span>
            <span className="tiny dim wrap-anywhere">{t.code}: {catalogLine(t.code)}</span>
            <div className="row row--wrap row--gap-2" role="group" aria-label={toleranceLine(t)}>
              {MANEUVER_RATINGS.map((r) => (
                <Button
                  key={r}
                  size="small"
                  variant={picked[key(i)] === r ? "primary" : "secondary"}
                  aria-pressed={picked[key(i)] === r}
                  onClick={() => setPicked((p) => ({ ...p, [key(i)]: r }))}
                >
                  {r}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <TextInput
        aria-label="Short note (optional)"
        placeholder="Short note (optional)"
        maxLength={MANEUVER_NOTE_MAX}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="row row--wrap row--gap-2">
        <Button size="small" disabled={!complete || saving} onClick={() => void save()}>
          Save this check
        </Button>
      </div>
      {state === "saved" ? <p className="tiny muted" role="status">Saved.</p> : null}
      {state === "failed" ? <p className="tiny" role="alert">Couldn't save your check. Try again.</p> : null}
      {recent.length ? (
        <ul className="stack stack--1" aria-label="Recent checks" data-testid="maneuver-recent">
          {recent.map((c, idx) => {
            const n = checkCounts(c);
            return (
              <li className="tiny" key={`${c.date}-${idx}`}>
                {formatLongDate(c.date)}: {n.Within} Within, {n.Close} Close, {n["Not yet"]} Not yet
                {c.note ? ` (${c.note})` : ""}
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="tiny dim">{MANEUVER_FOOTER}</p>
    </div>
  );
}
