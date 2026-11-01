import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Button, Dialog, Field, Select, TextInput } from "@/components/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "@/data";
import type { FaaDownloadRecord } from "@/data/repositories/faaDownloadRepository";
import {
  listFaaDownloads, downloadFaaHandbook, faaDownloadProgress, cancelFaaDownload, faaFailure,
  type FaaDownloadEntry, type FaaDownloadProgress, type FaaDownloaded,
} from "@/services/faaDownloads";
import type { StudyMaterial } from "@/domain/types";
import { newId } from "@/lib/id";
import {
  FAA_REFERENCES,
  faaAvailability,
  faaEditionMessage,
  faaReferenceDraft,
  faaShelfCopies,
  type FaaAvailability,
  type FaaReference,
  type FaaReferenceNote,
} from "@/logic/faaReferences";
import {
  canHandleFiles,
  cleanupDocuments,
  documentExists,
  openDocument,
  pickAndImportDocument,
  type ImportedDocument,
} from "@/services/documents";
import { previewStudyPageSource } from "@/services/studyPageSources";
import { useAppData } from "@/state/AppDataContext";

import { SplitPdfDialog } from "./SplitPdfDialog";

export function FaaReferences({ onAddPdf }: { onAddPdf?: () => void }) {
  const { data, mutate } = useAppData();
  const [adding, setAdding] = useState<FaaReference | null>(null);

  const entry = (reference: FaaReference) => {
    const copies = faaShelfCopies(data.materials, reference);
    return (
    <div key={reference.id} className="faa-shelf__entry">
      <div className="row row--wrap">
        <h3 className="small">{reference.title}</h3>
        <Button onClick={() => setAdding(reference)} disabled={!canHandleFiles()}
          aria-label={`Add PDF: ${reference.title}`}>Add PDF</Button>
      </div>
      <details>
        <summary>Listed edition: {reference.edition}</summary>
        <p className="small muted">{reference.publication} · FAA</p>
        <p className="small wrap-anywhere">Official source: {reference.source}</p>
        <p className="small muted">Source list last checked: October 28, 2026. Newer editions may exist.</p>
      </details>
      {reference.id === "phak" ? <HandbookDownload phak /> : null}
      {copies.map(({ material, note }) => (
        <SavedReference key={material.id} material={material} note={note} reference={reference} />
      ))}
      {reference.id !== "phak" && copies.length === 0 ? <p className="small muted">Optional · No saved PDF</p> : null}
    </div>
    );
  };

  return (
    <section className="faa-shelf" aria-labelledby="faa-shelf-title">
      <h2 id="faa-shelf-title" className="section-title">FAA references</h2>
      <p className="small muted">Optional books for offline study. Add a PDF or get a handbook from faa.gov.</p>
      {!canHandleFiles() ? <p className="small muted">Adding, checking and opening PDFs needs the desktop application. Your saved reference notes are still available here.</p> : null}
      {canHandleFiles() ? <p className="small muted">Needs internet once; works offline afterwards.</p> : null}
      {entry(FAA_REFERENCES[0])}
      {entry(FAA_REFERENCES[1])}
      {entry(FAA_REFERENCES[2])}
      <HandbookDownload onAddPdf={onAddPdf} />
      <p className="small muted">Complete backups include these PDFs, notes and bookmarks. Large books make backups larger. Adding another copy keeps earlier editions.</p>
      {adding ? <AddReference reference={adding} onClose={() => setAdding(null)} onSave={async (draft) => {
        const saved = await mutate((repos) => repos.documents.create(draft));
        return saved !== null;
      }} /> : null}
    </section>
  );
}

const AFH_PAGE = "https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/airplane_handbook";
const DOWNLOAD_ERROR = "faa.gov didn't answer. Try again later, or add the PDF yourself.";

function HandbookDownload({ onAddPdf, phak = false }: { onAddPdf?: () => void; phak?: boolean }) {
  const { data, repositories, mutate } = useAppData();
  const desktop = canHandleFiles();
  const [splitting, setSplitting] = useState<StudyMaterial | null>(null);
  const [entries, setEntries] = useState<FaaDownloadEntry[]>([]);
  const [selected, setSelected] = useState("");
  const [records, setRecords] = useState<FaaDownloadRecord[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<FaaDownloadProgress | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const locked = useRef(false);
  const cancelled = useRef(false);
  const live = useRef(false);
  const saving = useRef(false);
  const pending = useRef<{ id: string; title: string; downloaded: FaaDownloaded } | null>(null);

  useEffect(() => {
    live.current = true;
    const connectivity = () => setOnline(navigator.onLine);
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    if (desktop) void listFaaDownloads().then((all) => {
      if (!live.current) return;
      const offered = all.filter((entry) => entry.offeredNow && (phak ? entry.id === "phak-25c-full" : entry.kind === "afhChapter" || entry.kind === "afhAddendum"));
      setEntries(offered);
      setSelected(offered.find((entry) => entry.id === "afh-3c-ch01")?.id ?? offered[0]?.id ?? "");
    }).catch(() => { if (live.current) setError(DOWNLOAD_ERROR); });
    return () => {
      live.current = false;
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
      if (locked.current && !pending.current) { cancelled.current = true; void cancelFaaDownload().catch(() => {}); }
      if (pending.current && !saving.current) {
        void cleanupDocuments([pending.current.downloaded.document.relativePath]);
        pending.current = null;
      }
    };
  }, [desktop, phak]);

  useEffect(() => {
    let active = true;
    if (repositories) void repositories.faaDownloads.list().then((rows) => {
      if (active) {
        const next = rows.filter((row) => phak ? row.documentId === "phak-25c-full" : row.documentId.startsWith("afh-"));
        setRecords((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
      }
    }).catch(() => { if (active) setError("Your saved copy details couldn't be loaded. Please try again."); });
    return () => { active = false; };
  }, [repositories, data.materials, phak]);

  useEffect(() => {
    if (!busy) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await faaDownloadProgress();
        if (active) setProgress(next);
      } catch { /* Download completion remains the source of truth. */ }
      if (active) timer = setTimeout(() => void poll(), 500);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [busy]);

  const save = async () => {
    const copy = pending.current;
    if (!copy) return;
    saving.current = true;
    const saved = await mutate((repos) => repos.faaDownloads.record({ materialId: copy.id, title: copy.title, downloaded: copy.downloaded }));
    saving.current = false;
    if (!saved) {
      if (!live.current) {
        await cleanupDocuments([copy.downloaded.document.relativePath]);
        pending.current = null;
      }
      if (live.current) setError("Your PDF couldn't be saved. Try Save downloaded PDF again.");
      return;
    }
    pending.current = null;
    if (live.current) {
      setRecords((rows) => [...rows.filter((row) => row.materialId !== saved.materialId), saved]);
      setMessage("Saved for offline study.");
    }
  };

  const selectedEntry = entries.find((entry) => entry.id === selected);
  const selectedRecords = records.filter((record) => record.documentId === selected
    && data.materials.some((material) => material.id === record.materialId));
  const alreadySaved = selectedRecords.length > 0;
  const selectedLabel = selectedEntry?.title.replace(/^Airplane Flying Handbook, chapter /, "Chapter ")
    ?? "chapter";

  const get = async () => {
    const entry = entries.find((item) => item.id === selected);
    if (locked.current || !desktop || !online || !entry || alreadySaved) return;
    locked.current = true;
    cancelled.current = false;
    setBusy(true); setCancelling(false); setProgress(null); setError(""); setMessage("");
    try {
      const id = newId();
      const downloaded = await downloadFaaHandbook(entry.id, id);
      if (cancelled.current || !live.current) {
        await cleanupDocuments([downloaded.document.relativePath]);
        if (live.current) setMessage("Download cancelled.");
        return;
      }
      pending.current = { id, title: entry.title, downloaded };
      await save();
    } catch (failure) {
      if (live.current) {
        if (faaFailure(failure).kind === "cancelled") setMessage("Download cancelled.");
        else setError(DOWNLOAD_ERROR);
      }
    } finally {
      locked.current = false;
      if (live.current) { setBusy(false); setCancelling(false); }
    }
  };

  const cancel = async () => {
    cancelled.current = true;
    setCancelling(true);
    try { await cancelFaaDownload(); }
    catch { if (live.current) { setCancelling(false); setError("The download couldn't be cancelled. Please try Cancel again."); } }
  };
  const retry = async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { await save(); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  const mb = (bytes: number) => Math.round(bytes / 1_048_576);

  return <div className={phak ? undefined : "faa-shelf__entry"}>
    {!phak ? <>
    <h3 className="small">Airplane Flying Handbook</h3>
    <p className="small muted">Choose a chapter or the MOSAIC addendum to keep for offline study.</p>
    </> : null}
    {desktop ? <>
      <div className="row row--wrap">
        {!phak ? <><Field label="Chapter or addendum">{({ id }) => <Select id={id} value={selected} disabled={busy || !!pending.current}
          onChange={(value) => { setSelected(value); setMessage(""); }} options={entries.map((entry) => ({ value: entry.id, label: entry.title }))} />}</Field>
        <Button onClick={onAddPdf} disabled={!onAddPdf}>Add PDF</Button></> : null}
        <Button onClick={() => void get()} disabled={busy || !online || !selected || !!pending.current || alreadySaved}>{busy ? "Downloading…" : alreadySaved ? "Already saved" : phak ? "Get full handbook from faa.gov (about 74 MB)" : "Get from faa.gov"}</Button>
        {busy && !pending.current ? <Button onClick={() => void cancel()} disabled={cancelling}>{cancelling ? "Cancelling…" : "Cancel"}</Button> : null}
        {pending.current ? <Button onClick={() => void retry()} disabled={busy}>Save downloaded PDF</Button> : null}
      </div>
      {busy && !pending.current ? <p className="small" role="status">Getting {selectedLabel} from faa.gov…{progress ? ` ${mb(progress.received)}${progress.total ? ` of ${mb(progress.total)}` : ""} MB` : ""}</p> : null}
    </> : null}
    {phak && !selectedRecords.length && !faaShelfCopies(data.materials, FAA_REFERENCES[1]).length ? <p className="small muted">Optional · No saved PDF</p> : null}
    {message ? <p className="small" role="status">{message}</p> : null}
    {error ? <p className="small" role="alert">{error}</p> : null}
    {selectedRecords.map((record) => {
      const material = data.materials.find((item) => item.id === record.materialId);
      if (!material) return null;
      return <div key={record.materialId} className="stack stack--4">
        <h4 className="small">{material.title}</h4>
        <p className="small">Saved for offline study</p>
        <p className="small wrap-anywhere">{record.edition} · {phak ? "2023" : record.documentId === "afh-addendum-mosaic" ? "October 2025" : "2021"} · from www.faa.gov on {record.downloadedAt.slice(0, 10)} · SHA-256 {record.contentSha256}</p>
        <SavedReference material={material} downloaded reference={{ title: phak ? "Pilot’s Handbook of Aeronautical Knowledge" : "Airplane Flying Handbook", edition: record.edition }}
          note={{ edition: record.edition, contentSha256: record.contentSha256 }} />
        {phak && desktop ? data.materials.some((part) => part.lineage?.rootMaterialId === material.id || part.lineage?.parentMaterialId === material.id)
          ? <Button disabled>Study-size parts made</Button>
          : <Button onClick={() => setSplitting(material)}>Make study-size parts</Button> : null}
        {!phak ? <CurrentAfhLink /> : null}
      </div>;
    })}
    {!phak && !selectedRecords.length ? <CurrentAfhLink /> : null}
    {splitting ? <SplitPdfDialog open material={splitting} onClose={() => setSplitting(null)} onCreated={(ids) => { setMessage(`Made ${ids.length} parts. Find them in your Study Library.`); setSplitting(null); }} /> : null}
  </div>;
}

function CurrentAfhLink() {
  const [error, setError] = useState(false);
  return <>
    <a href={AFH_PAGE} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}
      onClick={(event) => {
        if (!isTauri()) return;
        event.preventDefault(); setError(false);
        void openUrl(AFH_PAGE).catch(() => setError(true));
      }}>Check the current FAA version</a>
    {error ? <p role="alert">That link couldn't be opened. Please try again.</p> : null}
  </>;
}

const AVAILABILITY: Record<FaaAvailability, string> = {
  checking: "Checking saved PDF…",
  present: "Saved on this Mac",
  missing: "File missing. Add it again when you're ready.",
  changed: "This file has changed since you added it.",
  unknown: "Availability could not be checked. Try again in the desktop application.",
  browser: "Availability needs the desktop application",
};

function SavedReference({ material, note, reference, downloaded = false }: {
  downloaded?: boolean;
  material: StudyMaterial;
  note: Pick<FaaReferenceNote, "edition" | "contentSha256"> & { totalPages?: number };
  reference: { title: string; edition: string };
}) {
  const [state, setState] = useState<{ key: string; availability: FaaAvailability } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify([material.id, material.filePath, note, downloaded]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const action = useRef(false);
  const live = useRef(false);
  const desktop = canHandleFiles();
  const availability = !desktop ? "browser" : state?.key === key ? state.availability : "checking";

  // Download receipts already identify the stored bytes. Counting every page of
  // a large book here (and again on Open) needlessly parses the whole PDF.
  const check = async (): Promise<FaaAvailability> => {
    if (!material.filePath) return "missing";
    if (downloaded && /^[a-f0-9]{64}$/.test(note.contentSha256)) {
      return await documentExists(material.filePath) ? "present" : "missing";
    }
    return faaAvailability(note, await previewStudyPageSource(material.id));
  };

  useEffect(() => {
    live.current = true;
    let active = true;
    setMessage("");
    if (desktop) {
      void check()
        .then((availability) => {
          if (active) setState({ key, availability });
        })
        .catch(() => { if (active) setState({ key, availability: "unknown" }); });
    }
    return () => { active = false; live.current = false; };
  }, [key, desktop]);

  const open = async () => {
    if (!desktop || action.current || !material.filePath) return;
    action.current = true;
    setBusy(true);
    setMessage("");
    try {
      const checked = await check();
      if (!live.current || currentKey.current !== key) return;
      setState({ key, availability: checked });
      if (checked !== "present") return;
      await openDocument(material.filePath);
      if (live.current && currentKey.current === key) setMessage("Opened in your PDF reader.");
    } catch {
      if (live.current && currentKey.current === key) setMessage("That PDF could not be opened. Check your saved file and PDF reader, then try again.");
    } finally {
      action.current = false;
      if (live.current) setBusy(false);
    }
  };

  return (
    <div className="faa-shelf__copy">
      {faaEditionMessage(reference, note) ? <p className="small wrap-anywhere">{faaEditionMessage(reference, note)}</p> : null}
      <p className="small muted">Added {material.createdAt.slice(0, 10)}</p>
      <p className="small" role="status">{AVAILABILITY[availability]}</p>
      <div className="row row--wrap">
        <Button onClick={() => void open()} disabled={busy || availability !== "present"}
          aria-label={`Open offline: ${material.title}`}>{busy ? "Opening…" : "Open offline"}</Button>
        <Link className="button button--secondary" to={`/study/${material.id}?tab=notes`}>Notes and bookmarks<span className="visually-hidden">: {reference.title}</span></Link>
      </div>
      {message ? <p className="small" role="status">{message}</p> : null}
    </div>
  );
}

function AddReference({ reference, onClose, onSave }: {
  reference: FaaReference;
  onClose: () => void;
  onSave: (draft: ReturnType<typeof faaReferenceDraft>) => Promise<boolean>;
}) {
  const [id] = useState(newId);
  const [edition, setEdition] = useState("");
  const [imported, setImported] = useState<ImportedDocument | null>(null);
  const unused = useRef<string[]>([]);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState("");

  const choose = async () => {
    if (locked.current || !canHandleFiles()) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      // Every pick gets a fresh storage name so a failed replacement cannot
      // overwrite the PDF already chosen for this draft.
      const file = await pickAndImportDocument(newId(), true);
      if (file) {
        if (imported) unused.current.push(imported.relativePath);
        setImported(file);
      }
    } catch {
      setError("That file could not be added. Choose a readable PDF and try again.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const close = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    const failures = await cleanupDocuments([...unused.current, ...(imported ? [imported.relativePath] : [])]);
    locked.current = false;
    setBusy(false);
    if (failures.length) setError("The unused copy could not be removed. Try Cancel again.");
    else onClose();
  };

  const save = async () => {
    if (locked.current || !imported) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const failures = await cleanupDocuments(unused.current);
      unused.current = failures;
      if (failures.length) {
        setError("The unused copy could not be removed. Try Save reference again.");
        return;
      }
      if (await onSave(faaReferenceDraft(reference, id, edition, imported))) onClose();
      else setError("That reference could not be saved. Your PDF and edition note are here to retry.");
    } catch {
      setError("That reference could not be saved. Your PDF and edition note are here to retry.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open className="faa-shelf-dialog" title={`Add ${reference.title}`} onClose={() => void close()} dismissible={!busy}
      footer={<>
        <Button onClick={() => void close()} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={busy || !imported}>Save reference</Button>
      </>}>
      <div className="stack stack--4 faa-shelf">
        <p className="small">Listed edition: {reference.edition}. {reference.publication}.</p>
        <p className="small muted">Choose a PDF from your computer. The app keeps the edition you enter.</p>
        <Field label="Your PDF’s edition (optional)" hint="You can leave this blank. Another edition stays as a separate copy.">
          {({ id: fieldId, describedBy }) => <TextInput id={fieldId} aria-describedby={describedBy}
            maxLength={200} value={edition} placeholder={reference.edition} disabled={busy}
            onChange={(event) => setEdition(event.target.value)} />}
        </Field>
        {imported ? <p className="small wrap-anywhere">{imported.originalFileName}</p> : null}
        <Button onClick={() => void choose()} disabled={busy}>{busy ? "Adding…" : imported ? "Choose another PDF" : "Choose local PDF"}</Button>
        <p className="small muted">The app keeps a private copy. Include it in a complete backup; large books make backups larger.</p>
        {error ? <p className="field__error" role="alert">{error}</p> : null}
      </div>
    </Dialog>
  );
}
