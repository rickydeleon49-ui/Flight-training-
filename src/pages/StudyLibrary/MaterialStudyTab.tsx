import { MaterialVideoLinks } from "./MaterialVideoLinks";
import { WaitingAnswerLinks } from "./WaitingAnswerLinks";
import { ScannedPdfNote } from "./ScannedPdfNote";
import { providerWording } from "@/services/provider";
import { GuideCardRecoveryNotice } from "./GuideCardRecoveryNotice";
import { Link } from "react-router-dom";
import { deviceCan } from "@/services/platform";
import { AlertIcon, Button, Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import { geminiModelName } from "@/services/gemini";
import { IMPORTED_CONTENT_DISCLAIMER } from "./ImportStudyPacketDialog";
import { CardReviewPanel } from "./CardReviewPanel";
import { AskGeminiPanel, formatFlashcardContext } from "./AskGeminiPanel";
import { OralScenariosCard } from "./OralScenariosCard";
import { PracticeTestPanel } from "./PracticeTestPanel";
import { GuideBody } from "./GuideBody";
import { StudyContentProvenance } from "./StudyContentProvenance";
import { GeminiErrorText, GeminiJobNotice, GeminiProgressView, GeminiRecoveryNotice } from "./GeminiJobNotice";
import { isMoreCardsJob, MAX_CARDS_MESSAGE } from "@/state/GeminiJobs";
import { MAX_CARDS } from "@/logic/cardIdentity";
import { AuthorBadge, StartManualStudySet, StudySetEditor } from "./StudySetEditor";
import { PracticeTestEditor, PracticeTestHistory } from "./PracticeTestEditing";
import { PracticeRegenerationReviewDialog } from "./PracticeRegenerationReviewDialog";
import { RegenerationReviewDialog } from "./RegenerationReviewDialog";
import { PdfItemLabel, PDF_KIT_REMINDER } from "./PdfItemLabel";
import { SourcePageBadge } from "./navigation/SourcePageBadge";
import { DiagramsStrip } from "./DiagramsStrip";
import { TARGET_CARD_COUNTS, TargetCardCount } from "./materialDetailShared";
import { GenerationNoticeView } from "./MaterialDetailNotices";
import { StudyActionsList } from "./StudyActionsList";
import type { MaterialDetailCtx } from "./materialDetailCtx";

export function MaterialStudyTab({ ctx }: { ctx: MaterialDetailCtx }) {
  const {
  pageNotesAvailable, activePracticeAttempt, materialId, tab, selectTab, cardStartSignal,
  setCardStartSignal, jumpTo, startCardReview, data, repositories, tipsHidden,
  fileMissing, setExporting, restoringFile, gemini, geminiStatusFailed, setCoveringLabel,
  pictureSaved, setEditingVisualIndex, targetCards, setTargetCards, setConfirmingAi, setCardIndex,
  cardRevealed, setCardRevealed, guideCardFace, setConfirmingPracticeTest, editingSet, setEditingSet,
  practiceNeedsReview, reviewingPracticeRegeneration, setReviewingPracticeRegeneration, reviewingRegeneration, setReviewingRegeneration, setConfirmingCards,
  setConfirmingMoreCards, reviewingCardRegeneration, setReviewingCardRegeneration, geminiJobs, pausedPractice, handlePracticeAttemptChange,
  studyJob, cardJob, practiceJob, generating, generatingCards, generatingPractice,
  guideStatusLine, cardsStatusLine, setStartRefusal, generationError, cardGenerationError, practiceGenerationError,
  draftWaiting, isMountedRef, material, practiceMetadata, retryPracticeMetadata, conversionStatus,
  completedCount, studySet, cardReview, guideSections, guideFlashcards, kitFlashcards,
  visualFlashcards, safeCardIndex, resetSlot, setResetSlot, flashcardRoute, flashcardReturnTab,
  flashcardCountBefore, linkTarget, practiceTest, importedSet, manualSet, showStudyGuide,
  cardsOnlyManual, setHasHerItems, importedTest, hasImported, helper, fileForAi,
  isPdf, isOverLimit, tooBig, pdfSet, pdfTest, chapterPartIds,
  canOfferGemini, generationNotice, isGeneratingAny, hasSavedGuide, savedCardCount, emptyFailedGuide,
  guideBlockedReason, retryStudy, retryFlashcards, retryPractice,
  restoreFile, kitDraftsWaiting, queueStudyAid, jumpToFileSection, kitMakerAtTop, kitMaker,
  } = ctx;
  return (
    <>
          <h2 id="material-panel-heading-study" tabIndex={-1} className="visually-hidden material-panel-heading">Study</h2>
          <div className="detail__column">
          {isPdf && material.filePath && !fileMissing ? <ScannedPdfNote filePath={material.filePath} /> : null}
          {fileMissing ? <div className="card stack stack--3" role="status">
            <p>This study file is missing. Everything you wrote is still here.</p>
            {deviceCan().splitFiles ? <Button disabled={restoringFile} onClick={() => void restoreFile()}>{restoringFile ? "Restoring…" : "Find and restore file"}</Button> : null}
          </div> : null}
          {!material.filePath && !studySet && chapterPartIds.length > 0 ? <p className="small muted" role="status">This book's chapters are listed under it in your library.</p> : null}
          {!material.filePath && !studySet && chapterPartIds.length === 0 ? <Card><CardBody>
            <p className="small muted">Write a study guide in your own words.</p>
            <StartManualStudySet material={material} />
          </CardBody></Card> : null}
          {kitMakerAtTop && kitMaker ? <Card>{kitMaker}</Card> : null}
          {studySet || practiceTest ? <StudyActionsList
            review={cardReview}
            hasGuide={hasSavedGuide}
            guideReachable={showStudyGuide}
            hasCards={Boolean(studySet && studySet.flashcards.length > 0)}
            cardsReachable={Boolean(material.filePath || (studySet && studySet.flashcards.length > 0))}
            questionCount={practiceTest?.questions.length ?? 0}
            pausedPractice={pausedPractice}
            onReview={() => { setCardStartSignal((n) => n + 1); jumpTo("material-flashcards"); }}
            onJump={jumpTo}
          /> : null}
          {showStudyGuide ? (
            <div id="material-study-guide" tabIndex={-1}>
              <Card>
                <CardHeader
                  title={isPdf ? "Study guide" : pdfSet ? "Your PDF study kit" : importedSet ? "Imported study packet" : manualSet ? "Your study guide" : providerWording("Gemini study assistant", gemini?.model)}
                  headingId="material-guide-heading"
                  eyebrow={
                    importedSet
                      ? "Imported from a file you selected"
                      : manualSet
                        ? (deviceCan().revealFiles ? "Written by you, saved on this computer" : "Written by you, saved on this phone")
                        : studySet?.summary || guideSections.length
                          ? (deviceCan().revealFiles ? "Saved on this computer" : "Saved on this phone")
                          : undefined
                  }
                  action={
                    <div className="row row--wrap">
                      {deviceCan().editStudyMaterial && studySet && (studySet.summary || studySet.sections.length > 0 || studySet.flashcards.length > 0) ? (
                        <Button
                          size="small"
                          variant="secondary"
                          aria-pressed={editingSet}
                          disabled={isGeneratingAny}
                          onClick={() => setEditingSet((open) => !open)}
                        >
                          {editingSet ? "Done editing" : studySet.summary || studySet.sections.length > 0 ? "Edit study guide" : "Edit cards"}
                        </Button>
                      ) : null}
                      {deviceCan().sharePrint && (studySet || practiceTest) ? (
                        <Button size="small" variant="secondary" disabled={isGeneratingAny} onClick={() => setExporting(true)}>
                          {deviceCan().revealFiles ? "Share or print" : "Save to Files"}
                        </Button>
                      ) : null}
                      {deviceCan().splitFiles && isOverLimit ? (
                        <Button size="small" variant="secondary" onClick={jumpToFileSection}>
                          Split file
                        </Button>
                      ) : canOfferGemini ? (
                        <Button
                          size="small"
                          variant={isPdf || (studySet && (studySet.summary || guideSections.length > 0)) ? "secondary" : "primary"}
                          disabled={isGeneratingAny || fileMissing || draftWaiting(studyJob?.phase) || (Boolean(studyJob?.sectionGuide) && !emptyFailedGuide)}
                          onClick={() => {
                            if (geminiJobs.locked()) {
                                setStartRefusal({ kind: "study-aid", message: "Gemini is already working or checking earlier work. Try again in a moment." });
                              } else setConfirmingAi(true);
                          }}
                        >
                          {generating
                            ? studyJob?.phase === "saving" ? "Saving your guide…" : "Reading document…"
                            : studySet && (studySet.summary || guideSections.length > 0)
                              ? "Regenerate"
                              : isPdf
                                ? "Create study guide"
                                : "Create study aid"}
                        </Button>
                      ) : deviceCan().generate && geminiStatusFailed && isPdf && fileForAi.ready && !studyJob?.sectionGuide ? (
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
                {guideStatusLine ? (
                  <p aria-live="polite" className="small material-detail__intro" data-guide-status>{guideStatusLine}</p>
                ) : null}
                {!tipsHidden && !hasSavedGuide ? (
                  <p className="tiny muted material-detail__intro">
                    {pdfSet
                      ? "Review the guide saved from your PDF text, and follow page references back to the source."
                      : importedSet
                        ? "Review the guide from your imported packet; you can edit it here."
                        : manualSet
                          ? "A study guide you wrote. Use Edit study guide to change sections."
                          : providerWording(`Ask Gemini for a study guide from this file, then review and save the draft on this ${deviceCan().revealFiles ? "computer" : "phone"}.`, gemini?.model)}
                  </p>
                ) : null}
                <CardBody>
                  {deviceCan().generate && isOverLimit ? (
                    <div className="stack stack--3 material-detail__mb-4">
                      <div className="ai-disclaimer" role="alert">
                        <AlertIcon size={16} />
                        <p className="tiny">{tooBig}</p>
                      </div>
                    </div>
                  ) : null}
                  {generating ? (
                    studyJob ? (
                      <GeminiProgressView
                        model={gemini?.model}
                        job={studyJob}
                        title="Gemini is reviewing this document"
                        onCancel={() => void geminiJobs.cancel(studyJob.key)}
                      />
                    ) : null
                  ) : null}
                  {generationError ? (
                    <div className="stack stack--3 material-detail__mt-3">
                      <GeminiErrorText model={gemini?.model} message={generationError} />
                      <WaitingAnswerLinks message={generationError} jobs={geminiJobs.jobs} materials={data.materials} exceptId={materialId} />
                      {retryStudy ? (
                        <div className="row row--wrap">
                          <Button size="small" onClick={retryStudy}>
                            Try again
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <span id="material-guide-draft" />
                  {studyJob ? (
                    <GeminiJobNotice
                      model={gemini?.model}
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
                      <GeminiJobNotice model={gemini?.model} key={job.key} job={job} jobs={geminiJobs} />
                    ))}
                  {guideBlockedReason ? <p className="tiny muted">{guideBlockedReason}</p> : null}
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
                        hideSourceMaterial
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
                  ) : studySet && (editingSet || (manualSet && !studySet.summary && studySet.sections.length === 0 && studySet.flashcards.length === 0)) ? (
                    <div className="stack stack--5">
                      <StudySetEditor material={material} studySet={studySet} />
                    </div>
                  ) : canOfferGemini && !fileMissing && !generating && !hasImported ? (
                    <p className="small muted">
                      {providerWording(isPdf
                        ? "Gemini will read this PDF and write a basic study guide in one go (a very long PDF in a few parts). Nothing is saved until you check the draft and save it."
                        : "Gemini will read only this file and create a source-based study guide. The finished draft waits for you to save it locally.", gemini?.model)}
                    </p>
                  ) : null}

                  {!isOverLimit && generationNotice ? (
                    <GenerationNoticeView
                      notice={{ ...generationNotice, text: providerWording(generationNotice.text, gemini?.model) }}
                      onSplit={jumpToFileSection}
                      onQueueLater={() => void queueStudyAid()}
                    />
                  ) : null}

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
                    <GeminiRecoveryNotice model={gemini?.model} onRetry={geminiJobs.retryRecovery} />
                  ) : null}
                </CardBody>
              </Card>
            </div>
          ) : null}

          {material.filePath || (studySet && studySet.flashcards.length > 0) ? null : (
            <GuideCardRecoveryNotice materialId={material.id} standalone />
          )}
          {material.filePath || (studySet && studySet.flashcards.length > 0) ? (
            <div id="material-flashcards" tabIndex={-1}>
              <Card>
                <CardHeader
                  title="Flashcards"
                  headingId="material-cards-heading"
                  eyebrow={
                    studySet && guideFlashcards.length > 0
                      ? (deviceCan().revealFiles ? "Saved on this computer" : "Saved on this phone")
                      : material.filePath
                        ? "From this document"
                        : "Optional"
                  }
                  action={
                    <div className="row row--wrap material-detail__center">
                      {cardsOnlyManual && deviceCan().editStudyMaterial ? (
                        <Button
                          size="small"
                          variant="secondary"
                          aria-pressed={editingSet}
                          disabled={isGeneratingAny}
                          onClick={() => setEditingSet((open) => !open)}
                        >
                          {editingSet ? "Done editing" : "Edit cards"}
                        </Button>
                      ) : null}
                      {pageNotesAvailable ? <Button size="small" onClick={() => {
                        flashcardRoute.current = true;
                        flashcardReturnTab.current = tab;
                        flashcardCountBefore.current = guideFlashcards.length;
                        selectTab("notes");
                        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>("[data-material-make-card]")?.click());
                      }}>Make a card</Button> : null}
                      {material.filePath && /\.png$/i.test(material.filePath) ? (
                        <Button size="small" onClick={() => setCoveringLabel(true)}>
                          Add a picture card
                        </Button>
                      ) : null}
                      {deviceCan().splitFiles && isOverLimit ? (
                        <Button size="small" variant="secondary" onClick={jumpToFileSection}>
                          Split file
                        </Button>
                      ) : null}
                    </div>
                  }
                />
                {cardsOnlyManual && editingSet && studySet && deviceCan().editStudyMaterial ? (
                  <div className="stack stack--5 material-detail__editor">
                    <StudySetEditor material={material} studySet={studySet} />
                  </div>
                ) : null}
                {canOfferGemini && !(deviceCan().splitFiles && isOverLimit) ? (
                  <div
                    data-gemini-cards
                    className="row row--wrap material-detail__toolbar"
                  >
                    <span className="small muted">Uses {helper}</span>
                          <label className="row row--compact small material-detail__target">
                            Target cards
                            <select
                              aria-label="Target cards"
                              className="select select--small"
                              value={targetCards}
                              onChange={(event) => setTargetCards(Number(event.target.value) as TargetCardCount)}
                            >
                              {TARGET_CARD_COUNTS.map((count) => (
                                <option key={count} value={count}>
                                  {count}
                                </option>
                              ))}
                            </select>
                          </label>
                          <Button
                            size="small"
                            variant="secondary"
                            disabled={isGeneratingAny || fileMissing || draftWaiting(cardJob?.phase)}
                            onClick={() => {
                              if (geminiJobs.locked()) {
                                setStartRefusal({ kind: "flashcards", message: "Gemini is already working or checking earlier work. Try again in a moment." });
                              } else setConfirmingCards(true);
                            }}
                          >
                            {generatingCards ? "Reading document…" : `Make new cards with ${helper}`}
                          </Button>
                          {savedCardCount > 0 ? (
                            <Button
                              size="small"
                              variant="secondary"
                              disabled={isGeneratingAny || fileMissing || draftWaiting(cardJob?.phase) || savedCardCount >= MAX_CARDS}
                              onClick={() => {
                                if (geminiJobs.locked()) {
                                  setStartRefusal({ kind: "flashcards", message: "Gemini is already working or checking earlier work. Try again in a moment." });
                                } else setConfirmingMoreCards(true);
                              }}
                            >
                              Make 10 more cards
                            </Button>
                          ) : null}
                          {savedCardCount >= MAX_CARDS ? <span className="tiny muted">{MAX_CARDS_MESSAGE}</span> : null}
                  </div>
                ) : null}
                {cardsStatusLine ? (
                  <p aria-live="polite" className="small material-detail__intro" data-cards-status>{cardsStatusLine}</p>
                ) : null}
                {!tipsHidden ? (
                  <p className="tiny muted material-detail__intro">
                    Create key flashcards to practice recall, and review cards you've saved.
                  </p>
                ) : null}
                <CardBody>
                  <GuideCardRecoveryNotice materialId={material.id} />
                  {deviceCan().generate && isOverLimit ? (
                    <div className="stack stack--3 material-detail__mb-4">
                      <div className="ai-disclaimer" role="alert">
                        <AlertIcon size={16} />
                        <p className="tiny">{tooBig}</p>
                      </div>
                    </div>
                  ) : null}
                  {generatingCards ? (
                    cardJob ? (
                      <GeminiProgressView
                        model={gemini?.model}
                        job={cardJob}
                        title="Gemini is creating flashcards"
                        onCancel={() => void geminiJobs.cancel(cardJob.key)}
                      />
                    ) : null
                  ) : null}
                  {cardGenerationError ? (
                    <div className="stack stack--3 material-detail__mb-3">
                      <GeminiErrorText model={gemini?.model} message={cardGenerationError} />
                      <WaitingAnswerLinks message={cardGenerationError} jobs={geminiJobs.jobs} materials={data.materials} exceptId={materialId} />
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
                      model={gemini?.model}
                      job={cardJob}
                      jobs={geminiJobs}
                      onRetry={retryFlashcards}
                      onReview={
                        !isMoreCardsJob(cardJob) && (setHasHerItems || cardJob.needsReview) && cardJob.answer
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
                      <CardReviewPanel numberedAction
                        materialId={material.id}
                        materialTitle={material.title}
                        materialFilePath={material.filePath ?? null}
                        repository={repositories?.cardReviews}
                        contentKey={studySet.updatedAt}
                        review={cardReview}
                        autoStart={startCardReview}
                        startSignal={cardStartSignal}
                        quietStart
                        studySet={studySet}
                        browseCard={
                          guideFlashcards[safeCardIndex]
                            ? {
                                index: guideFlashcards[safeCardIndex].originalIndex,
                                front: guideFlashcards[safeCardIndex].card.front,
                                back: guideFlashcards[safeCardIndex].card.back,
                              }
                            : null
                        }
                        resetSlot={resetSlot}
                      />
                      <p className="small" role="status">{pictureSaved ? "Picture card saved." : ""}</p>
                      {guideFlashcards.length > 0 ? (
                        <section
                          id="search-target-cards"
                          className={`stack stack--3${linkTarget?.kind === "card" && !studySet.flashcards[linkTarget.index]?.pdfProvenance ? " search-target" : ""}`}
                          aria-labelledby="flashcards-title"
                        >
                          <div className="row row--between">
                            <div>
                              <h3 id="flashcards-title" className="ai-guide__title">
                                {kitFlashcards.length > 0 ? "Your card" : "Card"} {safeCardIndex + 1} of {guideFlashcards.length}
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
                              <SourcePageBadge source={guideFlashcards[safeCardIndex]?.card.pageSource} page={guideFlashcards[safeCardIndex]?.card.sourcePage} materialId={material.id} />
                            </div>
                          </div>
                          <button
                            ref={guideCardFace}
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
                              sourcePage={guideFlashcards[safeCardIndex].card.sourcePage}
                              buttonLabel="Explain this"
                              initialQuestion="Why is this the answer?"
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
                          {helper} will read this file and create key flashcards with source page references. Choose 20, 40, or 60 cards.
                        </p>
                      ) : null}
                      {visualFlashcards.length > 0 ? (
                        <details className="material-fold">
                          <summary>Edit picture cards ({visualFlashcards.length})</summary>
                          <ul className="visual-card-list">
                            {visualFlashcards.map(({ card, originalIndex }) => (
                              <li key={originalIndex}>
                                <span title={card.front}>{card.front}</span>
                                <Button size="small" onClick={() => setEditingVisualIndex(originalIndex)}>
                                  Edit
                                </Button>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                      <div ref={setResetSlot} />


                    </div>
                  ) : !generatingCards && material.filePath && canOfferGemini ? (
                    <p className="small muted">
                      {helper} will read this file and create key flashcards with source page references. Choose 20, 40, or 60 cards.
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
                        ? (deviceCan().revealFiles ? "Saved on this computer" : "Saved on this phone")
                        : material.filePath
                          ? "Optional, from this document"
                          : "Optional"
                  }
                  action={
                    <div className="row row--wrap">
                      {deviceCan().splitFiles && isOverLimit ? (
                        <Button size="small" variant="secondary" onClick={jumpToFileSection}>
                          Split file
                        </Button>
                      ) : canOfferGemini ? (
                        <Button
                          size="small"
                          variant="secondary"
                          disabled={isGeneratingAny || fileMissing || draftWaiting(practiceJob?.phase)}
                          onClick={() => {
                            if (geminiJobs.locked()) {
                                setStartRefusal({ kind: "practice-test", message: "Gemini is already working or checking earlier work. Try again in a moment." });
                              } else setConfirmingPracticeTest(true);
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
                  <p className="tiny muted material-detail__intro">
                    Try saved questions with explanations; your completed attempts stay in practice history.
                  </p>
                ) : null}
                <CardBody>
                  {deviceCan().generate && isOverLimit ? (
                    <div className="stack stack--3 material-detail__mb-4">
                      <div className="ai-disclaimer" role="alert">
                        <AlertIcon size={16} />
                        <p className="tiny">{tooBig}</p>
                      </div>
                    </div>
                  ) : null}
                  <PracticeTestEditor material={material} activeAttempt={activePracticeAttempt} />
                  <PracticeTestHistory material={material} />
                  {generatingPractice ? (
                    practiceJob ? (
                      <GeminiProgressView
                        model={gemini?.model}
                        job={practiceJob}
                        title="Gemini is writing practice questions"
                        onCancel={() => void geminiJobs.cancel(practiceJob.key)}
                      />
                    ) : null
                  ) : null}
                  {practiceGenerationError ? (
                    <div className="stack stack--3 material-detail__mt-3">
                      <GeminiErrorText model={gemini?.model} message={practiceGenerationError} />
                      <WaitingAnswerLinks message={practiceGenerationError} jobs={geminiJobs.jobs} materials={data.materials} exceptId={materialId} />
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
                      model={gemini?.model}
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
                  {practiceMetadata.phase === "failed" ? (
                    <div className="stack stack--3 material-detail__mb-3">
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
                      <div className="row row--between row--wrap material-detail__center">
                        <div className="ai-disclaimer material-detail__disclaimer">
                          <AlertIcon size={16} />
                          <p className="tiny">
                            {pdfTest
                              ? `Study aid. ${PDF_KIT_REMINDER}`
                              : importedTest
                                ? IMPORTED_CONTENT_DISCLAIMER
                                : practiceTest.provider === "manual"
                                  ? "Practice questions you wrote. Check them against your source and your instructor's guidance."
                                  : `AI-generated practice test${practiceTest.model ? ` (made with ${geminiModelName(practiceTest.model)})` : ""}. Verify every answer against the source, current FAA material, aircraft documents, and your instructor before relying on it.`}
                          </p>
                        </div>
                      </div>

                      <StudyContentProvenance
                        hideSourceMaterial
                        sourceMaterialTitle={material.title}
                        content={practiceTest}
                        kind="practice-test"
                      />

                      <PracticeTestPanel entrySummary
                        onComplete={retryPracticeMetadata}
                        historyAction={completedCount > 0 ? (
                          <Link to={`/study/history/${encodeURIComponent(material.id)}`} className="button button--secondary button--small">
                            View practice history ({completedCount})
                          </Link>
                        ) : null}
                        startHeld={kitDraftsWaiting ? "Save or discard your study kit drafts first, then start the practice test." : undefined}
                        practiceTest={practiceTest}
                        materialId={material.id}
                        key={practiceTest.updatedAt}
                        onAttemptChange={handlePracticeAttemptChange}
                      />
                    </div>
                  ) : !generatingPractice && !hasImported && material.filePath && canOfferGemini ? (
                    <p className="small muted">
                      {helper} will read only this file and create a multiple-choice practice test with
                      explanations. The result will be saved locally with your other data.
                    </p>
                  ) : !generatingPractice && !hasImported && !practiceJob && !practiceGenerationError && practiceMetadata.phase !== "failed" && conversionStatus?.legacyError !== "MALFORMED_QUESTION" ? (
                    <EmptyState compact title="No practice questions yet." />
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

          {!kitMakerAtTop && kitMaker ? <Card>
            <details className="material-fold">
              <summary id="material-study-kit" className="card__header">Make a new study kit</summary>
              {kitMaker}
            </details>
          </Card> : null}
          <div id="material-oral" tabIndex={-1}><OralScenariosCard material={material} /></div>

          <MaterialVideoLinks key={material.id} materialId={material.id} />

          <DiagramsStrip topic={material.topic} />

          </div>
    </>
  );
}
