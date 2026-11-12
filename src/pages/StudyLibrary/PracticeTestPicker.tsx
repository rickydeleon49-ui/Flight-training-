import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Dialog } from "@/components/ui";
import type { PracticeTest, StudyMaterial } from "@/domain/types";
import { CheckrideTopicPractice } from "./CheckrideTopicPractice";
import { MixedPracticeTest } from "./MixedPracticeTest";

export function PracticeTestPicker({ practiceTests, materials }: {
  practiceTests: readonly PracticeTest[];
  materials: readonly StudyMaterial[];
}) {
  const [open, setOpen] = useState(false);
  const rows = practiceTests.flatMap((test) => {
    const material = materials.find((entry) => entry.id === test.sourceMaterialId);
    return material && test.questions.length > 0 ? [{ material, count: test.questions.length }] : [];
  }).sort((a, b) => a.material.title.localeCompare(b.material.title));

  return <>
    <Button variant="secondary" onClick={() => setOpen(true)}>Practice test</Button>
    {open ? <Dialog open title="Practice tests" onClose={() => setOpen(false)}>
      <div className="stack stack--3">
        <div className="row row--wrap">
          <CheckrideTopicPractice practiceTests={practiceTests} materials={materials} />
          <MixedPracticeTest practiceTests={practiceTests} materials={materials} />
        </div>
        {rows.length ? <ul className="stack stack--2" aria-label="Materials with a practice test">
          {rows.map(({ material, count }) => <li key={material.id}>
            <Link to={`/study/${encodeURIComponent(material.id)}#material-practice-test`}>
              {material.title} · {count} {count === 1 ? "question" : "questions"}
            </Link>
          </li>)}
        </ul> : <p>No practice tests yet. Open a material and choose Create practice test.</p>}
      </div>
    </Dialog> : null}
  </>;
}
