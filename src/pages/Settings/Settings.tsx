import { useEffect, useMemo, useRef, useState } from "react";

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
import { dataUrlBytes, PhotoError, readPhotoAsDataUrl } from "@/lib/image";
import {
  appVersion,
  backupErrorMessage,
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
  revealFolder,
  stageCompleteRestore,
  stageLocalRestore,
  type BackupInfo,
  type CompleteBackupInfo,
} from "@/services/backups";
import { backupHealth, restoreWarning } from "@/logic/dataSafety";
import { trainingDuration } from "@/logic/keyDates";
import {
  configureGemini,
  disconnectGemini,
  geminiAvailable,
  geminiErrorMessage,
  getGeminiStatus,
  openGeminiKeyPage,
  type GeminiStatus,
} from "@/services/gemini";
import { useAppData } from "@/state/AppDataContext";

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

export function Settings() {
  const { data, mutate, repositories } = useAppData();
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFrom(data.profile));
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [starterNote, setStarterNote] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [dataPath, setDataPath] = useState("");
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

  // Keep the form in step when the stored profile changes.
  useEffect(() => {
    setDraft(draftFrom(data.profile));
  }, [data.profile]);

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
      const destination = await chooseCompleteBackupDestination();
      if (!destination) return;
      // Make the main database file self-contained before Rust archives it.
      if (!repositories) throw new Error("The database is still starting. Try again in a moment.");
      await repositories.app.checkpoint();
      const backup = await createCompleteBackup(destination);

      // Remembering this is what lets the app tell her later that the backup
      // she has predates an update.
      const record = {
        at: new Date().toISOString(),
        version: backup.appVersion,
        path: backup.path,
      };
      await repositories.app.recordCompleteBackup(record);
      setLastBackup(record);
      setBackupNote(
        `Complete backup saved — ${backup.files} files, ${formatBytes(backup.bytes)} protected.`,
      );
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
            <div className="form-grid">
              <Field label="Flight school">
                {({ id }) => (
                  <TextInput
                    id={id}
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
                hint={duration ? `That is ${duration} of training so far.` : "Optional."}
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
                      <Button variant="danger" onClick={removePhoto}>
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
          <CardHeader title="Airline pilot starter pack" eyebrow="Built-in guidance" />
          <CardBody>
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
                    <Button size="small" onClick={() => revealFolder(dataPath)}>
                      Open folder
                    </Button>
                  </div>
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
                          {backup.name.slice(0, 10)} · {formatBytes(backup.bytes)}
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
                    <p className="tiny dim">{gemini.model} · key protected by this computer</p>
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
        open={restoreCandidate !== null}
        title="Restore this complete backup?"
        message={
          restoreCandidate
            ? `This backup was created ${formatBackupDate(restoreCandidate.createdAt)} with app version ${restoreCandidate.appVersion}. It contains ${restoreCandidate.files} files (${formatBytes(restoreCandidate.bytes)}). The app will protect the current data, replace it with this backup, and restart.`
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
            ? `This copy was ${describeBackup(localRestoreCandidate.name).toLowerCase()}, on ${localRestoreCandidate.name.slice(0, 10)}. Your records, lessons, notes and settings go back to how they were then; anything added since will not be in them. Your uploaded files are not touched. The app keeps a recoverable copy of the current data first, then restarts.`
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
