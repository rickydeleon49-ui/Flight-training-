import { useEffect, useState } from "react";

import { PageHeader } from "@/components/layout/PageHeader";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Field,
  Select,
  TextInput,
} from "@/components/ui";
import { clearAllData, loadDemoData } from "@/data/seed";
import { useAppData } from "@/state/AppDataContext";

export function Settings() {
  const { data, mutate } = useAppData();
  const [name, setName] = useState(data.profile.pilotName);
  const [certificate, setCertificate] = useState(data.profile.certificateGoal);
  const [focus, setFocus] = useState(data.profile.currentFocus);
  const [milestoneId, setMilestoneId] = useState(data.profile.currentMilestoneId ?? "");
  const [saved, setSaved] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [busy, setBusy] = useState(false);

  // Keep the form in step when the profile is replaced (demo load, reset).
  useEffect(() => {
    setName(data.profile.pilotName);
    setCertificate(data.profile.certificateGoal);
    setFocus(data.profile.currentFocus);
    setMilestoneId(data.profile.currentMilestoneId ?? "");
  }, [data.profile]);

  const saveProfile = async () => {
    await mutate((repos) =>
      repos.profile.update({
        pilotName: name.trim(),
        certificateGoal: certificate.trim() || "Private Pilot",
        currentFocus: focus.trim(),
        currentMilestoneId: milestoneId || null,
      }),
    );
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
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

  return (
    <>
      <PageHeader title="Settings" subtitle="Your profile and how this application behaves." />

      <div className="stack stack--5">
        <Card>
          <CardHeader title="Your profile" eyebrow="Greeting and focus" />
          <CardBody>
            <div className="form-grid">
              <Field label="What should we call you?">
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={name}
                    placeholder="Ava"
                    onChange={(e) => setName(e.target.value)}
                  />
                )}
              </Field>

              <Field label="Certificate you are working toward">
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={certificate}
                    placeholder="Private Pilot"
                    onChange={(e) => setCertificate(e.target.value)}
                  />
                )}
              </Field>

              <Field label="Current focus" hint="Shown beside your greeting.">
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    value={focus}
                    placeholder="Landings"
                    onChange={(e) => setFocus(e.target.value)}
                  />
                )}
              </Field>

              <Field label="Current milestone">
                {({ id }) => (
                  <Select
                    id={id}
                    placeholder="Choose automatically"
                    options={data.milestones.map((m) => ({ value: m.id, label: m.title }))}
                    value={milestoneId}
                    onChange={(value) => setMilestoneId(value)}
                  />
                )}
              </Field>
            </div>

            <div className="row" style={{ marginTop: "var(--space-5)" }}>
              <Button variant="primary" onClick={saveProfile}>
                Save profile
              </Button>
              {saved ? <span className="small" style={{ color: "var(--status-complete)" }}>Saved.</span> : null}
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
