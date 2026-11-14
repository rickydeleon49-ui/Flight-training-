import { useMemo, useState } from "react";

import { Button, Card, CardBody, CardHeader, TextInput } from "@/components/ui";
import { ReadAloudButton } from "@/components/ReadAloudButton";
import { RADIO_DRILL, RADIO_DRILL_NOTE } from "@/logic/radioDrill";
import { RADIO_WORDS, RADIO_WORDS_NOTE, filterRadioWords } from "@/logic/radioWords";

function PracticeCalls() {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const item = RADIO_DRILL[index]!;
  const go = (step: number) => {
    setRevealed(false);
    setIndex((value) => (value + step + RADIO_DRILL.length) % RADIO_DRILL.length);
  };
  return (
    <div role="group" aria-label="Practice calls">
      <p className="small">{RADIO_DRILL_NOTE}</p>
      <p className="small">Call {index + 1} of {RADIO_DRILL.length}</p>
      <p><strong>Where you are:</strong> {item.situation}</p>
      <p><strong>Controller:</strong> {item.controllerCall}</p>
      {item.controllerCall.startsWith("(") ? null : <ReadAloudButton text={item.controllerCall} label="Hear it" />}
      {revealed ? (
        <>
          <p><strong>You say:</strong> {item.modelReply}</p>
          <p className="small">{item.tip}</p>
        </>
      ) : (
        <div><Button variant="primary" onClick={() => setRevealed(true)}>Show reply</Button></div>
      )}
      <div>
        <Button variant="secondary" onClick={() => go(-1)}>Previous</Button>{" "}
        <Button variant="secondary" onClick={() => go(1)}>Next</Button>
      </div>
    </div>
  );
}

/** Self-contained "Radio words" glossary drill: search the list, or quiz yourself. */
export function RadioWords() {
  const [query, setQuery] = useState("");
  const [quiz, setQuiz] = useState(false);
  const [mode, setMode] = useState<"words" | "calls">("words");
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
        action={mode === "calls" ? undefined : (
          <Button variant="secondary" onClick={() => { setQuiz(!quiz); setRevealed(false); }}>
            {quiz ? "Back to list" : "Quiz me"}
          </Button>
        )}
      />
      <CardBody>
        <div role="group" aria-label="Radio mode">
          <Button variant={mode === "words" ? "primary" : "secondary"} aria-pressed={mode === "words"} onClick={() => setMode("words")}>Words</Button>{" "}
          <Button variant={mode === "calls" ? "primary" : "secondary"} aria-pressed={mode === "calls"} onClick={() => setMode("calls")}>Practice calls</Button>
        </div>
        {mode === "calls" ? <PracticeCalls /> : <p className="small">{RADIO_WORDS_NOTE}</p>}
        {mode === "calls" ? null : quiz ? (
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
