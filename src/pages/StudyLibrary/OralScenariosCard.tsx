import { useEffect, useState } from "react";
import { useInRouterContext, useLocation } from "react-router-dom";

import { Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorNote } from "@/components/ui";
import type { OralScenario } from "@/data/oralScenarios";
import type { StudyMaterial } from "@/domain/types";
import { useAppData } from "@/state/AppDataContext";
import { oralScenarioTitle, pickMockOral, MOCK_ORAL_MIN } from "@/logic/oralPractice";
import { OralPracticeDialog, lastPractisedAt } from "./OralPracticeDialog";
import { OralScenarioEditor } from "./OralScenarioEditor";

export { oralScenarioTitle };

/**
 * "Practice an oral question": the student's saved scenarios for this material, each
 * with Practice, and one Add a scenario. No grid, no totals.
 */
export function OralScenariosCard({ material }: { material: StudyMaterial }) {
  const inRouter = useInRouterContext();
  return inRouter ? <OralScenariosCardRouted material={material} /> : <OralScenariosCardBody material={material} wanted={null} />;
}

/** `?scenario=<id>` (from the Needs work list) scrolls to and highlights that scenario. */
function OralScenariosCardRouted({ material }: { material: StudyMaterial }) {
  const wanted = new URLSearchParams(useLocation().search).get("scenario");
  return <OralScenariosCardBody material={material} wanted={wanted} />;
}

function OralScenariosCardBody({ material, wanted }: { material: StudyMaterial; wanted: string | null }) {
  const { repositories, dataRevision, mutate, deleteWithUndo, pendingDelete } = useAppData();
  const [scenarios, setScenarios] = useState<OralScenario[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState<{ scenario: OralScenario | null } | null>(null);
  const [practising, setPractising] = useState<number | null>(null);
  const [removing, setRemoving] = useState<OralScenario | null>(null);
  const [mockSet, setMockSet] = useState<OralScenario[] | null>(null);

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

  // A scenario waiting to be removed is already gone as far as the student can see.
  const hidden = new Set(pendingDelete?.ids ?? []);
  const visible = scenarios.filter((s) => !hidden.has(s.id));

  const targetPresent = wanted !== null && visible.some((s) => s.id === wanted);
  useEffect(() => {
    if (!targetPresent) return;
    const row = document.getElementById(`oral-scenario-${wanted}`);
    if (!row) return;
    row.closest("details")?.setAttribute("open", "");
    row.focus({ preventScroll: true });
    row.scrollIntoView?.({ block: "center" });
  }, [targetPresent, wanted]);

  const move = (from: number, to: number) => {
    const order = visible.map((s) => s.id);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved!);
    // A scenario still waiting on Undo is saved until then, so it keeps a place (last).
    for (const s of scenarios) if (hidden.has(s.id)) order.push(s.id);
    void mutate((repos) => repos.oralScenarios.reorder(material.id, order));
  };
  const startMock = async () => {
    if (!repositories) return;
    const last = await lastPractisedAt(repositories, visible);
    const picked = pickMockOral(visible, last);
    if (picked.length > 0) setMockSet(picked);
  };
  const canMove = visible.length > 1;

  const body = (
      <CardBody>
        <div className="stack stack--3">
          <p className="small muted">
            Practice answering out loud, using scenarios you write yourself or copy from your instructor.
          </p>
          {loadFailed ? <ErrorNote>Your scenarios could not be loaded right now.</ErrorNote> : null}
          {visible.length >= MOCK_ORAL_MIN ? (
            <div>
              <Button size="small" onClick={() => void startMock()}>
                Mock oral
              </Button>
              <p className="tiny muted">Runs 3 to 5 of your scenarios, the ones you practised least recently first.</p>
            </div>
          ) : null}
          {visible.length > 0 ? (
            <ol className="stack stack--2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {visible.map((scenario, at) => {
                const title = oralScenarioTitle(scenario.prompt);
                return (
                  <li key={scenario.id} id={`oral-scenario-${scenario.id}`} tabIndex={-1}
                    className="stack stack--1" data-target={scenario.id === wanted ? "true" : undefined}
                    style={scenario.id === wanted ? { outline: "3px solid var(--border-focus)", borderRadius: 12, padding: 8 } : undefined}>
                    <p className="small wrap-anywhere">
                      {title}
                      {scenario.origin === "instructor" ? <span className="tiny muted"> · From my instructor</span> : null}
                    </p>
                    <div className="row row--wrap row--gap-2">
                      <Button size="small" variant="primary" onClick={() => setPractising(at)} aria-label={`Practice: ${title}`}>
                        Practice
                      </Button>
                      <Button size="small" onClick={() => setEditing({ scenario })} aria-label={`Edit: ${title}`}>
                        Edit
                      </Button>
                      {canMove ? (
                        <>
                          <Button size="small" onClick={() => move(at, at - 1)} disabled={at === 0} aria-label={`Move up: ${title}`}>
                            Up
                          </Button>
                          <Button
                            size="small"
                            onClick={() => move(at, at + 1)}
                            disabled={at === visible.length - 1}
                            aria-label={`Move down: ${title}`}
                          >
                            Down
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
  );

  return (
    <Card>
      {visible.length === 0 && !editing && !loadFailed ? (
        <details className="material-fold">
          <summary className="card__header">Practice an oral question</summary>
          <CardBody>
            <Button size="small" variant="secondary" onClick={() => setEditing({ scenario: null })}>
              Add a scenario
            </Button>
          </CardBody>
          {body}
        </details>
      ) : (
        <>
          <CardHeader
            title="Practice an oral question"
            action={
              <Button size="small" variant="secondary" onClick={() => setEditing({ scenario: null })}>
                Add a scenario
              </Button>
            }
          />
          {body}
        </>
      )}
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
      <OralPracticeDialog
        material={material}
        scenarios={mockSet ?? []}
        startIndex={0}
        open={mockSet !== null}
        mock
        onClose={() => setMockSet(null)}
      />
      <ConfirmDialog
        open={removing !== null}
        title="Remove this scenario?"
        message={removing ? `"${oralScenarioTitle(removing.prompt)}" leaves your list and its earlier answers are deleted. Your notes and questions are kept.` : ""}
        confirmLabel="Remove"
        onConfirm={() => {
          const scenario = removing!;
          setRemoving(null);
          deleteWithUndo({
            ids: [scenario.id],
            label: oralScenarioTitle(scenario.prompt),
            // The student's kept answers go with the scenario; nothing hidden is left behind.
            run: async (repos) => {
              await repos.oralScenarios.remove(material.id, scenario.id);
              await repos.oralAnswers.removeAll(scenario.id);
            },
          });
        }}
        onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}
