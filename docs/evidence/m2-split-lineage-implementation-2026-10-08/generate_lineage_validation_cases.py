"""Write src-tauri/fixtures/split-lineage/validation-cases.json.

The shared schema-13 split-lineage validation contract. Expected outcomes are
decided here, independently of the Rust (`verify_schema_13_lineage_semantics`)
and TypeScript (`validateSplitLineageState`) validators, which must both match.
Every value is synthetic. Run from the repository root:

    python3 docs/evidence/m2-split-lineage-implementation-2026-10-08/generate_lineage_validation_cases.py
"""
import hashlib
import json
import os

T0 = "2026-10-08T12:00:00.000Z"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


H_ROOT = sha(b"synthetic root handbook")
H_A = sha(b"synthetic part A")
RECEIPT = json.dumps(
    {"core": {"sourceMaterialId": "R", "plan": [{"id": "A"}]}, "note": "synthetic"},
    sort_keys=True,
    separators=(",", ":"),
)
H_RECEIPT = sha(RECEIPT.encode("utf-8"))


def q(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def material(mid: str, title: str) -> str:
    return (
        "INSERT INTO study_materials (id, title, file_path, created_at, updated_at) "
        f"VALUES ({q(mid)}, {q(title)}, {q(mid + '.pdf')}, {q(T0)}, {q(T0)})"
    )


BASELINE = [
    material("R", "Synthetic root"),
    material("A", "Synthetic part A"),
    material("B", "Synthetic part B"),
    material("X", "Synthetic legacy part"),
    "INSERT INTO material_split_lineage (material_id, parent_material_id, root_material_id, "
    "source_page_start, source_page_end, parent_page_start, parent_page_end, child_page_count, "
    "source_file_name, source_title, source_content_sha256, source_total_pages, parent_file_name, "
    "parent_title, parent_content_sha256, parent_total_pages, nested_level, created_at) VALUES "
    f"('A', NULL, 'R', 101, 300, NULL, NULL, 200, 'root.pdf', 'Synthetic root', {q(H_ROOT)}, 400, "
    f"NULL, NULL, NULL, NULL, 1, {q(T0)})",
    "INSERT INTO material_split_lineage (material_id, parent_material_id, root_material_id, "
    "source_page_start, source_page_end, parent_page_start, parent_page_end, child_page_count, "
    "source_file_name, source_title, source_content_sha256, source_total_pages, parent_file_name, "
    "parent_title, parent_content_sha256, parent_total_pages, nested_level, created_at) VALUES "
    f"('B', 'A', 'R', 120, 140, 20, 40, 21, 'root.pdf', 'Synthetic root', {q(H_ROOT)}, 400, "
    f"'a.pdf', 'Synthetic part A', {q(H_A)}, 200, 2, {q(T0)})",
    "INSERT INTO split_operation_log (operation_id, source_material_id, receipt_canonical_json, "
    f"receipt_hash, status, created_at, updated_at) VALUES ({q(H_RECEIPT)}, 'R', {q(RECEIPT)}, "
    f"{q(H_RECEIPT)}, 'committed', {q(T0)}, {q(T0)})",
]

def edit_table(table: str, old: str, new: str) -> list:
    return [
        "PRAGMA writable_schema = ON",
        f"UPDATE sqlite_master SET sql = replace(sql, {q(old)}, {q(new)}) WHERE name = {q(table)}",
        "PRAGMA writable_schema = OFF",
    ]


CASES = [
    {"name": "valid direct, nested and committed records", "category": "control", "sql": [], "expect": "accept"},
    {
        "name": "unknown fingerprints (legacy-style NULLs) are accepted",
        "category": "control",
        "sql": ["UPDATE material_split_lineage SET source_content_sha256 = NULL WHERE material_id = 'A'"],
        "expect": "accept",
    },
    {
        "name": "a pending and a cancelled record are accepted",
        "category": "control",
        "sql": [
            "UPDATE split_operation_log SET status = 'pending'",
        ],
        "expect": "accept",
    },
    {
        "name": "equivalent table formatting is accepted",
        "category": "schema",
        "sql": edit_table("material_split_lineage", "    ", " "),
        "expect": "accept",
    },
    {
        "name": "an extra lineage column is refused",
        "category": "schema",
        "sql": ["ALTER TABLE material_split_lineage ADD COLUMN extra TEXT"],
        "expect": "refuse",
    },
    {
        "name": "a missing operation log is refused",
        "category": "schema",
        "sql": ["DROP TABLE split_operation_log"],
        "expect": "refuse",
    },
    {
        "name": "a removed self-root CHECK is refused",
        "category": "schema-check",
        "sql": edit_table("material_split_lineage", "CHECK (material_id != root_material_id),", ""),
        "expect": "refuse",
    },
    {
        "name": "a root reference that cascades deletion is refused",
        "category": "schema-fk",
        "sql": edit_table(
            "material_split_lineage",
            "root_material_id       TEXT REFERENCES study_materials(id) ON DELETE SET NULL",
            "root_material_id       TEXT REFERENCES study_materials(id) ON DELETE CASCADE",
        ),
        "expect": "refuse",
    },
    {
        "name": "a missing lineage index is refused",
        "category": "schema-index",
        "sql": ["DROP INDEX idx_split_lineage_parent"],
        "expect": "refuse",
    },
    {
        "name": "a missing operation status index is refused",
        "category": "schema-index",
        "sql": ["DROP INDEX idx_split_operation_status"],
        "expect": "refuse",
    },
    {
        "name": "a malformed original fingerprint is refused",
        "category": "fingerprints",
        "sql": ["UPDATE material_split_lineage SET source_content_sha256 = 'abc' WHERE material_id = 'A'"],
        "expect": "refuse",
    },
    {
        "name": "an uppercase parent fingerprint is refused",
        "category": "fingerprints",
        "sql": [f"UPDATE material_split_lineage SET parent_content_sha256 = {q(H_A.upper())} WHERE material_id = 'B'"],
        "expect": "refuse",
    },
    {
        "name": "an edited receipt is refused",
        "category": "records",
        "sql": ["UPDATE split_operation_log SET receipt_canonical_json = replace(receipt_canonical_json, 'synthetic', 'forged')"],
        "expect": "refuse",
    },
    {
        "name": "an operation id that is not the receipt hash is refused",
        "category": "records",
        "sql": [f"UPDATE split_operation_log SET operation_id = {q(sha(b'another'))}"],
        "expect": "refuse",
    },
    {
        "name": "an uppercase receipt hash is refused",
        "category": "records",
        "sql": [
            f"UPDATE split_operation_log SET receipt_hash = {q(H_RECEIPT.upper())}, operation_id = {q(H_RECEIPT.upper())}"
        ],
        "expect": "refuse",
    },
]

contract = {
    "description": (
        "Shared schema-13 split-lineage validation contract (M2 split lineage). Each runner builds a "
        "fresh database from the registered migrations, applies `baseline` then a case's `sql`, "
        "closes and reopens it, and runs its validator. Native: "
        "crate::backup::verify_schema_13_lineage_semantics. Browser/Node: validateSplitLineageState. "
        "Both must return the listed outcome. Generated by "
        "docs/evidence/m2-split-lineage-implementation-2026-10-08/generate_lineage_validation_cases.py. "
        "Every value is synthetic."
    ),
    "baseline": BASELINE,
    "cases": CASES,
}
path = os.path.join("src-tauri", "fixtures", "split-lineage", "validation-cases.json")
with open(path, "w", encoding="utf-8") as handle:
    json.dump(contract, handle, indent=2, ensure_ascii=False)
    handle.write("\n")
print(f"wrote {path}: {len(CASES)} cases")
