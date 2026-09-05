import { useEffect, useState } from "react";

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
  TextInput,
} from "@/components/ui";
import { clearAllData, loadDemoData } from "@/data/seed";
import { ACCENT_LABELS, ACCENT_ORDER, type AccentColor, type Profile } from "@/domain/types";
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
  accentColor: profile.accentColor,
});

export function Settings() {
  const { data, mutate } = useAppData();
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFrom(data.profile));
  const [saved, setSaved] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [busy, setBusy] = useState(false);

  // Keep the form in step when the profile is replaced (demo load, reset).
  useEffect(() => {
    setDraft(draftFrom(data.profile));
  }, [data.profile]);

  const update = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const saveProfile = async () => {
    await mutate((repos) =>
      repos.profile.update({
        ...draft,
        pilotName: draft.pilotName.trim(),
        certificateGoal: draft.certificateGoal.trim() || "Private Pilot",
        currentFocus: draft.currentFocus.trim(),
        flightSchool: draft.flightSchool.trim(),
        instructorName: draft.instructorName.trim(),
        homeAirport: draft.homeAirport.trim(),
        aircraftType: draft.aircraftType.trim(),
      }),
    );
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  /** The accent applies the moment it is chosen, so she can see it. */
  const chooseAccent = (accentColor: AccentColor) => {
    update("accentColor", accentColor);
    void mutate((repos) => repos.profile.update({ accentColor }));
  };

  const runDemo = async () => {
    setBusy(true);
    await mutate((repos) => loadDemoData(repos));
    setBusy(false);
  };

  const runClear = async () => {
    setBusy(true);
    setConfirmingClear(false);
    await mutate((repos) => clearAllData(repos));
    setBusy(false);
  };

  const hasData = data.actions.length > 0 || data.events.length > 0 || data.materials.length > 0;
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
          <CardHeader title="Privacy" eyebrow="Where your material lives" />
          <CardBody>
            <div className="stack stack--3 small muted">
              <p>
                Study materials you add are copied into this application&rsquo;s own private
                data directory on this computer. Notes, journal entries, questions and
                financial records are stored in a local database in the same place.
              </p>
              <p>
                Nothing is uploaded anywhere, and personal material is never stored in the
                project&rsquo;s source repository.
              </p>
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
