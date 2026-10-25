import { useState } from "react";

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EditIcon,
  EmptyState,
  IconButton,
  PlaneIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/ui";
import type { FlightSchool } from "@/domain/types";
import { formatMoney } from "@/lib/money";
import { useAppData } from "@/state/AppDataContext";
import { SchoolFormDialog, type SchoolFormDraft } from "./SchoolFormDialog";

interface Props {
  schools?: FlightSchool[];
}

export function SchoolComparisonPanel({ schools: propSchools }: Props) {
  const { data, mutate, deleteWithUndo } = useAppData();
  const schools = propSchools ?? data.flightSchools;

  const [formOpen, setFormOpen] = useState(false);
  const [editingSchool, setEditingSchool] = useState<FlightSchool | null>(null);
  const [deletingSchool, setDeletingSchool] = useState<FlightSchool | null>(null);

  const handleOpenAdd = () => {
    setEditingSchool(null);
    setFormOpen(true);
  };

  const handleEdit = (school: FlightSchool) => {
    setEditingSchool(school);
    setFormOpen(true);
  };

  const handleCloseForm = () => {
    setFormOpen(false);
    setEditingSchool(null);
  };

  const handleSave = async (draft: SchoolFormDraft): Promise<boolean> => {
    if (editingSchool) {
      const result = await mutate((repos) =>
        repos.flightSchools.update(editingSchool.id, draft),
      );
      return result !== null;
    } else {
      const result = await mutate((repos) =>
        repos.flightSchools.create(draft),
      );
      return result !== null;
    }
  };

  const handleDeleteConfirm = () => {
    if (!deletingSchool) return;
    const target = deletingSchool;
    deleteWithUndo({
      ids: [target.id],
      label: target.name,
      run: (repos) => repos.flightSchools.remove(target.id),
    });
    setDeletingSchool(null);
  };

  return (
    <Card className="school-comparison-card">
      <CardHeader
        title="Compare flight schools"
        action={
          <Button onClick={handleOpenAdd} size="small" variant={schools.length === 0 ? "primary" : "secondary"}>
            <PlusIcon size={14} /> Add school
          </Button>
        }
      />
      <CardBody>
        <p className="school-comparison__note tiny dim">
          Keep each school’s quoted costs, aircraft and availability together. Hourly quotes may include different things, such as fuel or instructor time.
        </p>

        {schools.length === 0 ? (
          <EmptyState
            icon={<PlaneIcon size={28} />}
            title="No flight schools added yet"
            body="Add a school when you’re ready. You only need its name."
          />
        ) : (
          <div className="school-grid">
            {schools.map((school) => {
              const costDisplay =
                school.hourlyCostCents !== null
                  ? `${formatMoney(school.hourlyCostCents)} / hour`
                  : "Rate not quoted";
              const trackDisplay =
                school.trainingTrack === "not sure"
                  ? "Not sure yet"
                  : school.trainingTrack;

              return (
                <div key={school.id} className="school-item-card" data-testid={`school-card-${school.id}`}>
                  <div className="school-item-card__header">
                    <div className="school-item-card__title-row">
                      <h3 className="school-item-card__name wrap-anywhere">{school.name}</h3>
                      <div className="school-item-card__actions">
                        <IconButton
                          label={`Edit ${school.name}`}
                          onClick={() => handleEdit(school)}
                        >
                          <EditIcon size={14} />
                        </IconButton>
                        <IconButton
                          className="destructive-action"
                          tone="danger"
                          label={`Remove ${school.name}`}
                          onClick={() => setDeletingSchool(school)}
                        >
                          <TrashIcon size={14} />
                        </IconButton>
                      </div>
                    </div>
                    <div className="school-item-card__badges">
                      <span className="school-item-card__rate">{costDisplay}</span>
                      {trackDisplay ? (
                        <Badge tone="neutral">{trackDisplay}</Badge>
                      ) : (
                        <Badge tone="neutral">Track not added</Badge>
                      )}
                    </div>
                  </div>

                  <div className="school-item-card__body stack stack--2">
                    {school.aircraftDescription && (
                      <div className="school-item-card__section">
                        <span className="school-item-card__section-label">Aircraft</span>
                        <p className="school-item-card__section-text wrap-anywhere">
                          {school.aircraftDescription}
                        </p>
                      </div>
                    )}

                    {school.availabilityDescription && (
                      <div className="school-item-card__section">
                        <span className="school-item-card__section-label">Availability</span>
                        <p className="school-item-card__section-text wrap-anywhere">
                          {school.availabilityDescription}
                        </p>
                      </div>
                    )}

                    {school.discoveryFlightReflection && (
                      <div className="school-item-card__section">
                        <span className="school-item-card__section-label">Discovery flight reflection</span>
                        <p className="school-item-card__section-text school-item-card__reflection wrap-anywhere">
                          {school.discoveryFlightReflection}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>

      <SchoolFormDialog
        open={formOpen}
        school={editingSchool}
        onClose={handleCloseForm}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={deletingSchool !== null}
        title="Remove flight school?"
        message={
          deletingSchool
            ? `Are you sure you want to remove "${deletingSchool.name}" from your comparison list? You can undo this for a few seconds.`
            : ""
        }
        confirmLabel="Remove school"
        destructive
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeletingSchool(null)}
      />
    </Card>
  );
}
