import { useCallback, useState } from "react";

import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import { FIGURE_QUESTIONS } from "@/logic/figureQuestions";
import type { MixedQuestion } from "@/logic/mixedPractice";
import { QuickQuestionRun } from "@/pages/StudyLibrary/QuickQuestionRun";
import { shuffled } from "./ChartSymbolDrill";
import { MissedFigureCards } from "./MissedFigureCards";

const MAX_QUESTIONS = 10;

function pick(): MixedQuestion[] {
  return shuffled(FIGURE_QUESTIONS).slice(0, MAX_QUESTIONS)
    .map((question) => ({ question, materialId: "faa-figures", materialTitle: "FAA test figures" }));
}

/** Practise reading the FAA test figures. Nothing is saved unless you add your misses to your review cards. */
export function FigureDrill() {
  const [run, setRun] = useState<MixedQuestion[] | null>(null);
  const [missed, setMissed] = useState<MixedQuestion[]>([]);

  const start = () => { setRun(pick()); setMissed([]); };
  const onFinished = useCallback((list: MixedQuestion[]) => setMissed(list), []);

  return (
    <Card>
      <CardHeader title="FAA figure drill" />
      <CardBody>
        {run ? (
          <div className="stack stack--3">
            <div><Button size="small" variant="secondary" onClick={() => setRun(null)}>Back</Button></div>
            <QuickQuestionRun questions={run} resultLabel="FAA figure drill result" onDone={() => setRun(null)} onFinished={onFinished} />
            <MissedFigureCards missed={missed} />
          </div>
        ) : (
          <>
            <p className="muted">Practise reading the FAA test figures: airport diagrams, weather reports and charts. Practice, not for flight.</p>
            <Button variant="primary" onClick={start}>Start</Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}
