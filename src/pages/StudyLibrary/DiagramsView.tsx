import { useState } from "react";
import { Card, CardBody } from "@/components/ui";
import { TOPIC_LABELS, type Topic } from "@/domain/types";
import { diagramsByTopic } from "@/logic/diagrams";
import { DiagramTiles } from "./DiagramViewer";

const isTopic = (value: string | null): value is Topic => value !== null && value in TOPIC_LABELS;

/** The Diagrams tab of the Study Library: every diagram, grouped by topic. */
export function DiagramsView({ topic }: { topic: string | null }) {
  const groups = diagramsByTopic();
  const [open, setOpen] = useState<Set<Topic>>(() => new Set(isTopic(topic) ? [topic] : groups[0] ? [groups[0].topic] : []));
  return (
    <div className="stack stack--4 diagrams-view">
      <p className="small muted">
        Pictures that go with the FAA Pilot's Handbook. Choose one to see it larger. They are study aids: check them
        with your instructor.
      </p>
      {groups.map((group) => (
        <Card key={group.topic}>
          <details
            className="material-fold diagram-group"
            open={open.has(group.topic)}
            onToggle={(event) => {
              const isOpen = event.currentTarget.open;
              setOpen((was) => {
                if (was.has(group.topic) === isOpen) return was;
                const next = new Set(was);
                if (isOpen) next.add(group.topic); else next.delete(group.topic);
                return next;
              });
            }}
          >
            <summary className="card__header">{group.label} ({group.diagrams.length})</summary>
            {open.has(group.topic) ? <CardBody><DiagramTiles diagrams={group.diagrams} /></CardBody> : null}
          </details>
        </Card>
      ))}
    </div>
  );
}
