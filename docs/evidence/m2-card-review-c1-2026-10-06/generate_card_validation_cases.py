#!/usr/bin/env python3
"""Generate src-tauri/fixtures/card-validation/cases.json (M2-3 C1).

An independent third implementation of the card identity and simple-v1
arithmetic (Python standard library only) builds a valid schema-12 baseline:
rated cards, a never-rated suspended card, a flagged card, an older version,
a post-reset generation-1 material and receipt tombstones. Each case is SQL
applied on top; both validators must give the listed outcome. Every value is
synthetic. Run from the repository root:

    python3 docs/evidence/m2-card-review-c1-2026-10-06/generate_card_validation_cases.py
"""
import hashlib
import json
from datetime import datetime, timedelta, timezone

OUT = "src-tauri/fixtures/card-validation/cases.json"
LADDER = [1, 3, 7, 16, 35, 75, 150, 180]


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def canon(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def parse(text):
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)


def q(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def version(material, cards):
    content = sha(canon([{"front": c[0], "back": c[1], "sourcePage": c[2]} for c in cards]))
    vid = sha(f"{material}\0{content}")
    return vid, content, [sha(f"{vid}\0{i}") for i in range(len(cards))]


def schedule(prior, rating, now):
    step_from = prior["step"] if prior else -1
    lapses = prior["lapses"] if prior else 0
    if rating == "again":
        if step_from >= 0:
            lapses += 1
        step, delay = -1, timedelta(minutes=10)
    else:
        step = max(0, step_from) if rating == "hard" else min(step_from + (1 if rating == "good" else 2), 7)
        delay = timedelta(days=LADDER[step])
    return {
        "schedulerVersion": "simple-v1",
        "step": step,
        "reps": (prior["reps"] if prior else 0) + 1,
        "lapses": lapses,
        "lastReviewedAt": iso(now),
        "dueAt": iso(now + delay),
    }


T = datetime(2026, 10, 6, 10, 0, tzinfo=timezone.utc)
STAMP = iso(T)
ops = iter(f"c0000000-0000-4000-8000-{n:012x}" for n in range(1, 1000))
sql = []


def insert(table, row):
    sql.append(f"INSERT INTO {table} ({', '.join(row)}) VALUES ({', '.join(q(v) for v in row.values())})")


for mid, title in [("mat-1", "Synthetic one"), ("mat-2", "Synthetic two")]:
    insert("study_materials", {"id": mid, "title": title, "created_at": STAMP, "updated_at": STAMP})

CARDS_A = [("Synthetic front A0", "Synthetic back A0", 1), ("Synthetic front A1", "Synthetic back A1", None)]
CARDS_B = [("Synthetic front B0", "Synthetic back B0", 2), ("Synthetic front B1", "Synthetic back B1", None), ("Synthetic front B2", "Synthetic back B2", 3)]
CARDS_C = [("Synthetic front C0", "Synthetic back C0", None)]


def study_set(mid, cards, provider):
    insert("ai_study_sets", {
        "source_material_id": mid, "title": "Synthetic set", "summary": "", "sections_json": "[]",
        "flashcards_json": json.dumps([{"front": f, "back": b, "sourcePage": p} for f, b, p in cards]),
        "source_notes": "", "provider": provider, "model": "", "generated_at": STAMP, "updated_at": STAMP,
    })


def materialize(mid, cards, provider, created, active, first_reviewed=None):
    vid, content, items = version(mid, cards)
    insert("card_versions", {"id": vid, "source_material_id": mid, "content_hash": content, "card_count": len(cards),
                             "provider": provider, "created_at": iso(created), "first_reviewed_at": first_reviewed,
                             "is_active": active})
    for i, (f, b, p) in enumerate(cards):
        insert("card_items", {"id": items[i], "version_id": vid, "ordinal": i, "front": f, "back": b, "source_page": p})
    return vid, content, items


def receipt(op, action, mid, gen, applied, result, erased=False):
    payload = {"action": action, "operationId": op, "materialId": mid, "expectedGeneration": gen}
    insert("card_review_operations", {"operation_id": op, "action": action, "source_material_id": mid, "generation": gen,
                                      "request_hash": sha(canon(payload)), "applied_at": iso(applied),
                                      "is_erased": 1 if erased else 0, "result_json": None if erased else canon(result)})


def item_result(action, item, gen, revision, due, reviewed, suspended, flag):
    return {"action": action, "itemId": item, "generation": gen, "revision": revision, "dueAt": due,
            "reviewedAt": reviewed, "suspended": suspended, "flag": flag}


def rate(mid, item, gen, ratings, start, revision_offset=0):
    """Rate one card through a sequence; return (state, events, op ids)."""
    prior = None
    now = start
    revision = revision_offset
    last_op = None
    for rating in ratings:
        nxt = schedule(prior, rating, now)
        op = next(ops)
        insert("card_review_events", {"id": op, "item_id": item, "generation": gen, "rating": rating,
                                      "reviewed_at": nxt["lastReviewedAt"], "scheduler_version": "simple-v1",
                                      "prior_state_json": canon(prior), "next_state_json": canon(nxt)})
        revision += 1
        receipt(op, "rate", mid, gen, now, item_result("rate", item, gen, revision, nxt["dueAt"], nxt["lastReviewedAt"], False, None))
        prior = nxt
        last_op = op
        now = parse(nxt["dueAt"])
    return prior, revision, last_op


def state(item, mid, sched, revision, suspended=False, flag=None):
    insert("card_review_state", {
        "item_id": item, "source_material_id": mid, "scheduler_version": "simple-v1",
        "step": sched["step"] if sched else -1, "due_at": sched["dueAt"] if sched else None,
        "last_reviewed_at": sched["lastReviewedAt"] if sched else None, "reps": sched["reps"] if sched else 0,
        "lapses": sched["lapses"] if sched else 0, "suspended": 1 if suspended else 0, "flag": flag, "revision": revision,
    })


# mat-1: old version A (rated once), regenerated to current B.
study_set("mat-1", CARDS_B, "gemini")
A_ID, _, A_ITEMS = materialize("mat-1", CARDS_A, "gemini", T, 0, iso(T))
a0, a0_rev, _ = rate("mat-1", A_ITEMS[0], 0, ["good"], T)
state(A_ITEMS[0], "mat-1", a0, a0_rev)
T_B = T + timedelta(days=2)
B_ID, B_HASH, B_ITEMS = materialize("mat-1", CARDS_B, "gemini", T_B, 1, iso(T_B))
b0, b0_rev, B0_LAST_OP = rate("mat-1", B_ITEMS[0], 0, ["good", "again"], T_B)
state(B_ITEMS[0], "mat-1", b0, b0_rev)
SUSPEND_OP = next(ops)
receipt(SUSPEND_OP, "suspend", "mat-1", 0, T_B, item_result("suspend", B_ITEMS[1], 0, 1, None, None, True, None))
state(B_ITEMS[1], "mat-1", None, 1, suspended=True)
FLAG_OP = next(ops)
receipt(FLAG_OP, "flag", "mat-1", 0, T_B, item_result("flag", B_ITEMS[2], 0, 1, None, None, False, "unclear"))
state(B_ITEMS[2], "mat-1", None, 1, flag="unclear")

# mat-2: a rating at generation 0 (tombstoned), a reset to generation 1, then fresh work.
study_set("mat-2", CARDS_C, "import")
PRE_RESET_OP = next(ops)
receipt(PRE_RESET_OP, "rate", "mat-2", 0, T, None, erased=True)
RESET_OP = next(ops)
receipt(RESET_OP, "reset", "mat-2", 0, T + timedelta(hours=1), {"action": "reset", "materialId": "mat-2", "generation": 1})
insert("card_review_generations", {"source_material_id": "mat-2", "generation": 1})
T_C = T + timedelta(hours=2)
C_ID, _, C_ITEMS = materialize("mat-2", CARDS_C, "import", T_C, 1, iso(T_C))
c0, c0_rev, C0_OP = rate("mat-2", C_ITEMS[0], 1, ["good"], T_C)
state(C_ITEMS[0], "mat-2", c0, c0_rev)

# A deleted material's receipts survive only as tombstones.
receipt(next(ops), "rate", "mat-gone", 0, T, None, erased=True)
receipt(next(ops), "reset", "mat-gone", 0, T, None, erased=True)

BASELINE = sql
WRITABLE_ON, WRITABLE_OFF = "PRAGMA writable_schema = ON", "PRAGMA writable_schema = OFF"
IGNORE_CHECKS = "PRAGMA ignore_check_constraints = ON"


def schema_edit(name, old, new):
    return [WRITABLE_ON, f"UPDATE sqlite_master SET sql = replace(sql, {q(old)}, {q(new)}) WHERE name = {q(name)}", WRITABLE_OFF]


big_cards = [(f"Synthetic big {i}", "Synthetic", None) for i in range(500)]
big_id, big_hash, big_items = version("mat-1", big_cards)
big_sql = [f"INSERT INTO card_versions (id, source_material_id, content_hash, card_count, provider, created_at, first_reviewed_at, is_active) VALUES ({q(big_id)}, 'mat-1', {q(big_hash)}, 500, 'gemini', {q(STAMP)}, NULL, 0)"]
big_sql += [f"INSERT INTO card_items (id, version_id, ordinal, front, back, source_page) VALUES ({q(big_items[i])}, {q(big_id)}, {i}, {q(big_cards[i][0])}, 'Synthetic', NULL)" for i in range(500)]

one = [("Synthetic lone", "Synthetic", None)]
lone_id, lone_hash, lone_items = version("mat-1", one)
bad_item_sql = [
    f"INSERT INTO card_versions (id, source_material_id, content_hash, card_count, provider, created_at, first_reviewed_at, is_active) VALUES ({q(lone_id)}, 'mat-1', {q(lone_hash)}, 1, 'gemini', {q(STAMP)}, NULL, 0)",
    f"INSERT INTO card_items (id, version_id, ordinal, front, back, source_page) VALUES ({q(sha(lone_id + chr(0) + '7'))}, {q(lone_id)}, 0, 'Synthetic lone', 'Synthetic', NULL)",
]

never_rated_event = schedule(None, "good", T_B + timedelta(hours=1))
stray_op = next(ops)
CASES = [
    ("valid baseline: rated, never-rated suspended, flagged, old version, post-reset generation 1, tombstones", "control", [], "accept"),
    ("equivalent table formatting is accepted", "schema", schema_edit("card_review_state", "    ", " "), "accept"),
    ("a 500-card older version is accepted", "identity", big_sql, "accept"),
    ("a fresh empty card schema with no rows is accepted", "control",
     ["DELETE FROM card_review_events", "DELETE FROM card_review_state", "DELETE FROM card_items", "DELETE FROM card_versions",
      "DELETE FROM card_review_operations", "DELETE FROM card_review_generations"], "accept"),
    ("the generation-table material foreign key removed is refused", "schema-fk",
     schema_edit("card_review_generations", "REFERENCES study_materials(id) ON DELETE CASCADE", ""), "refuse"),
    ("a changed card_items delete action is refused", "schema-fk",
     schema_edit("card_items", "REFERENCES card_versions(id) ON DELETE CASCADE", "REFERENCES card_versions(id) ON DELETE SET NULL"), "refuse"),
    ("a removed receipt tombstone CHECK is refused", "schema-check",
     schema_edit("card_review_operations", "CHECK ((is_erased = 1) = (result_json IS NULL))", "CHECK (1)"), "refuse"),
    ("a weakened step CHECK is refused", "schema-check", schema_edit("card_review_state", "BETWEEN -1 AND 7", "BETWEEN -1 AND 70"), "refuse"),
    ("a dropped active-version unique index is refused", "schema-index", ["DROP INDEX uq_active_card_version"], "refuse"),
    ("a due index on the wrong columns is refused", "schema-index",
     ["DROP INDEX idx_card_state_due", "CREATE INDEX idx_card_state_due ON card_review_state(source_material_id, flag)"], "refuse"),
    ("a no-op deletion trigger is refused", "schema-trigger",
     ["DROP TRIGGER trg_card_ops_material_delete",
      "CREATE TRIGGER trg_card_ops_material_delete AFTER DELETE ON study_materials FOR EACH ROW BEGIN SELECT 1; END"], "refuse"),
    ("two active versions for one material (only possible with the unique index altered) are refused", "ownership",
     ["DROP INDEX uq_active_card_version", f"UPDATE card_versions SET is_active = 1 WHERE id = {q(A_ID)}",
      "CREATE UNIQUE INDEX uq_active_card_version ON card_versions(source_material_id) WHERE is_active = 1 AND id IS NULL"], "refuse"),
    ("a state row owned by another material than its card is refused", "ownership",
     [f"UPDATE card_review_state SET source_material_id = 'mat-2' WHERE item_id = {q(B_ITEMS[1])}"], "refuse"),
    ("an item receipt naming another material's card is refused", "ownership",
     [f"UPDATE card_review_operations SET result_json = replace(result_json, {q(B_ITEMS[1])}, {q(C_ITEMS[0])}) WHERE operation_id = {q(SUSPEND_OP)}"], "refuse"),
    ("an unrecomputable item_id is refused", "identity", bad_item_sql, "refuse"),
    ("an unrecomputable version id is refused", "identity",
     [f"UPDATE card_versions SET content_hash = {q('0' * 64)} WHERE id = {q(A_ID)}"], "refuse"),
    ("stored card text that no longer matches its content hash is refused", "identity",
     [f"UPDATE card_items SET back = 'Synthetic changed' WHERE id = {q(A_ITEMS[1])}"], "refuse"),
    ("a card_count that differs from the cards is refused", "identity",
     [f"UPDATE card_versions SET card_count = 3 WHERE id = {q(A_ID)}"], "refuse"),
    ("a blank stored card front is refused", "identity", [f"UPDATE card_items SET front = '   ' WHERE id = {q(A_ITEMS[1])}"], "refuse"),
    ("a live receipt with a NULL result is refused", "receipts",
     [IGNORE_CHECKS, f"UPDATE card_review_operations SET result_json = NULL WHERE operation_id = {q(SUSPEND_OP)}"], "refuse"),
    ("a tombstone that keeps result content is refused", "receipts",
     [IGNORE_CHECKS, f"UPDATE card_review_operations SET result_json = '{{}}' WHERE operation_id = {q(PRE_RESET_OP)}"], "refuse"),
    ("a receipt with a generation above its material's current generation is refused", "generation",
     [f"UPDATE card_review_operations SET generation = 1, result_json = replace(result_json, '\"generation\":0', '\"generation\":1') WHERE operation_id = {q(SUSPEND_OP)}"], "refuse"),
    ("an event with a generation above its material's current generation is refused", "generation",
     [f"UPDATE card_review_events SET generation = 1 WHERE id = {q(B0_LAST_OP)}"], "refuse"),
    ("a live pre-reset item receipt is refused", "generation",
     [f"UPDATE card_review_operations SET is_erased = 0, result_json = {q(canon(item_result('rate', C_ITEMS[0], 0, 1, iso(T + timedelta(days=1)), iso(T), False, None)))} WHERE operation_id = {q(PRE_RESET_OP)}"], "refuse"),
    ("a live reset whose result is not the captured generation plus one is refused", "generation",
     [f"UPDATE card_review_operations SET result_json = replace(result_json, '\"generation\":1', '\"generation\":2') WHERE operation_id = {q(RESET_OP)}"], "refuse"),
    ("a receipt id that is not a UUIDv4 is refused", "receipts",
     [f"UPDATE card_review_operations SET operation_id = 'not-a-uuid' WHERE operation_id = {q(FLAG_OP)}"], "refuse"),
    ("an item receipt with an unexpected result field is refused", "receipts",
     [f"UPDATE card_review_operations SET result_json = replace(result_json, '{{', '{{\"extra\":1,') WHERE operation_id = {q(FLAG_OP)}"], "refuse"),
    ("reps that do not match the rating events are refused", "events",
     [f"UPDATE card_review_state SET reps = 3 WHERE item_id = {q(B_ITEMS[0])}"], "refuse"),
    ("a projection that differs from its latest event is refused", "events",
     [f"UPDATE card_review_state SET lapses = 0 WHERE item_id = {q(B_ITEMS[0])}"], "refuse"),
    ("a never-rated row with a rating event is refused", "events",
     [f"INSERT INTO card_review_events (id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json) VALUES ({q(stray_op)}, {q(B_ITEMS[1])}, 0, 'good', {q(never_rated_event['lastReviewedAt'])}, 'simple-v1', 'null', {q(canon(never_rated_event))})",
      f"INSERT INTO card_review_operations (operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json) VALUES ({q(stray_op)}, 'rate', 'mat-1', 0, {q('a' * 64)}, {q(never_rated_event['lastReviewedAt'])}, 0, {q(canon(item_result('rate', B_ITEMS[1], 0, 2, never_rated_event['dueAt'], never_rated_event['lastReviewedAt'], True, None)))})"], "refuse"),
    ("a rating event without its live receipt is refused", "events",
     [f"UPDATE card_review_operations SET is_erased = 1, result_json = NULL WHERE operation_id = {q(C0_OP)}"], "refuse"),
    ("a due time inconsistent with the stored step is refused", "events",
     [f"UPDATE card_review_state SET step = 3 WHERE item_id = {q(A_ITEMS[0])}"], "refuse"),
    ("an unknown scheduler version is refused", "events",
     [f"UPDATE card_review_state SET scheduler_version = 'fsrs-6' WHERE item_id = {q(B_ITEMS[1])}"], "refuse"),
    ("due_at without last_reviewed_at is refused", "timestamps",
     [IGNORE_CHECKS, f"UPDATE card_review_state SET due_at = {q(STAMP)} WHERE item_id = {q(B_ITEMS[1])}"], "refuse"),
    ("a malformed receipt timestamp is refused", "timestamps",
     [f"UPDATE card_review_operations SET applied_at = '2026-10-06 10:00:00' WHERE operation_id = {q(FLAG_OP)}"], "refuse"),
    ("a malformed snapshot timestamp is refused", "timestamps",
     [f"UPDATE card_versions SET created_at = '2026-10-06T10:00:00Z' WHERE id = {q(A_ID)}"], "refuse"),
]

with open(OUT, "w", encoding="utf-8") as f:
    json.dump({
        "description": ("Shared schema-12 card-review validation contract (M2-3 C1). Each runner builds a fresh database from the "
                        "registered migrations, applies `baseline` then a case's `sql` on one connection, closes and reopens it, and "
                        "runs its validator. Native: crate::backup::verify_schema_12_card_semantics. Browser/Node: "
                        "validateCardReviewState. Both must return the listed accept/refuse outcome for every case. Generated by "
                        "docs/evidence/m2-card-review-c1-2026-10-06/generate_card_validation_cases.py with an independent Python "
                        "implementation of identity and simple-v1. Every value is synthetic."),
        "baseline": BASELINE,
        "cases": [{"name": n, "category": c, "sql": s, "expect": e} for n, c, s, e in CASES],
    }, f, indent=2, ensure_ascii=False)
    f.write("\n")
print(f"{len(BASELINE)} baseline statements, {len(CASES)} cases -> {OUT}")
