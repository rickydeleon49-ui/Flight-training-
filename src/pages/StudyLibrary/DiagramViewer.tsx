import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Dialog } from "@/components/ui";
import { AI_ILLUSTRATION_LABEL, diagramSourceLine, type Diagram } from "@/logic/diagrams";
import { clampZoom, fitScale, normalizeZoom, stepZoom, zoomLabel } from "@/logic/diagramFit";
import { DiagramArt } from "./DiagramArt";

const DEFAULT_NATURAL = { w: 730, h: 430 };

/**
 * The open diagram. It starts scaled to fit the whole stage (width and height),
 * so nothing is ever clipped; + / - / pinch zoom in, and a zoomed diagram is
 * dragged or scrolled to move around. Scale 1 is the diagram's natural size.
 */
function DiagramDialogBody({ diagram, zoom, setZoom, stageRef }: {
  diagram: Diagram;
  zoom: number | null;
  setZoom: (next: (current: number | null, fit: number) => number | null) => void;
  stageRef: React.RefObject<DiagramFitHandle | null>;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState(DEFAULT_NATURAL);
  const fit = fitScale(box.w, box.h, natural.w, natural.h);
  const scale = zoom === null ? fit : clampZoom(zoom, fit);
  const zoomed = zoom !== null && scale > fit;

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { setNatural(DEFAULT_NATURAL); }, [diagram.id]);

  stageRef.current = { fit, scale };

  // Pinch on a trackpad arrives as ctrl + wheel; it must be a non-passive listener to stop page zoom.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setZoom((current, fitNow) => normalizeZoom((current ?? fitNow) * Math.exp(-event.deltaY * 0.01), fitNow));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setZoom]);

  // Keep the middle of the view in place when the scale changes.
  const lastScale = useRef(scale);
  useLayoutEffect(() => {
    const el = scroller.current;
    const was = lastScale.current;
    lastScale.current = scale;
    if (!el || was === scale || was <= 0) return;
    const ratio = scale / was;
    el.scrollLeft = (el.scrollLeft + el.clientWidth / 2) * ratio - el.clientWidth / 2;
    el.scrollTop = (el.scrollTop + el.clientHeight / 2) * ratio - el.clientHeight / 2;
  }, [scale]);

  return (
    <>
      <div className="diagram-zoom-bar">
        <p className="small muted diagram-source">{diagramSourceLine(diagram)}</p>
        <p className="small muted diagram-helper">
          Whole diagram fits the window. Use + or pinch to zoom; drag to move around when zoomed.
        </p>
      </div>
      <div className="diagram-stage" ref={stage}>
        <div
          ref={scroller}
          className={`diagram-stage__scroll${zoomed ? " diagram-stage__scroll--zoomed" : ""}`}
          tabIndex={zoomed ? 0 : undefined}
          aria-label={zoomed ? "Zoomed diagram, scrollable" : undefined}
          role={zoomed ? "region" : undefined}
          onPointerDown={(event) => {
            const el = scroller.current;
            if (!zoomed || !el || event.button !== 0) return;
            drag.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop };
            try { el.setPointerCapture?.(event.pointerId); } catch { /* not capturable here */ }
          }}
          onPointerMove={(event) => {
            const el = scroller.current;
            const start = drag.current;
            if (!el || !start) return;
            el.scrollLeft = start.left - (event.clientX - start.x);
            el.scrollTop = start.top - (event.clientY - start.y);
          }}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
        >
          <div
            className="diagram-stage__inner"
            style={{ width: `${Math.round(natural.w * scale)}px` }}
            onLoadCapture={(event) => {
              const img = event.target as HTMLImageElement;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
            }}
          >
            <DiagramArt diagram={diagram} />
          </div>
        </div>
      </div>
      {diagram.aiIllustration ? <p className="small diagram-ai-label">{AI_ILLUSTRATION_LABEL}</p> : null}
    </>
  );
}

interface DiagramFitHandle { fit: number; scale: number }

/** The near-full-window enlarged view: header controls (zoom pill, Actual size) plus the fitted diagram. */
function DiagramDialog({ diagram, onClose }: { diagram: Diagram; onClose: () => void }) {
  const [zoom, setZoomState] = useState<number | null>(null);
  const handle = useRef<DiagramFitHandle | null>(null);
  // Always work from the latest measured fit scale.
  const setZoom = useCallback((next: (current: number | null, fit: number) => number | null) => {
    setZoomState((current) => next(current, handle.current?.fit ?? 1));
  }, []);
  const label = zoomLabel(zoom);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "+" || event.key === "=") setZoom((c, f) => stepZoom(c, f, 1));
      else if (event.key === "-" || event.key === "_") setZoom((c, f) => stepZoom(c, f, -1));
      else if (event.key === "0") setZoom(() => null);
      else return;
      event.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setZoom]);

  return (
    <Dialog
      open
      onClose={onClose}
      title={diagram.title}
      className="dialog--diagram"
      headerActions={
        <>
          <div className="diagram-zoom" role="group" aria-label="Zoom">
            <button type="button" className="diagram-zoom__button" aria-label="Zoom out" onClick={() => setZoom((c, f) => stepZoom(c, f, -1))}>
              <span aria-hidden="true">{"\u2212"}</span>
            </button>
            <span className="diagram-zoom__label" aria-live="polite" data-testid="diagram-zoom-label">{label}</span>
            <button type="button" className="diagram-zoom__button" aria-label="Zoom in" onClick={() => setZoom((c, f) => stepZoom(c, f, 1))}>
              <span aria-hidden="true">+</span>
            </button>
          </div>
          <Button type="button" size="small" variant="secondary" onClick={() => setZoom((_c, f) => normalizeZoom(1, f))}>
            Actual size
          </Button>
        </>
      }
    >
      <DiagramDialogBody diagram={diagram} zoom={zoom} setZoom={setZoom} stageRef={handle} />
    </Dialog>
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
              <span className="small muted diagram-tile__hint" aria-hidden="true">Tap to enlarge</span>
              {diagram.aiIllustration ? <span className="small diagram-tile__ai">{AI_ILLUSTRATION_LABEL}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {shown ? (
        <DiagramDialog diagram={shown} onClose={() => setShown(null)} />
      ) : null}
    </>
  );
}
