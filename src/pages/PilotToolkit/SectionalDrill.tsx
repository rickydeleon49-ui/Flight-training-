import { useCallback, useState } from "react";

import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import { isTauri } from "@/data";
import { loadFigurePackImages, packFigureResolver } from "@/logic/figurePacks";
import type { MixedQuestion } from "@/logic/mixedPractice";
import { SECTIONAL_PACK } from "@/logic/sectionalPack";
import { SECTIONAL_QUESTIONS } from "@/logic/sectionalQuestions";
import { QuickQuestionRun } from "@/pages/StudyLibrary/QuickQuestionRun";
import { shuffled } from "./ChartSymbolDrill";
import { FigurePackCard } from "./FigurePackCard";
import { MissedFigureCards } from "./MissedFigureCards";

const MAX_QUESTIONS = 10;
const LOAD_FAILED = "The sectional charts could not be opened. Try removing and downloading them again.";

type Run = { questions: MixedQuestion[]; images: Map<string, string> };

function pick(): MixedQuestion[] {
  return shuffled(SECTIONAL_QUESTIONS).slice(0, MAX_QUESTIONS)
    .map((question) => ({ question, materialId: "faa-figures", materialTitle: "FAA test figures" }));
}

/** Practise reading sectional chart excerpts from the optional download. Desktop app only. */
export function SectionalDrill() {
  const [run, setRun] = useState<Run | null>(null);
  const [missed, setMissed] = useState<MixedQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const onFinished = useCallback((list: MixedQuestion[]) => setMissed(list), []);
  if (!isTauri()) return null;

  const start = async () => {
    setError(null);
    try {
      const images = await loadFigurePackImages(SECTIONAL_PACK);
      setMissed([]);
      setRun({ questions: pick(), images });
    } catch {
      setError(LOAD_FAILED);
    }
  };
  const end = () => { setRun(null); setMissed([]); };

  return (
    <Card>
      <CardHeader title="Sectional chart quiz" />
      <CardBody>
        {run ? (
          <div className="stack stack--3">
            <div><Button size="small" variant="secondary" onClick={end}>Back</Button></div>
            <QuickQuestionRun questions={run.questions} resultLabel="Sectional chart quiz result" onDone={end} onFinished={onFinished}
              resolveFigure={packFigureResolver(SECTIONAL_PACK, run.images)} />
            <MissedFigureCards missed={missed} />
          </div>
        ) : (
          <div className="stack stack--3">
            <FigurePackCard pack={SECTIONAL_PACK} questionCount={SECTIONAL_QUESTIONS.length} onStart={() => { void start(); }} />
            {error ? <p className="small" role="alert">{error}</p> : null}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
