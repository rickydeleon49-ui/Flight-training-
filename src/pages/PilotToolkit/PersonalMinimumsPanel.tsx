import { useState } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import { type PersonalMinimums } from "@/domain/types";
import { compareToMinimums, minimumsLine, minimumsSummary, normalizePersonalMinimums, type MinimumVerdict } from "@/logic/personalMinimums";
import { type ToolProps } from "./toolkitShared";

const MINIMUM_FIELDS = [
  ["ceilingFt", "Lowest ceiling (ft AGL)", "numeric"],
  ["visibilitySm", "Lowest visibility (SM)", "decimal"],
  ["windKt", "Max wind (kt)", "numeric"],
  ["crosswindKt", "Max crosswind (kt)", "numeric"],
] as const;

type MinimumKey = (typeof MINIMUM_FIELDS)[number][0];

function toNumber(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function PersonalMinimumsPanel({ state, save }: ToolProps) {
  const saved = state.personalMinimums;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<MinimumKey | "note", string>>({
    ceilingFt: "",
    visibilitySm: "",
    windKt: "",
    crosswindKt: "",
    note: "",
  });
  const [today, setToday] = useState<Record<MinimumKey, string>>({
    ceilingFt: "",
    visibilitySm: "",
    windKt: "",
    crosswindKt: "",
  });
  const [busy, setBusy] = useState(false);
  const line = minimumsLine(saved);

  const open = () => {
    setForm({
      ceilingFt: saved?.ceilingFt?.toString() ?? "",
      visibilitySm: saved?.visibilitySm?.toString() ?? "",
      windKt: saved?.windKt?.toString() ?? "",
      crosswindKt: saved?.crosswindKt?.toString() ?? "",
      note: saved?.note ?? "",
    });
    setEditing(true);
  };
  const commit = async (next: PersonalMinimums | undefined) => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await save((current) => {
        const { personalMinimums: _old, ...rest } = current;
        return next ? { ...rest, personalMinimums: next } : rest;
      });
      if (ok) setEditing(false);
    } finally {
      setBusy(false);
    }
  };
  const onSave = () =>
    void commit(
      normalizePersonalMinimums({
        ceilingFt: toNumber(form.ceilingFt),
        visibilitySm: toNumber(form.visibilitySm),
        windKt: toNumber(form.windKt),
        crosswindKt: toNumber(form.crosswindKt),
        note: form.note,
      }),
    );

  const comparison = compareToMinimums(saved, {
    ceilingFt: toNumber(today.ceilingFt),
    visibilitySm: toNumber(today.visibilitySm),
    windKt: toNumber(today.windKt),
    crosswindKt: toNumber(today.crosswindKt),
  });
  const summary = minimumsSummary(comparison);
  const verdictText = (v: MinimumVerdict | undefined) =>
    v === "outside" ? "outside your minimum" : v === "inside" ? "inside" : null;

  return (
    <div className="stack stack--2">
      {line ? <p className="small">{line}</p> : null}
      {saved && !editing ? (
        <div className="stack stack--2">
          <p className="tiny dim">Optional: type today&apos;s conditions to compare.</p>
          <div className="row row--wrap">
            {MINIMUM_FIELDS.filter(([key]) => saved[key] !== undefined).map(([key, label, mode]) => (
              <div key={key}>
                <Field label={label.replace("Lowest ", "Today's ").replace("Max ", "Today's ")}>
                  <TextInput
                    type="number"
                    inputMode={mode}
                    min="0"
                    value={today[key]}
                    onChange={(e) => setToday({ ...today, [key]: e.target.value })}
                  />
                </Field>
                {verdictText(comparison[key]) ? (
                  <span
                    className={comparison[key] === "outside" ? "tiny" : "tiny dim"}
                    data-verdict={comparison[key]}
                  >
                    {verdictText(comparison[key])}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          {summary ? (
            <p className="small" data-testid="minimums-summary">
              {summary}
            </p>
          ) : null}
        </div>
      ) : null}
      {editing ? (
        <div className="stack stack--2">
          <p className="tiny dim">Set these once with your instructor. All fields are optional.</p>
          {MINIMUM_FIELDS.map(([key, label, mode]) => (
            <Field label={label} key={key}>
              <TextInput
                type="number"
                inputMode={mode}
                min="0"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </Field>
          ))}
          <Field label="One more line (optional)">
            <TextInput
              maxLength={140}
              value={form.note}
              placeholder="e.g. no night flights yet"
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>
          <div className="row">
            <Button variant="primary" onClick={onSave} disabled={busy}>
              Save my minimums
            </Button>
            <Button onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button onClick={open}>{saved ? "Edit" : "Set my minimums"}</Button>
        </div>
      )}
    </div>
  );
}
