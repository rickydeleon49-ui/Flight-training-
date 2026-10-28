/**
 * VISUAL-01b — a disposable, developer-only proof of "Cover a label → Try to
 * remember → Reveal → Show whole picture". Reachable only in browser dev mode
 * at /#/dev/visual-proof (see main.tsx); absent from production builds.
 *
 * Memory only: no database, no localStorage/IndexedDB, no Tauri commands. All
 * state lives inside <ProofSession>, which unmounts when the dialog closes, so
 * Close/Cancel discards the picture bytes, cover, question and answer.
 */
import { useLayoutEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import {
  adjustCover,
  clampCover,
  defaultCover,
  displayTransform,
  drawnCover,
  rotationTransform,
  type Cover,
  type Point,
  type Size,
  type Turn,
} from "@/logic/visualCover";
import { readProofPng } from "@/logic/visualPng";

import "./visualProof.css";

type Picture = Size & { url: string };
const STAGE_HEIGHT = 360;

export default function VisualProof() {
  const [open, setOpen] = useState(false);
  return (
    <main className="visual-proof">
      <h1>Try it — this is not saved</h1>
      <p>One picture, one cover, one question at a time.</p>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Cover a label
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Try it — this is not saved" className="visual-proof-dialog">
        {open ? <ProofSession onDone={() => setOpen(false)} /> : null}
      </Dialog>
    </main>
  );
}

/**
 * The review control. The answer is not in the DOM at all until reveal: no
 * alt, title, aria or offscreen text. The polite live region exists empty
 * beforehand so the answer is announced once when it is mounted.
 */
export function Recall({ question, answer, revealed, onReveal }: {
  question: string;
  answer: string;
  revealed: boolean;
  onReveal: () => void;
}) {
  const asked = `Covered label 1. ${/[.?!]$/.test(question) ? question : `${question}.`}`;
  return (
    <section className="proof-recall">
      {revealed ? (
        <p>{asked}</p>
      ) : (
        <button type="button" className="button button--primary" onClick={onReveal}>
          {asked} Reveal label
        </button>
      )}
      <div aria-live="polite" aria-atomic="true">
        {revealed ? <p className="proof-answer">{answer}</p> : null}
      </div>
    </section>
  );
}

function ProofSession({ onDone }: { onDone: () => void }) {
  const [picture, setPicture] = useState<Picture | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cover, setCover] = useState<Cover>({ x: 0, y: 0, w: 1, h: 1 });
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [mode, setMode] = useState<"move" | "resize">("move");
  const [phase, setPhase] = useState<"author" | "review">("author");
  const [revealed, setRevealed] = useState(false);
  const [whole, setWhole] = useState(false);
  const [turn, setTurn] = useState<Turn>(0);
  const [zoom, setZoom] = useState(1);

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await readProofPng(file);
      setCover(defaultCover(next));
      setPicture(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try another PNG.");
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    if (picture) setCover(defaultCover(picture));
    setQuestion("");
    setAnswer("");
  };

  if (!picture) {
    return (
      <div className="proof-body">
        <label className="field">
          <span className="field__label">Choose one PNG picture</span>
          <input type="file" accept="image/png" disabled={busy} onChange={choose} />
        </label>
        {busy ? <p role="status">Opening your picture…</p> : null}
        {error ? <p role="alert" className="field__error">{error}</p> : null}
        <div className="proof-actions">
          <Button onClick={onDone}>Cancel</Button>
        </div>
      </div>
    );
  }

  const showCover = phase === "author" || (!revealed && !whole);

  return (
    <div className="proof-body">
      <div className="proof-actions">
        <Button size="small" onClick={() => setTurn(((turn + 90) % 360) as Turn)}>
          Turn view 90°
        </Button>
        <label className="proof-inline">
          Zoom
          <select className="input" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
            <option value="0.75">75%</option>
            <option value="1">100%</option>
            <option value="1.5">150%</option>
            <option value="2">200%</option>
          </select>
        </label>
      </div>

      <Stage
        picture={picture}
        cover={cover}
        showCover={showCover}
        turn={turn}
        zoom={zoom}
        onDraw={phase === "author" ? setCover : undefined}
      />

      {phase === "author" ? (
        <section className="proof-author">
          <h3>Covered label 1</h3>
          <p className="field__hint">Drag on the picture to cover a label. Describe its place in your question without giving the label away.</p>
          <label className="field">
            <span className="field__label">Question</span>
            <input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Answer</span>
            <input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} />
          </label>
          <fieldset className="proof-bounds">
            <legend>Cover position in picture pixels</legend>
            {(["x", "y", "w", "h"] as const).map((key) => (
              <label key={key} className="proof-inline">
                {{ x: "Left", y: "Top", w: "Width", h: "Height" }[key]}
                <input
                  className="input"
                  type="number"
                  min={key === "w" || key === "h" ? 1 : 0}
                  max={key === "x" || key === "w" ? picture.width : picture.height}
                  value={cover[key]}
                  onChange={(e) => {
                    if (Number.isFinite(e.target.valueAsNumber)) setCover(clampCover({ ...cover, [key]: e.target.valueAsNumber }, picture));
                  }}
                />
              </label>
            ))}
          </fieldset>
          <div className="proof-actions">
            <label className="proof-inline">
              Arrow keys
              <select className="input" value={mode} onChange={(e) => setMode(e.target.value === "resize" ? "resize" : "move")}>
                <option value="move">Move</option>
                <option value="resize">Resize</option>
              </select>
            </label>
            <Button
              onKeyDown={(e) => {
                if (!e.key.startsWith("Arrow")) return;
                e.preventDefault();
                setCover((c) => adjustCover(c, picture, e.key, e.shiftKey, mode === "resize"));
              }}
            >
              Cover 1: use arrow keys to {mode}
            </Button>
          </div>
          <p role="status" className="field__hint">
            Cover at left {cover.x}, top {cover.y}, width {cover.w}, height {cover.h}. Shift with an arrow moves 10 pixels.
          </p>
          <div className="proof-actions">
            <Button onClick={startOver}>Remove</Button>
            <Button
              variant="primary"
              disabled={!question.trim() || !answer.trim()}
              onClick={() => {
                setRevealed(false);
                setWhole(false);
                setPhase("review");
              }}
            >
              Try to remember
            </Button>
          </div>
          {!question.trim() || !answer.trim() ? (
            <p className="field__hint">Write a question and its answer to try it.</p>
          ) : null}
        </section>
      ) : (
        <section>
          <Recall question={question.trim()} answer={answer.trim()} revealed={revealed} onReveal={() => setRevealed(true)} />
          <div className="proof-actions">
            {revealed && !whole ? <Button onClick={() => setWhole(true)}>Show whole picture</Button> : null}
            {revealed ? (
              <Button
                onClick={() => {
                  setWhole(false);
                  setRevealed(false);
                }}
              >
                Try again
              </Button>
            ) : null}
            <Button onClick={() => setPhase("author")}>Edit the cover</Button>
          </div>
          {whole ? <p className="field__hint">This is your whole picture, just as you chose it.</p> : null}
        </section>
      )}
      <div className="proof-actions">
        <Button onClick={onDone}>Close — nothing is kept</Button>
      </div>
    </div>
  );
}

/**
 * The picture and its cover in one SVG whose viewBox is the image's own pixel
 * grid. The cover is drawn in the same render as the image, after it, so it is
 * painted with the first visible image frame. Hidden from assistive tech: the
 * question supplies the non-answer context.
 */
function Stage({ picture, cover, showCover, turn, zoom, onDraw }: {
  picture: Picture;
  cover: Cover;
  showCover: boolean;
  turn: Turn;
  zoom: number;
  onDraw?: (cover: Cover) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const start = useRef<Point | null>(null);
  const [box, setBox] = useState({ width: 600, height: STAGE_HEIGHT });

  // Measure before paint so the first frame already uses the real box.
  useLayoutEffect(() => {
    const node = svg.current;
    if (!node) return;
    const update = () => {
      const r = node.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setBox({ width: r.width, height: r.height });
    };
    update();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!start.current || !onDraw || !svg.current) return;
    const r = svg.current.getBoundingClientRect();
    onDraw(drawnCover(start.current, { x: e.clientX, y: e.clientY }, picture, turn, { left: r.left, top: r.top, width: r.width, height: r.height, zoom }));
  };

  const fit = displayTransform(picture, turn, { left: 0, top: 0, width: box.width, height: box.height, zoom });
  // viewBox is the image grid stretched to the box; the first scale undoes
  // that stretch so the group works in CSS pixels, then fit/zoom and the
  // quarter-turn apply to the group only. Stored geometry never changes.
  const group = `scale(${picture.width / box.width} ${picture.height / box.height}) translate(${fit.x} ${fit.y}) scale(${fit.scale}) ${rotationTransform(picture, turn)}`;

  return (
    <svg
      ref={svg}
      className="proof-stage"
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${picture.width} ${picture.height}`}
      preserveAspectRatio="none"
      style={{ height: STAGE_HEIGHT, cursor: onDraw ? "crosshair" : undefined }}
      onPointerDown={(e) => {
        if (!onDraw) return;
        start.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
    >
      <g transform={group}>
        <image href={picture.url} width={picture.width} height={picture.height} />
        {showCover ? (
          <g data-cover="1">
            <rect x={cover.x} y={cover.y} width={cover.w} height={cover.h} fill="#352c43" />
            <text
              x={cover.x + cover.w / 2}
              y={cover.y + cover.h / 2}
              fill="#ffffff"
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
  );
}
