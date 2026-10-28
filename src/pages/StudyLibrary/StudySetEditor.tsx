import type { BookmarkCardSource } from "@/data/studyPageSources";
import { PdfItemLabel } from "./PdfItemLabel";
import "./StudySetEditor.css";
import { useEffect, useRef, useState } from "react";

import { Badge, Button, Checkbox, ConfirmDialog, Dialog, Field, TextArea, TextInput } from "@/components/ui";
import { StudySetSaveError } from "@/data/persistenceErrors";
import type { StudySetHistoryEntry } from "@/data/repositories/documentRepository";
import { validateNextSet, type StoredSetRow, type StudySetSaveOperation } from "@/data/studySetTransaction";
import type { AiStudySet, StudyItemOrigin, StudyMaterial } from "@/domain/types";
import { formatLocalDay } from "@/lib/dates";
import { newId } from "@/lib/id";
import {
  appendRetirements,
  prepareStudyEdit,
  StudyAuthoringError,
  type AuthoringState,
  type StudyEdit,
  type StudyItem,
} from "@/logic/studyAuthoring";
import { authoringStateOf, emptyManualSet, frameOf, itemAuthorLabel, nextSetOf } from "@/logic/studySetEditing";
import { useAppData } from "@/state/AppDataContext";

/** Which item an action is about, as she sees it on the page. */
export type ItemTarget = { kind: "summary" } | { kind: "section" | "card"; index: number };

type Action =
  | { mode: "add"; kind: "section" | "card" }
  | { mode: "edit" | "correct" | "delete"; target: ItemTarget };

/** What she sees for an item's author; nothing for generated or imported items. */
export function AuthorBadge({ origin }: { origin: unknown }) {
  const label = itemAuthorLabel(origin);
  if (!label) return null;
  return <Badge tone={origin === "instructor" ? "flight" : "berry"}>{label}</Badge>;
}

/** Her words for a failure; the draft stays where it is. */
function problemText(error: unknown): string {
  if (error instanceof StudyAuthoringError || error instanceof StudySetSaveError) return error.message;
  return "This change couldn't be saved. Nothing has been saved; your text is still here.";
}

/** A failure after which the save may or may not have happened. */
const uncertain = (error: unknown) =>
  error instanceof StudySetSaveError && (error.code === "IPC_TRANSPORT_ERROR" || error.code === "STORAGE_ERROR");

/** Where a card made from a page note points, and whether that page could be checked. */
function seedNote({ source, preview }: Omit<BookmarkCardSource, "itemId">): string {
  const page = `From page ${source.physicalPage}${source.printedLabel ? ` (printed page ${source.printedLabel})` : ""}.`;
  const checked = preview && preview.contentSha256 === source.contentSha256 && source.physicalPage <= preview.totalPages;
  return checked ? page : `${page} Position unverified: the PDF is missing or has changed.`;
}

/** The set she opened, read once when an editing dialog opens. */
interface Opened {
  stored: StoredSetRow | null;
  set: AiStudySet;
  state: AuthoringState;
}

function locate(state: AuthoringState, target: ItemTarget): StudyItem | undefined {
  if (target.kind === "summary") return state.items.find((item) => item.kind === "summary");
  return state.items.filter((item) => item.kind === target.kind)[target.index];
}

/** The same text she was shown: otherwise the page is out of date. */
function sameContent(a: AiStudySet, b: AiStudySet): boolean {
  const text = (set: AiStudySet) =>
    JSON.stringify([
      set.summary,
      set.sections.map((s) => [s.heading, s.body]),
      set.flashcards.map((c) => [c.front, c.back, c.sourcePage]),
    ]);
  return text(a) === text(b);
}

const NOUN = { summary: "summary", section: "section", card: "card" } as const;

export interface StudySetEditorProps {
  material: StudyMaterial;
  studySet: AiStudySet;
  /**
   * One explicit mounted add-card intent. The caller unmounts on close.
   */
  compact?: boolean;
  onClose?: () => void;
  bookmarkSeed?: Omit<BookmarkCardSource, "itemId">;
  createFirst?: boolean;
}

/**
 * Editing her study set (OFFLINE-03a): add, edit, correct and delete the
 * summary, sections and cards; see and restore previous versions. Every save
 * keeps the whole previous set in history first, and a change made elsewhere
 * since she opened a dialog is refused rather than overwritten.
 */
export function StudySetEditor({
  material,
  studySet,
  compact = false,
  onClose,
  bookmarkSeed,
  createFirst = false,
}: StudySetEditorProps) {
  const { mutate, repositories } = useAppData();
  const [action, setAction] = useState<Action | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // An uncertain save is retried with the same operation, never a new one.
  const pendingRef = useRef<{ key: string; operation: StudySetSaveOperation } | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [page, setPage] = useState("");
  const [fromInstructor, setFromInstructor] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const close = () => {
    if (busyRef.current) return;
    setAction(null);
    setOpened(null);
    setOpenError(null);
    setError(null);
    pendingRef.current = null;
    onClose?.();
  };

  const begin = async (next: Action) => {
    if (busyRef.current || !repositories) return;
    setAction(next);
    setOpened(null);
    setOpenError(null);
    setError(null);
    pendingRef.current = null;
    setFromInstructor(false);
    setPage("");
    try {
      const read: { stored: StoredSetRow | null; set: AiStudySet } | null =
        await repositories.documents.readStudySetForEdit(material.id) ??
        (bookmarkSeed && createFirst ? { stored: null, set: studySet } : null);
      if (!read || !sameContent(read.set, studySet)) {
        setOpenError("This study set changed since this page was shown. Close this and look at it again.");
        return;
      }
      const state = authoringStateOf(read.set);
      setOpened({ ...read, state });
      if (next.mode === "add") {
        setFields(bookmarkSeed ? [bookmarkSeed.bookmark.title, bookmarkSeed.bookmark.notes] : ["", ""]);
        if (bookmarkSeed) setPage(String(bookmarkSeed.source.physicalPage));
      } else {
        const item = locate(state, next.target);
        if (!item) {
          setOpenError("That item is no longer in this study set.");
          return;
        }
        setFields([...item.fields]);
      }
    } catch (failure) {
      setOpenError(
        failure instanceof StudyAuthoringError
          ? "Part of this study set is damaged, so it can't be edited here. Nothing has been changed."
          : "This study set couldn't be opened for editing. Try again.",
      );
    }
  };

  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (compact && repositories && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      void begin({ mode: "add", kind: "card" });
    }
  }, [compact, repositories]);

  const edit = (): StudyEdit | null => {
    if (!action || !opened) return null;
    if (action.mode === "add") {
      const pageNumber = page.trim() ? Number(page.trim()) : null;
      return {
        kind: "add",
        item: action.kind === "card"
          ? { kind: "card", fields: [fields[0] ?? "", fields[1] ?? ""], sourcePage: pageNumber }
          : { kind: "section", fields: [fields[0] ?? "", fields[1] ?? ""] },
        origin: fromInstructor ? "instructor" : "user",
      };
    }
    const item = locate(opened.state, action.target);
    if (!item) return null;
    if (action.mode === "delete") return { kind: "delete", itemId: item.itemId };
    // An instructor's correction stays hers to keep private; editing it never
    // relabels it.
    const origin: StudyItemOrigin = action.mode === "correct" || item.origin === "instructor" ? "instructor" : "user";
    return { kind: action.mode, itemId: item.itemId, fields: [...fields], origin };
  };

  const save = async () => {
    if (busyRef.current || !opened || !action) return;
    const request = edit();
    if (!request) return;
    const key = JSON.stringify([action, request, page]);
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const outcome = await mutate(async (repos) => {
      try {
        let operation = pendingRef.current?.key === key ? pendingRef.current.operation : null;
        if (!operation) {
          const plan = await prepareStudyEdit(opened.state, request);
          if (plan.next === plan.previous) return { ok: true as const };
          operation = {
            operationId: newId(),
            materialId: material.id,
            reason: opened.stored === null ? "create" : request.kind === "add" ? "edit" : request.kind,
            expected: opened.stored,
            next: nextSetOf(frameOf(opened.set), plan.next),
            ...(bookmarkSeed ? {pageSource: {...bookmarkSeed, itemId: plan.next.items.filter(i=>i.kind==="card").at(-1)!.itemId}} : {}),
          };
        }
        pendingRef.current = { key, operation };
        await repos.documents.saveStudySet(operation);
        pendingRef.current = null;
        return { ok: true as const };
      } catch (failure) {
        if (!uncertain(failure)) pendingRef.current = null;
        return { ok: false as const, message: problemText(failure) };
      }
    });
    busyRef.current = false;
    setBusy(false);
    if (outcome?.ok) close();
    else setError(outcome?.message ?? "This change couldn't be saved. Nothing has been saved; your text is still here.");
  };

  if (compact) {
    return (
      <Dialog
        open={Boolean(action)}
        onClose={close}
        title="Add a card"
        description={material.title}
        dismissible={!busy}
        className="study-set-editor--compact"
        footer={
          <>
            <Button onClick={close} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy || !opened}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="stack stack--3">
          {openError ? <p className="field__error" role="alert">{openError}</p> : null}
          {opened ? (
            <>
              <p className="tiny muted">
                New cards start fresh. Your earlier reviews are kept.
              </p>
              <Field label="Question">
                <TextArea
                  rows={2}
                  value={fields[0] ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    setFields((before) => [value, before[1] ?? ""]);
                  }}
                />
              </Field>
              <Field label="Answer">
                <TextArea
                  rows={5}
                  value={fields[1] ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    setFields((before) => [before[0] ?? "", value]);
                  }}
                />
              </Field>
              {bookmarkSeed ? <p className="tiny muted">{seedNote(bookmarkSeed)}</p> : null}
              <Field label="Source page (optional)">
                <TextInput
                  inputMode="numeric"
                  value={page}
                  onChange={(event) => setPage(event.target.value)}
                  style={{ minHeight: "44px" }}
                />
              </Field>
            </>
          ) : !openError ? (
            <p className="tiny dim" role="status">Opening…</p>
          ) : null}
          {error ? <p className="field__error" role="alert">{error}</p> : null}
        </div>
      </Dialog>
    );
  }

  const noun = action ? (action.mode === "add" ? NOUN[action.kind] : NOUN[action.target.kind]) : "item";
  const current = action && action.mode !== "add" && opened ? locate(opened.state, action.target) : undefined;
  const currentPdf = action && action.mode !== "add" ? action.target.kind === "summary" ? studySet.summaryPdfProvenance : action.target.kind === "section" ? studySet.sections[action.target.index]?.pdfProvenance : studySet.flashcards[action.target.index]?.pdfProvenance : undefined;
  const title = !action
    ? ""
    : action.mode === "add"
      ? `Add a ${noun}`
      : action.mode === "correct"
        ? `Record your instructor's correction to this ${noun}`
        : `Edit this ${noun}`;
  const labels =
    (action?.mode === "add" ? action.kind : action?.target.kind) === "card"
      ? ["Question", "Answer"]
      : (action?.mode === "add" ? action.kind : action?.target.kind) === "section"
        ? ["Heading", "Text"]
        : ["Summary"];

  const itemActions = (target: ItemTarget, origin: unknown) => (
    <div className="row row--wrap">
      <Button size="small" variant="secondary" disabled={busy} onClick={() => void begin({ mode: "edit", target })}>
        Edit
      </Button>
      {origin !== "instructor" ? (
        <Button size="small" variant="secondary" disabled={busy} onClick={() => void begin({ mode: "correct", target })}>
          Instructor's correction
        </Button>
      ) : null}
      <Button size="small" variant="danger" className="destructive-action" disabled={busy} onClick={() => void begin({ mode: "delete", target })}>
        Delete
      </Button>
    </div>
  );

  return (
    <section className="stack stack--3" aria-labelledby="edit-study-set-title">
      <div>
        <p className="eyebrow">Your changes</p>
        <h3 id="edit-study-set-title" className="ai-guide__title">Edit this study guide</h3>
        <p className="tiny muted">
          Anything you change is marked as yours. Every earlier version is kept in Previous versions, and a
          regenerated guide won't quietly bring back what you deleted or corrected.
        </p>
      </div>

      <div className="stack stack--2">
        <div className="row row--between row--wrap">
          <p className="small"><strong>Summary</strong> {studySet.summaryPdfProvenance ? <PdfItemLabel provenance={studySet.summaryPdfProvenance} origin={studySet.summaryOrigin} /> : <AuthorBadge origin={studySet.summaryOrigin ?? undefined} />}</p>
          {itemActions({ kind: "summary" }, studySet.summaryOrigin ?? undefined)}
        </div>
        {studySet.sections.map((section, index) => (
          <div className="row row--between row--wrap" key={`section-${index}`}>
            <p className="small wrap-anywhere">{section.heading} {section.pdfProvenance ? <PdfItemLabel provenance={section.pdfProvenance} origin={section.origin} /> : <AuthorBadge origin={section.origin} />}</p>
            {itemActions({ kind: "section", index }, section.origin)}
          </div>
        ))}
        <Button size="small" disabled={busy} onClick={() => void begin({ mode: "add", kind: "section" })}>
          Add a section
        </Button>
        {studySet.flashcards.map((card, index) => (
          <div className="row row--between row--wrap" key={`card-${index}`}>
            <p className="small wrap-anywhere">{card.front} {card.pdfProvenance ? <PdfItemLabel provenance={card.pdfProvenance} origin={card.origin} /> : <AuthorBadge origin={card.origin} />}</p>
            {itemActions({ kind: "card", index }, card.origin)}
          </div>
        ))}
        <Button size="small" disabled={busy} onClick={() => void begin({ mode: "add", kind: "card" })}>
          Add a card
        </Button>
      </div>

      <div>
        <Button size="small" variant="ghost" onClick={() => setShowHistory((shown) => !shown)} aria-expanded={showHistory}>
          {showHistory ? "Hide previous versions" : "Previous versions"}
        </Button>
        {showHistory ? <StudySetHistory material={material} /> : null}
      </div>

      <Dialog
        open={Boolean(action) && action?.mode !== "delete"}
        onClose={close}
        title={title}
        dismissible={!busy}
        footer={
          <>
            <Button onClick={close} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy || !opened}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="stack stack--3">
          {openError ? <p className="field__error" role="alert">{openError}</p> : null}
          {opened ? (
            <>
              {labels.map((label, index) => (
                <Field label={label} key={label}>
                  <TextArea
                    rows={label === "Heading" || label === "Question" ? 2 : 5}
                    value={fields[index] ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      setFields((before) => before.map((field, i) => (i === index ? value : field)));
                    }}
                  />
                </Field>
              ))}
              {action?.mode === "add" && action.kind === "card" ? (
                <Field label="Source page (optional)">
                  <TextInput inputMode="numeric" value={page} onChange={(event) => setPage(event.target.value)} />
                </Field>
              ) : null}
              {action?.mode === "add" ? (
                <Checkbox checked={fromInstructor} onChange={setFromInstructor} label="This came from my instructor" />
              ) : null}
              <p className="tiny muted">
                {currentPdf ? "Your PDF source stays with this edit. Compare your changes with the PDF and your instructor." : action?.mode === "correct"
                  ? "Your instructor's correction replaces this one. The original is kept in Previous versions and stays out of shared handouts unless you include corrections."
                  : current?.origin === "instructor"
                    ? "This stays marked as your instructor's correction."
                    : action?.mode === "add"
                      ? fromInstructor
                        ? "Marked as your instructor's correction."
                        : "Marked as written by you."
                      : "Once saved, this is marked as written by you. The earlier wording is kept in Previous versions."}
              </p>
            </>
          ) : !openError ? (
            <p className="tiny dim" role="status">Opening…</p>
          ) : null}
          {error ? <p className="field__error" role="alert">{error}</p> : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={action?.mode === "delete"}
        title={`Delete this ${noun}?`}
        message={
          openError ??
          error ??
          `It's kept in Previous versions, and a regenerated study guide won't bring it back without asking you.`
        }
        pending={busy}
        pendingLabel="Deleting…"
        onConfirm={() => void save()}
        onCancel={close}
      />
    </section>
  );
}

const REASON_LABELS: Record<StudySetHistoryEntry["reason"], string> = {
  edit: "Before an edit",
  correct: "Before a correction",
  delete: "Before a deletion",
  regenerate: "Before regenerating",
  import: "Before an import",
  restore: "Before restoring an earlier version",
};

function timeOf(timestamp: string): string {
  const day = formatLocalDay(timestamp) ?? "Unknown date";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? day : `${day}, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/** Earlier versions of her study set, newest first, each restorable. */
export function StudySetHistory({ material }: { material: StudyMaterial }) {
  const { mutate, repositories, dataRevision } = useAppData();
  const [entries, setEntries] = useState<StudySetHistoryEntry[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [restoring, setRestoring] = useState<StudySetHistoryEntry | null>(null);
  // The set as it was when she opened the confirmation: a change made since
  // is refused as stale rather than overwritten unseen. Undefined while read.
  const [restoreExpected, setRestoreExpected] = useState<StoredSetRow | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const operationRef = useRef<{ entryId: string; operation: StudySetSaveOperation } | null>(null);

  useEffect(() => {
    let live = true;
    setLoadFailed(false);
    repositories?.documents
      .listStudySetHistory(material.id)
      .then((list) => {
        if (live) setEntries(list);
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, [repositories, material.id, dataRevision]);

  const restore = async () => {
    const entry = restoring;
    const expected = restoreExpected;
    if (!entry?.previous || expected === undefined || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const outcome = await mutate(async (repos) => {
      try {
        let operation = operationRef.current?.entryId === entry.id ? operationRef.current.operation : null;
        if (!operation) {
          const current = expected;
          const previous = entry.previous!;
          const restoredRetired = JSON.parse(previous.retired_json);
          // What she retired since stays retired: the lists are joined.
          const retired = current
            ? appendRetirements(JSON.parse(current.retired_json), restoredRetired)
            : restoredRetired;
          const next = validateNextSet({
            title: previous.title,
            summary: previous.summary,
            summaryOrigin: previous.summary_origin,
            sections: JSON.parse(previous.sections_json),
            flashcards: JSON.parse(previous.flashcards_json),
            sourceNotes: previous.source_notes,
            provider: previous.provider,
            model: previous.model,
            retired,
          });
          operation = {
            operationId: newId(),
            materialId: material.id,
            reason: current ? "restore" : "create",
            expected: current,
            next,
          };
        }
        operationRef.current = { entryId: entry.id, operation };
        await repos.documents.saveStudySet(operation);
        operationRef.current = null;
        return { ok: true as const };
      } catch (failure) {
        if (!uncertain(failure)) operationRef.current = null;
        return {
          ok: false as const,
          message:
            failure instanceof SyntaxError || (failure instanceof StudySetSaveError && failure.code === "INVALID_ARGUMENT")
              ? "This earlier version can't be restored because part of it is damaged. Nothing has been changed."
              : problemText(failure),
        };
      }
    });
    busyRef.current = false;
    setBusy(false);
    if (outcome?.ok) setRestoring(null);
    else setError(outcome?.message ?? "This version couldn't be restored. Nothing has been changed.");
  };

  if (loadFailed) return <p className="field__error" role="alert">Previous versions couldn't be read. Try again later.</p>;
  if (!entries) return <p className="tiny dim" role="status">Reading previous versions…</p>;
  if (entries.length === 0) return <p className="tiny muted">No earlier versions yet. One is kept each time this study guide changes.</p>;

  return (
    <div className="stack stack--2" style={{ marginTop: "var(--space-2)" }}>
      <ul className="stack stack--2" aria-label="Previous versions">
        {entries.map((entry) => (
          <li className="row row--between row--wrap" key={entry.id}>
            <div>
              <p className="small">{REASON_LABELS[entry.reason] ?? "Earlier version"}</p>
              <p className="tiny muted">
                {timeOf(entry.createdAt)}
                {entry.previous ? ` · ${entry.previous.title || "Untitled"}` : " · This version is damaged"}
              </p>
            </div>
            <Button
              size="small"
              variant="secondary"
              disabled={!entry.previous || busy}
              onClick={() => {
                setError(null);
                operationRef.current = null;
                setRestoreExpected(undefined);
                setRestoring(entry);
                repositories?.documents
                  .readStoredStudySet(material.id)
                  .then(setRestoreExpected)
                  .catch(() => setError("Your study guide couldn't be read just now. Close this and try again."));
              }}
            >
              Restore
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={restoring !== null}
        title="Restore this version?"
        message={
          error ??
          "Your study guide goes back to this version. What you have now is kept in Previous versions first, so nothing is lost."
        }
        confirmLabel="Restore"
        destructive={false}
        pending={busy}
        pendingLabel="Restoring…"
        onConfirm={() => void restore()}
        onCancel={() => {
          if (!busyRef.current) setRestoring(null);
        }}
      />
    </div>
  );
}

/**
 * Start a study guide she writes herself, for a material with none. Nothing
 * from Gemini is involved, and it's labelled as hers.
 */
export function StartManualStudySet({ material }: { material: StudyMaterial }) {
  const { mutate } = useAppData();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(material.title);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const operationRef = useRef<{ key: string; operation: StudySetSaveOperation } | null>(null);

  const save = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const key = JSON.stringify([title, summary]);
    const outcome = await mutate(async (repos) => {
      try {
        let operation = operationRef.current?.key === key ? operationRef.current.operation : null;
        if (!operation) {
          const { frame, state } = emptyManualSet(title.trim() || material.title);
          const next = nextSetOf(frame, state);
          operation = {
            operationId: newId(),
            materialId: material.id,
            reason: "create",
            expected: null,
            next: { ...next, summary, summaryOrigin: summary.trim() ? "user" : null },
          };
        }
        operationRef.current = { key, operation };
        await repos.documents.saveStudySet(operation);
        operationRef.current = null;
        return { ok: true as const };
      } catch (failure) {
        if (!uncertain(failure)) operationRef.current = null;
        return { ok: false as const, message: problemText(failure) };
      }
    });
    busyRef.current = false;
    setBusy(false);
    if (outcome?.ok) setOpen(false);
    else setError(outcome?.message ?? "This study guide couldn't be saved. Nothing has been saved; your text is still here.");
  };

  return (
    <>
      <Button
        size="small"
        variant="secondary"
        onClick={() => {
          setTitle(material.title);
          setSummary("");
          setError(null);
          setOpen(true);
        }}
      >
        Write your own study guide
      </Button>
      {open ? (
        <Dialog
          open
          onClose={() => {
            if (!busyRef.current) setOpen(false);
          }}
          title="Write your own study guide"
          description="Start with a title and, if you like, a summary. You can add sections and flashcards next."
          dismissible={!busy}
          footer={
            <>
              <Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button variant="primary" onClick={() => void save()} disabled={busy}>
                {busy ? "Saving…" : "Create study guide"}
              </Button>
            </>
          }
        >
          <div className="stack stack--3">
            <Field label="Title">
              <TextInput value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <Field label="Summary (optional)">
              <TextArea rows={5} value={summary} onChange={(event) => setSummary(event.target.value)} />
            </Field>
            {error ? <p className="field__error" role="alert">{error}</p> : null}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
