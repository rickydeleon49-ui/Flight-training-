import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/layout/PageHeader";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CheckIcon,
  ConfirmDialog,
  Field,
  Select,
  TextArea,
  TextInput,
} from "@/components/ui";
import { restoreAirlineStarterPack } from "@/data/starter";
import type { LastCompleteBackup } from "@/data/repositories/appRepository";
import { ACCENT_LABELS, ACCENT_ORDER, type AccentColor, type Profile } from "@/domain/types";
import { formatLongDate } from "@/lib/dates";
import {
  type Appearance,
  applyAppearance,
  getStoredAppearance,
  setStoredAppearance,
} from "@/lib/appearance";
import { dataUrlBytes, PhotoError, readPhotoAsDataUrl } from "@/lib/image";
import {
  appVersion,
  backupErrorMessage,
  backupLocalDay,
  createBackup,
  backupsAvailable,
  chooseCompleteBackup,
  chooseCompleteBackupDestination,
  createCompleteBackup,
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
import {
  backupHealth,
  formatCompleteBackupReminderFailureNote,
  formatCompleteBackupSuccessNote,
  formatRestorePreviewMissingNotice,
  restoreWarning,
} from "@/logic/dataSafety";
import { trainingDuration } from "@/logic/keyDates";
import { medicalDateConflict } from "@/logic/toolkit";
import {
  canHandleFiles,
  checkLibrary,
  documentErrorMessage,
  formatFileSize,
  importUnlinkedFile,
  pickAndImportDocument,
  reattachUnlinkedFile,
  rollbackDeleteDocument,
  trashUnlinkedFile,
  type LibraryReport,
  type UnlinkedFileInfo,
} from "@/services/documents";
import {
  configureGemini,
  disconnectGemini,
  GEMINI_MODEL_CHOICES,
  geminiAvailable,
  geminiErrorMessage,
  geminiModelName,
  getGeminiStatus,
  openGeminiKeyPage,
  setGeminiModel,
  type GeminiModelChoice,
  type GeminiStatus,
} from "@/services/gemini";
import { useAppData } from "@/state/AppDataContext";
import { isMacOS, isWindowsOS } from "@/lib/platform";

import "./settings.css";

/** The editable slice of the profile. */
type ProfileDraft = Omit<Profile, "id" | "createdAt" | "updatedAt">;

const draftFrom = (profile: Profile): ProfileDraft => ({
  pilotName: profile.pilotName,
  certificateGoal: profile.certificateGoal,
  currentFocus: profile.currentFocus,
  currentMilestoneId: profile.currentMilestoneId,
  flightSchool: profile.flightSchool,
  instructorName: profile.instructorName,
  homeAirport: profile.homeAirport,
  aircraftType: profile.aircraftType,
  trainingStartedOn: profile.trainingStartedOn,
  medicalExpiry: profile.medicalExpiry,
  whyNote: profile.whyNote,
  photo: profile.photo,
  accentColor: profile.accentColor,
});

function PlatformGuidance({
  mac,
  windows,
  neutral,
}: {
  mac: ReactNode;
  windows?: ReactNode;
  neutral?: ReactNode;
}) {
  if (isMacOS()) {
    return (
      <p className="tiny dim" style={{ marginBottom: "var(--space-4)" }}>
        <strong>On macOS:</strong> {mac}
      </p>
    );
  }
  if (isWindowsOS() && windows) {
    return (
      <p className="tiny dim" style={{ marginBottom: "var(--space-4)" }}>
        <strong>On Windows:</strong> {windows}
      </p>
    );
  }
  if (neutral) {
    return (
      <p className="tiny dim" style={{ marginBottom: "var(--space-4)" }}>
        {neutral}
      </p>
    );
  }
  return null;
}

function MacNote({ children }: { children: ReactNode }) {
  if (!isMacOS()) return null;
  return (
    <p className="tiny dim" style={{ marginBottom: "var(--space-4)" }}>
      <strong>On macOS:</strong> {children}
    </p>
  );
}

export function Settings() {
  const { data, mutate, refresh, repositories } = useAppData();
  const medicalConflict = medicalDateConflict(data.profile, data.toolkit.credentials);
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFrom(data.profile));
  // Already applied at startup (main.tsx); this only reflects the saved choice.
  const [appearance, setAppearance] = useState<Appearance>(getStoredAppearance);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [starterNote, setStarterNote] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [dataPath, setDataPath] = useState("");
  const [folderOpenError, setFolderOpenError] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupNote, setBackupNote] = useState<string | null>(null);
  const [backupProblem, setBackupProblem] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreCandidate, setRestoreCandidate] = useState<CompleteBackupInfo | null>(null);
  const [localRestoreCandidate, setLocalRestoreCandidate] = useState<BackupInfo | null>(null);
  const [version, setVersion] = useState("");
  const [lastBackup, setLastBackup] = useState<LastCompleteBackup | null>(null);
  const [gemini, setGemini] = useState<GeminiStatus | null>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiBusy, setGeminiBusy] = useState(false);
  const [geminiNote, setGeminiNote] = useState<string | null>(null);
  const [geminiProblem, setGeminiProblem] = useState(false);
  const [libraryReport, setLibraryReport] = useState<LibraryReport | null>(null);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryNote, setLibraryNote] = useState<string | null>(null);
  const [libraryProblem, setLibraryProblem] = useState(false);
  const [libraryTrashCandidate, setLibraryTrashCandidate] = useState<UnlinkedFileInfo | null>(null);
  const [libraryTrashUndo, setLibraryTrashUndo] = useState<Array<{ stagedId: string; name: string }>>([]);
  const [libraryVisible, setLibraryVisible] = useState(50);

  const reloadLibrary = async () => {
    setLibraryReport(await checkLibrary());
    setLibraryVisible(50);
  };

  const runLibraryCheck = async () => {
    setLibraryBusy(true);
    setLibraryReport(null);
    setLibraryNote(null);
    setLibraryProblem(false);
    try {
      await reloadLibrary();
      setLibraryNote("Library check complete.");
    } catch (error) {
      setLibraryProblem(true);
      setLibraryNote(documentErrorMessage(error, "The library could not be checked."));
    } finally {
      setLibraryBusy(false);
    }
  };

  const finishLibraryAction = async (message: string) => {
    setLibraryProblem(false);
    setLibraryNote(message);
    try {
      await refresh();
      await reloadLibrary();
    } catch (error) {
      setLibraryReport(null);
      setLibraryProblem(true);
      setLibraryNote(`${message} The library view could not refresh: ${documentErrorMessage(error, "Try Check library again.")}`);
    }
  };

  const reattachLibraryMaterial = async (materialId: string) => {
    setLibraryBusy(true);
    setLibraryNote(null);
    let importedPath: string | null = null;
    try {
      const imported = await pickAndImportDocument(materialId);
      if (!imported) return;
      importedPath = imported.relativePath;
      await reattachUnlinkedFile(materialId, imported.relativePath);
      await finishLibraryAction("The replacement file is attached. Existing notes and study data were kept.");
    } catch (error) {
      let cleanupWarning = "";
      if (importedPath) {
        try {
          await trashUnlinkedFile(importedPath);
        } catch {
          cleanupWarning = " The copied file remains in app storage; run Check library to recover it.";
        }
      }
      setLibraryProblem(true);
      setLibraryNote(`${documentErrorMessage(error, "The file could not be attached.")}${cleanupWarning}`);
    } finally {
      setLibraryBusy(false);
    }
  };

  const importLibraryFile = async (relativePath: string) => {
    setLibraryBusy(true);
    setLibraryNote(null);
    try {
      await importUnlinkedFile(relativePath);
      await finishLibraryAction("The file is now a Study Library material.");
    } catch (error) {
      setLibraryProblem(true);
      setLibraryNote(documentErrorMessage(error, "The file could not be added to the library."));
    } finally {
      setLibraryBusy(false);
    }
  };

  const moveLibraryFileToTrash = async () => {
    const candidate = libraryTrashCandidate;
    setLibraryTrashCandidate(null);
    if (!candidate) return;
    setLibraryBusy(true);
    setLibraryNote(null);
    try {
      const staged = await trashUnlinkedFile(candidate.relativePath);
      if (staged.stagedId) {
        setLibraryTrashUndo((items) => [...items, { stagedId: staged.stagedId, name: candidate.fileName }]);
      }
      await finishLibraryAction("The unlinked file was moved to private trash. You can undo this until the app restarts.");
    } catch (error) {
      setLibraryProblem(true);
      setLibraryNote(documentErrorMessage(error, "The file could not be moved to trash."));
    } finally {
      setLibraryBusy(false);
    }
  };

  const undoLibraryTrash = async (stagedId: string) => {
    setLibraryBusy(true);
    try {
      await rollbackDeleteDocument(stagedId);
      setLibraryTrashUndo((items) => items.filter((item) => item.stagedId !== stagedId));
      await finishLibraryAction("The file was restored to app storage.");
    } catch (error) {
      setLibraryProblem(true);
      setLibraryNote(documentErrorMessage(error, "The file could not be restored. Its copy remains in private trash."));
    } finally {
      setLibraryBusy(false);
    }
  };

  // Initialize once; background saves elsewhere must not reset this form.

  const refreshBackups = async () => {
    if (!backupsAvailable()) return;
    setDataPath(await dataDirectory());
    setBackups(await listBackups());
    setVersion(await appVersion());
  };

  useEffect(() => {
    void refreshBackups();
  }, []);

  // How well protected she is right now, which is worth saying out loud.
  useEffect(() => {
    if (!repositories) return;
    void repositories.app.lastCompleteBackup().then(setLastBackup).catch(() => setLastBackup(null));
  }, [repositories]);

  const protection = useMemo(
    () =>
      backupHealth({
        lastBackupAt: lastBackup?.at ?? null,
        lastBackupVersion: lastBackup?.version ?? null,
        appVersion: version,
        now: new Date(),
      }),
    [lastBackup, version],
  );

  useEffect(() => {
    void getGeminiStatus().then(setGemini).catch(() => setGemini(null));
  }, []);

  const connectGemini = async () => {
    setGeminiBusy(true);
    setGeminiNote("Checking the connection with Google…");
    setGeminiProblem(false);
    try {
      const status = await configureGemini(geminiKey);
      setGemini(status);
      setGeminiKey("");
      setGeminiNote("Gemini connected. Study tools are ready.");
    } catch (error) {
      setGeminiProblem(true);
      setGeminiNote(geminiErrorMessage(error));
    } finally {
      setGeminiBusy(false);
    }
  };

  const chooseGeminiModel = async (choice: GeminiModelChoice) => {
    if (gemini?.choice === choice) return;
    setGeminiBusy(true);
    setGeminiProblem(false);
    try {
      const status = await setGeminiModel(choice);
      setGemini(status);
      setGeminiNote(
        `New study aids will use ${geminiModelName(status.model)}. Saved study guides and flashcards are unchanged.`,
      );
    } catch (error) {
      setGeminiProblem(true);
      setGeminiNote(geminiErrorMessage(error));
    } finally {
      setGeminiBusy(false);
    }
  };

  const removeGemini = async () => {
    setGeminiBusy(true);
    setGeminiProblem(false);
    try {
      setGemini(await disconnectGemini());
      setGeminiNote("Gemini disconnected. Saved study guides and flashcards were kept.");
    } catch (error) {
      setGeminiProblem(true);
      setGeminiNote(geminiErrorMessage(error));
    } finally {
      setGeminiBusy(false);
    }
  };

  const backUpNow = async () => {
    setBackupNote(null);
    setBackupProblem(false);
    setBackupBusy(true);
    try {
      if (!repositories) throw new Error("The database is still starting. Try again in a moment.");
      const destination = await chooseCompleteBackupDestination();
      if (!destination) return;
      // Rust takes a consistent SQLite online snapshot before archiving it.
      const backup = await createCompleteBackup(destination);

      // Remembering this is what lets the app tell her later that the backup
      // she has predates an update.
      const record = {
        at: new Date().toISOString(),
        version: backup.appVersion,
        path: backup.path,
      };
      let materials: { id: string; title: string }[] = [];
      try {
        materials = await repositories.documents.list().catch(() => []);
      } catch {
        // ignore
      }
      try {
        await repositories.app.recordCompleteBackup(record);
        setLastBackup(record);
        const { message, hasWarnings } = formatCompleteBackupSuccessNote(backup, formatBytes, materials);
        setBackupProblem(hasWarnings);
        setBackupNote(message);
      } catch {
        // The archive is already finalized and verified. A failed reminder
        // write must not tell her that the actual backup failed, but must
        // still retain any missing-document or unreferenced-file warnings.
        setBackupProblem(true);
        setBackupNote(formatCompleteBackupReminderFailureNote(backup, materials));
      }
    } catch (error) {
      setBackupProblem(true);
      setBackupNote(backupErrorMessage(error, "That backup could not be saved."));
    } finally {
      setBackupBusy(false);
    }
  };

  const copyDatabaseNow = async () => {
    setBackupNote(null);
    setBackupProblem(false);
    setBackupBusy(true);
    try {
      if (!repositories) throw new Error("The database is still starting. Try again in a moment.");
      await repositories.app.checkpoint();
      await createBackup();
      await refreshBackups();
      setBackupNote(
        "Copy saved on this computer. It is in the list below, and can be put back at any time.",
      );
    } catch (error) {
      setBackupProblem(true);
      setBackupNote(backupErrorMessage(error, "That copy could not be saved."));
    } finally {
      setBackupBusy(false);
    }
  };

  const chooseRestore = async () => {
    setBackupNote(null);
    setBackupProblem(false);
    setBackupBusy(true);
    try {
      const source = await chooseCompleteBackup();
      if (!source) return;
      const candidate = await inspectCompleteBackup(source);

      // An older app cannot read a record a newer one wrote. Saying so is far
      // kinder than installing it and leaving her with an app that won't open.
      const warning = restoreWarning(candidate.appVersion, candidate.currentAppVersion);
      if (warning) {
        setBackupProblem(true);
        setBackupNote(warning);
        return;
      }
      if (candidate.missingDocuments && candidate.missingDocuments.length > 0) {
        setBackupProblem(true);
        setBackupNote(formatRestorePreviewMissingNotice(candidate.missingDocuments.length));
      }
      setRestoreCandidate(candidate);
    } catch (error) {
      setBackupProblem(true);
      setBackupNote(backupErrorMessage(error, "That backup could not be read."));
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreBackup = async () => {
    const candidate = restoreCandidate;
    if (!candidate) return;
    setRestoreCandidate(null);
    setBackupBusy(true);
    setBackupProblem(false);
    setBackupNote("Preparing the restore…");
    try {
      await stageCompleteRestore(candidate.path);
      setBackupNote("Restarting with the restored data…");
      await restartForRestore();
    } catch (error) {
      setBackupProblem(true);
      setBackupNote(backupErrorMessage(error, "That backup could not be restored."));
      setBackupBusy(false);
    }
  };

  const restoreLocalCopy = async () => {
    const candidate = localRestoreCandidate;
    if (!candidate) return;
    setLocalRestoreCandidate(null);
    setBackupBusy(true);
    setBackupProblem(false);
    setBackupNote("Preparing the safety copy…");
    try {
      await stageLocalRestore(candidate.name);
      setBackupNote("Restarting with that copy of your training record…");
      await restartForRestore();
    } catch (error) {
      setBackupProblem(true);
      setBackupNote(backupErrorMessage(error, "That safety copy could not be put back."));
      setBackupBusy(false);
    }
  };

  const update = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const saveProfile = async () => {
    const result = await mutate((repos) =>
      repos.profile.update({
        ...draft,
        pilotName: draft.pilotName.trim(),
        certificateGoal: draft.certificateGoal.trim() || "Private Pilot",
        currentFocus: draft.currentFocus.trim(),
        flightSchool: draft.flightSchool.trim(),
        instructorName: draft.instructorName.trim(),
        homeAirport: draft.homeAirport.trim(),
        aircraftType: draft.aircraftType.trim(),
        whyNote: draft.whyNote.trim(),
      }),
    );
    if (result === null) return;
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  /** The accent applies the moment it is chosen, so she can see it. */
  const chooseAccent = async (accentColor: AccentColor) => {
    const previous = draft.accentColor;
    update("accentColor", accentColor);
    const result = await mutate((repos) => repos.profile.update({ accentColor }));
    if (result === null) update("accentColor", previous);
  };

  /** The appearance changes immediately and persists in localStorage. */
  const chooseAppearance = (choice: Appearance) => {
    setAppearance(choice);
    setStoredAppearance(choice);
    applyAppearance(choice);
  };

  const choosePhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    try {
      const photo = await readPhotoAsDataUrl(file);
      const result = await mutate((repos) => repos.profile.update({ photo }));
      if (result !== null) update("photo", photo);
    } catch (error) {
      setPhotoError(
        error instanceof PhotoError ? error.message : "That photo could not be added.",
      );
    } finally {
      // Let the same file be chosen again after a removal.
      if (photoInput.current) photoInput.current.value = "";
    }
  };

  const removePhoto = async () => {
    setPhotoError(null);
    const result = await mutate((repos) => repos.profile.update({ photo: null }));
    if (result !== null) update("photo", null);
  };

  const restoreStarter = async () => {
    setBusy(true);
    setStarterNote(null);
    const result = await mutate((repos) => restoreAirlineStarterPack(repos));
    if (result) {
      const added =
        result.milestones + result.goals + result.checklistItems + result.materials;
      setStarterNote(
        added > 0
          ? `Starter pack restored — ${added} roadmap and library items added.`
          : "The airline starter pack is already complete.",
      );
    }
    setBusy(false);
  };

  const duration = trainingDuration(draft.trainingStartedOn);

  return (
    <>
      <PageHeader title="Settings" subtitle="Your profile and how this application behaves." />

      <div className="stack stack--5">
        <Card>
          <CardHeader title="About you" eyebrow="Greeting and focus" />
          <CardBody>
            <MacNote>Use Save profile before closing the window with the red button.</MacNote>
            <div className="form-grid">
              <Field label="What should we call you?">
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={draft.pilotName}
                    placeholder="Ava"
                    onChange={(e) => update("pilotName", e.target.value)}
                  />
                )}
              </Field>

              <Field label="Certificate you are working toward">
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={draft.certificateGoal}
                    placeholder="Private Pilot"
                    onChange={(e) => update("certificateGoal", e.target.value)}
                  />
                )}
              </Field>

              <Field label="Current focus" hint="Shown beside your greeting.">
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    value={draft.currentFocus}
                    placeholder="Landings"
                    onChange={(e) => update("currentFocus", e.target.value)}
                  />
                )}
              </Field>

              <Field label="Current milestone">
                {({ id }) => (
                  <Select
                    id={id}
                    placeholder="Choose automatically"
                    options={data.milestones.map((m) => ({ value: m.id, label: m.title }))}
                    value={draft.currentMilestoneId ?? ""}
                    onChange={(value) => update("currentMilestoneId", value || null)}
                  />
                )}
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Where you train"
            eyebrow="Used to fill in new lessons"
          />
          <CardBody>
            <MacNote>
              Dates use the Mac&rsquo;s region and calendar settings; these fields remain optional.
            </MacNote>
            <p className="small muted" style={{ marginBottom: "var(--space-5)" }}>
              None of this is required. Before you have settled on a school you can
              leave it empty, or fill in only the parts that are true today.
            </p>
            <div className="form-grid">
              <Field label="Flight school" hint="Leave it blank while you are still choosing.">
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    value={draft.flightSchool}
                    placeholder="Cedar Field Aviation"
                    onChange={(e) => update("flightSchool", e.target.value)}
                  />
                )}
              </Field>

              <Field label="Instructor" hint="Filled in on each new lesson.">
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    value={draft.instructorName}
                    placeholder="Dana Whitfield"
                    onChange={(e) => update("instructorName", e.target.value)}
                  />
                )}
              </Field>

              <Field label="Home airport" hint="Filled in as the location.">
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    value={draft.homeAirport}
                    placeholder="Cedar Field"
                    onChange={(e) => update("homeAirport", e.target.value)}
                  />
                )}
              </Field>

              <Field label="Aircraft you fly">
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={draft.aircraftType}
                    placeholder="Cessna 172"
                    onChange={(e) => update("aircraftType", e.target.value)}
                  />
                )}
              </Field>

              <Field
                label="Training started"
                hint={
                  duration
                    ? `That is ${duration} of training so far.`
                    : "Optional — your first flight counts, school or not."
                }
              >
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    type="date"
                    aria-describedby={describedBy}
                    value={draft.trainingStartedOn ?? ""}
                    onChange={(e) => update("trainingStartedOn", e.target.value || null)}
                  />
                )}
              </Field>

              <Field
                label="Medical certificate expires"
                hint="Your own reminder — the certificate itself is what counts."
              >
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    type="date"
                    aria-describedby={describedBy}
                    value={draft.medicalExpiry ?? ""}
                    onChange={(e) => update("medicalExpiry", e.target.value || null)}
                  />
                )}
              </Field>
              {medicalConflict ? (
                <p className="small" role="note" style={{ gridColumn: "1 / -1" }}>
                  Your saved medical record “{medicalConflict.record.title}” in the Pilot Toolkit
                  says it expires {formatLongDate(medicalConflict.record.expiresOn)}, which
                  differs from the date saved here. Check your certificate, then choose the right
                  date under Certificates in the Pilot Toolkit or correct it here.
                </p>
              ) : null}
            </div>

            <div className="row" style={{ marginTop: "var(--space-5)" }}>
              <Button variant="primary" onClick={saveProfile}>
                Save profile
              </Button>
              {saved ? (
                <span className="small" style={{ color: "var(--status-complete)" }}>
                  Saved.
                </span>
              ) : null}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Why you started" eyebrow="Yours alone" />
          <CardBody>
            <MacNote>
              Export a picture from Photos or choose one from Finder. It is resized and stored
              in the app&rsquo;s private database.
            </MacNote>
            <div className="stack stack--5">
              <div className="photo-field">
                {draft.photo ? (
                  <img className="photo-preview" src={draft.photo} alt="" />
                ) : (
                  <span className="photo-placeholder" aria-hidden="true">
                    {draft.pilotName.trim().charAt(0).toUpperCase() || "\u2708"}
                  </span>
                )}

                <div className="stack stack--2">
                  <div className="row row--wrap">
                    <Button onClick={() => photoInput.current?.click()}>
                      {draft.photo ? "Change photo" : "Add a photo"}
                    </Button>
                    {draft.photo ? (
                      <Button variant="danger" className="destructive-action" onClick={removePhoto}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  <p className="tiny dim">
                    {draft.photo
                      ? `Stored in your private database, about ${Math.max(
                          1,
                          Math.round(dataUrlBytes(draft.photo) / 1024),
                        )} KB.`
                      : "Optional. It is resized on this computer and never leaves it."}
                  </p>
                  {photoError ? <p className="field__error">{photoError}</p> : null}
                </div>

                <input
                  ref={photoInput}
                  type="file"
                  accept="image/*"
                  hidden
                  aria-label="Choose a photo"
                  onChange={(e) => choosePhoto(e.target.files?.[0])}
                />
              </div>

              <Field
                label="Why did you start flying?"
                hint="Shown back to you on your Flight Deck. Nobody else reads it."
              >
                {({ id, describedBy }) => (
                  <TextArea
                    id={id}
                    rows={4}
                    aria-describedby={describedBy}
                    value={draft.whyNote}
                    placeholder="The first time I saw the airfield from the air, I knew."
                    onChange={(e) => update("whyNote", e.target.value)}
                  />
                )}
              </Field>

              <div className="row">
                <Button variant="primary" onClick={saveProfile}>
                  Save
                </Button>
                {saved ? (
                  <span className="small" style={{ color: "var(--status-complete)" }}>
                    Saved.
                  </span>
                ) : null}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Look and feel" eyebrow="Accent colour" />
          <CardBody>
            <MacNote>The accent follows Her Flight Deck on this Mac and changes immediately.</MacNote>
            <div className="stack stack--4">
              <p className="small muted">
                Changes the accent used across the application. Takes effect straight away.
              </p>
              <div className="accent-picker" role="group" aria-label="Accent colour">
                {ACCENT_ORDER.map((accent) => {
                  const selected = draft.accentColor === accent;
                  return (
                    <button
                      type="button"
                      key={accent}
                      className={`accent-option${selected ? " is-selected" : ""}`}
                      aria-pressed={selected}
                      onClick={() => chooseAccent(accent)}
                    >
                      <span
                        className="accent-option__swatch"
                        style={{ background: `var(--accent-swatch-${accent})` }}
                        aria-hidden="true"
                      >
                        {selected ? <CheckIcon size={15} /> : null}
                      </span>
                      {ACCENT_LABELS[accent]}
                    </button>
                  );
                })}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Appearance" eyebrow="Visual style" />
          <CardBody>
            <div className="stack stack--3">
              <p className="small muted">
                Glass gives cards a soft frosted look. Classic is the standard look.
              </p>
              <div
                className="row row--wrap"
                role="radiogroup"
                aria-label="Appearance"
                style={{ gap: "var(--space-4)" }}
              >
                <label
                  className="small"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="appearance"
                    value="classic"
                    checked={appearance === "classic"}
                    onChange={() => chooseAppearance("classic")}
                  />
                  <span>Classic</span>
                </label>
                <label
                  className="small"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="appearance"
                    value="glass"
                    checked={appearance === "glass"}
                    onChange={() => chooseAppearance("glass")}
                  />
                  <span>Glass</span>
                </label>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Airline pilot starter pack" eyebrow="Built-in guidance" />
          <CardBody>
            <PlatformGuidance
              mac="Restoring starter items changes only this Mac’s local library."
              windows="Restoring starter items changes only this computer’s local library."
              neutral="Restoring starter items changes only your local library."
            />
            <div className="stack stack--4">
              <p className="small muted">
                Includes a complete career roadmap from training foundations through ATP and
                airline applications, along with lesson checklists, debrief prompts, record
                organizers, and official FAA starting points. It never replaces her instructor,
                logbook, aircraft documents, or current regulations.
              </p>
              <div className="row row--wrap">
                <Button variant="primary" onClick={restoreStarter} disabled={busy}>
                  {busy ? "Working…" : "Restore missing starter items"}
                </Button>
                {starterNote ? (
                  <span className="small" style={{ color: "var(--status-complete)" }}>
                    {starterNote}
                  </span>
                ) : null}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Check library" eyebrow="Study Library files" />
          <CardBody>
            <div className="stack stack--4">
              <p className="small muted">
                Find study materials whose files are missing and stored files that are not linked to a material. Nothing changes until you choose an action.
              </p>
              <div>
                <Button onClick={() => void runLibraryCheck()} disabled={libraryBusy || !canHandleFiles()}>
                  {libraryBusy ? "Checking library…" : "Check library"}
                </Button>
              </div>
              {!canHandleFiles() ? <p className="tiny dim">Library file checks need the desktop app.</p> : null}
              {libraryNote ? (
                <p className="small" role={libraryProblem ? "alert" : "status"}>
                  {libraryNote}
                </p>
              ) : null}
              {libraryReport ? (
                <div className="stack stack--4" aria-label="Library check results">
                  <p className="small" role="status">
                    Checked {libraryReport.totalMaterials} materials and {libraryReport.totalFiles} stored files. {libraryReport.missingMaterials.length} missing files; {libraryReport.unlinkedFiles.length} unlinked files.
                  </p>
                  {libraryReport.missingMaterials.length > 0 ? (
                    <div className="stack stack--2">
                      <h3>Materials with missing files</h3>
                      <ul className="stack stack--2">
                        {libraryReport.missingMaterials.slice(0, libraryVisible).map((item) => (
                          <li key={item.id} className="row row--between row--wrap">
                            <span className="small wrap-anywhere"><strong>{item.title}</strong> — {item.originalFileName || item.filePath}</span>
                            <Button size="small" disabled={libraryBusy} onClick={() => void reattachLibraryMaterial(item.id)}>Re-attach file</Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {libraryReport.unlinkedFiles.length > 0 ? (
                    <div className="stack stack--2">
                      <h3>Stored files without a material</h3>
                      <ul className="stack stack--2">
                        {libraryReport.unlinkedFiles.slice(0, libraryVisible).map((file) => (
                          <li key={file.relativePath} className="row row--between row--wrap">
                            <span className="small wrap-anywhere"><strong>{file.fileName}</strong> ({formatFileSize(file.fileSize)})</span>
                            <span className="row row--wrap">
                              <Button size="small" disabled={libraryBusy} onClick={() => void importLibraryFile(file.relativePath)}>Add to library</Button>
                              <Button size="small" variant="danger" disabled={libraryBusy} onClick={() => setLibraryTrashCandidate(file)}>Move to trash</Button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {(libraryReport.missingMaterials.length > libraryVisible || libraryReport.unlinkedFiles.length > libraryVisible) ? (
                    <Button size="small" disabled={libraryBusy} onClick={() => setLibraryVisible((count) => count + 50)}>Show more results</Button>
                  ) : null}
                </div>
              ) : null}
              {libraryTrashUndo.length > 0 ? (
                <div className="stack stack--2" aria-label="Files recently moved to trash">
                  {libraryTrashUndo.map((item) => (
                    <div key={item.stagedId} className="row row--wrap">
                      <span className="small">{item.name} is in private trash.</span>
                      <Button size="small" disabled={libraryBusy} onClick={() => void undoLibraryTrash(item.stagedId)}>Undo move</Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Your data"
            eyebrow="Complete backup and restore"
            action={
              backupsAvailable() ? (
                <div className="row row--wrap">
                  <Button size="small" variant="primary" onClick={backUpNow} disabled={backupBusy}>
                    {backupBusy ? "Working…" : "Save complete backup"}
                  </Button>
                  <Button size="small" onClick={chooseRestore} disabled={backupBusy}>
                    Restore backup
                  </Button>
                </div>
              ) : null
            }
          />
          <CardBody>
            <div className="stack stack--4">
              <PlatformGuidance
                mac={
                  <>
                    App data lives under the displayed Application Support path, and{" "}
                    <strong>Open folder</strong> opens that exact folder in Finder. Complete
                    backups can be saved to Downloads or iCloud Drive, and imported documents
                    live in app-owned storage and move through complete backups.
                  </>
                }
                windows={
                  <>
                    App data lives under the displayed AppData path, and{" "}
                    <strong>Open folder</strong> opens that exact folder in File Explorer.
                    Complete backups can be saved to your preferred drive or cloud folder, and
                    imported documents live in app-owned storage and move through complete
                    backups.
                  </>
                }
                neutral={
                  <>
                    App data lives under the displayed path, and <strong>Open folder</strong> opens
                    that folder in your file manager. Imported documents live in app-owned storage
                    and move through complete backups.
                  </>
                }
              />

              {backupNote ? (
                <p
                  className="small"
                  role={backupProblem ? "alert" : "status"}
                  style={{ color: backupProblem ? "var(--status-danger)" : "var(--status-complete)" }}
                >
                  {backupNote}
                </p>
              ) : null}

              {backupsAvailable() ? (
                <p
                  className="small"
                  role="status"
                  style={{
                    color: protection.needsAttention
                      ? "var(--status-danger)"
                      : "var(--status-complete)",
                  }}
                >
                  <strong>{protection.needsAttention ? "Worth doing now: " : "Protected. "}</strong>
                  {protection.message}
                </p>
              ) : null}

              {lastBackup?.path ? (
                <p className="tiny dim wrap-anywhere">
                  Last saved to <code className="tiny">{lastBackup.path}</code>
                </p>
              ) : null}

              <p className="small muted">
                Save one portable <strong>.hfdbackup</strong> file containing the
                complete database, profile photo, flight log, and every uploaded study
                document. Nothing is uploaded anywhere. Keep the file on another drive
                or in a cloud folder so it is safe if this computer is lost.
              </p>

              <p className="tiny dim">
                Save a fresh backup <strong>before installing an update</strong>. If
                anything looks wrong afterwards, <strong>Restore backup</strong> puts
                that file back exactly as it was.
              </p>

              <p className="tiny dim">
                Restore checks the file first and asks for confirmation. Before it
                replaces anything, the app keeps a recoverable copy of the current data,
                then restarts with the restored copy.
              </p>

              {dataPath ? (
                <div className="stack stack--2">
                  <p className="tiny strong dim">Where it lives</p>
                  <div className="row row--between" style={{ gap: "var(--space-3)" }}>
                    <code className="tiny wrap-anywhere">{dataPath}</code>
                    <Button
                      size="small"
                      onClick={() => {
                        setFolderOpenError(null);
                        openDataFolder().catch((error: unknown) => {
                          setFolderOpenError(
                            backupErrorMessage(error, "That folder could not be opened."),
                          );
                        });
                      }}
                    >
                      Open folder
                    </Button>
                  </div>
                  {folderOpenError ? (
                    <p className="field__error" role="alert">
                      {folderOpenError}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="tiny dim">
                  Backups and the data folder are part of the desktop application.
                </p>
              )}

              <p className="tiny dim">
                The database copies below are made automatically before an update runs
                for the first time. They stay on this computer and hold your records,
                lessons and settings — not the uploaded files themselves, which are
                never moved. Use <strong>Save complete backup</strong> for protection
                against losing this computer.
              </p>

              {backupsAvailable() ? (
                <div className="row">
                  <Button size="small" onClick={copyDatabaseNow} disabled={backupBusy}>
                    Save a copy on this computer
                  </Button>
                </div>
              ) : null}

              {backups.length > 0 ? (
                <div className="stack stack--2">
                  <p className="tiny strong dim">Safety copies kept ({backups.length})</p>
                  {backups.slice(0, 6).map((backup) => (
                    <div className="row row--between" key={backup.name}>
                      <span className="small truncate">{describeBackup(backup.name)}</span>
                      <span className="row" style={{ gap: "var(--space-3)" }}>
                        <span className="tiny dim numeric">
                          {backupLocalDay(backup.name) ?? "Date unknown"} · {formatBytes(backup.bytes)}
                        </span>
                        {backup.restorable ? (
                          <Button
                            size="small"
                            onClick={() => setLocalRestoreCandidate(backup)}
                            disabled={backupBusy}
                          >
                            Put this back
                          </Button>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="About this application" eyebrow="Scope" />
          <CardBody>
            <PlatformGuidance
              mac={
                <>
                  Her Flight Deck supports macOS 12 or newer. Use only an official candidate installer.
                  If macOS displays a security warning, record the exact message for investigation.
                  Do not attempt to disable Gatekeeper or bypass platform security protections.
                </>
              }
              windows={
                <>
                  Use only a release obtained from the official release location.
                  If Defender or SmartScreen blocks or flags the installer, stop.
                  The build must remain private until Microsoft clears it or it receives trusted signing.
                  Do not add exclusions, disable protection, or click through the warning.
                </>
              }
              neutral={
                <>
                  Use only an official release obtained from the official release location.
                </>
              }
            />
            <p className="small muted">
              Her Flight Deck organizes the training information you put into it. It does not
              replace your flight instructor, your flight school, official aviation
              regulations, aircraft documentation, or required training. Where this
              application and an official or instructor-provided source disagree, the
              official source is correct.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Gemini study assistant"
            eyebrow={gemini?.configured ? "Connected" : "Optional online AI"}
          />
          <CardBody>
            <div className="stack stack--4">
              <PlatformGuidance
                mac="Google AI Studio opens in the default browser. The API key stays in this Mac’s Application Support folder and is not included in backups or SQLite."
                windows="Google AI Studio opens in the default browser. The API key stays in this computer’s application data folder and is not included in backups or SQLite."
                neutral="Google AI Studio opens in the default browser. The API key stays in your local application data folder and is not included in backups or SQLite."
              />
              <p className="small muted">
                Gemini can turn a selected Study Library document into a study guide and
                flashcards. Only files you deliberately analyze are sent to Google. Personal
                notes, flight logs, profile details, and other library files are never sent.
              </p>

              {gemini?.configured ? (
                <div className="gemini-connected">
                  <span className="gemini-connected__mark" aria-hidden="true">
                    <CheckIcon size={16} />
                  </span>
                  <div>
                    <p className="small strong">Ready to use</p>
                    <p className="tiny dim">
                      {geminiModelName(gemini.model)} · key saved on this computer
                    </p>
                  </div>
                </div>
              ) : geminiAvailable() ? (
                <div className="stack stack--3">
                  <div className="setup-steps small">
                    <p><strong>1.</strong> Open Google AI Studio and sign in with her Google account.</p>
                    <p><strong>2.</strong> Choose <em>Create API key</em>, then copy the key.</p>
                    <p><strong>3.</strong> Paste it below. The complete key is never shown again.</p>
                  </div>
                  <div className="row row--wrap">
                    <Button onClick={() => void openGeminiKeyPage()}>
                      Sign in with Google
                    </Button>
                    <TextInput
                      className="gemini-key-input"
                      type="password"
                      autoComplete="off"
                      aria-label="Gemini API key"
                      value={geminiKey}
                      placeholder="Paste Gemini API key"
                      onChange={(event) => setGeminiKey(event.target.value)}
                    />
                    <Button
                      variant="primary"
                      disabled={geminiBusy || geminiKey.trim().length < 20}
                      onClick={() => void connectGemini()}
                    >
                      {geminiBusy ? "Connecting…" : "Connect Gemini"}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="tiny dim">Gemini setup is available in the desktop application.</p>
              )}

              {gemini?.configured ? (
                <fieldset className="gemini-model-choice stack stack--2">
                  <legend className="field__label">Model for new study aids</legend>
                  {(["standard", "most-capable"] as const).map((choice) => (
                    <label key={choice} className="small">
                      <input
                        type="radio"
                        name="gemini-model-choice"
                        checked={gemini.choice === choice}
                        disabled={geminiBusy}
                        onChange={() => void chooseGeminiModel(choice)}
                      />{" "}
                      <span className="strong">{GEMINI_MODEL_CHOICES[choice].label}</span>
                      <span className="tiny dim"> — {GEMINI_MODEL_CHOICES[choice].detail}</span>
                    </label>
                  ))}
                  {gemini.choice === "most-capable" ? (
                    <p className="tiny dim">
                      If Gemini 3.8 Flash is busy, temporarily rate-limited or unavailable to this key,
                      Her Flight Deck tries Gemini 3.5 Flash instead and shows which model made each
                      study aid. If the request is still refused, check this key's access in Google AI Studio.
                    </p>
                  ) : null}
                </fieldset>
              ) : null}

              {geminiNote ? (
                <p
                  className="small"
                  role={geminiProblem ? "alert" : "status"}
                  style={{ color: geminiProblem ? "var(--status-danger)" : "var(--status-complete)" }}
                >
                  {geminiNote}
                </p>
              ) : null}

              <p className="tiny dim">
                Google states that free-tier content may be used to improve its products. Do
                not analyze medical records, certificates, addresses, or documents containing
                sensitive personal information. AI study material must be checked against the
                current source, FAA publications, aircraft documents, and her instructor.
              </p>

              <p className="tiny dim">
                <span className="strong">If Gemini keeps saying it is busy:</span> A “busy”
                message means Google is overloaded, not that your key is wrong. Her Flight Deck
                already waits and retries; if it keeps happening, try again later or switch to Standard.
              </p>

              {gemini?.configured ? (
                <div>
                  <Button variant="danger" size="small" disabled={geminiBusy} onClick={() => void removeGemini()}>
                    Disconnect Gemini
                  </Button>
                </div>
              ) : null}
            </div>
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={libraryTrashCandidate !== null}
        title="Move this unlinked file to trash?"
        message={libraryTrashCandidate ? `${libraryTrashCandidate.fileName} will leave active app storage. You can undo the move until the app restarts.` : ""}
        confirmLabel="Move to trash"
        destructive
        onConfirm={() => void moveLibraryFileToTrash()}
        onCancel={() => setLibraryTrashCandidate(null)}
      />

      <ConfirmDialog
        open={restoreCandidate !== null}
        title="Restore this complete backup?"
        message={
          restoreCandidate
            ? `This backup was created ${formatBackupDate(restoreCandidate.createdAt)} with app version ${restoreCandidate.appVersion}. It contains ${restoreCandidate.files} files (${formatBytes(restoreCandidate.bytes)}). ${restoreCandidate.missingDocuments && restoreCandidate.missingDocuments.length > 0 ? `${formatRestorePreviewMissingNotice(restoreCandidate.missingDocuments.length)} ` : ""}The app will protect the current data, replace it with this backup, and restart.`
            : ""
        }
        confirmLabel="Restore and restart"
        destructive
        onConfirm={restoreBackup}
        onCancel={() => setRestoreCandidate(null)}
      />

      <ConfirmDialog
        open={localRestoreCandidate !== null}
        title="Put this safety copy back?"
        message={
          localRestoreCandidate
            ? `This copy was ${describeBackup(localRestoreCandidate.name).toLowerCase()}, on ${backupLocalDay(localRestoreCandidate.name) ?? "an unknown date"}. Your records, lessons, notes and settings go back to how they were then; anything added since will not be in them. Your uploaded files are not touched. The app keeps a recoverable copy of the current data first, then restarts.`
            : ""
        }
        confirmLabel="Put it back and restart"
        destructive
        onConfirm={restoreLocalCopy}
        onCancel={() => setLocalRestoreCandidate(null)}
      />

    </>
  );
}
