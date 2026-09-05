import { useEffect, useRef, useState } from "react";

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
import { clearAllData, loadDemoData } from "@/data/seed";
import { ACCENT_LABELS, ACCENT_ORDER, type AccentColor, type Profile } from "@/domain/types";
import { dataUrlBytes, PhotoError, readPhotoAsDataUrl } from "@/lib/image";
import {
  backupsAvailable,
  createBackup,
  dataDirectory,
  describeBackup,
  formatBytes,
  listBackups,
  revealFolder,
  type BackupInfo,
} from "@/services/backups";
import { clearDocuments } from "@/services/documents";
import { trainingDuration } from "@/logic/keyDates";
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
  const { data, mutate } = useAppData();
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFrom(data.profile));
  const [saved, setSaved] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [dataPath, setDataPath] = useState("");
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupNote, setBackupNote] = useState<string | null>(null);

  // Keep the form in step when the profile is replaced (demo load, reset).
  useEffect(() => {
    setDraft(draftFrom(data.profile));
  }, [data.profile]);

  const refreshBackups = async () => {
    if (!backupsAvailable()) return;
    setDataPath(await dataDirectory());
    setBackups(await listBackups());
  };

  useEffect(() => {
    void refreshBackups();
  }, []);

  const backUpNow = async () => {
    setBackupNote(null);
    try {
      await createBackup();
      await refreshBackups();
      setBackupNote("Database copy saved.");
      window.setTimeout(() => setBackupNote(null), 3000);
    } catch (error) {
      setBackupNote(error instanceof Error ? error.message : "That did not work.");
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

  const runDemo = async () => {
    setBusy(true);
    await mutate((repos) => loadDemoData(repos));
    setBusy(false);
  };

  const runClear = async () => {
    setBusy(true);
    setConfirmingClear(false);
    await mutate(async (repos) => {
      // Delete files before their database rows so a file error leaves the
      // library intact and the user can safely retry.
      await clearDocuments();
      await clearAllData(repos);
    });
    setBusy(false);
  };

  const hasData = [
    data.milestones,
    data.goals,
    data.checklistItems,
    data.actions,
    data.materials,
    data.events,
    data.prepItems,
    data.journalEntries,
    data.questions,
    data.transactions,
    data.fundGoals,
  ].some((items) => items.length > 0);
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
          <CardHeader title="Demo data" eyebrow="Development" />
          <CardBody>
            <div className="stack stack--4">
              <p className="small muted">
                Fills the application with a clearly fictional training scenario so you can
                see how the screens behave with real content. None of it refers to a real
                person, school, or document.
              </p>
              <div className="row row--wrap">
                <Button variant="primary" onClick={runDemo} disabled={busy}>
                  {busy ? "Working…" : "Load demo data"}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => setConfirmingClear(true)}
                  disabled={busy || !hasData}
                >
                  Clear everything
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Your data"
            eyebrow="Kept across updates"
            action={
              backupsAvailable() ? (
                <div className="row">
                  {backupNote ? (
                    <span className="tiny" style={{ color: "var(--status-complete)" }}>
                      {backupNote}
                    </span>
                  ) : null}
                  <Button size="small" onClick={backUpNow}>
                    Back up database
                  </Button>
                </div>
              ) : null
            }
          />
          <CardBody>
            <div className="stack stack--4">
              <p className="small muted">
                Everything you enter lives in one folder on this computer — your
                database, your study materials, your photo. Nothing is uploaded
                anywhere. A safety copy of the database is made automatically before
                the first run of any new version. Imported study files remain in this
                folder unchanged.
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
                These copies sit inside that same folder, so they protect you from a
                bad update rather than from losing this computer. Copy the folder
                somewhere else now and then.
              </p>

              {backups.length > 0 ? (
                <div className="stack stack--2">
                  <p className="tiny strong dim">Database copies kept ({backups.length})</p>
                  {backups.slice(0, 6).map((backup) => (
                    <div className="row row--between" key={backup.name}>
                      <span className="small truncate">{describeBackup(backup.name)}</span>
                      <span className="tiny dim numeric">
                        {backup.name.slice(0, 10)} · {formatBytes(backup.bytes)}
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
      </div>

      <ConfirmDialog
        open={confirmingClear}
        title="Clear everything?"
        message="This removes every goal, lesson, material, journal entry, question and transaction from this application. It cannot be undone."
        confirmLabel="Clear everything"
        onConfirm={runClear}
        onCancel={() => setConfirmingClear(false)}
      />
    </>
  );
}
