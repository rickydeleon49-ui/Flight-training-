import { useEffect, useRef, useState } from "react";

import { AlertIcon, Button } from "@/components/ui";
import { ackStudyPackResult, pendingStudyPackResults, type StudyPackResult } from "@/data/studyPack";
import { resultLines } from "@/logic/studyPackText";
import { useAppData } from "@/state/AppDataContext";

/**
 * A study pack that finished while the app was closed (or before you were told)
 * is announced after the library opens. It is marked as told only after it is
 * shown. If that fails it may show again, which is safer than losing it.
 */
export function StudyPackNotice() {
  const { status } = useAppData();
  const [results, setResults] = useState<StudyPackResult[]>([]);
  const asked = useRef(false);
  const mounted = useRef(true);
  const told = useRef(new Set<string>());

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (status !== "ready" || asked.current) return;
    asked.current = true;
    void (async () => {
      try {
        const pending = await pendingStudyPackResults();
        if (pending.length === 0 || !mounted.current) return;
        setResults(pending);

      } catch {
        /* nothing to tell you; the next start asks again */
      }
    })();
  }, [status]);

  // Runs after the notice is on screen: only then is a result marked told.
  useEffect(() => {
    for (const result of results) {
      if (told.current.has(result.operationId)) continue;
      told.current.add(result.operationId);
      void ackStudyPackResult(result.operationId).catch((error) => console.warn("study pack result not marked told", error));
    }
  }, [results]);

  if (results.length === 0) return null;
  return (
    <section className="stack stack--3" aria-label="Study packs" style={{ marginBottom: "var(--space-4)" }}>
      {results.map((result) => (
        <div className="stack stack--2" key={result.operationId}>
          <div className="ai-disclaimer" role="status">
            <AlertIcon size={16} />
            <div className="stack stack--1">
              <p className="tiny">Your study pack was added.</p>
              {resultLines(result).map((line) => <p className="tiny" key={line}>{line}</p>)}
            </div>
          </div>
          <div className="row row--wrap">
            <Button size="small" variant="secondary" onClick={() => setResults((current) => current.filter((r) => r !== result))}>Dismiss</Button>
          </div>
        </div>
      ))}
    </section>
  );
}
