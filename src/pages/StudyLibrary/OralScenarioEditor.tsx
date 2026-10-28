import { useEffect, useState } from "react";

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

  useEffect(() => {
    if (!open) return;
    setPrompt(scenario?.prompt ?? "");
    setAssumptions(scenario?.assumptions ?? "");
    setPointsText(scenario?.points.join("\n") ?? "");
    setFromInstructor(scenario?.origin === "instructor");
    setProblem(null);
    setSaving(false);
  }, [open, scenario]);

  const save = async () => {
    if (saving) return;
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
    setSaving(true);
    const result = await mutate((repos) =>
      scenario
        ? repos.oralScenarios.edit(material.id, scenario.id, scenario.versionNumber, content)
        : repos.oralScenarios.create(material.id, content),
    );
    setSaving(false);
    if (result !== null) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={scenario ? "Edit scenario" : "Add a scenario"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            Save scenario
          </Button>
        </>
      }
    >
      <div className="stack stack--3">
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
      </div>
    </Dialog>
  );
}
