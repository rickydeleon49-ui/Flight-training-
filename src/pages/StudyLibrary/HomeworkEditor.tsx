import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Field, TextInput, TextArea } from "@/components/ui";
import type { HomeworkOperation, HomeworkSnapshot } from "@/domain/homework";
import { useAppData } from "@/state/AppDataContext";
import { cardVersion, canonicalJson } from "@/logic/cardIdentity";
import { ACTIVITY_KINDS, activeHomework, homeworkOperation, homeworkSaveMessage, newHomeworkActivity, type Entry } from "./homeworkUi";
interface Props {
    snapshot: HomeworkSnapshot;
    creating?: boolean;
    activityId?: string;
    relink?: boolean;
    adding?: boolean;
    onClose(): void;
    onSaved(id: string): void;
    onReload(): void;
}
export function HomeworkEditor({ snapshot, creating = false, activityId, adding = false, relink = false, onClose, onSaved, onReload }: Props) {
    const { data, repositories, refresh } = useAppData();
    const [draft, setDraft] = useState(() => structuredClone(snapshot));
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<{
        text: string;
        stale: boolean;
    } | null>(null);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const submitting = useRef(false);
    const pending = useRef<{
        key: string;
        op: HomeworkOperation;
    } | null>(null);
    const [latest, setLatest] = useState<HomeworkSnapshot | null>(null);
    const [checking, setChecking] = useState(false);
    const assignment = draft.assignment;
    function updateEntry(id: string, change: (entry: Entry) => void) { setDraft(s => { const next = structuredClone(s); change(next.activities.find(e => e.record.id === id)!); return next; }); }
    const add = (kind: Entry["record"]["kind"]) => setDraft(s => ({ ...s, activities: [...s.activities, newHomeworkActivity(s.assignment.id, activeHomework(s).length, kind, s.assignment.created_at)] }));
    const chooseSource = async (id: string, materialId: string) => {
        if (!repositories)
            return;
        setChecking(true);
        setProblem(null);
        try {
            const e = structuredClone(draft.activities.find(e => e.record.id === id)!);
            const r = e.record;
            const material = data.materials.find(m => m.id === materialId);
            if (!material)
                throw new Error("source");
            r.material_id = materialId;
            r.source_material_id = materialId;
            r.source_revision = null;
            r.card_set_id = null;
            r.test_version_id = null;
            r.source_test_version_id = null;
            r.page_start = null;
            r.page_end = null;
            e.source = { title: material.title, total_pages: null };
            if (r.kind === "read") {
                const identity = await repositories.navigation.inspect(materialId);
                r.source_revision = identity.contentSha256;
                e.source.total_pages = identity.totalPages;
                r.page_start = 1;
                r.page_end = identity.totalPages;
            }
            else if (r.kind === "cards") {
                const set = data.aiStudySets.find(s => s.sourceMaterialId === materialId);
                if (!set?.flashcards.length)
                    throw new Error("cards");
                const version = await cardVersion(materialId, set.flashcards);
                r.source_revision = version.contentHash;
                r.card_set_id = version.versionId;
            }
            else {
                const active = await repositories.practiceSessions.getActiveVersion(materialId);
                if (!active)
                    throw new Error("quiz");
                r.test_version_id = active.version.id;
                r.source_test_version_id = active.version.id;
                r.source_revision = active.version.contentHash;
            }
            updateEntry(id, entry => { entry.source = e.source; Object.assign(entry.record, r); });
        }
        catch {
            setProblem({ text: "That source isn't available yet. Reading needs checked PDF pages in the desktop app; cards and quizzes need saved study content.", stale: false });
        }
        finally {
            setChecking(false);
        }
    };
    const submit = async () => {
        if (submitting.current || checking || !repositories)
            return;
        if (!assignment.title.trim() || draft.activities.some(e => !e.record.title.trim())) {
            setProblem({ text: "Give your homework and each activity a title.", stale: false });
            return;
        }
        const edited = activeHomework(draft).filter(e => creating || e.record.id === activityId || !snapshot.activities.some(p => p.record.id === e.record.id));
        for (const e of edited) {
            const r = e.record;
            if (relink && (!r.material_id || !r.source_revision)) {
                setProblem({ text: "Choose a source before saving this activity.", stale: false });
                return;
            }
            if (r.kind === "read" && (r.page_start !== null || r.page_end !== null || r.source_revision !== null) && (!Number.isInteger(r.page_start) || !Number.isInteger(r.page_end) || r.page_start! < 1 || r.page_end! < r.page_start! || r.page_end! > (e.source?.total_pages ?? 0))) {
                setProblem({ text: "Choose a physical page range within this PDF.", stale: false });
                return;
            }
        }
        submitting.current = true;
        setBusy(true);
        setProblem(null);
        try {
            const key = canonicalJson(draft);
            if (pending.current?.key !== key)
                pending.current = { key, op: homeworkOperation(snapshot, draft, relink ? "relink" : "edit", creating) };
            await repositories.homework.save(pending.current.op);
            try {
                await refresh();
            }
            catch { /* Saved; the view reloads from the repository. */ }
            if (mounted.current)
                onSaved(draft.assignment.id);
        }
        catch (error) {
            setProblem(homeworkSaveMessage(error));
        }
        finally {
            submitting.current = false;
            setBusy(false);
        }
    };
    const entries = activeHomework(draft).filter(e => creating || e.record.id === activityId || (adding && !snapshot.activities.some(p => p.record.id === e.record.id)));
    return <Dialog open title={creating ? "Add homework" : relink ? "Choose a source" : "Edit homework"} onClose={onClose} dismissible={!busy && !checking} footer={<><Button onClick={onClose} disabled={busy || checking}>Cancel</Button><Button variant="primary" onClick={() => void submit()} disabled={busy || checking || problem?.stale}>{busy ? "Saving…" : "Save homework"}</Button></>}>
    <div className="stack stack--4">
      {problem ? <div role="alert"><p>{problem.text}</p>{problem.stale ? <Button onClick={async () => { try {
        setLatest(await repositories!.homework.get(snapshot.assignment.id));
    }
    catch {
        setProblem({ text: "The latest homework could not be loaded. Your draft is still here.", stale: true });
    } }}>Reload</Button> : null}</div> : null}
      {latest ? <div className="small muted" role="status">Latest saved homework: {latest.assignment.title}. {latest.assignment.instructions} Your draft below is still here. <Button onClick={onReload}>Open saved homework</Button></div> : null}
      <fieldset disabled={busy || checking} className="homework-fields">
      {!activityId && !adding ? <div className="form-grid">
        {([['title', 'Title'], ['instructions', 'Instructions (optional)'], ['due_date', 'Due date (optional)'], ['school', 'School (optional)'], ['instructor', 'Instructor (optional)']] as const).map(([key, label]) => <Field key={key} label={label} full>{({ id }) => key === 'instructions' ? <TextArea id={id} maxLength={20000} value={assignment[key] ?? ""} onChange={e => setDraft(s => ({ ...s, assignment: { ...s.assignment, [key]: e.target.value } }))}/> : <TextInput id={id} type={key === 'due_date' ? 'date' : 'text'} required={key === 'title'} maxLength={key === 'due_date' ? 10 : 200} value={assignment[key] ?? ""} onChange={e => setDraft(s => ({ ...s, assignment: { ...s.assignment, [key]: e.target.value || (key === 'title' ? "" : null) } }))}/>}</Field>)}
        <Field label="Lesson (optional)" full>{({ id }) => <select className="select" id={id} value={assignment.lesson_id ?? ""} onChange={e => setDraft(s => ({ ...s, assignment: { ...s.assignment, lesson_id: e.target.value || null, source_lesson_id: e.target.value || null } }))}><option value="">No lesson linked</option>{data.events.filter(e => e.eventType === "flight_lesson").map(e => <option key={e.id} value={e.id}>{e.title} · {e.date}</option>)}</select>}</Field>
      </div> : null}
      {creating || adding ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <h4 className="homework-activities-heading">Activities</h4>
          <div className="row row--wrap">{Object.entries(ACTIVITY_KINDS).map(([kind, label]) => <Button key={kind} disabled={activeHomework(draft).length >= 100} onClick={() => add(kind as Entry["record"]["kind"])}>Add {label.toLowerCase()}</Button>)}</div>
        </div>
      ) : null}
      {entries.map(e => <section className="stack stack--3 homework-activity" key={e.record.id}>
        <h3>{ACTIVITY_KINDS[e.record.kind]}</h3>
        {["read","cards","test"].includes(e.record.kind)&&!e.record.source_revision?<p className="small muted">You can save this draft now and choose a source when you are ready.</p>:null}
        <Field label="Activity title">{({ id }) => <TextInput id={id} maxLength={200} value={e.record.title} disabled={relink} onChange={event => updateEntry(e.record.id, entry => { entry.record.title = event.target.value; })}/>}</Field>
        {!relink ? (
          <div className="homework-kind-secondary">
            <Field label="Kind">{({ id }) => <select className="select" id={id} value={e.record.kind} onChange={event => updateEntry(e.record.id, entry => { const fresh = newHomeworkActivity(assignment.id, entry.record.position, event.target.value as Entry["record"]["kind"], entry.record.created_at); Object.assign(entry.record, { ...fresh.record, id: entry.record.id, title: entry.record.title, body: entry.record.body, cycle: entry.record.cycle, revision: entry.record.revision }); entry.source = null; })}>{Object.entries(ACTIVITY_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
          </div>
        ) : null}
        {!relink ? <Field label="Activity text">{({ id }) => <TextArea id={id} maxLength={20000} value={e.record.body} onChange={event => updateEntry(e.record.id, entry => { entry.record.body = event.target.value; })}/>}</Field> : null}
        {["read", "cards", "test"].includes(e.record.kind) ? <>
          <Field label="Material">{({ id }) => <select className="select" id={id} value={e.record.material_id ?? ""} onChange={event => void chooseSource(e.record.id, event.target.value)}><option value="">Choose a material</option>{data.materials.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select>}</Field>
          {e.record.material_id ? <Button onClick={() => void chooseSource(e.record.id, e.record.material_id!)}>Use this source again</Button> : null}
          {e.record.kind === 'read' ? <><p className="small muted">Physical PDF pages{e.source?.total_pages ? ` · ${e.source.total_pages} pages` : " · check a PDF in the desktop app"}</p>{(['page_start', 'page_end'] as const).map(key => <Field key={key} label={key === 'page_start' ? 'Start page' : 'End page'}>{({ id }) => <TextInput id={id} type="number" min={1} max={e.source?.total_pages ?? undefined} value={e.record[key] ?? ""} onChange={event => updateEntry(e.record.id, entry => { entry.record[key] = event.target.value ? Number(event.target.value) : null; })}/>}</Field>)}</> : null}
          {e.record.kind === 'test' && e.record.test_version_id ? <p className="small muted">This activity keeps the saved quiz version you selected. Choose the material again to use its latest quiz.</p> : null}
        </> : null}
      </section>)}
      </fieldset>
    </div>
  </Dialog>;
}
