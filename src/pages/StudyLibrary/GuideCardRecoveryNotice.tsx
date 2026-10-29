import { useEffect, useRef, useState } from "react";
import { AlertIcon, Button, Card, CardBody } from "@/components/ui";
import type { StudySetSaveOperation } from "@/data/studySetTransaction";
import { newId } from "@/lib/id";
import { useAppData } from "@/state/AppDataContext";

// A dismissed offer stays dismissed across page visits, only for this open profile/session.
const dismissed = new WeakMap<object, Set<string>>();

/** Shown inside the Flashcards card; `standalone` wraps it in its own card when that card is absent. */
export function GuideCardRecoveryNotice({ materialId, standalone = false }: { materialId: string; standalone?: boolean }) {
  const { repositories, mutate, dataRevision } = useAppData();
  const [offer, setOffer] = useState<StudySetSaveOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const operation = useRef<StudySetSaveOperation | null>(null);
  const docs = repositories?.documents;
  const hide = () => {
    if (docs) {
      const ids = dismissed.get(docs) ?? new Set<string>();
      ids.add(materialId);
      dismissed.set(docs, ids);
    }
    setOffer(null);
  };
  useEffect(() => {
    let live = true;
    if (!docs || dismissed.get(docs)?.has(materialId)) { setOffer(null); return; }
    void docs.readGuideCardRecovery(materialId).then(result => {
      if (!live || dismissed.get(docs)?.has(materialId)) return;
      if (!result) { setOffer(null); return; }
      const previous = operation.current;
      const next = previous && JSON.stringify(previous.expected) === JSON.stringify(result.stored) ? previous : {
        operationId: newId(), materialId, reason: "recover-cards" as const, expected: result.stored, next: result.next,
      };
      operation.current = next;
      setOffer(next);
    }).catch(() => { if (live) setOffer(null); });
    return () => { live = false; };
  }, [docs, materialId, dataRevision]);
  if (!offer) return null;
  const restore = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await mutate(repos => repos.documents.saveStudySet(offer));
      if (!result) {
        setError("Your earlier cards couldn't be brought back. Nothing else was changed; try again.");
        return;
      }
      hide();
    } catch {
      setError("Your earlier cards couldn't be brought back. Nothing else was changed; try again.");
    } finally { pending.current = false; setBusy(false); }
  };
  const notice = <div className="stack stack--3" style={{ marginBottom: "var(--space-4)" }}>
    <div className="ai-disclaimer" role="status">
      <AlertIcon size={16} />
      <p className="tiny">Your earlier {offer.next!.flashcards.length} flashcards were replaced when a new study guide was saved.</p>
    </div>
    {error ? <p className="field__error" role="alert">{error}</p> : null}
    <div className="row row--wrap">
      <Button size="small" disabled={busy} onClick={() => void restore()}>{busy ? "Bringing them back…" : "Bring them back"}</Button>
      <Button size="small" variant="secondary" disabled={busy} onClick={hide}>Not now</Button>
    </div>
  </div>;
  return standalone ? <Card><CardBody>{notice}</CardBody></Card> : notice;
}
