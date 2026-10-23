import { useEffect, useRef, useState, type FormEvent } from "react";

import { Badge, Button, QuestionIcon } from "@/components/ui";
import { checkAiSubmission } from "@/logic/aiSafety";
import { useOptionalAppData } from "@/state/AppDataContext";
import { newId } from "@/lib/id";
import { askGemini, cancelAskGemini, geminiModelName, watchAskGeminiProgress, type AskGeminiHistoryTurn } from "@/services/gemini";

export interface AskGeminiPanelProps {
  materialId: string;
  relativePath?: string | null;
  context: string;
  buttonLabel?: string;
}

export function formatFlashcardContext(front: string, back: string, sourcePage?: number | null): string {
  const parts = [
    `Card front: ${front}`,
    `Card back: ${back}`,
  ];
  if (sourcePage !== null && sourcePage !== undefined) {
    parts.push(`Source page: ${sourcePage}`);
  }
  return parts.join("\n\n");
}

interface ChatTurn {
  role: "user" | "model";
  text: string;
  sourcePages?: number[];
  model?: string;
}

interface InFlightAsk {
  id: string;
  unlisten?: () => void;
}

export const GOOGLE_NOTE_STORAGE_KEY = "hfd_ask_gemini_google_note_seen";

function checkGoogleNoteSeen(): boolean {
  try {
    return localStorage.getItem(GOOGLE_NOTE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistGoogleNoteSeen(): void {
  try {
    localStorage.setItem(GOOGLE_NOTE_STORAGE_KEY, "true");
  } catch {
    // Storage unavailable or disabled
  }
}

export function AskGeminiPanel({ materialId, context, buttonLabel }: AskGeminiPanelProps) {
  const appData = useOptionalAppData();
  // Read the latest classification even if it changes while the listener starts.
  const dataRef = useRef(appData);
  dataRef.current = appData;
  const [isOpen, setIsOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [googleNoteDismissed, setGoogleNoteDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<InFlightAsk | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [answerVersion, setAnswerVersion] = useState(0);

  // Derive this from the current snapshot so opening the panel and changes to
  // the material or its credential links immediately show the same refusal.
  const data = appData?.data;
  const material = data?.materials.find((item) => item.id === materialId);
  const check = material && data
    ? checkAiSubmission(material, data.toolkit.credentials, material.filePath ? "file" : "study_context")
    : { allowed: false, reason: "This material is no longer available. Open it again before asking." };
  const refusal = check.allowed ? null : check.reason;

  const cancelInFlight = () => {
    const request = requestRef.current;
    requestRef.current = null;
    if (request) {
      request.unlisten?.();
      request.unlisten = undefined;
      void cancelAskGemini(request.id).catch(() => {});
    }
  };

  useEffect(() => () => { cancelInFlight(); }, []);

  const resetConversation = () => {
    cancelInFlight();
    setProgress(null);
    setStopped(false);
    setHistory([]);
    setError(null);
    setQuestion("");
    setIsLoading(false);
  };

  useEffect(() => {
    if (isOpen) inputRef.current?.focus({ preventScroll: true });
  }, [isOpen]);

  useEffect(() => {
    if (answerVersion === 0) return;
    const input = inputRef.current;
    input?.focus({ preventScroll: true });
    input?.scrollIntoView?.({
      block: "nearest",
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [answerVersion]);

  const showGoogleNote = !checkGoogleNoteSeen() && !googleNoteDismissed;

  useEffect(() => {
    if (isOpen && showGoogleNote) {
      persistGoogleNoteSeen();
    }
  }, [isOpen, showGoogleNote]);

  const handleAsk = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || isLoading) return;
    setStopped(false);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError("No internet right now. Your question is still here — press Ask again when you're back online.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setProgress(null);
    const request: InFlightAsk = { id: newId() };
    requestRef.current = request;

    const turnsToSend: AskGeminiHistoryTurn[] = history.slice(-6).map((turn) => ({
      role: turn.role,
      text: turn.text,
    }));

    try {
      request.unlisten = await watchAskGeminiProgress((event) => {
        if (requestRef.current === request && event.requestId === request.id) {
          setProgress(event.message);
        }
      });
      // Close/unmount can happen while the listener is being installed.
      if (requestRef.current !== request) return;
      // All PDF, card and practice-question entry points pass through this gate.
      // The native command cannot read the frontend's current material/credential
      // snapshot; never trust a path retained by an older card or quiz here.
      const data = dataRef.current?.data;
      const material = data?.materials.find((item) => item.id === materialId);
      if (!material || !data) throw new Error("This material is no longer available. Open it again before asking.");
      const check = checkAiSubmission(material, data.toolkit.credentials, material.filePath ? "file" : "study_context");
      if (!check.allowed) throw new Error(check.reason);
      const result = await askGemini({
        requestId: request.id,
        relativePath: material.filePath ?? null,
        materialId,
        context,
        question: trimmed,
        history: turnsToSend,
      });

      if (requestRef.current !== request) return;
      if (!result) return;
      setHistory((prev) => {
        const next = [
          ...prev,
          { role: "user" as const, text: trimmed },
          { role: "model" as const, text: result.answer, sourcePages: result.sourcePages, model: result.model },
        ];
        return next.slice(-6);
      });
      setQuestion("");
      setAnswerVersion((version) => version + 1);
    } catch (err: unknown) {
      if (requestRef.current !== request) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setError("No internet right now. Your question is still here — press Ask again when you're back online.");
      } else {
        const msg =
          typeof err === "string"
            ? err
            : err instanceof Error
              ? err.message
              : String(err);
        if (
          msg.toLowerCase().includes("offline") ||
          msg.toLowerCase().includes("check the internet connection") ||
          msg.toLowerCase().includes("could not reach gemini")
        ) {
          setError("No internet right now. Your question is still here — press Ask again when you're back online.");
        } else {
          setError(msg || "Gemini could not complete that request.");
        }
      }
    } finally {
      request.unlisten?.();
      request.unlisten = undefined;
      if (requestRef.current === request) {
        requestRef.current = null;
        setIsLoading(false);
        setProgress(null);
      }
    }
  };

  if (!isOpen) {
    return (
      <div style={{ marginTop: "var(--space-2)" }}>
        <Button
          type="button"
          size="small"
          variant="secondary"
          onClick={() => setIsOpen(true)}
        >
          <QuestionIcon size={14} /> {buttonLabel ?? "Why? Ask Gemini"}
        </Button>
      </div>
    );
  }

  return (
    <div
      className="stack stack--3 ask-gemini-panel"
      role="region"
      aria-label="Ask Gemini helper"
      style={{
        marginTop: "var(--space-2)",
        padding: "var(--space-3)",
        border: "1px solid var(--border-subtle, #e2e8f0)",
        borderRadius: "var(--radius-md, 8px)",
        background: "var(--bg-surface-raised, #f8fafc)",
      }}
    >
      <div className="row row--between" style={{ alignItems: "center" }}>
        <span className="small bold" style={{ color: "var(--fg-default)" }}>
          Ask Gemini
        </span>
        <div className="row row--gap-2" style={{ alignItems: "center" }}>
          {(history.length > 0 || isLoading) && (
            <Button
              type="button"
              size="small"
              variant="ghost"
              onClick={() => {
                const wasPending = requestRef.current !== null;
                resetConversation();
                setStopped(wasPending);
              }}
              aria-label="Ask another"
            >
              Ask another
            </Button>
          )}
          <Button
            type="button"
            size="small"
            variant="ghost"
            onClick={() => {
              resetConversation();
              setIsOpen(false);
            }}
            aria-label="Close Ask Gemini"
          >
            Close
          </Button>
        </div>
      </div>

      {showGoogleNote && (
        <div
          className="row row--between"
          role="note"
          style={{
            alignItems: "center",
            padding: "var(--space-2)",
            background: "var(--bg-surface, #fff)",
            border: "1px solid var(--border-subtle, #cbd5e1)",
            borderRadius: "var(--radius-sm, 4px)",
            fontSize: "0.85rem",
          }}
        >
          <span>Your question and this PDF are sent to Google.</span>
          <button
            type="button"
            className="button button--ghost button--small"
            style={{ padding: "0 var(--space-1)", minWidth: "auto", cursor: "pointer" }}
            aria-label="Dismiss Google note"
            onClick={() => {
              setGoogleNoteDismissed(true);
              persistGoogleNoteSeen();
            }}
          >
            ✕
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div className="stack stack--2" role="log" aria-label="Conversation with Gemini">
          {history.map((turn, idx) => (
            <div
              key={idx}
              className={`ask-gemini-turn ask-gemini-turn--${turn.role}`}
              style={{
                padding: "var(--space-2)",
                borderRadius: "var(--radius-sm, 4px)",
                background: turn.role === "user" ? "var(--bg-surface-active, #e2e8f0)" : "var(--bg-surface, #fff)",
              }}
            >
              <span className="tiny dim" style={{ display: "block", marginBottom: "var(--space-1)" }}>
                {turn.role === "user" ? "You" : "Gemini"}
              </span>
              <p className="small ai-copy" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {turn.text}
              </p>
              {turn.role === "model" && (
                <p className="tiny dim" style={{ margin: "var(--space-1) 0 0" }}>
                  Answered by {geminiModelName(turn.model ?? "")}
                </p>
              )}
              {turn.sourcePages && turn.sourcePages.length > 0 && (
                <div
                  className="row row--gap-1 row--wrap"
                  aria-label="Page references"
                  style={{ marginTop: "var(--space-1)" }}
                >
                  {turn.sourcePages.map((page) => (
                    <Badge key={page} tone="neutral">
                      p. {page}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {stopped && <p className="small dim" role="status">Stopped that question.</p>}

      {(refusal || error) && (
        <div
          role="alert"
          style={{
            padding: "var(--space-2)",
            color: "var(--fg-error, #b91c1c)",
            background: "var(--bg-error-subtle, #fef2f2)",
            borderRadius: "var(--radius-sm, 4px)",
            fontSize: "0.875rem",
          }}
        >
          {refusal || error}
        </div>
      )}

      <form onSubmit={handleAsk} className="stack stack--2">
        <div className="row row--gap-2" style={{ alignItems: "center" }}>
          <input
            ref={inputRef}
            type="text"
            maxLength={1000}
            className="input"
            style={{ flex: 1 }}
            placeholder="Ask a question about this..."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={isLoading || !check.allowed}
            aria-label="Ask a question"
          />
          <Button
            type="submit"
            variant="primary"
            size="small"
            disabled={isLoading || !check.allowed || !question.trim()}
          >
            {isLoading ? "Asking…" : "Ask"}
          </Button>
        </div>
        {isLoading && progress && (
          <p className="small dim" role="status" style={{ margin: 0 }}>{progress}</p>
        )}
      </form>

      <p className="tiny dim" style={{ margin: 0 }}>
        Study aid — check it against FAA guidance and your instructor.
      </p>
    </div>
  );
}
