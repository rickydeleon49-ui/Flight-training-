import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button, Checkbox, Dialog, Field, TextArea } from "@/components/ui";
import type { OralScenario } from "@/data/oralScenarios";
import type { StudyMaterial } from "@/domain/types";
import { ORAL_MAX_ANSWER, oralNoteDraft, oralQuestionText, type OralText } from "@/logic/oralPractice";
import { useAppData } from "@/state/AppDataContext";

type Step = "answer" | "reveal";

/**
 * Practise her saved scenarios one at a time. Her answer and ticks stay in
 * this dialog's memory only: closing it clears them, and nothing is written
 * unless she presses Ask my instructor or Write a note.
 */
export function OralPracticeDialog({
  material,
  scenarios,
  startIndex,
  open,
  onClose,
}: {
  material: StudyMaterial;
  scenarios: OralScenario[];
  startIndex: number;
  open: boolean;
  onClose: () => void;
}) {
  const { mutate } = useAppData();
  const navigate = useNavigate();
  const [index, setIndex] = useState(startIndex);
  const [step, setStep] = useState<Step>("answer");
  const [answer, setAnswer] = useState("");
  const [covered, setCovered] = useState<boolean[]>([]);
  const [asked, setAsked] = useState(false);
  const [asking, setAsking] = useState(false);
  const revealRef = useRef<HTMLHeadingElement>(null);

  const startAt = (at: number) => {
    setIndex(at);
    setStep("answer");
    setAnswer("");
    setCovered([]);
    setAsked(false);
    setAsking(false);
  };
  useEffect(() => {
    if (open) startAt(startIndex);
  }, [open, startIndex]);

  const scenario = scenarios[index];
  const close = () => {
    startAt(startIndex);
    onClose();
  };
  if (!scenario) return null;
  const points = scenario.points;

  const reveal = () => {
    setCovered(points.map(() => false));
    setStep("reveal");
    // Wait for the heading to exist, then move focus to it.
    setTimeout(() => revealRef.current?.focus(), 0);
  };

  const text = (): OralText => ({
    scenario: scenario.prompt,
    assumptions: scenario.assumptions,
    answer,
    coveredPoints: points.filter((_, at) => covered[at]),
  });

  const ask = async () => {
    if (asking || asked) return;
    setAsking(true);
    const result = await mutate((repos) =>
      repos.questions.create({
        text: oralQuestionText(text()),
        topic: material.topic,
        materialId: material.id,
      }),
    );
    setAsking(false);
    if (result !== null) setAsked(true);
  };

  const writeNote = () => {
    const draft = oralNoteDraft(text());
    close();
    navigate("/notes", { state: { noteDraft: draft } });
  };

  const hasNext = index < scenarios.length - 1;
  const footer =
    step === "answer" ? (
      <>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={reveal}>
          Show discussion points
        </Button>
      </>
    ) : (
      <>
        <Button variant={hasNext ? "secondary" : "primary"} onClick={close}>
          Done
        </Button>
        {hasNext ? (
          <Button variant="primary" onClick={() => startAt(index + 1)}>
            Next scenario
          </Button>
        ) : null}
      </>
    );

  return (
    <Dialog open={open} onClose={close} title="Practice an oral question" footer={footer}>
      <div className="stack stack--3">
        <p className="wrap-anywhere" style={{ whiteSpace: "pre-wrap" }}>
          {scenario.prompt}
        </p>
        {scenario.assumptions.trim() ? (
          <p className="small muted wrap-anywhere" style={{ whiteSpace: "pre-wrap" }}>
            {scenario.assumptions}
          </p>
        ) : null}

        {step === "answer" ? (
          <Field label="Your answer (optional)" hint="Or answer out loud to yourself, then show the points. Your answer is not saved.">
            <TextArea
              rows={6}
              maxLength={ORAL_MAX_ANSWER}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
          </Field>
        ) : (
          <div aria-live="polite">
            <h3 ref={revealRef} tabIndex={-1} className="small">
              Your discussion points
            </h3>
            {answer.trim() ? (
              <div className="stack stack--1">
                <p className="tiny muted">Your answer</p>
                <p className="small wrap-anywhere" style={{ whiteSpace: "pre-wrap" }}>
                  {answer.trim()}
                </p>
              </div>
            ) : null}
            <p className="tiny muted">Tick the points you covered.</p>
            <div className="stack stack--2">
              {points.map((point, at) => (
                <Checkbox
                  key={at}
                  checked={Boolean(covered[at])}
                  strikethrough={false}
                  onChange={(checked) =>
                    setCovered((current) => current.map((value, i) => (i === at ? checked : value)))
                  }
                  label={<span className="wrap-anywhere">{point}</span>}
                />
              ))}
            </div>
            <p className="tiny muted">Your own outline. Check it with your instructor and current FAA material.</p>
            <div className="row row--wrap row--gap-2">
              <Button variant="secondary" onClick={() => void ask()} disabled={asking || asked}>
                Ask my instructor
              </Button>
              <Button variant="secondary" onClick={writeNote}>
                Write a note
              </Button>
            </div>
            {asked ? (
              <p className="tiny muted" role="status">
                Added to your Questions.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </Dialog>
  );
}
