import { useEffect, useState } from "react";

import { Button, Dialog, Field, Select, TextArea, TextInput } from "@/components/ui";
import type { FlightSchool, FlightSchoolTrainingTrack, Options } from "@/domain/types";
import { moneyToInput, parseMoney } from "@/lib/money";

export interface SchoolFormDraft {
  name: string;
  hourlyCostCents: number | null;
  aircraftDescription: string | null;
  trainingTrack: FlightSchoolTrainingTrack | null;
  availabilityDescription: string | null;
  discoveryFlightReflection: string | null;
}

const TRACK_OPTIONS: Options<FlightSchoolTrainingTrack> = [
  { value: "Part 61", label: "Part 61" },
  { value: "Part 141", label: "Part 141" },
  { value: "not sure", label: "Not sure" },
];

const MAX_NAME_LENGTH = 200;
const MAX_AIRCRAFT_LENGTH = 2000;
const MAX_AVAILABILITY_LENGTH = 2000;
const MAX_REFLECTION_LENGTH = 20000;

interface Props {
  open: boolean;
  school?: FlightSchool | null;
  onClose: () => void;
  onSave: (draft: SchoolFormDraft) => Promise<boolean>;
}

export function SchoolFormDialog({
  open,
  school = null,
  onClose,
  onSave,
}: Props) {
  const [name, setName] = useState("");
  const [hourlyCost, setHourlyCost] = useState("");
  const [aircraftDescription, setAircraftDescription] = useState("");
  const [trainingTrack, setTrainingTrack] = useState<FlightSchoolTrainingTrack | "">("");
  const [availabilityDescription, setAvailabilityDescription] = useState("");
  const [discoveryFlightReflection, setDiscoveryFlightReflection] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSaveError(null);
    setSaving(false);
    if (school) {
      setName(school.name);
      setHourlyCost(moneyToInput(school.hourlyCostCents));
      setAircraftDescription(school.aircraftDescription ?? "");
      setTrainingTrack(school.trainingTrack ?? "");
      setAvailabilityDescription(school.availabilityDescription ?? "");
      setDiscoveryFlightReflection(school.discoveryFlightReflection ?? "");
    } else {
      setName("");
      setHourlyCost("");
      setAircraftDescription("");
      setTrainingTrack("");
      setAvailabilityDescription("");
      setDiscoveryFlightReflection("");
    }
  }, [open, school]);

  const submit = async () => {
    if (saving) return;
    const found: Record<string, string> = {};
    const trimmedName = name.trim();

    if (!trimmedName) {
      found.name = "Enter a school name.";
    } else if (trimmedName.length > MAX_NAME_LENGTH) {
      found.name = `School name must be ${MAX_NAME_LENGTH} characters or fewer.`;
    }

    let parsedCents: number | null = null;
    const trimmedCost = hourlyCost.trim();
    if (trimmedCost !== "") {
      const cleaned = trimmedCost.replace(/[$,\s]/g, "");
      const dotIndex = cleaned.indexOf(".");
      const hasExcessDecimals = dotIndex !== -1 && cleaned.length - dotIndex - 1 > 2;

      parsedCents = parseMoney(trimmedCost);
      if (
        hasExcessDecimals ||
        parsedCents === null ||
        parsedCents < 0 ||
        !Number.isSafeInteger(parsedCents)
      ) {
        found.hourlyCost = "Enter dollars and cents, such as 175.50, or leave this blank.";
      }
    }

    if (aircraftDescription.length > MAX_AIRCRAFT_LENGTH) {
      found.aircraftDescription = `Aircraft description must be ${MAX_AIRCRAFT_LENGTH} characters or fewer.`;
    }

    if (availabilityDescription.length > MAX_AVAILABILITY_LENGTH) {
      found.availabilityDescription = `Availability description must be ${MAX_AVAILABILITY_LENGTH} characters or fewer.`;
    }

    if (discoveryFlightReflection.length > MAX_REFLECTION_LENGTH) {
      found.discoveryFlightReflection = `Reflection must be ${MAX_REFLECTION_LENGTH} characters or fewer.`;
    }

    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    setSaveError(null);
    try {
      const ok = await onSave({
        name: trimmedName,
        hourlyCostCents: parsedCents,
        aircraftDescription: aircraftDescription ? aircraftDescription : null,
        trainingTrack: trainingTrack ? trainingTrack : null,
        availabilityDescription: availabilityDescription ? availabilityDescription : null,
        discoveryFlightReflection: discoveryFlightReflection ? discoveryFlightReflection : null,
      });
      if (ok) {
        onClose();
      } else {
        setSaveError("Could not save flight school. Please try again.");
      }
    } catch {
      setSaveError("Could not save flight school. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const title = school ? "Edit flight school" : "Add flight school";

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={title}
      description="Compare options before you enroll. Only the school name is required."
      dismissible={!saving}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : school ? "Save changes" : "Add school"}
          </Button>
        </>
      }
    >
      {saveError ? (
        <p className="field__error" role="alert" style={{ marginBottom: "var(--space-3)" }}>
          {saveError}
        </p>
      ) : null}
      <div className="form-grid">
        <Field label="School name" error={errors.name} full>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={name}
              placeholder="e.g. Blue Sky Aviation"
              disabled={saving}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>

        <Field
          label="Quoted hourly cost"
          hint="Optional. Enter the hourly quote in dollars. Check whether it includes fuel and instructor time."
          error={errors.hourlyCost}
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              inputMode="decimal"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={hourlyCost}
              placeholder="e.g. 210"
              disabled={saving}
              onChange={(e) => setHourlyCost(e.target.value)}
            />
          )}
        </Field>

        <Field label="Training track" hint="Optional. Choose Part 61 or Part 141 if you know which program the school offers.">
          {({ id }) => (
            <Select<FlightSchoolTrainingTrack>
              id={id}
              options={TRACK_OPTIONS}
              placeholder="Not selected"
              value={trainingTrack}
              disabled={saving}
              onChange={(val) => setTrainingTrack(val)}
            />
          )}
        </Field>

        <Field
          label="Aircraft"
          hint="Which aircraft would you fly? Add any notes about them."
          error={errors.aircraftDescription}
          full
        >
          {({ id, describedBy, invalid }) => (
            <TextArea
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={aircraftDescription}
              placeholder="e.g. C172N with dual G5s, well maintained"
              rows={2}
              disabled={saving}
              onChange={(e) => setAircraftDescription(e.target.value)}
            />
          )}
        </Field>

        <Field
          label="Availability"
          hint="Days and times that work for you, and how far ahead you need to book."
          error={errors.availabilityDescription}
          full
        >
          {({ id, describedBy, invalid }) => (
            <TextArea
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={availabilityDescription}
              placeholder="e.g. Online app booking, instructors booked 1-2 weeks out"
              rows={2}
              disabled={saving}
              onChange={(e) => setAvailabilityDescription(e.target.value)}
            />
          )}
        </Field>

        <Field
          label="How the discovery flight felt"
          hint="What felt comfortable? What would you ask about next time?"
          error={errors.discoveryFlightReflection}
          full
        >
          {({ id, describedBy, invalid }) => (
            <TextArea
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={discoveryFlightReflection}
              placeholder="Reflections on your flight, how patient the instructor was, overall impressions…"
              rows={3}
              disabled={saving}
              onChange={(e) => setDiscoveryFlightReflection(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
