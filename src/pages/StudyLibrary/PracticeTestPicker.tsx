import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Dialog } from "@/components/ui";
import type { PracticeTest, QuestionBookmark, StudyMaterial } from "@/domain/types";
import { CheckrideTopicPractice } from "./CheckrideTopicPractice";
import { MixedPracticeTest } from "./MixedPracticeTest";
import { useOptionalAppData } from "@/state/AppDataContext";
import { updateToolkit } from "@/state/toolkitUpdate";
import { MockTestEntry } from "./MockTestRun";
import { QuestionBookmarks } from "./QuestionBookmarks";

export function PracticeTestPicker({ practiceTests, materials, openRequest, hideTrigger }: {
  practiceTests: readonly PracticeTest[];
  materials: readonly StudyMaterial[];
  /** A page menu owns the button: each new number opens the dialog. */
  openRequest?: number;
  hideTrigger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [showMarks, setShowMarks] = useState(false);
  const app = useOptionalAppData();
  const marks = app?.data.toolkit?.questionBookmarks ?? [];
  const mutate = app?.mutate;
  const saveMarks = (list: QuestionBookmark[]) => {
    if (mutate) void updateToolkit(mutate, (t) => ({ ...t, questionBookmarks: list }));
  };
  useEffect(() => { if (openRequest) setOpen(true); }, [openRequest]);
  const rows = practiceTests.flatMap((test) => {
    const material = materials.find((entry) => entry.id === test.sourceMaterialId);
    return material && test.questions.length > 0 ? [{ material, count: test.questions.length }] : [];
  }).sort((a, b) => a.material.title.localeCompare(b.material.title));

  return <>
    {hideTrigger ? null : <Button variant="secondary" aria-haspopup="dialog" aria-expanded={open} onClick={() => { if (!open) setOpen(true); }}>Practice test</Button>}
    {open ? <Dialog open title="Practice tests" onClose={() => setOpen(false)}>
      <div className="stack stack--3">
        <div className="row row--wrap">
          <CheckrideTopicPractice practiceTests={practiceTests} materials={materials} />
          <MixedPracticeTest practiceTests={practiceTests} materials={materials} onFinished={() => setOpen(false)} />
          <MockTestEntry practiceTests={practiceTests} materials={materials} />
        </div>
        {app && marks.length > 0 ? <div className="stack stack--2">
          <Button variant="secondary" aria-expanded={showMarks} onClick={() => setShowMarks((v) => !v)}>Bookmarks ({marks.length})</Button>
          {showMarks ? <QuestionBookmarks practiceTests={practiceTests} materials={materials} bookmarks={marks} onChange={saveMarks} /> : null}
        </div> : null}
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
