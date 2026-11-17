import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { Button, Dialog } from "@/components/ui";
import { figureCredit, figureUrl, type FaaFigure } from "@/logic/figures";
import "./FigureViewer.css";

const MIN = 100;
const MAX = 400;
const STEP = 25;

/** One figure with zoom 100-400%, drag to pan, and Fit. Used inline and inside the full-screen dialog. */
function FigureStage({ figure, tall }: { figure: FaaFigure; tall?: boolean }) {
  const [percent, setPercent] = useState(MIN);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const zoom = (delta: number) => setPercent((p) => Math.min(MAX, Math.max(MIN, p + delta)));
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "+" || event.key === "=") zoom(STEP);
    else if (event.key === "-" || event.key === "_") zoom(-STEP);
    else return;
    event.preventDefault();
  };
  return (
    <div className={`figure-stage${tall ? " figure-stage--tall" : ""}`} onKeyDown={onKey}>
      <div className="figure-stage__toolbar" role="group" aria-label="Zoom">
        <button type="button" className="figure-stage__btn" aria-label="Zoom out" disabled={percent <= MIN} onClick={() => zoom(-STEP)}>
          <span aria-hidden="true">{"−"}</span>
        </button>
        <span className="figure-stage__pct" aria-live="polite" data-testid="figure-zoom-label">{percent}%</span>
        <button type="button" className="figure-stage__btn" aria-label="Zoom in" disabled={percent >= MAX} onClick={() => zoom(STEP)}>
          <span aria-hidden="true">+</span>
        </button>
        <button type="button" className="figure-stage__btn figure-stage__btn--text" onClick={() => setPercent(MIN)}>Fit</button>
      </div>
      <div
        ref={scroller}
        className={`figure-stage__scroll${percent > MIN ? " figure-stage__scroll--zoomed" : ""}`}
        tabIndex={0}
        role="region"
        aria-label={`${figure.title}, scrollable`}
        onPointerDown={(event) => {
          const el = scroller.current;
          if (percent <= MIN || !el || event.button !== 0) return;
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
        <img
          className="figure-stage__img"
          src={figureUrl(figure)}
          alt={figure.alt}
          width={figure.width}
          height={figure.height}
          loading="lazy"
          decoding="async"
          draggable={false}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/** Inline figure card: zoomable image, caption with credit, and a full-screen dialog. */
export function FigureViewer({ figure }: { figure: FaaFigure }) {
  const [open, setOpen] = useState(false);
  return (
    <figure className="figure-view">
      <div className="figure-view__bar">
        <span className="figure-view__title">{figure.title}</span>
        <Button type="button" size="small" variant="secondary" onClick={() => setOpen(true)}>Full screen</Button>
      </div>
      <FigureStage figure={figure} />
      <figcaption className="figure-view__caption">
        <span className="tiny dim">{figureCredit(figure)}</span>
        <span className="tiny figure-view__practice">Practice, not for flight</span>
      </figcaption>
      <p className="tiny dim figure-view__hint">Pinch or use + and − to look closer. Pan by dragging.</p>
      {open ? (
        <Dialog open onClose={() => setOpen(false)} title={figure.title} className="dialog--figure">
          <FigureStage figure={figure} tall />
          <p className="tiny dim">{figureCredit(figure)} · Practice, not for flight</p>
        </Dialog>
      ) : null}
    </figure>
  );
}
