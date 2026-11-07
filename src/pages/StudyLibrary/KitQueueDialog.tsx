import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Button, Dialog } from "@/components/ui";
import { PROVIDER_TERMS, providerTermsNote } from "@/logic/providerTerms";
import { getGeminiStatus } from "@/services/gemini";
import { providerCompany } from "@/services/provider";
import { previewStudyPageSource } from "@/services/studyPageSources";
import { useAppData } from "@/state/AppDataContext";
import { useOptionalKitQueue, type KitQueueValue } from "@/state/KitQueue";
import { KIT_QUEUE_TEXT as TEXT, nextWaiting, summarize, type Consent, type Queue } from "@/state/kitQueueLogic";

/** What the provider keeps, in plain words, for the company that would receive the chapters. */
export function retentionNote(company: string): string {
  return company === "Anthropic"
    ? `${PROVIDER_TERMS.claude.privacy} ${providerTermsNote("claude")}`
    : `${PROVIDER_TERMS.gemini.fileCopy} ${PROVIDER_TERMS.gemini.freeTier} ${providerTermsNote("gemini")}`;
}

interface Prepared {
  company: string;
  chapters: { materialId: string; sourceSha256: string; pages: number }[];
  missing: string[];
}

/** One screen to choose and agree, then one progress line with Stop. */
export function KitQueueDialog() {
  const kit = useOptionalKitQueue();
  // The shell also renders without the data providers (tests, early start).
  return kit ? <KitQueueDialogBody kit={kit} /> : null;
}

function KitQueueDialogBody({ kit }: { kit: KitQueueValue }) {
  const { data } = useAppData();
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [startedHere, setStartedHere] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const open = kit.offered !== null;
  const title = (id: string) => data.materials.find((m) => m.id === id)?.title ?? "A chapter";

  useEffect(() => {
    if (!open) return;
    setTicked(Object.fromEntries((kit.offered ?? []).map((id) => [id, true])));
    setPrepared(null);
    setStartedHere(false);
    setProblem(null);
    // Only when the picker opens; the list does not change under the student.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const queue = kit.queue;
  const queueOpen = Boolean(queue && (queue.state === "active" || queue.state === "paused"));
  const showQueue = Boolean(queue && (queueOpen || startedHere));
  const chosen = useMemo(() => (kit.offered ?? []).filter((id) => ticked[id]), [kit.offered, ticked]);

  // After a provider change the queue waits for a new yes; the new provider is named first.
  const needsNewConsent = Boolean(queue && queue.state === "paused" && queue.consentAt === null);
  useEffect(() => {
    if (!needsNewConsent) return;
    let cancelled = false;
    void getGeminiStatus().then((status) => { if (!cancelled) setCompany(providerCompany(status.model)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [needsNewConsent]);

  const review = async () => {
    setWorking(true);
    setProblem(null);
    try {
      const company = providerCompany((await getGeminiStatus()).model);
      const chapters: Prepared["chapters"] = [];
      const missing: string[] = [];
      for (const id of chosen) {
        let preview: Awaited<ReturnType<typeof previewStudyPageSource>> = null;
        try { preview = await previewStudyPageSource(id); } catch { preview = null; }
        if (preview) chapters.push({ materialId: id, sourceSha256: preview.contentSha256, pages: preview.totalPages });
        else missing.push(id);
      }
      setPrepared({ company, chapters, missing });
    } catch {
      setProblem("Your provider could not be checked. Try again.");
    } finally { setWorking(false); }
  };

  const confirm = async () => {
    if (!prepared) return;
    const agreed: Consent = { provider: prepared.company, materialIds: prepared.chapters.map((c) => c.materialId) };
    setWorking(true);
    try {
      const result = await kit.begin(prepared.chapters, agreed);
      if (result.ok) setStartedHere(true);
      else if (result.reason === "consent") { setProblem(TEXT.consentStale); setPrepared(null); }
      else if (result.reason === "already") setProblem("Study kits are already being made. Wait for them to finish.");
    } finally { setWorking(false); }
  };

  const preparedIds = prepared?.chapters.map((c) => c.materialId) ?? [];
  const totalPages = prepared?.chapters.reduce((sum, c) => sum + c.pages, 0) ?? 0;
  const pickerChanged = prepared !== null && (preparedIds.length !== chosen.length || preparedIds.some((id) => !chosen.includes(id)));
  const canConfirm = Boolean(prepared) && !pickerChanged && prepared!.chapters.length > 0 && !working;

  let footer;
  let body;
  if (showQueue && queue) {
    ({ body, footer } = queueView(queue, kit.message, title, kit, () => kit.hide(), company));
  } else if (queueOpen) {
    body = <p>Study kits are already being made.</p>;
    footer = <Button onClick={() => kit.hide()}>Close</Button>;
  } else if (!prepared) {
    body = (
      <div className="stack stack--2">
        <p className="muted">Pick the chapters to make study kits for. Each kit is made one at a time.</p>
        <ul className="stack stack--1" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {(kit.offered ?? []).map((id) => (
            <li key={id}>
              <label className="row">
                <input type="checkbox" checked={Boolean(ticked[id])} disabled={working} onChange={(e) => setTicked((t) => ({ ...t, [id]: e.target.checked }))} />
                <span>{title(id)}</span>
              </label>
            </li>
          ))}
        </ul>
        {problem ? <p className="field__error" role="alert">{problem}</p> : null}
      </div>
    );
    footer = (
      <>
        <Button variant="ghost" onClick={() => kit.hide()}>Cancel</Button>
        <Button variant="primary" disabled={chosen.length === 0 || working} onClick={() => void review()}>Next</Button>
      </>
    );
  } else {
    body = (
      <div className="stack stack--2">
        <p className="muted">These chapters will be sent to {prepared.company}, one at a time:</p>
        <ul className="stack stack--1">
          {prepared.chapters.map((c) => <li key={c.materialId}>{title(c.materialId)} ({c.pages} pages)</li>)}
        </ul>
        <p className="small strong">{prepared.chapters.length} chapters, {totalPages} pages in all.</p>
        <p className="small">{TEXT.billed(prepared.company)}</p>
        <details className="tiny dim">
          <summary>What the provider keeps</summary>
          <p>{retentionNote(prepared.company)}</p>
        </details>
        {prepared.missing.length > 0 ? <p className="small" role="status">{prepared.missing.map(title).join(", ")} could not be read and will be left out.</p> : null}
        {pickerChanged ? <p className="small" role="status">{TEXT.consentStale}</p> : null}
        {problem ? <p className="field__error" role="alert">{problem}</p> : null}
      </div>
    );
    footer = (
      <>
        <Button variant="ghost" onClick={() => setPrepared(null)} disabled={working}>Back</Button>
        <Button variant="primary" disabled={!canConfirm} onClick={() => void confirm()}>Make my study kits</Button>
      </>
    );
  }

  return (
    <Dialog open={open} onClose={() => kit.hide()} title={showQueue ? "Study kits" : TEXT.consentTitle} narrow footer={footer}>
      {body}
    </Dialog>
  );
}

function queueView(queue: Queue, message: string | null, title: (id: string) => string, kit: KitQueueValue, close: () => void, company: string | null) {
  const summary = summarize(queue);
  const running = queue.items.find((i) => i.status === "running");
  const total = queue.items.length;
  const current = running ?? nextWaiting(queue);
  const index = current ? current.position + 1 : total;
  const finished = queue.state === "done" || queue.state === "stopped";
  const waitingIds = queue.items.filter((i) => i.status === "waiting").map((i) => i.materialId);
  const linkRow = (id: string, extra?: React.ReactNode) => (
    <li key={id}><Link to={`/study/${id}`} onClick={close}>{title(id)}</Link>{extra}</li>
  );
  const body = (
    <div className="stack stack--2">
      {queue.state === "active" && current ? <p role="status">{TEXT.progress(index, total, title(current.materialId))}</p> : null}
      {queue.state === "paused" && queue.consentAt === null ? <p role="status">{message}{company ? ` ${TEXT.billed(company)}` : ""}</p> : null}
      {queue.state === "paused" && queue.consentAt !== null ? <p role="status">{message ?? TEXT.restart}{summary.left > 0 ? ` (${summary.left} left)` : ""}</p> : null}
      {finished ? <p role="status">{queue.state === "stopped" ? TEXT.stopped : "All done."}</p> : null}
      {summary.made.length > 0 ? <><p className="small strong">Made</p><ul>{summary.made.map((i) => linkRow(i.materialId))}</ul></> : null}
      {summary.needsTry.length > 0 ? (
        <>
          <p className="small strong">{TEXT.needsTry}</p>
          <ul>{summary.needsTry.map((i) => linkRow(i.materialId, <> <Button onClick={() => kit.retry(i.position)}>Make again</Button></>))}</ul>
        </>
      ) : null}
      {summary.skipped.length > 0 ? <><p className="small strong">Skipped</p><ul>{summary.skipped.map((i) => linkRow(i.materialId, <span className="small muted"> {TEXT.skipped}</span>))}</ul></> : null}
    </div>
  );
  const footer = (
    <>
      {queue.state === "active" || queue.state === "paused" ? <Button variant="danger" onClick={() => kit.stop()}>Stop</Button> : null}
      {queue.state === "paused" && queue.consentAt !== null ? <Button variant="primary" onClick={() => kit.resume()}>{`Continue (${summary.left} left)`}</Button> : null}
      {queue.state === "paused" && queue.consentAt === null ? (
        <Button variant="primary" disabled={!company} onClick={() => company && kit.confirmAgain({ provider: company, materialIds: waitingIds })}>Confirm again</Button>
      ) : null}
      <Button onClick={close}>{finished ? "Close" : "Hide"}</Button>
    </>
  );
  return { body, footer };
}
