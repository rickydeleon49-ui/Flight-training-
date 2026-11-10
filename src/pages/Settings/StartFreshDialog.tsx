import { useEffect, useState } from "react";

import { Button, Dialog, Field, TextInput } from "@/components/ui";
import {
  backupErrorMessage,
  clearAppLocalStorage,
  restartForRestore,
  stageStartFresh,
} from "@/services/backups";
import { isIOS } from "@/services/platform";

export interface StartFreshDialogProps {
  open: boolean;
  onClose: () => void;
  onSaveBackupFirst?: () => Promise<void> | void;
  /** Test seams */
  stage?: () => Promise<void>;
  clearStorage?: () => void;
  restart?: () => Promise<void>;
}

export function StartFreshDialog({
  open,
  onClose,
  onSaveBackupFirst,
  stage = stageStartFresh,
  clearStorage = clearAppLocalStorage,
  restart = restartForRestore,
}: StartFreshDialogProps) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setConfirmText("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const isConfirmed = confirmText.trim().toUpperCase() === "ERASE";

  const handleSaveBackupFirst = async () => {
    if (busy) return;
    try {
      await onSaveBackupFirst?.();
    } catch (err) {
      setError(backupErrorMessage(err, "That backup could not be saved."));
    }
  };

  const handleConfirm = async () => {
    if (!isConfirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await stage();
      clearStorage();
      await restart();
    } catch (err) {
      setError(backupErrorMessage(err, "Could not start fresh."));
      setBusy(false);
    }
  };

  const title = isIOS() ? "Start fresh on this iPhone?" : "Start fresh on this Mac?";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      narrow
      dismissible={!busy}
      footer={
        <span className="dialog__footer-main">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy || !isConfirmed}
            onClick={() => void handleConfirm()}
          >
            {busy ? "Erasing…" : "Erase and start fresh"}
          </Button>
        </span>
      }
    >
      <div className="stack stack--4">
        <p className="muted">
          This erases your notes, logbook, study material, progress and saved safety copies on this
          device. Your Gemini key stays saved. Backups you saved to iCloud or Files are not
          touched.
        </p>
        <div>
          <Button
            variant="primary"
            onClick={() => void handleSaveBackupFirst()}
            disabled={busy}
          >
            Save a backup first
          </Button>
        </div>
        <Field label="Type ERASE to confirm">
          <TextInput
            value={confirmText}
            onChange={(e) => {
              setConfirmText(e.target.value);
              if (error) setError(null);
            }}
            placeholder="ERASE"
            autoComplete="off"
            disabled={busy}
          />
        </Field>
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
