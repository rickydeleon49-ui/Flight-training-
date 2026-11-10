import { useRef, useState, type FormEvent } from "react";

import { Button, Dialog, Field, TextInput } from "@/components/ui";
import {
  MAX_FOLDERS,
  NOT_IN_A_FOLDER,
  validateFolderName,
  type LibraryFolder,
} from "@/logic/libraryFolders";
import { useAppData } from "@/state/AppDataContext";

export type FolderDialogState =
  | { kind: "new" }
  | { kind: "rename"; folder: LibraryFolder }
  | { kind: "delete"; folder: LibraryFolder; count: number };

const plainError = (e: unknown): string =>
  e instanceof Error && e.message ? e.message : "That did not work. Please try again.";

/** "New folder" button; disabled with a reason at the folder limit. */
export function NewFolderButton({
  folderCount,
  onClick,
}: {
  folderCount: number;
  onClick: () => void;
}) {
  const full = folderCount >= MAX_FOLDERS;
  return (
    <Button
      variant="secondary"
      onClick={onClick}
      disabled={full}
      title={full ? `You can have up to ${MAX_FOLDERS} folders.` : undefined}
    >
      New folder
    </Button>
  );
}

/** The small "⋯" menu on a real folder's header. Not shown for Not in a folder. */
export function FolderActionsMenu({
  folder,
  count,
  index,
  total,
  onRename,
  onDelete,
  onMove,
}: {
  folder: LibraryFolder;
  count: number;
  index: number;
  total: number;
  onRename: () => void;
  onDelete: (count: number) => void;
  onMove: (direction: "up" | "down") => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const close = () => {
    if (details.current) details.current.open = false;
    summary.current?.focus();
  };
  return (
    <details
      ref={details}
      className="folder-actions-menu"
      onKeyDown={(event) => {
        if (event.key === "Escape" && details.current?.open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <summary ref={summary} aria-label={`Folder actions: ${folder.name}`}>
        <span aria-hidden="true">⋯</span>
      </summary>
      <div
        className="folder-actions-menu__items"
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest("button")) close();
        }}
      >
        <Button variant="ghost" onClick={onRename}>Rename…</Button>
        <Button variant="ghost" disabled={index <= 0} onClick={() => onMove("up")}>
          Move folder up
        </Button>
        <Button variant="ghost" disabled={index >= total - 1} onClick={() => onMove("down")}>
          Move folder down
        </Button>
        <Button variant="ghost" className="destructive-action" onClick={() => onDelete(count)}>
          Delete folder…
        </Button>
      </div>
    </details>
  );
}

/** New, Rename and Delete dialogs. The caller owns which one is open. */
export function FolderDialogs({
  state,
  folders,
  onClose,
  reload,
}: {
  state: FolderDialogState | null;
  folders: LibraryFolder[];
  onClose: () => void;
  reload: () => void;
}) {
  const { repositories } = useAppData();
  const repo = repositories?.libraryFolders;
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const seen = useRef<FolderDialogState | null>(null);
  // Fresh form each time a dialog opens.
  if (seen.current !== state) {
    seen.current = state;
    const initial = state?.kind === "rename" ? state.folder.name : "";
    if (name !== initial) setName(initial);
    if (error !== null) setError(null);
    if (result !== null) setResult(null);
    if (busy) setBusy(false);
  }

  const finish = () => {
    reload();
    onClose();
  };

  const submitName = async (event: FormEvent) => {
    event.preventDefault();
    if (!state || state.kind === "delete" || busy) return;
    const check = validateFolderName(
      name,
      folders,
      state.kind === "rename" ? state.folder.id : undefined,
    );
    if (!check.ok) {
      setError(check.message);
      return;
    }
    if (!repo) {
      setError("Folders are not ready yet. Please try again.");
      return;
    }
    setBusy(true);
    try {
      if (state.kind === "rename") await repo.renameFolder(state.folder.id, check.name);
      else await repo.createFolder(check.name);
      setBusy(false);
      finish();
    } catch (e) {
      setBusy(false);
      setError(plainError(e));
    }
  };

  const runDelete = async () => {
    if (!state || state.kind !== "delete" || busy) return;
    if (!repo) {
      setError("Folders are not ready yet. Please try again.");
      return;
    }
    setBusy(true);
    try {
      await repo.deleteFolder(state.folder.id);
      setBusy(false);
      setError(null);
      reload();
      setResult(
        `${state.count.toLocaleString()} ${state.count === 1 ? "material is" : "materials are"} now in ${NOT_IN_A_FOLDER}.`,
      );
    } catch (e) {
      setBusy(false);
      setError(plainError(e));
    }
  };

  if (state?.kind === "delete") {
    const { folder, count } = state;
    return (
      <Dialog
        open
        narrow
        onClose={onClose}
        title={result ? "Folder deleted" : `Delete the folder “${folder.name}”?`}
        footer={
          result ? (
            <Button variant="primary" onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button variant="danger" onClick={runDelete} disabled={busy}>Delete folder</Button>
            </>
          )
        }
      >
        {result ? (
          <p>{result}</p>
        ) : (
          <p>
            The {count.toLocaleString()} {count === 1 ? "material" : "materials"} in it stay in
            your library under {NOT_IN_A_FOLDER}. Nothing is deleted.
          </p>
        )}
        {error ? <p role="alert" className="small field__error">{error}</p> : null}
      </Dialog>
    );
  }

  const renaming = state?.kind === "rename";
  return (
    <Dialog
      open={state !== null}
      narrow
      onClose={onClose}
      title={renaming ? "Rename folder" : "New folder"}
    >
      <form onSubmit={submitName}>
        <Field label="Name" error={error}>
          <TextInput
            value={name}
            autoComplete="off"
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
          />
        </Field>
        <div className="dialog__footer">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {renaming ? "Save" : "Create"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
