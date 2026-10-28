import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { Button, Dialog, Field, TextInput } from "@/components/ui";
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
  openDocument,
  pickAndImportDocument,
  type ImportedDocument,
} from "@/services/documents";
import { previewStudyPageSource } from "@/services/studyPageSources";
import { useAppData } from "@/state/AppDataContext";

export function FaaReferences() {
  const { data, mutate } = useAppData();
  const [adding, setAdding] = useState<FaaReference | null>(null);

  const entry = (reference: FaaReference, children?: ReactNode) => {
    const copies = faaShelfCopies(data.materials, reference);
    return (
    <div key={reference.id} className="faa-shelf__entry">
      <div className="row row--wrap">
        {reference.id === "phak-addendum" ? <h4 className="small">{reference.title}</h4> : <h3 className="small">{reference.title}</h3>}
        <Button onClick={() => setAdding(reference)} disabled={!canHandleFiles()}
          aria-label={`Add PDF: ${reference.title}`}>Add PDF</Button>
      </div>
      <details>
        <summary>Listed edition: {reference.edition}</summary>
        <p className="small muted">{reference.publication} · FAA</p>
        <p className="small wrap-anywhere">Official source: {reference.source}</p>
        <p className="small muted">Source list last checked: October 28, 2026. Newer editions may exist.</p>
      </details>
      {copies.map(({ material, note }) => (
        <SavedReference key={material.id} material={material} note={note} reference={reference} />
      ))}
      {copies.length === 0 ? <p className="small muted">Optional · No saved PDF</p> : null}
      {children}
    </div>
    );
  };

  return (
    <section className="faa-shelf" aria-labelledby="faa-shelf-title">
      <h2 id="faa-shelf-title" className="section-title">FAA references</h2>
      <p className="small muted">Optional books for offline study. Add your own local PDFs.</p>
      {!canHandleFiles() ? <p className="small muted">Adding, checking and opening PDFs needs the desktop application. Your saved reference notes are still available here.</p> : null}
      {entry(FAA_REFERENCES[0])}
      {entry(FAA_REFERENCES[1], entry(FAA_REFERENCES[2]))}
      <p className="small muted">Complete backups include these PDFs, notes and bookmarks. Large books make backups larger. Adding another copy keeps earlier editions.</p>
      {adding ? <AddReference reference={adding} onClose={() => setAdding(null)} onSave={async (draft) => {
        const saved = await mutate((repos) => repos.documents.create(draft));
        return saved !== null;
      }} /> : null}
    </section>
  );
}

const AVAILABILITY: Record<FaaAvailability, string> = {
  checking: "Checking saved PDF…",
  present: "Present · Saved offline",
  missing: "Missing · Your notes and history are still here. Add another copy when ready.",
  changed: "Changed · This file differs from the added copy. Your notes and history are still here.",
  unknown: "Availability could not be checked. Try again in the desktop application.",
  browser: "Availability needs the desktop application",
};

function SavedReference({ material, note, reference }: {
  material: StudyMaterial;
  note: FaaReferenceNote;
  reference: FaaReference;
}) {
  const [state, setState] = useState<{ key: string; availability: FaaAvailability } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify([material.id, material.filePath, note]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const action = useRef(false);
  const live = useRef(false);
  const desktop = canHandleFiles();
  const availability = !desktop ? "browser" : state?.key === key ? state.availability : "checking";

  useEffect(() => {
    live.current = true;
    let active = true;
    setMessage("");
    if (desktop) {
      void (material.filePath ? previewStudyPageSource(material.id) : Promise.resolve(null))
        .then((preview) => {
          if (active) setState({ key, availability: faaAvailability(note, preview) });
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
      const checked = faaAvailability(note, await previewStudyPageSource(material.id));
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
      <p className="small wrap-anywhere">Saved edition: {note.edition || "Not supplied"} · {faaEditionMessage(reference, note)}</p>
      <p className="small muted">Added {material.createdAt.slice(0, 10)}</p>
      <p className="small" role="status">{AVAILABILITY[availability]}</p>
      <div className="row row--wrap">
        <Button onClick={() => void open()} disabled={busy || availability !== "present"}
          aria-label={`Open offline: ${material.title}`}>{busy ? "Opening…" : "Open offline"}</Button>
        <Link className="button button--secondary" to={`/study/${material.id}`}>Notes and bookmarks<span className="visually-hidden">: {material.title}</span></Link>
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
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState("");

  const choose = async () => {
    if (locked.current || !canHandleFiles()) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const file = await pickAndImportDocument(id, true);
      if (file) setImported(file);
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
    const failures = await cleanupDocuments(imported ? [imported.relativePath] : []);
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
        <p className="small muted">Choose a PDF you obtained separately. Its filename does not verify the edition or official source. No file is downloaded.</p>
        <Field label="Edition written in your PDF (optional)" hint="A different edition is welcome as a separate copy. Edition not checked.">
          {({ id: fieldId, describedBy }) => <TextInput id={fieldId} aria-describedby={describedBy}
            maxLength={200} value={edition} placeholder={reference.edition} disabled={busy}
            onChange={(event) => setEdition(event.target.value)} />}
        </Field>
        {imported ? <p className="small wrap-anywhere">{imported.originalFileName}</p> :
          <Button onClick={() => void choose()} disabled={busy}>{busy ? "Adding…" : "Choose local PDF"}</Button>}
        <p className="small muted">The app keeps a private copy. Include it in a complete backup; large books make backups larger.</p>
        {error ? <p className="field__error" role="alert">{error}</p> : null}
      </div>
    </Dialog>
  );
}
