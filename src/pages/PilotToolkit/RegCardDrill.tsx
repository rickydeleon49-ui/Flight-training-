import { useMemo, useState } from "react";

import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import { REG_CARDS, REG_CARDS_NOTE, type RegCard } from "@/logic/regCards";
import { shuffled } from "./ChartSymbolDrill";

/** Self-contained flip-card drill for regulations; no saved state. */
export function RegCardDrill() {
  const [deck, setDeck] = useState<RegCard[]>(() => [...REG_CARDS]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = deck[index]!;
  const position = useMemo(() => `Card ${index + 1} of ${deck.length}`, [index, deck.length]);

  const go = (next: number) => {
    setIndex((next + deck.length) % deck.length);
    setFlipped(false);
  };

  return (
    <Card>
      <CardHeader title="Regulation cards" />
      <CardBody>
        <p className="muted">{REG_CARDS_NOTE}</p>
        <p className="muted">Answer in your head, then flip to check. {position}.</p>
        <div className="chart-symbol-card">
          <p className="chart-symbol-note muted">{card.reg}</p>
          <h3 className="chart-symbol-name">{card.prompt}</h3>
          <div aria-live="polite" className="chart-symbol-back">
            {flipped ? (
              <>
                <p>{card.answer}</p>
                {card.whyItMatters ? <p><strong>Why it matters:</strong> {card.whyItMatters}</p> : null}
              </>
            ) : (
              <p className="muted">Flip to see the answer.</p>
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
              setDeck(shuffled(REG_CARDS));
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
