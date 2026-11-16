import { useMemo, useState } from "react";

import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import { DIAGRAMS } from "@/logic/diagrams";
import { REG_CARDS, REG_CARDS_NOTE, type RegCard } from "@/logic/regCards";
import { DiagramArt } from "@/pages/StudyLibrary/DiagramArt";
import { shuffled } from "./ChartSymbolDrill";

/** Self-contained flip-card drill for regulations; no saved state. */
export function RegCardDrill() {
  const [scenariosOnly, setScenariosOnly] = useState(false);
  const [deck, setDeck] = useState<RegCard[]>(() => [...REG_CARDS]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = deck[index]!;
  const position = useMemo(() => `Card ${index + 1} of ${deck.length}`, [index, deck.length]);

  const diagram = card.diagramId ? DIAGRAMS.find((entry) => entry.id === card.diagramId) : undefined;
  const pool = (only: boolean) => (only ? REG_CARDS.filter((entry) => entry.scenario) : REG_CARDS);

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
                {diagram ? <DiagramArt diagram={diagram} /> : null}
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
            aria-pressed={scenariosOnly}
            onClick={() => {
              const next = !scenariosOnly;
              setScenariosOnly(next);
              setDeck([...pool(next)]);
              setIndex(0);
              setFlipped(false);
            }}
          >
            Scenarios
          </Button>
          <Button
            onClick={() => {
              setDeck(shuffled(pool(scenariosOnly)));
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
