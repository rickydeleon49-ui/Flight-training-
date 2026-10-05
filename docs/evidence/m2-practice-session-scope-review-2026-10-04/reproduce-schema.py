"""Reproduce planning invariants in the submitted sketch; no application data."""
from pathlib import Path
import hashlib
import json
import sqlite3

proposal = Path(__file__).with_name("submitted-scope.md.txt")
text = proposal.read_text()
ddl = text.split("```sql\n", 1)[1].split("```", 1)[0]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.execute("CREATE TABLE study_materials(id TEXT PRIMARY KEY)")
db.executescript(ddl)
db.execute("INSERT INTO study_materials VALUES ('material-a')")
for version in ["version-a", "version-b"]:
    db.execute(
        "INSERT INTO practice_test_versions(id,source_material_id,source_material_title,content_hash,created_at) VALUES (?,?,?,?,?)",
        (version, "material-a", "Synthetic source", "test-hash", "2026-10-04"),
    )
    db.execute(
        "INSERT INTO practice_test_items(id,version_id,ordinal,question_text,options_json,correct_index,explanation) VALUES (?,?,?,?,?,?,?)",
        ("item-" + version, version, 0, "Private synthetic question " + "Q" * 2048, '["A","B"]', 0, "Explanation"),
    )
db.execute(
    "INSERT INTO practice_attempts(id,version_id,source_material_id,started_at,status,total_questions) VALUES (?,?,?,?,?,?)",
    ("attempt-a", "version-a", "material-a", "2026-10-04", "completed", 1),
)
db.execute(
    "INSERT INTO practice_responses(id,attempt_id,item_id,selected_index,is_dont_know,is_correct,answered_at) VALUES (?,?,?,?,?,?,?)",
    ("response-a", "attempt-a", "item-version-b", 99, 1, 1, "2026-10-04"),
)
observations = {
    "proposal_sha256": hashlib.sha256(proposal.read_bytes()).hexdigest(),
    "foreign_keys_enabled": db.execute("PRAGMA foreign_keys").fetchone()[0],
    "same_material_active_versions": db.execute("SELECT COUNT(*) FROM practice_test_versions WHERE source_material_id=? AND is_active=1", ("material-a",)).fetchone()[0],
    "cross_version_response_stored": db.execute("SELECT a.version_id,i.version_id FROM practice_responses r JOIN practice_attempts a ON a.id=r.attempt_id JOIN practice_test_items i ON i.id=r.item_id").fetchone(),
    "contradictory_response_stored": db.execute("SELECT selected_index,is_dont_know,is_correct FROM practice_responses").fetchone(),
}
db.execute("DELETE FROM study_materials WHERE id='material-a'")
observations["retained_after_deletion"] = {
    table: db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
    for table in ["practice_test_versions", "practice_test_items", "practice_attempts", "practice_responses"]
}
observations["remaining_active_versions"] = db.execute("SELECT COUNT(*) FROM practice_test_versions WHERE source_material_id IS NULL AND is_active=1").fetchone()[0]
observations["retained_question_characters"] = db.execute("SELECT SUM(length(question_text)) FROM practice_test_items").fetchone()[0]
observations["foreign_key_violations"] = db.execute("PRAGMA foreign_key_check").fetchall()
expected = json.loads(Path(__file__).with_name("schema-observations.json").read_text())
assert json.loads(json.dumps(observations)) == expected
print(json.dumps(observations, indent=2))
db.close()
