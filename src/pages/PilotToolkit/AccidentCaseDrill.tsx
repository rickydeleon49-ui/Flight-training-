import { useMemo, useState } from "react";

import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import { ACCIDENT_CASES, ACCIDENT_CASES_NOTE, type AccidentCase } from "@/logic/accidentCases";
import { shuffled } from "./ChartSymbolDrill";

/** Self-contained flip-card drill on real accident summaries; no saved state. */
export function AccidentCaseDrill() {
  const [deck, setDeck] = useState<AccidentCase[]>(() => [...ACCIDENT_CASES]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = deck[index]!;
  const position = useMemo(() => `Case ${index + 1} of ${deck.length}`, [index, deck.length]);

  const go = (next: number) => {
    setIndex((next + deck.length) % deck.length);
    setFlipped(false);
  };

  return (
    <Card>
      <CardHeader title="Learn from real accidents" />
      <CardBody>
        <p className="muted">{ACCIDENT_CASES_NOTE}</p>
        <p className="muted">Think it through, then flip to read what happened. {position}.</p>
        <div className="chart-symbol-card">
          <p className="chart-symbol-note muted">
            {card.phase} · {card.aircraft} · {card.year}
          </p>
          <h3 className="chart-symbol-name">{card.question}</h3>
          <div aria-live="polite" className="chart-symbol-back">
            {flipped ? (
              <>
                <p>{card.whatHappened}</p>
                <p><strong>Probable cause:</strong> {card.probableCause}</p>
                <p><strong>Lesson:</strong> {card.lesson}</p>
                <p className="muted">NTSB case {card.ntsbNumber}</p>
              </>
            ) : (
              <p className="muted">Flip to see what happened.</p>
            )}
          </div>
        </div>
        <div className="chart-symbol-actions">
          <Button variant="primary" aria-pressed={flipped} onClick={() => setFlipped((value) => !value)}>
            {flipped ? "Hide answer" : "Flip"}
          </Button>
          <Button onClick={() => go(index - 1)}>Previous</Button>
          <Button onClick={() => go(index + 1)}>Next</Button>
          <Button
            onClick={() => {
              setDeck(shuffled(ACCIDENT_CASES));
              setIndex(0);
              setFlipped(false);
            }}
          >
            Shuffle
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
