import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { ActionFormDialog, type ActionDraft } from "@/components/actions/ActionFormDialog";
import { ActionRow } from "@/components/actions/ActionRow";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  AlertIcon,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DocumentIcon,
  EmptyState,
  ExternalIcon,
  PlusIcon,
  Select,
  TextArea,
  TextInput,
} from "@/components/ui";
import {
  MATERIAL_TYPE_LABELS,
  PRIORITY_LABELS,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_OPTIONS,
  TOPIC_LABELS,
} from "@/domain/types";
import { formatLongDate, nowIso, todayIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import { actionsFor } from "@/logic/actions";
import { checkAiSubmission } from "@/logic/aiSafety";
import { checkFileForGemini } from "@/logic/aiLimits";
import { restoreDocumentCopy } from "@/logic/documentRecovery";
import {
  canHandleFiles,
  deleteDocument,
  documentErrorMessage,
  documentExists,
  formatFileSize,
  openDocument,
  pickAndImportDocument,
  removeMaterialWithFile,
  revealDocument,
} from "@/services/documents";
import {
  geminiErrorMessage,
  generatePracticeTest,
  generateStudyAid,
  getGeminiStatus,
  watchGeminiProgress,
  type GeminiStatus,
} from "@/services/gemini";
import { useAppData } from "@/state/AppDataContext";
import { useMaterialNotes } from "@/state/useMaterialNotes";
import { useActionOperations } from "@/state/useActions";

import { canSplitPdfs } from "@/services/pdf";

import { MaterialFormDialog, type MaterialDraft } from "./MaterialFormDialog";
import { IMPORTED_CONTENT_DISCLAIMER } from "./ImportStudyPacketDialog";
import { CardReviewPanel } from "./CardReviewPanel";
import { PracticeTestPanel } from "./PracticeTestPanel";
import { usePracticeMetadata } from "./usePracticeMetadata";
import { ManualSplitDialog } from "./ManualSplitDialog";
import { SplitPdfDialog } from "./SplitPdfDialog";
import { SplitLineageDetails } from "./SplitLineageDetails";
import "./studyLibrary.css";

interface ActiveGeminiOperation {
  requestId: number;
  targetMaterialId: string;
  targetFilePath: string;
  kind: "study-aid" | "practice-test";
}

export function MaterialDetail() {
  const { materialId } = useParams();
  const nextRequestIdRef = useRef(1);
  const activeGeminiOpRef = useRef<ActiveGeminiOperation | null>(null);
  const [activeGeminiOp, setActiveGeminiOp] = useState<ActiveGeminiOperation | null>(null);

  return (
    <MaterialDetailPage
      key={materialId}
      activeGeminiOp={activeGeminiOp}
      activeGeminiOpRef={activeGeminiOpRef}
      setActiveGeminiOp={setActiveGeminiOp}
      nextRequestIdRef={nextRequestIdRef}
    />
  );
}

interface MaterialDetailPageProps {
  activeGeminiOp: ActiveGeminiOperation | null;
  activeGeminiOpRef: React.MutableRefObject<ActiveGeminiOperation | null>;
  setActiveGeminiOp: React.Dispatch<React.SetStateAction<ActiveGeminiOperation | null>>;
  nextRequestIdRef: React.MutableRefObject<number>;
}

function MaterialDetailPage({
  activeGeminiOp,
  activeGeminiOpRef,
  setActiveGeminiOp,
  nextRequestIdRef,
}: MaterialDetailPageProps) {
  const { materialId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Opened from Review due: start this material's card session once. The
  // request is read once per visit and then cleared from history, so Back
  // or a reload never starts another session by itself.
  const [startCardReview] = useState(
    () => (location.state as { startCardReview?: unknown } | null)?.startCardReview === true,
  );
  useEffect(() => {
    if (startCardReview) navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, []);
  const { data, mutate, deleteWithUndo, repositories } = useAppData();
  const operations = useActionOperations();
  const today = todayIso();

  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [addingAction, setAddingAction] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");
  const [fileMissing, setFileMissing] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [splittingManually, setSplittingManually] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [restoringFile, setRestoringFile] = useState(false);
  const [gemini, setGemini] = useState<GeminiStatus | null>(null);
  // Only decides whether a new study aid can be requested; saved ones show regardless.
  const [geminiStatusFailed, setGeminiStatusFailed] = useState(false);
  const [generating, setGenerating] = useState(
    () =>
      activeGeminiOpRef.current?.targetMaterialId === materialId &&
      activeGeminiOpRef.current?.kind === "study-aid",
  );
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<string | null>(null);
  const [confirmingAi, setConfirmingAi] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const [cardRevealed, setCardRevealed] = useState(false);
  const [generatingPractice, setGeneratingPractice] = useState(
    () =>
      activeGeminiOpRef.current?.targetMaterialId === materialId &&
      activeGeminiOpRef.current?.kind === "practice-test",
  );
  const [practiceGenerationError, setPracticeGenerationError] = useState<string | null>(null);
  const [practiceGenerationProgress, setPracticeGenerationProgress] = useState<string | null>(null);
  const [confirmingPracticeTest, setConfirmingPracticeTest] = useState(false);

  // Component-wide Gemini operation lock across study-aid and practice-test generation:
  // src/services/gemini.ts listens to a single global gemini-progress event.
  // We synchronize study-aid and practice-test generation under a shared lock,
  // acquiring it synchronously before any await, disabling both Create/Regenerate
  // actions and preventing opening either confirmation flow while either runs.
  // The lock persists across material navigation in the mounted MaterialDetail root.
  // Each in-flight generation acquires a unique request ID so an older finishing
  // request never releases or clears the state of a newer request.
  const isMountedRef = useRef(true);
  const studyAidTokenRef = useRef(0);
  const practiceTestTokenRef = useRef(0);
  const activeContextRef = useRef({
    materialId: materialId ?? null,
    filePath: null as string | null,
  });

  const material = data.materials.find((candidate) => candidate.id === materialId) ?? null;

  activeContextRef.current = {
    materialId: materialId ?? null,
    filePath: material?.filePath ?? null,
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    studyAidTokenRef.current += 1;
    practiceTestTokenRef.current += 1;

    return () => {
      studyAidTokenRef.current += 1;
      practiceTestTokenRef.current += 1;
    };
  }, [materialId, material?.filePath]);

  useEffect(() => {
    setGenerating(
      activeGeminiOp?.targetMaterialId === materialId &&
        activeGeminiOp?.kind === "study-aid",
    );
    setGeneratingPractice(
      activeGeminiOp?.targetMaterialId === materialId &&
        activeGeminiOp?.kind === "practice-test",
    );
  }, [materialId, activeGeminiOp]);

  const { metadata: practiceMetadata, retry: retryPracticeMetadata } = usePracticeMetadata(
    materialId,
    repositories?.practiceSessions,
  );
  const conversionStatus = practiceMetadata.phase === "loaded" ? practiceMetadata.conversionStatus : null;
  const completedCount = practiceMetadata.phase === "loaded" ? practiceMetadata.completedCount : 0;
  const studySet = data.aiStudySets.find((candidate) => candidate.sourceMaterialId === materialId);
  const practiceTest = data.practiceTests.find(
    (candidate) => candidate.sourceMaterialId === materialId,
  );
  // Imported study packets are labelled as imported, never as Gemini output.
  const importedSet = studySet?.provider === "import";
  const importedTest = practiceTest?.provider === "import";
  const hasImported = importedSet || importedTest;

  useEffect(() => {
    void getGeminiStatus()
      .then((status) => {
        setGemini(status);
        setGeminiStatusFailed(false);
      })
      .catch(() => {
        setGemini(null);
        setGeminiStatusFailed(true);
      });
  }, []);

  const { notes, setNotes, status: notesStatus, recoverable, retry } = useMaterialNotes(
    materialId ?? "", material?.notes ?? "",
    (text) => mutate((repos) => repos.documents.update(materialId!, { notes: text })),
  );

  // A document can disappear from disk; the library says so rather than failing.
  useEffect(() => {
    let cancelled = false;
    if (!material?.filePath || !canHandleFiles()) {
      setFileMissing(false);
      return;
    }
    documentExists(material.filePath)
      .then((exists) => {
        if (!cancelled) setFileMissing(!exists);
      })
      // A check that fails outright is not a reassurance. Saying the file needs
      // looking at is closer to the truth than quietly showing it as fine.
      .catch(() => {
        if (!cancelled) setFileMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [material?.filePath]);

  if (!material) {
    return (
      <>
        <PageHeader title="Material not found" />
        <Card>
          <EmptyState
            title="That material is no longer here."
            body="It may have been removed from your library."
            action={
              <Link className="button button--secondary" to="/study">
                Back to Study Library
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  // Nothing reaches Google without passing this, and without her saying yes.
  const aiCheck = checkAiSubmission(material, data.toolkit.credentials);
  // Whether Google would read it at all. Answered here rather than after a
  // click and an upload, so an oversized handbook is a next step and not a
  // wasted wait.
  const fileForAi = checkFileForGemini(
    material.originalFileName ?? material.filePath ?? "",
    material.fileSize,
  );
  // A handbook Google will not read can still be studied a chapter at a time.
  const isPdf = (material.originalFileName ?? material.filePath ?? "")
    .toLowerCase()
    .endsWith(".pdf");
  const canSplit = Boolean(material.filePath) && isPdf && !fileMissing && canSplitPdfs();
  // Whether Gemini can be offered this file at all; a missing file only disables
  // the button, so a file that reappears does not need a reload.
  const canOfferGemini = Boolean(gemini?.configured) && aiCheck.allowed && fileForAi.ready;
  // Why a new or replacement study aid cannot be requested right now. This
  // never hides what is already saved: reading a saved guide, flipping cards
  // and taking a saved practice test need no connection and send nothing.
  const generationNotice: GenerationNotice | null = !aiCheck.allowed
    ? { text: aiCheck.reason }
    : !fileForAi.ready
      ? { text: fileForAi.reason, split: canSplit }
      : fileMissing
        ? { text: "This study file is missing from app storage. Restore or re-attach the file to regenerate or create study aids from it." }
        : geminiStatusFailed
          ? { text: "Could not check the Gemini connection, so new study aids cannot be requested right now. Anything already saved stays available." }
          : gemini === null
            ? { text: "Checking the Gemini connection…" }
            : !gemini.configured
              ? { text: "Connect the free Gemini API in Settings to create or regenerate study aids from this document. Anything already saved stays available.", settings: true }
              : null;
  const isGeneratingAny = Boolean(
    activeGeminiOp ||
      activeGeminiOpRef.current ||
      generating ||
      generatingPractice,
  );

  const relatedActions = actionsFor(data.actions, "material", material.id);
  const questions = data.questions.filter((question) => question.materialId === material.id);
  const goal = data.goals.find((candidate) => candidate.id === material.goalId);
  const event = data.events.find((candidate) => candidate.id === material.eventId);

  const saveMaterial = async (draft: MaterialDraft) => {
    const { notes: _notes, ...metadata } = draft;
    const result = await mutate((repos) => repos.documents.update(material.id, metadata));
    if (result === null) return false;
    return true;
  };

  const addQuestion = async () => {
    const text = newQuestion.trim();
    if (!text) return;
    const result = await mutate((repos) =>
      repos.questions.create({ text, topic: material.topic, materialId: material.id }),
    );
    if (result === null) return;
    setNewQuestion("");
  };

  const open = async () => {
    if (!material.filePath) return;
    setOpenError(null);
    try {
      await openDocument(material.filePath);
    } catch (error) {
      setOpenError(documentErrorMessage(error, "That file could not be opened."));
    }
  };

  const revealStoredFile = async () => {
    if (!material.filePath) return;
    try {
      await revealDocument(material.filePath);
    } catch (error) {
      setOpenError(documentErrorMessage(error, "The stored file could not be shown."));
    }
  };

  const restoreFile = async () => {
    setOpenError(null);
    setRestoringFile(true);
    try {
      const restored = await restoreDocumentCopy(
        material.id,
        pickAndImportDocument,
        async (imported) => {
          const saved = await mutate((repos) =>
            repos.documents.update(material.id, {
              filePath: imported.relativePath,
              originalFileName: imported.originalFileName,
              fileSize: imported.fileSize,
            }),
          );
          if (saved === null) throw new Error("That file could not be saved to your library.");
        },
        deleteDocument,
      );
      if (restored) setFileMissing(false);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "That file could not be restored.");
    } finally {
      setRestoringFile(false);
    }
  };

  const createStudyAid = async () => {
    if (!material?.filePath || !checkAiSubmission(material, data.toolkit.credentials).allowed) {
      return;
    }
    const targetMaterialId = material.id;
    const targetFilePath = material.filePath;

    // 1. Synchronously acquire the shared component-wide lock before any await
    if (activeGeminiOpRef.current !== null) {
      return;
    }
    const requestId = ++nextRequestIdRef.current;
    const operation: ActiveGeminiOperation = {
      requestId,
      targetMaterialId,
      targetFilePath,
      kind: "study-aid",
    };
    activeGeminiOpRef.current = operation;
    setActiveGeminiOp(operation);
    const targetToken = ++studyAidTokenRef.current;

    setGenerating(true);
    setGenerationError(null);
    setGenerationProgress(null);
    let stopWatching = () => {};

    try {
      if (fileMissing) {
        setGenerationError(
          "This study file is missing from app storage. Restore or re-attach the file before generating.",
        );
        return;
      }
      if (canHandleFiles()) {
        let exists = false;
        try {
          exists = await documentExists(targetFilePath);
        } catch {
          exists = false;
        }
        if (!exists) {
          setFileMissing(true);
          setGenerationError(
            "This study file is missing from app storage. Restore or re-attach the file before generating.",
          );
          return;
        }
      }

      if (
        !isMountedRef.current ||
        studyAidTokenRef.current !== targetToken ||
        activeContextRef.current.materialId !== targetMaterialId ||
        activeContextRef.current.filePath !== targetFilePath
      ) {
        return;
      }

      try {
        stopWatching = await watchGeminiProgress((msg) => {
          if (
            isMountedRef.current &&
            activeContextRef.current.materialId === targetMaterialId
          ) {
            setGenerationProgress(msg);
          }
        });
      } catch {
        // Non-fatal if watcher fails, continue generation
      }

      const generated = await generateStudyAid(targetFilePath);

      // Stale context guard: ensure token and active material/file context still match
      if (
        !isMountedRef.current ||
        studyAidTokenRef.current !== targetToken ||
        activeContextRef.current.materialId !== targetMaterialId ||
        activeContextRef.current.filePath !== targetFilePath
      ) {
        return;
      }

      const saved = await mutate((repos) =>
        repos.documents.saveAiStudySet({
          sourceMaterialId: targetMaterialId,
          title: generated.title,
          summary: generated.summary,
          sections: generated.sections,
          flashcards: generated.flashcards,
          sourceNotes: generated.sourceNotes,
          model: generated.model,
        }),
      );
      if (saved === null) return;
      if (
        isMountedRef.current &&
        activeContextRef.current.materialId === targetMaterialId
      ) {
        setCardIndex(0);
        setCardRevealed(false);
      }
    } catch (error) {
      if (
        isMountedRef.current &&
        studyAidTokenRef.current === targetToken &&
        activeContextRef.current.materialId === targetMaterialId &&
        activeContextRef.current.filePath === targetFilePath
      ) {
        setGenerationError(geminiErrorMessage(error));
      }
    } finally {
      stopWatching();
      // A finishing request only releases the shared lock if it still owns it
      if (activeGeminiOpRef.current?.requestId === requestId) {
        activeGeminiOpRef.current = null;
        setActiveGeminiOp(null);
      }
      if (
        isMountedRef.current &&
        activeContextRef.current.materialId === targetMaterialId
      ) {
        setGenerationProgress(null);
        setGenerating(false);
      }
    }
  };

  const createPracticeTest = async () => {
    if (!material?.filePath || !checkAiSubmission(material, data.toolkit.credentials).allowed) {
      return;
    }
    const targetMaterialId = material.id;
    const targetFilePath = material.filePath;

    // 1. Synchronously acquire the shared component-wide lock before any await
    if (activeGeminiOpRef.current !== null) {
      return;
    }
    const requestId = ++nextRequestIdRef.current;
    const operation: ActiveGeminiOperation = {
      requestId,
      targetMaterialId,
      targetFilePath,
      kind: "practice-test",
    };
    activeGeminiOpRef.current = operation;
    setActiveGeminiOp(operation);
    const targetToken = ++practiceTestTokenRef.current;

    setGeneratingPractice(true);
    setPracticeGenerationError(null);
    setPracticeGenerationProgress(null);
    let stopWatching = () => {};

    try {
      if (fileMissing) {
        setPracticeGenerationError(
          "This study file is missing from app storage. Restore or re-attach the file before generating.",
        );
        return;
      }
      if (canHandleFiles()) {
        let exists = false;
        try {
          exists = await documentExists(targetFilePath);
        } catch {
          exists = false;
        }
        if (!exists) {
          setFileMissing(true);
          setPracticeGenerationError(
            "This study file is missing from app storage. Restore or re-attach the file before generating.",
          );
          return;
        }
      }

      if (
        !isMountedRef.current ||
        practiceTestTokenRef.current !== targetToken ||
        activeContextRef.current.materialId !== targetMaterialId ||
        activeContextRef.current.filePath !== targetFilePath
      ) {
        return;
      }

      try {
        stopWatching = await watchGeminiProgress((msg) => {
          if (
            isMountedRef.current &&
            activeContextRef.current.materialId === targetMaterialId
          ) {
            setPracticeGenerationProgress(msg);
          }
        });
      } catch {
        // Non-fatal if watcher fails, continue generation
      }

      const generated = await generatePracticeTest(targetFilePath);

      // Stale context guard: ensure token and active material/file context still match
      if (
        !isMountedRef.current ||
        practiceTestTokenRef.current !== targetToken ||
        activeContextRef.current.materialId !== targetMaterialId ||
        activeContextRef.current.filePath !== targetFilePath
      ) {
        return;
      }

      const saved = await mutate((repos) =>
        repos.documents.savePracticeTest({
          sourceMaterialId: targetMaterialId,
          title: generated.title,
          questions: generated.questions,
          model: generated.model,
        }),
      );
      if (saved === null) return;
    } catch (error) {
      if (
        isMountedRef.current &&
        practiceTestTokenRef.current === targetToken &&
        activeContextRef.current.materialId === targetMaterialId &&
        activeContextRef.current.filePath === targetFilePath
      ) {
        setPracticeGenerationError(geminiErrorMessage(error));
      }
    } finally {
      stopWatching();
      // A finishing request only releases the shared lock if it still owns it
      if (activeGeminiOpRef.current?.requestId === requestId) {
        activeGeminiOpRef.current = null;
        setActiveGeminiOp(null);
      }
      if (
        isMountedRef.current &&
        activeContextRef.current.materialId === targetMaterialId
      ) {
        setPracticeGenerationProgress(null);
        setGeneratingPractice(false);
      }
    }
  };

  return (
    <>
      <PageHeader
        title={material.title}
        subtitle={`${MATERIAL_TYPE_LABELS[material.materialType]} · ${TOPIC_LABELS[material.topic]}`}
        action={
          <div className="row">
            <Link className="button button--ghost" to="/study">
              Back
            </Link>
            <Button onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          </div>
        }
      />

      <div className="detail">
        <div className="detail__column">
          {material.filePath ? (
            <Card>
              <CardBody>
                <div className={`file-row${fileMissing ? " file-row--missing" : ""}`}>
                  {fileMissing ? <AlertIcon /> : <DocumentIcon />}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p className="small truncate">{material.originalFileName}</p>
                    <p className="tiny">
                      {fileMissing
                        ? "This file is no longer in your library storage."
                        : formatFileSize(material.fileSize)}
                    </p>
                  </div>
                  {canSplit ? (
                    <Button onClick={() => setSplitting(true)}>Split automatically</Button>
                  ) : null}
                  {canSplit ? (
                    <Button variant="secondary" onClick={() => setSplittingManually(true)}>
                      Take out a chapter
                    </Button>
                  ) : null}
                  {!fileMissing && canHandleFiles() ? (
                    <Button onClick={open}>
                      <ExternalIcon size={15} /> Open
                    </Button>
                  ) : null}
                </div>
                {fileMissing ? (
                  <div className="row row--between row--wrap" style={{ marginTop: "var(--space-3)" }}>
                    <p className="tiny muted">
                      Everything you wrote is still here. Choose the original or a replacement
                      copy; it will be copied back inside the desktop app.
                    </p>
                    <Button
                      size="small"
                      variant="primary"
                      disabled={restoringFile}
                      onClick={() => void restoreFile()}
                    >
                      {restoringFile ? "Restoring…" : "Find and restore file"}
                    </Button>
                  </div>
                ) : null}
                {openError ? (
                  <div className="row row--between row--wrap" style={{ marginTop: "var(--space-3)" }}>
                    <p className="field__error">{openError}</p>
                    {!fileMissing ? (
                      <Button size="small" onClick={() => void revealStoredFile()}>
                        Show in Finder or File Explorer
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                <SplitLineageDetails material={material} materials={data.materials} />
              </CardBody>
            </Card>
          ) : null}

          {material.filePath || studySet ? (
            <Card>
              <CardHeader
                title={importedSet ? "Imported study packet" : "Gemini study assistant"}
                eyebrow={
                  importedSet
                    ? "Imported from a file you selected"
                    : studySet
                      ? "Saved on this computer"
                      : "Guide and flashcards"
                }
                action={
                  canOfferGemini ? (
                    <Button
                      size="small"
                      variant={studySet ? "secondary" : "primary"}
                      disabled={isGeneratingAny || fileMissing}
                      onClick={() => {
                        if (!isGeneratingAny && !activeGeminiOpRef.current) setConfirmingAi(true);
                      }}
                    >
                      {generating ? "Reading document…" : studySet ? "Regenerate" : "Create study aid"}
                    </Button>
                  ) : undefined
                }
              />
              <CardBody>
                {generationNotice ? (
                  <GenerationNoticeView notice={generationNotice} onSplit={() => setSplitting(true)} />
                ) : null}
                {generating ? (
                  <div className="ai-working" role="status">
                    <span className="ai-working__dot" aria-hidden="true" />
                    <div>
                      <p className="small strong">Gemini is reviewing this document</p>
                      <p className="tiny dim">
                        {generationProgress ??
                          "Large illustrated PDFs can take a little longer, and if Google\u2019s servers are busy this waits and tries again on its own."}
                      </p>
                    </div>
                  </div>
                ) : null}
                {studySet ? (
                  <div className="stack stack--5">
                    <div className="ai-disclaimer">
                      <AlertIcon size={16} />
                      <p className="tiny">
                        {importedSet
                          ? IMPORTED_CONTENT_DISCLAIMER
                          : "AI-generated study aid. Verify everything against the source, current FAA material, aircraft documents, and your instructor before using it."}
                      </p>
                    </div>

                    <section className="stack stack--3" aria-labelledby="ai-guide-title">
                      <div>
                        <p className="eyebrow">Study guide</p>
                        <h3 id="ai-guide-title" className="ai-guide__title">{studySet.title}</h3>
                      </div>
                      <p className="small ai-copy">{studySet.summary}</p>
                      {studySet.sections.map((section, index) => (
                        <div className="ai-guide__section" key={`${section.heading}-${index}`}>
                          <h4>{section.heading}</h4>
                          <p className="small ai-copy">{section.body}</p>
                        </div>
                      ))}
                      {studySet.sourceNotes ? (
                        <p className="tiny dim ai-copy">{studySet.sourceNotes}</p>
                      ) : null}
                    </section>

                    {studySet.flashcards.length > 0 ? (
                      <section className="stack stack--3" aria-labelledby="flashcards-title">
                        <div className="row row--between">
                          <div>
                            <p className="eyebrow">Flashcards</p>
                            <h3 id="flashcards-title" className="ai-guide__title">
                              Card {cardIndex + 1} of {studySet.flashcards.length}
                            </h3>
                          </div>
                          <Badge tone="study">
                            {studySet.flashcards[cardIndex]?.sourcePage
                              ? `Source p. ${studySet.flashcards[cardIndex]?.sourcePage}`
                              : "Check source"}
                          </Badge>
                        </div>
                        <button
                          className={`flashcard${cardRevealed ? " is-revealed" : ""}`}
                          type="button"
                          onClick={() => setCardRevealed((current) => !current)}
                          aria-label={cardRevealed ? "Hide flashcard answer" : "Reveal flashcard answer"}
                        >
                          <span className="tiny dim">{cardRevealed ? "Answer" : "Question"}</span>
                          <span>{cardRevealed ? studySet.flashcards[cardIndex]?.back : studySet.flashcards[cardIndex]?.front}</span>
                          <span className="tiny dim">Click to {cardRevealed ? "see the question" : "reveal the answer"}</span>
                        </button>
                        <div className="row row--between">
                          <Button
                            size="small"
                            disabled={cardIndex === 0}
                            onClick={() => { setCardIndex((index) => index - 1); setCardRevealed(false); }}
                          >
                            Previous
                          </Button>
                          <Button
                            size="small"
                            disabled={cardIndex >= studySet.flashcards.length - 1}
                            onClick={() => { setCardIndex((index) => index + 1); setCardRevealed(false); }}
                          >
                            Next
                          </Button>
                        </div>
                      </section>
                    ) : null}

                    <CardReviewPanel
                      materialId={material.id}
                      materialTitle={material.title}
                      repository={repositories?.cardReviews}
                      contentKey={studySet.updatedAt}
                      autoStart={startCardReview}
                      browseCard={
                        studySet.flashcards[cardIndex]
                          ? {
                              index: cardIndex,
                              front: studySet.flashcards[cardIndex]!.front,
                              back: studySet.flashcards[cardIndex]!.back,
                            }
                          : null
                      }
                    />
                  </div>
                ) : canOfferGemini && !fileMissing && !generating && !hasImported ? (
                  <p className="small muted">
                    Gemini will read only this file and create a source-based study guide plus
                    10–20 flashcards. The result will be saved locally with your other data.
                  </p>
                ) : null}

                {generationError ? (
                  <p className="field__error" role="alert" style={{ marginTop: "var(--space-3)" }}>
                    {generationError}
                  </p>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {practiceTest || (material.filePath && canOfferGemini) ? (
            <Card>
              <CardHeader
                title="Practice test"
                eyebrow={
                  importedTest
                    ? "Imported study packet"
                    : practiceTest
                      ? "Saved on this computer"
                      : "Optional, from this document"
                }
                action={
                  canOfferGemini ? (
                  <Button
                    size="small"
                    variant={practiceTest ? "secondary" : "primary"}
                    disabled={isGeneratingAny || fileMissing}
                    onClick={() => {
                      if (!isGeneratingAny && !activeGeminiOpRef.current) setConfirmingPracticeTest(true);
                    }}
                  >
                    {generatingPractice
                      ? "Reading document…"
                      : practiceTest
                        ? "Regenerate"
                        : "Create practice test"}
                  </Button>
                  ) : undefined
                }
              />
              <CardBody>
                {generationNotice && practiceTest ? (
                  <GenerationNoticeView notice={generationNotice} onSplit={() => setSplitting(true)} />
                ) : null}
                {generatingPractice ? (
                  <div className="ai-working" role="status">
                    <span className="ai-working__dot" aria-hidden="true" />
                    <div>
                      <p className="small strong">Gemini is writing practice questions</p>
                      <p className="tiny dim">
                        {practiceGenerationProgress ??
                          "Large illustrated PDFs can take a little longer, and if Google’s servers are busy this waits and tries again on its own."}
                      </p>
                    </div>
                  </div>
                ) : null}
                {practiceMetadata.phase === "failed" ? (
                  <div className="stack stack--3" style={{ marginBottom: "var(--space-3)" }}>
                    <div className="ai-disclaimer" role="alert">
                      <AlertIcon size={16} />
                      <p className="tiny">
                        Practice status couldn’t be checked just now, so your history count isn’t shown. Your saved study guide and cards are still here.
                      </p>
                    </div>
                    <div className="row row--wrap">
                      <Button size="small" variant="secondary" onClick={retryPracticeMetadata}>
                        Retry practice status
                      </Button>
                      <Link
                        to={`/study/history/${encodeURIComponent(material.id)}`}
                        className="button button--secondary button--small"
                      >
                        View practice history
                      </Link>
                    </div>
                  </div>
                ) : null}
                {conversionStatus?.legacyError === "MALFORMED_QUESTION" ? (
                  <div className="stack stack--3">
                    <div className="ai-disclaimer" role="alert">
                      <AlertIcon size={16} />
                      <p className="tiny">
                        This practice test contains malformed questions from an earlier version and cannot be started. Please regenerate the practice test.
                      </p>
                    </div>
                    {completedCount > 0 ? (
                      <div>
                        <Link
                          to={`/study/history/${encodeURIComponent(material.id)}`}
                          className="button button--secondary button--small"
                        >
                          View practice history ({completedCount})
                        </Link>
                      </div>
                    ) : null}
                  </div>
                ) : practiceTest ? (
                  <div className="stack stack--4">
                    <div className="row row--between" style={{ alignItems: "center" }}>
                      <div className="ai-disclaimer" style={{ flex: 1, margin: 0 }}>
                        <AlertIcon size={16} />
                        <p className="tiny">
                          {importedTest
                            ? IMPORTED_CONTENT_DISCLAIMER
                            : "AI-generated practice test. Verify every answer against the source, current FAA material, aircraft documents, and your instructor before relying on it."}
                        </p>
                      </div>
                      {completedCount > 0 ? (
                        <Link
                          to={`/study/history/${encodeURIComponent(material.id)}`}
                          className="button button--secondary button--small"
                          style={{ marginLeft: "var(--space-3)", flexShrink: 0 }}
                        >
                          View practice history ({completedCount})
                        </Link>
                      ) : null}
                    </div>
                    <PracticeTestPanel practiceTest={practiceTest} materialId={material.id} key={practiceTest.updatedAt} />
                  </div>
                ) : !generatingPractice && !hasImported ? (
                  <p className="small muted">
                    Gemini will read only this file and create a multiple-choice practice test with
                    explanations. The result will be saved locally with your other data.
                  </p>
                ) : null}

                {practiceGenerationError ? (
                  <p className="field__error" role="alert" style={{ marginTop: "var(--space-3)" }}>
                    {practiceGenerationError}
                  </p>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Personal notes"
              action={
                notesStatus === "idle" ? null : (
                  <span
                    className="tiny"
                    role="status"
                    style={{
                      color:
                        notesStatus === "saved"
                          ? "var(--status-complete)"
                          : "var(--text-tertiary)",
                    }}
                  >
                    {notesStatus === "saving" ? "Saving…" : notesStatus === "error" ? "Save failed" : "Saved"}
                  </span>
                )
              }
            />
            <CardBody>
              <TextArea
                rows={6}
                value={notes}
                aria-label="Personal notes"
                placeholder="What matters in this material, and what you want to remember."
                onChange={(e) => setNotes(e.target.value)}
              />
              {!recoverable && notesStatus !== "saved" ? (
                <p role="alert">Draft recovery is unavailable. Keep this window open until your notes show Saved.</p>
              ) : null}
              {notesStatus === "error" ? (
                <p role="alert">Your notes could not be saved. {recoverable ? "A draft is kept on this computer." : "Keep this window open."} <Button onClick={() => void retry()}>Retry save</Button></p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Next actions"
              action={
                <Button size="small" onClick={() => setAddingAction(true)}>
                  <PlusIcon size={14} /> Add
                </Button>
              }
            />
            <CardBody flush>
              {relatedActions.length === 0 ? (
                <p className="small muted" style={{ padding: "0 var(--space-5) var(--space-5)" }}>
                  What should you do with this material? &ldquo;Review pages 4&ndash;8 before
                  Saturday&rdquo; is more useful than &ldquo;study&rdquo;.
                </p>
              ) : (
                <div style={{ paddingBottom: "var(--space-3)" }}>
                  {relatedActions.map((action) => (
                    <ActionRow
                      key={action.id}
                      action={action}
                      today={today}
                      onToggle={operations.toggle}
                      onDelete={operations.remove}
                    />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Questions from this material" />
            <CardBody>
              <div className="stack stack--3">
                {questions.map((question) => (
                  <div className="row row--between" key={question.id}>
                    <span className="small wrap-anywhere">{question.text}</span>
                    <Badge>{question.status === "answered" ? "Answered" : "To ask"}</Badge>
                  </div>
                ))}
                <div className="inline-add">
                  <TextInput
                    value={newQuestion}
                    aria-label="New question"
                    placeholder="Something to ask your instructor"
                    onChange={(e) => setNewQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addQuestion();
                      }
                    }}
                  />
                  <Button onClick={addQuestion} disabled={!newQuestion.trim()}>
                    Add
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="detail__column">
          <Card>
            <CardHeader title="Review status" />
            <CardBody>
              <div className="stack stack--4">
                <Select
                  aria-label="Review status"
                  options={REVIEW_STATUS_OPTIONS}
                  value={material.reviewStatus}
                  onChange={(value) =>
                    mutate((repos) => repos.documents.update(material.id, { reviewStatus: value }))
                  }
                />
                <Button
                  block
                  onClick={() =>
                    mutate((repos) =>
                      repos.documents.update(material.id, { lastReviewedAt: nowIso() }),
                    )
                  }
                >
                  Mark as reviewed today
                </Button>
                {material.lastReviewedAt ? (
                  <p className="tiny dim">
                    Last reviewed {formatLongDate(material.lastReviewedAt.slice(0, 10), today)}.
                  </p>
                ) : (
                  <p className="tiny dim">Not reviewed yet.</p>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="definition">
                <dt>Type</dt>
                <dd>{MATERIAL_TYPE_LABELS[material.materialType]}</dd>
                <dt>Topic</dt>
                <dd>{TOPIC_LABELS[material.topic]}</dd>
                <dt>Priority</dt>
                <dd>{PRIORITY_LABELS[material.priority]}</dd>
                <dt>Status</dt>
                <dd>{REVIEW_STATUS_LABELS[material.reviewStatus]}</dd>
                {goal ? (
                  <>
                    <dt>Goal</dt>
                    <dd>
                      <Link to="/flight-path">{goal.title}</Link>
                    </dd>
                  </>
                ) : null}
                {event ? (
                  <>
                    <dt>Lesson</dt>
                    <dd>
                      <Link to={`/schedule/${event.id}`}>{event.title}</Link>
                    </dd>
                  </>
                ) : null}
                <dt>Added</dt>
                <dd>{formatLongDate(material.createdAt.slice(0, 10), today)}</dd>
              </dl>

              {material.tags.length > 0 ? (
                <div className="tag-list" style={{ marginTop: "var(--space-4)" }}>
                  {material.tags.map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>

      {canSplit ? (
        <SplitPdfDialog
          open={splitting}
          material={material}
          onClose={() => setSplitting(false)}
          onCreated={() => {
            setSplitting(false);
            navigate("/study");
          }}
        />
      ) : null}

      {canSplit ? (
        <ManualSplitDialog
          open={splittingManually}
          material={material}
          onClose={() => setSplittingManually(false)}
          onCreated={(materialId) => {
            setSplittingManually(false);
            navigate(`/study/${materialId}`);
          }}
        />
      ) : null}

      <MaterialFormDialog
        open={editing}
        material={material}
        goals={data.goals}
        events={data.events}
        newMaterialId={newId()}
        onClose={() => setEditing(false)}
        onSave={saveMaterial}
      />

      <ActionFormDialog
        open={addingAction}
        relatedType="material"
        relatedId={material.id}
        onClose={() => setAddingAction(false)}
        onSave={async (draft: ActionDraft) => {
          const result = await operations.create(draft);
          if (result === null) return;
          setAddingAction(false);
        }}
      />

      <ConfirmDialog
        open={confirmingAi && !isGeneratingAny}
        title="Send this file to Google?"
        message={importedSet ? `${IMPORT_GUIDE_REGENERATE_WARNING} ${aiCheck.reason}` : aiCheck.reason}
        confirmLabel="Send to Gemini"
        destructive={false}
        onConfirm={() => {
          setConfirmingAi(false);
          if (isGeneratingAny || activeGeminiOpRef.current !== null) return;
          void createStudyAid();
        }}
        onCancel={() => setConfirmingAi(false)}
      />

      <ConfirmDialog
        open={confirmingPracticeTest && !isGeneratingAny}
        title="Send this file to Google?"
        message={
          practiceTest
            ? `${importedTest ? IMPORT_TEST_REGENERATE_WARNING : "This will replace your current practice test with newly generated questions."} Regenerating closes any unfinished practice session while completed history remains preserved under its original version. ${aiCheck.reason}`
            : aiCheck.reason
        }
        confirmLabel="Send to Gemini"
        destructive={false}
        onConfirm={() => {
          setConfirmingPracticeTest(false);
          if (isGeneratingAny || activeGeminiOpRef.current !== null) return;
          void createPracticeTest();
        }}
        onCancel={() => setConfirmingPracticeTest(false)}
      />

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this material?"
        message="Its notes, tags and links are removed. The file is deleted from this application's private storage. This also removes its card review history."
        onConfirm={() => {
          setConfirmingDelete(false);
          // Unmount flushes notes so Undo restores the latest typing too.
          deleteWithUndo({
            ids: [material.id],
            label: material.title,
            // Product decision: Deleting a locked file fails safely so the record
            // and file never get out of step. The old record-first order could leave
            // orphaned files or mismatched storage; having the material reappear
            // after the undo window if the file was locked is an accepted trade-off.
            run: async (repos) => {
              await removeMaterialWithFile(repos, material);
            },
          });
          navigate("/study");
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}

/**
 * Said before Gemini replaces imported content. Each names only what that
 * button replaces: regenerating the guide leaves an imported test alone.
 */
export const IMPORT_GUIDE_REGENERATE_WARNING =
  "This will replace your imported study guide and flashcards with AI-generated content.";
export const IMPORT_TEST_REGENERATE_WARNING =
  "This will replace your imported practice test with AI-generated content.";

/** Why a new or replacement Gemini study aid cannot be requested right now. */
interface GenerationNotice {
  text: string;
  /** Offer splitting a PDF that is too large to send whole. */
  split?: boolean;
  /** Link to Settings, where Gemini is connected. */
  settings?: boolean;
}

function GenerationNoticeView({ notice, onSplit }: { notice: GenerationNotice; onSplit: () => void }) {
  return (
    <div className="stack stack--3" style={{ marginBottom: "var(--space-4)" }}>
      <div className="ai-disclaimer" role="note">
        <AlertIcon size={16} />
        <p className="tiny">{notice.text}</p>
      </div>
      {notice.split ? (
        <div>
          <Button variant="secondary" onClick={onSplit}>
            Create study-size parts
          </Button>
        </div>
      ) : null}
      {notice.settings ? (
        <div>
          <Link className="button button--secondary" to="/settings">Open Settings</Link>
        </div>
      ) : null}
    </div>
  );
}
