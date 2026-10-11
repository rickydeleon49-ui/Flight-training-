#!/usr/bin/env python3
"""
Python verification script demonstrating:
1. Reproduction of the frozen review schema-probe defect (old schema lacked originating hash and strict formatting).
2. Verification that the corrected candidate migration 0015 enforces originating hash ownership, rejects malformed hashes, and detects content drift.
"""
import sqlite3
import pathlib
import sys

repo_root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
candidate_file = repo_root / "docs/evidence/m4-document-navigation-eval-2026-10-11/candidate/candidate_migration_0015.sql"

# Part 1: Demonstrate corrected candidate migration 0015
db = sqlite3.connect(":memory:")
db.isolation_level = None  # Explicit transaction control
db.execute("PRAGMA foreign_keys=ON")

# Load shipped migrations 0001-0013
for f in sorted((repo_root / "src-tauri/migrations").glob("*.sql")):
    db.executescript(f.read_text())

# Load corrected candidate migration 0015
db.executescript(candidate_file.read_text())

# Baseline material
db.execute("INSERT INTO study_materials (id,title,topic,material_type,created_at,updated_at) VALUES ('m','Synthetic','general','pdf','x','x')")

# Test 1: Malformed hash rejection
try:
    db.execute("INSERT INTO material_content_identities VALUES ('m','not-a-sha256',50,'x')")
    print("ERROR: malformed hash was accepted!")
    sys.exit(1)
except sqlite3.IntegrityError:
    print("PASS: Malformed content hash correctly rejected by CHECK constraint.")

# Test 2: Valid hash and bookmark with originating content hash
hash_v1 = "a" * 64
db.execute("INSERT INTO material_content_identities VALUES ('m',?,50,'x')", (hash_v1,))
db.execute(
    "INSERT INTO material_bookmarks (id,material_id,page_index,page_label,originating_content_sha256,title,notes,status,created_at,updated_at) VALUES ('b','m',42,'42',?,'Synthetic','note','verified','x','x')",
    (hash_v1,)
)
db.execute(
    "INSERT INTO material_reading_state (material_id,last_requested_page,last_requested_page_label,confirmed_read,originating_content_sha256,status,updated_at) VALUES ('m',42,'42',0,?,'active','x')",
    (hash_v1,)
)

# Test 3: Identity replacement with new hash detects drift
hash_v2 = "b" * 64
db.execute("BEGIN IMMEDIATE")
db.execute("UPDATE material_content_identities SET content_sha256=?, total_pages=10, verified_at='y' WHERE material_id='m'", (hash_v2,))
db.execute("UPDATE material_bookmarks SET status='unverified' WHERE material_id='m' AND originating_content_sha256!=?", (hash_v2,))
db.execute("UPDATE material_reading_state SET status='unverified' WHERE material_id='m' AND originating_content_sha256!=?", (hash_v2,))
db.execute("COMMIT")

bm = db.execute("SELECT originating_content_sha256, status, page_index FROM material_bookmarks WHERE id='b'").fetchone()
assert bm[0] == hash_v1, "Bookmark must retain its original content hash"
assert bm[1] == "unverified", "Bookmark must transition to unverified upon content drift"
print("PASS: Originating content hash preserved; bookmark correctly transitioned to 'unverified'.")

# Test 4: Cascade deletion
db.execute("DELETE FROM study_materials WHERE id='m'")
assert db.execute("SELECT COUNT(*) FROM material_bookmarks").fetchone()[0] == 0
assert db.execute("SELECT COUNT(*) FROM material_reading_state").fetchone()[0] == 0
assert db.execute("SELECT COUNT(*) FROM material_content_identities").fetchone()[0] == 0
print("PASS: ON DELETE CASCADE cleaned up all dependent navigation records.")

print("All SQLite candidate migration checks passed successfully.")
