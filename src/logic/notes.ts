/**
 * Reading a free-form note back.
 *
 * A note is written without deciding anything first, so the title is often
 * blank and the text is often one line. These turn whatever she typed into
 * something a list, a search result, and an undo bar can all show.
 */
import type { IsoDate, Note } from "@/domain/types";
import { formatLongDate, localDayOf } from "@/lib/dates";

/** Shown when a note has no title and no text worth quoting. */
export const UNTITLED_NOTE = "Untitled note";

const firstLine = (body: string): string =>
  body.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";

/**
 * What to call this note in a list.
 *
 * Her title if she wrote one, otherwise the first line she typed, which is
 * how a note usually starts anyway.
 */
export function noteHeading(note: Note): string {
  return note.title.trim() || firstLine(note.body) || UNTITLED_NOTE;
}

/**
 * The rest of the note, once the heading has already been shown.
 *
 * Returns an empty string when the heading was the whole note, so a
 * one-line note is not printed twice.
 */
export function notePreview(note: Note): string {
  const body = note.body.trim();
  if (note.title.trim()) return body;
  const heading = firstLine(note.body);
  const rest = body.slice(body.indexOf(heading) + heading.length).trim();
  return rest;
}

/**
 * Notes matching `query`, in the order they were given.
 *
 * Title and text both match, because she will look for a note by whatever
 * she happens to remember of it.
 */
export function searchNotes(notes: Note[], query: string): Note[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return notes;
  return notes.filter(
    (note) =>
      note.title.toLowerCase().includes(trimmed) ||
      note.body.toLowerCase().includes(trimmed),
  );
}

/**
 * The date line under a note, e.g. "Saturday, October 3 · edited Sunday, October 4".
 *
 * Notes store UTC timestamps, so both are read as the local day they fell on:
 * a note written at 9 PM in California belongs to that evening, not to the
 * next day in UTC. The "edited" part appears only when the local days differ.
 * A timestamp that can't be read is left out rather than shown as a broken
 * date; null means there is nothing to show.
 */
export function noteDateLine(note: Note, today: IsoDate): string | null {
  const written = localDayOf(note.createdAt);
  const changed = localDayOf(note.updatedAt);
  if (!written) return changed ? `Edited ${formatLongDate(changed, today)}` : null;
  if (!changed || changed === written) return formatLongDate(written, today);
  return `${formatLongDate(written, today)} · edited ${formatLongDate(changed, today)}`;
}
