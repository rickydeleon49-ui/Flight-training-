import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { formatLocalDay, nowIso, todayIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import { actionsFor } from "@/logic/actions";
import { checkAiSubmission, geminiSendDisclosure } from "@/logic/aiSafety";
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
import { geminiModelName, getGeminiStatus, type GeminiStatus } from "@/services/gemini";
import { useAppData } from "@/state/AppDataContext";
import { useMaterialNotes } from "@/state/useMaterialNotes";
import { useActionOperations } from "@/state/useActions";

import { canSplitPdfs } from "@/services/pdf";
import { materialLinkAnchor, resolveMaterialLink, type MaterialLinkTarget } from "@/logic/savedSearch";

import { MaterialFormDialog, type MaterialDraft } from "./MaterialFormDialog";
import { IMPORTED_CONTENT_DISCLAIMER } from "./ImportStudyPacketDialog";
import { CardReviewPanel } from "./CardReviewPanel";
import { AskGeminiPanel, formatFlashcardContext } from "./AskGeminiPanel";
import { PracticeTestPanel } from "./PracticeTestPanel";
import { usePracticeMetadata } from "./usePracticeMetadata";
import { ManualSplitDialog } from "./ManualSplitDialog";
import { SplitPdfDialog } from "./SplitPdfDialog";
import { SplitLineageDetails } from "./SplitLineageDetails";
import { ExportStudyDialog } from "./ExportStudyDialog";
import { GuideBody } from "./GuideBody";
import { OfflineStudyPanel } from "./OfflineStudyPanel";
import { StudyContentProvenance } from "./StudyContentProvenance";
import "./studyLibrary.css";
import { GeminiJobNotice, GeminiProgressView, GeminiRecoveryNotice } from "./GeminiJobNotice";
import { useGeminiJobs, isNewerJob, type GeminiJob, type GeminiJobPhase } from "@/state/GeminiJobs";
import { DocumentPagesPanel } from "./navigation/DocumentPagesPanel";
import { needsRegenerationReview } from "@/logic/studySetEditing";
import { pdfAskContext } from "@/logic/pdfAskContext";
import { AuthorBadge, StudySetEditor } from "./StudySetEditor";
import { PracticeTestEditor, PracticeTestHistory } from "./PracticeTestEditing";
import { needsPracticeRegenerationReview } from "@/logic/practiceRegeneration";
import { PracticeRegenerationReviewDialog } from "./PracticeRegenerationReviewDialog";
import { RegenerationReviewDialog } from "./RegenerationReviewDialog";
import { PdfStudyKitPanel } from "./PdfStudyKitPanel";
import { PdfItemLabel, PDF_KIT_REMINDER } from "./PdfItemLabel";
import { pdfLabelState } from "@/logic/pdfKitLabels";
import { SourcePageBadge } from "./navigation/SourcePageBadge";
import { MaterialStartHere, useMaterialTips } from "./MaterialStartHere";

export function MaterialDetail() {
  const { materialId } = useParams();
  // Generations belong to the app, not to this page (GEN-REL-02): leaving the
  // page or opening another material never discards one.
  return <MaterialDetailPage key={materialId} />;
}

function MaterialDetailPage() {
  const [activePracticeAttempt, setActivePracticeAttempt] = useState<boolean | null>(null);
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
  const { data, mutate, deleteWithUndo, repositories, dataRevision } = useAppData();
  const operations = useActionOperations();
  const today = todayIso();

  const { hidden: tipsHidden, setHidden: setTipsHidden } = useMaterialTips();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [addingAction, setAddingAction] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");
  const [fileMissing, setFileMissing] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [splittingManually, setSplittingManually] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [restoringFile, setRestoringFile] = useState(false);
  const [gemini, setGemini] = useState<GeminiStatus | null>(null);
  // Only decides whether a new study aid can be requested; saved ones show regardless.
  const [geminiStatusFailed, setGeminiStatusFailed] = useState(false);
  const [targetCards, setTargetCards] = useState(40);
  const [confirmingAi, setConfirmingAi] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const [cardRevealed, setCardRevealed] = useState(false);
  const [kitCardIndex, setKitCardIndex] = useState(0);
  const [kitCardRevealed, setKitCardRevealed] = useState(false);
  const [practiceJustSaved, setPracticeJustSaved] = useState(false);
  const [confirmingPracticeTest, setConfirmingPracticeTest] = useState(false);
  const [editingSet, setEditingSet] = useState(false);
  const [practiceNeedsReview, setPracticeNeedsReview] = useState(false);
  const [reviewingPracticeRegeneration, setReviewingPracticeRegeneration] = useState(false);
  const [reviewingRegeneration, setReviewingRegeneration] = useState(false);
  const [confirmingCards, setConfirmingCards] = useState(false);
  const [reviewingCardRegeneration, setReviewingCardRegeneration] = useState(false);

  // One Gemini generation at a time across the whole app, whichever page asked;
  // the lock is taken synchronously before anything awaits (src/state/GeminiJobs).
  const geminiJobs = useGeminiJobs();
  const studyJob = geminiJobs.jobs
    .filter((job) => job.materialId === materialId && job.kind === "study-aid")
    .reduce<GeminiJob | undefined>(
      (latest, candidate) => (!latest || isNewerJob(candidate, latest) ? candidate : latest),
      undefined,
    );
  const cardJob = geminiJobs.jobs.find(
    (job) => job.materialId === materialId && job.kind === "flashcards",
  );
  const practiceJob = geminiJobs.jobs.find(
    (job) => job.materialId === materialId && job.kind === "practice-test",
  );
  useEffect(() => {
    let live = true;
    if (materialId && repositories) {
      void repositories.documents.readPracticeSnapshot(materialId).then((snapshot) => {
        if (live) setPracticeNeedsReview(needsPracticeRegenerationReview(snapshot));
      }).catch(() => { if (live) setPracticeNeedsReview(true); });
    }
    return () => { live = false; };
  }, [repositories, materialId, dataRevision]);
  const working = (phase: GeminiJobPhase | undefined) => phase === "running" || phase === "saving";
  const generating = working(studyJob?.phase);
  const generatingCards = working(cardJob?.phase);
  const generatingPractice = working(practiceJob?.phase);
  const generationError = studyJob?.phase === "failed" && !studyJob.sectionGuide ? studyJob.error : null;
  const cardGenerationError = cardJob?.phase === "failed" ? cardJob.error : null;
  const practiceGenerationError = practiceJob?.phase === "failed" ? practiceJob.error : null;
  // An answer waiting to be saved or discarded is never overwritten by asking again.
  const draftWaiting = (phase: GeminiJobPhase | undefined) =>
    phase === "recovered" || phase === "save-failed" || phase === "discarding" || phase === "discard-failed";
  const isMountedRef = useRef(true);

  const material = data.materials.find((candidate) => candidate.id === materialId) ?? null;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const { metadata: practiceMetadata, retry: retryPracticeMetadata } = usePracticeMetadata(
    materialId,
    repositories?.practiceSessions,
  );
  const conversionStatus = practiceMetadata.phase === "loaded" ? practiceMetadata.conversionStatus : null;
  const completedCount = practiceMetadata.phase === "loaded" ? practiceMetadata.completedCount : 0;
  const studySet = data.aiStudySets.find((candidate) => candidate.sourceMaterialId === materialId);
  const guideSections = useMemo(
    () => (studySet?.sections ?? []).map((section, originalIndex) => ({ section, originalIndex })).filter(({ section }) => !section.pdfProvenance),
    [studySet?.sections],
  );
  const kitSections = useMemo(
    () => (studySet?.sections ?? []).map((section, originalIndex) => ({ section, originalIndex })).filter(({ section }) => Boolean(section.pdfProvenance)),
    [studySet?.sections],
  );
  const guideFlashcards = useMemo(
    () => (studySet?.flashcards ?? []).map((card, originalIndex) => ({ card, originalIndex })).filter(({ card }) => !card.pdfProvenance),
    [studySet?.flashcards],
  );
  const kitFlashcards = useMemo(
    () => (studySet?.flashcards ?? []).map((card, originalIndex) => ({ card, originalIndex })).filter(({ card }) => Boolean(card.pdfProvenance)),
    [studySet?.flashcards],
  );
  const hasKitItems = kitSections.length > 0 || kitFlashcards.length > 0;
  const safeCardIndex = Math.min(cardIndex, Math.max(0, guideFlashcards.length - 1));
  const safeKitCardIndex = Math.min(kitCardIndex, Math.max(0, kitFlashcards.length - 1));

  // A link from offline search (OFFLINE-02c §4): open the guide section,
  // card or practice question it names, only while it is unchanged.
  const [linkTarget, setLinkTarget] = useState<MaterialLinkTarget | null>(null);
  const [linkFailed, setLinkFailed] = useState(false);
  const [linkRetry, setLinkRetry] = useState(0);
  const linkKey = location.search;
  // The study set's own text: a link is checked again whenever it changes,
  // and not on every unrelated reload.
  const studyText = useMemo(
    () => (studySet ? JSON.stringify([studySet.summary, studySet.sections, studySet.flashcards]) : ""),
    [studySet],
  );
  const scrolledFor = useRef<string | null>(null);
  const practiceRepository = repositories?.practiceSessions;
  useEffect(() => {
    let live = true;
    // Whatever was resolved before no longer counts until checked again.
    setLinkTarget(null);
    setLinkFailed(false);
    void resolveMaterialLink(
      new URLSearchParams(linkKey),
      studySet ? { summary: studySet.summary, sections: studySet.sections, flashcards: studySet.flashcards } : null,
      async () => {
        const active = materialId ? await practiceRepository?.getActiveVersion(materialId) : null;
        return active ? active.items.map((item) => ({ id: item.id, questionText: item.questionText })) : null;
      },
    ).then((target) => {
      if (!live) return;
      setLinkTarget(target);
      if (target?.kind === "card") {
        const isKit = Boolean(studySet?.flashcards[target.index]?.pdfProvenance);
        if (isKit) {
          const kIdx = (studySet?.flashcards ?? [])
            .map((c, i) => ({ c, i }))
            .filter(({ c }) => Boolean(c.pdfProvenance))
            .findIndex(({ i }) => i === target.index);
          if (kIdx !== -1) {
            setKitCardIndex(kIdx);
            setKitCardRevealed(false);
          }
        } else {
          const gIdx = (studySet?.flashcards ?? [])
            .map((c, i) => ({ c, i }))
            .filter(({ c }) => !c.pdfProvenance)
            .findIndex(({ i }) => i === target.index);
          if (gIdx !== -1) {
            setCardIndex(gIdx);
            setCardRevealed(false);
          }
        }
      }
    }).catch(() => {
      // Consume late failures too; only this page's live request may
      // publish a sanitized error. Retry repeats the read, never a write.
      if (!live) return;
      setLinkTarget({ kind: "problem", message: "Couldn't open this search result. Try again." });
      setLinkFailed(true);
    });
    return () => {
      live = false;
    };
    // Checked again whenever the loaded study set changes at all: its text,
    // not its timestamp, decides (two saves can share a timestamp).
  }, [linkKey, materialId, studyText, practiceRepository, linkRetry]);
  useEffect(() => {
    const anchor = linkTarget ? materialLinkAnchor(linkTarget) : null;
    if (!anchor || scrolledFor.current === linkKey) return;
    scrolledFor.current = linkKey;
    document.getElementById(anchor)?.scrollIntoView?.({ block: "center" });
  }, [linkTarget, linkKey]);
  const practiceTest = data.practiceTests.find(
    (candidate) => candidate.sourceMaterialId === materialId,
  );
  // Saving replaces the progress view and mounts a compact loading panel before
  // its questions arrive. Anchor to the stable practice section after that
  // layout change, only for a generation requested during this visit.
  useLayoutEffect(() => {
    if (!practiceJustSaved || generatingPractice || !practiceTest) return;
    setPracticeJustSaved(false);
    document.getElementById("material-practice-test")?.scrollIntoView?.({ block: "start", behavior: "auto" });
  }, [practiceJustSaved, generatingPractice, practiceTest]);
  // Imported study packets are labelled as imported, never as Gemini output.
  const importedSet = studySet?.provider === "import";
  // A set she wrote herself is labelled as hers, never as Gemini output.
  const manualSet = studySet?.provider === "manual";
  const setHasHerItems = needsRegenerationReview(studySet);
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
  const isOverLimit = Boolean(isPdf && !fileForAi.ready);
  const pdfAskConversationKey = JSON.stringify([
    material.id,
    material.filePath,
    material.fileSize,
    material.updatedAt,
  ]);
  const pdfContext = pdfAskContext(material.title, studySet?.summary);
  const pdfSet = pdfLabelState(studySet);
  const pdfTest = pdfLabelState(practiceTest);
  const canSplit = Boolean(material.filePath) && isPdf && !fileMissing && canSplitPdfs();
  // Before a PDF is sent, narrowing it to a chapter is a deliberate choice
  // (GEN-REL-01): it opens the existing page chooser and sends nothing. The
  // new part is generated only after its own explicit Send.
  const chooseChapterFirst = (closeConfirmation: () => void) =>
    canSplit
      ? {
          secondaryLabel: "Choose a chapter or pages first",
          onSecondary: () => {
            closeConfirmation();
            setSplittingManually(true);
          },
        }
      : {};
  // Whether Gemini can be offered this file at all; a missing file only disables
  // the button, so a file that reappears does not need a reload.
  const canOfferGemini = Boolean(gemini?.configured) && aiCheck.allowed && fileForAi.ready;
  // Why a new or replacement study aid cannot be requested right now. This
  // never hides what is already saved: reading a saved guide, flipping cards
  // and taking a saved practice test need no connection and send nothing.
  const generationNotice: GenerationNotice | null = !aiCheck.allowed
    ? { text: aiCheck.reason }
    : !fileForAi.ready
      ? { text: isPdf ? "This PDF is too big for Gemini — split it first." : fileForAi.reason, split: canSplit }
      : fileMissing
        ? { text: "This study file is missing from app storage. Restore or re-attach the file to regenerate or create study aids from it." }
        : geminiStatusFailed
          ? {
              text: "Could not check the Gemini connection, so new study aids cannot be requested right now. Anything already saved stays available.",
              queueLater: isPdf && fileForAi.ready && !studyJob?.sectionGuide,
            }
          : gemini === null
            ? { text: "Checking the Gemini connection…" }
            : !gemini.configured
              ? { text: "Connect the free Gemini API in Settings to create or regenerate study aids from this document. Anything already saved stays available.", settings: true }
              : null;
  const isGeneratingAny = geminiJobs.busy || geminiJobs.locked();
  // Stage-appropriate recovery (GEN-REL-04): trying again goes through the
  // usual Send confirmation. A PDF already prepared with Google is reused, so
  // only the generation is repeated.
  const retryStudy =
    canOfferGemini && !isGeneratingAny && !fileMissing ? () => setConfirmingAi(true) : undefined;
  const retryFlashcards =
    canOfferGemini && !isGeneratingAny && !fileMissing ? () => setConfirmingCards(true) : undefined;
  const retryPractice =
    canOfferGemini && !isGeneratingAny && !fileMissing ? () => setConfirmingPracticeTest(true) : undefined;

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

  /** Checks made once the lock is held, before anything is sent. */
  const preflight = (filePath: string) => async (): Promise<string | null> => {
    const missing =
      "This study file is missing from app storage. Restore or re-attach the file before generating.";
    if (fileMissing) return missing;
    if (canHandleFiles()) {
      let exists = false;
      try {
        exists = await documentExists(filePath);
      } catch {
        exists = false;
      }
      if (!exists) {
        if (isMountedRef.current) setFileMissing(true);
        return missing;
      }
    }
    return null;
  };

  const createStudyAid = async () => {
    if (!material?.filePath || !checkAiSubmission(material, data.toolkit.credentials).allowed) {
      return;
    }
    await geminiJobs.start(
      "study-aid",
      { materialId: material.id, filePath: material.filePath },
      {
        targetCards,
        preflight: preflight(material.filePath),
        onSaved: () => {
          if (isMountedRef.current) {
            setCardIndex(0);
            setCardRevealed(false);
          }
        },
      },
    );
  };

  const queueStudyAid = async () => {
    if (!material?.filePath || !checkAiSubmission(material, data.toolkit.credentials).allowed) {
      return;
    }
    await geminiJobs.queueGuide({ materialId: material.id, filePath: material.filePath });
  };

  const createFlashcards = async () => {
    if (!material?.filePath || !checkAiSubmission(material, data.toolkit.credentials).allowed) {
      return;
    }
    await geminiJobs.start(
      "flashcards",
      { materialId: material.id, filePath: material.filePath },
      {
        targetCards,
        preflight: preflight(material.filePath),
        onSaved: () => {
          if (isMountedRef.current) {
            setCardIndex(0);
            setCardRevealed(false);
          }
        },
      },
    );
  };

  const createPracticeTest = async () => {
    if (!material?.filePath || !checkAiSubmission(material, data.toolkit.credentials).allowed) {
      return;
    }
    await geminiJobs.start(
      "practice-test",
      { materialId: material.id, filePath: material.filePath },
      {
        preflight: preflight(material.filePath),
        onSaved: () => { if (isMountedRef.current) setPracticeJustSaved(true); },
      },
    );
  };

  const jumpToFileSection = () => {
    const el = document.getElementById("material-file-actions");
    el?.scrollIntoView?.({ block: "start" });
    el?.focus();
  };

  return (
    <>
      <PageHeader
        title={material.title}
        subtitle={`${MATERIAL_TYPE_LABELS[material.materialType]} · ${TOPIC_LABELS[material.topic]}`}
        action={
          <div className="row row--wrap">
            <Link className="button button--ghost" to="/study">
              Back
            </Link>
            {!isPdf ? <Button size="small" variant="ghost" aria-pressed={tipsHidden} onClick={() => setTipsHidden(!tipsHidden)}>{tipsHidden ? "Show tips" : "Hide tips"}</Button> : null}
            <Button onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="danger" className="destructive-action" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          </div>
        }
      />

      {linkTarget && (linkTarget.kind === "practice" || linkTarget.kind === "problem") ? (
        <Card>
          <CardBody>
            <div id="search-target-note" className="stack stack--2 search-target" role="status">
              {linkTarget.kind === "practice" ? (
                <>
                  <p className="eyebrow">From your practice test</p>
                  <p className="wrap-anywhere">{linkTarget.stem}</p>
                  <p className="tiny muted">The answer stays hidden here. Take the practice test below to answer it.</p>
                </>
              ) : (
                <>
                  <p className="small">{linkTarget.message}</p>
                  {linkFailed ? (
                    <Button variant="secondary" onClick={() => setLinkRetry((attempt) => attempt + 1)}>
                      Retry opening search result
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </CardBody>
        </Card>
      ) : null}

      <div className="detail material-detail">
        <div className="detail__column">

          <div id="material-start-here">
            <MaterialStartHere material={material} materials={data.materials} studySet={studySet}
              geminiDraftWaiting={Boolean(studyJob?.answer && (draftWaiting(studyJob.phase) || studyJob.phase === "waiting-for-her"))}
              fileMissing={fileMissing} practiceTestSaved={Boolean(practiceTest)}
              tipsHidden={tipsHidden} onTipsHiddenChange={setTipsHidden} />
          </div>
          {isPdf && material.filePath ? (
            <div id="material-ask-gemini"><Card>
              <CardHeader title="Ask about this PDF" />
              <CardBody>
                {!aiCheck.allowed ? (
                  <p className="small muted">{aiCheck.reason}</p>
                ) : isOverLimit ? (
                  <p className="small muted">This PDF is too big for Gemini — split it first.</p>
                ) : !canOfferGemini || fileMissing ? (
                  <p className="small muted">
                    {fileMissing
                      ? "This PDF's file is missing, so Gemini can't read it."
                      : !gemini?.configured
                        ? "Connect Gemini in Settings to ask questions about this PDF."
                        : (generationNotice?.text ?? "Gemini isn't available for this PDF right now.")}
                  </p>
                ) : (
                  <>
                    <p className="small muted">Ask Gemini a question about this PDF. It answers from the pages and shows which pages it used.</p>
                    <AskGeminiPanel
                      key={pdfAskConversationKey}
                      materialId={material.id}
                      relativePath={material.filePath ?? null}
                      context={pdfContext}
                      buttonLabel="Ask about this PDF"
                    />
                  </>
                )}
              </CardBody>
            </Card></div>
          ) : null}
          {isPdf ? (
            <nav className="row row--wrap material-jumps" aria-label="Jump to">
              <span className="tiny muted">Jump to</span>
              {[
                ...(material.filePath || studySet ? [{ id: "material-guide-heading", label: "Study guide" }] : []),
                ...(material.filePath || (studySet && studySet.flashcards.length > 0) ? [{ id: "material-cards-heading", label: "Flashcards" }] : []),
                { id: "material-practice-heading", label: "Practice test" },
                ...(material.filePath ? [{ id: "material-backup-heading", label: "Backup on this Mac" }] : []),
              ].map(({ id, label }) => (
                <Button key={id} size="small" variant="ghost" onClick={() => {
                  const heading = document.getElementById(id);
                  heading?.focus({ preventScroll: true });
                  heading?.scrollIntoView?.({ block: "start" });
                }}>{label}</Button>
              ))}
            </nav>
          ) : null}
          {material.filePath ? (
            <div id="material-file-actions" tabIndex={-1}><Card>
              <CardBody>
                <div className={`file-row file-row--actions${fileMissing ? " file-row--missing" : ""}`}>
                  {fileMissing ? <AlertIcon /> : <DocumentIcon />}
                  <div className="file-row__details">
                    <p className="small truncate">{material.originalFileName}</p>
                    <p className="tiny">
                      {fileMissing
                        ? "This file is no longer in your library storage."
                        : formatFileSize(material.fileSize)}
                    </p>
                  </div>
                  <div className="file-row__actions">
                    {canSplit ? (
                      <div className="file-action-tip">
                        <Button onClick={() => setSplitting(true)}>Split automatically</Button>
                        {!tipsHidden ? <p className="tiny muted">Makes parts of up to 50 MB; each becomes its own library item. Your original stays as it is.</p> : null}
                      </div>
                    ) : null}
                    {canSplit ? (
                      <div className="file-action-tip">
                      <Button variant="secondary" onClick={() => setSplittingManually(true)}>
                        Take out a chapter
                      </Button>
                      {!tipsHidden ? <p className="tiny muted">Choose a page range, like 12–40, to make a smaller copy.</p> : null}
                      </div>
                    ) : null}
                    {!fileMissing && canHandleFiles() ? (
                      <div className="file-action-tip">
                      <Button onClick={open}>
                        <ExternalIcon size={15} /> Open
                      </Button>
                      {!tipsHidden ? <p className="tiny muted">{isPdf ? "Opens the PDF in your Mac's PDF app. In Preview, press ⌥⌘G to go to a page." : "Opens the file in its usual app on your Mac."}</p> : null}
                      </div>
                    ) : null}
                    {!canHandleFiles() ? <p className="tiny muted">Split and open options: Works in the desktop app.</p> : null}
                  </div>
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
            </Card></div>
          ) : null}

          {material.filePath || studySet ? (
            <div id="material-study-guide" tabIndex={-1}>
              <Card>
                <CardHeader
                  title={isPdf ? "Study guide" : pdfSet ? "Your PDF study kit" : importedSet ? "Imported study packet" : manualSet ? "Your study guide" : "Gemini study assistant"}
                  headingId="material-guide-heading"
                  eyebrow={
                    importedSet
                      ? "Imported from a file you selected"
                      : manualSet
                        ? "Written by you, saved on this computer"
                        : studySet?.summary || guideSections.length
                          ? "Saved on this computer"
                          : undefined
                  }
                  action={
                    <div className="row row--wrap">
                      {studySet && (studySet.summary || studySet.sections.length > 0) ? (
                        <Button
                          size="small"
                          variant="secondary"
                          aria-pressed={editingSet}
                          disabled={isGeneratingAny}
                          onClick={() => setEditingSet((open) => !open)}
                        >
                          {editingSet ? "Done editing" : "Edit study guide"}
                        </Button>
                      ) : null}
                      {studySet || practiceTest ? (
                        <Button size="small" variant="secondary" disabled={isGeneratingAny} onClick={() => setExporting(true)}>
                          Share or print
                        </Button>
                      ) : null}
                      {isOverLimit ? (
                        <Button size="small" variant="secondary" onClick={jumpToFileSection}>
                          Split file
                        </Button>
                      ) : canOfferGemini ? (
                        <Button
                          size="small"
                          variant={studySet && (studySet.summary || guideSections.length > 0) ? "secondary" : "primary"}
                          disabled={isGeneratingAny || fileMissing || draftWaiting(studyJob?.phase) || Boolean(studyJob?.sectionGuide)}
                          onClick={() => {
                            if (!isGeneratingAny && !geminiJobs.locked()) setConfirmingAi(true);
                          }}
                        >
                          {generating
                            ? "Reading document…"
                            : studySet && (studySet.summary || guideSections.length > 0)
                              ? "Regenerate"
                              : isPdf
                                ? "Create study guide"
                                : "Create study aid"}
                        </Button>
                      ) : geminiStatusFailed && isPdf && fileForAi.ready && !studyJob?.sectionGuide ? (
                        <Button
                          size="small"
                          variant="secondary"
                          disabled={isGeneratingAny || fileMissing}
                          onClick={() => void queueStudyAid()}
                        >
                          Generate later
                        </Button>
                      ) : null}
                    </div>
                  }
                />
                {!tipsHidden ? (
                  <p className="tiny muted" style={{ padding: "var(--space-3) var(--space-5) 0" }}>
                    {pdfSet
                      ? "Review the guide saved from your PDF text, and follow page references back to the source."
                      : importedSet
                        ? "Review the guide from your imported packet; you can edit it here."
                        : manualSet
                          ? "A study guide you wrote. Use Edit study guide to change sections."
                          : isPdf
                            ? "Ask Gemini for a study guide from this file, then review and save the draft on this Mac."
                            : "Ask Gemini for a study guide from this file, then review and save the draft on this Mac."}
                  </p>
                ) : null}
                <CardBody>
                  {isOverLimit ? (
                    <div className="stack stack--3" style={{ marginBottom: "var(--space-4)" }}>
                      <div className="ai-disclaimer" role="alert">
                        <AlertIcon size={16} />
                        <p className="tiny">This PDF is too big for Gemini — split it first.</p>
                      </div>
                    </div>
                  ) : null}
                  {!isOverLimit && generationNotice ? (
                    <GenerationNoticeView
                      notice={generationNotice}
                      onSplit={jumpToFileSection}
                      onQueueLater={() => void queueStudyAid()}
                    />
                  ) : null}
                  {generating ? (
                    studyJob ? (
                      <GeminiProgressView
                        job={studyJob}
                        title="Gemini is reviewing this document"
                        onCancel={() => void geminiJobs.cancel(studyJob.key)}
                      />
                    ) : null
                  ) : null}
                  {studySet && (studySet.summary || guideSections.length > 0) ? (
                    <div className="stack stack--5">
                      <div className="ai-disclaimer">
                        <AlertIcon size={16} />
                        <p className="tiny">
                          {manualSet
                            ? "A study guide you wrote. Check it against current FAA material, aircraft documents, and your instructor."
                            : importedSet
                              ? IMPORTED_CONTENT_DISCLAIMER
                              : `AI-generated study aid${studySet.model ? ` (made with ${geminiModelName(studySet.model)})` : ""}. Verify everything against the source, current FAA material, aircraft documents, and your instructor before using it.`}
                          {!manualSet && setHasHerItems
                            ? " Items marked as yours or as an instructor correction were written here, not generated."
                            : ""}
                        </p>
                      </div>

                      <StudyContentProvenance
                        sourceMaterialTitle={material.title}
                        content={studySet}
                        kind="study-aid"
                      />

                      <section className="stack stack--3" aria-labelledby="ai-guide-title">
                        <div>
                          <p className="eyebrow">Study guide</p>
                          <h3 id="ai-guide-title" className="ai-guide__title">{studySet.title}</h3>
                        </div>
                        {studySet.summaryPdfProvenance ? (
                          <PdfItemLabel provenance={studySet.summaryPdfProvenance} origin={studySet.summaryOrigin} />
                        ) : studySet.summaryOrigin ? (
                          <AuthorBadge origin={studySet.summaryOrigin} />
                        ) : null}
                        {studySet.summary ? (
                          <p
                            id="search-target-summary"
                            className={`small ai-copy${linkTarget?.kind === "summary" ? " search-target" : ""}`}
                          >
                            {studySet.summary}
                          </p>
                        ) : null}
                        {guideSections.map(({ section, originalIndex }) => (
                          <div
                            id={`search-target-guide-${originalIndex}`}
                            className={`ai-guide__section${linkTarget?.kind === "guide" && linkTarget.index === originalIndex ? " search-target" : ""}`}
                            key={`${section.heading}-${originalIndex}`}
                          >
                            <h4>
                              {section.heading}{" "}
                              {section.pdfProvenance ? (
                                <PdfItemLabel provenance={section.pdfProvenance} origin={section.origin} />
                              ) : (
                                <AuthorBadge origin={section.origin} />
                              )}
                            </h4>
                            <GuideBody className="small" text={section.body} />
                          </div>
                        ))}
                        {studySet.sourceNotes && !studySet.sourceNotes.trimStart().startsWith("Source SHA-256:") ? (
                          <p className="tiny dim ai-copy">{studySet.sourceNotes}</p>
                        ) : null}
                      </section>

                      {editingSet ? <StudySetEditor material={material} studySet={studySet} /> : null}
                    </div>
                  ) : editingSet && studySet ? (
                    <div className="stack stack--5">
                      <StudySetEditor material={material} studySet={studySet} />
                    </div>
                  ) : canOfferGemini && !fileMissing && !generating && !hasImported ? (
                    <p className="small muted">
                      {isPdf
                        ? "Gemini will read this PDF and build a study guide section by section. Finished sections are kept if you stop; the completed draft waits for you to save it locally."
                        : "Gemini will read only this file and create a source-based study guide. The finished draft waits for you to save it locally."}
                    </p>
                  ) : null}

                  {generationError ? (
                    <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
                      <p className="field__error" role="alert" style={{ whiteSpace: "pre-line" }}>
                        {generationError}
                      </p>
                      {retryStudy ? (
                        <div className="row row--wrap">
                          <Button size="small" onClick={retryStudy}>
                            Try again
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {studyJob ? (
                    <GeminiJobNotice
                      job={studyJob}
                      jobs={geminiJobs}
                      onRetry={retryStudy}
                      onReview={
                        (setHasHerItems || studyJob.needsReview) && studyJob.answer
                          ? () => setReviewingRegeneration(true)
                          : undefined
                      }
                    />
                  ) : null}
                  {geminiJobs.jobs
                    .filter((job) => job.materialId === materialId && job.kind === "study-aid" && job.sectionGuide && job.key !== studyJob?.key)
                    .map((job) => (
                      <GeminiJobNotice key={job.key} job={job} jobs={geminiJobs} />
                    ))}
                  {reviewingRegeneration &&
                  studyJob?.answer &&
                  (studyJob.phase === "recovered" || studyJob.phase === "save-failed" || studyJob.phase === "saving") ? (
                    <RegenerationReviewDialog
                      job={studyJob}
                      materialId={material.id}
                      onClose={() => setReviewingRegeneration(false)}
                      onSave={async (reviewed) => {
                        const saved = await geminiJobs.saveReviewed(studyJob.key, reviewed);
                        if (saved && isMountedRef.current) setReviewingRegeneration(false);
                        return saved;
                      }}
                    />
                  ) : null}
                  {canOfferGemini && geminiJobs.recovery === "failed" ? (
                    <GeminiRecoveryNotice onRetry={geminiJobs.retryRecovery} />
                  ) : null}
                </CardBody>
              </Card>
            </div>
          ) : null}

          {material.filePath || (studySet && studySet.flashcards.length > 0) ? (
            <div id="material-flashcards" tabIndex={-1}>
              <Card>
                <CardHeader
                  title="Flashcards"
                  headingId="material-cards-heading"
                  eyebrow={
                    studySet && guideFlashcards.length > 0
                      ? "Saved on this computer"
                      : material.filePath
                        ? "From this document"
                        : "Optional"
                  }
                  action={
                    <div className="row row--wrap" style={{ alignItems: "center" }}>
                      {isOverLimit ? (
                        <Button size="small" variant="secondary" onClick={jumpToFileSection}>
                          Split file
                        </Button>
                      ) : canOfferGemini ? (
                        <>
                          <label className="row row--compact small" style={{ alignItems: "center", gap: "var(--space-2)" }}>
                            Target cards
                            <select
                              aria-label="Target cards"
                              className="select select--small"
                              value={targetCards}
                              onChange={(event) => setTargetCards(Number(event.target.value))}
                            >
                              {[20, 40, 60].map((count) => (
                                <option key={count} value={count}>
                                  {count}
                                </option>
                              ))}
                            </select>
                          </label>
                          <Button
                            size="small"
                            variant={studySet && guideFlashcards.length > 0 ? "secondary" : "primary"}
                            disabled={isGeneratingAny || fileMissing || draftWaiting(cardJob?.phase)}
                            onClick={() => {
                              if (!isGeneratingAny && !geminiJobs.locked()) setConfirmingCards(true);
                            }}
                          >
                            {generatingCards ? "Reading document…" : "Create flashcards"}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  }
                />
                {!tipsHidden ? (
                  <p className="tiny muted" style={{ padding: "var(--space-3) var(--space-5) 0" }}>
                    Create key flashcards to practice recall, and review cards you've saved.
                  </p>
                ) : null}
                <CardBody>
                  {isOverLimit ? (
                    <div className="stack stack--3" style={{ marginBottom: "var(--space-4)" }}>
                      <div className="ai-disclaimer" role="alert">
                        <AlertIcon size={16} />
                        <p className="tiny">This PDF is too big for Gemini — split it first.</p>
                      </div>
                    </div>
                  ) : null}
                  {generatingCards ? (
                    cardJob ? (
                      <GeminiProgressView
                        job={cardJob}
                        title="Gemini is creating flashcards"
                        onCancel={() => void geminiJobs.cancel(cardJob.key)}
                      />
                    ) : null
                  ) : null}
                  {cardGenerationError ? (
                    <div className="stack stack--3" style={{ marginBottom: "var(--space-3)" }}>
                      <p className="field__error" role="alert" style={{ whiteSpace: "pre-line" }}>
                        {cardGenerationError}
                      </p>
                      {retryFlashcards ? (
                        <div className="row row--wrap">
                          <Button size="small" onClick={retryFlashcards}>
                            Try again
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {cardJob ? (
                    <GeminiJobNotice
                      job={cardJob}
                      jobs={geminiJobs}
                      onRetry={retryFlashcards}
                      onReview={
                        (setHasHerItems || cardJob.needsReview) && cardJob.answer
                          ? () => setReviewingCardRegeneration(true)
                          : undefined
                      }
                    />
                  ) : null}
                  {reviewingCardRegeneration &&
                  cardJob?.answer &&
                  (cardJob.phase === "recovered" || cardJob.phase === "save-failed" || cardJob.phase === "saving") ? (
                    <RegenerationReviewDialog
                      job={cardJob}
                      materialId={material.id}
                      onClose={() => setReviewingCardRegeneration(false)}
                      onSave={async (reviewed) => {
                        const saved = await geminiJobs.saveReviewed(cardJob.key, reviewed);
                        if (saved && isMountedRef.current) setReviewingCardRegeneration(false);
                        return saved;
                      }}
                    />
                  ) : null}

                  {studySet && studySet.flashcards.length > 0 ? (
                    <div className="stack stack--5">
                      {guideFlashcards.length > 0 ? (
                        <section
                          id="search-target-cards"
                          className={`stack stack--3${linkTarget?.kind === "card" && !studySet.flashcards[linkTarget.index]?.pdfProvenance ? " search-target" : ""}`}
                          aria-labelledby="flashcards-title"
                        >
                          <div className="row row--between">
                            <div>
                              <h3 id="flashcards-title" className="ai-guide__title">
                                Card {safeCardIndex + 1} of {guideFlashcards.length}
                              </h3>
                            </div>
                            <div className="row row--wrap">
                              {guideFlashcards[safeCardIndex]?.card.pdfProvenance ? (
                                <PdfItemLabel
                                  provenance={guideFlashcards[safeCardIndex]?.card.pdfProvenance}
                                  origin={guideFlashcards[safeCardIndex]?.card.origin}
                                />
                              ) : (
                                <AuthorBadge origin={guideFlashcards[safeCardIndex]?.card.origin} />
                              )}
                              <SourcePageBadge page={guideFlashcards[safeCardIndex]?.card.sourcePage} materialId={material.id} />
                            </div>
                          </div>
                          <button
                            className={`flashcard${cardRevealed ? " is-revealed" : ""}`}
                            type="button"
                            onClick={() => setCardRevealed((current) => !current)}
                            aria-label={cardRevealed ? "Hide flashcard answer" : "Reveal flashcard answer"}
                          >
                            <span className="tiny dim">{cardRevealed ? "Answer" : "Question"}</span>
                            <span>{cardRevealed ? guideFlashcards[safeCardIndex]?.card.back : guideFlashcards[safeCardIndex]?.card.front}</span>
                            <span className="tiny dim">Click to {cardRevealed ? "see the question" : "reveal the answer"}</span>
                          </button>
                          {cardRevealed && guideFlashcards[safeCardIndex]?.card ? (
                            <AskGeminiPanel
                              materialId={material.id}
                              relativePath={material.filePath ?? null}
                              context={formatFlashcardContext(
                                guideFlashcards[safeCardIndex].card.front,
                                guideFlashcards[safeCardIndex].card.back,
                                guideFlashcards[safeCardIndex].card.sourcePage,
                              )}
                              buttonLabel="Explain this"
                            />
                          ) : null}
                          <div className="row row--between">
                            <Button
                              size="small"
                              disabled={safeCardIndex === 0}
                              onClick={() => {
                                setCardIndex((index) => index - 1);
                                setCardRevealed(false);
                              }}
                            >
                              Previous
                            </Button>
                            <Button
                              size="small"
                              disabled={safeCardIndex >= guideFlashcards.length - 1}
                              onClick={() => {
                                setCardIndex((index) => index + 1);
                                setCardRevealed(false);
                              }}
                            >
                              Next
                            </Button>
                          </div>
                        </section>
                      ) : !generatingCards && material.filePath && canOfferGemini ? (
                        <p className="small muted">
                          Gemini will read this file and create key flashcards with source page references. Choose 20, 40, or 60 cards.
                        </p>
                      ) : null}

                      <CardReviewPanel
                        materialId={material.id}
                        materialTitle={material.title}
                        materialFilePath={material.filePath ?? null}
                        repository={repositories?.cardReviews}
                        contentKey={studySet.updatedAt}
                        autoStart={startCardReview}
                        browseCard={
                          guideFlashcards[safeCardIndex]
                            ? {
                                index: guideFlashcards[safeCardIndex].originalIndex,
                                front: guideFlashcards[safeCardIndex].card.front,
                                back: guideFlashcards[safeCardIndex].card.back,
                              }
                            : null
                        }
                      />
                    </div>
                  ) : !generatingCards && material.filePath && canOfferGemini ? (
                    <p className="small muted">
                      Gemini will read this file and create key flashcards with source page references. Choose 20, 40, or 60 cards.
                    </p>
                  ) : null}
                </CardBody>
              </Card>
            </div>
          ) : null}

          <div id="material-practice-test" tabIndex={-1}>
              <Card>
                <CardHeader
                  title="Practice test"
                  headingId="material-practice-heading"
                  eyebrow={
                    importedTest
                      ? "Imported study packet"
                      : practiceTest
                        ? "Saved on this computer"
                        : material.filePath
                          ? "Optional, from this document"
                          : "Optional"
                  }
                  action={
                    <div className="row row--wrap">
                      {isOverLimit ? (
                        <Button size="small" variant="secondary" onClick={jumpToFileSection}>
                          Split file
                        </Button>
                      ) : canOfferGemini ? (
                        <Button
                          size="small"
                          variant={practiceTest ? "secondary" : "primary"}
                          disabled={isGeneratingAny || fileMissing || draftWaiting(practiceJob?.phase)}
                          onClick={() => {
                            if (!isGeneratingAny && !geminiJobs.locked()) setConfirmingPracticeTest(true);
                          }}
                        >
                          {generatingPractice
                            ? "Reading document…"
                            : practiceTest
                              ? "Regenerate"
                              : "Create practice test"}
                        </Button>
                      ) : null}
                    </div>
                  }
                />
                {!tipsHidden ? (
                  <p className="tiny muted" style={{ padding: "var(--space-3) var(--space-5) 0" }}>
                    Try saved questions with explanations; your completed attempts stay in practice history.
                  </p>
                ) : null}
                <CardBody>
                  {isOverLimit ? (
                    <div className="stack stack--3" style={{ marginBottom: "var(--space-4)" }}>
                      <div className="ai-disclaimer" role="alert">
                        <AlertIcon size={16} />
                        <p className="tiny">This PDF is too big for Gemini — split it first.</p>
                      </div>
                    </div>
                  ) : null}
                  <PracticeTestEditor material={material} activeAttempt={activePracticeAttempt} />
                  <PracticeTestHistory material={material} />
                  {generatingPractice ? (
                    practiceJob ? (
                      <GeminiProgressView
                        job={practiceJob}
                        title="Gemini is writing practice questions"
                        onCancel={() => void geminiJobs.cancel(practiceJob.key)}
                      />
                    ) : null
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
                      <div className="row row--between row--wrap" style={{ alignItems: "center" }}>
                        <div className="ai-disclaimer" style={{ flex: "1 1 16rem", margin: 0 }}>
                          <AlertIcon size={16} />
                          <p className="tiny">
                            {pdfTest
                              ? PDF_KIT_REMINDER
                              : importedTest
                                ? IMPORTED_CONTENT_DISCLAIMER
                                : practiceTest.provider === "manual"
                                  ? "Practice questions you wrote. Check them against your source and your instructor's guidance."
                                  : `AI-generated practice test${practiceTest.model ? ` (made with ${geminiModelName(practiceTest.model)})` : ""}. Verify every answer against the source, current FAA material, aircraft documents, and your instructor before relying on it.`}
                          </p>
                        </div>
                        {completedCount > 0 ? (
                          <Link
                            to={`/study/history/${encodeURIComponent(material.id)}`}
                            className="button button--secondary button--small"
                            style={{ flexShrink: 0 }}
                          >
                            View practice history ({completedCount})
                          </Link>
                        ) : null}
                      </div>

                      <StudyContentProvenance
                        sourceMaterialTitle={material.title}
                        content={practiceTest}
                        kind="practice-test"
                      />

                      <PracticeTestPanel
                        practiceTest={practiceTest}
                        materialId={material.id}
                        key={practiceTest.updatedAt}
                        onAttemptChange={setActivePracticeAttempt}
                      />
                    </div>
                  ) : !generatingPractice && !hasImported && material.filePath && canOfferGemini ? (
                    <p className="small muted">
                      Gemini will read only this file and create a multiple-choice practice test with
                      explanations. The result will be saved locally with your other data.
                    </p>
                  ) : null}

                  {practiceGenerationError ? (
                    <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
                      <p className="field__error" role="alert" style={{ whiteSpace: "pre-line" }}>
                        {practiceGenerationError}
                      </p>
                      {retryPractice ? (
                        <div className="row row--wrap">
                          <Button size="small" onClick={retryPractice}>
                            Try again
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {practiceJob ? (
                    <GeminiJobNotice
                      job={practiceJob}
                      jobs={geminiJobs}
                      onRetry={retryPractice}
                      onReview={
                        practiceJob.answer && (practiceJob.needsReview || practiceJob.reviewed || practiceNeedsReview)
                          ? () => {
                              if (activePracticeAttempt === false) setReviewingPracticeRegeneration(true);
                            }
                          : undefined
                      }
                      reviewDisabled={activePracticeAttempt !== false}
                    />
                  ) : null}
                  {reviewingPracticeRegeneration &&
                  practiceJob?.answer &&
                  (practiceJob.phase === "recovered" || practiceJob.phase === "save-failed" || practiceJob.phase === "saving") ? (
                    <PracticeRegenerationReviewDialog
                      job={practiceJob}
                      materialId={material.id}
                      onClose={() => setReviewingPracticeRegeneration(false)}
                      onSave={async (reviewed) => {
                        const saved = await geminiJobs.saveReviewed(practiceJob.key, reviewed);
                        if (saved && isMountedRef.current) setReviewingPracticeRegeneration(false);
                        return saved;
                      }}
                    />
                  ) : null}
                </CardBody>
              </Card>
            </div>

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
            {!tipsHidden ? <p className="tiny muted" style={{ padding: "var(--space-3) var(--space-5) 0" }}>Write what you want to remember. Your notes save as you type; watch for Saved.</p> : null}
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
            {!tipsHidden ? <p className="tiny muted" style={{ padding: "var(--space-3) var(--space-5) 0" }}>Give this material a small next step, and add a date if you have one in mind.</p> : null}
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
            {!tipsHidden ? <p className="tiny muted" style={{ padding: "var(--space-3) var(--space-5) 0" }}>Keep questions here to ask later; they also appear on your Questions page.</p> : null}
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
          {isPdf && material.filePath ? (
            <DocumentPagesPanel material={material} fileMissing={fileMissing} restoring={restoringFile}
              onRestore={() => void restoreFile()} showTips={!tipsHidden} />
          ) : null}

          {isPdf && material.filePath ? (
            <section id="material-mac-backup" tabIndex={-1} aria-label="On this Mac (backup)">
              <Card>
                <CardHeader title="On this Mac (backup)" headingId="material-backup-heading" />
                {!tipsHidden ? <p className="tiny muted" style={{ padding: "var(--space-3) var(--space-5) 0" }}>No internet, or don't want to use Gemini? Read this PDF's text and make a study kit right on your Mac.</p> : null}
                <CardBody><div className="stack stack--4">
                  <div id="material-offline-study" tabIndex={-1}><OfflineStudyPanel material={material} /></div>
                  <div id="material-pdf-kit" tabIndex={-1}><PdfStudyKitPanel key={material.id} material={material} /></div>
                  {hasKitItems ? (
                    <div id="material-saved-pdf-kit" tabIndex={-1}>
                      <Card>
                        <CardHeader title="Your study kit" />
                        <CardBody>
                          <div className="stack stack--5">
                            <div className="ai-disclaimer">
                              <AlertIcon size={16} />
                              <p className="tiny">{PDF_KIT_REMINDER}</p>
                            </div>

                            {kitSections.length > 0 ? (
                              <section className="stack stack--3" aria-labelledby="kit-sections-title">
                                <div>
                                  <p className="eyebrow">Study guide</p>
                                  <h4 id="kit-sections-title" className="ai-guide__title">{studySet?.title}</h4>
                                </div>
                                {kitSections.map(({ section, originalIndex }) => {
                                  const pages = [...new Set(section.pdfProvenance?.sources?.map((s) => s.page) ?? [])];
                                  return (
                                    <div
                                      id={`search-target-guide-${originalIndex}`}
                                      className={`ai-guide__section${linkTarget?.kind === "guide" && linkTarget.index === originalIndex ? " search-target" : ""}`}
                                      key={`${section.heading}-${originalIndex}`}
                                    >
                                      <h4>
                                        {section.heading}{" "}
                                        {section.pdfProvenance ? (
                                          <PdfItemLabel provenance={section.pdfProvenance} origin={section.origin} />
                                        ) : (
                                          <AuthorBadge origin={section.origin} />
                                        )}
                                        {pages.map((page) => (
                                          <SourcePageBadge key={page} page={page} materialId={material.id} />
                                        ))}
                                      </h4>
                                      <GuideBody className="small" text={section.body} />
                                    </div>
                                  );
                                })}
                              </section>
                            ) : null}

                            {kitFlashcards.length > 0 ? (
                              <section
                                id="search-target-kit-cards"
                                className={`stack stack--3${linkTarget?.kind === "card" && Boolean(studySet?.flashcards[linkTarget.index]?.pdfProvenance) ? " search-target" : ""}`}
                                aria-labelledby="kit-flashcards-title"
                              >
                                <div className="row row--between">
                                  <div>
                                    <p className="eyebrow">Flashcards</p>
                                    <h4 id="kit-flashcards-title" className="ai-guide__title">
                                      Card {safeKitCardIndex + 1} of {kitFlashcards.length}
                                    </h4>
                                  </div>
                                  <div className="row row--wrap">
                                    {kitFlashcards[safeKitCardIndex]?.card.pdfProvenance ? (
                                      <PdfItemLabel
                                        provenance={kitFlashcards[safeKitCardIndex]?.card.pdfProvenance}
                                        origin={kitFlashcards[safeKitCardIndex]?.card.origin}
                                      />
                                    ) : (
                                      <AuthorBadge origin={kitFlashcards[safeKitCardIndex]?.card.origin} />
                                    )}
                                    <SourcePageBadge
                                      page={
                                        kitFlashcards[safeKitCardIndex]?.card.sourcePage ??
                                        kitFlashcards[safeKitCardIndex]?.card.pdfProvenance?.sources?.[0]?.page
                                      }
                                      materialId={material.id}
                                    />
                                  </div>
                                </div>
                                <button
                                  className={`flashcard${kitCardRevealed ? " is-revealed" : ""}`}
                                  type="button"
                                  onClick={() => setKitCardRevealed((current) => !current)}
                                  aria-label={kitCardRevealed ? "Hide flashcard answer" : "Reveal flashcard answer"}
                                >
                                  <span className="tiny dim">{kitCardRevealed ? "Answer" : "Question"}</span>
                                  <span>
                                    {kitCardRevealed
                                      ? kitFlashcards[safeKitCardIndex]?.card.back
                                      : kitFlashcards[safeKitCardIndex]?.card.front}
                                  </span>
                                  <span className="tiny dim">
                                    Click to {kitCardRevealed ? "see the question" : "reveal the answer"}
                                  </span>
                                </button>
                                <div className="row row--between">
                                  <Button
                                    size="small"
                                    disabled={safeKitCardIndex === 0}
                                    onClick={() => {
                                      setKitCardIndex((index) => index - 1);
                                      setKitCardRevealed(false);
                                    }}
                                  >
                                    Previous
                                  </Button>
                                  <Button
                                    size="small"
                                    disabled={safeKitCardIndex >= kitFlashcards.length - 1}
                                    onClick={() => {
                                      setKitCardIndex((index) => index + 1);
                                      setKitCardRevealed(false);
                                    }}
                                  >
                                    Next
                                  </Button>
                                </div>
                              </section>
                            ) : null}
                          </div>
                        </CardBody>
                      </Card>
                    </div>
                  ) : null}
                </div></CardBody>
              </Card>
            </section>
          ) : material.filePath ? <div id="material-offline-study" tabIndex={-1}><OfflineStudyPanel material={material} /></div> : null}
        </div>

        <div className="detail__column">
          <Card>
            <CardHeader title="Review status" />
            {!tipsHidden ? <p className="tiny muted" style={{ padding: "var(--space-3) var(--space-5) 0" }}>Choose where you are with this material, and record a review when you finish one.</p> : null}
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
                {!tipsHidden ? <p className="tiny muted">Needs Review and Studying make this material eligible for suggestions in Today's Flight Plan.</p> : null}
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
                {!tipsHidden ? <p className="tiny muted">Records today's date as your last review. Choose your review status separately.</p> : null}
                {material.lastReviewedAt ? (
                  <p className="tiny dim">
                    {formatLocalDay(material.lastReviewedAt, today)
                      ? `Last reviewed ${formatLocalDay(material.lastReviewedAt, today)}.`
                      : "Reviewed before; the date can't be read."}
                  </p>
                ) : (
                  <p className="tiny dim">Not reviewed yet.</p>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Details" />
            {!tipsHidden ? <p className="tiny muted" style={{ padding: "var(--space-3) var(--space-5) 0" }}>See how this material is organized. Use Edit at the top to change its details.</p> : null}
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
                <dd>{formatLocalDay(material.createdAt, today) ?? "Unknown"}</dd>
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

      {studySet || practiceTest ? (
        <ExportStudyDialog
          open={exporting}
          source={{ material, studySet: studySet ?? null, practiceTest: practiceTest ?? null }}
          onClose={() => setExporting(false)}
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
        message={`${importedSet ? `${IMPORT_GUIDE_REGENERATE_WARNING} ` : ""}${aiCheck.reason} ${geminiSendDisclosure(material)}${geminiModelSentence(gemini)}`}
        confirmLabel="Send to Gemini"
        destructive={false}
        {...chooseChapterFirst(() => setConfirmingAi(false))}
        extraActions={
          isPdf ? (
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmingAi(false);
                if (isGeneratingAny || geminiJobs.locked()) return;
                void queueStudyAid();
              }}
            >
              Generate later
            </Button>
          ) : null
        }
        onConfirm={() => {
          setConfirmingAi(false);
          if (isGeneratingAny || geminiJobs.locked()) return;
          void createStudyAid();
        }}
        onCancel={() => setConfirmingAi(false)}
      >
        {!isPdf ? <><label className="field">Target cards
          <select aria-label="Target cards" value={targetCards} onChange={(event) => setTargetCards(Number(event.target.value))}>
            {[20, 40, 60].map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
        <p className="tiny dim">A maximum, not a promise. Short sources may support fewer distinct cards. Completed sets wait for you to save them. Try again resumes any kept draft with the same target.</p></> : <p className="tiny dim">Your guide is built section by section. Finished sections are kept if you stop, and the completed guide waits for you to save it.</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingCards && !isGeneratingAny}
        title="Send this file to Google?"
        message={`${importedSet ? `${IMPORT_CARDS_REGENERATE_WARNING} ` : ""}${aiCheck.reason} ${geminiSendDisclosure(material)}${geminiModelSentence(gemini)}`}
        confirmLabel="Send to Gemini"
        destructive={false}
        {...chooseChapterFirst(() => setConfirmingCards(false))}
        onConfirm={() => {
          setConfirmingCards(false);
          if (isGeneratingAny || geminiJobs.locked()) return;
          void createFlashcards();
        }}
        onCancel={() => setConfirmingCards(false)}
      >
        <label className="field">Target cards
          <select aria-label="Target cards" value={targetCards} onChange={(event) => setTargetCards(Number(event.target.value))}>
            {[20, 40, 60].map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
        <p className="tiny dim">A maximum, not a promise. Short sources may support fewer distinct cards. Completed sets wait for you to save them.{isPdf ? " For PDFs it is one request per 10 cards." : " Try again resumes any kept draft with the same target."}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingPracticeTest && !isGeneratingAny}
        title="Send this file to Google?"
        message={
          practiceTest
            ? `${importedTest ? IMPORT_TEST_REGENERATE_WARNING : "This will replace your current practice test with newly generated questions."} Regenerating closes any unfinished practice session while completed history remains preserved under its original version. ${aiCheck.reason} ${geminiSendDisclosure(material)}${geminiModelSentence(gemini)}`
            : `${aiCheck.reason} ${geminiSendDisclosure(material)}${geminiModelSentence(gemini)}`
        }
        confirmLabel="Send to Gemini"
        destructive={false}
        {...chooseChapterFirst(() => setConfirmingPracticeTest(false))}
        onConfirm={() => {
          setConfirmingPracticeTest(false);
          if (isGeneratingAny || geminiJobs.locked()) return;
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
/** Which model will read the file, added to the "Send this file to Google?" message. */
export function geminiModelSentence(status: GeminiStatus | null): string {
  if (!status || typeof status.model !== "string" || !status.model) return "";
  const name = geminiModelName(status.model);
  return status.choice === "most-capable"
    ? ` It will be read by ${name}, which may use slightly more of your Google credits.`
    : ` It will be read by ${name}.`;
}

export const IMPORT_GUIDE_REGENERATE_WARNING =
  "This will replace your imported study guide and flashcards with AI-generated content.";
export const IMPORT_CARDS_REGENERATE_WARNING =
  "This will replace your imported flashcards with AI-generated cards.";
export const IMPORT_TEST_REGENERATE_WARNING =
  "This will replace your imported practice test with AI-generated content.";

/** Why a new or replacement Gemini study aid cannot be requested right now. */
interface GenerationNotice {
  text: string;
  /** Offer splitting a PDF that is too large to send whole. */
  split?: boolean;
  /** Link to Settings, where Gemini is connected. */
  settings?: boolean;
  /** Offer queueing a study guide for later when offline. */
  queueLater?: boolean;
}

function GenerationNoticeView({
  notice,
  onSplit,
  onQueueLater,
}: {
  notice: GenerationNotice;
  onSplit: () => void;
  onQueueLater?: () => void;
}) {
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
      {notice.queueLater && onQueueLater ? (
        <div>
          <Button variant="secondary" onClick={onQueueLater}>
            Generate later
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
