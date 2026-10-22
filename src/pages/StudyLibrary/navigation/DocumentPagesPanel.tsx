/**
 * A material's pages (M4 Slice 1): open the PDF at a page, the last page she
 * asked to open, a separate "I've read this" mark, and bookmarks.
 *
 * - The default system reader opens the file. It may not jump to the page on
 *   its own, so the page is always shown as guidance (OD-2).
 * - A page outside the checked page count, or not a whole number, is refused
 *   with an explanation and never moved to a nearby page (OD-4, OD-6).
 * - Opening a page records only that it was asked for. Reading is a separate,
 *   explicit mark tied to that exact saved request (OD-9, M4S1-R1).
 * - Saved places made for an earlier version of the file say so (OD-8).
 * - If the page opened but could not be saved, "Try saving again" resends the
 *   save without opening the file a second time.
 * - A bookmark opens only on the content it was saved on (M4S1-R5). A new
 *   bookmark is bound to the content, page count and material shown when its
 *   dialog opened, and a later refresh never rebinds it (M4S1-R6).
 * - A check, read mark or removal reports back only to the repository and
 *   material it started on; one that finishes after they changed says
 *   nothing over the new ones (NAV-UI-01).
 */
import { type FormEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { Button, Card, CardBody, CardHeader, Checkbox, ConfirmDialog, Dialog, Field, TextArea, TextInput } from "@/components/ui";
import type { NavigationBookmark, StudyMaterial } from "@/domain/types";
import { NAVIGATION_LIMITS } from "@/data/navigationTransaction";
import { savedPlaceNote } from "@/logic/navigation";
import type { NavigationStatus } from "@/state/navigation/controller";
import { navigationMessage, useMaterialNavigation, useNavigationController } from "@/state/navigation/useDocumentNavigation";

/** What an open bookmark dialog was started on; fixed for that draft. */
interface BookmarkDraft {
  materialId: string;
  contentSha256: string;
  totalPages: number;
  suggestedPage: number | null;
}

export const DRAFT_STALE_MESSAGE =
  "This file changed while you were adding this bookmark, so it can't be saved for the new version. Cancel, check the pages, and add it again.";

interface DocumentPagesPanelProps {
  material: StudyMaterial;
  fileMissing: boolean;
  restoring: boolean;
  onRestore: () => void;
}

const WORKING: Record<string, string> = {
  checking: "Checking the file…",
  opening: "Opening in your PDF reader…",
  saving: "Saving this page…",
};

export function pageWords(page: number, label: string | null): string {
  return label ? `PDF page ${page} (printed page ${label})` : `PDF page ${page}`;
}

/** What to say about the current request for this material. */
function statusText(status: NavigationStatus): { text: string; error: boolean } | null {
  switch (status.kind) {
    case "working":
      return { text: WORKING[status.step] ?? "Working…", error: false };
    case "saved":
      return {
        text: `Opened in your PDF reader. Go to ${pageWords(status.destination.physicalPage, status.destination.pageLabel)} there; your reader may not jump to it by itself.`,
        error: false,
      };
    case "opened_unsaved":
      return { text: `${status.message} Go to ${pageWords(status.destination.physicalPage, status.destination.pageLabel)} in your reader.`, error: true };
    case "guidance":
      return { text: status.message, error: false };
    case "refused":
    case "failed":
      return { text: status.message, error: true };
    default:
      return null;
  }
}

export function DocumentPagesPanel({ material, fileMissing, restoring, onRestore }: DocumentPagesPanelProps) {
  const { repo, controller, status } = useNavigationController();
  const nav = useMaterialNavigation(material.id, repo, status);
  const [page, setPage] = useState("");
  const [pageError, setPageError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const [draft, setDraft] = useState<BookmarkDraft | null>(null);
  const [removing, setRemoving] = useState<NavigationBookmark | null>(null);
  const [removePending, setRemovePending] = useState(false);
  const [readPending, setReadPending] = useState(false);
  const headingId = useId();
  const notices = useRef<object | null>(null);

  // Leaving the material retires its pending request: nothing more is opened,
  // saved or shown for it. A save that already landed stays saved.
  useEffect(() => {
    if (!controller) return undefined;
    return () => {
      const current = controller.status();
      if ("materialId" in current && current.materialId === material.id && current.kind === "working") controller.abort();
    };
  }, [controller, material.id]);

  // Notices belong to one repository, controller and material. A change
  // retires them, and a completion that started under the old ones is
  // refused before it can publish (NAV-UI-01). Taken during the commit, like
  // the navigation lease, so a click on freshly shown controls is never
  // treated as belonging to no one.
  useLayoutEffect(() => {
    const owner = {};
    notices.current = owner;
    return () => {
      if (notices.current === owner) notices.current = null;
      setCheckNote(null);
      setActionError(null);
    };
  }, [repo, controller, material.id]);

  /** Whether a notice from an action started now may still be shown when it finishes. */
  const noticeOwner = () => {
    const owner = notices.current;
    return () => owner !== null && notices.current === owner;
  };

  // A draft belongs to the material it was started on.
  useEffect(() => {
    setDraft((current) => (current && current.materialId !== material.id ? null : current));
  }, [material.id]);

  if (!repo?.supported() || !controller) return null;
  const desktop = repo.canCheckFiles();
  const identity = nav.state?.identity ?? null;
  const reading = nav.state?.readingState ?? null;
  const bookmarks = nav.state?.bookmarks ?? [];
  const mine = "materialId" in status && status.materialId === material.id ? status : null;
  const busy = mine?.kind === "working";
  const said = mine ? statusText(mine) : null;
  const missing = fileMissing || (mine?.kind === "failed" && mine.code === "FILE_MISSING");

  const openAt = async (reference: string | number) => {
    setActionError(null);
    await controller.request({ materialId: material.id, reference, provenance: "physical_index" });
  };

  const openBookmark = async (bookmark: NavigationBookmark) => {
    setActionError(null);
    await controller.openSaved({
      materialId: material.id,
      contentSha256: bookmark.originatingContentSha256,
      physicalPage: bookmark.physicalPage,
      pageLabel: bookmark.pageLabel,
    });
  };

  const startBookmark = () => {
    if (!identity) return;
    setDraft({
      materialId: material.id,
      contentSha256: identity.contentSha256,
      totalPages: identity.totalPages,
      suggestedPage: reading?.status === "active" && reading.originatingContentSha256 === identity.contentSha256 ? reading.lastRequestedPage : null,
    });
  };

  const submitPage = async (event: FormEvent) => {
    event.preventDefault();
    const text = page.trim();
    if (!/^\d+$/.test(text)) {
      setPageError("Enter a whole page number, like 12.");
      return;
    }
    setPageError(null);
    await openAt(text);
  };

  const checkPages = async () => {
    const current = noticeOwner();
    setActionError(null);
    setCheckNote(null);
    try {
      const changed = await nav.checkPages();
      if (current()) setCheckNote(changed ? "This file changed since it was last checked. Places saved for the earlier version are marked." : null);
    } catch (error) {
      if (current()) setActionError(navigationMessage(error));
    }
  };

  const toggleRead = async (confirmed: boolean) => {
    if (!reading) return;
    const current = noticeOwner();
    setActionError(null);
    setReadPending(true);
    try {
      await nav.setRead(reading, confirmed);
    } catch (error) {
      if (current()) setActionError(navigationMessage(error));
    } finally {
      setReadPending(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    const current = noticeOwner();
    setRemovePending(true);
    try {
      await nav.deleteBookmark(removing.id);
      setRemoving(null);
    } catch (error) {
      if (current()) setActionError(navigationMessage(error));
      setRemoving(null);
    } finally {
      setRemovePending(false);
    }
  };

  return (
    <Card>
      <CardHeader eyebrow="Pages" title="Find your place" />
      <CardBody>
        <section className="stack stack--3" aria-labelledby={headingId}>
          <h4 id={headingId} className="visually-hidden">
            Pages of {material.title}
          </h4>
          {!desktop ? (
            <p className="tiny muted">Opening a file at a page needs the desktop app. Your bookmarks are still listed here.</p>
          ) : (
            <>
              <div className="row row--between row--wrap">
                <p className="tiny muted">
                  {identity
                    ? `This PDF has ${identity.totalPages} ${identity.totalPages === 1 ? "page" : "pages"}.`
                    : "This file's pages haven't been checked yet. They are checked when you open a page."}
                </p>
                <Button size="small" onClick={() => void checkPages()} disabled={busy || missing}>
                  Check pages
                </Button>
              </div>
              <p className="tiny muted">Check pages counts this PDF's pages and checks whether the file has changed.</p>
              {checkNote ? (
                <p className="tiny" role="status">
                  {checkNote}
                </p>
              ) : null}

              <form className="row row--wrap" onSubmit={(event) => void submitPage(event)} noValidate>
                <Field
                  label="PDF page"
                  hint={identity ? `The page number your PDF reader shows, from 1 to ${identity.totalPages}.` : "The page number your PDF reader shows."}
                  error={pageError}
                >
                  <TextInput inputMode="numeric" value={page} onChange={(event) => setPage(event.target.value)} disabled={busy || missing} />
                </Field>
                <Button type="submit" variant="primary" disabled={busy || missing}>
                  Open at page
                </Button>
              </form>
              <p className="tiny muted">Open at page opens your PDF reader and remembers the page you asked for. You may need to go to that page in the reader.</p>
            </>
          )}

          {said ? (
            <div className="stack stack--2" role="status" aria-live="polite">
              <p className={said.error ? "field__error" : "small"}>{said.text}</p>
              {mine?.kind === "opened_unsaved" && mine.canRetry ? (
                <div>
                  <Button size="small" onClick={() => void controller.retrySave()}>
                    Try saving again
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {missing ? (
            <div className="row row--between row--wrap">
              <p className="tiny muted">The file for this material isn&apos;t in your library storage, so no page can be opened. Your saved places are kept.</p>
              <Button size="small" variant="primary" disabled={restoring} onClick={onRestore}>
                {restoring ? "Restoring…" : "Find and restore file"}
              </Button>
            </div>
          ) : null}

          {actionError || nav.error ? (
            <p className="field__error" role="alert">
              {actionError ?? nav.error}
            </p>
          ) : null}

          {reading ? (
            <div className="stack stack--2">
              <p className="small">
                Last page you asked to open: <strong>{pageWords(reading.lastRequestedPage, reading.lastRequestedPageLabel)}</strong>
              </p>
              {savedPlaceNote(reading.status) ? <p className="tiny muted">{savedPlaceNote(reading.status)}</p> : null}
              {reading.status === "active" && desktop ? (
                <Checkbox
                  checked={reading.confirmedRead}
                  disabled={readPending}
                  onChange={(checked) => void toggleRead(checked)}
                  label="I've read this page"
                  meta="Opening a page doesn't mark it read. Tick this only when you have."
                />
              ) : null}
            </div>
          ) : null}

          <div className="stack stack--2">
            <div className="row row--between row--wrap">
              <h4 className="small strong">Bookmarks</h4>
              {desktop ? (
                <Button size="small" onClick={startBookmark} disabled={!identity || missing}>
                  Add bookmark
                </Button>
              ) : null}
            </div>
            <p className="tiny muted">Save a named place so you can return to it later without remembering the page number.</p>
            {desktop && !identity ? <p className="tiny muted">Check this file&apos;s pages before adding a bookmark.</p> : null}
            {bookmarks.length === 0 ? (
              <p className="tiny muted">No bookmarks yet.</p>
            ) : (
              <ul className="stack stack--2" aria-label="Bookmarks">
                {bookmarks.map((bookmark) => (
                  <li key={bookmark.id} className="row row--between row--wrap">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p className="small strong">{bookmark.title}</p>
                      <p className="tiny muted">
                        {pageWords(bookmark.physicalPage, bookmark.pageLabel)}
                        {savedPlaceNote(bookmark.status) ? ` · ${savedPlaceNote(bookmark.status)}` : ""}
                      </p>
                      {bookmark.notes ? <p className="tiny">{bookmark.notes}</p> : null}
                    </div>
                    <div className="row">
                      {desktop && bookmark.status === "verified" ? (
                        <Button
                          size="small"
                          disabled={busy || missing}
                          onClick={() => void openBookmark(bookmark)}
                          aria-label={`Open ${bookmark.title} at ${pageWords(bookmark.physicalPage, bookmark.pageLabel)}`}
                        >
                          Open
                        </Button>
                      ) : null}
                      <Button size="small" variant="secondary" onClick={() => setRemoving(bookmark)} aria-label={`Remove bookmark ${bookmark.title}`}>
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {draft && draft.materialId === material.id ? (
          <AddBookmarkDialog
            contentSha256={draft.contentSha256}
            totalPages={draft.totalPages}
            suggestedPage={draft.suggestedPage}
            changed={identity !== null && identity.contentSha256 !== draft.contentSha256}
            onClose={() => setDraft(null)}
            onSave={async (input) => {
              // Bound to the draft's own content; the transaction refuses it
              // as stale if the file is no longer that content.
              await nav.addBookmark({ ...input, contentSha256: draft.contentSha256 });
              setDraft(null);
            }}
          />
        ) : null}
        <ConfirmDialog
          open={removing !== null}
          title="Remove this bookmark?"
          message={removing ? `"${removing.title}" will be removed. The file itself is not changed.` : ""}
          confirmLabel="Remove"
          pending={removePending}
          pendingLabel="Removing…"
          onConfirm={() => void remove()}
          onCancel={() => setRemoving(null)}
        />
      </CardBody>
    </Card>
  );
}

interface AddBookmarkDialogProps {
  /** The content she was looking at when she chose to add it. */
  contentSha256: string;
  totalPages: number;
  suggestedPage: number | null;
  /** The file shown now is no longer the content this draft was started on. */
  changed?: boolean;
  onClose: () => void;
  onSave: (input: { physicalPage: number; pageLabel: string | null; title: string; notes: string }) => Promise<void>;
}

export function AddBookmarkDialog({ totalPages, suggestedPage, changed = false, onClose, onSave }: AddBookmarkDialogProps) {
  const [page, setPage] = useState(suggestedPage ? String(suggestedPage) : "");
  const [label, setLabel] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<{ page?: string; label?: string; title?: string; notes?: string; save?: string }>({});
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const next: typeof errors = {};
    const pageText = page.trim();
    const n = Number(pageText);
    if (!/^\d+$/.test(pageText) || !Number.isSafeInteger(n) || n < 1) next.page = "Enter a whole page number, like 12.";
    else if (n > totalPages) next.page = `This PDF has ${totalPages} pages, so there is no page ${n}.`;
    const labelText = label.trim();
    if ([...labelText].length > NAVIGATION_LIMITS.labelChars) next.label = `Keep the printed page to ${NAVIGATION_LIMITS.labelChars} characters.`;
    const titleText = title.trim();
    if (!titleText) next.title = "Give the bookmark a short name.";
    else if ([...titleText].length > NAVIGATION_LIMITS.titleChars) next.title = `Keep the name to ${NAVIGATION_LIMITS.titleChars} characters.`;
    const notesText = notes.trim();
    if ([...notesText].length > NAVIGATION_LIMITS.notesChars) next.notes = "These notes are too long to save.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    try {
      await onSave({ physicalPage: n, pageLabel: labelText || null, title: titleText, notes: notesText });
    } catch (error) {
      setErrors({ save: navigationMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a bookmark"
      description="Bookmarks use the PDF's own page numbers, the ones your reader shows."
      dismissible={!saving}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving}>
            {saving ? "Saving…" : "Save bookmark"}
          </Button>
        </>
      }
    >
      <div className="stack stack--3">
        {changed && !errors.save ? (
          <p className="field__error" role="alert">
            {DRAFT_STALE_MESSAGE}
          </p>
        ) : null}
        <Field label="PDF page" hint={`From 1 to ${totalPages}.`} error={errors.page}>
          <TextInput inputMode="numeric" value={page} onChange={(event) => setPage(event.target.value)} />
        </Field>
        <Field label="Printed page (optional)" hint="The number printed on the page, like iv or 3-12, if it differs." error={errors.label}>
          <TextInput value={label} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <Field label="Name" error={errors.title}>
          <TextInput value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="Notes (optional)" error={errors.notes}>
          <TextArea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </Field>
        {errors.save ? (
          <p className="field__error" role="alert">
            {errors.save}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
