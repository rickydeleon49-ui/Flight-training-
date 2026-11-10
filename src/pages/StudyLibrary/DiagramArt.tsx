import { useEffect, useId, useState } from "react";
import { scopeDiagramSvg, type Diagram } from "@/logic/diagrams";
import "./diagrams.css";

// One file per diagram, fetched only when it is shown (never eagerly), so
// start-up and the Library stay as light as before.
const loaders = import.meta.glob("../../assets/diagrams/*/*.svg", { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;
const cache = new Map<string, Promise<string>>();

function loadDiagram(diagram: Diagram): Promise<string> {
  const key = `../../assets/diagrams/${diagram.set}/${diagram.file}`;
  let found = cache.get(key);
  if (!found) {
    const load = loaders[key];
    found = load ? load() : Promise.reject(new Error("Diagram file missing"));
    cache.set(key, found);
  }
  return found;
}

/**
 * One diagram, drawn inline so its colours follow the theme. The markup is
 * our own shipped file (never user text). `decorative` hides it from screen
 * readers when a button or heading next to it already names it.
 */
export function DiagramArt({ diagram, decorative = false }: { diagram: Diagram; decorative?: boolean }) {
  const prefix = `dg${useId().replace(/[^a-zA-Z0-9]/g, "")}-`;
  const [state, setState] = useState<{ file: string; svg: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    loadDiagram(diagram).then(
      (svg) => { if (live) setState({ file: diagram.id, svg }); },
      () => { if (live) setState({ file: diagram.id, svg: null }); },
    );
    return () => { live = false; };
  }, [diagram]);
  const ready = state?.file === diagram.id ? state : null;
  if (ready && ready.svg === null) return <p className="small muted diagram-art diagram-art--empty">This diagram couldn't be loaded.</p>;
  return (
    <div
      className={`diagram-art ${prefix.slice(0, -1)}${ready ? "" : " diagram-art--loading"}`}
      aria-hidden={decorative || undefined}
      // eslint-disable-next-line react/no-danger -- our own bundled SVG file
      dangerouslySetInnerHTML={ready?.svg ? { __html: scopeDiagramSvg(ready.svg, prefix) } : undefined}
    />
  );
}
