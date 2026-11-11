import { Link } from "react-router-dom";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { TOPIC_LABELS, type Topic } from "@/domain/types";
import { diagramsForTopic } from "@/logic/diagrams";
import { DiagramTiles } from "./DiagramViewer";

/**
 * DIAGRAMS-01: pictures for this material's topic, under the material. Nothing
 * shows when the topic has none. "General" is the catch-all for unsorted
 * material, so it never gets a strip; the Diagrams tab still lists those.
 */
export function DiagramsStrip({ topic }: { topic: Topic }) {
  const diagrams = topic === "general" ? [] : diagramsForTopic(topic);
  if (diagrams.length === 0) return null;
  return (
    <Card ariaLabel={`Diagrams for ${TOPIC_LABELS[topic]}`}>
      <CardHeader
        title={`Diagrams for ${TOPIC_LABELS[topic]}`}
        action={<Link className="small" to={`/study?tab=diagrams&topic=${topic}`}>All diagrams</Link>}
      />
      <CardBody>
        <DiagramTiles diagrams={diagrams} className="diagram-tiles diagram-tiles--strip" />
      </CardBody>
    </Card>
  );
}
