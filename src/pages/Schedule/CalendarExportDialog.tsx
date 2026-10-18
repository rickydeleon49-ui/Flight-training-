/**
 * Calendar export dialog (P54-05 part B): export a single lesson as an
 * iCalendar (.ics) file to save and import into external calendar applications.
 *
 * Explains plain-language limitations:
 * - One-time file export, not a calendar account sync.
 * - Floating local times without timezone conversion.
 * - Approved 1-hour duration for start-only events with rollover.
 * - Re-import duplication and client-specific cancellation behavior.
 * - Rescheduled lessons need their own replacement file.
 * - Preparation checklist option starts off and is dialog-only.
 * - Browser mode explains desktop limitation and does not save.
 *
 * Session lifecycle follows accepted BRIEF-R1/R2 patterns:
 * - Dialog state belongs to one session per open lesson.
 * - Reopening or switching lessons replaces state in the same render.
 * - Synchronous one-save lock covers duplicate clicks before re-render.
 * - Controls locked while pending; dialog nondismissible while saving.
 * - Late completions from older sessions cannot update or release locks.
 */
import { useRef, useState } from "react";

import { Button, Dialog } from "@/components/ui";
import { isTauri } from "@/data";
import type { ScheduleEvent } from "@/domain/types";
import { formatTime } from "@/lib/dates";
import {
  calendarFileName,
  CalendarExportError,
  exportCalendarEvent,
} from "@/logic/calendarExport";
import { DesktopOnlyError } from "@/services/documents";
import { saveStudyExport, StudyExportError } from "@/services/studyExport";
import { useAppData } from "@/state/AppDataContext";

interface Props {
  open: boolean;
  event: ScheduleEvent;
  onClose: () => void;
}

export const CALENDAR_DESKTOP_ONLY =
  "Saving a calendar file needs the desktop application. Browser mode cannot save calendar files.";

interface Session {
  owner: object;
  lessonId: string | null;
  includeChecklist: boolean;
  working: boolean;
  error: string | null;
  saved: string | null;
}

const freshSession = (lessonId: string | null): Session => ({
  owner: {},
  lessonId,
  includeChecklist: false,
  working: false,
  error: null,
  saved: null,
});

export function CalendarExportDialog({ open, event, onClose }: Props) {
  const { data } = useAppData();
  const desktop = isTauri();
  const lessonId = open ? event.id : null;
  const [stored, setStored] = useState(() => freshSession(lessonId));

  // A new lesson or a reopening replaces the session before anything renders.
  const session = stored.lessonId === lessonId ? stored : freshSession(lessonId);
  if (session !== stored) setStored(session);

  const { owner, includeChecklist, working, error, saved } = session;
  const busy = useRef<object | null>(null);

  const update = (of: object, change: (current: Session) => Partial<Session>) =>
    setStored((current) => (current.owner === of ? { ...current, ...change(current) } : current));

  const prepItems = data.prepItems
    .filter((item) => item.eventId === event.id)
    .sort((a, b) => a.position - b.position)
    .map((item) => item.title);

  const hasStartOnly = Boolean(event.startTime && !event.endTime);
  const isCancelled = event.status === "cancelled";
  const isRescheduled = event.status === "rescheduled";

  const toggleChecklist = (on: boolean) =>
    update(owner, () => ({ includeChecklist: on }));

  const save = async () => {
    if (!desktop) {
      update(owner, () => ({ error: CALENDAR_DESKTOP_ONLY }));
      return;
    }
    // Prevent duplicate dispatches delivered before React render commits.
    if (busy.current === owner) return;
    busy.current = owner;
    update(owner, () => ({ working: true, error: null, saved: null }));

    let outcome: Partial<Session> = {};
    try {
      const ics = exportCalendarEvent(event, {
        includeChecklist,
        prepItemTitles: prepItems,
      });
      const fileName = calendarFileName(event);
      const result = await saveStudyExport("calendar", fileName, ics);
      if (result) {
        outcome = { saved: `Saved “${result.fileName}”.` };
      }
    } catch (caught) {
      if (caught instanceof DesktopOnlyError) {
        outcome = { error: CALENDAR_DESKTOP_ONLY };
      } else if (caught instanceof StudyExportError) {
        outcome = { error: caught.message };
      } else if (caught instanceof CalendarExportError) {
        outcome = { error: caught.message };
      } else {
        outcome = { error: "The file could not be saved. Nothing was changed." };
      }
    } finally {
      if (busy.current === owner) busy.current = null;
      update(owner, () => ({ ...outcome, working: false }));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!working}
      title="Add to calendar"
      description={
        desktop
          ? "Save an iCalendar (.ics) file for this lesson to open or import in your calendar app."
          : "Saving a calendar file needs the desktop application."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={working}>
            {saved ? "Done" : "Cancel"}
          </Button>
          {desktop ? (
            <Button variant="primary" onClick={() => void save()} disabled={working}>
              {working ? "Saving…" : "Save calendar file…"}
            </Button>
          ) : (
            <Button variant="primary" disabled={true} title="Desktop application required">
              Save calendar file…
            </Button>
          )}
        </>
      }
    >
      <div className="stack stack--4">
        <div className="stack stack--2">
          <p className="small">
            This saves one calendar file; it does not connect to or synchronize a calendar account.
            The user imports or opens the file in their calendar application.
          </p>
          <p className="small muted">
            Re-import may duplicate rather than update an event.
            {isCancelled ? (
              " This lesson is cancelled (exported as cancelled). A cancelled file may not remove an existing calendar entry."
            ) : isRescheduled ? (
              " This lesson was rescheduled (exported as cancelled). A cancelled file may not remove an existing calendar entry. The replacement lesson needs its own file."
            ) : (
              " A cancelled file may not remove an existing calendar entry."
            )}
          </p>
          <p className="small muted">
            Times are floating local times: a calendar using another timezone may interpret the same clock time differently.
            {hasStartOnly ? (
              ` A start without an end receives the approved one-hour duration, including rollover into the next day.`
            ) : event.startTime && event.endTime ? (
              ` Scheduled from ${formatTime(event.startTime)} to ${formatTime(event.endTime)}.`
            ) : (
              " This is an all-day event."
            )}
          </p>
        </div>

        <fieldset className="lesson-brief__choices" disabled={working}>
          <legend className="field__label">Checklist option</legend>
          <label className="small lesson-brief__option">
            <input
              type="checkbox"
              checked={includeChecklist}
              onChange={(e) => toggleChecklist(e.target.checked)}
              disabled={working}
            />
            Include preparation checklist{" "}
            <span className="tiny dim">
              ({prepItems.length} {prepItems.length === 1 ? "item" : "items"})
            </span>
          </label>
          <p className="tiny dim">
            Checklist option starts off. Only item titles are included. Lesson notes, journal reflections, and other records are never exported.
          </p>
        </fieldset>

        {!desktop ? (
          <p className="field__error" role="alert">
            {CALENDAR_DESKTOP_ONLY}
          </p>
        ) : null}

        {saved ? (
          <p className="field__help" role="status" style={{ color: "var(--status-complete)" }}>
            {saved}
          </p>
        ) : null}

        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
