import { useMemo, useState } from "react";

import { Button, Select } from "@/components/ui";
import type { OralRating, StudyMaterial } from "@/domain/types";
import { localDayOf, nowIso } from "@/lib/dates";
import { PRIVATE_AIRPLANE_ACS_AREAS, summarizeAcsAreaMaterialCoverage } from "@/logic/acsAreaMaterialCoverage";
import { areaName } from "@/logic/mockTest";
import { ORAL_RATING_CAP } from "@/logic/oralRatings";
import { useAppData } from "@/state/AppDataContext";
import { updateToolkit } from "@/state/toolkitUpdate";

type Choice = OralRating["rating"];
const CHOICES: Choice[] = ["Satisfactory", "Needs work"];

/**
 * The student's own view of one practised scenario, kept with an ACS area.
 * A later rating of the same scenario replaces the earlier one.
 */
export function OralDebriefRating({
  scenarioId,
  title,
  material,
}: {
  scenarioId: string;
  title: string;
  material: StudyMaterial;
}) {
  const { mutate } = useAppData();
  const areas = useMemo(() => summarizeAcsAreaMaterialCoverage({ materials: [material] }), [material]);
  const only = areas.filter((a) => a.distinctMaterialCount > 0);
  const [rating, setRating] = useState<Choice | null>(null);
  const [area, setArea] = useState<string>(only.length === 1 ? only[0]!.area : "");
  const [skipped, setSkipped] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  if (skipped) return null;

  const save = async () => {
    if (!rating || !area || saving) return;
    setSaving(true);
    setFailed(false);
    const entry: OralRating = {
      scenarioId,
      title,
      rating,
      area: `PA.${area}`,
      date: localDayOf(nowIso()) ?? nowIso().slice(0, 10),
    };
    const result = await updateToolkit(mutate, (current) => ({
      ...current,
      oralRatings: [...(current.oralRatings ?? []).filter((r) => r.scenarioId !== scenarioId), entry].slice(-ORAL_RATING_CAP),
    }));
    setSaving(false);
    if (result === null) setFailed(true);
    else setSaved(true);
  };

  return (
    <fieldset className="stack stack--2" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="small">How did that feel?</legend>
      {saved ? (
        <p className="tiny muted" role="status">Saved. You can change it by practising this scenario again.</p>
      ) : (
        <>
          <div className="row row--wrap row--gap-2" role="group" aria-label="How did that feel?">
            {CHOICES.map((choice) => (
              <Button
                key={choice}
                size="small"
                variant={rating === choice ? "primary" : "secondary"}
                aria-pressed={rating === choice}
                onClick={() => setRating(choice)}
              >
                {choice}
              </Button>
            ))}
          </div>
          <Select
            aria-label="ACS area"
            placeholder="Choose the ACS area"
            value={area}
            onChange={setArea}
            options={PRIVATE_AIRPLANE_ACS_AREAS.map((roman) => ({
              value: roman,
              label: areaName(roman),
            }))}
          />
          <p className="tiny muted">Your own view. Your instructor decides.</p>
          {failed ? <p role="alert" className="tiny">Couldn't save your rating. Try again.</p> : null}
          <div className="row row--wrap row--gap-2">
            <Button size="small" variant="secondary" disabled={!rating || !area || saving} onClick={() => void save()}>
              Save my rating
            </Button>
            <Button size="small" onClick={() => setSkipped(true)}>Skip</Button>
          </div>
        </>
      )}
    </fieldset>
  );
}
