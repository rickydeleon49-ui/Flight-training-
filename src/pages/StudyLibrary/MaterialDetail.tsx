import { useRef, type ReactNode } from "react";
import { useTab, useTabPanel } from "@react-aria/tabs";
import { type TabListState } from "@react-stately/tabs";
import { mergeProps } from "react-aria";
import { Link, useParams } from "react-router-dom";
import { deviceCan } from "@/services/platform";
import { offlineStudyEnabled } from "@/services/offlineContent";
import { BackToTop } from "@/components/ui/BackToTop";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, Card, CardBody, EmptyState } from "@/components/ui";
import { MATERIAL_TYPE_LABELS, TOPIC_LABELS } from "@/domain/types";
import { canHandleFiles } from "@/services/documents";
import { MATERIAL_TABS, type MaterialTab } from "./materialTabs";
import { MaterialActionsMenu, MoveToFolderItem } from "./MaterialActionsMenu";
import { MoveToDialog } from "./MoveToDialog";
import { MoveToast } from "./ArrangeParts";
import { snapshotPlacements } from "./useUndoMove";
import { MaterialTabChoice, materialTabLabel } from "./materialDetailShared";
import { useMaterialDetailState } from "./useMaterialDetailState";
import { deriveMaterialDetail } from "./deriveMaterialDetail";
import { MaterialStudyTab } from "./MaterialStudyTab";
import { MaterialNotesTab } from "./MaterialNotesTab";
import { MaterialMoreTab } from "./MaterialMoreTab";
import { MaterialDialogs } from "./MaterialDialogs";
import type { MaterialDetailCtx } from "./materialDetailCtx";
import "./studyLibrary.css";

export { geminiModelSentence, IMPORT_GUIDE_REGENERATE_WARNING, IMPORT_CARDS_REGENERATE_WARNING, IMPORT_TEST_REGENERATE_WARNING } from "./MaterialDetailNotices";

export function MaterialDetail() {
  const { materialId } = useParams();
  // Generations belong to the app, not to this page (GEN-REL-02): leaving the
  // page or opening another material never discards one.
  return <MaterialDetailPage key={materialId} />;
}


function MaterialTabButton({ value, state }: { value: MaterialTab; state: TabListState<MaterialTabChoice> }) {
  const ref = useRef<HTMLButtonElement>(null);
  const { tabProps, isSelected } = useTab({ key: value }, state, ref);
  return <button
    {...mergeProps(tabProps, {
      onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          state.setSelectedKey(value);
          document.getElementById(`material-panel-heading-${value}`)?.focus({ preventScroll: true });
        }
      },
    })}
    ref={ref} type="button" id={`material-tab-${value}`}
    aria-controls={`material-panel-${value}`}
    className={`library-tab tab${isSelected ? " is-active" : ""}`}
  >{materialTabLabel(value)}</button>;
}

// Keep every panel mounted so notes, questions and active study sessions survive a switch.
function MaterialTabPanel({ value, state, children }: { value: MaterialTab; state: TabListState<MaterialTabChoice>; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const { tabPanelProps } = useTabPanel({ id: value }, state, ref);
  return <section {...tabPanelProps} ref={ref} id={`material-panel-${value}`}
    aria-labelledby={`material-tab-${value}`} hidden={state.selectedKey !== value}
    // The existing hidden heading remains the explicit Enter/Space focus target.
    tabIndex={undefined}>
    {children}
  </section>;
}

function MaterialDetailPage() {
  const state = useMaterialDetailState();
  const { material } = state;
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
  const ctx: MaterialDetailCtx = { ...state, ...deriveMaterialDetail({ ...state, material }) };
  const {
  setAskingPdf, askPdfButton, navigate, location, tab, selectTab,
  tabState, tabListRef, tabListProps, jumpTo, data, tipsHidden,
  setTipsHidden, setEditing, movingToFolder, setMovingToFolder, movedFrom, libraryFolders,
  undoMove, fileMissing, setSplitting, setSplittingManually, splittingByChapter, setSplittingByChapter,
  kitQueue, setOpenError, gemini, studyJob, cardJob, practiceJob,
  draftWaiting, prepareDelete, studySet, linkTarget, linkFailed, setLinkRetry,
  chapterOutline, isPdf, chapterPartIds, canSplit, open,
  } = ctx;
  return (
    <>
      <BackToTop />
      {/* Opened from the library: go back, so the list returns to where the student was. */}
      <Link className="button button--ghost material-breadcrumb" to="/study" onClick={(event) => {
        if ((location.state as { fromLibrary?: boolean } | null)?.fromLibrary) { event.preventDefault(); navigate(-1); }
      }}>‹ Study Library</Link>
      <div className="material-detail-header">
      <PageHeader
        title={material.title}
        subtitle={<span className="material-header-meta">
          <span>{[
            `${isPdf ? "PDF " : ""}${MATERIAL_TYPE_LABELS[material.materialType]}`,
            TOPIC_LABELS[material.topic],
            studySet && studySet.flashcards.length > 0 ? `${studySet.flashcards.length} card${studySet.flashcards.length === 1 ? "" : "s"}` : null,
            material.originalFileName,
          ].filter(Boolean).join(" · ")}</span>
          {material.tags.map(tag => <span className="tag" key={tag}>{tag}</span>)}
          {fileMissing ? <span className="tag">File missing</span> : null}
          {libraryFolders.folderOf(material.id) ? <span className="tiny muted material-in-folder">In: {libraryFolders.folderOf(material.id)!.name}</span> : null}
          {tab !== "study" && [studyJob, cardJob, practiceJob].some(job => draftWaiting(job?.phase)) ?
            <button className="button button--ghost" onClick={() => selectTab("study")}>Draft waiting</button> : null}
        </span>}
        action={
          <div className="row row--wrap material-header-actions">
            {deviceCan().generate && isPdf && material.filePath ? <Button ref={askPdfButton} variant="secondary" onClick={() => setAskingPdf(true)}>Ask about this PDF</Button> : null}
            <MaterialActionsMenu>
              <div className="material-actions-menu__group" role="presentation">
                <Button aria-pressed={tipsHidden} onClick={() => setTipsHidden(!tipsHidden)}>{tipsHidden ? "Show section tips" : "Hide section tips"}</Button>
                <Button onClick={() => setEditing(true)}>Edit</Button>
                {material.filePath && !fileMissing && canHandleFiles() ? <Button onClick={() => { void open(); }}>Open</Button> : null}
                <MoveToFolderItem
                  isChapter={!!material.lineage?.rootMaterialId && material.lineage.rootMaterialId !== material.id && data.materials.some(m => m.id === material.lineage?.rootMaterialId)}
                  onMove={() => setMovingToFolder(true)}
                />
              </div>
              {(deviceCan().splitFiles && canSplit) || (kitQueue && deviceCan().generate && gemini?.configured && chapterPartIds.length > 0) ? (
                <div className="material-actions-menu__group" role="presentation">
                  {deviceCan().splitFiles && canSplit ? <>
                    <Button onClick={() => setSplitting(true)}>Split automatically</Button>
                    <Button onClick={() => { setOpenError(null); setSplittingByChapter(true); }} disabled={splittingByChapter && !chapterOutline}>
                      {splittingByChapter && !chapterOutline ? "Finding chapters\u2026" : "Split by chapter"}
                    </Button>
                    <Button onClick={() => setSplittingManually(true)}>Take out a chapter</Button>
                  </> : null}
                  {kitQueue && deviceCan().generate && gemini?.configured && chapterPartIds.length > 0 ? (
                    <Button onClick={() => kitQueue.offer(chapterPartIds)}>Make study kits</Button>
                  ) : null}
                </div>
              ) : null}
              <div className="material-actions-menu__group material-actions-menu__group--danger" role="presentation">
                <Button variant="danger" className="destructive-action" onClick={() => void prepareDelete()}>Delete</Button>
              </div>
            </MaterialActionsMenu>
          </div>
        }
      />
      <MoveToDialog
        open={movingToFolder}
        onClose={() => setMovingToFolder(false)}
        materialIds={[material.id]}
        materialTitle={material.title}
        folders={libraryFolders.folders}
        placements={libraryFolders.placements}
        onBeforeMove={() => { movedFrom.current = snapshotPlacements([material.id], libraryFolders.placements); }}
        onMoved={(result) => {
          undoMove.record(`Moved “${material.title}” to ${result.folderName}.`, movedFrom.current);
          setMovingToFolder(false);
          libraryFolders.reload();
        }}
      />
      <MoveToast notice={undoMove.notice} onUndo={() => void undoMove.undo()} />
      {/* The File menu closes on click, so say here that chapters are being found. */}
      {splittingByChapter && !chapterOutline ? <p className="tiny muted" role="status">Finding chapters…</p> : null}
      </div>

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

      <div className="material-detail stack stack--4">
        {isPdf && !tipsHidden ? (
          <div className="detail__column row row--between">
            <p id="material-start-here" className="small muted">New to this? See <Link to="/study?tab=howto">How to in Study Library</Link>.{deviceCan().pdfKit && offlineStudyEnabled() && material.filePath && !fileMissing ? <>{" "}<button type="button" className="link-button" onClick={() => jumpTo("read-pdf-text")}>Read this PDF's text</button></> : null}</p>
          </div>
        ) : null}
        <div {...tabListProps} ref={tabListRef} className="library-tabs material-tabs">
          {MATERIAL_TABS.map((value) => <MaterialTabButton key={value} value={value} state={tabState} />)}
        </div>
        <MaterialTabPanel value="study" state={tabState}>
          <MaterialStudyTab ctx={ctx} />
        </MaterialTabPanel>
        <MaterialTabPanel value="notes" state={tabState}>
          <MaterialNotesTab ctx={ctx} />
        </MaterialTabPanel>
        <MaterialTabPanel value="more" state={tabState}>
          <MaterialMoreTab ctx={ctx} />
        </MaterialTabPanel>
      </div>

      <MaterialDialogs ctx={ctx} />
    </>
  );
}
