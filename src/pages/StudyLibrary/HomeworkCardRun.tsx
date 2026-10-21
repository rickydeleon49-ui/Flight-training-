import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import type { HomeworkOperation, HomeworkSnapshot } from "@/domain/homework";
import type { CardReviewSnapshot, CardRating, CardItemAction } from "@/domain/types";
import type { CardReviewRepository } from "@/data/repositories/cardReviewRepository";
import { nextLocalMidnightUtc } from "@/logic/localDay";
import type { Entry } from "./homeworkUi";
export function HomeworkCardRun({ snapshot, entry, repository, disabled, save, reload, reopen }: {
    snapshot: HomeworkSnapshot;
    entry: Entry;
    repository: CardReviewRepository;
    disabled: boolean;
    save: (o: HomeworkOperation) => Promise<void>;
    reload: () => void;
    reopen: () => void;
}) {
    const [cards, setCards] = useState<CardReviewSnapshot | null>(null);
    const [queue, setQueue] = useState<string[]>([]), [revealed, setRevealed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const pending = useRef<Extract<CardItemAction, {
        action: "rate";
    }> | null>(null), lock = useRef(false);
    const run = snapshot.runs.find(r => r.activity_id === entry.record.id && r.cycle === entry.record.cycle && !r.invalidated_at);
    useEffect(() => {
        let alive = true;
        void (async () => {
            const current = await repository.getCardReviewSnapshot(entry.record.material_id!);
            const at = new Date().toISOString(), midnight = nextLocalMidnightUtc(at, Intl.DateTimeFormat().resolvedOptions().timeZone);
            const due = current.current.status === "ok" ? await repository.getDueQueue({ materialId: current.materialId, currentVersionId: current.current.versionId, currentItemIds: current.current.items.map(x => x.itemId), nowUtc: at, nextLocalMidnightUtc: midnight }) : [];
            if (alive) {
                setCards(current);
                setQueue(due.map(x => x.itemId));
                setRevealed(false);
            }
        })().catch(() => { if (alive)
            setError("These cards couldn't be loaded. Reload to try again."); });
        return () => { alive = false; };
    }, [repository, snapshot, entry.record.material_id]);
    const drift = !!run && !!cards && (cards.generation !== run.scope.generation || cards.current.status !== "ok" || cards.current.versionId !== run.scope.card_set_id);
    const remaining = run?.scope.item_ids.filter(id => !run.ratings.some(x => x.item_id === id)) ?? [];
    const item = cards?.current.status === "ok" ? cards.current.items.find(x => x.itemId === remaining[0]) : undefined;
    const start = async () => {
        if (lock.current || !cards || cards.current.status !== "ok")
            return;
        lock.current = true;
        setBusy(true);
        setError("");
        try {
            const at = new Date().toISOString();
            if (at <= entry.record.created_at || at < snapshot.assignment.updated_at)
                throw new Error("The clock hasn't reached the last saved change. Check the date and time, then start again.");
            const midnight = nextLocalMidnightUtc(at, Intl.DateTimeFormat().resolvedOptions().timeZone);
            // Re-read at Start; the transaction independently verifies this exact selection.
            const current = await repository.getCardReviewSnapshot(cards.materialId);
            if (current.current.status !== "ok" || current.current.versionId !== entry.record.card_set_id)
                throw new Error("Source changed — choose a source to continue.");
            const due = await repository.getDueQueue({ materialId: cards.materialId, currentVersionId: current.current.versionId, currentItemIds: current.current.items.map(x => x.itemId), nowUtc: at, nextLocalMidnightUtc: midnight });
            if (!due.length)
                throw new Error("There are no linked cards due or new just now. Return when a review is due.");
            if (due.map(x => x.itemId).join() !== queue.join()) {
                setCards(current);
                setQueue(due.map(x => x.itemId));
                throw new Error("The linked review queue changed. Check the updated count, then start again.");
            }
            const next = structuredClone(snapshot);
            const e = next.activities.find(x => x.record.id === entry.record.id)!;
            e.record.state = "in_progress";
            e.record.updated_at = at;
            next.assignment.revision++;
            next.assignment.updated_at = at;
            next.assignment.state = "in_progress";
            next.assignment.completed_at = null;
            next.runs.push({ id: crypto.randomUUID(), activity_id: e.record.id, cycle: e.record.cycle, activity_revision: e.record.revision, kind: "cards", started_at: at, finished_at: null, invalidated_at: null, ratings: [], scope: { version: 1, material_id: cards.materialId, source_revision: current.current.contentHash, card_set_id: current.current.versionId, generation: current.generation, item_ids: due.map(x => x.itemId), next_local_midnight: midnight } });
            next.runs.sort((a, b) => a.id.localeCompare(b.id));
            await save({ version: 1, operationId: crypto.randomUUID(), assignmentId: snapshot.assignment.id, baseRevision: snapshot.assignment.revision, changeKind: "start", at, next });
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "This review couldn't be started.");
        }
        finally {
            lock.current = false;
            setBusy(false);
        }
    };
    const send = async (action: Extract<CardItemAction, {
        action: "rate";
    }>) => {
        if (lock.current)
            return;
        lock.current = true;
        setBusy(true);
        pending.current = action;
        setError("");
        try {
            await repository.saveAction(action);
            pending.current = null;
            setRevealed(false);
            reload();
        }
        catch {
            setError("This rating wasn't confirmed. Retry the same rating, or reload to check the saved review.");
        }
        finally {
            lock.current = false;
            setBusy(false);
        }
    };
    const rate = (rating: CardRating) => {
        if (!run || !item || !cards || pending.current)
            return;
        void send({ action: "rate", operationId: crypto.randomUUID(), materialId: cards.materialId, versionContentHash: run.scope.source_revision, itemId: item.itemId, expectedGeneration: run.scope.generation, expectedRevision: cards.states[item.itemId]?.revision ?? 0, rating, homework: { assignmentId: snapshot.assignment.id, runId: run.id, expectedRevision: snapshot.assignment.revision, activityRevision: run.activity_revision, cycle: run.cycle } });
    };
    return <div className="stack stack--2">
    {error ? <p role="alert">{error}</p> : null}
    {run?.finished_at ? <p>Review complete · {run.ratings.length} linked cards rated</p> : run ? <>
      {drift ? <p>This review changed or was reset. Restart it to choose a fresh queue.</p> : <><p>{run.ratings.length} of {run.scope.item_ids.length} linked cards rated</p>{item ? <><p>{item.front}</p>{revealed ? <><p>{item.back}</p><div className="row row--wrap">{(["again", "hard", "good", "easy"] as const).map(r => <Button key={r} disabled={disabled || busy || !!pending.current} onClick={() => rate(r)}>{r[0]!.toUpperCase() + r.slice(1)}</Button>)}</div></> : <Button disabled={disabled || busy || !!pending.current} onClick={() => setRevealed(true)}>Show answer</Button>}</> : null}</>}
      <Button disabled={disabled || busy || !!pending.current} onClick={reopen}>Restart card review</Button>
    </> : <><p>Review {queue.length} linked cards</p><Button disabled={disabled || busy || !cards || queue.length === 0} onClick={() => void start()}>Start card review</Button>{cards && queue.length === 0 ? <p>No linked cards are due or new just now.</p> : null}</>}
    {pending.current ? <Button disabled={busy} onClick={() => void send(pending.current!)}>Retry rating</Button> : null}
    <p className="small muted">Every rating counts as participation. Your rating decides when the card comes back; it isn't a score.</p>
  </div>;
}
