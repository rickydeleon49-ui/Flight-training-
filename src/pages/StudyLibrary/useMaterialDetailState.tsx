import { providerWording } from "@/services/provider";
import { useOptionalKitQueue } from "@/state/KitQueue";
import { useStickyCardHeight } from "./useStickyCardHeight";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTabList } from "@react-aria/tabs";
import { useTabListState } from "@react-stately/tabs";
import { Item } from "react-stately/Item";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { recordOpened } from "./recentlyOpened";
import { todayIso } from "@/lib/dates";
import { canHandleFiles, documentExists } from "@/services/documents";
import { getGeminiStatus, type GeminiStatus } from "@/services/gemini";
import { useAppData } from "@/state/AppDataContext";
import { useMaterialNotes } from "@/state/useMaterialNotes";
import { useActionOperations } from "@/state/useActions";
import { isOneOfNumbers, useRememberedState } from "@/state/useRememberedState";
import { materialLinkAnchor, resolveMaterialLink, type MaterialLinkTarget } from "@/logic/savedSearch";
import { useCardReview } from "./useCardReview";
import { usePracticeMetadata } from "./usePracticeMetadata";
import { useChapterChoice } from "./SplitByChapterDialog";
import { useGeminiJobs, isNewerJob, newestJob, isMoreCardsJob, type GeminiJob, type GeminiJobPhase } from "@/state/GeminiJobs";
import { needsRegenerationReview } from "@/logic/studySetEditing";
import { needsPracticeRegenerationReview } from "@/logic/practiceRegeneration";
import { useMaterialTips } from "./materialTips";
import { jumpToMaterialHeading } from "./materialJump";
import { materialTabFrom, materialTabParams, materialTabForAnchor, type MaterialTab } from "./materialTabs";
import { useUndoMove, type PlacementSnapshot } from "./useUndoMove";
import { useLibraryFolders } from "./useLibraryFolders";
import { TARGET_CARD_COUNTS, TargetCardCount, MaterialTabChoice, MATERIAL_TAB_CHOICES, materialTabLabel, KIT_DRAFTS_WAITING, EARLIER_DRAFTS_WAITING } from "./materialDetailShared";

export function useMaterialDetailState() {
  const [pageNotesAvailable, setPageNotesAvailable] = useState(false);
  const [askingPdf, setAskingPdf] = useState(false);
  // Closing Ask about this PDF (Escape or Close) returns focus to its button.
  const askPdfButton = useRef<HTMLButtonElement>(null);
  const closeAskPdf = () => {
    setAskingPdf(false);
    window.setTimeout(() => askPdfButton.current?.focus({ preventScroll: true }), 0);
  };
  const [activePracticeAttempt, setActivePracticeAttempt] = useState<boolean | null>(null);
  const { materialId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setSearchParams] = useSearchParams();
  const tab = materialTabFrom(params);
  const selectTab = (next: MaterialTab) => {
    const nextParams = materialTabParams(params, next);
    // React Router's search-only setter drops the hash. Retain preparation anchors.
    // Keep how the student arrived, so "‹ Study Library" can still go back to the student place.
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
  const [cardStartSignal, setCardStartSignal] = useState(0);
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
  // Just saved from an iPhone photo: open the cover editor once, then clear the request.
  const [addPictureCard] = useState(
    () => (location.state as { addPictureCard?: unknown } | null)?.addPictureCard === true,
  );
  useEffect(() => {
    if (startCardReview || addPictureCard) navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, []);
  const { data, mutate, deleteWithUndo, repositories, dataRevision, refresh } = useAppData();
  const operations = useActionOperations();
  const today = todayIso();

  const { hidden: tipsHidden, setHidden: setTipsHidden } = useMaterialTips();
  const [editing, setEditing] = useState(false);
  const [movingToFolder, setMovingToFolder] = useState(false);
  const movedFrom = useRef<PlacementSnapshot[]>([]);
  const libraryFolders = useLibraryFolders();
  const restoreMove = useCallback(async (rows: PlacementSnapshot[]) => {
    const repo = repositories?.libraryFolders;
    if (!repo) throw new Error("Folders are not ready yet.");
    await repo.restorePlacements(rows);
  }, [repositories]);
  const undoMove = useUndoMove(restoreMove, libraryFolders.reload, true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [addingAction, setAddingAction] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");
  // Enter held down or a double-click must not add the question twice.
  const addingQuestion = useRef(false);
  const [questionBusy, setQuestionBusy] = useState(false);
  const [fileMissing, setFileMissing] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [splittingManually, setSplittingManually] = useState(false);
  const [splittingByChapter, setSplittingByChapter] = useState(false);
  const kitQueue = useOptionalKitQueue();
  const [openError, setOpenError] = useState<string | null>(null);
  const [restoringFile, setRestoringFile] = useState(false);
  const [gemini, setGemini] = useState<GeminiStatus | null>(null);
  // Only decides whether a new study aid can be requested; saved ones show regardless.
  const [geminiStatusFailed, setGeminiStatusFailed] = useState(false);
  const [coveringLabel, setCoveringLabel] = useState(addPictureCard);
  const [pictureSaved, setPictureSaved] = useState(false);
  const [editingVisualIndex, setEditingVisualIndex] = useState<number | null>(null);
  const [affectedVisual, setAffectedVisual] = useState<string[]>([]);
  // The student's usual card count stays chosen on this Mac; 40 until the student picks another.
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
  const guideCardFace = useRef<HTMLButtonElement>(null);
  const kitCardFace = useRef<HTMLButtonElement>(null);
  const [practiceJustSaved, setPracticeJustSaved] = useState(false);
  const [confirmingPracticeTest, setConfirmingPracticeTest] = useState(false);
  const [editingSet, setEditingSet] = useState(false);
  const [practiceNeedsReview, setPracticeNeedsReview] = useState(false);
  const [reviewingPracticeRegeneration, setReviewingPracticeRegeneration] = useState(false);
  const [reviewingRegeneration, setReviewingRegeneration] = useState(false);
  const [confirmingKit, setConfirmingKit] = useState(false);
  const [kitMessage, setKitMessage] = useState<string | null>(null);
  // Where the earlier draft that blocks a study kit waits, for "Show me".
  const [kitDraftAnchor, setKitDraftAnchor] = useState<string | null>(null);
  const [splitNote, setSplitNote] = useState<string | undefined>(undefined);
  const [savingKit, setSavingKit] = useState(false);
  const [confirmingDiscardAll, setConfirmingDiscardAll] = useState(false);
  const [discardingAll, setDiscardingAll] = useState(false);
  const [unfinishedPractice, setUnfinishedPractice] = useState<{ answered: number; total: number } | null>(null);
  const [confirmingCards, setConfirmingCards] = useState(false);
  const [confirmingMoreCards, setConfirmingMoreCards] = useState(false);
  const [reviewingCardRegeneration, setReviewingCardRegeneration] = useState(false);

  // One Gemini generation at a time across the whole app, whichever page asked;
  // the lock is taken synchronously before anything awaits (src/state/GeminiJobs).
  const geminiJobs = useGeminiJobs();
  const waitingKitDrafts = geminiJobs.jobs.filter((job) => job.materialId === materialId && (job.answer || job.sectionGuide));
  const discardableKitDrafts = waitingKitDrafts.filter(job => job.studyKitPart && (job.phase === "recovered" || job.phase === "save-failed"));
  useEffect(() => {
    let live = true;
    setUnfinishedPractice(null);
    if ((confirmingPracticeTest || confirmingKit) && repositories && materialId) {
      void repositories.practiceSessions.getCurrentAttempt(materialId).then(async attempt => {
        if (!attempt) return;
        const items = await repositories.practiceSessions.getItems(attempt.versionId);
        if (live) setUnfinishedPractice({ answered: attempt.responses.length, total: items.length });
      }).catch(() => {});
    }
    return () => { live = false; };
  }, [confirmingPracticeTest, confirmingKit, repositories, materialId]);
  // A paused practice attempt: the row below says Continue, not Start.
  const [pausedPractice, setPausedPractice] = useState(false);
  // Bumped when the panel's attempt changes (answer, abandon, finish) so the label re-checks.
  const [practiceRevision, setPracticeRevision] = useState(0);
  const practiceQuestionCount = data.practiceTests.find((candidate) => candidate.sourceMaterialId === materialId)?.questions.length ?? 0;
  useEffect(() => {
    let live = true;
    if (repositories?.practiceSessions && materialId && practiceQuestionCount > 0) {
      void Promise.resolve(repositories.practiceSessions.getCurrentAttempt(materialId)).then(attempt => {
        if (live) setPausedPractice(Boolean(attempt && attempt.responses.length > 0));
      }).catch(() => {});
    } else setPausedPractice(false);
    return () => { live = false; };
  }, [repositories, materialId, practiceQuestionCount, practiceRevision]);
  useEffect(() => { setPausedPractice(false); }, [materialId]);
  const handlePracticeAttemptChange = useCallback((active: boolean, answered = 0) => {
    setActivePracticeAttempt(active);
    setPracticeRevision((n) => n + 1);
    if (!active) setPausedPractice(false);
    else if (answered > 0) setPausedPractice(true);
  }, []);
  const waitingKitDraftKey = JSON.stringify([materialId, waitingKitDrafts.map((job) => [job.key, Boolean(job.studyKitPart)])]);
  // A saved/discarded draft can invalidate both the refusal and its destination.
  // Only the draft refusals go stale this way; other kit messages stay.
  useEffect(() => {
    setKitMessage((message) => (message === KIT_DRAFTS_WAITING || message === EARLIER_DRAFTS_WAITING ? null : message));
    setKitDraftAnchor(null);
  }, [waitingKitDraftKey]);
  const studyJob = geminiJobs.jobs
    .filter((job) => job.materialId === materialId && job.kind === "study-aid")
    .reduce<GeminiJob | undefined>(
      (latest, candidate) => (!latest || isNewerJob(candidate, latest) ? candidate : latest),
      undefined,
    );
  const kitJob = geminiJobs.jobs.find(job => job.materialId === materialId && job.kind === "study-kit");
  const cardJob = newestJob(geminiJobs.jobs, materialId ?? "", "flashcards");
  const practiceJob = newestJob(geminiJobs.jobs, materialId ?? "", "practice-test");
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
  const makingPackNow = geminiJobs.makingPack(materialId ?? "");
  const guideReadyBelow = studyJob?.phase === "recovered" && Boolean(studyJob.answer) && !studyJob.sectionGuide;
  const guideStatusLine = generating
    ? "Making your study guide…"
    : makingPackNow
      ? "Making your flashcards and study test…"
      : guideReadyBelow
        ? "Your guide is ready below. Look it over, then save it."
        : null;
  const cardsStatusLine = generatingCards && !makingPackNow
    ? (cardJob && isMoreCardsJob(cardJob) ? "Making 10 more cards…" : "Making your flashcards…")
    : geminiJobs.cardsNote(materialId ?? "");
  // The draft arrives while the student is looking at the button: bring it into view once.
  const sawRunningGuide = useRef(false);
  useEffect(() => {
    if (generating) sawRunningGuide.current = true;
    else if (guideReadyBelow && sawRunningGuide.current) {
      sawRunningGuide.current = false;
      document.getElementById("material-guide-draft")?.scrollIntoView?.({ block: "nearest" });
    }
  }, [generating, guideReadyBelow]);
  const [startRefusal, setStartRefusal] = useState<{ kind: "study-aid" | "flashcards" | "practice-test"; message: string } | null>(null);
  // Job notices show failures with recovery actions; refusals belong to this page.
  const refusalFor = (kind: "study-aid" | "flashcards" | "practice-test") =>
    startRefusal?.kind === kind ? providerWording(startRefusal.message, gemini?.model) : null;
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
  const openedId = material?.id ?? null;
  useEffect(() => {
    if (openedId) recordOpened(openedId);
  }, [openedId]);
  useEffect(() => {
    if (!pendingJump) return;
    const destination = tabForAnchor(pendingJump);
    if (destination && tab !== destination) return;
    if (!document.getElementById(pendingJump)) return;
    let disclosure = document.getElementById(pendingJump)?.closest("details");
    while (disclosure) {
      disclosure.open = true;
      disclosure = disclosure.parentElement?.closest("details") ?? null;
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
  // One card-review state shared by the Study actions row and the Flashcards panel.
  const cardReview = useCardReview(materialId, repositories?.cardReviews, { contentKey: studySet?.updatedAt });
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
  useStickyCardHeight(guideCardFace, safeCardIndex, cardRevealed);
  const safeKitCardIndex = Math.min(kitCardIndex, Math.max(0, kitFlashcards.length - 1));
  useStickyCardHeight(kitCardFace, safeKitCardIndex, kitCardRevealed);
  // "Make a card" on the Flashcards panel goes through the page-notes editor. Afterwards the
  // student is back on the tab they started from, at their cards, with the new card showing.
  const [resetSlot, setResetSlot] = useState<HTMLElement | null>(null);
  const flashcardRoute = useRef(false);
  const flashcardReturnTab = useRef<MaterialTab>("study");
  const flashcardCountBefore = useRef<number | null>(null);
  const showFlashcards = () => {
    requestAnimationFrame(() => {
      const target = document.getElementById("material-flashcards");
      target?.scrollIntoView({ block: "start" });
      target?.focus({ preventScroll: true });
    });
  };
  const returnToFlashcards = () => {
    selectTab(flashcardReturnTab.current);
    showFlashcards();
  };
  useEffect(() => {
    const before = flashcardCountBefore.current;
    if (before === null || guideFlashcards.length <= before) return;
    flashcardCountBefore.current = null;
    setCardIndex(guideFlashcards.length - 1);
    setCardRevealed(false);
    showFlashcards();
  }, [guideFlashcards.length]);

  // A link from offline search (OFFLINE-02c §4): open the guide section,
  // card or practice question it names, only while it is unchanged.
  const [linkTarget, setLinkTarget] = useState<MaterialLinkTarget | null>(null);
  const [linkFailed, setLinkFailed] = useState(false);
  const [linkRetry, setLinkRetry] = useState(0);
  // Switching tabs must not re-resolve the same search hit and pull the student's back.
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
  const csvExportSources = useMemo(() => material
    ? [{ material, studySet: studySet ?? null, practiceTest: practiceTest ?? null }]
    : [], [material, studySet, practiceTest]);
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
  // A set the student wrote themselves is labelled as theirs, never as Gemini output.
  const manualSet = studySet?.provider === "manual";
  const showStudyGuide =
    Boolean(material?.filePath || studySet) && !(manualSet && !studySet.summary && studySet.sections.length === 0 && studySet.flashcards.length > 0);
  // A cards-only set the student wrote hides the Study guide card, so its Edit cards button lives in the Flashcards card.
  const cardsOnlyManual = Boolean(studySet) && !showStudyGuide && manualSet;
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

  const { notes, setNotes, status: notesStatus, recoverable, retry, conflict: notesConflict, keepDraft, useSaved } = useMaterialNotes(
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

  // Before the early return: hooks must run on every render.
  const chapterOutline = useChapterChoice(material?.filePath, splittingByChapter, (message) => {
    setSplittingByChapter(false);
    setOpenError(message);
  });

  return {
    pageNotesAvailable,
    setPageNotesAvailable,
    askingPdf,
    setAskingPdf,
    askPdfButton,
    closeAskPdf,
    activePracticeAttempt,
    setActivePracticeAttempt,
    materialId,
    navigate,
    location,
    params,
    setSearchParams,
    tab,
    selectTab,
    tabState,
    tabListRef,
    tabListProps,
    cardStartSignal,
    setCardStartSignal,
    pendingJump,
    setPendingJump,
    tabForAnchor,
    jumpTo,
    startCardReview,
    addPictureCard,
    data,
    mutate,
    deleteWithUndo,
    repositories,
    dataRevision,
    refresh,
    operations,
    today,
    tipsHidden,
    setTipsHidden,
    editing,
    setEditing,
    movingToFolder,
    setMovingToFolder,
    movedFrom,
    libraryFolders,
    restoreMove,
    undoMove,
    confirmingDelete,
    setConfirmingDelete,
    addingAction,
    setAddingAction,
    newQuestion,
    setNewQuestion,
    addingQuestion,
    questionBusy,
    setQuestionBusy,
    fileMissing,
    setFileMissing,
    splitting,
    setSplitting,
    exporting,
    setExporting,
    exportingCsv,
    setExportingCsv,
    splittingManually,
    setSplittingManually,
    splittingByChapter,
    setSplittingByChapter,
    kitQueue,
    openError,
    setOpenError,
    restoringFile,
    setRestoringFile,
    gemini,
    setGemini,
    geminiStatusFailed,
    setGeminiStatusFailed,
    coveringLabel,
    setCoveringLabel,
    pictureSaved,
    setPictureSaved,
    editingVisualIndex,
    setEditingVisualIndex,
    affectedVisual,
    setAffectedVisual,
    targetCards,
    setTargetCards,
    confirmingAi,
    setConfirmingAi,
    cardIndex,
    setCardIndex,
    cardRevealed,
    setCardRevealed,
    kitCardIndex,
    setKitCardIndex,
    kitCardRevealed,
    setKitCardRevealed,
    guideCardFace,
    kitCardFace,
    practiceJustSaved,
    setPracticeJustSaved,
    confirmingPracticeTest,
    setConfirmingPracticeTest,
    editingSet,
    setEditingSet,
    practiceNeedsReview,
    setPracticeNeedsReview,
    reviewingPracticeRegeneration,
    setReviewingPracticeRegeneration,
    reviewingRegeneration,
    setReviewingRegeneration,
    confirmingKit,
    setConfirmingKit,
    kitMessage,
    setKitMessage,
    kitDraftAnchor,
    setKitDraftAnchor,
    splitNote,
    setSplitNote,
    savingKit,
    setSavingKit,
    confirmingDiscardAll,
    setConfirmingDiscardAll,
    discardingAll,
    setDiscardingAll,
    unfinishedPractice,
    setUnfinishedPractice,
    confirmingCards,
    setConfirmingCards,
    confirmingMoreCards,
    setConfirmingMoreCards,
    reviewingCardRegeneration,
    setReviewingCardRegeneration,
    geminiJobs,
    waitingKitDrafts,
    discardableKitDrafts,
    pausedPractice,
    setPausedPractice,
    practiceRevision,
    setPracticeRevision,
    practiceQuestionCount,
    handlePracticeAttemptChange,
    waitingKitDraftKey,
    studyJob,
    kitJob,
    cardJob,
    practiceJob,
    working,
    generating,
    generatingCards,
    generatingPractice,
    makingPackNow,
    guideReadyBelow,
    guideStatusLine,
    cardsStatusLine,
    sawRunningGuide,
    startRefusal,
    setStartRefusal,
    refusalFor,
    generationError,
    cardGenerationError,
    practiceGenerationError,
    geminiBusy,
    refusalWatch,
    draftWaiting,
    isMountedRef,
    material,
    openedId,
    prepareDelete,
    practiceMetadata,
    retryPracticeMetadata,
    conversionStatus,
    completedCount,
    studySet,
    cardReview,
    guideSections,
    kitSections,
    guideFlashcards,
    kitFlashcards,
    visualFlashcards,
    hasKitItems,
    safeCardIndex,
    safeKitCardIndex,
    resetSlot,
    setResetSlot,
    flashcardRoute,
    flashcardReturnTab,
    flashcardCountBefore,
    showFlashcards,
    returnToFlashcards,
    linkTarget,
    setLinkTarget,
    linkFailed,
    setLinkFailed,
    linkRetry,
    setLinkRetry,
    linkParams,
    linkKey,
    studyText,
    hashHandled,
    scrolledFor,
    practiceRepository,
    practiceTest,
    csvExportSources,
    importedSet,
    manualSet,
    showStudyGuide,
    cardsOnlyManual,
    setHasHerItems,
    importedTest,
    hasImported,
    notes,
    setNotes,
    notesStatus,
    recoverable,
    retry,
    notesConflict,
    keepDraft,
    useSaved,
    chapterOutline,
  };
}
