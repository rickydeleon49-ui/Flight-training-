import sqlite3,pathlib,sys
r=pathlib.Path(sys.argv[1]);db=sqlite3.connect(":memory:");db.execute("PRAGMA foreign_keys=ON")
for f in sorted((r/"src-tauri/migrations").glob("*.sql")):db.executescript(f.read_text())
db.executescript((r/"docs/evidence/m4-document-navigation-eval-2026-10-11/candidate/candidate_migration_0015.sql").read_text())
db.execute("INSERT INTO study_materials (id,title,topic,material_type,created_at,updated_at) VALUES ('m','Synthetic','general','pdf','x','x')")
db.execute("INSERT INTO material_content_identities VALUES ('m',?,50,'x')",('a'*64,))
db.execute("INSERT INTO material_bookmarks VALUES ('b','m',42,'42','Synthetic','note','x','x')")
db.execute("INSERT INTO material_reading_state VALUES ('m',42,'42','x')")
old=db.execute('SELECT * FROM material_bookmarks').fetchone()
db.execute('UPDATE material_content_identities SET content_sha256=?,total_pages=10',('b'*64,))
assert db.execute('SELECT * FROM material_bookmarks').fetchone()==old
print('REPRODUCED: identity replacement leaves stale bookmark without its originating hash or invalidation state')
db.execute("UPDATE material_content_identities SET content_sha256='not-a-sha256'")
print('REPRODUCED: malformed hash accepted')
