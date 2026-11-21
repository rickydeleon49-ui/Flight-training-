import { Link } from "react-router-dom";
import { deviceCan } from "@/services/platform";
import { AlertIcon, Button, Card, CardBody, CardHeader, DocumentIcon, Select } from "@/components/ui";
import { MATERIAL_TYPE_LABELS, PRIORITY_LABELS, REVIEW_STATUS_LABELS, REVIEW_STATUS_OPTIONS, TOPIC_LABELS } from "@/domain/types";
import { formatLocalDay, nowIso } from "@/lib/dates";
import { canHandleFiles, formatFileSize } from "@/services/documents";
import { SplitLineageDetails } from "./SplitLineageDetails";
import { GuideBody } from "./GuideBody";
import { OfflineStudyPanel } from "./OfflineStudyPanel";
import { AuthorBadge } from "./StudySetEditor";
import { PdfItemLabel, PDF_KIT_LABEL, PDF_KIT_REMINDER } from "./PdfItemLabel";
import { SourcePageBadge } from "./navigation/SourcePageBadge";
import { RelatedStudy } from "./RelatedStudy";
import type { MaterialDetailCtx } from "./materialDetailCtx";

export function MaterialMoreTab({ ctx }: { ctx: MaterialDetailCtx }) {
  const {
  location, tab, data, mutate, today, tipsHidden,
  fileMissing, setExporting, openError, restoringFile, setKitCardIndex, kitCardRevealed,
  setKitCardRevealed, kitCardFace, material, studySet, kitSections, guideFlashcards,
  kitFlashcards, hasKitItems, safeKitCardIndex, linkTarget, practiceTest, helper,
  isPdf, goal, event, revealStoredFile, restoreFile,
  } = ctx;
  return (
    <>
          <h2 id="material-panel-heading-more" tabIndex={-1} className="visually-hidden material-panel-heading">More</h2>
          <div className="detail__column">
          <p className="small muted">Less-used tools for this file.</p>
          {deviceCan().sharePrint && (studySet || practiceTest) ? <Card><CardBody><Button onClick={() => setExporting(true)}>{deviceCan().revealFiles ? "Export or print" : "Save to Files"}</Button></CardBody></Card> : null}
          <RelatedStudy key={material.id} materialId={material.id} initiallyOpen={tab === "more"} />
          <Card>
            <CardHeader title="Details and review status" />
            {!tipsHidden ? <p className="tiny muted material-detail__intro">Choose where you are with this material, and record a review when you finish one.</p> : null}
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
                {!tipsHidden ? <p className="tiny muted">Review again and Studying make this material eligible for suggestions in Today's Flight Plan.</p> : null}
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
          {material.filePath ? (
            <div id="material-file-details" tabIndex={-1}><Card>
              <CardHeader title="File details" />
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
                    {!canHandleFiles() ? <p className="tiny muted">Split and open options: Works in the desktop app.</p> : null}
                  </div>
                </div>
                {deviceCan().splitFiles && fileMissing ? (
                  <div className="row row--between row--wrap material-detail__mt-3">
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
                  <div className="row row--between row--wrap material-detail__mt-3">
                    <p className="field__error">{openError}</p>
                    {deviceCan().revealFiles && !fileMissing ? (
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

          {/* Reading the PDF's text sits with the other tools, above the reference cards (QUICKFIX-01). */}
          {isPdf && (material.filePath || hasKitItems) ? (
            <section id="material-mac-backup" tabIndex={-1} aria-label="On this Mac (backup)">
              <Card>
                <CardHeader title="On this Mac (backup)" headingId="material-backup-heading" />
                {deviceCan().pdfKit && !tipsHidden && material.filePath ? <p className="tiny muted material-detail__intro">No internet, or don't want to use {helper}? Read this PDF's text and make a study kit right on your Mac.</p> : null}
                <CardBody><div className="stack stack--4">
                  {deviceCan().pdfKit && material.filePath ? <>
                    <div id="material-offline-study" tabIndex={-1}><OfflineStudyPanel material={material} focusRequested={tab === "more" && location.hash === "#read-pdf-text"} /></div>
                  </> : null}
                  {hasKitItems ? (
                    <div id="material-saved-pdf-kit" tabIndex={-1}>
                      <Card>
                        <CardHeader title="Your study kit" />
                        <CardBody>
                          <div className="stack stack--5">
                            {kitSections.length > 0 ? (
                              <section className="stack stack--3" aria-labelledby="kit-sections-title">
                                <div>
                                  <p className="eyebrow">Study guide</p>
                                  <h4 id="kit-sections-title" className="ai-guide__title">{studySet?.title}</h4>
                                  <p className="tiny muted">{PDF_KIT_LABEL}</p>
                                  <p className="tiny muted">Study aid. {PDF_KIT_REMINDER}</p>
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
                                          <PdfItemLabel sectionLabelled provenance={section.pdfProvenance} origin={section.origin} />
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
                                <p className="tiny muted">{PDF_KIT_LABEL}</p>
                                <p className="tiny muted">Study aid. {PDF_KIT_REMINDER}</p>
                                <div className="row row--between row--wrap">
                                  <div>
                                    <p className="eyebrow">Flashcards</p>
                                    <h4 id="kit-flashcards-title" className="ai-guide__title">
                                      {guideFlashcards.length > 0 ? "PDF card" : "Card"} {safeKitCardIndex + 1} of {kitFlashcards.length}
                                    </h4>
                                  </div>
                                  <div className="row row--wrap">
                                    {kitFlashcards[safeKitCardIndex]?.card.pdfProvenance ? (
                                      <PdfItemLabel sectionLabelled
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
                                  ref={kitCardFace}
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
          ) : material.filePath ? <div id="material-offline-study" tabIndex={-1}><OfflineStudyPanel material={material} focusRequested={tab === "more" && location.hash === "#read-pdf-text"} /></div> : null}
          <Card>
            <CardHeader title="Details" />
            {!tipsHidden ? <p className="tiny muted material-detail__intro">See how this material is organized. Use Edit under File to change its details.</p> : null}
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
                <div className="tag-list material-detail__mt-4">
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
    </>
  );
}
