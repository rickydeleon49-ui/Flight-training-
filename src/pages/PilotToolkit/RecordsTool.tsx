import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, CardBody, CardHeader, ConfirmDialog, Field, Select, TextArea, TextInput, TypedDateField, type TypedDateFieldHandle } from "@/components/ui";
import { CREDENTIAL_TYPE_LABELS, CREDENTIAL_TYPE_OPTIONS, type CredentialRecord, type CredentialType, type ToolkitState } from "@/domain/types";
import { formatLongDate, formatShortDate, todayIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import { daysUntil, medicalDateConflict, type MedicalDateChoice, reconcileMedicalDates } from "@/logic/toolkit";
import { useAppData } from "@/state/AppDataContext";
import { EndorsementChecklist } from "./ChecklistTools";
import { type PendingChoice, type ToolProps } from "./toolkitShared";

/**
 * Settings and the student's saved medical record disagree about when the medical
 * expires. The student says which matches the student's certificate; only then is the other
 * one updated to match.
 *
 * The first choice owns the outcome. A synchronous guard, held by the Toolkit
 * page so it survives a tab switch, stops a second click (even within the same
 * render) from queueing the opposite choice, and the
 * write itself re-reads both dates inside the serialized mutation: a choice
 * made against dates that have since changed writes nothing, and the dates as
 * they now stand are shown again.
 */
function MedicalDateConflictCard({
  state,
  guard,
  choosing,
}: {
  state: ToolkitState;
  guard: PendingChoice;
  choosing: boolean;
}) {
  const { data, mutate } = useAppData();
  const [staleNotice, setStaleNotice] = useState(false);
  const conflict = medicalDateConflict(data.profile, state.credentials);
  if (!conflict) return null;
  const { settingsDate, record } = conflict;
  const today = todayIso();

  const choose = async (authority: MedicalDateChoice["authority"]) => {
    if (!guard.acquire()) return;
    setStaleNotice(false);
    const choice: MedicalDateChoice = { authority, settingsDate, recordId: record.id, recordDate: record.expiresOn };
    try {
      const outcome = await mutate(async (repos) => {
        const [profile, toolkit] = await Promise.all([repos.profile.get(), repos.toolkit.get()]);
        const plan = reconcileMedicalDates(profile, toolkit.credentials, choice);
        if (plan.write === "profile") await repos.profile.update({ medicalExpiry: plan.medicalExpiry });
        if (plan.write === "record") await repos.toolkit.save({ ...toolkit, credentials: plan.credentials });
        return plan.write;
      });
      // null: the write failed and the app's error message says so; both
      // dates stay as they were and the student can choose again.
      if (outcome === "none") setStaleNotice(true);
    } finally {
      guard.release();
    }
  };

  return (
    <Card variant="grouped">
      <CardHeader title="Two different medical dates" />
      <CardBody>
        <div className="stack stack--3" role="note" aria-label="Medical dates differ" aria-busy={choosing}>
          <p className="small">
            Settings says your medical expires {formatLongDate(settingsDate, today)}. Your saved
            record “{record.title}” says {formatLongDate(record.expiresOn, today)}. Which one
            matches your certificate? Nothing changes until you choose.
          </p>
          {staleNotice ? (
            <p className="small" role="status">
              These dates changed before your choice was saved, so nothing was changed. Here they
              are as they stand now.
            </p>
          ) : null}
          <div className="row row--wrap">
            <Button size="small" disabled={choosing} onClick={() => void choose("record")}>
              {formatLongDate(record.expiresOn, today)} is right
            </Button>
            <Button size="small" disabled={choosing} onClick={() => void choose("settings")}>
              {formatLongDate(settingsDate, today)} is right
            </Button>
          </div>
          {choosing ? (
            <p className="tiny dim" role="status">
              Saving your choice…
            </p>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

const BLANK_CREDENTIAL_DRAFT = {
  type: "pilot_certificate" as CredentialType,
  title: "",
  identifier: "",
  issuedOn: "",
  expiresOn: "",
  notes: "",
  materialId: "",
};

export function RecordsTool({
  state,
  save,
  medicalChoice,
  medicalChoosing,
}: ToolProps & { medicalChoice: PendingChoice; medicalChoosing: boolean }) {
  const { data, deleteWithUndo } = useAppData();
  const [draft, setDraft] = useState(BLANK_CREDENTIAL_DRAFT);
  const draftStarted = (Object.keys(BLANK_CREDENTIAL_DRAFT) as (keyof typeof BLANK_CREDENTIAL_DRAFT)[])
    .some((key) => draft[key] !== BLANK_CREDENTIAL_DRAFT[key]);
  const [removing, setRemoving] = useState<CredentialRecord | null>(null);
  const issuedField = useRef<TypedDateFieldHandle>(null);
  const expiresField = useRef<TypedDateFieldHandle>(null);
  const today = todayIso();

  // A double-click must not add the record twice.
  const adding = useRef(false);
  const [addBusy, setAddBusy] = useState(false);
  const add = async () => {
    if (adding.current) return;
    // Both dates are optional, but a typed one that isn't a date is never saved as none.
    const issuedOk = issuedField.current?.check() ?? true;
    const expiresOk = expiresField.current?.check() ?? true;
    if (!draft.title.trim() || !issuedOk || !expiresOk) return;
    adding.current = true;
    setAddBusy(true);
    try {
      const record: CredentialRecord = {
        id: newId(),
        type: draft.type,
        title: draft.title.trim(),
        identifier: draft.identifier.trim(),
        issuedOn: draft.issuedOn || null,
        expiresOn: draft.expiresOn || null,
        notes: draft.notes.trim(),
        materialId: draft.materialId || null,
      };
      if (
        await save((current) => ({
          ...current,
          credentials: [...current.credentials, record],
        }))
      )
        setDraft(BLANK_CREDENTIAL_DRAFT);
    } finally {
      adding.current = false;
      setAddBusy(false);
    }
  };

  return (
    <div className="stack stack--5">
      <MedicalDateConflictCard state={state} guard={medicalChoice} choosing={medicalChoosing} />
      <Card variant="grouped">
        <CardHeader
          title="Add a certificate or record"
          eyebrow="Private organizer"
        />
        <CardBody>
          <div className="form-grid">
            <Field label="Record type">
              <Select
                options={CREDENTIAL_TYPE_OPTIONS}
                value={draft.type}
                onChange={(type) => setDraft({ ...draft, type })}
              />
            </Field>
            <Field label="Title">
              <TextInput
                value={draft.title}
                placeholder="e.g. Third-class medical"
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
              />
            </Field>
            <Field
              label="Certificate or reference number"
              hint="Optional. Stored only on this computer."
            >
              <TextInput
                value={draft.identifier}
                onChange={(event) =>
                  setDraft({ ...draft, identifier: event.target.value })
                }
              />
            </Field>
            <TypedDateField
              ref={issuedField}
              label="Issued"
              value={draft.issuedOn}
              onChange={(issuedOn) => setDraft((current) => ({ ...current, issuedOn }))}
            />
            <TypedDateField
              ref={expiresField}
              label="Expires"
              value={draft.expiresOn}
              onChange={(expiresOn) => setDraft((current) => ({ ...current, expiresOn }))}
            />
            <Field
              label="Attached library file"
              hint="Upload document copies in the Study Library first."
            >
              <Select
                placeholder="No attachment"
                options={data.materials
                  .filter((item) => item.filePath)
                  .map((item) => ({ value: item.id, label: item.title }))}
                value={draft.materialId}
                onChange={(materialId) => setDraft({ ...draft, materialId })}
              />
            </Field>
            <Field label="Notes" full>
              <TextArea
                rows={2}
                value={draft.notes}
                onChange={(event) =>
                  setDraft({ ...draft, notes: event.target.value })
                }
              />
            </Field>
          </div>
          <div className="row row--wrap toolkit-mt-4">
            <Button variant="primary" onClick={() => void add()} disabled={addBusy}>
              {addBusy ? "Saving…" : "Add record"}
            </Button>
            {draftStarted ? (
              <Button variant="ghost" onClick={() => setDraft(BLANK_CREDENTIAL_DRAFT)} disabled={addBusy}>
                Clear
              </Button>
            ) : null}
            <Link className="button button--secondary" to="/study">
              Upload a document copy
            </Link>
          </div>
        </CardBody>
      </Card>
      <Card variant="grouped">
        <CardHeader
          title="Certificates, endorsements, and records"
          action={
            <span className="tiny dim">{state.credentials.length} saved</span>
          }
        />
        <CardBody flush>
          {state.credentials.length === 0 ? (
            <p className="toolkit-empty small muted">No records saved yet.</p>
          ) : (
            state.credentials.map((record) => {
              const remaining = record.expiresOn
                ? daysUntil(record.expiresOn, today)
                : null;
              const material = data.materials.find(
                (item) => item.id === record.materialId,
              );
              return (
                <div
                  className="toolkit-row toolkit-row--record"
                  key={record.id}
                >
                  <div>
                    <p className="strong">{record.title}</p>
                    <p className="tiny dim">
                      {CREDENTIAL_TYPE_LABELS[record.type]}
                      {record.identifier ? ` · ${record.identifier}` : ""}
                    </p>
                    {record.expiresOn ? (
                      <p
                        className="tiny"
                        style={{
                          color:
                            remaining != null && remaining <= 30
                              ? "var(--status-overdue)"
                              : "var(--text-tertiary)",
                        }}
                      >
                        Expires {formatShortDate(record.expiresOn)}
                        {remaining != null && remaining < 0
                          ? " · may be expired"
                          : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="row row--wrap">
                    {material ? (
                      <Link
                        className="button button--ghost button--small"
                        to={`/study/${material.id}`}
                      >
                        Open copy
                      </Link>
                    ) : null}
                    <Button
                      size="small"
                      variant="danger"
                      className="destructive-action"
                      onClick={() => setRemoving(record)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardBody>
      </Card>
      <EndorsementChecklist state={state} save={save} />
      <p className="tiny dim">
        This organizer does not replace original certificates, endorsements,
        test reports, identification, or records required by the FAA or flight
        school.
      </p>
      <ConfirmDialog
        open={removing !== null}
        title="Remove this record?"
        message="This removes the organizer entry. An attached Study Library file is not deleted."
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          const record = removing;
          setRemoving(null);
          deleteWithUndo({
            ids: [record.id],
            label: record.title,
            run: async (repos) => {
              const current = await repos.toolkit.get();
              await repos.toolkit.save({
                ...current,
                credentials: current.credentials.filter(
                  (item) => item.id !== record.id,
                ),
              });
            },
          });
        }}
      />
    </div>
  );
}
