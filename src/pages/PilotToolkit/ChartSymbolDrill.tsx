import { useMemo, useState } from "react";

import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import { CHART_SOURCE_NOTE, CHART_SYMBOLS, type ChartSymbol } from "./chartSymbols";

/** Fisher-Yates shuffle returning a copy; `rand` is injectable for tests. */
export function shuffled<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function SymbolSvg({ symbol }: { symbol: ChartSymbol }) {
  const titleId = `chart-symbol-title-${symbol.id}`;
  const descId = `chart-symbol-desc-${symbol.id}`;
  return (
    <svg
      viewBox="0 0 160 100"
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      className="chart-symbol-svg"
    >
      <title id={titleId}>{`Chart symbol drawing`}</title>
      <desc id={descId}>{symbol.desc}</desc>
      {symbol.drawing}
    </svg>
  );
}

/** Self-contained flip-card drill; no saved state. */
export function ChartSymbolDrill() {
  const [deck, setDeck] = useState<ChartSymbol[]>(() => [...CHART_SYMBOLS]);
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
      <CardHeader title="Chart symbols" />
      <CardBody>
        <p className="muted">Name the symbol, then flip to check its meaning. {position}.</p>
        <div className="chart-symbol-card">
          <SymbolSvg symbol={card} />
          <div aria-live="polite" className="chart-symbol-back">
            {flipped ? (
              <>
                <h3 className="chart-symbol-name">{card.name}</h3>
                <p>{card.meaning}</p>
                <p><strong>Tip:</strong> {card.tip}</p>
              </>
            ) : (
              <p className="muted">What does this symbol mean?</p>
            )}
          </div>
          <p className="chart-symbol-note muted">{CHART_SOURCE_NOTE}</p>
        </div>
        <div className="chart-symbol-actions">
          <Button variant="primary" aria-pressed={flipped} onClick={() => setFlipped((value) => !value)}>
            {flipped ? "Hide answer" : "Flip"}
          </Button>
          <Button onClick={() => go(index - 1)}>Previous</Button>
          <Button onClick={() => go(index + 1)}>Next</Button>
          <Button
            onClick={() => {
              setDeck(shuffled(CHART_SYMBOLS));
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
