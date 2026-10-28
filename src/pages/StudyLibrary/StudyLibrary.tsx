import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

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
import type { CardLibraryRepository } from "@/data/repositories/cardLibraryRepository";
import { offlineStudyEnabled } from "@/services/offlineContent";
import { searchText } from "@/logic/searchText";
import { exportableParts } from "@/logic/studyExport";
import { newId } from "@/lib/id";
import { MATERIAL_SORT_OPTIONS, sortMaterials, type MaterialSort } from "@/logic/library";
import { useAppData } from "@/state/AppDataContext";
import { isOneOf, isText, useRememberedState } from "@/state/useRememberedState";

import { DocumentSearchPanel } from "./DocumentSearchPanel";
import { AcsCodeLookupPanel } from "./AcsCodeLookupPanel";
import { AcsAreaMaterialCoveragePanel } from "./AcsAreaMaterialCoveragePanel";
import { ImportStudyPacketDialog } from "./ImportStudyPacketDialog";
import { ExportCenterDialog } from "./ExportCenterDialog";
import { MaterialFormDialog, type MaterialDraft } from "./MaterialFormDialog";
import { StudyLibraryHistory } from "./StudyLibraryHistory";
import { StudyLibraryReviewDue } from "./StudyLibraryReviewDue";
import { useLibraryDueStream } from "./useLibraryReviews";
import { useOfflineBadges, type OfflineBadge } from "./useOfflineBadges";
import "./studyLibrary.css";

export type LibraryTab = "library" | "due" | "history";
const TABS: Array<{ value: LibraryTab; label: string }> = [
  { value: "library", label: "Library" },
  { value: "due", label: "Review due" },
  { value: "history", label: "History" },
];

/** The tab named in the address (`?tab=due`, `?tab=history`); anything else is the Library. */
export function libraryTabFrom(params: URLSearchParams): LibraryTab {
  const tab = params.get("tab");
  return tab === "due" || tab === "history" ? tab : "library";
}

type StatusFilter = ReviewStatus | "all" | "next_up";

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Everything" },
  { value: "next_up", label: "Next Up" },
  { value: "studying", label: "Studying" },
  { value: "needs_review", label: "Needs Review" },
  { value: "confident", label: "Confident" },
  { value: "reference_only", label: "Reference Only" },
];

const STATUS_VALUES = STATUS_FILTERS.map((filter) => filter.value);
const SORT_VALUES = MATERIAL_SORT_OPTIONS.map((option) => option.value);
const MATERIAL_PAGE_SIZE = 100;

export function StudyLibrary() {
  const { data, dataRevision, mutate, repositories } = useAppData();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = libraryTabFrom(params);
  const cardLibrary = repositories?.cardLibrary;
  const [binderStatus, setBinderStatus] = useState<BinderStatus | null>(null);
  const materialsWithCards = useMemo(
    () => new Set(data.aiStudySets.filter((set) => set.flashcards.length > 0).map((set) => set.sourceMaterialId)),
    [data.aiStudySets],
  );
  const [importing, setImporting] = useState(false);
  const [exportingHandouts, setExportingHandouts] = useState(false);
  // Kept while the app is open, so moving to a material and back does not
  // throw away the filtering she just set up.
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
  // Quick Find (⌘K) hands her words over as `/study?q=…`: they go in the search
  // box, which is what searching inside the PDFs reads, then the address is
  // left alone so typing from here changes what she sees.
  const handedOver = params.get("q");
  useEffect(() => {
    if (handedOver === null) return;
    setSearch(handedOver);
    const next = new URLSearchParams(params);
    next.delete("q");
    setParams(next, { replace: true });
  }, [handedOver, params, setParams, setSearch]);
  const [sort, setSort] = useRememberedState<MaterialSort>(
    "library.sort", "recent", isOneOf(SORT_VALUES),
  );
  const [contentMatch, setContentMatch] = useState<{ key: string; found: boolean } | null>(null);
  const filterKey = [status, topic, type, search, sort].join("\0");
  const onMatchesChange = useCallback((found: boolean) => setContentMatch({ key: filterKey, found }), [filterKey]);
  const contentHasMatches = contentMatch?.key === filterKey && contentMatch.found;
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
    return sortMaterials(matching, sort);
  }, [filtered, search, sort]);

  const titleMatchesSearch = !!search.trim() && visible.some((material) =>
    searchText(material.title).includes(searchText(search.trim())),
  );

  const shownMaterials = useMemo(() => visible.slice(0, visibleLimit), [visible, visibleLimit]);
  const offlineBadges = useOfflineBadges(shownMaterials);

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

  const hasAny = data.materials.length > 0;
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
      <PageHeader
        title="Study Library"
        subtitle="Your training binder — notes, handouts, worksheets and what to do with them."
        action={
          <div className="row row--wrap">
            <Link to="/study/homework" className="button button--secondary">Homework</Link>
            <Link to="/study/history" className="button button--secondary">
              Practice history
            </Link>
            <Button variant="secondary" onClick={() => setExportingHandouts(true)} disabled={exportSources.length === 0}>
              Export handout…
            </Button>
            <Button onClick={() => setImporting(true)} disabled={importing}>
              <NoteIcon size={16} /> Import study packet…
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <PlusIcon size={16} /> Add material
            </Button>
          </div>
        }
      />

      <div className="library-tabs" role="tablist" aria-label="Study Library views">
        {TABS.map((choice) => (
          <button
            type="button"
            role="tab"
            key={choice.value}
            id={`library-tab-${choice.value}`}
            aria-selected={tab === choice.value}
            aria-controls={`library-panel-${choice.value}`}
            className={`library-tab${tab === choice.value ? " is-active" : ""}`}
            onClick={() => {
              if (choice.value === tab) return;
              const next = new URLSearchParams(params);
              if (choice.value === "library") next.delete("tab");
              else next.set("tab", choice.value);
              setParams(next);
            }}
          >
            {choice.label}
          </button>
        ))}
      </div>

      {tab === "due" && cardLibrary ? (
        <div role="tabpanel" id="library-panel-due" aria-labelledby="library-tab-due">
          <StudyLibraryReviewDue repository={cardLibrary} dataRevision={dataRevision} />
        </div>
      ) : null}
      {tab === "history" && cardLibrary ? (
        <div role="tabpanel" id="library-panel-history" aria-labelledby="library-tab-history">
          <StudyLibraryHistory repository={cardLibrary} materials={data.materials} dataRevision={dataRevision} />
        </div>
      ) : null}

      {tab === "library" ? (
      <div role="tabpanel" id="library-panel-library" aria-labelledby="library-tab-library">
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
              value={search}
              placeholder={offlineStudyEnabled() ? "Search titles, PDFs, notes and homework" : "Search titles, notes and tags"}
              aria-label="Search your library"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => setSearch(e.target.value)}
            />
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
            aria-label="Sort materials"
            options={MATERIAL_SORT_OPTIONS}
            value={sort}
            onChange={(value) => setSort(value)}
            style={{ width: "auto" }}
          />
        </div>
      )}

      {!titleMatchesSearch ? (
      <DocumentSearchPanel onMatchesChange={onMatchesChange} query={search} materials={filtered} materialFiltersActive={status !== "all" || !!topic || !!type} />
      ) : null}

      {hasAny ? (
        <div className="filter-chips" style={{ marginBottom: "var(--space-5)" }}>
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

      {!search.trim() ? topicPanels : null}

      {!hasAny ? (
        <Card>
          <EmptyState
            icon={<BookIcon size={30} />}
            title="Your training library is ready."
            body="Add your first study guide, lesson notes, or instructor handout. Give it a topic and a next action and it will find its way onto your Flight Deck."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Add material
              </Button>
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
            Showing {Math.min(visibleLimit, visible.length).toLocaleString()} of {visible.length.toLocaleString()} materials
          </p>
          <div className="material-grid">
            {shownMaterials.map((material) => (
              <MaterialCard
                key={material.id}
                material={material}
                nextActionTitle={nextActionTitles.get(material.id)}
                offline={offlineBadges.get(material.id)}
                review={tab === "library" ? reviewIndicator(binderStatus, material.id, materialsWithCards.has(material.id)) : null}
              />
            ))}
          </div>
          {visible.length > visibleLimit ? (
            <div className="library__more">
              <Button onClick={() => setPage({ key: filterKey, limit: visibleLimit + MATERIAL_PAGE_SIZE })}>
                Show 100 more materials
              </Button>
            </div>
          ) : null}
        </>
      )}

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

      <ExportCenterDialog
        open={exportingHandouts}
        sources={exportSources}
        onClose={() => setExportingHandouts(false)}
      />
    </>
  );
}

function MaterialCard({
  material,
  nextActionTitle,
  review,
  offline,
}: {
  material: StudyMaterial;
  nextActionTitle?: string;
  review?: string | null;
  offline?: OfflineBadge;
}) {
  const statusTone =
    material.reviewStatus === "confident"
      ? "complete"
      : material.reviewStatus === "studying"
        ? "study"
        : "neutral";

  return (
    <Link className="material-card" to={`/study/${material.id}`}>
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
