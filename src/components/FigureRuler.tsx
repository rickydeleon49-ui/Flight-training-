import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import { clampPoint, nudge, type RulerPoint } from "@/logic/figureRuler";

type Props = {
  width: number;
  height: number;
  points: [RulerPoint, RulerPoint];
  onChange: (points: [RulerPoint, RulerPoint]) => void;
};

/** Two draggable ends and a line, drawn in the image's own pixel space so it scales with zoom. Place inside the zoomed layer. */
export function FigureRuler({ width, height, points, onChange }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const set = (i: 0 | 1, p: RulerPoint) => onChange(i === 0 ? [p, points[1]] : [points[0], p]);
  const toImage = (event: PointerEvent): RulerPoint | null => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    return clampPoint({ x: ((event.clientX - box.left) / box.width) * width, y: ((event.clientY - box.top) / box.height) * height }, width, height);
  };
  const onKey = (i: 0 | 1) => (event: KeyboardEvent) => {
    const next = nudge(points[i], event.key, event.shiftKey, width, height);
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    set(i, next);
  };
  const end = (i: 0 | 1, label: string) => (
    <circle
      className="figure-ruler__end"
      cx={points[i].x}
      cy={points[i].y}
      r={Math.max(26, Math.round(width / 45))}
      tabIndex={0}
      role="slider"
      aria-label={label}
      aria-valuetext={`${Math.round(points[i].x)}, ${Math.round(points[i].y)}`}
      onKeyDown={onKey(i)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* not capturable here */ }
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
        const p = toImage(event);
        if (p) set(i, p);
      }}
    />
  );
  return (
    <svg ref={svg} className="figure-ruler" viewBox={`0 0 ${width} ${height}`} data-testid="figure-ruler">
      <line className="figure-ruler__line" x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y} />
      {end(0, "Ruler start")}
      {end(1, "Ruler end")}
    </svg>
  );
}
