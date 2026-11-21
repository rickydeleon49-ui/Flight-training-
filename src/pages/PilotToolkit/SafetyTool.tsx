import { Fragment, useRef, useState } from "react";
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Select, TextArea } from "@/components/ui";
import { type SafetyCheck, type SafetyDecision } from "@/domain/types";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import { PersonalMinimumsPanel } from "./PersonalMinimumsPanel";
import { WeightBalancePractice } from "./WeightBalancePractice";
import { PerformanceAidCard } from "./PerformanceAidCard";
import { type ToolProps } from "./toolkitShared";

const SAFETY_ITEMS: Array<
  [
    keyof Pick<
      SafetyCheck,
      | "illnessOkay"
      | "medicationOkay"
      | "stressOkay"
      | "alcoholOkay"
      | "fatigueOkay"
      | "emotionOkay"
      | "weatherReviewed"
      | "aircraftReviewed"
      | "personalMinimumsMet"
    >,
    string,
    string,
  ]
> = [
  [
    "illnessOkay",
    "Illness",
    "I checked for symptoms that could affect this flight.",
  ],
  [
    "medicationOkay",
    "Medication",
    "I reviewed medication effects and applicable guidance.",
  ],
  [
    "stressOkay",
    "Stress",
    "I honestly considered workload and emotional stress.",
  ],
  ["alcoholOkay", "Alcohol", "I considered alcohol limits and impairment."],
  ["fatigueOkay", "Fatigue", "I am satisfied with sleep and alertness."],
  [
    "emotionOkay",
    "Emotion",
    "I honestly considered anger, anxiety, depression, and other emotions.",
  ],
  [
    "weatherReviewed",
    "Weather",
    "Weather was reviewed with appropriate sources and guidance.",
  ],
  [
    "aircraftReviewed",
    "Aircraft",
    "Aircraft status and required preflight work will be checked.",
  ],
  [
    "personalMinimumsMet",
    "Personal minimums",
    "Conditions fit the minimums agreed with my instructor.",
  ],
];


function emptySafety(): Omit<SafetyCheck, "id" | "date"> {
  return {
    illnessOkay: false,
    medicationOkay: false,
    stressOkay: false,
    alcoholOkay: false,
    fatigueOkay: false,
    emotionOkay: false,
    weatherReviewed: false,
    aircraftReviewed: false,
    personalMinimumsMet: false,
    decision: "discuss",
    notes: "",
  };
}

export function SafetyTool({ state, save }: ToolProps) {
  const [draft, setDraft] = useState(emptySafety);
  const completed = SAFETY_ITEMS.filter(([key]) => draft[key]).length;
  // A double-click must not save the check-in twice.
  const recording = useRef(false);
  const [recordBusy, setRecordBusy] = useState(false);
  const record = async () => {
    if (recording.current) return;
    recording.current = true;
    setRecordBusy(true);
    const check: SafetyCheck = { id: newId(), date: nowIso(), ...draft };
    try {
      if (
        await save((current) => ({
          ...current,
          safetyChecks: [check, ...current.safetyChecks].slice(0, 100),
        }))
      )
        setDraft(emptySafety());
    } finally {
      recording.current = false;
      setRecordBusy(false);
    }
  };
  return (
    <>
    <div className="toolkit-two-column">
      <Card variant="grouped">
        <CardHeader
          title="Preflight personal check-in"
          eyebrow="IMSAFE + preparation"
          action={
            <Badge
              tone={completed === SAFETY_ITEMS.length ? "complete" : "due"}
            >
              {completed}/{SAFETY_ITEMS.length} reviewed
            </Badge>
          }
        />
        <CardBody>
          <div className="stack stack--3">
            {SAFETY_ITEMS.map(([key, label, meta]) => (
              <Fragment key={key}>
                <Checkbox
                  checked={draft[key]}
                  onChange={(checked) => setDraft({ ...draft, [key]: checked })}
                  label={label}
                  meta={meta}
                />
                {key === "personalMinimumsMet" ? (
                  <PersonalMinimumsPanel state={state} save={save} />
                ) : null}
              </Fragment>
            ))}
            <Field label="My decision">
              <Select
                options={[
                  { value: "go", label: "No concerns you noted" },
                  { value: "discuss", label: "Talk it over with your instructor" },
                  { value: "no_go", label: "You chose not to fly" },
                ]}
                value={draft.decision}
                onChange={(decision: SafetyDecision) =>
                  setDraft({ ...draft, decision })
                }
              />
            </Field>
            <Field label="Notes">
              <TextArea
                rows={3}
                value={draft.notes}
                onChange={(event) =>
                  setDraft({ ...draft, notes: event.target.value })
                }
              />
            </Field>
            <Button variant="primary" onClick={() => void record()} disabled={recordBusy}>
              {recordBusy ? "Saving…" : "Save this check-in"}
            </Button>
            <p className="tiny dim">
              This prompt never makes the decision for you. Stop and involve the
              instructor whenever anything is uncertain.
            </p>
          </div>
        </CardBody>
      </Card>
      <Card variant="grouped">
        <CardHeader title="Recent check-ins" />
        <CardBody>
          {state.safetyChecks.length ? (
            <div className="stack stack--3">
              {state.safetyChecks.slice(0, 8).map((check) => (
                <div className="row row--between" key={check.id}>
                  <div>
                    <p className="small">
                      {new Date(check.date).toLocaleString()}
                    </p>
                    <p className="tiny dim">
                      {SAFETY_ITEMS.filter(([key]) => check[key]).length}/
                      {SAFETY_ITEMS.length} reviewed
                    </p>
                  </div>
                  <Badge
                    tone={
                      check.decision === "go"
                        ? "complete"
                        : check.decision === "no_go"
                          ? "overdue"
                          : "due"
                    }
                  >
                    {check.decision === "no_go"
                      ? "Chose not to fly"
                      : check.decision === "go"
                        ? "No concerns noted"
                        : "Talk it over"}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted">
              No personal safety check-ins saved yet.
            </p>
          )}
        </CardBody>
      </Card>
      <PerformanceAidCard />
    </div>
    <WeightBalancePractice state={state} save={save} />
    </>
  );
}
