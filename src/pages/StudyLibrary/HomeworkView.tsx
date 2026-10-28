import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertIcon, Button, Card, CardBody, ConfirmDialog } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import type { HomeworkOperation, HomeworkSnapshot } from "@/domain/homework";
import { cardVersion } from "@/logic/cardIdentity";
import { formatDateTime, formatShortDate, todayIso } from "@/lib/dates";
import { useAppData } from "@/state/AppDataContext";
import { useNavigationController } from "@/state/navigation/useDocumentNavigation";
import { HomeworkCardRun } from "./HomeworkCardRun";
import { HomeworkEditor } from "./HomeworkEditor";
import { ACTIVITY_KINDS, activeHomework, homeworkOperation, homeworkSaveMessage, newHomework, type Entry, homeworkHistoryLabel, activityStateLabel, type HomeworkHistoryEntry } from "./homeworkUi";
import { homeworkOfflineSummary } from "@/logic/homeworkOffline";
import "./homework.css";
type Editor = {
    snapshot: HomeworkSnapshot;
    creating?: boolean;
    activityId?: string;
    relink?: boolean;
    adding?: boolean;
};
const filters = { upcoming: "Upcoming", in_progress: "In progress", completed: "Completed", archived: "Archived" } as const;

function matchesHomeworkFilter(s: HomeworkSnapshot, currentFilter: keyof typeof filters, today: string): boolean {
  if (currentFilter === "archived") return Boolean(s.assignment.archived);
  if (s.assignment.archived) return false;
  if (currentFilter === "in_progress") return ["in_progress", "reopened"].includes(s.assignment.state);
  if (currentFilter === "completed") return s.assignment.state === "completed";
  return (
    s.assignment.state === "upcoming" ||
    (["in_progress", "reopened"].includes(s.assignment.state) &&
      Boolean(s.assignment.due_date && s.assignment.due_date < today))
  );
}

export function HomeworkView() {
    const { assignmentId } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { repositories, data, dataRevision, refresh } = useAppData();
    const { controller, status } = useNavigationController();
    const [snapshots, setSnapshots] = useState<HomeworkSnapshot[]>([]);
    const [current, setCurrent] = useState<HomeworkSnapshot | null>(null);
    const [history, setHistory] = useState<HomeworkHistoryEntry[]>([]);
    const [activityDrafts, setActivityDrafts] = useState<Record<string, string>>({});
    const [sourceStates, setSourceStates] = useState<Record<string, "changed" | "missing" | "unavailable">>({});
    const [checkedSources,setCheckedSources] = useState<HomeworkSnapshot | null>(null);
    const [announcement, setAnnouncement] = useState("");
    const focusActivity = useRef<string | null>(null);
    const cardFocusIntent = useRef<{ activityId: string; headingId: string; assignmentId: string } | null>(null);
    useEffect(() => {
        cardFocusIntent.current = null;
    }, [assignmentId]);
    const [filter, setFilter] = useState<keyof typeof filters>("upcoming");
    const [editor, setEditor] = useState<Editor | null>(null);
    const [removing, setRemoving] = useState<Entry | null>(null);
    const [error, setError] = useState<{
        text: string;
        stale: boolean;
    } | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [reload, setReload] = useState(0);
    const [sourceRefresh, setSourceRefresh] = useState(0);
    const sourceEpoch = useRef(0);
    const [today, setToday] = useState(todayIso);
    const pending = useRef<HomeworkOperation | null>(null);
    const lock = useRef(false);
    const saveScope = useRef(0);
    useEffect(() => { saveScope.current++; return () => { saveScope.current++; }; }, [repositories, assignmentId]);
    const lease = useRef(0);
    const started = useRef<number | null>(null);

    const targetActivity = searchParams.get("activity");
    const targetSelection = assignmentId && targetActivity ? `${assignmentId}:${targetActivity}` : null;
    const topHeading = useRef<HTMLHeadingElement>(null);
    const handledTargetSelection = useRef<string | null>(null);

    useEffect(() => {
        if (!targetSelection) {
            handledTargetSelection.current = null;
            return;
        }
        if (handledTargetSelection.current && handledTargetSelection.current !== targetSelection) {
            handledTargetSelection.current = null;
        }
        if (handledTargetSelection.current === targetSelection) {
            return;
        }
        if (!loading && current && current.assignment.id === assignmentId) {
            const el = document.getElementById(`homework-${targetActivity}`) ?? topHeading.current;
            if (el) {
                el.scrollIntoView?.();
                el.focus();
                handledTargetSelection.current = targetSelection;
            }
        }
    }, [targetSelection, targetActivity, assignmentId, loading, current]);
    useEffect(() => { const update = () => setToday(todayIso()); const timer = window.setInterval(update, 30000); window.addEventListener("focus", update); document.addEventListener("visibilitychange", update); return () => { window.clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); }; }, []);
    useEffect(() => {
        let timer: number | undefined;
        const recheck = () => {
            if (document.visibilityState === "hidden" || timer !== undefined) return;
            // Invalidate immediately, including promises that settle before the next effect.
            sourceEpoch.current++;
            setCheckedSources(null);
            setSourceStates({});
            timer = window.setTimeout(() => {
                timer = undefined;
                setSourceRefresh(n => n + 1);
            }, 0);
        };
        window.addEventListener("focus", recheck);
        document.addEventListener("visibilitychange", recheck);
        return () => {
            window.removeEventListener("focus", recheck);
            document.removeEventListener("visibilitychange", recheck);
            window.clearTimeout(timer);
            sourceEpoch.current++;
        };
    }, []);
    useEffect(() => {
        const mine = ++lease.current;
        setLoading(true);
        if(!pending.current) setError(null);
        if (!repositories)
            return;
        const load = async () => {
            if (assignmentId) {
                const [s, h] = await Promise.all([repositories.homework.get(assignmentId), repositories.homework.history(assignmentId)]);
                if (mine !== lease.current)
                    return;
                setCurrent(s);
                setHistory(h.map(row=>({change_kind:String(row.change_kind),recorded_at:String(row.recorded_at ?? row.created_at ?? ""),created_at:String(row.created_at ?? row.recorded_at ?? ""),revision:Number(row.revision),snapshot_json:row.snapshot_json})));
            }
            else {
                const rows = await repositories.homework.list(true);
                const loaded: HomeworkSnapshot[] = [];
                for (const row of rows) {
                    const s = await repositories.homework.get(String(row.id));
                    if (mine !== lease.current)
                        return;
                    if (s)
                        loaded.push(s);
                }
                setSnapshots(loaded);
            }
        };
        void load().catch(() => { if (mine === lease.current)
            setError({ text: "Homework couldn't be loaded. Try reloading.", stale: false }); }).finally(() => { if (mine === lease.current)
            setLoading(false); });
        return () => { lease.current++; };
    }, [repositories, assignmentId, dataRevision, reload]);
    useEffect(() => () => { if (controller && started.current === controller.status().epoch && controller.status().kind === 'working')
        controller.abort(); started.current = null; }, [controller, assignmentId]);
    useEffect(() => {
        let live = true;
        const epoch = ++sourceEpoch.current;
        const isCurrent = () => live && epoch === sourceEpoch.current;
        setCheckedSources(null);
        setSourceStates({});
        if (!current || !repositories)
            return;
        // Promises (including failures) are shared only within this check run.
        const readings = new Map<string, ReturnType<typeof repositories.navigation.inspect>>();
        const cards = new Map<string, Promise<string | null>>();
        const versions = new Map<string, ReturnType<typeof repositories.practiceSessions.getVersion>>();
        const activeVersions = new Map<string, ReturnType<typeof repositories.practiceSessions.getActiveVersion>>();
        function once<T>(cache: Map<string, Promise<T>>, key: string, check: () => Promise<T>): Promise<T> {
            let result = cache.get(key);
            if (!result) {
                result = Promise.resolve().then(check);
                cache.set(key, result);
            }
            return result;
        }
        void Promise.all(activeHomework(current).map(async (e) => {
            const r = e.record;
            if (!r.material_id || !["read", "cards", "test"].includes(r.kind))
                return;
            try {
                let hash: string | null = null;
                if (r.kind === 'cards') {
                    hash = await once(cards, r.material_id, async () => {
                        const set = data.aiStudySets.find(s => s.sourceMaterialId === r.material_id);
                        return set?.flashcards.length ? (await cardVersion(r.material_id!, set.flashcards)).contentHash : null;
                    });
                }
                else if (r.kind === 'test') {
                    const v = r.test_version_id ? await once(versions, r.test_version_id, () => repositories.practiceSessions.getVersion(r.test_version_id!)) : null;
                    if (!v) {
                        if (isCurrent())
                            setSourceStates(s => ({ ...s, [r.id]: "missing" }));
                        return;
                    }
                    // The ordinary quiz screen opens the current version. Refuse a silent replacement.
                    const active = await once(activeVersions, r.material_id, () => repositories.practiceSessions.getActiveVersion(r.material_id!));
                    hash = active?.version.id === r.test_version_id ? v.contentHash : null;
                }
                else if (repositories.navigation.canCheckFiles()) {
                    const inspected = await once(readings, r.material_id, () => repositories.navigation.inspect(r.material_id!));
                    hash = inspected.contentSha256;
                    const start = r.page_start;
                    const end = r.page_end;
                    if (!Number.isInteger(start) || !Number.isInteger(end) || start! < 1 || end! < start! || end! > inspected.totalPages) {
                        if (isCurrent()) setSourceStates(s => ({ ...s, [r.id]: "changed" }));
                        return;
                    }
                }
                else
                    return;
                if (isCurrent() && hash !== r.source_revision)
                    setSourceStates(s => ({ ...s, [r.id]: "changed" }));
            }
            catch {
                if (isCurrent())
                    setSourceStates(s => ({ ...s, [r.id]: "unavailable" }));
            }
        })).then(()=>{if(isCurrent())setCheckedSources(current);});
        return () => { live = false; };
    }, [current, repositories, data.aiStudySets, dataRevision, reload, sourceRefresh]);
    useEffect(() => { if (!busy && !loading && focusActivity.current) {
        document.getElementById(`homework-${focusActivity.current}`)?.focus();
        focusActivity.current = null;
    } }, [loading,busy]);
    useEffect(() => {
        if (!busy && !loading && checkedSources && checkedSources === current && cardFocusIntent.current) {
            const intent = cardFocusIntent.current;
            cardFocusIntent.current = null;
            if (intent.assignmentId !== assignmentId) return;

            const active = document.activeElement;
            const movedAway =
                active &&
                active !== document.body &&
                active !== document.documentElement;
            if (movedAway) return;

            const run = current.runs.find(
                (r) =>
                    r.activity_id === intent.activityId &&
                    r.cycle === current.activities.find((a) => a.record.id === intent.activityId)?.record.cycle &&
                    !r.invalidated_at &&
                    r.kind === "cards",
            ) as import("@/domain/homework").HomeworkCardRun | undefined;

            if (run?.finished_at) {
                document.getElementById(`homework-${intent.activityId}`)?.focus({ preventScroll: true });
            } else {
                document.getElementById(intent.headingId)?.focus({ preventScroll: true });
            }
        }
    }, [busy, loading, checkedSources, current, assignmentId]);
    const loadAgain = () => { pending.current = null; setEditor(null); setReload(n => n + 1); };
    const perform = async (op: HomeworkOperation) => {
        if (lock.current || !repositories)
            return false;
        lock.current = true;
        setBusy(true);
        setError(null);
        const mine = saveScope.current;
        pending.current = op;
        try {
            await repositories.homework.save(op);
            try {
                await refresh();
            }
            catch { /* The repository read below still confirms the saved homework. */ }
            const [saved, entries] = await Promise.all([repositories.homework.get(op.assignmentId), repositories.homework.history(op.assignmentId)]);
            if (mine === saveScope.current) {
                pending.current = null;
                setCurrent(saved);
                setHistory(entries.map(row=>({change_kind:String(row.change_kind),recorded_at:String(row.recorded_at ?? row.created_at ?? ""),created_at:String(row.created_at ?? row.recorded_at ?? ""),revision:Number(row.revision),snapshot_json:row.snapshot_json})));
                setRemoving(null);
            }
            return true;
        }
        catch (e) {
            if (mine === saveScope.current) {
                const conflict = op.changeKind === "start" && op.next.runs.some(r => r.kind === "test") &&
                    ((e as { code?: string })?.code === "CONFLICT" || String(e).includes("already used"));
                setError(conflict ? { text: "Finish or abandon the in-progress quiz first.", stale: false } : homeworkSaveMessage(e));
            }
            return false;
        }
        finally {
            lock.current = false;
            setBusy(false);
        }
    };
    const change = (kind: HomeworkOperation['changeKind'], edit: (draft: HomeworkSnapshot) => void) => {
        if (!current)
            return;
        const draft = structuredClone(current);
        edit(draft);
        void perform(homeworkOperation(current, draft, kind));
    };
    const finished = (id: string) => { setEditor(null); setReload(n => n + 1); navigate(`/study/homework/${id}`); };
    const sourceMissing = (e: Entry) => ["read", "cards", "test"].includes(e.record.kind) && (!e.record.material_id || !data.materials.some(m => m.id === e.record.material_id) || !e.record.source_revision || (e.record.kind === 'test' && !e.record.test_version_id) || (e.record.kind === 'cards' && !e.record.card_set_id) || (e.record.kind === 'read' && (!e.record.page_start || !e.record.page_end || !e.source?.total_pages)));
    const openReading = async (e: Entry) => { if (!controller || !e.record.material_id || !e.record.page_start)
        return; const result = controller.openSaved({ materialId: e.record.material_id, contentSha256: e.record.source_revision, physicalPage: e.record.page_start, pageLabel: null }); started.current = controller.status().epoch; await result; };
    const active = current ? activeHomework(current) : [];
    const offlineSummary = current && current.assignment.id === assignmentId
        ? homeworkOfflineSummary({
            activities: active.map(e => ({ id: e.record.id, kind: e.record.kind, title: e.record.title })),
            sourceState: (id: string) => sourceStates[id],
            sourceMissing: (id: string) => {
                const e = active.find(x => x.record.id === id);
                return e ? sourceMissing(e) : false;
            },
            checked: checkedSources === current,
            canCheckFiles: Boolean(repositories?.navigation?.canCheckFiles()),
        })
        : null;
    const editable = !busy && !pending.current;
    return <div className="homework-view stack stack--4">
    <PageHeader title="Homework" subtitle="A little preparation, at your pace." action={<Button variant="primary" onClick={() => setEditor({ snapshot: newHomework(), creating: true })} disabled={busy}>Add homework</Button>}/>
    <Link to="/study">Study Library</Link>
    <p role="status" className="small muted">{announcement}</p>
    {error ? <div role="alert"><p>{error.text}</p><Button onClick={loadAgain}>Reload</Button>{pending.current && !error.stale ? <Button disabled={busy} onClick={() => void perform(pending.current!)}>Retry save</Button> : null}</div> : null}
    {loading ? <p role="status">Loading homework…</p> : assignmentId ? !current ? <p>That homework isn't here any more.</p> : <>
      <Link to="/study/homework">All homework</Link>
      <Card><CardBody><div className="stack stack--3"><h2 ref={topHeading} tabIndex={-1} className="homework-title wrap-anywhere">{current.assignment.title}</h2>
        {offlineSummary && offlineSummary.summary.state !== "empty" ? (
          <p role="status" aria-live="polite" className="small muted wrap-anywhere">
            <span>Before you go offline</span> · <span>{offlineSummary.summary.text}</span>
          </p>
        ) : null}
        <p>{active.filter(e => e.record.state === 'completed').length} of {active.length} done{current.assignment.archived ? ' · Archived' : ''}</p>
        {current.assignment.due_date ? <p>Due {formatShortDate(current.assignment.due_date, today)}{!current.assignment.archived && current.assignment.state !== 'completed' && current.assignment.due_date < today ? <span className="homework-overdue"> · <AlertIcon size={14}/> overdue</span> : null}</p> : null}
        {current.assignment.instructions ? <p className="homework-text">{current.assignment.instructions}</p> : null}
        {current.assignment.school ? <p>School: {current.assignment.school}</p> : null}{current.assignment.instructor ? <p>Instructor: {current.assignment.instructor}</p> : null}
        {current.assignment.source_lesson_id ? (() => { const lesson = data.events.find(e => e.id === current.assignment.lesson_id); return <p>{lesson ? `${lesson.title} · ${lesson.date}${lesson.startTime ? ` · ${lesson.startTime}` : ''}${lesson.status === 'cancelled' ? ' · Lesson cancelled' : ''}` : 'Lesson missing — edit homework to choose a lesson or unlink it.'} Your homework due date stays as you set it.</p>; })() : null}
        <div className="row row--wrap"><Button disabled={!editable} onClick={() => setEditor({ snapshot: current })}>Edit homework</Button><Button disabled={!editable} onClick={() => setEditor({ snapshot: current, adding: true })}>Add activities</Button><Button disabled={!editable} onClick={() => change('archive', s => { s.assignment.archived = s.assignment.archived ? 0 : 1; })}>{current.assignment.archived ? 'Unarchive' : 'Archive'}</Button></div>
      </div></CardBody></Card>
      {active.length === 0 ? <p>Add an activity whenever you're ready.</p> : null}
      <ol className="homework-activities">
        {active.map((e, index) => {
                const r = e.record;
                const missing = sourceMissing(e) || !!sourceStates[r.id];
                const done = r.state === 'completed';
                const offlineItem = offlineSummary?.items.find(item => item.id === r.id);
                return <li key={r.id} className="homework-activity stack stack--3">
          <h3 className="wrap-anywhere" tabIndex={-1} id={`homework-${r.id}`}>{r.title}</h3><p className="small muted wrap-anywhere">{ACTIVITY_KINDS[r.kind]} · {done ? 'Done' : activityStateLabel(r.state, r.id, history)}{offlineItem ? <> · <span>{offlineItem.text}</span></> : null}</p>
          {r.body ? <p className="homework-text">{r.body}</p> : null}
          {['reflection', 'questions'].includes(r.kind) && !done ? (
            <div className="stack stack--2" style={{ marginTop: "var(--space-2)" }}>
              <textarea
                className="textarea"
                rows={3}
                disabled={!editable}
                placeholder={r.kind === "questions" ? "Write questions for your instructor (one per line)…" : "Write your reflection…"}
                aria-label={`Answer for ${r.title}`}
                value={activityDrafts[r.id] ?? r.answer ?? ""}
                onChange={(event) => {
                  const val = event.target.value;
                  setActivityDrafts((prev) => ({ ...prev, [r.id]: val }));
                }}
              />
              <div className="row" style={{ alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                <Button
                  disabled={!editable || (activityDrafts[r.id] !== undefined && activityDrafts[r.id] === (r.answer ?? ""))}
                  onClick={() => {
                    const text = activityDrafts[r.id] ?? r.answer ?? "";
                    change("edit", (s) => {
                      s.activities.find((x) => x.record.id === r.id)!.record.answer = text;
                    });
                  }}
                >
                  Save
                </Button>
                <Button
                  disabled={!editable || !(r.answer ?? "").trim()}
                  onClick={() =>
                    change("complete", (s) => {
                      s.activities.find((x) => x.record.id === r.id)!.record.state = "completed";
                    })
                  }
                >
                  Mark complete
                </Button>
                {!(r.answer ?? "").trim() ? (
                  <span className="tiny muted">Write your answer first</span>
                ) : null}
              </div>
            </div>
          ) : r.answer ? (
            <p className="homework-text">{r.answer}</p>
          ) : null}
          {missing ? <><p>{sourceStates[r.id] === 'changed' ? "Source changed — choose a source to continue" : sourceStates[r.id] === 'unavailable' ? "This source could not be checked. Choose a source to continue" : "Source missing — choose a source to continue"}</p><Button disabled={!editable} onClick={() => setEditor({ snapshot: current, activityId: r.id, relink: true })}>Choose a source for {r.title}</Button></> : e.source ? <p>{e.source.title}{r.kind === 'read' ? ` · PDF pages ${r.page_start}–${r.page_end}` : ''}</p> : null}
          {done && r.kind==='cards' ? <p>Historical review · {(current.runs.find(run=>run.activity_id===r.id && run.cycle===r.cycle && !run.invalidated_at && run.kind==='cards') as import("@/domain/homework").HomeworkCardRun | undefined)?.ratings.length ?? 0} linked cards rated{missing?' · Source missing or changed':''}</p> : null}
          {done && r.kind==='test' ? (() => {
            const testRun = current.runs.find(run => run.activity_id === r.id && run.cycle === r.cycle && run.kind === 'test') as import("@/domain/homework").HomeworkTestRun | undefined;
            const ev = testRun?.evidence;
            return <p>Quiz completed · Score: {ev?.score_percent !== null && ev?.score_percent !== undefined ? `${ev.score_percent}%` : 'Recorded'}{ev && ev.total_questions > 0 ? ` (${ev.correct_count} of ${ev.total_questions} correct)` : ''}{missing?' · Source missing or changed':''}</p>;
          })() : null}
          <div className="row row--wrap">
            {r.kind === 'read' ? <><Button disabled={missing || !controller || status.kind === 'working'} onClick={() => void openReading(e)}>Open PDF at page {r.page_start ?? 1}</Button>{!done ? <Button disabled={!editable || missing} onClick={() => change('complete', s => { s.activities.find(x => x.record.id === r.id)!.record.state = 'completed'; })}>Mark reading complete</Button> : null}</> : null}
            {r.kind === 'checklist' && !done ? <label className="row"><input type="checkbox" checked={false} disabled={!editable} onChange={() => change('complete', s => { s.activities.find(x => x.record.id === r.id)!.record.state = 'completed'; })}/>Done</label> : null}
            {r.kind === 'cards' && repositories?.cardReviews && !missing && checkedSources===current ? <HomeworkCardRun snapshot={current} entry={e} repository={repositories.cardReviews} disabled={!editable || !!current.assignment.archived} save={async op => { await perform(op); }} reload={(intent?: { activityId?: string; headingId?: string }) => { if (intent?.activityId && intent?.headingId && current) { cardFocusIntent.current = { activityId: intent.activityId, headingId: intent.headingId, assignmentId: current.assignment.id }; } else { cardFocusIntent.current = null; } setReload(n=>n+1); }} reopen={() => change('reopen',s=>{s.activities.find(x=>x.record.id===r.id)!.record.cycle++;})}/> : null}
            {r.kind === 'test' && !done ? (() => {
              const openRun = current.runs.find(run => run.activity_id === r.id && run.cycle === r.cycle && !run.finished_at && !run.invalidated_at && run.kind === 'test');
              if (missing || checkedSources !== current) {
                return <span>Open quiz · {missing ? 'choose a source first' : 'checking source…'}</span>;
              }
              if (openRun) {
                return <Link className="button button--secondary" to={`/study/${r.material_id}`}>Continue quiz</Link>;
              }
              return <Button disabled={!editable || !!current.assignment.archived} onClick={async () => {
                try {
                  const runId = crypto.randomUUID();
                  const attemptId = crypto.randomUUID();
                  const now = new Date(Math.max(Date.now(), Date.parse(current.assignment.updated_at) + 1)).toISOString();
                  const next = structuredClone(current);
                  const act = next.activities.find(a => a.record.id === r.id)!;
                  act.record.state = "in_progress";
                  act.record.updated_at = now;
                  next.assignment.revision++;
                  next.assignment.updated_at = now;
                  next.assignment.state = "in_progress";
                  next.assignment.completed_at = null;
                  next.runs.push({
                    id: runId,
                    activity_id: act.record.id,
                    cycle: act.record.cycle,
                    activity_revision: act.record.revision,
                    kind: "test",
                    started_at: now,
                    finished_at: null,
                    invalidated_at: null,
                    evidence: null,
                    scope: {
                      version: 1,
                      material_id: act.record.material_id!,
                      source_revision: act.record.source_revision!,
                      test_version_id: act.record.source_test_version_id!,
                      attempt_id: attemptId,
                    },
                  });
                  next.runs.sort((a, b) => a.id.localeCompare(b.id));
                  const saved = await perform({
                    version: 1,
                    operationId: crypto.randomUUID(),
                    assignmentId: next.assignment.id,
                    baseRevision: current.assignment.revision,
                    changeKind: "start",
                    at: now,
                    next,
                  });
                  if (saved) navigate(`/study/${act.record.material_id}`);
                } catch {
                  setAnnouncement("Finish or abandon the in-progress quiz first.");
                  setError({ text: "Finish or abandon the in-progress quiz first.", stale: false });
                }
              }}>Start quiz</Button>;
            })() : null}
            {done ? <Button disabled={!editable} aria-label={`Reopen ${r.title}`} onClick={() => change('reopen', s => { s.activities.find(x => x.record.id === r.id)!.record.cycle++; })}>Reopen</Button> : null}
            <Button disabled={!editable} aria-label={`Edit ${r.title}`} onClick={() => setEditor({ snapshot: current, activityId: r.id })}>Edit</Button>
            <Button aria-label={`Move ${r.title} up`} disabled={!editable || index === 0} onClick={() => { focusActivity.current = r.id; setAnnouncement(`Moving ${r.title}…`); change('reorder', s => { s.activities.find(x => x.record.id === r.id)!.record.position--; s.activities.find(x => x.record.id === active[index - 1]!.record.id)!.record.position++; }); }}>Move up</Button>
            <Button aria-label={`Move ${r.title} down`} disabled={!editable || index === active.length - 1} onClick={() => { focusActivity.current = r.id; setAnnouncement(`Moving ${r.title}…`); change('reorder', s => { s.activities.find(x => x.record.id === r.id)!.record.position++; s.activities.find(x => x.record.id === active[index + 1]!.record.id)!.record.position--; }); }}>Move down</Button>
            <Button variant="danger" className="destructive-action" disabled={!editable} aria-label={`Remove ${r.title}`} onClick={() => setRemoving(e)}>Remove</Button>
          </div>
        </li>;
            })}
      </ol>
      {status.kind === 'failed' || status.kind === 'refused' || status.kind === 'opened_unsaved' || status.kind === 'guidance' ? <p role="status">{status.message}</p> : status.kind === 'saved' ? <p role="status">Opened in your PDF reader. Go to PDF page {status.destination.physicalPage} there; your reader may not jump to it by itself. Mark reading complete when you're finished.</p> : null}
      <section><h2>History</h2><ol>{history.map((h,index) => <li key={h.revision}>{homeworkHistoryLabel(h,history[index-1])} · {formatDateTime(h.recorded_at ?? h.created_at)}</li>)}</ol></section>
    </> : <>
      <div className="row row--wrap" aria-label="Homework filters">{Object.entries(filters).map(([key, label]) => <Button key={key} variant={filter === key ? "primary" : "secondary"} aria-pressed={filter === key} onClick={() => setFilter(key as keyof typeof filters)}>{label}</Button>)}</div>
      {snapshots.filter(s => matchesHomeworkFilter(s, filter, today)).map(s => <Card key={s.assignment.id}><CardBody><Link to={`/study/homework/${s.assignment.id}`} className="wrap-anywhere">{s.assignment.title}</Link><p>{activeHomework(s).filter(e => e.record.state === 'completed').length} of {activeHomework(s).length} done</p>{s.assignment.due_date ? <p>Due {formatShortDate(s.assignment.due_date, today)}{!s.assignment.archived && s.assignment.state !== 'completed' && s.assignment.due_date < today ? <span className="homework-overdue"> · <AlertIcon size={14}/> overdue</span> : null}</p> : null}</CardBody></Card>)}
      {snapshots.length === 0 ? <p>No school, instructor or date needed. Add homework for whatever you'd like to work on next.</p> : null}
      {snapshots.length > 0 && !snapshots.some(s => matchesHomeworkFilter(s, filter, today)) ? <p>No homework in this view yet.</p> : null}
    </>}
    {editor ? <HomeworkEditor key={`${editor.snapshot.assignment.id}-${editor.activityId ?? 'assignment'}-${editor.adding ?? false}`} {...editor} onClose={() => {setEditor(null);setReload(n=>n+1);}} onSaved={finished} onReload={loadAgain}/> : null}
    <ConfirmDialog open={!!removing} title="Remove activity?" message="Your earlier work stays in homework history." confirmLabel="Remove activity" pending={busy} onCancel={() => setRemoving(null)} onConfirm={() => { if (!removing)
        return; change('remove_activity', s => { s.activities.find(e => e.record.id === removing.record.id)!.record.removed_at = new Date().toISOString(); activeHomework(s).forEach((e, i) => { e.record.position = i; }); }); }}/>
  </div>;
}
