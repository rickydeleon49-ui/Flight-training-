import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import { drawnCover, rotatedSize, rotationTransform, type Cover, type Turn } from "@/logic/visualCover";
import type { VisualPicture as Picture } from "@/services/visualCards";

/** Image and opaque cover share one transform, before the image's first frame. */
export function VisualPicture({
  picture,
  cover,
  turn,
  covered,
  onDraw,
}: {
  picture: Picture;
  cover: Cover;
  turn: Turn;
  covered: boolean;
  onDraw?: (c: Cover) => void;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const size = { width: picture.imageWidth, height: picture.imageHeight };
  const rotated = rotatedSize(size, turn);

  const draw = (e: PointerEvent<SVGSVGElement>) => {
    if (!start.current || !onDraw) return;
    const r = e.currentTarget.getBoundingClientRect();
    onDraw(
      drawnCover(start.current, { x: e.clientX, y: e.clientY }, size, turn, {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        zoom,
      }),
    );
  };

  const offsetX = (rotated.width * (1 - zoom)) / 2;
  const offsetY = (rotated.height * (1 - zoom)) / 2;

  return (
    <div className="visual-picture">
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox={`0 0 ${rotated.width} ${rotated.height}`}
        style={{
          display: "block",
          width: "100%",
          height: 220,
          touchAction: onDraw ? "none" : undefined,
          background: "#eee6dc",
        }}
        onPointerDown={(e) => {
          if (onDraw) {
            start.current = { x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={draw}
        onPointerUp={(e) => {
          draw(e);
          start.current = null;
        }}
        onPointerCancel={() => {
          start.current = null;
        }}
      >
        <g transform={`translate(${offsetX} ${offsetY}) scale(${zoom}) ${rotationTransform(size, turn)}`}>
          <image href={picture.url} width={size.width} height={size.height} />
          {covered ? (
            <g data-cover="1">
              <rect x={cover.x} y={cover.y} width={cover.w} height={cover.h} fill="#352c43" />
              <text
                x={cover.x + cover.w / 2}
                y={cover.y + cover.h / 2}
                fill="white"
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={Math.max(4, Math.min(24, cover.h * 0.7))}
              >
                1
              </text>
            </g>
          ) : null}
        </g>
      </svg>
      <label className="small">
        Picture size{" "}
        <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
          <option value={1}>Fit</option>
          <option value={1.5}>150%</option>
          <option value={2}>200%</option>
        </select>
      </label>
    </div>
  );
}
