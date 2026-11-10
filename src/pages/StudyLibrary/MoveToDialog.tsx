import { useState, type FormEvent } from "react";

import { Button, Dialog, Field, TextInput } from "@/components/ui";
import {
  NOT_IN_A_FOLDER,
  validateFolderName,
  type LibraryFolder,
  type LibraryPlacement,
} from "@/logic/libraryFolders";
import { useAppData } from "@/state/AppDataContext";

export interface MoveResult {
  folderId: string | null;
  folderName: string;
  count: number;
}

const plainError = (e: unknown): string =>
  e instanceof Error && e.message ? e.message : "That did not work. Please try again.";

/**
 * "Move to…": one big button per folder, then Not in a folder, then a new folder.
 * It writes through the repository and tells the caller where things went.
 * `placements` (when given) say where each material is now; otherwise
 * `currentFolderId` is used for all of them.
 */
export function MoveToDialog({
  open,
  onClose,
  materialIds,
  materialTitle,
  folders,
  placements,
  currentFolderId,
  onBeforeMove,
  onMoved,
}: {
  open: boolean;
  onClose: () => void;
  materialIds: string[];
  /** Shown in the title when one material is moved. */
  materialTitle?: string;
  folders: LibraryFolder[];
  placements?: LibraryPlacement[];
  currentFolderId?: string | null;
  /** Called just before the write, so the caller can remember where things were. */
  onBeforeMove?: () => void;
  onMoved: (result: MoveResult) => void;
}) {
  const { repositories } = useAppData();
  const repo = repositories?.libraryFolders;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) {
    setSeenOpen(open);
    setBusy(false);
    setError(null);
    setCreating(false);
    setName("");
  }

  const known = new Set(folders.map((f) => f.id));
  const placedIn = (id: string): string | null => {
    if (!placements) return currentFolderId ?? null;
    const folderId = placements.find((p) => p.materialId === id)?.folderId ?? null;
    return folderId !== null && known.has(folderId) ? folderId : null;
  };
  const allHere = (folderId: string | null): boolean =>
    materialIds.length > 0 && materialIds.every((id) => placedIn(id) === folderId);

  const count = materialIds.length;
  const title =
    count === 1 && materialTitle ? `Move “${materialTitle}” to…` : `Move ${count.toLocaleString()} ${count === 1 ? "material" : "materials"} to…`;

  const moveTo = async (folderId: string | null, folderName: string, make?: string) => {
    if (busy) return;
    if (!repo) {
      setError("Folders are not ready yet. Please try again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let targetId = folderId;
      let targetName = folderName;
      if (make !== undefined) {
        const created = await repo.createFolder(make);
        targetId = created.id;
        targetName = created.name;
      }
      onBeforeMove?.();
      await repo.moveMaterials(materialIds, targetId);
      setBusy(false);
      onMoved({ folderId: targetId, folderName: targetName, count });
    } catch (e) {
      setBusy(false);
      setError(plainError(e));
    }
  };

  const submitNew = (event: FormEvent) => {
    event.preventDefault();
    const check = validateFolderName(name, folders);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    void moveTo(null, check.name, check.name);
  };

  return (
    <Dialog open={open} narrow onClose={onClose} title={title}>
      <div className="move-to">
        {folders.map((folder) => {
          const here = allHere(folder.id);
          return (
            <Button key={folder.id} disabled={busy || here} onClick={() => void moveTo(folder.id, folder.name)}>
              {folder.name}
              {here ? " (here now)" : ""}
            </Button>
          );
        })}
        <Button disabled={busy || allHere(null)} onClick={() => void moveTo(null, NOT_IN_A_FOLDER)}>
          {NOT_IN_A_FOLDER}
          {allHere(null) ? " (here now)" : ""}
        </Button>
        <hr className="move-to__divider" />
        {creating ? (
          <form onSubmit={submitNew}>
            <Field label="Name" error={error}>
              <TextInput
                value={name}
                autoComplete="off"
                autoFocus
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
              />
            </Field>
            <Button variant="primary" type="submit" disabled={busy}>Create and move</Button>
          </form>
        ) : (
          <Button variant="secondary" onClick={() => setCreating(true)} disabled={busy}>
            New folder…
          </Button>
        )}
        {error && !creating ? <p role="alert" className="small field__error">{error}</p> : null}
      </div>
      <div className="dialog__footer">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      </div>
    </Dialog>
  );
}
