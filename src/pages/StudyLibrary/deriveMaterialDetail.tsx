import { WaitingAnswerLinks } from "./WaitingAnswerLinks";
import { inspectPdf } from "@/services/pdf";
import { providerCompany } from "@/services/provider";
import { deviceCan } from "@/services/platform";
import { Button, CardBody } from "@/components/ui";
import { actionsFor } from "@/logic/actions";
import { checkAiSubmission, geminiSendDisclosureParts } from "@/logic/aiSafety";
import { checkFileForGemini } from "@/logic/aiLimits";
import { restoreDocumentCopy } from "@/logic/documentRecovery";
import { canHandleFiles, deleteDocument, documentErrorMessage, documentExists, openDocument, pickAndImportDocument, revealDocument } from "@/services/documents";
import { canSplitPdfs } from "@/services/pdf";
import { type MaterialDraft } from "./MaterialFormDialog";
import { GeminiJobNotice, GeminiProgressView } from "./GeminiJobNotice";
import { isMoreCardsJob, isNoNewCardsError } from "@/state/GeminiJobs";
import { pdfAskContext } from "@/logic/pdfAskContext";
import { PdfStudyKitPanel } from "./PdfStudyKitPanel";
import { pdfLabelState } from "@/logic/pdfKitLabels";
import { draftAnchor, KIT_PAGES_NOTE, KIT_DRAFTS_WAITING, EARLIER_DRAFTS_WAITING } from "./materialDetailShared";
import { GenerationNotice } from "./MaterialDetailNotices";
import type { StudyMaterial } from "@/domain/types";
import type { MaterialDetailState } from "./materialDetailCtx";

export function deriveMaterialDetail(s: MaterialDetailState & { material: StudyMaterial }) {
  const {
  materialId, jumpTo, data, mutate, newQuestion, setNewQuestion,
  addingQuestion, setQuestionBusy, fileMissing, setFileMissing, setSplittingManually, setOpenError,
  setRestoringFile, gemini, geminiStatusFailed, targetCards, setConfirmingAi, setCardIndex,
  setCardRevealed, setPracticeJustSaved, setConfirmingPracticeTest, practiceNeedsReview, setConfirmingKit, kitMessage,
  setKitMessage, kitDraftAnchor, setKitDraftAnchor, setSplitNote, savingKit, setSavingKit,
  setConfirmingDiscardAll, discardingAll, setConfirmingCards, setConfirmingMoreCards, geminiJobs, waitingKitDrafts,
  discardableKitDrafts, studyJob, kitJob, cardJob, practiceJob, setStartRefusal,
  geminiBusy, draftWaiting, isMountedRef, material, studySet, practiceTest,
  setHasHerItems,
  } = s;

  // Nothing reaches Google without passing this, and without the student's saying yes.
  const helper = providerCompany(gemini?.model) === "Anthropic" ? "Claude" : "Gemini";
  const aiCheck = checkAiSubmission(material, data.toolkit.credentials, "file", providerCompany(gemini?.model));
  const sendDisclosure = geminiSendDisclosureParts(material, providerCompany(gemini?.model));
  // Whether Google would read it at all. Answered here rather than after a
  // click and an upload, so an oversized handbook is a next step and not a
  // wasted wait.
  const fileForAi = checkFileForGemini(
    material.originalFileName ?? material.filePath ?? "",
    material.fileSize,
    helper,
  );
  // A handbook Google will not read can still be studied a chapter at a time.
  const isPdf = (material.originalFileName ?? material.filePath ?? "")
    .toLowerCase()
    .endsWith(".pdf");
  const isOverLimit = Boolean(isPdf && !fileForAi.ready);
  const tooBig = deviceCan().splitFiles
    ? `This PDF is too big for ${helper} — split it first.`
    : `This PDF is too big for ${helper}. Split it on your Mac first.`;
  const pdfAskConversationKey = JSON.stringify([
    material.id,
    material.filePath,
    material.fileSize,
    material.updatedAt,
  ]);
  const pdfContext = pdfAskContext(material.title, studySet?.summary);
  const pdfSet = pdfLabelState(studySet);
  const pdfTest = pdfLabelState(practiceTest);
  // Chapters already split out of this book (also those split in earlier versions).
  const chapterPartIds = data.materials
    .filter((candidate) => candidate.filePath && candidate.lineage?.rootMaterialId === material.id)
    .map((candidate) => candidate.id);
  const canSplit = Boolean(material.filePath) && isPdf && !fileMissing && canSplitPdfs() && deviceCan().splitFiles;
  // Before a PDF is sent, narrowing it to a chapter is a deliberate choice
  // (GEN-REL-01): it opens the existing page chooser and sends nothing. The
  // new part is generated only after its own explicit Send.
  const chooseChapterFirst = (closeConfirmation: () => void) =>
    canSplit
      ? {
          secondaryLabel: "Choose fewer pages to send",
          onSecondary: () => {
            closeConfirmation();
            setSplittingManually(true);
          },
        }
      : {};
  // Whether Gemini can be offered this file at all; a missing file only disables
  // the button, so a file that reappears does not need a reload.
  const canOfferGemini = deviceCan().generate && Boolean(gemini?.configured) && aiCheck.allowed && fileForAi.ready;
  // Why a new or replacement study aid cannot be requested right now. This
  // never hides what is already saved: reading a saved guide, flipping cards
  // and taking a saved practice test need no connection and send nothing.
  const generationNotice: GenerationNotice | null = !aiCheck.allowed
    ? { text: aiCheck.reason }
    : !fileForAi.ready
      ? { text: isPdf ? tooBig : fileForAi.reason, split: canSplit }
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
              ? { text: (providerCompany(gemini?.model) === "Anthropic" ? "Connect Claude in Settings to create or regenerate study aids from this document. Anything already saved stays available." : "Connect the free Gemini API in Settings to create or regenerate study aids from this document. Anything already saved stays available."), settings: true }
              : geminiJobs.recovery !== "ready"
                ? { text: "Gemini is still checking earlier work. Try again in a moment." }
                : null;
  const isGeneratingAny = geminiBusy;
  // What a send will replace, and where earlier versions really can be found:
  // Previous versions lives under Edit study guide, which needs a guide.
  const hasSavedGuide = Boolean(studySet && (studySet.summary || studySet.sections.length > 0));
  const savedCardCount = studySet?.flashcards.length ?? 0;
  // Each replaced set is kept whole in Previous versions, so Restore there
  // brings these cards back (QUICKFIX-01: say so for cards, not "versions").
  const replaceCardsWarning = savedCardCount
    ? hasSavedGuide
      ? `This replaces your ${savedCardCount} saved ${savedCardCount === 1 ? "card" : "cards"}; to get ${savedCardCount === 1 ? "it" : "them"} back, choose Restore in Edit study guide → Previous versions. `
      : `This replaces your ${savedCardCount} saved ${savedCardCount === 1 ? "card" : "cards"}. `
    : "";
  const replaceGuideWarning = hasSavedGuide
    ? "This replaces your saved study guide; earlier versions stay in Edit study guide → Previous versions. "
    : "";
  const emptyFailedGuide = Boolean(studyJob?.sectionGuide && studyJob.sections?.ready === 0 &&
    (studyJob.phase === "failed" || studyJob.phase === "cancelled" || studyJob.phase === "interrupted"));
  // Why Regenerate / Create is unavailable, in the student's words (CARDS-FIX-01).
  const guideBlockedReason = (() => {
    if (isOverLimit || !canOfferGemini || isGeneratingAny || !studyJob) return null;
    if (draftWaiting(studyJob.phase)) return "A new guide is waiting above — save or discard it first.";
    if (!studyJob.sectionGuide || emptyFailedGuide) return null;
    if (studyJob.phase === "waiting-for-her" || studyJob.queueState === "waiting-for-her")
      return "Your study guide draft above is waiting — continue or discard it first.";
    if (studyJob.phase === "cancelled" || studyJob.queueState === "cancelled")
      return "You stopped the study guide draft above — continue or discard it first.";
    if (studyJob.phase === "failed" || studyJob.phase === "interrupted")
      return "The study guide draft above didn't finish — try again or discard it first.";
    return "Finish or discard the study guide draft above first.";
  })();
  // Stage-appropriate recovery (GEN-REL-04): trying again goes through the
  // usual Send confirmation. A PDF already prepared with Google is reused, so
  // only the generation is repeated.
  const retryStudy =
    canOfferGemini && !isGeneratingAny && !fileMissing ? () => setConfirmingAi(true) : undefined;
  // A failed "Make 10 more cards" is retried as more cards (append), never as a
  // whole new set; "nothing new" offers no retry at all.
  const cardJobIsMore = !!cardJob && isMoreCardsJob(cardJob);
  const retryFlashcards =
    canOfferGemini && !isGeneratingAny && !fileMissing && !(cardJobIsMore && isNoNewCardsError(cardJob?.error))
      ? () => (cardJobIsMore ? setConfirmingMoreCards(true) : setConfirmingCards(true))
      : undefined;
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
    if (!text || addingQuestion.current) return;
    addingQuestion.current = true;
    setQuestionBusy(true);
    try {
      const result = await mutate((repos) =>
        repos.questions.create({ text, topic: material.topic, materialId: material.id }),
      );
      if (result === null) return;
      setNewQuestion("");
    } finally {
      addingQuestion.current = false;
      setQuestionBusy(false);
    }
  };

  const open = async () => {
    if (!material.filePath) return;
    setOpenError(null);
    try {
      if (deviceCan().revealFiles) await openDocument(material.filePath, material.title);
      else await openDocument(material.filePath, material.title, material.id);
    } catch (error) {
      setOpenError(documentErrorMessage(error, "That file could not be opened."));
      jumpTo("material-file-details");
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

  // All three kit parts ready, none replacing anything the student edited: one Save
  // runs each part's own safe save in turn. A part that cannot be saved stays
  // as a draft with its own message; the others stay saved.
  const kitParts = [studyJob, cardJob, practiceJob];
  const canSaveWholeKit = !setHasHerItems && !practiceNeedsReview && kitParts.every((job) =>
    job?.studyKitPart && job.answer && job.phase === "recovered" && !job.needsReview && !job.reviewed);
  const saveWholeKit = async () => {
    setSavingKit(true);
    try {
      for (const job of kitParts) if (job) await geminiJobs.saveAgain(job.key);
    } finally { setSavingKit(false); }
  };
  const kitReplacesSaved = Boolean(
    (studySet && (studySet.sections.length > 0 || studySet.flashcards.length > 0)) || (practiceTest && practiceTest.questions.length > 0),
  );
  const kitDraftsWaiting = geminiJobs.jobs.some((job) => job.materialId === material?.id && job.studyKitPart && Boolean(job.answer));

  const prepareStudyKit = async () => {
    if (!material?.filePath) return;
    setKitMessage(null);
    setKitDraftAnchor(null);
    // Each refusal comes before the consent dialog, so the student never confirms a
    // request that cannot be sent.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setKitMessage("No internet right now. Press Make my study kit again when you're back online.");
      return;
    }
    const waiting = waitingKitDrafts;
    if (waiting.length > 0) {
      if (waiting.some((job) => job.studyKitPart && job.answer)) {
        setKitMessage(KIT_DRAFTS_WAITING);
      } else {
        setKitMessage(EARLIER_DRAFTS_WAITING);
        setKitDraftAnchor(draftAnchor(waiting[0]!));
      }
      return;
    }
    try {
      const pdf = await inspectPdf(material.filePath);
      if (pdf.pages > 150 || !fileForAi.ready) {
        if (canSplit) {
          setKitMessage(KIT_PAGES_NOTE);
          setSplitNote(KIT_PAGES_NOTE);
          setSplittingManually(true);
        } else {
          // The page chooser is not available here, so name what is.
          setKitMessage(pdf.pages > 150
            ? "This PDF is over 150 pages. Use Create study guide, which makes the guide in parts."
            : "Choose a chapter and try again.");
        }
      } else setConfirmingKit(true);
    } catch { setKitMessage("Could not count this PDF's pages. Choose a chapter and try again."); }
  };

  const createStudyAid = async () => {
    setStartRefusal(null);
    const check = material ? checkAiSubmission(material, data.toolkit.credentials, "file", providerCompany(gemini?.model)) : null;
    if (!material?.filePath || !check?.allowed) {
      setStartRefusal({ kind: "study-aid", message: check?.reason ?? "Attach a study file before asking Gemini." });
      return;
    }
    if (emptyFailedGuide && studyJob) {
      await geminiJobs.dismiss(studyJob.key);
    }
    // The first guide brings 20 flashcards and a practice test; Regenerate is the guide alone.
    const firstGuide = !hasSavedGuide;
    const refusal = await geminiJobs.start(
      "study-aid",
      { materialId: material.id, filePath: material.filePath },
      {
        targetCards,
        preflight: preflight(material.filePath),
        ...(firstGuide ? { followUps: { preflight: preflight(material.filePath) } } : {}),
        onSaved: () => {
          if (isMountedRef.current) {
            setCardIndex(0);
            setCardRevealed(false);
          }
        },
      },
    );
    if (refusal && isMountedRef.current) setStartRefusal({ kind: "study-aid", message: refusal });
  };

  const queueStudyAid = async () => {
    if (!material?.filePath || !checkAiSubmission(material, data.toolkit.credentials, "file", providerCompany(gemini?.model)).allowed) {
      return;
    }
    await geminiJobs.queueGuide({ materialId: material.id, filePath: material.filePath });
  };

  const createFlashcards = async () => {
    setStartRefusal(null);
    const check = material ? checkAiSubmission(material, data.toolkit.credentials, "file", providerCompany(gemini?.model)) : null;
    if (!material?.filePath || !check?.allowed) {
      setStartRefusal({ kind: "flashcards", message: check?.reason ?? "Attach a study file before asking Gemini." });
      return;
    }
    const refusal = await geminiJobs.start(
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
    if (refusal && isMountedRef.current) setStartRefusal({ kind: "flashcards", message: refusal });
  };

  const createMoreCards = async () => {
    setStartRefusal(null);
    const check = material ? checkAiSubmission(material, data.toolkit.credentials, "file", providerCompany(gemini?.model)) : null;
    if (!material?.filePath || !check?.allowed) {
      setStartRefusal({ kind: "flashcards", message: check?.reason ?? "Attach a study file before asking Gemini." });
      return;
    }
    const refusal = await geminiJobs.start(
      "flashcards",
      { materialId: material.id, filePath: material.filePath },
      { moreCards: true, preflight: preflight(material.filePath) },
    );
    if (refusal && isMountedRef.current) setStartRefusal({ kind: "flashcards", message: refusal });
  };

  const createPracticeTest = async () => {
    setStartRefusal(null);
    const check = material ? checkAiSubmission(material, data.toolkit.credentials, "file", providerCompany(gemini?.model)) : null;
    if (!material?.filePath || !check?.allowed) {
      setStartRefusal({ kind: "practice-test", message: check?.reason ?? "Attach a study file before asking Gemini." });
      return;
    }
    const refusal = await geminiJobs.start(
      "practice-test",
      { materialId: material.id, filePath: material.filePath },
      {
        preflight: preflight(material.filePath),
        onSaved: () => { if (isMountedRef.current) setPracticeJustSaved(true); },
      },
    );
    if (refusal && isMountedRef.current) setStartRefusal({ kind: "practice-test", message: refusal });
  };

  const jumpToFileSection = () => jumpTo("material-file-actions");
  const kitMakerAtTop = !studySet || !practiceTest || kitJob?.phase === "running" ||
    Boolean(kitMessage) || canSaveWholeKit || discardableKitDrafts.length > 0;
  const kitMaker = deviceCan().pdfKit && isPdf ? (
    <CardBody>
      <div className="stack stack--3">
        <Button disabled={isGeneratingAny || fileMissing || !gemini?.configured || !aiCheck.allowed || geminiJobs.locked()} onClick={() => void prepareStudyKit()}>Make my study kit</Button>
        <p className="small muted">Makes a basic study guide, flashcards and practice questions in one go. You review everything before it's saved.</p>
        {material.filePath ? <div id="material-pdf-kit" tabIndex={-1}><PdfStudyKitPanel key={material.id} material={material} /></div> : null}
        {kitMessage ? <p role="status">{kitMessage}</p> : null}
        <WaitingAnswerLinks message={kitMessage} jobs={geminiJobs.jobs} materials={data.materials} exceptId={materialId} />
        {kitMessage && kitDraftAnchor ? (
          <div className="row row--wrap">
            <Button size="small" variant="secondary" onClick={() => jumpTo(kitDraftAnchor)}>Show me</Button>
          </div>
        ) : null}
        {canSaveWholeKit || savingKit ? (
          <div className="row row--wrap">
            <Button variant="primary" disabled={savingKit} onClick={() => void saveWholeKit()}>{savingKit ? "Saving…" : "Save all three"}</Button>
            <p className="tiny muted">Saves the study guide, flashcards and practice questions below. You can still save or discard each one on its own.</p>
          </div>
        ) : null}
        {discardableKitDrafts.length >= 2 && !savingKit ? <Button disabled={geminiJobs.busy || savingKit || discardingAll} onClick={() => setConfirmingDiscardAll(true)}>Discard all drafts</Button> : null}
        {kitJob?.phase === "running" ? <GeminiProgressView job={kitJob} title="Making your study kit…" onCancel={() => void geminiJobs.cancel(kitJob.key)} model={gemini?.model} /> : kitJob ? <GeminiJobNotice job={kitJob} jobs={geminiJobs} model={gemini?.model} onRetry={() => void prepareStudyKit()} /> : null}
      </div>
    </CardBody>
  ) : null;
  return {
    material: s.material,
    helper,
    aiCheck,
    sendDisclosure,
    fileForAi,
    isPdf,
    isOverLimit,
    tooBig,
    pdfAskConversationKey,
    pdfContext,
    pdfSet,
    pdfTest,
    chapterPartIds,
    canSplit,
    chooseChapterFirst,
    canOfferGemini,
    generationNotice,
    isGeneratingAny,
    hasSavedGuide,
    savedCardCount,
    replaceCardsWarning,
    replaceGuideWarning,
    emptyFailedGuide,
    guideBlockedReason,
    retryStudy,
    cardJobIsMore,
    retryFlashcards,
    retryPractice,
    relatedActions,
    questions,
    goal,
    event,
    saveMaterial,
    addQuestion,
    open,
    revealStoredFile,
    restoreFile,
    preflight,
    kitParts,
    canSaveWholeKit,
    saveWholeKit,
    kitReplacesSaved,
    kitDraftsWaiting,
    prepareStudyKit,
    createStudyAid,
    queueStudyAid,
    createFlashcards,
    createMoreCards,
    createPracticeTest,
    jumpToFileSection,
    kitMakerAtTop,
    kitMaker,
  };
}
