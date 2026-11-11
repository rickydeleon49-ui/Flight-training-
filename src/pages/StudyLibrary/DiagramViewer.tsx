import { useState } from "react";
import { Button, Dialog } from "@/components/ui";
import { AI_ILLUSTRATION_LABEL, diagramSourceLine, type Diagram } from "@/logic/diagrams";
import { DiagramArt } from "./DiagramArt";

/** The open diagram: fits the dialog width, or doubles to 2x inside a scroll area so small labels can be read. */
function DiagramDialogBody({ diagram }: { diagram: Diagram }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <>
      <div className="diagram-zoom-bar">
        <Button type="button" size="small" variant="secondary" aria-pressed={zoomed} onClick={() => setZoomed((z) => !z)}>
          {zoomed ? "Fit" : "Zoom in"}
        </Button>
      </div>
      <div className={`diagram-stage${zoomed ? " diagram-stage--zoomed" : ""}`} tabIndex={zoomed ? 0 : undefined} aria-label={zoomed ? "Zoomed diagram, scrollable" : undefined} role={zoomed ? "region" : undefined}>
        <div className="diagram-stage__inner" onClick={() => setZoomed((z) => !z)}>
          <DiagramArt diagram={diagram} />
        </div>
      </div>
      {diagram.aiIllustration ? <p className="small diagram-ai-label">{AI_ILLUSTRATION_LABEL}</p> : null}
      <p className="small muted diagram-source">{diagramSourceLine(diagram)}</p>
    </>
  );
}

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
              {diagram.aiIllustration ? <span className="small diagram-tile__ai">{AI_ILLUSTRATION_LABEL}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {shown ? (
        <Dialog open onClose={() => setShown(null)} title={shown.title} className="dialog--diagram">
          <DiagramDialogBody diagram={shown} />
        </Dialog>
      ) : null}
    </>
  );
}
