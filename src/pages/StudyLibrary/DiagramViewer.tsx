import { useState } from "react";
import { Dialog } from "@/components/ui";
import { diagramSourceLine, type Diagram } from "@/logic/diagrams";
import { DiagramArt } from "./DiagramArt";

/** A row of diagram tiles; choosing one opens it large. Shared by the strip and the Diagrams view. */
export function DiagramTiles({ diagrams, className = "diagram-tiles" }: { diagrams: readonly Diagram[]; className?: string }) {
  const [shown, setShown] = useState<Diagram | null>(null);
  return (
    <>
      <ul className={className}>
        {diagrams.map((diagram) => (
          <li key={diagram.id}>
            <button type="button" className="diagram-tile" onClick={() => setShown(diagram)}>
              <DiagramArt diagram={diagram} decorative />
              <span className="diagram-tile__title">{diagram.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {shown ? (
        <Dialog open onClose={() => setShown(null)} title={shown.title} className="dialog--diagram">
          <DiagramArt diagram={shown} />
          <p className="small muted diagram-source">{diagramSourceLine(shown)}</p>
        </Dialog>
      ) : null}
    </>
  );
}
