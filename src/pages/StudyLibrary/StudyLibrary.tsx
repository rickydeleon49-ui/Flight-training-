import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import {
  Badge,
  BookIcon,
  Button,
  Card,
  DocumentIcon,
  EmptyState,
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
  type StudyMaterial,
  type Topic,
} from "@/domain/types";
import { newId } from "@/lib/id";
import { useAppData } from "@/state/AppDataContext";

import { MaterialFormDialog, type MaterialDraft } from "./MaterialFormDialog";
import "./studyLibrary.css";

type StatusFilter = ReviewStatus | "all" | "next_up";

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Everything" },
  { value: "next_up", label: "Next Up" },
  { value: "studying", label: "Studying" },
  { value: "needs_review", label: "Needs Review" },
  { value: "confident", label: "Confident" },
  { value: "reference_only", label: "Reference Only" },
];

export function StudyLibrary() {
  const { data, mutate } = useAppData();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [topic, setTopic] = useState<Topic | "">("");
  const [type, setType] = useState<MaterialType | "">("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  // Reserved up front so an imported file can be stored under the material's id.
  const [draftId, setDraftId] = useState(newId);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.materials.filter((material) => {
      if (status === "next_up" && material.priority !== "next_up") return false;
      if (status !== "all" && status !== "next_up" && material.reviewStatus !== status) return false;
      if (topic && material.topic !== topic) return false;
      if (type && material.materialType !== type) return false;
      if (query) {
        const haystack = [
          material.title,
          material.notes,
          TOPIC_LABELS[material.topic],
          MATERIAL_TYPE_LABELS[material.materialType],
          ...material.tags,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [data.materials, status, topic, type, search]);

  const save = async (draft: MaterialDraft) => {
    const created = await mutate((repos) => repos.documents.create(draft));
    if (created === null) return;
    setDraftId(newId());
    setCreating(false);
  };

  const nextActionFor = (materialId: string) =>
    data.actions.find(
      (action) =>
        action.status === "open" &&
        action.relatedType === "material" &&
        action.relatedId === materialId,
    );

  const hasAny = data.materials.length > 0;

  return (
    <>
      <PageHeader
        title="Study Library"
        subtitle="Your training binder — notes, handouts, worksheets and what to do with them."
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <PlusIcon size={16} /> Add material
          </Button>
        }
      />

      {hasAny ? (
        <div className="library__toolbar">
          <div className="search-field">
            <span className="search-field__icon">
              <SearchIcon size={16} />
            </span>
            <TextInput
              value={search}
              placeholder="Search titles, notes and tags"
              aria-label="Search your library"
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
        </div>
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
        <Card>
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
                }}
              >
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="material-grid">
          {visible.map((material) => (
            <MaterialCard
              key={material.id}
              material={material}
              nextActionTitle={nextActionFor(material.id)?.title}
            />
          ))}
        </div>
      )}

      <MaterialFormDialog
        open={creating}
        goals={data.goals}
        events={data.events}
        newMaterialId={draftId}
        onClose={() => setCreating(false)}
        onSave={save}
      />
    </>
  );
}

function MaterialCard({
  material,
  nextActionTitle,
}: {
  material: StudyMaterial;
  nextActionTitle?: string;
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
      </span>

      {nextActionTitle ? (
        <span className="material-card__next truncate">Next: {nextActionTitle}</span>
      ) : null}
    </Link>
  );
}
