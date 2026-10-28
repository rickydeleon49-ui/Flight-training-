import { useEffect, useState } from "react";

import { Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorNote } from "@/components/ui";
import type { OralScenario } from "@/data/oralScenarios";
import type { StudyMaterial } from "@/domain/types";
import { useAppData } from "@/state/AppDataContext";
import { OralPracticeDialog } from "./OralPracticeDialog";
import { OralScenarioEditor } from "./OralScenarioEditor";

/** The first line of a scenario, kept short for the list. */
export function oralScenarioTitle(prompt: string): string {
  const first = prompt.trim().split(/\r?\n/)[0] ?? "";
  return first.length > 80 ? `${first.slice(0, 77)}…` : first;
}

/**
 * "Practice an oral question": her saved scenarios for this material, each
 * with Practise, and one Add a scenario. No grid, no totals.
 */
export function OralScenariosCard({ material }: { material: StudyMaterial }) {
  const { repositories, dataRevision, mutate, deleteWithUndo, pendingDelete } = useAppData();
  const [scenarios, setScenarios] = useState<OralScenario[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState<{ scenario: OralScenario | null } | null>(null);
  const [practising, setPractising] = useState<number | null>(null);
  const [removing, setRemoving] = useState<OralScenario | null>(null);

  useEffect(() => {
    if (!repositories) return;
    let live = true;
    repositories.oralScenarios.list(material.id).then(
      (list) => {
        if (!live) return;
        setScenarios(list);
        setLoadFailed(false);
      },
      () => {
        if (live) setLoadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [repositories, material.id, dataRevision]);

  // A scenario waiting to be removed is already gone as far as she can see.
  const hidden = new Set(pendingDelete?.ids ?? []);
  const visible = scenarios.filter((s) => !hidden.has(s.id));

  const move = (from: number, to: number) => {
    const order = visible.map((s) => s.id);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved!);
    // A scenario still waiting on Undo is saved until then, so it keeps a place (last).
    for (const s of scenarios) if (hidden.has(s.id)) order.push(s.id);
    void mutate((repos) => repos.oralScenarios.reorder(material.id, order));
  };
  const canMove = visible.length > 1;

  return (
    <Card>
      <CardHeader
        title="Practice an oral question"
        action={
          <Button size="small" variant="secondary" onClick={() => setEditing({ scenario: null })}>
            Add a scenario
          </Button>
        }
      />
      <CardBody>
        <div className="stack stack--3">
          <p className="small muted">
            Practice answering out loud, using scenarios you write yourself or copy from your instructor.
          </p>
          {loadFailed ? <ErrorNote>Your scenarios could not be loaded right now.</ErrorNote> : null}
          {visible.length > 0 ? (
            <ol className="stack stack--2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {visible.map((scenario, at) => {
                const title = oralScenarioTitle(scenario.prompt);
                return (
                  <li key={scenario.id} className="stack stack--1">
                    <p className="small wrap-anywhere">
                      {title}
                      {scenario.origin === "instructor" ? <span className="tiny muted"> · From my instructor</span> : null}
                    </p>
                    <div className="row row--wrap row--gap-2">
                      <Button size="small" variant="primary" onClick={() => setPractising(at)} aria-label={`Practise: ${title}`}>
                        Practise
                      </Button>
                      <Button size="small" onClick={() => setEditing({ scenario })} aria-label={`Edit: ${title}`}>
                        Edit
                      </Button>
                      {canMove ? (
                        <>
                          <Button size="small" onClick={() => move(at, at - 1)} disabled={at === 0} aria-label={`Move up: ${title}`}>
                            Move up
                          </Button>
                          <Button
                            size="small"
                            onClick={() => move(at, at + 1)}
                            disabled={at === visible.length - 1}
                            aria-label={`Move down: ${title}`}
                          >
                            Move down
                          </Button>
                        </>
                      ) : null}
                      <Button size="small" onClick={() => setRemoving(scenario)} aria-label={`Remove: ${title}`}>
                        Remove
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>
      </CardBody>
      <OralScenarioEditor
        material={material}
        scenario={editing?.scenario ?? null}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
      <OralPracticeDialog
        material={material}
        scenarios={visible}
        startIndex={practising ?? 0}
        open={practising !== null}
        onClose={() => setPractising(null)}
      />
      <ConfirmDialog
        open={removing !== null}
        title="Remove this scenario?"
        message="It leaves your list. Your notes and questions are kept."
        confirmLabel="Remove"
        onConfirm={() => {
          const scenario = removing!;
          setRemoving(null);
          deleteWithUndo({
            ids: [scenario.id],
            label: oralScenarioTitle(scenario.prompt),
            run: (repos) => repos.oralScenarios.remove(material.id, scenario.id),
          });
        }}
        onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}
