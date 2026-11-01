import { providerCompany } from "@/services/provider";
import { isTauri } from "@/data";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button, QuestionIcon } from "@/components/ui";
import { checkAiSubmission } from "@/logic/aiSafety";
import { useOptionalAppData } from "@/state/AppDataContext";
import { newId } from "@/lib/id";
import { jumpToMaterialHeading } from "./materialJump";
import { citedPdfPage, guideTopics, isVagueQuestion, sentLine, notAnsweredMessage, pageRangeLabel, vagueQuestionReply } from "@/logic/askHelp";
import { MAX_OFFLINE_INPUT_BYTES } from "@/logic/offlineReadiness";
import { offlineContentReadiness, offlineStudyEnabled, prepareOfflineContent, type OfflineReadiness } from "@/services/offlineContent";
import { getGeminiStatus, askGemini, cancelAskGemini, geminiModelName, watchAskGeminiProgress, type AskGeminiHistoryTurn, type AskGeminiResult } from "@/services/gemini";

export interface AskGeminiPanelProps {
  initiallyOpen?: boolean;
  onClose?: () => void;
  materialId: string;
  relativePath?: string | null;
  context: string;
  buttonLabel?: string;
  initialQuestion?: string;
  evidenceMode?: boolean;
  /** Card and practice Why?: the card's or question's source page. */
  sourcePage?: number | null;
  /** What the panel explains, for the "Sent:" line. */
  contextNoun?: "card" | "question";
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
  /** This answer came from the attached PDF, so its Sources are shown. */
  evidence?: boolean;
  passages?: AskGeminiResult["passages"];
  notAnswered?: boolean;
  textNotRead?: boolean;
  model?: string;
  /** Card and practice Why?: the PDF pages whose read text was sent. */
  contextPages?: number[];
}

// "Read this PDF's text" lives under this heading in the material page.
const READ_TEXT_HEADING = "material-backup-heading";

interface InFlightAsk {
  id: string;
  unlisten?: () => void;
}

/** How often, and for how long, a background text read is looked at. */
export const AUTO_READ_POLL_MS = 1500;
export const AUTO_READ_MAX_MS = 120_000;

function readPages(readiness: OfflineReadiness | null | undefined): number | null {
  if (readiness?.state === "searchable" || readiness?.state === "partial") return readiness.pages;
  return null;
}

/**
 * Reads this PDF's text on her Mac (the same local read as "Read it now"), so
 * Ask can check its sources. Nothing is sent anywhere. Resolves with the page
 * count once read, or null when it isn't needed, isn't possible or fails;
 * then Ask behaves as it did before.
 */
export async function readPdfTextInBackground(
  materialId: string,
  onReading: () => void,
  isCurrent: () => boolean,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<number | null> {
  try {
    const [row] = await offlineContentReadiness([materialId]);
    let readiness = row?.readiness;
    if (!readiness || !isCurrent()) return null;
    if (readiness.state === "notPrepared") {
      onReading();
      readiness = (await prepareOfflineContent(materialId)).readiness;
    } else if (readiness.state === "preparing" || readiness.state === "checking") {
      onReading();
    } else {
      return readPages(readiness);
    }
    const started = Date.now();
    while ((readiness.state === "preparing" || readiness.state === "checking") && Date.now() - started < AUTO_READ_MAX_MS) {
      await wait(AUTO_READ_POLL_MS);
      if (!isCurrent()) return null;
      const [next] = await offlineContentReadiness([materialId]);
      if (!next) return null;
      readiness = next.readiness;
    }
    return readPages(readiness);
  } catch {
    return null;
  }
}

export function AskGeminiPanel({ initiallyOpen = false, onClose, materialId, context, buttonLabel, initialQuestion = "", evidenceMode = false, sourcePage = null, contextNoun = "card" }: AskGeminiPanelProps) {
  const [company, setCompany] = useState<"Google" | "Anthropic">("Google");
  const [providerReady, setProviderReady] = useState(!isTauri());
  // If the check fails she is told so (not just shown greyed-out buttons);
  // reopening the panel checks again.
  const [statusFailed, setStatusFailed] = useState(false);
  const [statusAttempt, setStatusAttempt] = useState(0);
  useEffect(() => { let mounted = true; void getGeminiStatus().then((status) => { if (mounted) { setCompany(providerCompany(status.model)); setProviderReady(true); setStatusFailed(false); } }).catch(() => { if (mounted) { setProviderReady(false); setStatusFailed(true); } }); return () => { mounted = false; }; }, [statusAttempt]);
  const helper = company === "Anthropic" ? "Claude" : "Gemini";
  const appData = useOptionalAppData();
  // Read the latest classification even if it changes while the listener starts.
  const dataRef = useRef(appData);
  dataRef.current = appData;
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [question, setQuestion] = useState(initialQuestion);
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const [hint, setHint] = useState<string | null>(null);
  const [readingText, setReadingText] = useState(false);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const readRef = useRef<Promise<unknown> | null>(null);
  const lastAnswerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<InFlightAsk | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [answerVersion, setAnswerVersion] = useState(0);

  // Derive this from the current snapshot so opening the panel and changes to
  // the material or its credential links immediately show the same refusal.
  const data = appData?.data;
  const material = data?.materials.find((item) => item.id === materialId);
  const isPdfFile = !!material?.filePath?.toLowerCase().endsWith(".pdf");
  const hasPdf = evidenceMode && isPdfFile;
  // Card and practice Why? never send the PDF: the text read on this Mac of the
  // cited page and two pages either side goes with the card instead.
  const cardText = !evidenceMode && isPdfFile;
  const topics = guideTopics(data?.aiStudySets.find((set) => set.sourceMaterialId === materialId)?.sections);
  const range = pageRangeLabel(pageCount ?? material?.lineage?.childPageCount ?? null);
  const check = material && data
    ? checkAiSubmission(material, data.toolkit.credentials, material.filePath ? "file" : "study_context", company)
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
    setQuestion(initialQuestion);
    setIsLoading(false);
    setHint(null);
  };

  const closePanel = () => {
    resetConversation();
    returnFocus.current = true;
    setIsOpen(false);
    onClose?.();
  };

  useEffect(() => {
    if (isOpen) inputRef.current?.focus({ preventScroll: true });
    else if (returnFocus.current) {
      returnFocus.current = false;
      openerRef.current?.focus({ preventScroll: true });
    }
  }, [isOpen]);

  // Opening Ask on a PDF whose text hasn't been read reads it on her Mac in
  // the background, so answers can show checked Sources.
  const readFile = isOpen && (hasPdf || cardText) && offlineStudyEnabled() && (material?.fileSize ?? 0) <= MAX_OFFLINE_INPUT_BYTES
    ? material?.filePath ?? null
    : null;
  useEffect(() => {
    if (!readFile) return;
    let current = true;
    const run = readPdfTextInBackground(materialId, () => { if (current) setReadingText(true); }, () => current)
      .then((pages) => { if (current && pages) setPageCount(pages); })
      .finally(() => { if (current) { setReadingText(false); readRef.current = null; } });
    readRef.current = run;
    return () => { current = false; readRef.current = null; setReadingText(false); };
  }, [materialId, readFile]);

  useEffect(() => {
    if (answerVersion === 0) return;
    inputRef.current?.focus({ preventScroll: true });
    lastAnswerRef.current?.scrollIntoView?.({
      block: "nearest",
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [answerVersion]);

  // Imported replacements reserve a fresh filePath. Metadata and study-context
  // edits keep the same source, so retain its conversation and pending reply.
  useEffect(() => {
    resetConversation();
  }, [materialId, material?.filePath]);

  const handleAsk = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || isLoading) return;
    setStopped(false);
    setHint(null);

    // On Ask about this PDF a bare "why?" names no part yet; ask her which,
    // without sending. A follow-up in a conversation, or a card's Why?, has context.
    if (hasPdf && history.length === 0 && isVagueQuestion(trimmed)) {
      setHint(vagueQuestionReply(topics));
      return;
    }

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
      const check = checkAiSubmission(material, data.toolkit.credentials, material.filePath ? "file" : "study_context", company);
      if (!check.allowed) throw new Error(check.reason);
      // Let a background text read finish first, so this answer can use it.
      if (readRef.current) {
        await readRef.current.catch(() => {});
        if (requestRef.current !== request) return;
      }
      const result = await askGemini({
        requestId: request.id,
        relativePath: evidenceMode || cardText ? material.filePath ?? null : null,
        materialId,
        context,
        question: trimmed,
        history: turnsToSend,
        ...(evidenceMode ? {} : { cardWhy: { citedPage: cardText ? citedPdfPage(sourcePage, material.lineage) : null } }),
      });

      if (requestRef.current !== request) return;
      if (!result) return;
      const evidence = hasPdf;
      setHistory((prev) => {
        const next = [
          ...prev,
          { role: "user" as const, text: trimmed },
          { role: "model" as const, text: result.answer, model: result.model,
            ...(!evidenceMode && cardText ? { contextPages: result.contextPages ?? [] } : {}),
            ...(evidence ? {
              evidence: true,
              passages: result.passages,
              notAnswered: result.notAnswered,
              textNotRead: result.evidenceUnavailable === "text_not_read",
            } : {}),
          },
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
          setError(msg || `${helper} could not complete that request.`);
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
          ref={openerRef}
          type="button"
          size="small"
          variant="secondary"
          onClick={() => { if (statusFailed) setStatusAttempt((n) => n + 1); setIsOpen(true); }}
        >
          <QuestionIcon size={14} /> {buttonLabel ?? `Why? Ask ${helper}`}
        </Button>
      </div>
    );
  }

  return (
    <div
      className="stack stack--3 ask-gemini-panel"
      role="region"
      aria-label={`Ask ${helper} helper`}
      onKeyDown={(event) => {
        // Inside a dialog, Escape closes the dialog itself.
        if (event.key !== "Escape" || event.currentTarget.closest("dialog")) return;
        event.preventDefault();
        event.stopPropagation();
        closePanel();
      }}
      style={{
        marginTop: "var(--space-2)",
        padding: "var(--space-3)",
        border: "1px solid var(--border-subtle, #e2e8f0)",
        borderRadius: "var(--radius-md, 8px)",
        background: "var(--bg-surface-raised, #f8fafc)",
      }}
    >
      {/* Stays at the top while answers scroll, so Ask another never moves. */}
      <div
        className="row row--between ask-gemini-panel__header"
        style={{ alignItems: "center", position: "sticky", top: 0, zIndex: 1, background: "var(--bg-surface-raised, #f8fafc)" }}
      >
        <span className="small bold" style={{ color: "var(--fg-default)" }}>
          Ask {helper}
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
            onClick={closePanel}
            aria-label={`Close Ask ${helper}`}
          >
            Close
          </Button>
        </div>
      </div>

      <p className="tiny dim" role="note" style={{ margin: 0, overflowWrap: "anywhere" }}>
        {cardText
          ? `Your question, this ${contextNoun}, the text of the pages around its source page (if read on this Mac) and recent conversation are sent to ${company}. The PDF itself is not sent.`
          : evidenceMode && material?.filePath
          ? `Your question, full PDF “${material.originalFileName || material.title}”, study context and recent conversation are sent to ${company}.`
          : `Your question, study context and recent conversation are sent to ${company}.`}
      </p>

      {history.length > 0 && (
        <div className="stack stack--2" role="log" aria-label={`Conversation with ${helper}`}>
          {history.map((turn, idx) => (
            <div
              key={idx}
              ref={idx === history.length - 1 && turn.role === "model" ? lastAnswerRef : undefined}
              className={`ask-gemini-turn ask-gemini-turn--${turn.role}`}
              style={{
                padding: "var(--space-2)",
                borderRadius: "var(--radius-sm, 4px)",
                background: turn.role === "user" ? "var(--bg-surface-active, #e2e8f0)" : "var(--bg-surface, #fff)",
              }}
            >
              <span className="tiny dim" style={{ display: "block", marginBottom: "var(--space-1)" }}>
                {turn.role === "user" ? "You" : (turn.model?.startsWith("claude-") ? "Claude" : "Gemini")}
              </span>
              <p className="small ai-copy" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {turn.role === "model" && turn.evidence && turn.notAnswered ? notAnsweredMessage(range, topics) : turn.text}
              </p>
              {turn.role === "model" && turn.notAnswered ? <p className="small">Try asking about something in this chapter, or open the material it's in.</p> : null}
              {turn.role === "model" && (
                <p className="tiny dim" style={{ margin: "var(--space-1) 0 0" }}>
                  Answered by {geminiModelName(turn.model ?? "")}
                </p>
              )}
              {turn.role === "model" && turn.contextPages && (
                <p className="tiny dim" style={{ margin: 0 }}>{sentLine(contextNoun, turn.contextPages)}</p>
              )}
              {turn.evidence && turn.role === "model" && !turn.notAnswered && (
                turn.passages && turn.passages.length > 0 ? (
                  <details className="small" style={{ marginTop: "var(--space-1)" }}>
                    <summary style={{ minHeight: 44, alignContent: "center", cursor: "pointer" }}>
                      Sources ({turn.passages.length})
                    </summary>
                    {turn.passages.map((passage, index) => (
                      <div key={index} className="stack stack--1">
                        <span className="tiny dim">Page {passage.page}</span>
                        <blockquote style={{ margin: "var(--space-1) 0 var(--space-2)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                          {passage.quote}
                        </blockquote>
                      </div>
                    ))}
                  </details>
                ) : turn.textNotRead ? (
                  <p className="small dim">
                    I couldn't check the supporting text — use{" "}
                    {document.getElementById(READ_TEXT_HEADING) ? (
                      <button type="button" className="link-button" onClick={() => jumpToMaterialHeading(READ_TEXT_HEADING)}>
                        “Read this PDF's text”
                      </button>
                    ) : "“Read this PDF's text”"}{" "}
                    first.
                  </p>
                ) : <p className="small dim">I couldn't check the supporting text.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {stopped && <p className="small dim" role="status">Stopped that question.</p>}

      {hint && <p className="small" role="status" style={{ margin: 0 }}>{hint}</p>}

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

      {statusFailed && (
        <p className="small" role="alert">Could not check your AI connection. Close and reopen this panel to try again.</p>
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
            disabled={!providerReady || isLoading || !check.allowed}
            aria-label="Ask a question"
          />
          <Button
            type="submit"
            variant="primary"
            size="small"
            disabled={!providerReady || isLoading || !check.allowed || !question.trim()}
          >
            {isLoading ? "Asking…" : "Ask"}
          </Button>
        </div>
        {readingText && (
          <p className="small row" role="status" style={{ margin: 0 }}>
            <span className="spinner" aria-hidden="true" />
            Reading this PDF on your Mac…
          </p>
        )}
        {isLoading && progress && (
          <p className="small dim" role="status" style={{ margin: 0 }}>{progress}</p>
        )}
      </form>

      <p className="tiny dim" style={{ margin: 0 }}>
        {hasPdf ? "Study aid — check the sources and your instructor." : "Study aid — check it against FAA guidance and your instructor."}
      </p>
    </div>
  );
}
