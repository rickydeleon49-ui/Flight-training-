import { Fragment, useMemo, useState } from "react";
import { Button, Card, CardBody, CardHeader, Field, TextInput } from "@/components/ui";
import { AVGAS_LB_PER_GAL, MY_AIRPLANE_NAME_MAX, WB_PRACTICE, applyMyAirplane, describeWbPractice, WB_ROW_KEYS, WB_ROW_LABELS, calculateWeightBalance, emptyWbInput, myAirplaneFromInput, type MyAirplane, type WbInput, type WbPractice, type WbRowKey } from "@/logic/weightBalance";
import { type ToolProps } from "./toolkitShared";

type Mode = "mine" | "blank";
type FlightKey = "front" | "rear" | "fuel" | "baggage";
const FLIGHT_KEYS: FlightKey[] = ["front", "rear", "fuel", "baggage"];

const flightLabel = (key: WbRowKey) => `${WB_ROW_LABELS[key]}${key === "fuel" ? "" : " (lb)"}`;
const armLabel = (key: WbRowKey) => `${WB_ROW_LABELS[key].replace(" (gallons)", "")} arm (in)`;

export function WeightBalancePractice({ state, save }: ToolProps) {
  const saved = state.myAirplane;
  const [mode, setMode] = useState<Mode>(saved ? "mine" : "blank");
  const [flight, setFlight] = useState<Record<FlightKey, string>>({ front: "", rear: "", fuel: "", baggage: "" });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WbInput>(emptyWbInput);
  const [draftName, setDraftName] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [blankInput, setInput] = useState<WbInput>(emptyWbInput);
  const mineInput = useMemo(() => {
    if (!saved) return emptyWbInput();
    const base = emptyWbInput();
    for (const k of FLIGHT_KEYS) base.rows[k].amount = flight[k];
    const out = applyMyAirplane(base, saved);
    // A row left blank this flight is skipped, so its saved arm must not count as half-typed.
    for (const k of FLIGHT_KEYS) if (flight[k].trim() === "") out.rows[k].arm = "";
    return out;
  }, [saved, flight]);
  const showMine = mode === "mine";
  const input = showMine ? mineInput : blankInput;
  const [showAnswer, setShowAnswer] = useState<string | null>(null);
  const [practice, setPractice] = useState<WbPractice | null>(null);
  const result = useMemo(() => calculateWeightBalance(input), [input]);
  const untouched = showMine
    ? FLIGHT_KEYS.every((k) => flight[k].trim() === "")
    : WB_ROW_KEYS.every((k) => input.rows[k].amount.trim() === "" && input.rows[k].arm.trim() === "");
  const setDraftRow = (key: WbRowKey, field: "amount" | "arm", value: string) =>
    setDraft((cur) => ({ ...cur, rows: { ...cur.rows, [key]: { ...cur.rows[key], [field]: value } } }));
  const parsed = useMemo(() => myAirplaneFromInput(draft, draftName), [draft, draftName]);
  const draftError = "error" in parsed ? parsed.error : "";
  const openEdit = () => {
    setDraft(saved ? applyMyAirplane(emptyWbInput(), saved) : emptyWbInput());
    setDraftName(saved?.name ?? "");
    setStatus("");
    setEditing(true);
  };
  const commit = async (next: MyAirplane | undefined) => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await save((current) => {
        const { myAirplane: _old, ...rest } = current;
        return next ? { ...rest, myAirplane: next } : rest;
      });
      if (ok) {
        setEditing(false);
        setStatus(next ? "Saved your airplane." : "Cleared your airplane.");
        if (!next) setMode("blank");
      } else {
        setStatus("Could not save. Try again.");
      }
    } finally {
      setBusy(false);
    }
  };
  const setRow = (key: WbRowKey, field: "amount" | "arm", value: string) =>
    setInput((cur) => ({ ...cur, rows: { ...cur.rows, [key]: { ...cur.rows[key], [field]: value } } }));
  return (
    <Card variant="grouped">
      <CardHeader title="Weight & balance practice" eyebrow="Study aid only" />
      <CardBody>
        <div className="stack stack--3">
          <p>Study aid only. Use your airplane's POH and check with your instructor.</p>
          <p>Fuel is entered in gallons and counted at {AVGAS_LB_PER_GAL} lb per gallon (avgas).</p>
          <div className="segmented" role="radiogroup" aria-label="Which numbers to use">
            {([["mine", "My airplane"], ["blank", "Blank practice"]] as const).map(([value, label]) => (
              <label key={value} className={`segmented__option${mode === value ? " is-selected" : ""}`}>
                <input type="radio" name="wb-mode" value={value} checked={mode === value} onChange={() => { setMode(value); setStatus(""); }} />
                {label}
              </label>
            ))}
          </div>
          {practice && !showMine ? <p><strong>{practice.title}.</strong> {describeWbPractice(practice.input)}</p> : null}
          {showMine ? (
            editing ? (
              <div className="stack stack--3">
                <p>Type the numbers from your airplane's POH. Check them with your instructor.</p>
                <div className="form-grid">
                  <Field label={`Airplane name (optional, up to ${MY_AIRPLANE_NAME_MAX} characters)`}>
                    <TextInput value={draftName} onChange={(e) => setDraftName(e.target.value)} />
                  </Field>
                  <Field label="Basic empty weight (lb)">
                    <TextInput value={draft.rows.empty.amount} onChange={(e) => setDraftRow("empty", "amount", e.target.value)} />
                  </Field>
                  <Field label="Basic empty weight arm (in)">
                    <TextInput value={draft.rows.empty.arm} onChange={(e) => setDraftRow("empty", "arm", e.target.value)} />
                  </Field>
                  {FLIGHT_KEYS.map((key) => (
                    <Field key={key} label={armLabel(key)}>
                      <TextInput value={draft.rows[key].arm} onChange={(e) => setDraftRow(key, "arm", e.target.value)} />
                    </Field>
                  ))}
                  <Field label="Max gross weight (lb)">
                    <TextInput value={draft.maxGross} onChange={(e) => setDraft({ ...draft, maxGross: e.target.value })} />
                  </Field>
                  <Field label="Forward CG limit (in)">
                    <TextInput value={draft.forwardLimit} onChange={(e) => setDraft({ ...draft, forwardLimit: e.target.value })} />
                  </Field>
                  <Field label="Aft CG limit (in)">
                    <TextInput value={draft.aftLimit} onChange={(e) => setDraft({ ...draft, aftLimit: e.target.value })} />
                  </Field>
                </div>
                <p className="small muted" aria-live="polite">
                  {draftError ? `Save is off. ${draftError}` : "Ready to save."}
                </p>
                <div className="row">
                  <Button variant="secondary" disabled={busy || "error" in parsed} onClick={() => void commit("error" in parsed ? undefined : parsed)}>
                    Save my airplane
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </div>
            ) : saved ? (
              <div className="stack stack--3">
                <p><strong>{saved.name ?? "My airplane"}</strong>. Your POH numbers:</p>
                <ul>
                  <li>Basic empty weight: {saved.emptyWeight} lb at {saved.emptyArm} in</li>
                  <li>Max gross weight: {saved.maxGross} lb</li>
                  <li>Front seats arm: {saved.frontArm} in</li>
                  <li>Rear seats arm: {saved.rearArm} in</li>
                  <li>Fuel arm: {saved.fuelArm} in</li>
                  <li>Baggage arm: {saved.baggageArm} in</li>
                  <li>CG limits: {saved.forwardLimit} in forward, {saved.aftLimit} in aft</li>
                </ul>
                <div className="row">
                  <Button variant="secondary" onClick={openEdit}>Edit</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => void commit(undefined)}>Clear my airplane</Button>
                </div>
                <div className="form-grid">
                  {FLIGHT_KEYS.map((key) => (
                    <Field key={key} label={flightLabel(key)}>
                      <TextInput value={flight[key]} onChange={(e) => setFlight((cur) => ({ ...cur, [key]: e.target.value }))} />
                    </Field>
                  ))}
                </div>
              </div>
            ) : (
              <div className="stack stack--3">
                <p>Add your airplane's POH numbers</p>
                <div className="row">
                  <Button variant="secondary" onClick={openEdit}>Edit</Button>
                </div>
              </div>
            )
          ) : (
          <div className="form-grid">
              {WB_ROW_KEYS.map((key) => (
                <Fragment key={key}>
                  <Field label={`${WB_ROW_LABELS[key]}${key === "fuel" ? "" : " (lb)"}`}>
                    <TextInput
                      value={input.rows[key].amount}
                      onChange={(e) => setRow(key, "amount", e.target.value)}
                    />
                  </Field>
                  <Field label={`${WB_ROW_LABELS[key].replace(" (gallons)", "")} arm (in)`}>
                    <TextInput
                      value={input.rows[key].arm}
                      onChange={(e) => setRow(key, "arm", e.target.value)}
                    />
                  </Field>
                </Fragment>
              ))}
              <Field label="Max gross weight (lb, optional)">
                <TextInput value={input.maxGross} onChange={(e) => setInput({ ...input, maxGross: e.target.value })} />
              </Field>
              <Field label="Forward CG limit (in, optional)">
                <TextInput value={input.forwardLimit} onChange={(e) => setInput({ ...input, forwardLimit: e.target.value })} />
              </Field>
              <Field label="Aft CG limit (in, optional)">
                <TextInput value={input.aftLimit} onChange={(e) => setInput({ ...input, aftLimit: e.target.value })} />
              </Field>
            </div>
          )}
          <p className="small muted" role="status" aria-live="polite">{status}</p>
          <div aria-live="polite" style={{ overflowX: "auto" }}>
            {untouched ? (
              <p>Enter your numbers, or fill in a practice problem below.</p>
            ) : result.ok ? (
              <>
                <table>
                  <thead>
                    <tr><th scope="col">Item</th><th scope="col">Weight (lb)</th><th scope="col">Arm (in)</th><th scope="col">Moment</th></tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.key}><th scope="row">{WB_ROW_LABELS[r.key].replace(" (gallons)", "")}</th><td>{r.weight}</td><td>{r.arm}</td><td>{r.moment}</td></tr>
                    ))}
                    <tr><th scope="row">Total</th><td>{result.totalWeight}</td><td>{result.cg}</td><td>{result.totalMoment}</td></tr>
                  </tbody>
                </table>
                <p>Center of gravity: {result.cg} in. {result.verdict}</p>
              </>
            ) : (
              <p>{result.error}</p>
            )}
          </div>
          {showMine ? null : (<>
          <h3>Try this</h3>
          <p>Practice numbers, not a real airplane.</p>
          <div className="stack stack--3">
            {WB_PRACTICE.map((p) => (
              <div key={p.id}>
                <strong>{p.title}</strong>
                <div>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setInput(JSON.parse(JSON.stringify(p.input)));
                      setPractice(p);
                      setShowAnswer(null);
                    }}
                  >
                    Fill in {p.title.split(":")[0]}
                  </Button>{" "}
                  {practice?.id === p.id ? (
                    <Button variant="ghost" onClick={() => setShowAnswer(showAnswer === p.id ? null : p.id)}>
                      {showAnswer === p.id ? "Hide answer" : "Show answer"}
                    </Button>
                  ) : null}
                </div>
                {showAnswer === p.id ? <p>{p.answer}</p> : null}
              </div>
            ))}
          </div>
          </>)}
        </div>
      </CardBody>
    </Card>
  );
}
