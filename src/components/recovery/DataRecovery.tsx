/**
 * The screen she sees if her training record cannot be opened.
 *
 * This is the moment everything else in the application is designed to avoid,
 * so it must not be a dead end. Nothing here needs the database: the desktop
 * shell keeps a safety copy of the database before every new version's first
 * run, and a portable `.hfdbackup` can be reinstalled from a file. Both are
 * offered right here, and both restart the app with the data put back.
 */
import { useEffect, useState } from "react";

import { Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorNote } from "@/components/ui";
import { formatRestorePreviewNotice, restoreWarning } from "@/logic/dataSafety";
import {
  backupErrorMessage,
  backupLocalDay,
  backupsAvailable,
  chooseCompleteBackup,
  dataDirectory,
  describeBackup,
  formatBackupDate,
  formatBytes,
  inspectCompleteBackup,
  listBackups,
  restartForRestore,
  openDataFolder,
  stageCompleteRestore,
  stageLocalRestore,
  type BackupInfo,
  type CompleteBackupInfo,
} from "@/services/backups";
import { isMacOS, isWindowsOS } from "@/lib/platform";

interface DataRecoveryProps {
  /** What went wrong, in the words the database gave us. */
  error: string | null;
}

export function DataRecovery({ error }: DataRecoveryProps) {
  const [dataPath, setDataPath] = useState("");
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [archiveCandidate, setArchiveCandidate] = useState<CompleteBackupInfo | null>(null);
  const [copyCandidate, setCopyCandidate] = useState<BackupInfo | null>(null);
  const [folderOpenError, setFolderOpenError] = useState<string | null>(null);

  useEffect(() => {
    if (!backupsAvailable()) return;
    void dataDirectory().then(setDataPath).catch(() => setDataPath(""));
    void listBackups().then(setBackups).catch(() => setBackups([]));
  }, []);

  const chooseArchive = async () => {
    setNote(null);
    setProblem(false);
    setBusy(true);
    try {
      const source = await chooseCompleteBackup();
      if (!source) return;
      const candidate = await inspectCompleteBackup(source);
      const warning = restoreWarning(candidate.appVersion, candidate.currentAppVersion);
      if (warning) {
        setProblem(true);
        setNote(warning);
        return;
      }
      const previewNotice = formatRestorePreviewNotice(candidate);
      if (previewNotice) {
        setProblem(true);
        setNote(previewNotice);
      }
      setArchiveCandidate(candidate);
    } catch (failure) {
      setProblem(true);
      setNote(backupErrorMessage(failure, "That backup could not be read.", false));
    } finally {
      setBusy(false);
    }
  };

  /** Stage whichever kind was chosen, then restart so it installs. */
  const install = async (stage: () => Promise<unknown>, working: string) => {
    setBusy(true);
    setProblem(false);
    setNote(working);
    try {
      await stage();
      setNote("Restarting with your restored training record…");
      await restartForRestore();
    } catch (failure) {
      setProblem(true);
      setNote(backupErrorMessage(failure, "That could not be put back."));
      setBusy(false);
    }
  };

  const restorable = backups.filter((backup) => backup.restorable);

  return (
    <div style={{ padding: "var(--space-6)", maxWidth: "44rem", margin: "0 auto" }}>
      <div className="stack stack--5">
        <ErrorNote>
          <div className="stack stack--2">
            <p className="strong">Your training data could not be opened.</p>
            {error ? <p>{error}</p> : null}
            <p>
              Nothing has been deleted. Your files are still in the folder below, and
              this app can put a saved copy back for you.
            </p>
          </div>
        </ErrorNote>

        {backupsAvailable() ? (
          <>
            <Card>
              <CardHeader
                title="Put a saved copy back"
                eyebrow="Recovery"
                action={
                  <Button size="small" variant="primary" onClick={chooseArchive} disabled={busy}>
                    {busy ? "Working…" : "Choose a backup file…"}
                  </Button>
                }
              />
              <CardBody>
                <div className="stack stack--4">
                  {note ? (
                    <p
                      className="small"
                      role={problem ? "alert" : "status"}
                      style={{ color: problem ? "var(--status-danger)" : "var(--status-complete)" }}
                    >
                      {note}
                    </p>
                  ) : null}

                  <p className="small muted">
                    Choose a complete <strong>.hfdbackup</strong> file to bring back your
                    records and every uploaded document together. The app checks the file
                    before it changes anything, and keeps a recoverable copy of whatever
                    is here now.
                  </p>

                  {restorable.length > 0 ? (
                    <div className="stack stack--2">
                      <p className="tiny strong dim">
                        Copies made automatically on this computer ({restorable.length})
                      </p>
                      {restorable.slice(0, 6).map((backup) => (
                        <div className="row row--between" key={backup.name}>
                          <span className="small truncate">
                            {describeBackup(backup.name)} · {backupLocalDay(backup.name) ?? "date unknown"}
                          </span>
                          <span className="row" style={{ gap: "var(--space-3)" }}>
                            <span className="tiny dim numeric">{formatBytes(backup.bytes)}</span>
                            <Button
                              size="small"
                              onClick={() => setCopyCandidate(backup)}
                              disabled={busy}
                            >
                              Put this back
                            </Button>
                          </span>
                        </div>
                      ))}
                      <p className="tiny dim">
                        These hold your records, lessons and settings. Uploaded files are
                        never moved, so they stay exactly where they are.
                      </p>
                    </div>
                  ) : (
                    <p className="tiny dim">
                      There are no automatic safety copies on this computer yet.
                    </p>
                  )}
                </div>
              </CardBody>
            </Card>

            {dataPath ? (
              <Card>
                <CardHeader title="Where your data lives" eyebrow="On this computer" />
                <CardBody>
                  <div className="row row--between" style={{ gap: "var(--space-3)" }}>
                    <code className="tiny wrap-anywhere">{dataPath}</code>
                    <Button
                      size="small"
                      onClick={() => {
                        setFolderOpenError(null);
                        openDataFolder().catch((error: unknown) => {
                          setFolderOpenError(
                            backupErrorMessage(error, "That folder could not be opened.", false),
                          );
                        });
                      }}
                    >
                      Open folder
                    </Button>
                  </div>
                  {folderOpenError ? (
                    <p className="small" role="alert" style={{ color: "var(--status-danger)", marginTop: "var(--space-2)" }}>
                      {folderOpenError}
                    </p>
                  ) : null}
                  <p className="tiny dim" style={{ marginTop: "var(--space-3)" }}>
                    Copy this whole folder somewhere safe before trying anything else. It
                    contains your database, your uploaded documents, and every safety copy.
                  </p>
                  {isMacOS() ? (
                    <p className="tiny dim" style={{ marginTop: "var(--space-2)" }}>
                      <strong>On macOS:</strong> App data lives in the Application Support folder shown above.{" "}
                      <strong>Open folder</strong> opens that exact location in Finder.
                    </p>
                  ) : isWindowsOS() ? (
                    <p className="tiny dim" style={{ marginTop: "var(--space-2)" }}>
                      <strong>On Windows:</strong> App data lives in the folder shown above.{" "}
                      <strong>Open folder</strong> opens that exact location in File Explorer.
                    </p>
                  ) : (
                    <p className="tiny dim" style={{ marginTop: "var(--space-2)" }}>
                      <strong>Open folder</strong> opens that exact location in your file manager.
                    </p>
                  )}
                </CardBody>
              </Card>
            ) : null}
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={archiveCandidate !== null}
        title="Restore this complete backup?"
        message={
          archiveCandidate
            ? `This backup was created ${formatBackupDate(archiveCandidate.createdAt)} with app version ${archiveCandidate.appVersion}. It contains ${archiveCandidate.files} files (${formatBytes(archiveCandidate.bytes)}). ${formatRestorePreviewNotice(archiveCandidate) ? `${formatRestorePreviewNotice(archiveCandidate)} ` : ""}The app will keep a recoverable copy of what is here now, install this backup, and restart.`
            : ""
        }
        confirmLabel="Restore and restart"
        destructive
        onConfirm={() => {
          const candidate = archiveCandidate;
          setArchiveCandidate(null);
          if (candidate) {
            void install(() => stageCompleteRestore(candidate.path), "Preparing the restore…");
          }
        }}
        onCancel={() => setArchiveCandidate(null)}
      />

      <ConfirmDialog
        open={copyCandidate !== null}
        title="Put this safety copy back?"
        message={
          copyCandidate
            ? `This copy was ${describeBackup(copyCandidate.name).toLowerCase()}, on ${backupLocalDay(copyCandidate.name) ?? "an unknown date"}. It brings back your records, lessons, notes and settings as they were then. Uploaded files are not touched, and a recoverable copy of the current data is kept first.`
            : ""
        }
        confirmLabel="Put it back and restart"
        destructive
        onConfirm={() => {
          const candidate = copyCandidate;
          setCopyCandidate(null);
          if (candidate) {
            void install(() => stageLocalRestore(candidate.name), "Preparing that safety copy…");
          }
        }}
        onCancel={() => setCopyCandidate(null)}
      />
    </div>
  );
}
