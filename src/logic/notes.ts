/**
 * Reading a free-form note back.
 *
 * A note is written without deciding anything first, so the title is often
 * blank and the text is often one line. These turn whatever she typed into
 * something a list, a search result, and an undo bar can all show.
 */
import type { Note } from "@/domain/types";

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
