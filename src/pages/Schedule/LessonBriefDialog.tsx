/**
 * The lesson brief (P54-05 part A): preview one printable page for a lesson,
 * tick any follow-ups to add, then save it (desktop) or print it (browser).
 *
 * The preview is the exact page that is saved or printed: both come from the
 * same text, built once per choice from what she sees. Follow-up choices last
 * only while the dialog is open and always start unticked.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { Button, Dialog } from "@/components/ui";
import { isTauri } from "@/data";
import type { ScheduleEvent } from "@/domain/types";
import { briefFileName, buildBriefHtml, lessonBrief } from "@/logic/lessonBrief";
import { DesktopOnlyError } from "@/services/documents";
import { saveStudyExport, StudyExportError } from "@/services/studyExport";
import { useAppData } from "@/state/AppDataContext";

interface Props {
  open: boolean;
  event: ScheduleEvent;
  onClose: () => void;
}

export const BRIEF_DESKTOP_ONLY = "Saving a file needs the desktop application. Use Print… here instead.";

export function LessonBriefDialog({ open, event, onClose }: Props) {
  const { data } = useAppData();
  const desktop = isTauri();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const [createdAt, setCreatedAt] = useState(() => new Date());
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const preview = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!open) return;
    setChosen(new Set());
    setCreatedAt(new Date());
    setError(null);
    setSaved(null);
  }, [open]);

  const brief = useMemo(() => lessonBrief(event, data), [event, data]);
  const html = useMemo(() => buildBriefHtml(brief, chosen, createdAt), [brief, chosen, createdAt]);

  const toggle = (id: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const save = async () => {
    // State disables the controls on render; this lock also covers two clicks
    // delivered before that render commits. One intent opens one dialog.
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    setSaved(null);
    try {
      // The page shown in the preview is the page that is saved.
      const result = await saveStudyExport("brief", briefFileName(event), html);
      if (result) setSaved(`Saved “${result.fileName}”.`);
    } catch (caught) {
      if (caught instanceof DesktopOnlyError) setError(BRIEF_DESKTOP_ONLY);
      else if (caught instanceof StudyExportError) setError(caught.message);
      else setError("The file could not be saved. Nothing was changed.");
    } finally {
      busy.current = false;
      setWorking(false);
    }
  };

  const print = () => preview.current?.contentWindow?.print();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!working}
      title="Lesson brief"
      description={
        desktop
          ? "A printable page for this lesson. Save it, then open it in a browser to print or save as PDF."
          : "A printable page for this lesson. Print it from here; saving a file needs the desktop app."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={working}>
            {saved ? "Done" : "Cancel"}
          </Button>
          {desktop ? (
            <Button variant="primary" onClick={() => void save()} disabled={working}>
              {working ? "Saving…" : "Save…"}
            </Button>
          ) : (
            <Button variant="primary" onClick={print}>
              Print…
            </Button>
          )}
        </>
      }
    >
      <div className="stack stack--4">
        {brief.followUps.length ? (
          <fieldset className="lesson-brief__choices" disabled={working}>
            <legend className="field__label">Add follow-ups</legend>
            <p className="tiny dim">Only what you tick is added. Your journal reflections and lesson notes are never included.</p>
            {brief.followUps.map((candidate) => (
              <label key={candidate.id} className="small lesson-brief__option">
                <input type="checkbox" checked={chosen.has(candidate.id)} onChange={(change) => toggle(candidate.id, change.target.checked)} /> {candidate.text}{" "}
                <span className="tiny dim">· {candidate.from}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="tiny dim">No follow-ups to add: your last journal entry has no questions for next time, and no open questions belong to this goal.</p>
        )}

        <iframe
          ref={preview}
          className="lesson-brief__preview"
          title="Lesson brief preview"
          // Same-origin only so Print can reach it; the page itself can run nothing.
          sandbox="allow-same-origin allow-modals"
          srcDoc={html}
        />

        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="small" role="status">
            {saved}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
