import { BRING_ITEMS, daysToCheckride } from "@/logic/checkride";
import { Checkbox, TypedDateField } from "@/components/ui";
import { ENDORSEMENT_ITEMS } from "@/logic/toolkit";
import { type ToolProps } from "./toolkitShared";

export function EndorsementChecklist({ state, save }: ToolProps) {
  const checks = state.endorsementChecks ?? {};
  const update = (id: string, next: { done: boolean; date?: string }) =>
    save((current) => ({
      ...current,
      endorsementChecks: {
        ...(current.endorsementChecks ?? {}),
        [id]: next.date ? { done: next.done, date: next.date } : { done: next.done },
      },
    }));
  return (
    <details className="card material-fold" id="endorsements-checklist">
      <summary>Endorsements checklist</summary>
      <p className="tiny dim">
        Your instructor writes the real endorsements in your logbook. This list only helps you keep track.
      </p>
      <div className="stack stack--4">
        {ENDORSEMENT_ITEMS.map((item) => {
          const entry = checks[item.id];
          return (
            <div key={item.id} className="stack stack--2">
              <Checkbox
                checked={entry?.done === true}
                onChange={(done) => void update(item.id, { done, date: entry?.date })}
                label={item.label}
                meta={item.cite}
              />
              {entry?.done ? (
                <TypedDateField
                  label={`Date: ${item.label}`}
                  value={entry.date ?? ""}
                  onChange={(date) => void update(item.id, { done: true, date: date || undefined })}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </details>
  );
}

export function BringChecklist({ state, save }: ToolProps) {
  const days = daysToCheckride(state.checkrideDate);
  const soon = days !== null && days <= 30;
  const checks = state.bringChecks ?? {};
  const update = (id: string, done: boolean) =>
    save((current) => ({
      ...current,
      bringChecks: { ...(current.bringChecks ?? {}), [id]: done },
    }));
  return (
    <details className="card material-fold" id="bring-checklist">
      <summary>What to bring</summary>
      {soon ? null : <p className="tiny dim">For checkride day. You can look now.</p>}
      <p className="tiny dim">Your examiner and instructor tell you exactly what to bring.</p>
      <div className="stack stack--4">
        {BRING_ITEMS.map((item) => (
          <Checkbox
            key={item.id}
            checked={checks[item.id] === true}
            onChange={(done) => void update(item.id, done)}
            label={item.label}
          />
        ))}
      </div>
    </details>
  );
}
