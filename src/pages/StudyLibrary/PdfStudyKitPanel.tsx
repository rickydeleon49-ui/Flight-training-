import { Link } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@/data";
import { Button, Card, CardBody, CardHeader, Checkbox, ConfirmDialog, Dialog, Field, TextArea } from "@/components/ui";
import type { StudyMaterial } from "@/domain/types";
import { kitCandidates, kitHasNoUsableText, kitEditOrigin, kitItemEvidence, kitQuestionSeed, kitReviewItems, kitSources, type KitReviewItem, type PdfQuestionSeed } from "@/data/pdfStudyKitDraft";
import { validateNextSet, type StoredSetRow, type StudySetSaveOperation } from "@/data/studySetTransaction";
import { getPdfStudyKit, listPdfStudyKitJobs, preparePdfStudyKit, type PdfStudyKitDraft } from "@/services/documents";
import { acknowledgeGeminiJob, cancelGeminiJob } from "@/services/gemini";
import { prepareOfflineContent, verifyOfflineDestination } from "@/services/offlineContent";
import { useAppData } from "@/state/AppDataContext";
import { useNavigationController } from "@/state/navigation/useDocumentNavigation";
import { PdfPracticeQuestions } from "./PracticeTestEditing";
import { PDF_KIT_REMINDER, PdfItemLabel } from "./PdfItemLabel";

const EXTRACTION_UNAVAILABLE = "Making a study kit from your PDF isn't available in this version yet. It's coming in a later update.";
const SOURCE_CHANGED = "The PDF or page choice changed since this kit was made. Rebuild it when you’re ready.";
const codeOf = (e: unknown) => typeof e === "object" && e !== null && "code" in e ? String(e.code) : "";
const mirrorKey = (run: string) => `hfd:pdf-kit-review:${run}`;
const questionsMirrorKey = (run: string) => `hfd:pdf-kit-questions:${run}`;

type KitJob = Awaited<ReturnType<typeof listPdfStudyKitJobs>>[number];

interface Mirror {
  items: KitReviewItem[];
  pending: StudySetSaveOperation | null;
  saved: boolean;
  operationId?: string;
  questionsSaved?: boolean;
  questionsLeftOut?: boolean;
}

function clearKitMirrors(run: string) {
  try {
    localStorage.removeItem(mirrorKey(run));
    localStorage.removeItem(questionsMirrorKey(run));
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("hfd:pdf-kit-") && k.endsWith(`:${run}`)) {
        localStorage.removeItem(k);
      }
    }
  } catch {}
}

async function acknowledgeJob(id: string, runId?: string): Promise<boolean> {
  let ack = false;
  try {
    ack = await acknowledgeGeminiJob(id);
  } catch {
    return false;
  }
  if (!ack) {
    try {
      const jobs = await listPdfStudyKitJobs();
      if (jobs.some(j => j.id === id)) return false;
    } catch {
      return false;
    }
  }
  if (runId) clearKitMirrors(runId);
  return true;
}

export function PdfStudyKitPanel({ material }: { material: StudyMaterial }) {
  const { repositories, mutate, data } = useAppData();
  const [job, setJob] = useState<string | null>(null);
  const [resume, setResume] = useState<string | null>(null);
  const [otherKit, setOtherKit] = useState<KitJob | null>(null);
  const [resumeStage, setResumeStage] = useState<string | null>(null);
  const [confirmOther, setConfirmOther] = useState<KitJob | null>(null);
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState<PdfStudyKitDraft | null>(null);
  const [items, setItems] = useState<KitReviewItem[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [extractionUnavailable, setExtractionUnavailable] = useState(false);
  const [cacheMissing, setCacheMissing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [questions, setQuestions] = useState<PdfQuestionSeed | null>(null);
  const [questionsSaved, setQuestionsSaved] = useState(false);
  const [questionsLeftOut, setQuestionsLeftOut] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const pending = useRef<StudySetSaveOperation | null>(null);
  const operationId = useRef<string | null>(null);
  const expected = useRef<StoredSetRow | null>(null);
  const busy = useRef(false);
  const epoch = useRef(0);
  const desktop = isTauri();
  const pendingAck = useRef<{ id: string; runId?: string } | null>(null);
  const [pendingAckId, setPendingAckId] = useState<string | null>(null);

  const flushAck = useCallback(async () => {
    if (!pendingAck.current) return;
    const { id, runId } = pendingAck.current;
    const ok = await acknowledgeJob(id, runId);
    if (ok) {
      pendingAck.current = null;
      setPendingAckId(null);
      setJob(null);
      setResume(null);
    }
  }, []);

  useEffect(() => {
    if (!pendingAckId) return;
    const timer = setInterval(() => void flushAck(), 200);
    return () => clearInterval(timer);
  }, [pendingAckId, flushAck]);

  const showJobs = useCallback((jobs: KitJob[], preferredId?: string) => {
    const same = jobs.filter(j => j.materialId === material.id).sort((a, b) => b.createdAt - a.createdAt)[0];
    setResume(same?.id ?? null);
    setResumeStage(same?.stage ?? null);
    // Only running jobs block another PDF, unless a refusal names a live worker.
    const others = jobs.filter(j => j.materialId !== material.id && (j.stage === "running" || j.id === preferredId))
      .sort((a, b) => Number(b.id === preferredId) - Number(a.id === preferredId) || Number(b.stage === "running") - Number(a.stage === "running") || b.createdAt - a.createdAt);
    setOtherKit(others[0] ?? null);
  }, [material.id]);

  useEffect(() => {
    let live = true;
    const mine = epoch.current;
    if (desktop) {
      void listPdfStudyKitJobs().then(jobs => {
        if (live && epoch.current === mine) showJobs(jobs);
      }).catch(() => {
        if (live) setError("Your earlier kit couldn’t be checked. Try again.");
      });
    }
    return () => { live = false; epoch.current++; };
  }, [desktop, showJobs]);

  function remember(
    next: KitReviewItem[],
    operation: StudySetSaveOperation | null,
    done = saved,
    qSaved = questionsSaved,
    qLeftOut = questionsLeftOut,
  ) {
    if (!draft) return;
    try {
      localStorage.setItem(
        mirrorKey(draft.runId),
        JSON.stringify({
          items: next,
          pending: operation,
          saved: done,
          operationId: operationId.current,
          questionsSaved: qSaved,
          questionsLeftOut: qLeftOut,
        }),
      );
    } catch {
      setError("Draft recovery is unavailable. Keep this window open until your kit is saved.");
    }
  }

  const checkRelease = async (
    jobId: string,
    runId: string,
    itemsState: KitReviewItem[],
    isStudySaved: boolean,
    isQuestionsSaved: boolean,
    isQuestionsLeftOut: boolean,
    currentDraft?: PdfStudyKitDraft | null,
  ) => {
    const kitDraft = currentDraft ?? draft;
    const numQuestions = kitDraft ? kitCandidates(kitDraft).questions.length : 0;
    const questionsDone = numQuestions === 0 || isQuestionsSaved || isQuestionsLeftOut;
    const keptCount = itemsState.filter(i => i.kept).length;
    const studyDone = isStudySaved || keptCount === 0;
    if (studyDone && questionsDone) {
      pendingAck.current = { id: jobId, runId };
      setPendingAckId(jobId);
      await flushAck();
    }
  };

  const fail = (failure: unknown) => {
    const code = codeOf(failure);

    if (code === "EXTRACTION_UNAVAILABLE") {
      setExtractionUnavailable(true);
      setCacheMissing(false);
      setError(EXTRACTION_UNAVAILABLE);
    } else if (code === "SOURCE_CHANGED") {
      setChanged(true);
      setError(SOURCE_CHANGED);
    } else if (code === "CACHE_MISSING") {
      setCacheMissing(true);
      setError("Your PDF’s text needs reading first. Read it on this Mac, then try again.");
    } else if (code === "KIT_EXISTS_SAME" || code === "KIT_IN_PROGRESS_OTHER") {
      const blocker = failure as { jobId?: string; materialId?: string };
      if (blocker.jobId && blocker.materialId) {
        if (blocker.materialId === material.id) {
          setResume(blocker.jobId);
          setResumeStage(null);
        } else {
          setOtherKit({ id: blocker.jobId, materialId: blocker.materialId, stage: "running", createdAt: 0 });
        }
      }
      setError(code === "KIT_EXISTS_SAME"
        ? "Your earlier kit is still here. Continue reviewing it, or discard it when you’re ready."
        : "Open your earlier PDF to continue, or discard its unsaved kit here.");
      const mine = epoch.current;
      void listPdfStudyKitJobs().then(jobs => {
        if (epoch.current === mine && jobs.some(j => j.id === blocker.jobId)) showJobs(jobs, blocker.jobId);
      }).catch(() => { /* The structured refusal keeps the actions available. */ });
    } else if (code === "JOURNAL_FULL") {
      setError("Your draft space is full. Save or discard a waiting study aid or practice test, then try again.");
    } else if (code === "JOURNAL_RECOVERY") {
      setError("Your drafts need recovery before a new kit can begin. Quit and reopen Her Flight Deck, then try again.");
    } else {
      setError("Your PDF kit couldn’t be opened. Your saved work is still here; try again.");
    }
  };

  const start = async () => {
    if (busy.current) return;
    busy.current = true;
    const mine = ++epoch.current;
    setRunning(true);
    setError(null);
    setChanged(false);
    setCacheMissing(false);
    setOpen(false);
    setQuestions(null);
    setSaved(false);
    setQuestionsSaved(false);
    setQuestionsLeftOut(false);
    try {
      const id = await preparePdfStudyKit(material.id);
      if (epoch.current === mine) {
        setJob(id);
        setResume(id);
        setResumeStage("running");
      }
    } catch (e) {
      if (epoch.current === mine) {
        setRunning(false);
        fail(e);
      }
    } finally {
      if (epoch.current === mine) busy.current = false;
    }
  };

  useEffect(() => {
    if (!job || !running) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await getPdfStudyKit(job);
        const stored = await repositories!.documents.readStoredStudySet(material.id);
        if (!live) return;
        let mirror: Mirror | null = null;
        try {
          mirror = JSON.parse(localStorage.getItem(mirrorKey(next.runId)) ?? "null");
        } catch { /* Journal remains authoritative. */ }
        const initial = kitReviewItems(next);
        const reviewed = initial.map(i => {
          const m = mirror?.items?.find(m => m.id === i.id && m.kind === i.kind);
          return m && m.fields?.length === 2 && m.fields.every(f => typeof f === "string")
            ? { ...i, fields: m.fields, kept: m.kept === true, instructor: m.instructor === true }
            : i;
        });
        expected.current = stored;
        pending.current = mirror?.pending ?? null;
        operationId.current = mirror?.operationId ?? next.editorOperationId;
        const isSaved = mirror?.saved === true;
        const isQSaved = mirror?.questionsSaved === true;
        const isQLeftOut = mirror?.questionsLeftOut === true;
        setDraft(next);
        setItems(reviewed);
        setSaved(isSaved);
        setQuestionsSaved(isQSaved);
        setQuestionsLeftOut(isQLeftOut);
        setRunning(false);
        setOpen(true);
        setError(null);
        try {
          localStorage.setItem(
            mirrorKey(next.runId),
            JSON.stringify({
              items: reviewed,
              pending: mirror?.pending ?? null,
              saved: isSaved,
              operationId: operationId.current,
              questionsSaved: isQSaved,
              questionsLeftOut: isQLeftOut,
            }),
          );
        } catch {}
      } catch (e) {
        if (!live) return;
        if (codeOf(e) === "DRAFT_NOT_READY") {
          timer = setTimeout(() => void poll(), 500);
        } else {
          setRunning(false);
          fail(e);
        }
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [job, running, repositories, material.id]);

  const cancel = async () => {
    if (!job || busy.current) return;
    busy.current = true;
    try {
      const outcome = await cancelGeminiJob({ jobId: job });
      if (outcome.cancelled) {
        epoch.current++;
        setRunning(false);
        setResume(null);
        setError("Stopped. Your saved work is still here.");
      } else {
        setRunning(false);
        setResume(job);
        setError("This kit has finished. You can continue reviewing it.");
      }
    } catch {
      setError("The kit couldn’t be stopped. Try Cancel again.");
    } finally {
      busy.current = false;
    }
  };

  const discardKit = async () => {
    if (busy.current) return;
    busy.current = true;
    setConfirmDiscard(false);
    try {
      const other = confirmOther;
      setConfirmOther(null);
      let activeJobId = other?.id ?? (job || resume);
      if (!activeJobId) {
        const jobs = await listPdfStudyKitJobs();
        activeJobId = jobs.filter(j => j.materialId === material.id).sort((a, b) => b.createdAt - a.createdAt)[0]?.id ?? null;
      }
      if (activeJobId) {
        const outcome = await cancelGeminiJob({ jobId: activeJobId });
        if (!outcome.cancelled && (outcome.stage === "running" || outcome.stage === null)) {
          setError("Your study kit couldn’t be discarded. Try again.");
          return;
        }
      }
      if (activeJobId && !await acknowledgeJob(activeJobId, other ? other.runId : draft?.runId)) {
        setError("Your study kit couldn’t be discarded. Try again.");
        return;
      }
      if (other) {
        setOtherKit(null);
        setError(null);
        return;
      }
      if (draft) clearKitMirrors(draft.runId);
      epoch.current++;
      pendingAck.current = null;
      setPendingAckId(null);
      pending.current = null;
      operationId.current = null;
      expected.current = null;
      setJob(null);
      setResume(null);
      setDraft(null);
      setItems([]);
      setOpen(false);
      setRunning(false);
      setChanged(false);
      setCacheMissing(false);
      setError(null);
      setSaved(false);
      setQuestions(null);
      setQuestionsSaved(false);
      setQuestionsLeftOut(false);
    } catch {
      setError("Your study kit couldn’t be discarded. Try again.");
    } finally {
      busy.current = false;
    }
  };

  const rebuild = async () => {
    if (busy.current) return;
    let activeJobId = job || resume;
    if (!activeJobId) {
      try {
        const jobs = await listPdfStudyKitJobs();
        activeJobId = jobs.filter(j => j.materialId === material.id && j.stage !== "cancelled").sort((a, b) => b.createdAt - a.createdAt)[0]?.id ?? null;
      } catch {}
    }
    if (activeJobId) {
      let discarded = false;
      try {
        discarded = await acknowledgeGeminiJob(activeJobId);
        if (!discarded) {
          const remaining = await listPdfStudyKitJobs();
          if (!remaining.some(j => j.id === activeJobId)) {
            discarded = true;
          }
        }
      } catch {
        discarded = false;
      }
      if (!discarded) {
        setError("Your earlier kit couldn’t be discarded. Try rebuilding again.");
        return;
      }
      if (draft) clearKitMirrors(draft.runId);
      setJob(null);
      setResume(null);
      setDraft(null);
      setChanged(false);
    }
    await start();
  };

  const update = (id: string, patch: Partial<KitReviewItem>) => {
    const next = items.map(i => i.id === id ? { ...i, ...patch } : i);
    if (pending.current) operationId.current = crypto.randomUUID();
    pending.current = null;
    setItems(next);
    setSaved(false);
    remember(next, null, false);
  };

  const leaveQuestionsOut = async () => {
    setQuestionsLeftOut(true);
    remember(items, pending.current, saved, questionsSaved, true);
    setOpen(false);
    const activeJobId = job || resume;
    if (activeJobId && draft) {
      await checkRelease(activeJobId, draft.runId, items, saved, questionsSaved, true, draft);
    }
  };

  const handleQuestionsSaved = async () => {
    setQuestionsSaved(true);
    remember(items, pending.current, saved, true, questionsLeftOut);
    setOpen(false);
    const activeJobId = job || resume;
    if (activeJobId && draft) {
      await checkRelease(activeJobId, draft.runId, items, saved, true, questionsLeftOut, draft);
    }
  };

  const save = async () => {
    if (!draft || busy.current || !items.some(i => i.kept) || changed) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      if (!pending.current) {
        const sections = items.filter(i => i.kept && i.kind === "section").map(i => ({
          itemId: i.id,
          heading: i.fields[0]!,
          body: i.fields[1]!,
          ...(kitEditOrigin(draft, i) ? { origin: kitEditOrigin(draft, i) } : {}),
        }));
        const flashcards = items.filter(i => i.kept && i.kind === "card").map(i => ({
          itemId: i.id,
          front: i.fields[0]!,
          back: i.fields[1]!,
          sourcePage: kitItemEvidence(draft, i)[0]!.page,
          ...(kitEditOrigin(draft, i) ? { origin: kitEditOrigin(draft, i) } : {}),
        }));
        const current = expected.current;
        const next = validateNextSet({
          title: current?.title ?? material.title,
          summary: current?.summary ?? "",
          summaryOrigin: current?.summary_origin ?? null,
          sections: [...(current ? JSON.parse(current.sections_json) : []), ...sections],
          flashcards: [...(current ? JSON.parse(current.flashcards_json) : []), ...flashcards],
          sourceNotes: current?.source_notes ?? "",
          provider: current?.provider ?? "manual",
          model: current?.model ?? "",
          retired: current ? JSON.parse(current.retired_json) : [],
        });
        const pdfKitSources = await kitSources(draft, items.filter(i => i.kept).map(i => ({
          kind: i.kind,
          id: i.id,
          content: (i.kind === "section" ? sections : flashcards).find(s => s.itemId === i.id)! as unknown as Record<string, unknown>,
          evidence: kitItemEvidence(draft, i),
        })));
        pending.current = {
          operationId: operationId.current ?? draft.editorOperationId,
          materialId: material.id,
          reason: current ? "edit" : "create",
          expected: current,
          next,
          pdfKitSources,
        };
        remember(items, pending.current);
      }
      const operation = pending.current;
      const result = await mutate(async repos => {
        try {
          await repos.documents.saveStudySet(operation);
          return { ok: true as const };
        } catch (failure) {
          return { ok: false as const, failure };
        }
      });
      if (result?.ok) {
        setSaved(true);
        remember(items, operation, true);
        const questionsComplete = !hasQuestions || questionsSaved || questionsLeftOut;
        if (questionsComplete) {
          setOpen(false);
        }
        setError("Study kit saved.");
        const activeJobId = job || resume;
        if (activeJobId) {
          await checkRelease(activeJobId, draft.runId, items, true, questionsSaved, questionsLeftOut, draft);
        }
      } else if (result && codeOf(result.failure) === "SOURCE_CHANGED") {
        fail(result.failure);
      } else {
        setError("Your kit couldn’t be saved. Your draft is still here; try saving again.");
      }
    } catch {
      setError("Your kit couldn’t be saved. Your draft is still here; try saving again.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const hasStudyItems = items.length > 0;
  const hasQuestions = Boolean(draft && kitCandidates(draft).questions.length > 0);
  // Ambiguous pages contained text too; missing counts do not prove no text.
  const noUsableText = draft && kitHasNoUsableText(draft);

  const otherTitle = data.materials.find(m => m.id === otherKit?.materialId)?.title;

  return (
    <Card>
      <CardHeader title="A study kit from your PDF" eyebrow="On this Mac" />
      <CardBody>
        <div className="stack stack--3">
          {!extractionUnavailable ? <Button
            disabled={!desktop || running || saving || changed}
            onClick={() => {
              if (changed) return;
              if (resume && resumeStage !== "cancelled") {
                setJob(resume);
                setRunning(true);
              } else {
                void start();
              }
            }}
          >
            Make a study kit from this PDF
          </Button> : null}
          {!desktop ? <p className="tiny muted">Making a PDF study kit works in the desktop app.</p> : null}
          {resume && !running && !open && !changed ? (
            <Button onClick={() => { setJob(resume); setRunning(true); }}>
              Continue reviewing your study kit
            </Button>
          ) : null}
          {(job || resume || changed) && !open && !running ? (
            <Button variant="danger" disabled={saving} onClick={() => setConfirmDiscard(true)}>
              Discard this kit
            </Button>
          ) : null}
          {otherKit && !open ? (
            <div className="stack stack--3">
              <p>{otherTitle
                ? `You have a study kit waiting for “${otherTitle}”.`
                : "You have a study kit waiting for another PDF."}</p>
              <Link className="button button--secondary" to={`/study/${encodeURIComponent(otherKit.materialId)}`}>
                Open that PDF in the Study Library
              </Link>
              <Button variant="danger" disabled={saving || running} onClick={() => { setConfirmOther(otherKit); setConfirmDiscard(true); }}>
                Discard that kit
              </Button>
            </div>
          ) : null}
          {running ? (
            <div role="status">
              <p>Pulling study ideas from your PDF…</p>
              <Button disabled={!job} onClick={() => void cancel()}>Cancel</Button>
            </div>
          ) : null}
          {error && !open ? <p role="status">{error}</p> : null}
          {cacheMissing ? (
            <>
              <Button
                disabled={extracting}
                onClick={async () => {
                  setExtracting(true);
                  try {
                    await prepareOfflineContent(material.id);
                    setError("Reading your PDF’s text. Try making the kit again when it’s ready.");
                  } catch (failure) {
                    if (codeOf(failure) === "offline_extraction_disabled" || failure === "offline_extraction_disabled" || (failure instanceof Error && failure.message === "offline_extraction_disabled")) {
                      setExtractionUnavailable(true);
                      setCacheMissing(false);
                      setError(EXTRACTION_UNAVAILABLE);
                    } else {
                      setError("Your PDF’s text couldn’t be read. Try again.");
                    }
                  } finally {
                    setExtracting(false);
                  }
                }}
              >
                Read this PDF’s text
              </Button>
              <Button disabled={extracting} onClick={() => void start()}>
                Try making the kit again
              </Button>
            </>
          ) : null}
          {changed && !open ? (
            <Button disabled={saving} onClick={() => void rebuild()}>
              Rebuild study kit
            </Button>
          ) : null}
          <Dialog
            open={open && !questions}
            title="Review your PDF study kit"
            onClose={() => { if (!busy.current) setOpen(false); }}
            dismissible={!saving}
            footer={
              <>
                <Button disabled={saving} onClick={() => setOpen(false)}>Close</Button>
                <Button variant="danger" disabled={saving} onClick={() => setConfirmDiscard(true)}>
                  Discard this kit
                </Button>
                {hasQuestions ? (
                  <Button disabled={saving || changed} onClick={() => setQuestions(kitQuestionSeed(draft!))}>
                    Review draft questions
                  </Button>
                ) : null}
                {hasQuestions && !questionsSaved && !questionsLeftOut ? (
                  <Button disabled={saving || changed} onClick={() => void leaveQuestionsOut()}>
                    Leave questions out
                  </Button>
                ) : null}
                {hasStudyItems ? (
                  <Button
                    disabled={saving || saved || changed || !items.some(i => i.kept)}
                    onClick={() => void save()}
                  >
                    Save to study set
                  </Button>
                ) : null}
              </>
            }
          >
            <div className="stack stack--4">
              <p className="tiny muted">{PDF_KIT_REMINDER}</p>
              {!hasStudyItems && !hasQuestions ? <p>{noUsableText
                ? "This PDF didn’t have text the kit could use."
                : "The kit couldn’t find definitions or key terms on these pages yet."}</p> : null}
              {items.map((item, index) => {
                const at = items.slice(0, index + 1).filter(i => i.kind === item.kind).length;
                const noun = item.kind === "section" ? "section" : "card";
                const origin = draft ? kitEditOrigin(draft, item) : undefined;
                return (
                  <fieldset
                    key={item.id}
                    disabled={saving || saved}
                    className="stack stack--2"
                    style={{ minWidth: 0 }}
                  >
                    <legend>
                      {item.kind === "section" ? "Summary / outline" : "Glossary / cloze"} {at}
                    </legend>
                    <Checkbox
                      label={`Keep ${noun} ${at}`}
                      checked={item.kept}
                      strikethrough={false}
                      onChange={kept => update(item.id, { kept })}
                    />
                    <PdfItemLabel
                      provenance={{ status: "valid", label: "Pulled from your PDF on this Mac", sources: [] }}
                      origin={origin}
                    />
                    {draft ? [...new Set(kitItemEvidence(draft, item).map(e => e.page))].map(page => (
                      <PdfKitPageLink
                        key={page}
                        materialId={material.id}
                        hash={draft.identity.contentSha256}
                        page={page}
                      />
                    )) : null}
                    {item.fields.map((value, i) => (
                      <Field
                        key={i}
                        label={`${item.kind === "section" ? "Section" : "Card"} ${at} ${item.kind === "section" ? i === 0 ? "heading" : "text" : i === 0 ? "question" : "answer"}`}
                      >
                        <TextArea
                          rows={3}
                          maxLength={item.kind === "section" ? i === 0 ? 200 : 20_000 : i === 0 ? 1_000 : 2_000}
                          value={value}
                          onChange={e => update(item.id, { fields: item.fields.map((f, atIndex) => atIndex === i ? e.target.value : f) })}
                        />
                      </Field>
                    ))}
                    <Checkbox
                      label={`My instructor corrected ${noun} ${at}`}
                      checked={item.instructor}
                      strikethrough={false}
                      onChange={instructor => update(item.id, { instructor })}
                    />
                  </fieldset>
                );
              })}
              {error && open ? <p role="alert">{error}</p> : null}
              {changed ? (
                <Button onClick={() => void rebuild()}>Rebuild study kit</Button>
              ) : null}
            </div>
          </Dialog>
          <ConfirmDialog
            open={confirmDiscard}
            title="Discard this study kit?"
            message="Discard the unsaved kit and keep your saved study set and questions."
            confirmLabel="Discard kit"
            destructive
            onCancel={() => { setConfirmDiscard(false); setConfirmOther(null); }}
            onConfirm={() => void discardKit()}
          />
          {questions ? (
            <PdfPracticeQuestions
              material={material}
              seed={questions}
              onClose={() => setQuestions(null)}
              onSaved={() => void handleQuestionsSaved()}
              onLeaveOut={() => void leaveQuestionsOut()}
              onSourceChanged={() => {
                setQuestions(null);
                fail({ code: "SOURCE_CHANGED" });
              }}
            />
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

/** Physical PDF indices, through the same hash check and viewer controller as search. */
export function PdfKitPageLink({ materialId, hash, page }: { materialId: string; hash: string; page: number }) {
  const { controller } = useNavigationController();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lease = useRef(0);
  const started = useRef<number | null>(null);
  useEffect(() => () => {
    lease.current++;
    if (started.current !== null && controller?.status().kind === "working" && controller.status().epoch === started.current) {
      controller.abort();
    }
  }, [controller, materialId, hash, page]);
  return (
    <span>
      <Button
        size="small"
        variant="secondary"
        disabled={busy}
        aria-label={`Open PDF page ${page}`}
        onClick={async () => {
          const mine = ++lease.current;
          setBusy(true);
          try {
            const check = await verifyOfflineDestination(materialId, hash);
            if (mine !== lease.current) return;
            if (check !== "ok") {
              setNote("This PDF changed or is unavailable. Reopen the kit before following this page.");
              return;
            }
            if (!controller) {
              setNote("Opening PDF pages works in the desktop app.");
              return;
            }
            const pending = controller.request({ materialId, reference: page, provenance: "physical_index" });
            started.current = controller.status().epoch;
            const outcome = await pending;
            if (mine === lease.current) {
              started.current = null;
              setNote(
                outcome?.kind === "saved"
                  ? `Opened in your PDF reader. Go to PDF page ${page} there.`
                  : outcome && "message" in outcome
                    ? outcome.message
                    : "This page couldn’t be opened. Try again.",
              );
            }
          } catch {
            if (mine === lease.current) setNote("This page couldn’t be opened. Try again.");
          } finally {
            if (mine === lease.current) setBusy(false);
          }
        }}
      >
        Page {page}
      </Button>
      {note ? <span role="status" className="tiny muted">{note}</span> : null}
    </span>
  );
}
