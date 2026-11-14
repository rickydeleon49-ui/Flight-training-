import { useMemo, useState } from "react";

import { Button, Card, CardBody, CardHeader, TextInput } from "@/components/ui";
import { RADIO_WORDS, RADIO_WORDS_NOTE, filterRadioWords } from "@/logic/radioWords";

/** Self-contained "Radio words" glossary drill: search the list, or quiz yourself. */
export function RadioWords() {
  const [query, setQuery] = useState("");
  const [quiz, setQuiz] = useState(false);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const matches = useMemo(() => filterRadioWords(query), [query]);
  const current = RADIO_WORDS[index % RADIO_WORDS.length]!;

  const next = () => {
    setRevealed(false);
    setIndex((value) => (value + 1) % RADIO_WORDS.length);
  };

  return (
    <Card variant="accent">
      <CardHeader
        title="Radio words"
        eyebrow="Radio"
        action={
          <Button variant="secondary" onClick={() => { setQuiz(!quiz); setRevealed(false); }}>
            {quiz ? "Back to list" : "Quiz me"}
          </Button>
        }
      />
      <CardBody>
        <p className="small">{RADIO_WORDS_NOTE}</p>
        {quiz ? (
          <div role="group" aria-label="Radio words quiz">
            <p className="small">Term {index % RADIO_WORDS.length + 1} of {RADIO_WORDS.length}</p>
            <h3 className="display">{current.term}</h3>
            {revealed ? (
              <>
                <p>{current.meaning}</p>
                {current.example ? <p className="small">{current.example}</p> : null}
              </>
            ) : (
              <Button variant="primary" onClick={() => setRevealed(true)}>Reveal</Button>
            )}
            <div>
              <Button variant="secondary" onClick={next}>Next</Button>
            </div>
          </div>
        ) : (
          <>
            <TextInput
              type="search"
              aria-label="Search radio words"
              placeholder="Search terms, e.g. roger"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <p className="small" role="status">
              {matches.length} of {RADIO_WORDS.length} terms
            </p>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {matches.map((word) => (
                <li key={word.term} style={{ marginBottom: "0.75rem" }}>
                  <strong>{word.term}</strong>: {word.meaning}
                  {word.example ? <div className="small">{word.example}</div> : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}
