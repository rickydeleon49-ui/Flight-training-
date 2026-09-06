import { useMemo, useState } from "react";

import { PageHeader } from "@/components/layout/PageHeader";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  IconButton,
  NoteIcon,
  PinIcon,
  TextArea,
  TextInput,
  TrashIcon,
} from "@/components/ui";
import type { Note } from "@/domain/types";
import { formatLongDate, todayIso } from "@/lib/dates";
import { noteHeading, notePreview, searchNotes } from "@/logic/notes";
import { useAppData } from "@/state/AppDataContext";
import { useDraftRecovery } from "@/state/useDraftRecovery";
import { isText, useRememberedState } from "@/state/useRememberedState";

import "./notes.css";

interface NoteDraft {
  title: string;
  body: string;
}

const EMPTY_DRAFT: NoteDraft = { title: "", body: "" };

/** Notes carry a full timestamp; the day is the part worth reading. */
const dayOf = (timestamp: string): string => timestamp.slice(0, 10);

/**
 * Notes — the one screen that asks nothing before she writes.
 *
 * Every other place a thought can go wants to know what it belongs to first.
 * Here the whole page is a box and a list: type, save, find it later.
 */
export function Notes() {
  const { data, mutate, deleteWithUndo } = useAppData();
  const today = todayIso();

  const [draft, setDraft] = useState<NoteDraft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<Note | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<Note | null>(null);
  const [search, setSearch] = useRememberedState("notes.search", "", isText);

  // A note half-written when she closes the page is still worth keeping.
  const { recovered, forget } = useDraftRecovery("notes.new", draft, setDraft);

  const visible = useMemo(() => searchNotes(data.notes, search), [data.notes, search]);
  const pinnedCount = data.notes.filter((note) => note.pinned).length;

  const save = async () => {
    const body = draft.body.trim();
    if (!body) return;
    const result = await mutate((repos) =>
      repos.notes.create({ title: draft.title.trim(), body }),
    );
    if (result === null) return;
    setDraft(EMPTY_DRAFT);
    forget();
  };

  return (
    <>
      <PageHeader
        title="Notes"
        subtitle="Somewhere to write it down without deciding where it goes first."
      />

      {recovered ? (
        <div className="draft-note" role="status">
          <p className="small">
            Picked up where you left off — this is what you had typed but not saved.
          </p>
          <Button
            size="small"
            onClick={() => {
              forget();
              setDraft(EMPTY_DRAFT);
            }}
          >
            Start fresh
          </Button>
        </div>
      ) : null}

      <div className="stack stack--5">
        <Card>
          <CardHeader title="Write something down" />
          <CardBody>
            <div className="stack stack--3">
              <TextInput
                value={draft.title}
                aria-label="Title (optional)"
                placeholder="Title — optional"
                onChange={(e) => setDraft((current) => ({ ...current, title: e.target.value }))}
              />
              <TextArea
                rows={4}
                value={draft.body}
                aria-label="Note"
                placeholder="The school on the north field returns calls after four. Ask about their discovery flight."
                onChange={(e) => setDraft((current) => ({ ...current, body: e.target.value }))}
              />
              <div className="row row--between">
                <span className="tiny dim">Saved here only — nothing is sent anywhere.</span>
                <Button variant="primary" onClick={save} disabled={!draft.body.trim()}>
                  Save note
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Your notes"
            action={
              <span className="tiny dim">
                {pinnedCount > 0 ? `${pinnedCount} pinned · ` : ""}
                {data.notes.length} saved
              </span>
            }
          />
          <CardBody flush>
            {data.notes.length > 0 ? (
              <div style={{ padding: "0 var(--space-5) var(--space-4)" }}>
                <TextInput
                  type="search"
                  value={search}
                  aria-label="Search your notes"
                  placeholder="Search your notes"
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            ) : null}

            {visible.length === 0 ? (
              <EmptyState
                icon={<NoteIcon size={26} />}
                title={
                  data.notes.length === 0
                    ? "Nothing written down yet."
                    : "No note matches that."
                }
                body={
                  data.notes.length === 0
                    ? "A thought from a flight, a school worth calling, a word you want to look up — anything that does not belong to a lesson yet."
                    : undefined
                }
              />
            ) : (
              visible.map((note) =>
                editing?.id === note.id ? (
                  <NoteEditor
                    key={note.id}
                    note={note}
                    onClose={() => setEditing(null)}
                  />
                ) : (
                  <NoteRow
                    key={note.id}
                    note={note}
                    today={today}
                    onEdit={() => setEditing(note)}
                    onDelete={() => setConfirmingDelete(note)}
                  />
                ),
              )
            )}
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmingDelete !== null}
        title="Delete this note?"
        message={confirmingDelete ? noteHeading(confirmingDelete) : ""}
        onConfirm={() => {
          const note = confirmingDelete;
          setConfirmingDelete(null);
          if (note) {
            deleteWithUndo({
              ids: [note.id],
              label: noteHeading(note),
              run: (repos) => repos.notes.remove(note.id),
            });
          }
        }}
        onCancel={() => setConfirmingDelete(null)}
      />
    </>
  );
}

function NoteRow({
  note,
  today,
  onEdit,
  onDelete,
}: {
  note: Note;
  today: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { mutate } = useAppData();
  const heading = noteHeading(note);
  const preview = notePreview(note);
  const written = dayOf(note.createdAt);
  const changed = dayOf(note.updatedAt);

  return (
    <article className={`note-row${note.pinned ? " note-row--pinned" : ""}`}>
      <div className="note-row__main">
        <div className="note-row__heading">
          <h3 className="note-row__title wrap-anywhere">{heading}</h3>
          {note.pinned ? <Badge tone="berry">Pinned</Badge> : null}
        </div>
        {preview ? <p className="note-row__body wrap-anywhere">{preview}</p> : null}
        <p className="tiny dim">
          {changed === written
            ? formatLongDate(written, today)
            : `${formatLongDate(written, today)} · edited ${formatLongDate(changed, today)}`}
        </p>
      </div>

      <div className="note-row__tools">
        <IconButton
          label={note.pinned ? `Unpin note: ${heading}` : `Pin note: ${heading}`}
          onClick={() => mutate((repos) => repos.notes.update(note.id, { pinned: !note.pinned }))}
        >
          <PinIcon size={16} />
        </IconButton>
        <Button size="small" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
        <IconButton label={`Delete note: ${heading}`} tone="danger" onClick={onDelete}>
          <TrashIcon size={16} />
        </IconButton>
      </div>
    </article>
  );
}

function NoteEditor({ note, onClose }: { note: Note; onClose: () => void }) {
  const { mutate } = useAppData();
  const [draft, setDraft] = useState<NoteDraft>({ title: note.title, body: note.body });

  const save = async () => {
    const body = draft.body.trim();
    if (!body) return;
    const result = await mutate((repos) =>
      repos.notes.update(note.id, { title: draft.title.trim(), body }),
    );
    if (result === null) return;
    onClose();
  };

  return (
    <div className="note-row note-row--editing">
      <div className="stack stack--3" style={{ width: "100%" }}>
        <TextInput
          value={draft.title}
          aria-label="Title (optional)"
          placeholder="Title — optional"
          onChange={(e) => setDraft((current) => ({ ...current, title: e.target.value }))}
        />
        <TextArea
          rows={5}
          value={draft.body}
          aria-label="Note"
          onChange={(e) => setDraft((current) => ({ ...current, body: e.target.value }))}
        />
        <div className="row">
          <Button size="small" variant="primary" onClick={save} disabled={!draft.body.trim()}>
            Save changes
          </Button>
          <Button size="small" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
