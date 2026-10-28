import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button, Checkbox, Dialog, Field, TextArea } from "@/components/ui";
import type { StudyMaterial } from "@/domain/types";
import {
  ORAL_MAX_ANSWER,
  ORAL_MAX_ASSUMPTIONS,
  ORAL_MAX_POINTS,
  ORAL_MAX_SCENARIO,
  oralNoteDraft,
  oralQuestionText,
  oralSetupProblem,
  parseOralPoints,
  type OralText,
} from "@/logic/oralPractice";
import { useAppData } from "@/state/AppDataContext";

type Step = "setup" | "answer" | "reveal";

/**
 * Try one oral question. Everything stays in this dialog's memory: closing it
 * clears it, and nothing is written unless she presses Ask my instructor or
 * Write a note.
 */
export function OralPracticeDialog({
  material,
  open,
  onClose,
}: {
  material: StudyMaterial;
  open: boolean;
  onClose: () => void;
}) {
  const { mutate } = useAppData();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("setup");
  const [scenario, setScenario] = useState("");
  const [assumptions, setAssumptions] = useState("");
  const [pointsText, setPointsText] = useState("");
  const [answer, setAnswer] = useState("");
  const [points, setPoints] = useState<string[]>([]);
  const [covered, setCovered] = useState<boolean[]>([]);
  const [problem, setProblem] = useState<ReturnType<typeof oralSetupProblem>>(null);
  const [asked, setAsked] = useState(false);
  const [asking, setAsking] = useState(false);
  const revealRef = useRef<HTMLHeadingElement>(null);

  const close = () => {
    setStep("setup");
    setScenario("");
    setAssumptions("");
    setPointsText("");
    setAnswer("");
    setPoints([]);
    setCovered([]);
    setProblem(null);
    setAsked(false);
    setAsking(false);
    onClose();
  };

  const toAnswer = () => {
    const found = oralSetupProblem(scenario, pointsText);
    setProblem(found);
    if (found) return;
    // The points leave the form and are kept in memory only, out of the page.
    setPoints(parseOralPoints(pointsText));
    setPointsText("");
    setStep("answer");
  };

  const reveal = () => {
    setCovered(points.map(() => false));
    setStep("reveal");
    // Wait for the heading to exist, then move focus to it.
    setTimeout(() => revealRef.current?.focus(), 0);
  };

  const text = (): OralText => ({
    scenario,
    assumptions,
    answer,
    coveredPoints: points.filter((_, index) => covered[index]),
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

  const footer =
    step === "setup" ? (
      <>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={toAnswer}>
          Next
        </Button>
      </>
    ) : step === "answer" ? (
      <>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={reveal}>
          Show discussion points
        </Button>
      </>
    ) : (
      <Button variant="primary" onClick={close}>
        Done
      </Button>
    );

  return (
    <Dialog open={open} onClose={close} title="Practice an oral question" footer={footer}>
      <div className="stack stack--3">
        <p className="tiny muted">Try it — the scenario is not saved yet.</p>

        {step === "setup" ? (
          <>
            <Field
              label="Scenario"
              hint="The question as an examiner might ask it. Write it, or copy it from your instructor."
              error={problem?.field === "scenario" ? problem.message : null}
            >
              <TextArea
                rows={3}
                maxLength={ORAL_MAX_SCENARIO}
                value={scenario}
                onChange={(event) => setScenario(event.target.value)}
              />
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
              hint={`One point per line, up to ${ORAL_MAX_POINTS}. They stay hidden until you choose to show them.`}
              error={problem?.field === "points" ? problem.message : null}
            >
              <TextArea rows={4} value={pointsText} onChange={(event) => setPointsText(event.target.value)} />
            </Field>
          </>
        ) : null}

        {step === "answer" ? (
          <>
            <p className="wrap-anywhere" style={{ whiteSpace: "pre-wrap" }}>
              {scenario}
            </p>
            {assumptions.trim() ? (
              <p className="small muted wrap-anywhere" style={{ whiteSpace: "pre-wrap" }}>
                {assumptions}
              </p>
            ) : null}
            <Field label="Your answer (optional)" hint="Or answer out loud to yourself, then show the points.">
              <TextArea
                rows={6}
                maxLength={ORAL_MAX_ANSWER}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
              />
            </Field>
          </>
        ) : null}

        {step === "reveal" ? (
          <div aria-live="polite">
            <h3 ref={revealRef} tabIndex={-1} className="small">
              Your discussion points
            </h3>
            <div className="stack stack--2">
              {points.map((point, index) => (
                <Checkbox
                  key={index}
                  checked={Boolean(covered[index])}
                  strikethrough={false}
                  onChange={(checked) =>
                    setCovered((current) => current.map((value, at) => (at === index ? checked : value)))
                  }
                  label={<span className="wrap-anywhere">{point}</span>}
                  meta="I covered this"
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
        ) : null}
      </div>
    </Dialog>
  );
}
