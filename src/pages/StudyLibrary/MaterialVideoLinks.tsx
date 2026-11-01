import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "@/data";
import { Button, Card, CardBody, ConfirmDialog, Dialog } from "@/components/ui";
import { useAppData } from "@/state/AppDataContext";
import { validateVideoUrl, videoLinkLabel, type MaterialVideoLink } from "@/data/repositories/materialVideoLinkRepository";

export function MaterialVideoLinks({ materialId }: { materialId: string }) {
  const { repositories } = useAppData();
  const repository = repositories?.materialVideoLinks;
  const [links, setLinks] = useState<MaterialVideoLink[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [removing, setRemoving] = useState<MaterialVideoLink | null>(null);
  const [renaming, setRenaming] = useState<MaterialVideoLink | null>(null);
  const [name, setName] = useState("");
  const urlField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    if (repository) void repository.list(materialId).then((saved) => {
      if (active) { setLinks(saved); setLoaded(true); }
    }).catch(() => { if (active) setError("Your video links couldn't be loaded. Reopen this section to try again."); });
    return () => { active = false; };
  }, [repository, materialId]);
  async function save(work: () => Promise<void>) {
    if (busy || !repository) return;
    setBusy(true); setError("");
    try { await work(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save that change. Please try again."); }
    finally { setBusy(false); }
  }
  async function open(link: MaterialVideoLink) {
    try {
      const safeUrl = validateVideoUrl(link.url);
      if (isTauri()) await openUrl(safeUrl);
      else window.open(safeUrl, "_blank", "noopener,noreferrer");
    } catch { setError("That link couldn't be opened. Check the web address and try again."); }
  }
  // A small closed dropdown: optional extra next to the section's own study material.
  return <Card>
    <details>
    <summary className="card__header" style={{ cursor: "pointer" }}>
      <h2 className="card__title" style={{ display: "inline" }}>Videos for this section</h2>{" "}
      <span className="small muted">{links.length ? `${links.length} saved` : "optional"}</span>
    </summary>
    <CardBody><div className="stack stack--3">
      {loaded && !links.length ? <p className="small muted">Found a helpful video? Paste its link here so you can come back to it.</p> : null}
      {links.length ? <ul className="stack stack--3">{links.map((link) => <li key={link.id} className="row row--between row--wrap">
        <a href={link.url} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: "anywhere" }} onClick={(event) => { event.preventDefault(); void open(link); }}>{videoLinkLabel(link)}</a>
        <div className="row"><Button size="small" disabled={busy} onClick={() => { setRenaming(link); setName(link.title); }}>Rename</Button>
          <Button size="small" disabled={busy} onClick={() => setRemoving(link)}>Remove</Button></div>
      </li>)}</ul> : null}
      <form className="row row--wrap" aria-label="Add a video link" onSubmit={(event) => {
        event.preventDefault();
        void save(async () => {
          const saved = await repository!.add(materialId, url, title);
          setLinks((current) => [...current, saved]); setUrl(""); setTitle("");
          urlField.current?.focus();
        });
      }}>
        <label className="field">Add a video link<input ref={urlField} type="text" value={url} placeholder="Paste a YouTube or video link" onChange={(event) => setUrl(event.target.value)} /></label>
        <label className="field">Name (optional)<input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></label>
        <Button type="submit" disabled={busy || !loaded} variant="primary">Add</Button>
      </form>
      {error ? <p role="alert" className="field__error">{error}</p> : null}
    </div></CardBody>
    </details>
    <Dialog open={!!renaming} onClose={() => { if (!busy) setRenaming(null); }} title="Rename video link">
      <form className="stack stack--3" onSubmit={(event) => { event.preventDefault(); void save(async () => {
        await repository!.rename(renaming!.id, name);
        setLinks((current) => current.map((link) => link.id === renaming!.id ? { ...link, title: name.trim() } : link));
        setRenaming(null);
      }); }}>
        <label className="field">Name (optional)<input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} /></label>
        <Button type="submit" disabled={busy}>Save name</Button>
      </form>
    </Dialog>
    <ConfirmDialog open={!!removing} title="Remove video link?" message="This removes the saved link from this section." confirmLabel="Remove" pending={busy}
      onCancel={() => setRemoving(null)} onConfirm={() => void save(async () => {
        await repository!.remove(removing!.id);
        setLinks((current) => current.filter((link) => link.id !== removing!.id)); setRemoving(null);
      })} />
  </Card>;
}
