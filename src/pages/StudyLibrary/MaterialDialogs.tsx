import { providerCompany, providerWording } from "@/services/provider";
import { ActionFormDialog, type ActionDraft } from "@/components/actions/ActionFormDialog";
import { deviceCan } from "@/services/platform";
import { Button, ConfirmDialog, Dialog } from "@/components/ui";
import { newId } from "@/lib/id";
import { removeMaterialWithFile } from "@/services/documents";
import { MaterialFormDialog } from "./MaterialFormDialog";
import { AskGeminiPanel } from "./AskGeminiPanel";
import { markDeletedOnPurpose } from "@/components/gemini/GeminiOrphanNotices";
import { ManualSplitDialog } from "./ManualSplitDialog";
import { SplitPdfDialog } from "./SplitPdfDialog";
import { SplitByChapterDialog } from "./SplitByChapterDialog";
import { ExportCenterDialog } from "./ExportCenterDialog";
import { ExportStudyDialog } from "./ExportStudyDialog";
import { GUIDE_PACK_CARDS } from "@/state/GeminiJobs";
import { VisualCardEditor } from "./VisualCardEditor";
import { TARGET_CARD_COUNTS, TargetCardCount, KIT_REPLACE_NOTE } from "./materialDetailShared";
import { geminiModelSentence, IMPORT_GUIDE_REGENERATE_WARNING, IMPORT_CARDS_REGENERATE_WARNING, IMPORT_TEST_REGENERATE_WARNING } from "./MaterialDetailNotices";
import type { MaterialDetailCtx } from "./materialDetailCtx";

export function MaterialDialogs({ ctx }: { ctx: MaterialDetailCtx }) {
  const {
  askingPdf, closeAskPdf, navigate, data, deleteWithUndo,
  refresh, operations, editing, setEditing, confirmingDelete, setConfirmingDelete,
  addingAction, setAddingAction, fileMissing, splitting, setSplitting, exporting,
  setExporting, exportingCsv, setExportingCsv, splittingManually, setSplittingManually, splittingByChapter,
  setSplittingByChapter, kitQueue, gemini, coveringLabel, setCoveringLabel, setPictureSaved,
  editingVisualIndex, setEditingVisualIndex, affectedVisual, targetCards, setTargetCards, confirmingAi,
  setConfirmingAi, confirmingPracticeTest, setConfirmingPracticeTest, confirmingKit, setConfirmingKit, setKitMessage,
  splitNote, setSplitNote, confirmingDiscardAll, setConfirmingDiscardAll, discardingAll, setDiscardingAll,
  unfinishedPractice, confirmingCards, setConfirmingCards, confirmingMoreCards, setConfirmingMoreCards, geminiJobs,
  discardableKitDrafts, material, studySet, visualFlashcards, practiceTest, csvExportSources,
  importedSet, importedTest, chapterOutline, helper, aiCheck, sendDisclosure,
  isPdf, isOverLimit, tooBig, pdfAskConversationKey, pdfContext, canSplit,
  chooseChapterFirst, canOfferGemini, generationNotice, isGeneratingAny, hasSavedGuide, savedCardCount,
  replaceCardsWarning, replaceGuideWarning, saveMaterial, preflight, kitReplacesSaved,
  createStudyAid, queueStudyAid, createFlashcards, createMoreCards, createPracticeTest,
  } = ctx;
  return (
    <>
      {isPdf && material.filePath ? (
            <Dialog open={askingPdf} onClose={closeAskPdf} title="Ask about this PDF" className="material-ask-dialog">
            <div id="material-ask-gemini">
                {!aiCheck.allowed ? (
                  <p className="small muted">{aiCheck.reason}</p>
                ) : isOverLimit ? (
                  <p className="small muted">{tooBig}</p>
                ) : !canOfferGemini || fileMissing ? (
                  <p className="small muted">
                    {fileMissing
                      ? providerWording("This PDF's file is missing, so Gemini can't read it.", gemini?.model)
                      : !gemini?.configured
                        ? (deviceCan().generate ? `Connect ${helper} in Settings to ask questions about this PDF.` : "Asking questions about this PDF is not available on this phone.")
                        : providerWording(generationNotice?.text ?? "Gemini isn't available for this PDF right now.", gemini?.model)}
                  </p>
                ) : (
                  <>
                    <p className="small muted">{providerWording("Ask Gemini a question about this PDF. It answers from the pages and shows which pages it used.", gemini?.model)}</p>
                    {askingPdf ? <AskGeminiPanel
                      key={pdfAskConversationKey}
                      materialId={material.id}
                      relativePath={material.filePath ?? null}
                      context={pdfContext}
                      buttonLabel="Ask"
                      initiallyOpen
                      onClose={closeAskPdf}
                      hideClose
                      evidenceMode
                    /> : null}
                  </>
                )}
            </div></Dialog>
      ) : null}

      <ConfirmDialog open={confirmingDiscardAll} title="Discard all drafts?"
        message="Discard all drafts? Your saved material stays."
        confirmLabel="Discard all drafts" pending={discardingAll} pendingLabel="Discarding…"
        onCancel={() => setConfirmingDiscardAll(false)} onConfirm={() => {
          if (discardingAll) return;
          setDiscardingAll(true);
          void (async () => {
            try { for (const job of discardableKitDrafts) await geminiJobs.dismiss(job.key); }
            finally { setDiscardingAll(false); setConfirmingDiscardAll(false); }
          })();
        }} />
      {deviceCan().sharePrint && exportingCsv ? <ExportCenterDialog open initialOutput="csv" sources={csvExportSources} onClose={() => setExportingCsv(false)} /> : null}

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

      {deviceCan().sharePrint && (studySet || practiceTest) ? (
        <ExportStudyDialog
          open={exporting}
          source={{ material, studySet: studySet ?? null, practiceTest: practiceTest ?? null }}
          onClose={() => setExporting(false)}
          onFlashcardCsv={() => { setExporting(false); setExportingCsv(true); }}
        />
      ) : null}

      {canSplit && chapterOutline ? (
        <SplitByChapterDialog
          open={splittingByChapter}
          material={material}
          outline={chapterOutline}
          onClose={() => setSplittingByChapter(false)}
          onCreated={(ids) => {
            setSplittingByChapter(false);
            // Offer one study kit per new chapter, with a single consent screen.
            if (kitQueue && deviceCan().generate && gemini?.configured && ids.length > 0) kitQueue.offer(ids);
            navigate("/study");
          }}
        />
      ) : null}

      {canSplit ? (
        <ManualSplitDialog
          open={splittingManually}
          material={material}
          note={splitNote}
          onClose={() => { setSplittingManually(false); setSplitNote(undefined); }}
          onCreated={(materialId) => {
            setSplittingManually(false);
            setSplitNote(undefined);
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

      <ConfirmDialog open={confirmingKit}
        notice={unfinishedPractice ? `You have an unfinished practice test (${unfinishedPractice.answered} of ${unfinishedPractice.total} answered). Finish or abandon it before the new questions can be saved; the guide and flashcards can be saved right away.` : undefined}
        title={`Send this file to ${providerCompany(gemini?.model)}?`}
        message={`${aiCheck.reason} ${sendDisclosure.message}${geminiModelSentence(gemini)} You review and save each part separately.${kitReplacesSaved ? ` ${KIT_REPLACE_NOTE}` : ""}`}
        details={sendDisclosure.details} detailsSummary="What the provider keeps" confirmLabel="Make my study kit" destructive={false}
        {...chooseChapterFirst(() => setConfirmingKit(false))}
        onCancel={() => setConfirmingKit(false)} onConfirm={() => {
          setConfirmingKit(false);
          if (material.filePath) void geminiJobs.startKit({materialId: material.id, filePath: material.filePath}, {preflight: preflight(material.filePath)}).then(message => { if (message) setKitMessage(message); });
        }} />

      <ConfirmDialog
        open={confirmingAi}
        title={`Send this file to ${providerCompany(gemini?.model)}?`}
        message={`${importedSet ? `${IMPORT_GUIDE_REGENERATE_WARNING} ` : ""}${replaceGuideWarning}${aiCheck.reason} ${sendDisclosure.message}${geminiModelSentence(gemini)}`}
        details={sendDisclosure.details}
        detailsSummary="What Google keeps"
        confirmLabel={`Send to ${providerCompany(gemini?.model) === "Anthropic" ? "Claude" : "Gemini"}`}
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
          void createStudyAid();
        }}
        onCancel={() => setConfirmingAi(false)}
      >
        {!hasSavedGuide ? <p className="tiny dim">Along with the guide, this makes {isPdf ? `${GUIDE_PACK_CARDS} flashcards` : "flashcards"} and a short study test. You can make 10 more cards any time.</p> : null}
        {!isPdf ? <><label className="field">Target cards
          <select aria-label="Target cards" value={targetCards} onChange={(event) => setTargetCards(Number(event.target.value) as TargetCardCount)}>
            {TARGET_CARD_COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
        <p className="tiny dim">Short sources may give you fewer cards.</p></> : <p className="tiny dim">If you stop, any finished part is kept.</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingCards}
        title={`Send this file to ${providerCompany(gemini?.model)}?`}
        message={`${replaceCardsWarning || (importedSet ? `${IMPORT_CARDS_REGENERATE_WARNING} ` : "")}${aiCheck.reason} ${sendDisclosure.message}${geminiModelSentence(gemini)}`}
        details={sendDisclosure.details}
        detailsSummary="What Google keeps"
        confirmLabel={`Send to ${providerCompany(gemini?.model) === "Anthropic" ? "Claude" : "Gemini"}`}
        destructive={false}
        {...chooseChapterFirst(() => setConfirmingCards(false))}
        onConfirm={() => {
          setConfirmingCards(false);
          void createFlashcards();
        }}
        onCancel={() => setConfirmingCards(false)}
      >
        <label className="field">Target cards
          <select aria-label="Target cards" value={targetCards} onChange={(event) => setTargetCards(Number(event.target.value) as TargetCardCount)}>
            {TARGET_CARD_COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
        <p className="tiny dim">Short sources may give you fewer cards.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingMoreCards}
        title={`Send this file to ${providerCompany(gemini?.model)}?`}
        message={`This adds up to 10 new cards to the ${savedCardCount} you have; nothing is replaced. ${aiCheck.reason} ${sendDisclosure.message}${geminiModelSentence(gemini)}`}
        details={sendDisclosure.details}
        detailsSummary="What Google keeps"
        confirmLabel={`Send to ${providerCompany(gemini?.model) === "Anthropic" ? "Claude" : "Gemini"}`}
        destructive={false}
        {...chooseChapterFirst(() => setConfirmingMoreCards(false))}
        onConfirm={() => {
          setConfirmingMoreCards(false);
          void createMoreCards();
        }}
        onCancel={() => setConfirmingMoreCards(false)}
      />

      <ConfirmDialog
        open={confirmingPracticeTest}
        notice={unfinishedPractice ? `You have an unfinished practice test (${unfinishedPractice.answered} of ${unfinishedPractice.total} answered). Making new questions ends it.` : undefined}
        title={`Send this file to ${providerCompany(gemini?.model)}?`}
        message={
          practiceTest
            ? `${importedTest ? IMPORT_TEST_REGENERATE_WARNING : "This will replace your current practice test with newly generated questions."} Regenerating closes any unfinished practice session while completed history remains preserved under its original version. ${aiCheck.reason} ${sendDisclosure.message}${geminiModelSentence(gemini)}`
            : `${aiCheck.reason} ${sendDisclosure.message}${geminiModelSentence(gemini)}`
        }
        details={sendDisclosure.details}
        detailsSummary="What Google keeps"
        confirmLabel={`Send to ${providerCompany(gemini?.model) === "Anthropic" ? "Claude" : "Gemini"}`}
        destructive={false}
        {...chooseChapterFirst(() => setConfirmingPracticeTest(false))}
        onConfirm={() => {
          setConfirmingPracticeTest(false);
          void createPracticeTest();
        }}
        onCancel={() => setConfirmingPracticeTest(false)}
      />

      {coveringLabel ? <VisualCardEditor material={material} onSaved={() => setPictureSaved(true)} onClose={() => setCoveringLabel(false)} /> : null}
      {editingVisualIndex !== null ? (
        <VisualCardEditor material={material} cardIndex={editingVisualIndex} onSaved={() => setPictureSaved(true)} onClose={() => setEditingVisualIndex(null)} />
      ) : null}
      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this material?"
        message={`Its notes, tags and links are removed. The file is deleted from this application's private storage. This also removes its card review history.${isPdf ? " Page pictures stay in your library until you delete them." : ""}${
          visualFlashcards.length
            ? ` Its ${visualFlashcards.length} picture card${visualFlashcards.length === 1 ? " is" : "s are"} removed too.`
            : ""
        }${
          affectedVisual.length
            ? ` These picture cards will become unavailable; their history is kept: ${affectedVisual.join("; ")}. Earlier exported backups still contain their saved content.`
            : ""
        }`}
        onConfirm={() => {
          setConfirmingDelete(false);
          markDeletedOnPurpose(material.id);
          // Unmount flushes notes so Undo restores the latest typing too.
          deleteWithUndo({
            ids: [material.id],
            label: material.title,
            // Product decision: Deleting a locked file fails safely so the record
            // and file never get out of step. The old record-first order could leave
            // orphaned files or mismatched storage; having the material reappear
            // after the undo window if the file was locked is an accepted trade-off.
            run: async (repos) => {
              try {
                await removeMaterialWithFile(repos, material);
              } catch (error) {
                await refresh().catch(() => {});
                throw error;
              }
            },
          });
          navigate("/study");
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}
