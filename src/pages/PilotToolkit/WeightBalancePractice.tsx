import { Fragment, useMemo, useState } from "react";
import { Button, Card, CardBody, CardHeader, Field, TextInput } from "@/components/ui";
import { AVGAS_LB_PER_GAL, WB_PRACTICE, describeWbPractice, WB_ROW_KEYS, WB_ROW_LABELS, calculateWeightBalance, emptyWbInput, type WbInput, type WbPractice, type WbRowKey } from "@/logic/weightBalance";

export function WeightBalancePractice() {
  const [input, setInput] = useState<WbInput>(emptyWbInput);
  const [showAnswer, setShowAnswer] = useState<string | null>(null);
  const [practice, setPractice] = useState<WbPractice | null>(null);
  const result = useMemo(() => calculateWeightBalance(input), [input]);
  const untouched = WB_ROW_KEYS.every((k) => input.rows[k].amount.trim() === "" && input.rows[k].arm.trim() === "");
  const setRow = (key: WbRowKey, field: "amount" | "arm", value: string) =>
    setInput((cur) => ({ ...cur, rows: { ...cur.rows, [key]: { ...cur.rows[key], [field]: value } } }));
  return (
    <Card variant="grouped">
      <CardHeader title="Weight & balance practice" eyebrow="Study aid only" />
      <CardBody>
        <div className="stack stack--3">
          <p>Study aid only. Use your airplane's POH and check with your instructor.</p>
          <p>Fuel is entered in gallons and counted at {AVGAS_LB_PER_GAL} lb per gallon (avgas).</p>
          {practice ? <p><strong>{practice.title}.</strong> {describeWbPractice(practice.input)}</p> : null}
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
        </div>
      </CardBody>
    </Card>
  );
}
