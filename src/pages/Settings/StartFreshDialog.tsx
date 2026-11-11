import { useEffect, useRef, useState } from "react";

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
  onSaveBackupFirst?: () => Promise<string | null>;
  checkUnsaved?: () => Promise<string | null>;
  /** Test seams */
  stage?: () => Promise<void>;
  clearStorage?: () => void;
  restart?: () => Promise<void>;
}

export function StartFreshDialog({
  open,
  onClose,
  onSaveBackupFirst,
  checkUnsaved,
  stage = stageStartFresh,
  clearStorage = clearAppLocalStorage,
  restart = restartForRestore,
}: StartFreshDialogProps) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupIsError, setBackupIsError] = useState(false);
  const [unsavedWarning, setUnsavedWarning] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const locked = useRef(false);
  const saveLocked = useRef(false);
  const checkUnsavedRef = useRef(checkUnsaved);
  useEffect(() => {
    checkUnsavedRef.current = checkUnsaved;
  });

  useEffect(() => {
    if (open) {
      setConfirmText("");
      setError(null);
      setBusy(false);
      setSaving(false);
      setBackupMessage(null);
      setBackupIsError(false);
      setDoneMessage(null);
      setUnsavedWarning(null);
      locked.current = false;
      saveLocked.current = false;
      if (checkUnsavedRef.current) {
        void checkUnsavedRef.current()
          .then((msg) => {
            setUnsavedWarning(msg);
          })
          .catch(() => {});
      }
    }
  }, [open]);

  const isConfirmed = confirmText.trim().toUpperCase() === "ERASE";

  const handleSaveBackupFirst = async () => {
    if (busy || saving || saveLocked.current || doneMessage) return;
    saveLocked.current = true;
    setSaving(true);
    try {
      const res = await onSaveBackupFirst?.();
      if (res === null) {
        setBackupMessage("Backup not saved.");
        setBackupIsError(false);
      } else if (res !== undefined) {
        setBackupMessage(res);
        setBackupIsError(false);
        if (checkUnsavedRef.current) {
          try {
            const warning = await checkUnsavedRef.current();
            setUnsavedWarning(warning);
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      setBackupMessage(backupErrorMessage(err, "That backup could not be saved."));
      setBackupIsError(true);
    } finally {
      saveLocked.current = false;
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    if (!isConfirmed || busy || saving || doneMessage) return;
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await stage();
    } catch (err) {
      setError(backupErrorMessage(err, "Could not start fresh."));
      setBusy(false);
      locked.current = false;
      return;
    }

    try {
      clearStorage();
    } catch {
      // ignore
    }

    if (isIOS()) {
      setDoneMessage("Erase is set. Close Your Flight Deck and open it again to finish.");
      setBusy(false);
      return;
    }

    try {
      await restart();
    } catch {
      setDoneMessage("Erase is set. Quit Your Flight Deck and open it again to finish.");
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
      dismissible={!busy && !saving}
      footer={
        <span className="dialog__footer-main">
          <Button onClick={onClose} disabled={busy || saving}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy || saving || !isConfirmed || !!doneMessage}
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
            disabled={busy || saving || !!doneMessage}
          >
            {saving ? "Saving…" : "Save a backup first"}
          </Button>
          {backupMessage ? (
            <p className={backupIsError ? "field__error" : "small muted"} role={backupIsError ? "alert" : "status"}>
              {backupMessage}
            </p>
          ) : null}
        </div>
        {unsavedWarning ? (
          <p className="field__error" role="status">
            {unsavedWarning}
          </p>
        ) : null}
        <Field label="Type ERASE to confirm">
          <TextInput
            value={confirmText}
            onChange={(e) => {
              setConfirmText(e.target.value);
              if (error) setError(null);
            }}
            placeholder="ERASE"
            autoComplete="off"
            disabled={busy || saving || !!doneMessage}
          />
        </Field>
        <p role="status" className="live-region">{doneMessage}</p>
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
