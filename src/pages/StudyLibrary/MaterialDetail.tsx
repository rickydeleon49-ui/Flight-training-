import { providerCompany, providerWording } from "@/services/provider";
import { GuideCardRecoveryNotice } from "./GuideCardRecoveryNotice";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTab, useTabList, useTabPanel } from "@react-aria/tabs";
import { useTabListState, type TabListState } from "@react-stately/tabs";
import { Item } from "react-stately/Item";
import { mergeProps } from "react-aria";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

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
  Dialog,
  EmptyState,
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
import { isOneOfNumbers, useRememberedState } from "@/state/useRememberedState";

import { canSplitPdfs } from "@/services/pdf";
import { materialLinkAnchor, resolveMaterialLink, type MaterialLinkTarget } from "@/logic/savedSearch";

import { MaterialFormDialog, type MaterialDraft } from "./MaterialFormDialog";
import { IMPORTED_CONTENT_DISCLAIMER } from "./ImportStudyPacketDialog";
import { CardReviewPanel } from "./CardReviewPanel";
import { AskGeminiPanel, formatFlashcardContext } from "./AskGeminiPanel";
import { OralScenariosCard } from "./OralScenariosCard";
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

const TARGET_CARD_COUNTS = [20, 40, 60] as const;
type TargetCardCount = (typeof TARGET_CARD_COUNTS)[number];
import { GeminiErrorText, GeminiJobNotice, GeminiProgressView, GeminiRecoveryNotice } from "./GeminiJobNotice";
import { useGeminiJobs, isNewerJob, type GeminiJob, type GeminiJobPhase } from "@/state/GeminiJobs";
import { DocumentPagesPanel } from "./navigation/DocumentPagesPanel";
import { needsRegenerationReview } from "@/logic/studySetEditing";
import { pdfAskContext } from "@/logic/pdfAskContext";
import { VisualCardEditor } from "./VisualCardEditor";
import { AuthorBadge, StartManualStudySet, StudySetEditor } from "./StudySetEditor";
import { PracticeTestEditor, PracticeTestHistory } from "./PracticeTestEditing";
import { needsPracticeRegenerationReview } from "@/logic/practiceRegeneration";
import { PracticeRegenerationReviewDialog } from "./PracticeRegenerationReviewDialog";
import { RegenerationReviewDialog } from "./RegenerationReviewDialog";
import { PdfStudyKitPanel } from "./PdfStudyKitPanel";
import { PdfItemLabel, PDF_KIT_LABEL, PDF_KIT_REMINDER } from "./PdfItemLabel";
import { pdfLabelState } from "@/logic/pdfKitLabels";
import { SourcePageBadge } from "./navigation/SourcePageBadge";
import { useMaterialTips } from "./materialTips";
import { RelatedStudy } from "./RelatedStudy";
import { jumpToMaterialHeading } from "./materialJump";
import { MATERIAL_TABS, materialTabFrom, materialTabParams, materialTabForAnchor, type MaterialTab } from "./materialTabs";
import { MaterialActionsMenu } from "./MaterialActionsMenu";

type MaterialTabChoice = { value: MaterialTab };
const MATERIAL_TAB_CHOICES = MATERIAL_TABS.map((value) => ({ value }));
const materialTabLabel = (value: MaterialTab) => value === "study" ? "Study" : value === "notes" ? "Notes" : "More";

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

export function MaterialDetail() {
  const { materialId } = useParams();
  // Generations belong to the app, not to this page (GEN-REL-02): leaving the
  // page or opening another material never discards one.
  return <MaterialDetailPage key={materialId} />;
}

function MaterialDetailPage() {
  const [pageNotesAvailable, setPageNotesAvailable] = useState(false);
  const [askingPdf, setAskingPdf] = useState(false);
  const [activePracticeAttempt, setActivePracticeAttempt] = useState<boolean | null>(null);
  const { materialId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setSearchParams] = useSearchParams();
  const tab = materialTabFrom(params);
  const selectTab = (next: MaterialTab) => {
    const nextParams = materialTabParams(params, next);
    // React Router's search-only setter drops the hash. Retain preparation anchors.
    // Keep how she arrived, so "‹ Study Library" can still go back to her place.
    if (location.hash) navigate({ search: nextParams.toString(), hash: location.hash }, { replace: true, state: location.state });
    else setSearchParams(nextParams, { replace: true, state: location.state });
  };
  const tabState = useTabListState<MaterialTabChoice>({
    selectedKey: tab,
    onSelectionChange: (key) => selectTab(key as MaterialTab),
    disabledKeys: [],
    items: MATERIAL_TAB_CHOICES,
    children: ({ value }) => <Item key={value} textValue={materialTabLabel(value)}>{materialTabLabel(value)}</Item>,
  });
  const tabListRef = useRef<HTMLDivElement>(null);
  const { tabListProps } = useTabList({ "aria-label": "Study this material", keyboardActivation: "automatic" }, tabState, tabListRef);
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const tabForAnchor = (id: string) => {
    const guideIndex = /^search-target-guide-(\d+)$/.exec(id)?.[1];
    return materialTabForAnchor(id, guideIndex !== undefined && Boolean(studySet?.sections[Number(guideIndex)]?.pdfProvenance));
  };
  const jumpTo = (id: string) => {
    const destination = tabForAnchor(id);
    if (destination && destination !== tab) selectTab(destination);
    setPendingJump(id);
  };
  // Opened from Review due: start this material's card session once. The
  // request is read once per visit and then cleared from history, so Back
  // or a reload never starts another session by itself.
  const [startCardReview] = useState(
    () => (location.state as { startCardReview?: unknown } | null)?.startCardReview === true,
  );
  useEffect(() => {
    if (startCardReview) navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, []);
  const { data, mutate, deleteWithUndo, repositories, dataRevision, refresh } = useAppData();
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
  const [coveringLabel, setCoveringLabel] = useState(false);
  const [pictureSaved, setPictureSaved] = useState(false);
  const [editingVisualIndex, setEditingVisualIndex] = useState<number | null>(null);
  const [affectedVisual, setAffectedVisual] = useState<string[]>([]);
  // Her usual card count stays chosen on this Mac; 40 until she picks another.
  const [targetCards, setTargetCards] = useRememberedState<TargetCardCount>(
    "material.targetCards",
    40,
    isOneOfNumbers(TARGET_CARD_COUNTS),
    "device",
  );
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
  const [startRefusal, setStartRefusal] = useState<{ kind: "study-aid" | "flashcards" | "practice-test"; message: string } | null>(null);
  // Job notices show failures with recovery actions; refusals belong to this page.
  const refusalFor = (kind: "study-aid" | "flashcards" | "practice-test") =>
    startRefusal?.kind === kind ? startRefusal.message : null;
  const generationError = studyJob?.phase === "failed" ? null : refusalFor("study-aid");
  const cardGenerationError = cardJob?.phase === "failed" ? null : refusalFor("flashcards");
  const practiceGenerationError = practiceJob?.phase === "failed" ? null : refusalFor("practice-test");
  // "Gemini is already working… Try again in a moment" is true only for that
  // moment: it clears once Gemini goes idle or that kind's job moves on.
  const geminiBusy = geminiJobs.busy || geminiJobs.locked();
  const refusalWatch = useRef({ busy: geminiBusy, "study-aid": studyJob?.phase, flashcards: cardJob?.phase, "practice-test": practiceJob?.phase });
  useEffect(() => {
    const before = refusalWatch.current;
    const now = { busy: geminiBusy, "study-aid": studyJob?.phase, flashcards: cardJob?.phase, "practice-test": practiceJob?.phase };
    refusalWatch.current = now;
    setStartRefusal((refusal) =>
      refusal && ((before.busy && !now.busy) || before[refusal.kind] !== now[refusal.kind]) ? null : refusal,
    );
  }, [geminiBusy, studyJob?.phase, cardJob?.phase, practiceJob?.phase]);
  // An answer waiting to be saved or discarded is never overwritten by asking again.
  const draftWaiting = (phase: GeminiJobPhase | undefined) =>
    phase === "recovered" || phase === "save-failed" || phase === "discarding" || phase === "discard-failed";
  const isMountedRef = useRef(true);

  const material = data.materials.find((candidate) => candidate.id === materialId) ?? null;
  useEffect(() => {
    if (!pendingJump) return;
    const destination = tabForAnchor(pendingJump);
    if (destination && tab !== destination) return;
    if (!document.getElementById(pendingJump)) return;
    if (pendingJump === "material-file-actions") {
      const menu = document.getElementById(pendingJump)?.closest("details");
      if (menu) menu.open = true;
    }
    const frame = requestAnimationFrame(() => {
      // The reading panel focuses its ready control after its async status arrives.
      if (pendingJump === "read-pdf-text") document.getElementById(pendingJump)?.scrollIntoView?.({ block: "start" });
      else jumpToMaterialHeading(pendingJump);
      setPendingJump(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingJump, tab, dataRevision]);
  const prepareDelete = async () => {
    if (!repositories || !material) return;
    try {
      const affected = await repositories.documents.affectedVisualCards(material.id);
      setAffectedVisual(affected);
      setConfirmingDelete(true);
    } catch {
      setOpenError("The picture cards linked to this material couldn't be checked. Nothing was deleted. Try again.");
    }
  };

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
    () =>
      (studySet?.flashcards ?? [])
        .map((card, originalIndex) => ({ card, originalIndex }))
        .filter(({ card }) => !card.pdfProvenance && !card.visualRegionId),
    [studySet?.flashcards],
  );
  const kitFlashcards = useMemo(
    () => (studySet?.flashcards ?? []).map((card, originalIndex) => ({ card, originalIndex })).filter(({ card }) => Boolean(card.pdfProvenance)),
    [studySet?.flashcards],
  );
  const visualFlashcards = useMemo(
    () =>
      (studySet?.flashcards ?? [])
        .map((card, originalIndex) => ({ card, originalIndex }))
        .filter(({ card }) => Boolean(card.visualRegionId)),
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
  // Switching tabs must not re-resolve the same search hit and pull her back.
  const linkParams = new URLSearchParams(location.search);
  linkParams.delete("tab");
  const linkKey = linkParams.toString();
  // The study set's own text: a link is checked again whenever it changes,
  // and not on every unrelated reload.
  const studyText = useMemo(
    () => (studySet ? JSON.stringify([studySet.summary, studySet.sections, studySet.flashcards]) : ""),
    [studySet],
  );
  const hashHandled = useRef<string | null>(null);
  useEffect(() => {
    if (hashHandled.current === location.hash) return;
    if (!material) return;
    hashHandled.current = location.hash;
    if (location.hash) {
      try { jumpTo(decodeURIComponent(location.hash.slice(1))); }
      catch { /* An invalid escaped anchor has no destination. */ }
    }
  }, [location.hash, material, studyText]);
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
    let anchor = linkTarget ? materialLinkAnchor(linkTarget) : null;
    if (!anchor || scrolledFor.current === linkKey) return;
    const isKit = linkTarget?.kind === "card"
      ? Boolean(studySet?.flashcards[linkTarget.index]?.pdfProvenance)
      : linkTarget?.kind === "guide" && Boolean(studySet?.sections[linkTarget.index]?.pdfProvenance);
    if (isKit && linkTarget?.kind === "card") anchor = "search-target-kit-cards";
    const destination = materialTabForAnchor(anchor, isKit);
    if (destination && destination !== tab) { selectTab(destination); return; }
    const element = document.getElementById(anchor);
    if (!element) return;
    const frame = requestAnimationFrame(() => {
      scrolledFor.current = linkKey;
      jumpToMaterialHeading(element.id, { block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [linkTarget, linkKey, tab, studySet]);
  const practiceTest = data.practiceTests.find(
    (candidate) => candidate.sourceMaterialId === materialId,
  );
  // Saving replaces the progress view and mounts a compact loading panel before
  // its questions arrive. Anchor to the stable practice section after that
  // layout change, only for a generation requested during this visit.
  useLayoutEffect(() => {
    if (tab !== "study" || !practiceJustSaved || generatingPractice || !practiceTest) return;
    setPracticeJustSaved(false);
    document.getElementById("material-practice-test")?.scrollIntoView?.({ block: "start", behavior: "auto" });
  }, [practiceJustSaved, generatingPractice, practiceTest, tab]);
  // Imported study packets are labelled as imported, never as Gemini output.
  const importedSet = studySet?.provider === "import";
  // A set she wrote herself is labelled as hers, never as Gemini output.
  const manualSet = studySet?.provider === "manual";
  const showStudyGuide =
    Boolean(material?.filePath || studySet) && !(manualSet && !studySet.summary && studySet.sections.length === 0 && studySet.flashcards.length > 0);
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
  const helper = providerCompany(gemini?.model) === "Anthropic" ? "Claude" : "Gemini";
  const aiCheck = checkAiSubmission(material, data.toolkit.credentials, "file", providerCompany(gemini?.model));
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
              ? { text: (providerCompany(gemini?.model) === "Anthropic" ? "Connect Claude in Settings to create or regenerate study aids from this document. Anything already saved stays available." : "Connect the free Gemini API in Settings to create or regenerate study aids from this document. Anything already saved stays available."), settings: true }
              : geminiJobs.recovery !== "ready"
                ? { text: "Gemini is still checking earlier work. Try again in a moment." }
                : null;
  const isGeneratingAny = geminiBusy;
  // What a send will replace, and where earlier versions really can be found:
  // Previous versions lives under Edit study guide, which needs a guide.
  const hasSavedGuide = Boolean(studySet && (studySet.summary || studySet.sections.length > 0));
  const previousVersionsHint = hasSavedGuide ? "Earlier versions stay in Edit study guide → Previous versions. " : "";
  const savedCardCount = studySet?.flashcards.length ?? 0;
  // Each replaced set is kept whole in Previous versions, so Restore there
  // brings these cards back (QUICKFIX-01: say so for cards, not "versions").
  const replaceCardsWarning = savedCardCount
    ? `This replaces your ${savedCardCount} saved ${savedCardCount === 1 ? "card" : "cards"}. ${hasSavedGuide ? `To get ${savedCardCount === 1 ? "it" : "them"} back, choose Restore in Edit study guide → Previous versions. ` : ""}`
    : "";
  const replaceGuideWarning = hasSavedGuide ? `This replaces your saved study guide. ${previousVersionsHint}` : "";
  const emptyFailedGuide = Boolean(studyJob?.sectionGuide && studyJob.sections?.ready === 0 &&
    (studyJob.phase === "failed" || studyJob.phase === "cancelled" || studyJob.phase === "interrupted"));
  // Why Regenerate / Create is unavailable, in her words (CARDS-FIX-01).
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
    const refusal = await geminiJobs.start(
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
  return (
    <>
      {/* Opened from the library: go back, so the list returns to where she was. */}
      <Link className="button button--ghost material-breadcrumb" to="/study" onClick={(event) => {
        if ((location.state as { fromLibrary?: boolean } | null)?.fromLibrary) { event.preventDefault(); navigate(-1); }
      }}>‹ Study Library</Link>
      <div className="material-detail-header">
      <PageHeader
        title={material.title}
        subtitle={<span className="material-header-meta">
          <span>{isPdf ? "PDF · " : ""}{MATERIAL_TYPE_LABELS[material.materialType]} · {TOPIC_LABELS[material.topic]}</span>
          <span className="tag">{REVIEW_STATUS_LABELS[material.reviewStatus]}</span>
          {material.tags.map(tag => <span className="tag" key={tag}>{tag}</span>)}
          {fileMissing ? <span className="tag">File missing</span> : null}
          {tab !== "study" && [studyJob, cardJob, practiceJob].some(job => draftWaiting(job?.phase)) ?
            <button className="button button--ghost" onClick={() => selectTab("study")}>Draft waiting</button> : null}
        </span>}
        action={
          <div className="row row--wrap material-header-actions">
            {isPdf && material.filePath ? <Button variant="primary" onClick={() => setAskingPdf(true)}>Ask about this PDF</Button> : null}
            <MaterialActionsMenu>
              <Button onClick={() => setEditing(true)}>Edit</Button>
              {canSplit ? <>
                <Button onClick={() => setSplitting(true)}>Split automatically</Button>
                <Button onClick={() => setSplittingManually(true)}>Take out a chapter</Button>
              </> : null}
              {material.filePath && !fileMissing && canHandleFiles() ? <Button onClick={() => { void open(); }}>Open</Button> : null}
              <Button aria-pressed={tipsHidden} onClick={() => setTipsHidden(!tipsHidden)}>{tipsHidden ? "Show section tips" : "Hide section tips"}</Button>
              <Button variant="danger" className="destructive-action" onClick={() => void prepareDelete()}>Delete</Button>
            </MaterialActionsMenu>
          </div>
        }
      />
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
        <div className="detail__column">

          {isPdf && !tipsHidden ? (
            <p id="material-start-here" className="small muted">New to this? See <Link to="/study?tab=howto">How to in Study Library</Link>.</p>
          ) : null}
        </div>
        <div {...tabListProps} ref={tabListRef} className="library-tabs material-tabs">
          {MATERIAL_TABS.map((value) => <MaterialTabButton key={value} value={value} state={tabState} />)}
        </div>
        <MaterialTabPanel value="study" state={tabState}>
          <h2 id="material-panel-heading-study" tabIndex={-1} className="visually-hidden material-panel-heading">Study</h2>
          <div className="detail__column">
          {fileMissing ? <div className="card stack stack--3" role="status">
            <p>This study file is missing. Everything you wrote is still here.</p>
            <Button disabled={restoringFile} onClick={() => void restoreFile()}>{restoringFile ? "Restoring…" : "Find and restore file"}</Button>
          </div> : null}
          {!material.filePath && !studySet ? <Card><CardBody>
            <p className="small muted">Write a study guide in your own words.</p>
            <StartManualStudySet material={material} />
          </CardBody></Card> : null}
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
                          disabled={isGeneratingAny || fileMissing || draftWaiting(studyJob?.phase) || (Boolean(studyJob?.sectionGuide) && !emptyFailedGuide)}
                          onClick={() => {
                            if (geminiJobs.locked()) {
                                setStartRefusal({ kind: "study-aid", message: "Gemini is already working or checking earlier work. Try again in a moment." });
                              } else setConfirmingAi(true);
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
                            ? providerWording("Ask Gemini for a study guide from this file, then review and save the draft on this Mac.", gemini?.model)
                            : providerWording("Ask Gemini for a study guide from this file, then review and save the draft on this Mac.", gemini?.model)}
                  </p>
                ) : null}
                <CardBody>
                  {isPdf && material.filePath && !studySet && !practiceTest ? <p className="small muted">
                    <Button variant="secondary" onClick={() => jumpTo("material-pdf-kit")}>or make a kit on this Mac</Button>
                  </p> : null}
                  {isOverLimit ? (
                    <div className="stack stack--3" style={{ marginBottom: "var(--space-4)" }}>
                      <div className="ai-disclaimer" role="alert">
                        <AlertIcon size={16} />
                        <p className="tiny">This PDF is too big for {helper} — split it first.</p>
                      </div>
                    </div>
                  ) : null}
                  {!isOverLimit && generationNotice ? (
                    <GenerationNoticeView
                      notice={{ ...generationNotice, text: providerWording(generationNotice.text, gemini?.model) }}
                      onSplit={jumpToFileSection}
                      onQueueLater={() => void queueStudyAid()}
                    />
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
                    <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
                      <GeminiErrorText model={gemini?.model} message={generationError} />
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
                        ? "Gemini will read this PDF and build a study guide section by section. Finished sections are kept if you stop; the completed draft waits for you to save it locally."
                        : "Gemini will read only this file and create a source-based study guide. The finished draft waits for you to save it locally.", gemini?.model)}
                    </p>
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
                      ? "Saved on this computer"
                      : material.filePath
                        ? "From this document"
                        : "Optional"
                  }
                  action={
                    <div className="row row--wrap" style={{ alignItems: "center" }}>
                      {pageNotesAvailable ? <Button size="small" onClick={() => {
                        selectTab("notes");
                        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>("[data-material-make-card]")?.click());
                      }}>Make a card</Button> : null}
                      {material.filePath && /\.png$/i.test(material.filePath) ? (
                        <Button size="small" onClick={() => setCoveringLabel(true)}>
                          Add a picture card
                        </Button>
                      ) : null}
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
                  <GuideCardRecoveryNotice materialId={material.id} />
                  {isOverLimit ? (
                    <div className="stack stack--3" style={{ marginBottom: "var(--space-4)" }}>
                      <div className="ai-disclaimer" role="alert">
                        <AlertIcon size={16} />
                        <p className="tiny">This PDF is too big for {helper} — split it first.</p>
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
                    <div className="stack stack--3" style={{ marginBottom: "var(--space-3)" }}>
                      <GeminiErrorText model={gemini?.model} message={cardGenerationError} />
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
                      <CardReviewPanel numberedAction
                        materialId={material.id}
                        materialTitle={material.title}
                        materialFilePath={material.filePath ?? null}
                        repository={repositories?.cardReviews}
                        contentKey={studySet.updatedAt}
                        autoStart={startCardReview}
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
                      />
                      <p className="small" role="status">{pictureSaved ? "Picture card saved." : ""}</p>
                      {visualFlashcards.length > 0 ? (
                        <section aria-labelledby="visual-cards-title" className="stack stack--3">
                          <h3 id="visual-cards-title" className="ai-guide__title">
                            Your picture cards
                          </h3>
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
                        </section>
                      ) : null}
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
                  <p className="tiny muted" style={{ padding: "var(--space-3) var(--space-5) 0" }}>
                    Try saved questions with explanations; your completed attempts stay in practice history.
                  </p>
                ) : null}
                <CardBody>
                  {isOverLimit ? (
                    <div className="stack stack--3" style={{ marginBottom: "var(--space-4)" }}>
                      <div className="ai-disclaimer" role="alert">
                        <AlertIcon size={16} />
                        <p className="tiny">This PDF is too big for {helper} — split it first.</p>
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
                    <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
                      <GeminiErrorText model={gemini?.model} message={practiceGenerationError} />
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
                              ? `Study aid. ${PDF_KIT_REMINDER}`
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
                        hideSourceMaterial
                        sourceMaterialTitle={material.title}
                        content={practiceTest}
                        kind="practice-test"
                      />

                      <PracticeTestPanel entrySummary
                        practiceTest={practiceTest}
                        materialId={material.id}
                        key={practiceTest.updatedAt}
                        onAttemptChange={setActivePracticeAttempt}
                      />
                    </div>
                  ) : !generatingPractice && !hasImported && material.filePath && canOfferGemini ? (
                    <p className="small muted">
                      {helper} will read only this file and create a multiple-choice practice test with
                      explanations. The result will be saved locally with your other data.
                    </p>
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

          <OralScenariosCard material={material} />

          </div>
        </MaterialTabPanel>
        <MaterialTabPanel value="notes" state={tabState}>
          <h2 id="material-panel-heading-notes" tabIndex={-1} className="visually-hidden material-panel-heading">Notes</h2>
          <div className="detail material-notes-grid"><div className="detail__column">
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

          </div><div className="detail__column">
          <Card>
            <CardHeader title="Questions for my instructor" />
            {!tipsHidden ? <p className="tiny muted" style={{ padding: "var(--space-3) var(--space-5) 0" }}>Keep questions here to ask later; they also appear on your Questions page.</p> : null}
            <CardBody>
              <div className="stack stack--3">
                {questions.map((question) => (
                  <div className="row row--between" key={question.id}>
                    <span className="small wrap-anywhere" style={{ whiteSpace: "pre-line" }}>{question.text}</span>
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
          <Card>
            <CardHeader
              title="Next steps for this material"
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

          {isPdf && material.filePath ? (
            <DocumentPagesPanel material={material} fileMissing={fileMissing} restoring={restoringFile}
              onRestore={() => void restoreFile()} showTips={!tipsHidden} onPageNotesAvailable={setPageNotesAvailable} />
          ) : null}

          </div></div>
        </MaterialTabPanel>
        <MaterialTabPanel value="more" state={tabState}>
          <h2 id="material-panel-heading-more" tabIndex={-1} className="visually-hidden material-panel-heading">More</h2>
          <div className="detail__column">
          <p className="small muted">Less-used tools for this file.</p>
          {studySet || practiceTest ? <Card><CardBody><Button onClick={() => setExporting(true)}>Export or print</Button></CardBody></Card> : null}
          {/* Reading the PDF's text sits with the other tools, above the reference cards (QUICKFIX-01). */}
          {isPdf && (material.filePath || hasKitItems) ? (
            <section id="material-mac-backup" tabIndex={-1} aria-label="On this Mac (backup)">
              <Card>
                <CardHeader title="On this Mac (backup)" headingId="material-backup-heading" />
                {!tipsHidden && material.filePath ? <p className="tiny muted" style={{ padding: "var(--space-3) var(--space-5) 0" }}>No internet, or don't want to use {helper}? Read this PDF's text and make a study kit right on your Mac.</p> : null}
                <CardBody><div className="stack stack--4">
                  {material.filePath ? <>
                    <div id="material-offline-study" tabIndex={-1}><OfflineStudyPanel material={material} focusRequested={tab === "more" && location.hash === "#read-pdf-text"} /></div>
                    <div id="material-pdf-kit" tabIndex={-1}><PdfStudyKitPanel key={material.id} material={material} /></div>
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
          <RelatedStudy key={material.id} materialId={material.id} initiallyOpen={tab === "more"} />
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

          <Card>
            <CardHeader title="Details and review status" />
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
            <CardHeader title="Details" />
            {!tipsHidden ? <p className="tiny muted" style={{ padding: "var(--space-3) var(--space-5) 0" }}>See how this material is organized. Use Edit in More actions to change its details.</p> : null}
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
        </MaterialTabPanel>
      </div>

      {isPdf && material.filePath ? (
            <Dialog open={askingPdf} onClose={() => setAskingPdf(false)} title="Ask about this PDF" className="material-ask-dialog">
            <div id="material-ask-gemini">
                {!aiCheck.allowed ? (
                  <p className="small muted">{aiCheck.reason}</p>
                ) : isOverLimit ? (
                  <p className="small muted">This PDF is too big for {helper} — split it first.</p>
                ) : !canOfferGemini || fileMissing ? (
                  <p className="small muted">
                    {fileMissing
                      ? providerWording("This PDF's file is missing, so Gemini can't read it.", gemini?.model)
                      : !gemini?.configured
                        ? `Connect ${helper} in Settings to ask questions about this PDF.`
                        : providerWording(generationNotice?.text ?? "Gemini isn't available for this PDF right now.", gemini?.model)}
                  </p>
                ) : (
                  <>
                    <p className="small muted">{providerWording("Ask Gemini a question about this PDF. It answers from the pages and shows which pages it used.", gemini?.model)}</p>
                    <AskGeminiPanel
                      key={pdfAskConversationKey}
                      materialId={material.id}
                      relativePath={material.filePath ?? null}
                      context={pdfContext}
                      buttonLabel="Ask"
                      evidenceMode
                    />
                  </>
                )}
            </div></Dialog>
      ) : null}

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
        open={confirmingAi}
        title={`Send this file to ${providerCompany(gemini?.model)}?`}
        message={`${importedSet ? `${IMPORT_GUIDE_REGENERATE_WARNING} ` : ""}${replaceGuideWarning}${aiCheck.reason} ${geminiSendDisclosure(material, providerCompany(gemini?.model))}${geminiModelSentence(gemini)}`}
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
        {!isPdf ? <><label className="field">Target cards
          <select aria-label="Target cards" value={targetCards} onChange={(event) => setTargetCards(Number(event.target.value) as TargetCardCount)}>
            {TARGET_CARD_COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
        <p className="tiny dim">A maximum, not a promise. Short sources may support fewer distinct cards. Completed sets wait for you to save them. Try again resumes any kept draft with the same target.</p></> : <p className="tiny dim">Your guide is built section by section. Finished sections are kept if you stop, and the completed guide waits for you to save it.</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingCards}
        title={`Send this file to ${providerCompany(gemini?.model)}?`}
        message={`${replaceCardsWarning || (importedSet ? `${IMPORT_CARDS_REGENERATE_WARNING} ` : "")}${aiCheck.reason} ${geminiSendDisclosure(material, providerCompany(gemini?.model))}${geminiModelSentence(gemini)}`}
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
        <p className="tiny dim">A maximum, not a promise. Short sources may support fewer distinct cards. Completed sets wait for you to save them.{isPdf ? " For PDFs it is one request per 10 cards." : " Try again resumes any kept draft with the same target."}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingPracticeTest}
        title={`Send this file to ${providerCompany(gemini?.model)}?`}
        message={
          practiceTest
            ? `${importedTest ? IMPORT_TEST_REGENERATE_WARNING : "This will replace your current practice test with newly generated questions."} Regenerating closes any unfinished practice session while completed history remains preserved under its original version. ${aiCheck.reason} ${geminiSendDisclosure(material, providerCompany(gemini?.model))}${geminiModelSentence(gemini)}`
            : `${aiCheck.reason} ${geminiSendDisclosure(material, providerCompany(gemini?.model))}${geminiModelSentence(gemini)}`
        }
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
        message={`Its notes, tags and links are removed. The file is deleted from this application's private storage. This also removes its card review history.${
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

/**
 * Said before Gemini replaces imported content. Each names only what that
 * button replaces: regenerating the guide leaves an imported test alone.
 */
/** Which model will read the file, added to the "Send this file to Google?" message. */
export function geminiModelSentence(status: GeminiStatus | null): string {
  if (!status || typeof status.model !== "string" || !status.model) return "";
  const name = geminiModelName(status.model);
  return status.choice === "most-capable" && !status.model.startsWith("claude-")
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
