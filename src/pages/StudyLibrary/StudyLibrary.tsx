import { deviceCan, isMacOS } from "@/services/platform";
import { CheckrideTopicPractice } from "./CheckrideTopicPractice";
import { MixedPracticeTest } from "./MixedPracticeTest";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTab, useTabList, useTabPanel } from "@react-aria/tabs";
import { useTabListState, type TabListState } from "@react-stately/tabs";
// Collection items come from react-stately (declared alongside the tabs hooks).
import { Item } from "react-stately/Item";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { BackToTop } from "@/components/ui/BackToTop";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Badge,
  BookIcon,
  Button,
  Card,
  DocumentIcon,
  EmptyState,
  NoteIcon,
  PlusIcon,
  SearchIcon,
  Select,
  TextInput,
} from "@/components/ui";
import {
  MATERIAL_TYPE_LABELS,
  MATERIAL_TYPE_OPTIONS,
  REVIEW_STATUS_LABELS,
  TOPIC_LABELS,
  TOPIC_OPTIONS,
  type MaterialType,
  type ReviewStatus,
  type LibraryReviewMaterialEntry,
  type LibraryReviewOversizeIssue,
  type StudyMaterial,
  type Topic,
} from "@/domain/types";
import { studyPacksAvailable } from "@/data/studyPack";
import type { CardLibraryRepository } from "@/data/repositories/cardLibraryRepository";
import { offlineStudyEnabled } from "@/services/offlineContent";
import { searchText } from "@/logic/searchText";
import { chapterCountLabel, groupChapterParts } from "@/logic/chapterGroups";
import { exportableParts } from "@/logic/studyExport";
import { isPackExportable, packFileTooLarge, packRowBlocked, packRows } from "@/logic/studyPackSelection";
import { newId } from "@/lib/id";
import {
  FOLDER_SORT_OPTIONS,
  MATERIAL_SORT_OPTIONS,
  sortMaterials,
  type FolderSort,
  type MaterialSort,
} from "@/logic/library";
import {
  NOT_IN_A_FOLDER,
  sectionsByFolder,
  sectionsByTopic,
  sectionsByType,
  type LibrarySection,
} from "@/logic/libraryFolders";
import { useAppData } from "@/state/AppDataContext";
import { formatShortDate, localDayOf } from "@/lib/dates";
import { isOneOf, isText, useRememberedState } from "@/state/useRememberedState";

import { DocumentSearchPanel } from "./DocumentSearchPanel";
import { LibrarySections, sectionDomId } from "./LibrarySections";
import { useLibraryFolders } from "./useLibraryFolders";
import { ArrangeBar, ArrangeRow, MANUAL_ONLY_HINT, MoveToast } from "./ArrangeParts";
import { MoveToDialog } from "./MoveToDialog";
import { useArrange } from "./useArrange";
import { ContinueStudying } from "./ContinueStudying";
import { RECENT_SHOWN, resolveRecent, useRecentlyOpened } from "./recentlyOpened";
import { FolderActionsMenu, FolderDialogs, NewFolderButton, StarterFoldersDialog, type FolderDialogState } from "./FolderDialogs";
import { FaaReferences } from "./FaaReferences";
import { AcsCodeLookupPanel } from "./AcsCodeLookupPanel";
import { AcsAreaMaterialCoveragePanel } from "./AcsAreaMaterialCoveragePanel";
import { ImportStudyPacketDialog } from "./ImportStudyPacketDialog";
import { AddStudyPackDialog } from "./AddStudyPackDialog";
import { ExportCenterDialog } from "./ExportCenterDialog";
import { MaterialFormDialog, type MaterialDraft } from "./MaterialFormDialog";
import { PhotoPictureButton } from "./PhotoPictureButton";
import { StudyLibraryHistory } from "./StudyLibraryHistory";
import { StudyHowTo } from "./StudyHowTo";
import { DiagramsView } from "./DiagramsView";
import { StudyLibraryReviewDue } from "./StudyLibraryReviewDue";
import { useLibraryDueStream } from "./useLibraryReviews";
import { useOfflineBadges, type OfflineBadge } from "./useOfflineBadges";
import { FreeStudyLinks } from "./FreeStudyLinks";
import "./studyLibrary.css";

export type LibraryTab = "library" | "due" | "history" | "diagrams" | "howto";
type LibraryTabChoice = { value: LibraryTab; label: string };
const TABS: LibraryTabChoice[] = [
  { value: "library", label: "Library" },
  { value: "due", label: "Review due" },
  { value: "history", label: "History" },
  { value: "diagrams", label: "Diagrams" },
  { value: "howto", label: "How to" },
];

/** Keep our DOM and stable deep-link ids while the hook owns keyboard/focus behavior. */
function LibraryTabButton({ choice, state }: { choice: LibraryTabChoice; state: TabListState<LibraryTabChoice> }) {
  const ref = useRef<HTMLButtonElement>(null);
  const { tabProps, isSelected } = useTab({ key: choice.value }, state, ref);
  return (
    <button
      {...tabProps}
      ref={ref}
      type="button"
      id={`library-tab-${choice.value}`}
      aria-controls={`library-panel-${choice.value}`}
      className={`library-tab${isSelected ? " is-active" : ""}`}
    >
      {choice.label}
    </button>
  );
}

/** The tab named in the address (`?tab=due`, `?tab=history`, `?tab=diagrams`, `?tab=howto`); anything else is the Library. */
export function libraryTabFrom(params: URLSearchParams): LibraryTab {
  const tab = params.get("tab");
  return tab === "due" || tab === "history" || tab === "diagrams" || tab === "howto" ? tab : "library";
}

type StatusFilter = ReviewStatus | "all" | "next_up";

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Everything" },
  { value: "next_up", label: "Next Up" },
  { value: "studying", label: "Studying" },
  { value: "needs_review", label: "Review again" },
  { value: "confident", label: "Confident" },
  { value: "reference_only", label: "Reference Only" },
];

const STATUS_VALUES = STATUS_FILTERS.map((filter) => filter.value);
const SORT_VALUES = MATERIAL_SORT_OPTIONS.map((option) => option.value);
const MATERIAL_PAGE_SIZE = 100;
const NO_LIMITS: Record<string, number> = {};
type LibraryView = "everything" | "folder" | "topic" | "type";
const VIEW_OPTIONS: Array<{ value: LibraryView; label: string }> = [
  { value: "everything", label: "Everything" },
  { value: "folder", label: "By folder" },
  { value: "topic", label: "By topic" },
  { value: "type", label: "By type" },
];
const FOLDER_SORT_VALUES = FOLDER_SORT_OPTIONS.map((option) => option.value);
const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
/** Links that name the reference shelf (`/study#references`) open it. */
export const REFERENCE_SHELF_ID = "references";
const LIBRARY_TOOLS = [
  { id: REFERENCE_SHELF_ID, label: "FAA handbooks" },
  { id: "acs-lookup", label: "Missed-topic codes" },
];
const SHELF_STATES = ["open", "closed"] as const;

export function StudyLibrary() {
  const { data, dataRevision, mutate, repositories } = useAppData();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = libraryTabFrom(params);
  const tabState = useTabListState<LibraryTabChoice>({
    selectedKey: tab,
    onSelectionChange: (key) => {
      if (key === tab) return;
      const next = new URLSearchParams(params);
      if (key === "library") next.delete("tab");
      else next.set("tab", String(key));
      setParams(next);
    },
    disabledKeys: [],
    items: TABS,
    children: (choice) => <Item key={choice.value} textValue={choice.label}>{choice.label}</Item>,
  });
  const tabListRef = useRef<HTMLDivElement>(null);
  const { tabListProps } = useTabList({ "aria-label": "Study Library views", keyboardActivation: "automatic" }, tabState, tabListRef);
  const tabPanelRef = useRef<HTMLDivElement>(null);
  const { tabPanelProps } = useTabPanel({}, tabState, tabPanelRef);
  const cardLibrary = repositories?.cardLibrary;
  const [binderStatus, setBinderStatus] = useState<BinderStatus | null>(null);
  const materialsWithCards = useMemo(
    () => new Set(data.aiStudySets.filter((set) => set.flashcards.length > 0).map((set) => set.sourceMaterialId)),
    [data.aiStudySets],
  );
  const [importing, setImporting] = useState(false);
  const [addingPack, setAddingPack] = useState(false);
  const [exportingHandouts, setExportingHandouts] = useState(false);
  // Kept while the app is open, so moving to a material and back does not
  // throw away the filtering the student just set up.
  const [status, setStatus] = useRememberedState<StatusFilter>(
    "library.status", "all", isOneOf(STATUS_VALUES),
  );
  const [topic, setTopic] = useRememberedState<Topic | "">(
    "library.topic", "", isOneOf(["", ...TOPIC_OPTIONS.map((option) => option.value)]),
  );
  const [type, setType] = useRememberedState<MaterialType | "">(
    "library.type", "", isOneOf(["", ...MATERIAL_TYPE_OPTIONS.map((option) => option.value)]),
  );
  const [search, setSearch] = useRememberedState<string>("library.search", "", isText);
  // Quick Find (⌘K) hands the student words over as `/study?q=…`: they go in the search
  // box, which is what searching inside the PDFs reads, then the address is
  // left alone so typing from here changes what the student sees.
  const handedOver = params.get("q");
  useEffect(() => {
    if (handedOver === null) return;
    setSearch(handedOver);
    const next = new URLSearchParams(params);
    next.delete("q");
    setParams(next, { replace: true });
  }, [handedOver, params, setParams, setSearch]);
  // The student's own materials come first; the FAA books and the ACS lookup wait in one
  // shelf below them, closed until the student opens it (kept while the app is open).
  const [shelf, setShelf] = useRememberedState<(typeof SHELF_STATES)[number]>(
    "library.referenceShelf", "closed", isOneOf(SHELF_STATES),
  );
  const location = useLocation();
  const shelfTarget = LIBRARY_TOOLS.find(tool => location.hash === `#${tool.id}`)?.id;
  const openShelf = () => {
    setShelf("open");
    setSearch("");
  };
  // Once per arriving link, so typing afterwards is left alone.
  const shelfLinkFor = useRef<string | null>(null);
  useEffect(() => {
    if (!shelfTarget || shelfLinkFor.current === location.key) return;
    shelfLinkFor.current = location.key;
    setShelf("open");
    setSearch("");
  }, [shelfTarget, location.key, setShelf, setSearch]);
  useEffect(() => {
    if (shelfTarget && shelf === "open" && tab === "library" && !search.trim()) {
      document.getElementById(shelfTarget)?.scrollIntoView?.({ block: "start" });
    }
  }, [shelfTarget, location.key, shelf, tab, search]);
  const searchBox = useRef<HTMLInputElement>(null);
  const searchJustFocused = useRef(false);
  const moreMenu = useRef<HTMLDetailsElement>(null);
  const fromMoreMenu = (open: () => void) => () => {
    if (moreMenu.current) moreMenu.current.open = false;
    open();
  };
  const [sort, setSort] = useRememberedState<MaterialSort>(
    "library.sort", "recent", isOneOf(SORT_VALUES),
  );
  const [contentMatch, setContentMatch] = useState<{ key: string; found: boolean } | null>(null);
  const [view, setView] = useRememberedState<LibraryView>(
    "library.view", "everything", isOneOf(VIEW_OPTIONS.map((option) => option.value)), "device",
  );
  const [layout, setLayout] = useRememberedState<"cards" | "list">(
    "library.layout", "cards", isOneOf(["cards", "list"] as const), "device",
  );
  const listLayout = layout === "list";
  const gridClass = listLayout ? "material-grid material-grid--list" : "material-grid";
  const [folderSort, setFolderSort] = useRememberedState<FolderSort>(
    "library.folderSort", "manual", isOneOf(FOLDER_SORT_VALUES), "device",
  );
  const [closedList, setClosedList] = useRememberedState<string[]>(
    "library.closedSections", [], isStringList, "device",
  );
  const closedSections = useMemo(() => new Set(closedList), [closedList]);
  const recentIds = useRecentlyOpened();
  const { folders, placements, folderOf, reload: reloadFolders } = useLibraryFolders();
  const [folderDialog, setFolderDialog] = useState<FolderDialogState | null>(null);
  const [starterOpen, setStarterOpen] = useState(false);
  const filterKey = [status, topic, type, search, sort, view, folderSort].join("\0");
  const onMatchesChange = useCallback((found: boolean) => setContentMatch({ key: filterKey, found }), [filterKey]);
  const contentHasMatches = contentMatch?.key === filterKey && contentMatch.found;
  const [sectionPage, setSectionPage] = useState<{ key: string; limits: Record<string, number> }>({ key: filterKey, limits: {} });
  const sectionLimits = sectionPage.key === filterKey ? sectionPage.limits : NO_LIMITS;
  const [page, setPage] = useState({ key: filterKey, limit: MATERIAL_PAGE_SIZE });
  const visibleLimit = page.key === filterKey ? page.limit : MATERIAL_PAGE_SIZE;
  useEffect(() => setPage({ key: filterKey, limit: MATERIAL_PAGE_SIZE }), [filterKey]);
  const [creating, setCreating] = useState(false);
  // Reserved up front so an imported file can be stored under the material's id.
  const [draftId, setDraftId] = useState(newId);

  // The filters other than the search words: searching inside documents
  // looks in every material they select (OFFLINE-02b).
  const filtered = useMemo(
    () =>
      data.materials.filter((material) => {
        if (material.faaReference) return false;
        if (status === "next_up" && material.priority !== "next_up") return false;
        if (status !== "all" && status !== "next_up" && material.reviewStatus !== status) return false;
        if (topic && material.topic !== topic) return false;
        if (type && material.materialType !== type) return false;
        return true;
      }),
    [data.materials, status, topic, type],
  );

  const visible = useMemo(() => {
    const query = searchText(search.trim());
    const matching = filtered.filter((material) => {
      if (query) {
        const haystack = searchText([
          material.title,
          material.notes,
          TOPIC_LABELS[material.topic],
          MATERIAL_TYPE_LABELS[material.materialType],
          ...material.tags,
        ]
          .join(" "));
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    return sortMaterials(matching, sort, recentIds);
  }, [filtered, search, sort, recentIds]);

  const titleMatchesSearch = !!search.trim() && visible.some((material) =>
    searchText(material.title).includes(searchText(search.trim())),
  );

  // Chapters split out of a book wait under the book (searching lists them flat).
  const grouped = useMemo(
    () => (search.trim() ? { topLevel: visible, partsOf: new Map<string, StudyMaterial[]>() } : groupChapterParts(visible)),
    [visible, search],
  );
  const [openBooks, setOpenBooks] = useState<ReadonlySet<string>>(new Set());
  const toggleBook = (id: string) =>
    setOpenBooks((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const chapterCount = visible.length - grouped.topLevel.length;
  const searching = !!search.trim();
  const sectioned = view !== "everything" && !searching;
  const filtersActive = status !== "all" || !!topic || !!type;
  const sections = useMemo<LibrarySection[]>(() => {
    if (!sectioned) return [];
    if (view === "folder") return sectionsByFolder(grouped.topLevel, folders, placements, folderSort, recentIds);
    return (view === "topic" ? sectionsByTopic : sectionsByType)(grouped.topLevel, sort, recentIds);
  }, [sectioned, view, grouped, folders, placements, folderSort, sort, recentIds]);
  // Chapters follow their book, so a placement on one is ignored (shown only when searching).
  const { chapterIds, chaptersOf } = useMemo(() => {
    const ids = new Set<string>();
    const partsOf = groupChapterParts(data.materials.filter((m) => !m.faaReference)).partsOf;
    for (const parts of partsOf.values()) {
      for (const part of parts) ids.add(part.id);
    }
    return { chapterIds: ids, chaptersOf: partsOf };
  }, [data.materials]);
  // One starter folder per topic with a top-level material (chapters stay with their books).
  const starterFolders = useMemo(() => {
    if (view !== "folder" || folders.length > 0) return [];
    const top = groupChapterParts(data.materials.filter((m) => !m.faaReference)).topLevel;
    return sectionsByTopic(top, "manual").map((s) => ({ name: s.title, materialIds: s.items.map((m) => m.id) }));
  }, [view, folders.length, data.materials]);
  const toggleSection = (viewKey: string) =>
    setClosedList(closedSections.has(viewKey) ? closedList.filter((k) => k !== viewKey) : [...closedList, viewKey]);
  const noFolderSection = view === "folder" ? sections.find((s) => s.key === "none") : undefined;
  const noFolderCount = noFolderSection?.items.length ?? 0;
  const [jumpTo, setJumpTo] = useState(0);
  useEffect(() => {
    if (!jumpTo) return;
    const header = document.getElementById(sectionDomId("folder:none"));
    if (!header) return;
    header.scrollIntoView?.({ block: "start" });
    header.focus();
  }, [jumpTo]);
  const jumpToNoFolder = () => {
    if (closedSections.has("folder:none")) setClosedList(closedList.filter((k) => k !== "folder:none"));
    setJumpTo((n) => n + 1);
  };
  const shownMaterials = useMemo(() => {
    if (!sectioned) return grouped.topLevel.slice(0, visibleLimit);
    return sections.flatMap((s) =>
      closedSections.has(`${view}:${s.key}`) ? [] : s.items.slice(0, sectionLimits[`${view}:${s.key}`] ?? MATERIAL_PAGE_SIZE),
    );
  }, [sectioned, sections, closedSections, sectionLimits, view, grouped, visibleLimit]);
  const selectableIds = useMemo(
    () => shownMaterials.filter((m) => !chapterIds.has(m.id)).map((m) => m.id),
    [shownMaterials, chapterIds],
  );
  const arrange = useArrange({
    selectableIds,
    placements,
    reload: reloadFolders,
    inFolderView: view === "folder",
    expandSection: (viewKey) => {
      if (closedSections.has(viewKey)) setClosedList(closedList.filter((k) => k !== viewKey));
    },
  });
  const arranging = arrange.arranging && view === "folder";
  const continueItems = useMemo(
    () => resolveRecent(recentIds, data.materials.filter((m) => !m.faaReference)).slice(0, RECENT_SHOWN),
    [recentIds, data.materials],
  );
  // Escape leaves Arrange (the Move to… dialog and menus handle their own Escape first).
  useEffect(() => {
    if (!arranging) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (arrange.target || folderDialog) return;
      if (document.querySelector("dialog[open], details[open]")) return;
      arrange.leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [arranging, arrange.target, arrange.leave, folderDialog]);
  const sectionOf = useMemo(() => {
    const map = new Map<string, LibrarySection>();
    for (const section of sections) for (const item of section.items) map.set(item.id, section);
    return map;
  }, [sections]);
  const badgeMaterials = useMemo(
    () => shownMaterials.flatMap((material) => (openBooks.has(material.id) ? [material, ...(grouped.partsOf.get(material.id) ?? [])] : [material])),
    [shownMaterials, openBooks, grouped],
  );
  const offlineBadges = useOfflineBadges(badgeMaterials);

  const nextActionTitles = useMemo(() => {
    const titles = new Map<string, string>();
    for (const action of data.actions) {
      if (action.status === "open" && action.relatedType === "material" && action.relatedId &&
          !titles.has(action.relatedId)) {
        titles.set(action.relatedId, action.title);
      }
    }
    return titles;
  }, [data.actions]);

  const save = async (draft: MaterialDraft) => {
    const created = await mutate((repos) => repos.documents.create(draft));
    if (created === null) return false;
    setDraftId(newId());
    return true;
  };

  const renderCard = (item: StudyMaterial) => (
    <MaterialCard
      key={item.id}
      material={item}
      list={listLayout}
      nextActionTitle={nextActionTitles.get(item.id)}
      offline={offlineBadges.get(item.id)}
      review={tab === "library" ? reviewIndicator(binderStatus, item.id, materialsWithCards.has(item.id)) : null}
      folderName={searching && !chapterIds.has(item.id) ? folderOf(item.id)?.name : undefined}
    />
  );
  // Mac drag: only in Arrange, with no search words, and with Sort: My order.
  const dragOn = isMacOS() && arranging && !searching && folderSort === "manual";
  const titleOf = (id: string) => data.materials.find((m) => m.id === id)?.title ?? "material";
  const renderArrangeRow = (item: StudyMaterial) => {
    const chapter = chapterIds.has(item.id);
    const section = sectionOf.get(item.id);
    const order = section?.items ?? [];
    const manual = folderSort === "manual";
    const at = order.findIndex((m) => m.id === item.id);
    return (
      <ArrangeRow
        key={item.id}
        material={item}
        chapter={chapter}
        selected={arrange.selected.has(item.id)}
        chapterCount={chaptersOf.get(item.id)?.length ?? 0}
        showArrows={!searching}
        arrowTitle={manual ? undefined : MANUAL_ONLY_HINT}
        upDisabled={!manual || at <= 0}
        downDisabled={!manual || at < 0 || at >= order.length - 1}
        onToggle={() => arrange.toggle(item.id)}
        onNudge={(direction) =>
          void arrange.nudge(section?.folderId ?? null, order.map((m) => m.id), item.id, item.title, direction)
        }
        onMove={() => arrange.openMove([item.id], item.title)}
        drag={dragOn && section ? {
          dragging: arrange.drag.dragging.has(item.id),
          over: arrange.drag.over?.kind === "row" && arrange.drag.over.key === item.id,
          onDragStart: () => arrange.drag.start(item.id),
          onDragEnd: arrange.drag.end,
          onDragOver: (e) => arrange.drag.onOver(e, { kind: "row", key: item.id }),
          onDragLeave: () => undefined,
          onDrop: (e) =>
            void arrange.drag.drop(e, {
              folderId: section.folderId ?? null,
              folderName: section.title,
              order: order.map((m) => m.id),
              beforeId: item.id,
              titleOf,
            }),
        } : undefined}
      />
    );
  };
  const renderBook = (material: StudyMaterial) => {
    const parts = grouped.partsOf.get(material.id) ?? [];
    const open = openBooks.has(material.id);
    const card = arranging ? renderArrangeRow : renderCard;
    if (parts.length === 0) return card(material);
    return (
      <div key={material.id} className="material-group" style={{ display: "contents" }}>
        {card(material)}
        <div style={{ gridColumn: "1 / -1" }}>
          <Button aria-expanded={open} onClick={() => toggleBook(material.id)}>
            {open ? "Hide" : "Show"} {chapterCountLabel(parts.length)} from {material.title}
          </Button>
        </div>
        {open ? parts.map(card) : null}
      </div>
    );
  };

  const hasAny = data.materials.length > 0;
  const [videoMaterialIds, setVideoMaterialIds] = useState<ReadonlySet<string>>(new Set());
  const videoLinks = repositories?.materialVideoLinks;
  useEffect(() => {
    if (!videoLinks) return;
    let cancelled = false;
    void videoLinks.materialIdsWithLinks().then((ids) => {
      if (cancelled) return;
      setVideoMaterialIds((current) => (current.size === ids.length && ids.every((id) => current.has(id)) ? current : new Set(ids)));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [videoLinks, dataRevision]);
  // Oversized files stay listed (disabled) so the student sees why they are not offered.
  const packEligibleIds = useMemo(() => new Set(data.materials.filter((material) => packFileTooLarge(material) || isPackExportable(
    material,
    data.aiStudySets.some((set) => set.sourceMaterialId === material.id),
    data.practiceTests.find((test) => test.sourceMaterialId === material.id)?.questions.length ?? 0,
    videoMaterialIds.has(material.id),
  )).map((material) => material.id)), [data.materials, data.aiStudySets, data.practiceTests, videoMaterialIds]);
  const canSharePack = useMemo(() => packRows(data.materials.filter((material) => packEligibleIds.has(material.id))).some((row) => !packRowBlocked(row)), [data.materials, packEligibleIds]);
  const exportSources = useMemo(() => data.materials.flatMap((material) => {
    const source = {
      material: { title: material.title },
      studySet: data.aiStudySets.find((set) => set.sourceMaterialId === material.id) ?? null,
      practiceTest: data.practiceTests.find((test) => test.sourceMaterialId === material.id) ?? null,
    };
    return Object.values(exportableParts(source)).some(Boolean) ? [source] : [];
  }), [data.materials, data.aiStudySets, data.practiceTests]);

  const topicPanels = (<>
      <div style={{ marginBottom: "var(--space-5)" }}>
        <AcsCodeLookupPanel
          materials={data.materials}
          aiStudySets={data.aiStudySets}
          practiceTests={data.practiceTests}
          questions={data.questions}
        />
      </div>

      <div style={{ marginBottom: "var(--space-5)" }}>
        <AcsAreaMaterialCoveragePanel
          materials={data.materials}
        />
      </div>
  </>);

  return (
    <>
      <BackToTop />
      <PageHeader
        title="Study Library"
        subtitle="Your training binder — notes, handouts, worksheets and what to do with them."
        action={
          <div className="row row--wrap">
            <Link to="/study/homework" className="button button--secondary">Homework</Link>
            {deviceCan().splitFiles || deviceCan().sharePrint ? <details ref={moreMenu} className="library__actions-more">
              <summary className="button button--secondary">More</summary>
              <div className="library__actions-menu">
                {deviceCan().splitFiles ? <Button onClick={fromMoreMenu(() => setImporting(true))} disabled={importing}>
                  <NoteIcon size={16} /> Import study packet…
                </Button> : null}
                {deviceCan().sharePrint ? <Button onClick={fromMoreMenu(() => setExportingHandouts(true))} disabled={exportSources.length === 0 && !(studyPacksAvailable() && canSharePack)}>
                  {deviceCan().revealFiles ? "Export handout or cards…" : "Save handout or cards"}
                </Button> : null}
              </div>
            </details> : null}
            {studyPacksAvailable() ? <Button onClick={() => setAddingPack(true)} disabled={addingPack}>Add study pack</Button> : null}
            {deviceCan().importFiles ? <Button variant="primary" onClick={() => setCreating(true)}>
              <PlusIcon size={16} /> Add material
            </Button> : null}
            {deviceCan().pictureFromPhoto ? <PhotoPictureButton /> : null}
          </div>
        }
      />

      <nav aria-label="Tools" className="row row--wrap">
        <span className="muted">Tools:</span>
        {LIBRARY_TOOLS.map(tool => (
          <Link key={tool.id} to={`/study#${tool.id}`} onClick={openShelf}>{tool.label}</Link>
        ))}
      </nav>

      <div {...tabListProps} ref={tabListRef} className="library-tabs">
        {TABS.map((choice) => <LibraryTabButton key={choice.value} choice={choice} state={tabState} />)}
      </div>

      {tab === "due" && cardLibrary ? (
        <div {...tabPanelProps} ref={tabPanelRef} id="library-panel-due" aria-labelledby="library-tab-due">
          <StudyLibraryReviewDue repository={cardLibrary} reviews={repositories?.cardReviews} dataRevision={dataRevision} />
        </div>
      ) : null}
      {tab === "history" && cardLibrary ? (
        <div {...tabPanelProps} ref={tabPanelRef} id="library-panel-history" aria-labelledby="library-tab-history">
          <StudyLibraryHistory repository={cardLibrary} materials={data.materials} dataRevision={dataRevision} />
        </div>
      ) : null}
      {tab === "diagrams" ? (
        <div {...tabPanelProps} ref={tabPanelRef} id="library-panel-diagrams" aria-labelledby="library-tab-diagrams">
          <DiagramsView topic={params.get("topic")} />
        </div>
      ) : null}
      {tab === "howto" ? (
        <div {...tabPanelProps} ref={tabPanelRef} id="library-panel-howto" aria-labelledby="library-tab-howto">
          <StudyHowTo />
        </div>
      ) : null}

      {tab === "library" ? (
      <div {...tabPanelProps} ref={tabPanelRef} id="library-panel-library" aria-labelledby="library-tab-library">
      {hasAny && cardLibrary ? (
        <BinderReviewStatus repository={cardLibrary} dataRevision={dataRevision} onStatus={setBinderStatus} />
      ) : null}
      {(
        <div className="library__toolbar">
          <div className="search-field">
            <span className="search-field__icon">
              <SearchIcon size={16} />
            </span>
            <TextInput
              ref={searchBox}
              value={search}
              placeholder={offlineStudyEnabled() ? "Search titles, PDFs, notes and homework" : "Search titles, notes and tags"}
              aria-label="Search your library"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              // Coming back to remembered words, typing replaces them. WebKit
              // drops a focus selection on the click's mouseup, so that one
              // mouseup is skipped.
              onFocus={(e) => {
                e.currentTarget.select();
                searchJustFocused.current = true;
              }}
              onMouseUp={(e) => {
                if (searchJustFocused.current) e.preventDefault();
                searchJustFocused.current = false;
              }}
              onBlur={() => { searchJustFocused.current = false; }}
              onKeyDown={() => { searchJustFocused.current = false; }}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search ? (
              <button
                type="button"
                className="search-field__clear"
                aria-label="Clear search"
                onClick={() => {
                  setSearch("");
                  searchBox.current?.focus();
                }}
              >
                ×
              </button>
            ) : null}
          </div>
          <Select
            aria-label="Filter by topic"
            placeholder="Any topic"
            options={TOPIC_OPTIONS}
            value={topic}
            onChange={(value) => setTopic(value)}
            style={{ width: "auto" }}
          />
          <Select
            aria-label="Filter by material type"
            placeholder="Any type"
            options={MATERIAL_TYPE_OPTIONS}
            value={type}
            onChange={(value) => setType(value)}
            style={{ width: "auto" }}
          />
          <Select
            aria-label="View"
            options={VIEW_OPTIONS}
            value={view}
            onChange={(value) => setView(value)}
            style={{ width: "auto" }}
          />
          {view === "folder" ? (
            <Select
              aria-label="Sort materials"
              options={FOLDER_SORT_OPTIONS}
              value={folderSort}
              onChange={(value) => setFolderSort(value)}
              style={{ width: "auto" }}
            />
          ) : (
            <Select
              aria-label="Sort materials"
              options={MATERIAL_SORT_OPTIONS}
              value={sort}
              onChange={(value) => setSort(value)}
              style={{ width: "auto" }}
            />
          )}
          <div className="library__layout" role="group" aria-label="Layout">
            <Button aria-pressed={!listLayout} onClick={() => setLayout("cards")}>Cards</Button>
            <Button aria-pressed={listLayout} onClick={() => setLayout("list")}>List</Button>
          </div>
        </div>
      )}

      {hasAny && !searching && !arranging ? <ContinueStudying materials={continueItems} /> : null}

      {!titleMatchesSearch ? (
      <DocumentSearchPanel onMatchesChange={onMatchesChange} query={search} materials={filtered} materialFiltersActive={status !== "all" || !!topic || !!type} />
      ) : null}

      {hasAny ? (
        <div className="filter-chips scroll-x" style={{ marginBottom: "var(--space-5)" }}>
          {STATUS_FILTERS.map((filter) => (
            <button
              type="button"
              key={filter.value}
              className={`filter-chip${status === filter.value ? " is-active" : ""}`}
              aria-pressed={status === filter.value}
              onClick={() => setStatus(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      ) : null}

      {!hasAny ? (
        <Card>
          <EmptyState
            icon={<BookIcon size={30} />}
            title="Your training library is ready."
            body={deviceCan().importFiles ? "Add your first study guide, lesson notes, or instructor handout. Give it a topic and a next action and it will find its way onto your Flight Deck." : "Add PDFs on your Mac, then Send to my iPhone."}
            action={
              deviceCan().importFiles ? <Button variant="primary" onClick={() => setCreating(true)}>
                Add material
              </Button> : null
            }
          />
        </Card>
      ) : visible.length === 0 ? (
        contentHasMatches ? null : <Card>
          <EmptyState
            title="Nothing matches those filters."
            body="Try a different status or clear the search."
            action={
              <Button
                onClick={() => {
                  setStatus("all");
                  setTopic("");
                  setType("");
                  setSearch("");
                  setSort("recent");
                }}
              >
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <p className="small muted library__result-count">
            {sectioned ? (
              <>
                {grouped.topLevel.length.toLocaleString()} materials in{" "}
                {view === "folder"
                  ? plural(folders.length, "folder", "folders")
                  : plural(sections.length, view === "topic" ? "topic" : "type", view === "topic" ? "topics" : "types")}
                {chapterCount > 0 ? ` (${chapterCount.toLocaleString()} more are chapters inside the books)` : ""}
              </>
            ) : (
              <>
                Showing {Math.min(visibleLimit, grouped.topLevel.length).toLocaleString()} of {grouped.topLevel.length.toLocaleString()} materials{chapterCount > 0 ? ` (${chapterCount.toLocaleString()} more are chapters inside the books)` : ""}
              </>
            )}
          </p>
          {view === "folder" && !arranging ? (
            <div className="library__folder-slot">
              {sectioned ? <NewFolderButton folderCount={folders.length} onClick={() => setFolderDialog({ kind: "new" })} /> : null}
              <Button variant="secondary" onClick={arrange.start}>Arrange</Button>
              {sectioned && folders.length > 0 && noFolderCount > 0 ? (
                <button type="button" className="library__jump" onClick={jumpToNoFolder}>
                  {NOT_IN_A_FOLDER} ({noFolderCount.toLocaleString()})
                </button>
              ) : null}
            </div>
          ) : null}
          {arranging ? (
            <ArrangeBar
              barRef={arrange.barRef}
              count={arrange.selected.size}
              onSelectAll={arrange.selectAll}
              announcement={arrange.announcement}
              onMove={() => arrange.openMove([...arrange.selected])}
              onDone={arrange.leave}
            />
          ) : null}
          {sectioned && view === "folder" && folders.length === 0 ? (
            <Card>
              <p className="small">
                Make a folder to group your study material, for example Checkride prep. Then use Arrange to move things in.
              </p>
              <div className="library__folder-slot">
                <NewFolderButton folderCount={folders.length} onClick={() => setFolderDialog({ kind: "new" })} />
                {starterFolders.length > 0 ? (
                  <Button variant="secondary" onClick={() => setStarterOpen(true)}>Make folders from my topics</Button>
                ) : null}
              </div>
              <StarterFoldersDialog
                open={starterOpen}
                starters={starterFolders}
                folders={folders}
                onClose={() => setStarterOpen(false)}
                reload={reloadFolders}
              />
            </Card>
          ) : null}
          {sectioned && view === "folder" ? (
            <FolderDialogs state={folderDialog} folders={folders} onClose={() => setFolderDialog(null)} reload={reloadFolders} />
          ) : null}
          {sectioned ? (
            <LibrarySections
              view={view}
              sections={sections}
              closed={closedSections}
              onToggle={toggleSection}
              limits={sectionLimits}
              onShowMore={(key, next) => setSectionPage({ key: filterKey, limits: { ...sectionLimits, [key]: next } })}
              hideEmpty={filtersActive}
              renderBook={renderBook}
              gridClass={arranging ? "material-grid material-grid--list" : gridClass}
              flashKey={arrange.flashKey}
              headDrop={dragOn ? {
                overKey: arrange.drag.over?.kind === "head" ? arrange.drag.over.key : null,
                onDragOver: (e, _section, viewKey) => arrange.drag.onOver(e, { kind: "head", key: viewKey }),
                onDragLeave: () => undefined,
                onDrop: (e, section) =>
                  void arrange.drag.drop(e, {
                    folderId: section.folderId ?? null,
                    folderName: section.title,
                    order: section.items.map((m) => m.id),
                    beforeId: null,
                    titleOf,
                  }),
              } : undefined}
              headerActions={view === "folder" ? (section, index) => {
                const folder = section.folderId ? folders.find((f) => f.id === section.folderId) : undefined;
                if (!folder) return null;
                return (
                  <FolderActionsMenu
                    folder={folder}
                    count={section.items.length}
                    index={index}
                    total={folders.length}
                    onRename={() => setFolderDialog({ kind: "rename", folder })}
                    onDelete={(count) => setFolderDialog({ kind: "delete", folder, count })}
                    onMove={(direction) => {
                      void repositories?.libraryFolders.moveFolder(folder.id, direction).then(reloadFolders, reloadFolders);
                    }}
                  />
                );
              } : undefined}
            />
          ) : (
            <div className={arranging ? "material-grid material-grid--list" : gridClass}>{shownMaterials.map(renderBook)}</div>
          )}
          {!sectioned && grouped.topLevel.length > visibleLimit ? (
            <div className="library__more">
              <Button onClick={() => setPage({ key: filterKey, limit: visibleLimit + MATERIAL_PAGE_SIZE })}>
                Show 100 more materials
              </Button>
            </div>
          ) : null}
        </>
      )}

      <MoveToDialog
        open={arranging && arrange.target !== null}
        onClose={arrange.closeMove}
        materialIds={arrange.target?.ids ?? []}
        materialTitle={arrange.target?.title}
        folders={folders}
        placements={placements}
        onBeforeMove={arrange.remember}
        onMoved={arrange.moved}
      />
      <MoveToast notice={arrange.notice} onUndo={() => void arrange.undo()} />

      <FreeStudyLinks />

      <div style={{ marginBottom: "var(--space-4)", display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <CheckrideTopicPractice practiceTests={data.practiceTests} materials={data.materials} />
        <MixedPracticeTest practiceTests={data.practiceTests} materials={data.materials} />
      </div>

      {!search.trim() ? (
        <details
          id={REFERENCE_SHELF_ID}
          className="library__shelf"
          open={shelf === "open"}
          onToggle={(e) => {
            const next = e.currentTarget.open ? "open" : "closed";
            if (next !== shelf) setShelf(next);
          }}
        >
          <summary className="library__shelf-summary">References and ACS lookup</summary>
          <p className="tiny muted">Optional FAA books, and a finder for the ACS codes on a knowledge-test report.</p>
          <div className="library__shelf-body">
            <FaaReferences onAddPdf={() => setCreating(true)} />
            <div id="acs-lookup">{topicPanels}</div>
          </div>
        </details>
      ) : null}

      {titleMatchesSearch ? (
      <DocumentSearchPanel onMatchesChange={onMatchesChange} query={search} materials={filtered} materialFiltersActive={status !== "all" || !!topic || !!type} />
      ) : null}

      </div>
      ) : null}

      <MaterialFormDialog
        open={creating}
        goals={data.goals}
        events={data.events}
        newMaterialId={draftId}
        onClose={() => setCreating(false)}
        onSave={save}
      />

      <ImportStudyPacketDialog
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(materialId, refreshed) => {
          setImporting(false);
          // Without a refresh the new material is not on screen yet; the page
          // banner says so, and opening it now would show "not found".
          if (refreshed) navigate(`/study/${materialId}`);
        }}
      />

      {studyPacksAvailable() ? <AddStudyPackDialog open={addingPack} onClose={() => setAddingPack(false)} /> : null}

      {deviceCan().sharePrint ? <ExportCenterDialog
        open={exportingHandouts}
        sources={exportSources}
        materials={data.materials}
        packEligibleIds={packEligibleIds}
        onClose={() => setExportingHandouts(false)}
      /> : null}
    </>
  );
}

function MaterialCard({
  material,
  nextActionTitle,
  review,
  offline,
  folderName,
  list,
}: {
  list?: boolean;
  material: StudyMaterial;
  nextActionTitle?: string;
  review?: string | null;
  offline?: OfflineBadge;
  folderName?: string;
}) {
  const statusTone =
    material.reviewStatus === "confident"
      ? "complete"
      : material.reviewStatus === "studying"
        ? "study"
        : "neutral";

  if (list) {
    const day = localDayOf(material.createdAt);
    return (
      <Link className="material-row" to={`/study/${material.id}`} state={{ fromLibrary: true }}>
        <span className="material-row__title wrap-anywhere">{material.title}</span>
        <span className="material-row__col">{MATERIAL_TYPE_LABELS[material.materialType]}</span>
        <span className="material-row__col material-row__topic">{TOPIC_LABELS[material.topic]}</span>
        <span className="material-row__col">{REVIEW_STATUS_LABELS[material.reviewStatus]}</span>
        {day ? <span className="material-row__col material-row__date">added {formatShortDate(day)}</span> : null}
        {folderName ? <span className="tiny dim library__in-folder">In: {folderName}</span> : null}
      </Link>
    );
  }

  return (
    <Link className="material-card" to={`/study/${material.id}`} state={{ fromLibrary: true }}>
      <span className="material-card__top">
        <span className="material-card__mark" aria-hidden="true">
          {material.filePath ? <DocumentIcon size={17} /> : <BookIcon size={17} />}
        </span>
        <span style={{ minWidth: 0 }}>
          <span className="material-card__title wrap-anywhere">{material.title}</span>
          <span className="tiny dim" style={{ display: "block", marginTop: 2 }}>
            {MATERIAL_TYPE_LABELS[material.materialType]}
          </span>
        </span>
      </span>

      {material.tags.length > 0 ? (
        <span className="tag-list">
          {material.tags.slice(0, 3).map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </span>
      ) : null}

      <span className="material-card__meta">
        <Badge tone="study">{TOPIC_LABELS[material.topic]}</Badge>
        <Badge tone={statusTone}>{REVIEW_STATUS_LABELS[material.reviewStatus]}</Badge>
        {material.priority === "next_up" ? <Badge tone="berry">Next Up</Badge> : null}
        {offline ? <Badge tone={offline.tone}>{offline.label}</Badge> : null}
        {review ? <Badge tone={review === "Caught up" ? "complete" : review.startsWith("Cards") ? "neutral" : "due"}>{review}</Badge> : null}
      </span>

      {nextActionTitle ? (
        <span className="material-card__next truncate">Next: {nextActionTitle}</span>
      ) : null}
      {folderName ? <span className="tiny dim library__in-folder">In: {folderName}</span> : null}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Binder review indicators (M2-4 / C2)                                */
/* ------------------------------------------------------------------ */

export interface BinderStatus {
  entries: Map<string, LibraryReviewMaterialEntry>;
  issues: Map<string, LibraryReviewOversizeIssue>;
  /** Every material with cards has been checked. */
  complete: boolean;
}

/**
 * A material card's review label: "2 due", "8 new", "Caught up" only once
 * every material has been checked, or nothing while unknown.
 */
export function reviewIndicator(status: BinderStatus | null, materialId: string, hasCards: boolean): string | null {
  if (!status) return null;
  const entry = status.entries.get(materialId);
  if (entry) {
    const parts: string[] = [];
    if (entry.totalDueCount > 0) parts.push(`${entry.totalDueCount.toLocaleString()} due`);
    if (entry.newCount > 0) parts.push(`${entry.newCount.toLocaleString()} new`);
    return parts.join(" · ");
  }
  if (status.issues.has(materialId)) return "Cards too large to check";
  return status.complete && hasCards ? "Caught up" : null;
}

/**
 * The binder's own bounded Review due stream (all actionable, any topic).
 * It reports what it has checked; materials beyond the checked part show no
 * label rather than a guess.
 */
function BinderReviewStatus({
  repository,
  dataRevision,
  onStatus,
}: {
  repository: CardLibraryRepository;
  /** Every published app data snapshot makes the loaded status obsolete. */
  dataRevision: number;
  onStatus: (status: BinderStatus | null) => void;
}) {
  const { stream, state } = useLibraryDueStream(repository, { statusFilter: "all", topic: null }, dataRevision, 250);
  useEffect(() => {
    onStatus(
      state.pagesLoaded === 0
        ? null
        : {
            entries: new Map(state.rows.map((row) => [row.materialId, row])),
            issues: new Map(state.issues.map((issue) => [issue.materialId, issue])),
            complete: state.isComplete,
          },
    );
  }, [onStatus, state.rows, state.issues, state.isComplete, state.pagesLoaded]);
  useEffect(() => () => onStatus(null), [onStatus]);
  if (state.error) {
    return (
      <p className="tiny muted library__review-status" role="status">
        Card review status couldn&rsquo;t be checked just now.{" "}
        <button type="button" className="link-button" onClick={() => void stream.retryRead()}>
          Retry
        </button>
      </p>
    );
  }
  if (state.pagesLoaded > 0 && !state.isComplete) {
    return (
      <p className="tiny muted library__review-status" role="status">
        Card review status is shown for the materials checked so far.{" "}
        <button type="button" className="link-button" onClick={() => void stream.loadNextPage()} disabled={state.loading !== null}>
          Check more
        </button>
      </p>
    );
  }
  return null;
}
