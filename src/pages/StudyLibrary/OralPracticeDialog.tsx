import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button, Checkbox, Dialog, Field, TextArea } from "@/components/ui";
import { ReadAloudButton } from "@/components/ReadAloudButton";
import type { OralScenario } from "@/data/oralScenarios";
import { coveredIndexes, oralAnswerFirstLine, type OralAnswer } from "@/data/oralAnswers";
import { formatShortDate, localDayOf, nowIso } from "@/lib/dates";
import type { StudyMaterial } from "@/domain/types";
import { ORAL_MAX_ANSWER, oralNoteDraft, oralQuestionText, type OralText } from "@/logic/oralPractice";
import { useAppData } from "@/state/AppDataContext";

type Step = "answer" | "reveal";

/**
 * Practise her saved scenarios one at a time. Once she has shown the points,
 * finishing (Done, Next scenario, Write a note or closing) keeps her answer and
 * ticks as one finished practice (ORAL-01d). "Earlier answers" lists them with
 * Delete one and Delete all. Questions and notes are still written only when
 * she presses Ask my instructor or Write a note.
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
  const { mutate, repositories, dataRevision } = useAppData();
  const navigate = useNavigate();
  const [index, setIndex] = useState(startIndex);
  const [step, setStep] = useState<Step>("answer");
  const [answer, setAnswer] = useState("");
  const [covered, setCovered] = useState<boolean[]>([]);
  const [asked, setAsked] = useState(false);
  const [asking, setAsking] = useState(false);
  const [revealedAt, setRevealedAt] = useState<string | null>(null);
  const [earlier, setEarlier] = useState<OralAnswer[]>([]);
  const [confirming, setConfirming] = useState<string | "all" | null>(null);
  const revealRef = useRef<HTMLHeadingElement>(null);

  const startAt = (at: number) => {
    setIndex(at);
    setStep("answer");
    setAnswer("");
    setCovered([]);
    setAsked(false);
    setAsking(false);
    setRevealedAt(null);
    setConfirming(null);
  };
  useEffect(() => {
    if (open) startAt(startIndex);
  }, [open, startIndex]);

  const scenario = scenarios[index];
  const scenarioId = scenario?.id;
  useEffect(() => {
    if (!open || !scenarioId || !repositories) return;
    let live = true;
    repositories.oralAnswers.list(scenarioId).then(
      (list) => {
        if (live) setEarlier(list);
      },
      () => {
        if (live) setEarlier([]);
      },
    );
    return () => {
      live = false;
    };
  }, [open, scenarioId, repositories, dataRevision]);

  /** Keep this practice once she has shown the points and written or ticked something. */
  const keepAnswer = () => {
    if (!scenario || step !== "reveal" || !revealedAt) return;
    const ticked = coveredIndexes(covered);
    if (!answer.trim() && ticked.length === 0) return;
    const input = {
      scenarioId: scenario.id,
      versionId: scenario.versionId,
      pointCount: scenario.points.length,
      answer,
      covered: ticked,
      revealedAt,
    };
    setRevealedAt(null);
    void mutate((repos) => repos.oralAnswers.finish(input));
  };
  const close = () => {
    keepAnswer();
    startAt(startIndex);
    onClose();
  };
  if (!scenario) return null;
  const points = scenario.points;

  const reveal = () => {
    setCovered(points.map(() => false));
    setRevealedAt(nowIso());
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
          <Button
            variant="primary"
            onClick={() => {
              keepAnswer();
              startAt(index + 1);
            }}
          >
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
        {open ? <div><ReadAloudButton text={scenario.prompt} /></div> : null}
        {scenario.assumptions.trim() ? (
          <p className="small muted wrap-anywhere" style={{ whiteSpace: "pre-wrap" }}>
            {scenario.assumptions}
          </p>
        ) : null}

        {step === "answer" ? (
          <div className="stack stack--1">
            <Field label="Your answer (optional)" hint="Or answer out loud to yourself, then show the points.">
              <TextArea
                rows={6}
                maxLength={ORAL_MAX_ANSWER}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
              />
            </Field>
            <p className="small muted">
              Your answer is kept when you finish, under Earlier answers. You can delete it any time.
            </p>
            <p className="tiny muted">Tip: you can speak your answer with your keyboard's microphone.</p>
            {earlier.length > 0 ? (
              <details className="oral-practice__earlier">
                <summary className="small">Earlier answers ({earlier.length})</summary>
                <ul className="stack stack--2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {earlier.map((kept) => {
                    const day = localDayOf(kept.finishedAt);
                    const date = day ? formatShortDate(day) : "Earlier";
                    const line = oralAnswerFirstLine(kept.answer) || "(answered out loud)";
                    return (
                      <li key={kept.id} className="stack stack--1">
                        <p className="small wrap-anywhere">
                          <span className="muted">{date} · </span>
                          {line}
                        </p>
                        {confirming === kept.id ? (
                          <div className="row row--wrap row--gap-2" role="group" aria-label="Delete this answer?">
                            <Button size="small" variant="danger" onClick={() => {
                              setConfirming(null);
                              void mutate((repos) => repos.oralAnswers.remove(kept.id));
                            }}>
                              Delete this answer
                            </Button>
                            <Button size="small" onClick={() => setConfirming(null)}>Keep it</Button>
                          </div>
                        ) : (
                          <div>
                            <Button size="small" onClick={() => setConfirming(kept.id)} aria-label={`Delete answer from ${date}`}>
                              Delete
                            </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {confirming === "all" ? (
                  <div className="stack stack--1" role="group" aria-label="Delete all earlier answers?">
                    <p className="small">
                      {earlier.length === 1
                        ? "Delete your earlier answer for this scenario?"
                        : `Delete all ${earlier.length} earlier answers for this scenario?`}{" "}
                      This can't be undone.
                    </p>
                    <div className="row row--wrap row--gap-2">
                      <Button size="small" variant="danger" onClick={() => {
                        setConfirming(null);
                        void mutate((repos) => repos.oralAnswers.removeAll(scenario.id));
                      }}>
                        Delete all
                      </Button>
                      <Button size="small" onClick={() => setConfirming(null)}>Keep them</Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Button size="small" onClick={() => setConfirming("all")}>
                      Delete my answers for this scenario
                    </Button>
                  </div>
                )}
              </details>
            ) : null}
          </div>
        ) : (
          <div className="oral-practice__reveal" aria-live="polite">
            {answer.trim() ? (
              <div className="stack stack--1">
                <p className="tiny muted">Your answer</p>
                <p className="small wrap-anywhere" style={{ whiteSpace: "pre-wrap" }}>
                  {answer.trim()}
                </p>
              </div>
            ) : null}
            <h3 ref={revealRef} tabIndex={-1} className="small">
              Your discussion points
            </h3>
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
