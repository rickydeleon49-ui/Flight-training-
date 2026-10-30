import { useEffect, useRef, useState } from "react";

import { Button, Checkbox, Dialog, Field, TextArea } from "@/components/ui";
import type { OralScenario } from "@/data/oralScenarios";
import type { StudyMaterial } from "@/domain/types";
import {
  ORAL_MAX_ASSUMPTIONS,
  ORAL_MAX_POINTS,
  ORAL_MAX_SCENARIO,
  oralSetupProblem,
  parseOralPoints,
} from "@/logic/oralPractice";
import { useAppData } from "@/state/AppDataContext";

/** Add a scenario, or edit one (an edit keeps the earlier version). */
export function OralScenarioEditor({
  material,
  scenario,
  open,
  onClose,
}: {
  material: StudyMaterial;
  /** The scenario to edit; none to add a new one. */
  scenario: OralScenario | null;
  open: boolean;
  onClose: () => void;
}) {
  const { mutate } = useAppData();
  const [prompt, setPrompt] = useState("");
  const [assumptions, setAssumptions] = useState("");
  const [pointsText, setPointsText] = useState("");
  const [fromInstructor, setFromInstructor] = useState(false);
  const [problem, setProblem] = useState<ReturnType<typeof oralSetupProblem>>(null);
  const [saving, setSaving] = useState(false);
  // Synchronous: a second click in the same render must not save twice.
  const savingRef = useRef(false);

  useEffect(() => {
    if (!open || savingRef.current) return;
    setPrompt(scenario?.prompt ?? "");
    setAssumptions(scenario?.assumptions ?? "");
    setPointsText(scenario?.points.join("\n") ?? "");
    setFromInstructor(scenario?.origin === "instructor");
    setProblem(null);
  }, [open, scenario]);

  const close = () => {
    if (!savingRef.current) onClose();
  };

  const save = async () => {
    if (savingRef.current) return;
    const found = oralSetupProblem(prompt, pointsText);
    setProblem(found);
    if (found) return;
    const content = {
      prompt: prompt.trim(),
      assumptions: assumptions.trim(),
      points: parseOralPoints(pointsText),
      sourcePage: scenario?.sourcePage ?? null,
      origin: fromInstructor ? ("instructor" as const) : ("user" as const),
    };
    if (
      scenario &&
      content.prompt === scenario.prompt &&
      content.assumptions === scenario.assumptions &&
      content.origin === scenario.origin &&
      content.points.join("\n") === scenario.points.join("\n")
    ) {
      onClose();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    let result: unknown = null;
    try {
      result = await mutate((repos) =>
        scenario
          ? repos.oralScenarios.edit(material.id, scenario.id, scenario.versionNumber, content)
          : repos.oralScenarios.create(material.id, content),
      );
    } finally {
      // Released either way: on a failed save the dialog stays open so she can retry.
      savingRef.current = false;
      setSaving(false);
    }
    if (result !== null) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      dismissible={!saving}
      title={scenario ? "Edit scenario" : "Add a scenario"}
      footer={
        <>
          <Button disabled={saving} onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save scenario"}
          </Button>
        </>
      }
    >
      <fieldset disabled={saving} className="stack stack--3" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Field
          label="Scenario"
          hint="The question as an examiner might ask it. Write it, or copy it from your instructor."
          error={problem?.field === "scenario" ? problem.message : null}
        >
          <TextArea rows={3} maxLength={ORAL_MAX_SCENARIO} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        </Field>
        <Field label="Assumptions (optional)" hint="For example the aircraft, the weather, or “imagine you are…”.">
          <TextArea
            rows={2}
            maxLength={ORAL_MAX_ASSUMPTIONS}
            value={assumptions}
            onChange={(event) => setAssumptions(event.target.value)}
          />
        </Field>
        <Field
          label="Discussion points"
          hint={`One point per line, up to ${ORAL_MAX_POINTS}. They stay hidden while you practise until you choose to show them.`}
          error={problem?.field === "points" ? problem.message : null}
        >
          <TextArea rows={4} value={pointsText} onChange={(event) => setPointsText(event.target.value)} />
        </Field>
        <Checkbox
          checked={fromInstructor}
          strikethrough={false}
          onChange={setFromInstructor}
          label="My instructor gave me this"
        />
      </fieldset>
    </Dialog>
  );
}
