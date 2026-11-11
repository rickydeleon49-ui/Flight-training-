import { useEffect, useId, useMemo, useState } from "react";
import { diagramPhotoAlt, scopeDiagramSvg, type Diagram } from "@/logic/diagrams";
import "./diagrams.css";

// One file per diagram, fetched only when it is shown (never eagerly), so
// start-up and the Library stay as light as before.
const loaders = import.meta.glob("../../assets/diagrams/*/*.svg", { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;
const photoLoaders = import.meta.glob("../../assets/diagrams/photos/*.jpg", { query: "?url", import: "default" }) as Record<
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

// Diagram style rules go in through the CSSOM (one shared constructed sheet):
// the packaged app's CSP blocks an injected <style> element but not this.
const scopedRules = new Map<string, string>();
let sharedSheet: CSSStyleSheet | null = null;

function syncSheet(): void {
  if (typeof document === "undefined" || typeof CSSStyleSheet === "undefined" || !("adoptedStyleSheets" in document)) return;
  try {
    if (!sharedSheet) {
      sharedSheet = new CSSStyleSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sharedSheet];
    }
    sharedSheet.replaceSync([...scopedRules.values()].join("\n"));
  } catch {
    // No constructable sheets here (old engine, test DOM): diagrams fall back to their own colours.
  }
}

/** Install a diagram's scoped CSS while it is mounted; returns the remover. */
function useDiagramCss(scope: string, css: string | null): void {
  useEffect(() => {
    if (!css) return;
    scopedRules.set(scope, css);
    syncSheet();
    return () => { scopedRules.delete(scope); syncSheet(); };
  }, [scope, css]);
}

/**
 * One diagram, drawn inline so its colours follow the theme. The markup is
 * our own shipped file (never user text). `decorative` hides it from screen
 * readers when a button or heading next to it already names it.
 */
export function DiagramArt({ diagram, decorative = false }: { diagram: Diagram; decorative?: boolean }) {
  if (diagram.kind === "photo") return <DiagramPhoto diagram={diagram} decorative={decorative} />;
  return <DiagramSvg diagram={diagram} decorative={decorative} />;
}

/** An AI-made picture file: an <img> whose alt text carries the AI label. */
function DiagramPhoto({ diagram, decorative }: { diagram: Diagram; decorative: boolean }) {
  const [url, setUrl] = useState<{ id: string; src: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    const load = photoLoaders[`../../assets/diagrams/${diagram.set}/${diagram.file}`];
    (load ? load() : Promise.reject(new Error("Picture file missing"))).then(
      (src) => { if (live) setUrl({ id: diagram.id, src }); },
      () => { if (live) setUrl({ id: diagram.id, src: null }); },
    );
    return () => { live = false; };
  }, [diagram]);
  const ready = url?.id === diagram.id ? url : null;
  if (ready && ready.src === null) return <p className="small muted diagram-art diagram-art--empty">This picture couldn't be loaded.</p>;
  return (
    <div className={`diagram-art diagram-art--photo${ready ? "" : " diagram-art--loading"}`} aria-hidden={decorative || undefined}>
      {ready?.src ? <img src={ready.src} alt={diagramPhotoAlt(diagram)} /> : null}
    </div>
  );
}

function DiagramSvg({ diagram, decorative }: { diagram: Diagram; decorative: boolean }) {
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
  const scoped = useMemo(() => (ready?.svg ? scopeDiagramSvg(ready.svg, prefix) : null), [ready?.svg, prefix]);
  useDiagramCss(prefix.slice(0, -1), scoped?.css ?? null);
  if (ready && ready.svg === null) return <p className="small muted diagram-art diagram-art--empty">This diagram couldn't be loaded.</p>;
  return (
    <div
      className={`diagram-art ${prefix.slice(0, -1)}${ready ? "" : " diagram-art--loading"}`}
      aria-hidden={decorative || undefined}
      // eslint-disable-next-line react/no-danger -- our own bundled SVG file
      dangerouslySetInnerHTML={scoped ? { __html: scoped.markup } : undefined}
    />
  );
}
