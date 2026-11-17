import { useCallback, useMemo, useRef, useState } from "react";

import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import { StudySetSaveError } from "@/data/persistenceErrors";
import { newId } from "@/lib/id";
import { addNewFigureCards, figureCards, FIGURE_MATERIAL_TITLE } from "@/logic/figureCards";
import { FIGURE_QUESTIONS } from "@/logic/figureQuestions";
import type { MixedQuestion } from "@/logic/mixedPractice";
import { StudyAuthoringError } from "@/logic/studyAuthoring";
import { authoringStateOf, emptyManualSet, frameOf, nextSetOf } from "@/logic/studySetEditing";
import { QuickQuestionRun } from "@/pages/StudyLibrary/QuickQuestionRun";
import { useAppData } from "@/state/AppDataContext";
import { shuffled } from "./ChartSymbolDrill";

const MAX_QUESTIONS = 10;
const SAVE_FAILED = "These cards couldn't be saved. Nothing has been saved; your result is still here.";

function pick(): MixedQuestion[] {
  return shuffled(FIGURE_QUESTIONS).slice(0, MAX_QUESTIONS)
    .map((question) => ({ question, materialId: "faa-figures", materialTitle: "FAA test figures" }));
}

/** Practise reading the FAA test figures. Nothing is saved unless you add your misses to your review cards. */
export function FigureDrill() {
  const { mutate } = useAppData();
  const [run, setRun] = useState<MixedQuestion[] | null>(null);
  const [missed, setMissed] = useState<MixedQuestion[]>([]);
  const [status, setStatus] = useState<"idle" | "added" | "duplicate">("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const cards = useMemo(() => figureCards(missed), [missed]);

  const start = () => { setRun(pick()); setMissed([]); setStatus("idle"); setError(null); };
  const onFinished = useCallback((list: MixedQuestion[]) => setMissed(list), []);

  const save = async () => {
    if (busyRef.current || cards.length === 0) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const outcome = await mutate(async (repos) => {
      try {
        const known = (await repos.documents.list()).find((m) => m.title.trim().toLowerCase() === FIGURE_MATERIAL_TITLE.toLowerCase());
        const material = known ?? (await repos.documents.create({ title: FIGURE_MATERIAL_TITLE, materialType: "personal_note", topic: "aircraft_systems" }));
        const read = known ? await repos.documents.readStudySetForEdit(material.id) : null;
        const base = read ? { frame: frameOf(read.set), state: authoringStateOf(read.set) } : emptyManualSet(FIGURE_MATERIAL_TITLE);
        const { state, added } = await addNewFigureCards(base.state, cards);
        if (added > 0) {
          await repos.documents.saveStudySet({
            operationId: newId(),
            materialId: material.id,
            reason: read ? "edit" : "create",
            expected: read ? read.stored : null,
            next: nextSetOf(base.frame, state),
          });
        }
        return { ok: true as const, added };
      } catch (failure) {
        const message = failure instanceof StudyAuthoringError || failure instanceof StudySetSaveError ? failure.message : SAVE_FAILED;
        return { ok: false as const, message };
      }
    });
    busyRef.current = false;
    setBusy(false);
    if (outcome?.ok) setStatus(outcome.added > 0 ? "added" : "duplicate");
    else setError(outcome?.ok === false ? outcome.message : SAVE_FAILED);
  };

  return (
    <Card>
      <CardHeader title="FAA figure drill" />
      <CardBody>
        {run ? (
          <div className="stack stack--3">
            <div><Button size="small" variant="secondary" onClick={() => setRun(null)}>Back</Button></div>
            <QuickQuestionRun questions={run} resultLabel="FAA figure drill result" onDone={() => setRun(null)} onFinished={onFinished} />
            {missed.length > 0 ? (
              <div className="stack stack--2">
                {status === "idle" ? (
                  <Button onClick={() => void save()} disabled={busy}>
                    {busy ? "Saving…" : `Add ${cards.length} missed to your review cards`}
                  </Button>
                ) : <p className="small" role="status">{status === "added" ? "Added to your review cards" : "Already in your review cards"}</p>}
                {error ? <p className="small" role="alert">{error}</p> : null}
              </div>
            ) : null}
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
