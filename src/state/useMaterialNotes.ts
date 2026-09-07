import { useCallback, useEffect, useRef, useState } from "react";

import { clearDraft, readDraft, writeDraft } from "@/lib/drafts";
import { newId } from "@/lib/id";

interface NotesDraft {
  text: string;
  revision: string;
}
type Save = (text: string) => Promise<unknown | null>;

/** Mount once per material. Server refreshes must never replace active typing. */
export function useMaterialNotes(id: string, saved: string, save: Save) {
  const key = `material.${id}.notes`;
  const [draft, setDraft] = useState<NotesDraft>(() => {
    const recovered = readDraft<NotesDraft>(key);
    return recovered &&
      typeof recovered.text === "string" &&
      typeof recovered.revision === "string"
      ? recovered
      : { text: saved, revision: newId() };
  });
  const pending = useRef<NotesDraft | null>(
    draft.text !== saved ? draft : null,
  );
  const saveRef = useRef(save);
  const storedRevision = useRef(draft.revision);
  saveRef.current = save;
  const [status, setStatus] = useState(pending.current ? "saving" : "idle");
  const [recoverable, setRecoverable] = useState(true);
  const flight = useRef<Promise<void> | null>(null);

  const flush = useCallback((): Promise<void> => {
    if (flight.current) return flight.current;
    const run = async () => {
      while (pending.current) {
        const attempt = pending.current;
        const stored = readDraft<NotesDraft>(key);
        if (stored && stored.revision !== storedRevision.current) {
          pending.current = null; // A newer editor owns this material now.
          return;
        }
        let result: unknown | null;
        try {
          result = await saveRef.current(attempt.text);
        } catch {
          result = null;
        }
        if (result === null) {
          setStatus("error");
          return; // Keep the draft and offer retry; do not loop on a failed disk.
        }
        if (pending.current === attempt) {
          pending.current = null;
          // A remounted editor may already have written a newer draft.
          if (readDraft<NotesDraft>(key)?.revision === storedRevision.current)
            clearDraft(key);
          setStatus("saved");
        }
      }
    };
    flight.current = run().finally(() => {
      flight.current = null;
    });
    return flight.current;
  }, [key]);

  const change = (text: string) => {
    const next = { text, revision: newId() };
    pending.current = next;
    // Synchronous: closing the webview never has to wait for SQLite IPC.
    const kept = writeDraft(key, next);
    if (kept) storedRevision.current = next.revision;
    setRecoverable(kept);
    setDraft(next);
    setStatus("saving");
  };

  useEffect(() => {
    if (!pending.current) return;
    const timer = window.setTimeout(() => void flush(), 700);
    return () => window.clearTimeout(timer);
  }, [draft, flush]);

  useEffect(
    () => () => {
      void flush();
    },
    [flush],
  );

  return {
    notes: draft.text,
    setNotes: change,
    status,
    recoverable,
    retry: flush,
  };
}
