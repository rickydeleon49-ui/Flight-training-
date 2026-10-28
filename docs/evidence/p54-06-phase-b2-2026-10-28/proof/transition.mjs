/**
 * Disposable evaluation tooling. Never imported by the application.
 *
 * PROPOSED transition contracts from simple-v1 to fsrs6-candidate-1, as pure
 * functions over plain data. Nothing here is a migration, a storage design or
 * an adopted policy; it only makes each preregistered case concrete enough to
 * test. No clock, randomness or I/O; inputs are never mutated.
 *
 * transitionCard(ledger, request, candidate, config) -> { ledger, outcome, replayed }
 *
 *   request = {
 *     operationId,            // idempotency key
 *     expectedGeneration,     // the generation the caller read
 *     card: { cardId, generation, flagged, suspended, schedule },  // schedule: simple-v1 | fsrs | null
 *     history: { retention: "complete" | "partial" | "erased", events: [{ rating, at }] },
 *   }
 *
 * Rules, checked in this order:
 *   1. operationId already in the ledger -> the stored outcome is returned
 *      unchanged and nothing is recomputed (even if the request differs).
 *   2. expectedGeneration !== card.generation -> refused STALE_GENERATION.
 *   3. schedule already fsrs6-candidate-1 -> no-op (already transitioned).
 *   4. schedule with any version other than simple-v1 -> refused UNSUPPORTED_SCHEDULER_VERSION.
 *   5. schedule null (never reviewed) -> no-op, the card stays new; it must have no retained events.
 *   6. retention "erased" -> the history stays erased (events must be empty) and the card
 *      starts new (schedule null). Nothing is reconstructed from the old counters.
 *   7. retention "complete" -> every event is replayed under the candidate from a new card.
 *      The replay must account for the whole state (event count = reps, last event = lastReviewedAt).
 *      method "reconstructed".
 *   8. retention "partial" -> the retained suffix is replayed from a new card as a FALLBACK,
 *      marked method "partial-fallback" and reconstructed:false. reps and lapses keep the
 *      simple-v1 counters (they describe the whole history); d and s come from the suffix only.
 *   In 7 and 8 the pending due instant is kept: dueAt stays the simple-v1 dueAt until the
 *   next real review. flagged and suspended are copied unchanged in every case. Any write
 *   increments the generation; no-ops and refusals keep it. Every outcome, refusals included,
 *   is stored under its operationId.
 */

const freezeDeep = (value) => {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) freezeDeep(v);
    Object.freeze(value);
  }
  return value;
};

const refusal = (code, detail) => ({ status: "refused", code, ...(detail ? { detail } : {}) });

function replay(events, candidate, config) {
  let state = null;
  for (const event of events) {
    try {
      state = candidate.scheduleFsrs(state, event.rating, event.at, config);
    } catch (error) {
      if (error instanceof candidate.FsrsRefusal) return { refused: error.code };
      throw error;
    }
  }
  return { state };
}

function decide(request, candidate, config) {
  const { card, history } = request;
  if (request.expectedGeneration !== card.generation) return refusal("STALE_GENERATION");
  const keep = { cardId: card.cardId, flagged: card.flagged, suspended: card.suspended };
  const write = (schedule, extra) => ({
    status: "applied",
    ...extra,
    card: { ...keep, generation: card.generation + 1, schedule },
  });
  const noop = (method) => ({ status: "no-op", method, card: { ...keep, generation: card.generation, schedule: card.schedule } });
  const schedule = card.schedule;
  const events = history?.events ?? [];

  if (schedule && schedule.schedulerVersion === candidate.SCHEDULER_VERSION) return noop("already-transitioned");
  if (schedule && schedule.schedulerVersion !== "simple-v1") return refusal("UNSUPPORTED_SCHEDULER_VERSION");
  if (schedule === null) {
    if (events.length !== 0) return refusal("HISTORY_INCONSISTENT", "an unreviewed card has retained events");
    return noop("unreviewed-stays-new");
  }
  if (history.retention === "erased") {
    if (events.length !== 0) return refusal("HISTORY_INCONSISTENT", "erased history must stay empty");
    return write(null, { method: "erased-starts-new", reconstructed: false, historyEvents: 0 });
  }
  if (history.retention !== "complete" && history.retention !== "partial") return refusal("HISTORY_INCONSISTENT", "unknown retention");
  if (events.length === 0 || events.at(-1).at !== schedule.lastReviewedAt) {
    return refusal("HISTORY_INCONSISTENT", "the last retained event must be the last review");
  }
  if (history.retention === "complete" && events.length !== schedule.reps) {
    return refusal("HISTORY_INCONSISTENT", "a complete history must contain every review");
  }
  if (history.retention === "partial" && events.length >= schedule.reps) {
    return refusal("HISTORY_INCONSISTENT", "a partial history must be shorter than the review count");
  }
  const result = replay(events, candidate, config);
  if (result.refused) return refusal("HISTORY_REPLAY_REFUSED", result.refused);
  const replayed = result.state;
  const complete = history.retention === "complete";
  return write(
    {
      ...replayed,
      reps: complete ? replayed.reps : schedule.reps,
      lapses: complete ? replayed.lapses : schedule.lapses,
      dueAt: schedule.dueAt, // pending due instant kept until the next real review
    },
    { method: complete ? "reconstructed" : "partial-fallback", reconstructed: complete, historyEvents: events.length },
  );
}

export function transitionCard(ledger, request, candidate, config) {
  if (Object.hasOwn(ledger, request.operationId)) {
    return { ledger, outcome: ledger[request.operationId], replayed: true };
  }
  const outcome = freezeDeep(structuredClone(decide(request, candidate, config)));
  return { ledger: Object.freeze({ ...ledger, [request.operationId]: outcome }), outcome, replayed: false };
}

/**
 * The first real review after a transition: an ordinary candidate review of the
 * transitioned state. The kept pending due instant is replaced only here.
 */
export function reviewAfterTransition(schedule, rating, nowIso, candidate, config) {
  return candidate.scheduleFsrs(schedule, rating, nowIso, config);
}
