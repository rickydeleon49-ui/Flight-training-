import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useSearchFocus } from "@/state/useSearchFocus";

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
import { todayIso } from "@/lib/dates";
import { noteDateLine, noteHeading, notePreview, searchNotes } from "@/logic/notes";
import { useAppData } from "@/state/AppDataContext";
import { useDraftRecovery } from "@/state/useDraftRecovery";
import { isText, useRememberedState } from "@/state/useRememberedState";

import "./notes.css";

interface NoteDraft {
  title: string;
  body: string;
}

const EMPTY_DRAFT: NoteDraft = { title: "", body: "" };

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
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  // "Saved." beside the button until she starts the next note.
  const [justSaved, setJustSaved] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<Note | null>(null);
  const [search, setSearch] = useRememberedState("notes.search", "", isText);

  // A note half-written when she closes the page is still worth keeping.
  const [recoveredContent, setRecoveredContent] = useState(false);
  const { recovered, forget, revision, forgetRevision } = useDraftRecovery(
    "notes.new",
    draft,
    (saved: NoteDraft) => {
      if (!saved.title.trim() && !saved.body.trim()) return;
      setRecoveredContent(true);
      setDraft(saved);
    },
    true,
    // She came back while this note was saving and has not typed: it is
    // saved now, so the box empties as after her own Save.
    () => {
      setRecoveredContent(false);
      setDraft(EMPTY_DRAFT);
      setJustSaved(true);
    },
  );
  const mounted = useMounted();

  // "Write a note" from oral practice hands over text she can edit. It is
  // added under anything she had half-written, and saved only on Save note.
  const location = useLocation();
  const navigate = useNavigate();
  // One hand-over per navigation, even when effects run twice.
  const handedKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    const handed = (location.state as { noteDraft?: { title?: unknown; body?: unknown } } | null)?.noteDraft;
    if (!handed || typeof handed.body !== "string" || handedKey.current === location.key) return;
    handedKey.current = location.key;
    const handedTitle = typeof handed.title === "string" ? handed.title : "";
    const handedBody = handed.body;
    setDraft((current) => ({
      title: current.title || handedTitle,
      body: current.body.trim() ? `${current.body}\n\n${handedBody}` : handedBody,
    }));
    navigate(location.pathname, { replace: true, state: null });
  }, [location, navigate]);

  const visible = useMemo(
    () => searchNotes(data.notes, search),
    [data.notes, search],
  );
  const pinnedCount = data.notes.filter((note) => note.pinned).length;

  // A link from offline search opens one note, even if the list's own
  // search would hide it.
  const { focusId, missing } = useSearchFocus(
    "note",
    (id) => data.notes.some((note) => note.id === id),
    (id) => {
      if (!visible.some((note) => note.id === id)) setSearch("");
    },
    visible,
  );

  const save = async () => {
    if (saving.current) return;
    const body = draft.body.trim();
    if (!body) return;
    saving.current = true;
    setBusy(true);
    const submitted = revision();
    const result = await mutate((repos) =>
      repos.notes.create({ title: draft.title.trim(), body }),
    );
    saving.current = false;
    setBusy(false);
    if (result === null) return;
    // Only the stored copy this save submitted is dropped. If she left and
    // came back while it ran, the page she is on now owns any newer typing.
    forgetRevision(submitted);
    if (!mounted.current || latestDraft.current !== draft) return;
    setDraft(EMPTY_DRAFT);
    setJustSaved(true);
  };

  return (
    <div className="notes-page">
      <PageHeader
        title="Notes"
        subtitle="Somewhere to write it down without deciding where it goes first."
      />

      {recovered && recoveredContent ? (
        <div className="draft-note" role="status">
          <p className="small">
            Picked up where you left off — this is what you had typed but not
            saved.
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
                onChange={(e) => {
                  setJustSaved(false);
                  setDraft((current) => ({ ...current, title: e.target.value }));
                }}
              />
              <TextArea
                rows={Math.min(12, Math.max(4, draft.body.split("\n").length))}
                value={draft.body}
                aria-label="Note"
                placeholder="The school on the north field returns calls after four. Ask about their discovery flight."
                onChange={(e) => {
                  setJustSaved(false);
                  setDraft((current) => ({ ...current, body: e.target.value }));
                }}
              />
              <div className="row row--between">
                <span className="tiny dim">
                  Saved here only — nothing is sent anywhere.
                </span>
                <span className="row">
                  {justSaved ? <span className="small" role="status">Saved.</span> : null}
                  <Button
                    variant="primary"
                    onClick={save}
                    disabled={busy || !draft.body.trim()}
                  >
                    Save note
                  </Button>
                </span>
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

            {missing ? (
              <p className="small muted" role="status">
                That item isn't here any more.
              </p>
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
                    focused={note.id === focusId}
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
    </div>
  );
}

function NoteRow({
  note,
  focused = false,
  today,
  onEdit,
  onDelete,
}: {
  note: Note;
  /** Opened from an offline-search link. */
  focused?: boolean;
  today: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { mutate } = useAppData();
  const heading = noteHeading(note);
  const preview = notePreview(note);
  const dateLine = noteDateLine(note, today);

  return (
    <article
      id={`note-${note.id}`}
      className={`note-row${note.pinned ? " note-row--pinned" : ""}${focused ? " search-target" : ""}`}
    >
      <div className="note-row__main">
        <div className="note-row__heading">
          <h3 className="note-row__title wrap-anywhere">{heading}</h3>
          {note.pinned ? <Badge tone="berry">Pinned</Badge> : null}
        </div>
        {preview ? (
          <p className="note-row__body wrap-anywhere">{preview}</p>
        ) : null}
        {dateLine ? <p className="tiny dim">{dateLine}</p> : null}
      </div>

      <div className="note-row__tools">
        <IconButton
          label={
            note.pinned ? `Unpin note: ${heading}` : `Pin note: ${heading}`
          }
          onClick={() =>
            mutate((repos) =>
              repos.notes.update(note.id, { pinned: !note.pinned }),
            )
          }
        >
          <PinIcon size={16} />
        </IconButton>
        <Button size="small" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
        <Button
          size="small" variant="ghost"
          className="destructive-action" aria-label={`Delete note: ${heading}`} title="Delete note"
          onClick={onDelete}
        >
          <TrashIcon size={16} /> Delete
        </Button>
      </div>
    </article>
  );
}

interface EditDraft extends NoteDraft {
  /**
   * The saved note this draft started from. A draft from an earlier session
   * is only applied when the note has not changed since (for example by a
   * restore); otherwise she chooses. Drafts kept before this had none.
   */
  baseline?: NoteDraft | null;
}

const sameNote = (a: NoteDraft | null | undefined, b: NoteDraft) =>
  a != null && a.title === b.title && a.body === b.body;

/** True while the component is mounted; a save finishing later can check it. */
function useMounted() {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

function NoteEditor({ note, onClose }: { note: Note; onClose: () => void }) {
  const { mutate } = useAppData();
  const saved: NoteDraft = { title: note.title, body: note.body };
  const [draft, setDraft] = useState<EditDraft>({ ...saved, baseline: saved });
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  // What a running save sends; the note refreshing to it is not a conflict.
  const [submitted, setSubmitted] = useState<NoteDraft | null>(null);
  const mounted = useMounted();
  const { forget, revision, forgetRevision } = useDraftRecovery<EditDraft>(
    `notes.${note.id}`,
    draft,
    (stored) => {
      if (typeof stored?.title !== "string" || typeof stored.body !== "string") return;
      // Nothing to choose between: the draft already matches the saved note.
      if (sameNote(stored, saved)) return;
      setDraft({ title: stored.title, body: stored.body, baseline: stored.baseline ?? null });
    },
    true,
    // The earlier editor's save finished exactly this text: it is saved.
    () => {
      if (!saving.current) onClose();
    },
  );

  // The saved note changed since this draft began (a restore, or an older
  // draft): nothing is written until she picks one.
  const conflict = !sameNote(draft.baseline, saved) && !sameNote(submitted, saved);

  const keepDraft = () =>
    setDraft((current) => ({ ...current, baseline: { title: note.title, body: note.body } }));
  const useSaved = () => {
    forget();
    setDraft({ title: note.title, body: note.body, baseline: { title: note.title, body: note.body } });
  };

  const save = async () => {
    if (saving.current || conflict) return;
    const body = draft.body.trim();
    if (!body) return;
    const base = draft.baseline!;
    const next: NoteDraft = { title: draft.title.trim(), body };
    // Only what she changed is written, so an unchanged body is never sent.
    const changes: Partial<NoteDraft> = {};
    if (next.title !== base.title) changes.title = next.title;
    if (next.body !== base.body) changes.body = next.body;
    const stored = revision();
    if (Object.keys(changes).length === 0) {
      forgetRevision(stored);
      onClose();
      return;
    }
    saving.current = true;
    setBusy(true);
    setSubmitted(next);
    let result: unknown = null;
    try {
      result = await mutate((repos) => repos.notes.update(note.id, changes));
    } finally {
      saving.current = false;
      setBusy(false);
      setSubmitted(null);
    }
    if (result === null) return;
    forgetRevision(stored);
    // An editor closed while saving must not close one opened since.
    if (!mounted.current) return;
    if (latestDraft.current !== draft) {
      // She kept typing: this save is now what that typing builds on.
      setDraft((current) => ({ ...current, baseline: next }));
      return;
    }
    onClose();
  };

  return (
    <div className="note-row note-row--editing">
      <div className="stack stack--3" style={{ width: "100%" }}>
        {conflict ? (
          <div role="status">
            <p>You have unsaved notes from earlier.</p>
            <Button size="small" onClick={keepDraft}>Keep these</Button>{" "}
            <Button size="small" onClick={useSaved}>Use the saved notes</Button>
            <details>
              <summary>Saved notes</summary>
              {note.title ? <p><strong>{note.title}</strong></p> : null}
              <p style={{ whiteSpace: "pre-wrap" }}>{note.body}</p>
            </details>
          </div>
        ) : null}
        <TextInput
          value={draft.title}
          readOnly={conflict}
          aria-label="Title (optional)"
          placeholder="Title — optional"
          onChange={(e) =>
            setDraft((current) => ({ ...current, title: e.target.value }))
          }
        />
        <TextArea
          rows={5}
          value={draft.body}
          readOnly={conflict}
          aria-label="Note"
          onChange={(e) =>
            setDraft((current) => ({ ...current, body: e.target.value }))
          }
        />
        <div className="row">
          <Button
            size="small"
            variant="primary"
            onClick={save}
            disabled={busy || conflict || !draft.body.trim()}
          >
            Save changes
          </Button>
          <Button
            size="small"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              forget();
              onClose();
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
