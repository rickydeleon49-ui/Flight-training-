import { useEffect, useRef, useState } from "react";

import { AlertIcon, Badge, Button, Dialog } from "@/components/ui";
import {
  AtomicPersistenceUnsupportedError,
  DatabaseDisabledError,
  StorageDurabilityError,
  StructuredImportSaveError,
} from "@/data/persistenceErrors";
import { newId } from "@/lib/id";
import { validatePacketText, type ImportPayload, type PacketError, type PacketPreview } from "@/logic/studyPacket";
import { DesktopOnlyError } from "@/services/documents";
import { buildImportOperation, pickStudyPacket, StudyPacketReadError } from "@/services/studyPackets";
import { useAppData } from "@/state/AppDataContext";

import { GuideBody } from "./GuideBody";

export const IMPORT_REFRESH_WARNING =
  "Imported, but the screen could not refresh. Your study packet is saved; reopen the Study Library to see it.";

export const IMPORTED_CONTENT_DISCLAIMER =
  "Imported from a study packet. Please check it against your PDF and current guidance.";

type Phase =
  | { kind: "idle" }
  | { kind: "picking" }
  | { kind: "unreadable"; message: string }
  | { kind: "invalid"; fileName: string; errors: PacketError[]; omitted: number }
  | { kind: "preview"; preview: Preview }
  | { kind: "saving"; preview: Preview }
  | { kind: "failed"; preview: Preview; message: string };

interface Preview {
  fileName: string;
  fileSha256: string;
  packet: PacketPreview;
  payload: ImportPayload;
  /** Minted once per preview; "Try again" reuses it, so a retry is idempotent. */
  materialId: string;
}

/** Fixed wording for every save failure; an unknown error is never shown raw. */
function saveFailureMessage(error: unknown): string {
  if (error instanceof StructuredImportSaveError) {
    if (error.code === "STORAGE_FAILURE") {
      return "The study packet could not be saved just now. Nothing was changed. Close any other window and try again.";
    }
    if (error.code === "IPC_TRANSPORT_ERROR") {
      return "Her Flight Deck could not finish the save. Try again; nothing is saved twice.";
    }
    if (error.code === "IDEMPOTENCY_CONFLICT") {
      return "A material with this packet's identity already exists with different content, so nothing was changed. Close this and import the file again.";
    }
    return `This study packet could not be saved. ${error.message}`;
  }
  if (error instanceof StorageDurabilityError || error instanceof DatabaseDisabledError) return error.message;
  if (error instanceof AtomicPersistenceUnsupportedError) return error.message;
  return "The study packet could not be saved. Nothing was changed. Try again.";
}

function pickFailureMessage(error: unknown): string {
  if (error instanceof StudyPacketReadError) return error.message;
  if (error instanceof DesktopOnlyError) return "Study packets can be imported in the desktop app.";
  return "The file could not be read.";
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

interface ImportStudyPacketDialogProps {
  open: boolean;
  onClose: () => void;
  /** The save succeeded. `refreshed` is false when the screens could not reload. */
  onImported: (materialId: string, refreshed: boolean) => void;
}

/**
 * Import one structured study packet as a new material (Slice B).
 *
 * Opening asks for a file first; the dialog appears only once there is a
 * file, so cancelling the picker leaves nothing behind. The packet is
 * validated and previewed in memory, and nothing is written until "Import as
 * new material". Saving is one atomic operation; a failure keeps the preview
 * and its identity so "Try again" cannot create a duplicate. Offline only.
 */
export function ImportStudyPacketDialog({ open, onClose, onImported }: ImportStudyPacketDialogProps) {
  const { mutate, clearError } = useAppData();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // Synchronous: a second click in the same frame sees it before any render.
  const savingRef = useRef(false);
  // Ignores a picker or save that finishes after the dialog was closed.
  const sessionRef = useRef(0);

  useEffect(() => {
    if (!open) {
      sessionRef.current += 1;
      savingRef.current = false;
      setPhase({ kind: "idle" });
      return;
    }
    const session = ++sessionRef.current;
    setPhase({ kind: "picking" });
    void (async () => {
      let picked;
      try {
        picked = await pickStudyPacket();
      } catch (error) {
        if (sessionRef.current === session) setPhase({ kind: "unreadable", message: pickFailureMessage(error) });
        return;
      }
      if (sessionRef.current !== session) return;
      if (picked === null) {
        onClose();
        return;
      }
      const result = validatePacketText(picked.text, { bomRemoved: picked.bomRemoved });
      if (!result.ok) {
        setPhase({ kind: "invalid", fileName: picked.fileName, errors: result.errors, omitted: result.omittedErrors });
        return;
      }
      setPhase({
        kind: "preview",
        preview: {
          fileName: picked.fileName,
          fileSha256: picked.sha256,
          packet: result.preview,
          payload: result.payload,
          materialId: newId(),
        },
      });
    })();
    // Only opening starts a pick; a new onClose identity must not re-open the picker.
  }, [open]);

  const save = async (preview: Preview) => {
    if (savingRef.current) return;
    savingRef.current = true;
    const session = sessionRef.current;
    setPhase({ kind: "saving", preview });
    let failure: unknown = null;
    let refreshed = true;
    try {
      const operation = await buildImportOperation(preview.payload, preview.materialId);
      const result = await mutate(
        async (repos) => {
          try {
            return await repos.documents.importStudyPacket(operation);
          } catch (error) {
            failure = error;
            throw error;
          }
        },
        { refreshFailureMessage: IMPORT_REFRESH_WARNING, onRefreshError: () => (refreshed = false) },
      );
      if (result === null) {
        // Shown in the dialog with "Try again", not in the page banner too.
        if (failure !== null) clearError();
        throw failure ?? new Error("The study packet could not be saved.");
      }
      if (sessionRef.current === session) onImported(result.materialId, refreshed);
    } catch (error) {
      if (sessionRef.current === session) setPhase({ kind: "failed", preview, message: saveFailureMessage(error) });
    } finally {
      savingRef.current = false;
    }
  };

  const saving = phase.kind === "saving";
  const visible = open && phase.kind !== "idle" && phase.kind !== "picking";
  const preview = phase.kind === "preview" || phase.kind === "saving" || phase.kind === "failed" ? phase.preview : null;

  const footer = preview ? (
    <>
      <Button onClick={onClose} disabled={saving}>
        Cancel
      </Button>
      <Button variant="primary" disabled={saving} onClick={() => void save(preview)}>
        {saving ? "Importing…" : phase.kind === "failed" ? "Try again" : "Add to my Study Library"}
      </Button>
    </>
  ) : (
    <Button onClick={onClose}>Close</Button>
  );

  return (
    <Dialog
      open={visible}
      onClose={onClose}
      dismissible={!saving}
      title={preview ? "Import study packet" : "This study packet can't be imported"}
      description={preview ? "Check what's inside before anything is saved." : undefined}
      footer={footer}
    >
      {phase.kind === "unreadable" ? (
        <p className="small" role="alert">
          {phase.message}
        </p>
      ) : null}

      {phase.kind === "invalid" ? (
        <div className="stack stack--3">
          <p className="small">
            <strong>{phase.fileName}</strong> isn't a study packet Her Flight Deck can read yet. Nothing was saved.
          </p>
          <ul className="import-packet__errors" role="alert">
            {phase.errors.map((error, index) => (
              <li className="small" key={`${error.code}-${error.path}-${index}`}>
                {error.message} <span className="tiny dim">({error.path})</span>
              </li>
            ))}
          </ul>
          {phase.omitted > 0 ? (
            <p className="tiny dim">{plural(phase.omitted, "more problem was", "more problems were")} not listed.</p>
          ) : null}
        </div>
      ) : null}

      {preview ? <PreviewView preview={preview} /> : null}

      {phase.kind === "failed" ? (
        <p className="field__error" role="alert" style={{ marginTop: "var(--space-4)" }}>
          {phase.message}
        </p>
      ) : null}
    </Dialog>
  );
}

function PreviewView({ preview }: { preview: Preview }) {
  const { packet } = preview;
  const { counts, data, discardedOnSave } = packet;
  const hasGuide = Boolean(data.guide && (data.guide.summary || data.guide.sections.length));
  const notSaved = [
    discardedOnSave.sourceRefs ? plural(discardedOnSave.sourceRefs, "source reference", "source references") : null,
    discardedOnSave.sourceClaims.length ? "the file's source details" : null,
    discardedOnSave.exportIds ? "the packet's item IDs" : null,
    discardedOnSave.choiceIds ? plural(discardedOnSave.choiceIds, "choice ID", "choice IDs") : null,
  ].filter(Boolean);

  return (
    <div className="stack stack--4">
      <div className="stack stack--2">
        <p className="eyebrow">Will be imported as a new material</p>
        <h3 className="ai-guide__title">{packet.title}</h3>
        <p className="tiny dim">
          From {preview.fileName} · SHA-256{" "}
          <abbr
            title={preview.fileSha256}
            aria-label={`Full SHA-256: ${preview.fileSha256}`}
            style={{ textDecoration: "none", cursor: "help" }}
          >
            {preview.fileSha256.slice(0, 12)}…
          </abbr>
        </p>
      </div>

      <div className="row row--wrap" aria-label="What this packet holds">
        {hasGuide ? (
          <Badge tone="study">
            Study guide
            {`, ${plural(counts.sections, "section", "sections")}`}
          </Badge>
        ) : null}
        {counts.flashcards ? <Badge tone="study">{plural(counts.flashcards, "flashcard", "flashcards")}</Badge> : null}
        {packet.createsPracticeTest ? (
          <Badge tone="study">{plural(counts.questions, "practice question", "practice questions")}</Badge>
        ) : null}
        {counts.choices ? <Badge tone="study">{plural(counts.choices, "choice", "choices")}</Badge> : null}
        {counts.sourceRefs ? <Badge tone="study">{plural(counts.sourceRefs, "source reference", "source references")}</Badge> : null}
      </div>

      <div className="stack stack--1 small" aria-label="Creation status">
        <p className="dim">
          {hasGuide
            ? "A study guide will be created."
            : counts.flashcards
              ? "No study guide: this packet contains cards without a guide."
              : "No study guide: this packet has no study guide or flashcards."}
        </p>
        <p className="dim">
          {packet.createsPracticeTest
            ? "A practice test will be created."
            : "No practice test: this packet has no structured questions."}
        </p>
      </div>

      <div className="ai-disclaimer" role="note">
        <AlertIcon size={16} />
        <div className="stack stack--1">
          <p className="tiny">{IMPORTED_CONTENT_DISCLAIMER}</p>
          <p className="tiny">
            Nothing is uploaded. Questions, answers, and explanations come from the packet, rather than Her Flight Deck or an AI provider.
          </p>
        </div>
      </div>

      {data.source ? (
        <section className="stack stack--2" aria-label="Source details from the file">
          <p className="eyebrow">Source details from the file (not checked)</p>
          {data.source.generator ? <p className="small">Made with: {data.source.generator}</p> : null}
          {data.source.createdAt ? <p className="small">Created: {data.source.createdAt}</p> : null}
          {data.source.note ? <p className="small ai-copy">{data.source.note}</p> : null}
        </section>
      ) : null}

      <div
        className="import-packet__preview-content stack stack--4"
        style={{
          maxHeight: "24rem",
          overflowY: "auto",
          padding: "var(--space-3)",
          border: "1px solid var(--border-subtle, #e2e8f0)",
          borderRadius: "var(--radius-md)",
        }}
        tabIndex={0}
        aria-label="Packet content preview"
      >
        {data.guide ? (
          <section className="stack stack--3" aria-label="Study guide preview">
            <p className="eyebrow">Study guide preview</p>
            {data.guide.summary ? (
              <div className="ai-guide__summary">
                <p className="small ai-copy">{data.guide.summary}</p>
              </div>
            ) : null}
            {data.guide.sections.length > 0 ? (
              <div className="stack stack--2">
                {data.guide.sections.map((section, index) => (
                  <div className="ai-guide__section" key={`${section.heading}-${index}`}>
                    <h4 className="small">{section.heading}</h4>
                    <GuideBody className="small" text={section.body} />
                  </div>
                ))}
              </div>
            ) : null}
            {data.guide.sourceNotes ? (
              <div className="stack stack--1">
                <p className="tiny dim">Source notes from guide</p>
                <p className="small ai-copy">{data.guide.sourceNotes}</p>
              </div>
            ) : null}
          </section>
        ) : null}

        {data.flashcards.length > 0 ? (
          <section className="stack stack--3" aria-label="Flashcards preview">
            <p className="eyebrow">Flashcards ({data.flashcards.length})</p>
            <div className="stack stack--2">
              {data.flashcards.map((card, idx) => (
                <div
                  key={card.id ?? idx}
                  className="stack stack--2"
                  style={{
                    padding: "var(--space-3)",
                    border: "1px solid var(--category-study-edge)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--category-study-fill)",
                  }}
                >
                  <div className="row row--between">
                    <span className="tiny dim">Card {idx + 1}{card.id ? ` · ID: ${card.id}` : ""}</span>
                    {card.sourceRefs && card.sourceRefs.length > 0 ? (
                      <div className="row row--wrap" style={{ gap: "var(--space-1)" }}>
                        {card.sourceRefs.map((ref, rIdx) => (
                          <span className="tiny dim" key={rIdx}>
                            Unverified reference: {ref.label}{ref.page != null ? ` (p. ${ref.page})` : ""}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="stack stack--1">
                    <p className="small"><strong>Front:</strong> <span className="ai-copy">{card.front}</span></p>
                    <p className="small"><strong>Back:</strong> <span className="ai-copy">{card.back}</span></p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {data.questions.length > 0 ? (
          <section className="stack stack--3" aria-label="Practice questions preview">
            <p className="eyebrow">Practice questions ({data.questions.length})</p>
            <div className="stack stack--3">
              {data.questions.map((q, idx) => (
                <div
                  key={q.id ?? idx}
                  className="stack stack--2"
                  style={{
                    padding: "var(--space-3)",
                    border: "1px solid var(--border-subtle, #e2e8f0)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--surface-card)",
                  }}
                >
                  <div className="row row--between">
                    <span className="tiny dim">Question {idx + 1}{q.id ? ` · ID: ${q.id}` : ""}</span>
                    {q.sourceRefs && q.sourceRefs.length > 0 ? (
                      <div className="row row--wrap" style={{ gap: "var(--space-1)" }}>
                        {q.sourceRefs.map((ref, rIdx) => (
                          <span className="tiny dim" key={rIdx}>
                            Unverified reference: {ref.label}{ref.page != null ? ` (p. ${ref.page})` : ""}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <p className="small ai-copy"><strong>{q.question}</strong></p>
                  <div className="stack stack--1" role="list" aria-label={`Choices for question ${idx + 1}`}>
                    {q.choices.map((choice) => {
                      const isCorrect = choice.id === q.correctChoiceId;
                      return (
                        <div
                          key={choice.id}
                          role="listitem"
                          className="row row--between small"
                          style={{
                            padding: "var(--space-2) var(--space-3)",
                            borderRadius: "var(--radius-sm)",
                            background: isCorrect ? "var(--category-complete-fill)" : "var(--surface-subtle, transparent)",
                            border: isCorrect ? "1px solid var(--category-complete-edge)" : "1px solid var(--border-subtle, #e2e8f0)",
                          }}
                        >
                          <span className="ai-copy">
                            {choice.id ? <span className="tiny dim">[{choice.id}] </span> : null}
                            {choice.text}
                          </span>
                          {isCorrect ? (
                            <Badge tone="complete">Correct answer in packet</Badge>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  {q.explanation ? (
                    <p className="tiny dim ai-copy">
                      <strong>Explanation:</strong> {q.explanation}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {packet.warnings.length ? (
        <ul className="stack stack--1 import-packet__warnings" aria-label="Things to know">
          {packet.warnings.map((warning) => (
            <li className="tiny" key={warning.code}>
              {warning.message}
            </li>
          ))}
        </ul>
      ) : null}

      {notSaved.length ? (
        <p className="tiny dim">Shown here but not saved: {notSaved.join(", ")}.</p>
      ) : null}
    </div>
  );
}
