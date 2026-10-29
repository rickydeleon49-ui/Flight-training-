import { useEffect, useRef, useState } from "react";
import { Button, Dialog } from "@/components/ui";
import type { StudyMaterial } from "@/domain/types";
import { useAppData } from "@/state/AppDataContext";
import { defaultCover, adjustCover, clampCover, type Cover, type Turn } from "@/logic/visualCover";
import { visualRegionHash, type VisualRegion } from "@/data/visualCards";
import { validateNextSet, type StoredSetRow, type StudySetSaveOperation } from "@/data/studySetTransaction";
import { readVisualPicture, type VisualPicture as Picture } from "@/services/visualCards";
import { newId } from "@/lib/id";
import { StudySetSaveError } from "@/data/persistenceErrors";
import { appendRetirements, retireItem } from "@/logic/studyAuthoring";
import "./visualCards.css";
import { VisualPicture } from "./VisualPicture";
import { useVisualImageLease } from "./useVisualImageLease";

const BOUND_LABELS = { x: "Left", y: "Top", w: "Width", h: "Height" } as const;

export function VisualCardEditor({
  material,
  cardIndex,
  onClose,
  onSaved,
}: {
  material: StudyMaterial;
  cardIndex?: number;
  onClose: () => void;
  /** Called once the card is saved, just before the editor closes, so the page can say so. */
  onSaved?: () => void;
}) {
  const { repositories, mutate } = useAppData();
  const lease = useVisualImageLease(true);
  const [opened, setOpened] = useState<{
    stored: StoredSetRow | null;
    region?: VisualRegion;
    picture: Picture;
  } | null>(null);
  const [cover, setCover] = useState<Cover>({ x: 0, y: 0, w: 1, h: 1 });
  const [turn, setTurn] = useState<Turn>(0);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [resize, setResize] = useState(false);
  const [placementOpen, setPlacementOpen] = useState(false);
  const [trying, setTrying] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [whole, setWhole] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<StudySetSaveOperation | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      if (!lease.active || opened) return;
      if (!repositories) return;
      const read = await repositories.documents.readStudySetForEdit(material.id);
      const c = cardIndex === undefined ? undefined : read?.set.flashcards[cardIndex];
      if (cardIndex !== undefined && !c?.visualRegionId) {
        throw Error("This card changed. Close this and look again.");
      }
      const region = c?.visualRegionId
        ? await repositories.documents.readVisualRegion(c.visualRegionId, material.id)
        : undefined;
      const picture = await readVisualPicture(region?.imageMaterialId ?? material.id, region);
      if (live) {
        setOpened({ stored: read?.stored ?? null, region, picture });
        setCover(region ?? defaultCover({ width: picture.imageWidth, height: picture.imageHeight }));
        setTurn(region?.rotation ?? 0);
        setQuestion(c?.front ?? "");
        setAnswer(c?.back ?? "");
      }
    })().catch((e) => {
      if (live) setError(e instanceof Error ? e.message : "This picture is unavailable.");
    });
    return () => {
      live = false;
    };
  }, [material.id, cardIndex, repositories, lease.active]);

  const save = async () => {
    if (!opened || !lease.active || saving.current || !repositories) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      if (!pending.current) {
        const p = opened.picture;
        const descriptor = {
          ownerMaterialId: material.id,
          imageMaterialId: opened.region?.imageMaterialId ?? material.id,
          imageSha256: p.imageSha256,
          imageWidth: p.imageWidth,
          imageHeight: p.imageHeight,
          x: cover.x,
          y: cover.y,
          w: cover.w,
          h: cover.h,
          rotation: turn,
        };
        const region = { ...descriptor, id: await visualRegionHash(descriptor) };
        const old = opened.stored;
        const next = validateNextSet(
          old
            ? {
                title: old.title,
                summary: old.summary,
                summaryOrigin: old.summary_origin,
                sections: JSON.parse(old.sections_json),
                flashcards: JSON.parse(old.flashcards_json),
                sourceNotes: old.source_notes,
                provider: old.provider,
                model: old.model,
                retired: JSON.parse(old.retired_json),
              }
            : {
                title: material.title,
                summary: "",
                summaryOrigin: null,
                sections: [],
                flashcards: [],
                sourceNotes: "",
                provider: "manual",
                model: "",
                retired: [],
              },
        );
        const prior = cardIndex === undefined ? undefined : next.flashcards[cardIndex];
        if (prior && (prior.front !== question || prior.back !== answer)) {
          const retired = await retireItem(
            {
              kind: "card",
              itemId: prior.itemId ?? newId(),
              fields: [prior.front, prior.back],
              sourcePage: prior.sourcePage,
              ...(prior.origin ? { origin: prior.origin } : {}),
            },
            "corrected",
          );
          next.retired = appendRetirements(next.retired, [retired]).map((r) => ({ ...r, terms: [...r.terms] }));
        }
        const card = {
          ...(cardIndex === undefined ? { itemId: newId(), origin: "user" as const } : next.flashcards[cardIndex]),
          front: question,
          back: answer,
          sourcePage: null,
          visualRegionId: region.id,
        };
        if (cardIndex === undefined) next.flashcards.push(card);
        else next.flashcards[cardIndex] = card;
        pending.current = {
          operationId: newId(),
          materialId: material.id,
          reason: old ? "edit" : "create",
          expected: old,
          next,
          visualRegions: [region],
        };
      }
      const operation = pending.current;
      const outcome = await mutate(async (repos) => {
        try {
          await repos.documents.saveStudySet(operation);
          return { ok: true as const };
        } catch (error) {
          return { ok: false as const, error };
        }
      });
      if (!outcome) throw Error("This save could not be confirmed.");
      if (!outcome.ok) throw outcome.error;
      onSaved?.();
      onClose();
    } catch (e) {
      const unknown = e instanceof StudySetSaveError && ["IPC_TRANSPORT_ERROR", "STORAGE_ERROR"].includes(e.code);
      setUncertain(unknown);
      if (!unknown) pending.current = null;
      setError(
        unknown
          ? "The save could not be confirmed. Try save again to check the same request."
          : e instanceof StudySetSaveError && e.code === "SOURCE_CHANGED"
            ? "This picture changed or is missing. Nothing was saved. Close this and check the picture first."
            : e instanceof Error
              ? e.message
              : "This card could not be saved. Your draft is still here.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const size = opened ? { width: opened.picture.imageWidth, height: opened.picture.imageHeight } : null;

  return (
    <Dialog
      open
      className="visual-card-editor"
      onClose={() => {
        if (!saving.current) onClose();
      }}
      title={cardIndex === undefined ? "Cover a label" : "Edit picture card"}
      description={
        uncertain
          ? "The save may already have happened. Try save again checks the same request; closing does not undo a saved card."
          : "One picture, one cover, one question. PNG pictures only. New or changed cards start fresh reviews for this set; earlier reviews stay saved."
      }
      dismissible={!busy}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!opened || !lease.active || busy || !question.trim() || !answer.trim()}
            onClick={() => void save()}
          >
            {uncertain ? "Try save again" : "Save picture card"}
          </Button>
        </>
      }
    >
      {error ? <p role="alert">{error}</p> : null}
      {!opened && !error ? <p role="status">Checking this picture…</p> : null}
      {!lease.active ? <Button onClick={lease.activate}>Show this picture</Button> : null}
      {opened && size && lease.active ? (
        <div className="stack stack--3">
          <VisualPicture
            picture={opened.picture}
            cover={cover}
            turn={turn}
            covered={!trying || !whole}
            onDraw={!trying && !uncertain && !busy ? setCover : undefined}
          />
          {!trying ? (
            <fieldset disabled={busy || uncertain} style={{ border: 0, padding: 0 }} className="stack stack--3">
              <label className="field">
                Question
                <input
                  className="input"
                  maxLength={1000}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
              </label>
              <label className="field">
                Answer
                <input
                  className="input"
                  maxLength={2000}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
              </label>
              <details open={placementOpen} onToggle={(e) => setPlacementOpen(e.currentTarget.open)}>
                <summary tabIndex={0}>Other ways to place the cover (keyboard or exact numbers)</summary>
                {/* The dialog fallback also uses hidden to skip collapsed controls when tabbing. */}
                <div hidden={!placementOpen} className={placementOpen ? "stack stack--3" : undefined}>
                  <div className="row row--wrap">
                    {(["x", "y", "w", "h"] as const).map((k) => (
                      <label key={k} className="small">
                        {BOUND_LABELS[k]}
                        <input
                          className="input"
                          style={{ width: 80 }}
                          type="number"
                          value={cover[k]}
                          min={k === "x" || k === "y" ? 0 : 1}
                          max={k === "x" || k === "w" ? size.width : size.height}
                          onChange={(e) => {
                            if (Number.isFinite(e.target.valueAsNumber)) {
                              setCover(clampCover({ ...cover, [k]: e.target.valueAsNumber }, size));
                            }
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <label className="small">
                    View rotation{" "}
                    <select value={turn} onChange={(e) => setTurn(Number(e.target.value) as Turn)}>
                      {[0, 90, 180, 270].map((n) => (
                        <option key={n} value={n}>
                          {n}°
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="small">
                    Arrow keys{" "}
                    <select value={resize ? "resize" : "move"} onChange={(e) => setResize(e.target.value === "resize")}>
                      <option value="move">Move</option>
                      <option value="resize">Resize</option>
                    </select>
                  </label>
                  <Button
                    onKeyDown={(e) => {
                      if (e.key.startsWith("Arrow")) {
                        e.preventDefault();
                        setCover((c) => adjustCover(c, size, e.key, e.shiftKey, resize));
                      }
                    }}
                  >
                    Cover 1: use arrow keys to {resize ? "resize" : "move"}
                  </Button>
                  <p role="status" className="small">
                    Left {cover.x}, top {cover.y}, width {cover.w}, height {cover.h}. Shift with an arrow changes 10
                    pixels.
                  </p>
                  <p className="small">
                    Your original picture stays unchanged. Complete backups keep the picture and its cards; database-only
                    copies still need the managed picture files.
                  </p>
                </div>
              </details>
              {!question.trim() || !answer.trim() ? <p className="small">Write a question and its answer first.</p> : null}
              <Button
                disabled={!question.trim() || !answer.trim()}
                onClick={() => {
                  setRevealed(false);
                  setWhole(false);
                  setTrying(true);
                }}
              >
                Try to remember
              </Button>
            </fieldset>
          ) : (
            <div>
              {revealed ? (
                <p>{question}</p>
              ) : (
                <Button onClick={() => setRevealed(true)}>
                  Covered label 1. {question}{/[.?!]$/.test(question) ? "" : "."} Reveal label
                </Button>
              )}
              {revealed ? (
                <>
                  <p role="status">{answer}</p>
                  <Button onClick={() => setWhole(true)}>Show whole picture</Button>
                </>
              ) : null}
              <Button
                onClick={() => {
                  setTrying(false);
                  setRevealed(false);
                  setWhole(false);
                }}
              >
                Adjust cover
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}
