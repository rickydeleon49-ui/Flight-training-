#!/usr/bin/env node
/**
 * Her Flight Deck — reviewer check: does the provisional candidate migration coexist with the
 * migration set that is actually on accepted main now that M3 shipped 0014?
 *
 * Usage: node candidate-coexistence.mjs [path/to/Flight-training-m4-viewer-evaluation]
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../");
const target = process.argv[2] ?? "/Users/rickymac/code/Flight-training-m4-viewer-evaluation";
const packRel = "docs/evidence/m4-document-navigation-integration-corrections-2026-10-11";
const SHA_A = "a".repeat(64);

const migDir = path.join(repoRoot, "src-tauri/migrations");
const all = fs.readdirSync(migDir).filter((p) => p.endsWith(".sql")).sort();
const ceiling = Number(process.env.CANDIDATE_CEILING ?? 14);
const candidate = fs.readFileSync(path.join(here, "submitted", "candidate_migration_0015.sql"), "utf8");
const { DocumentPersistenceProtocol } = await import(path.join(here, "submitted", "persistenceProtocol.mjs"));

function runThrough(upto) {
  const names = all.filter((p) => Number(p.slice(0, 4)) <= upto).sort();
  const db = new DatabaseSync(":memory:");
  try {
    for (const n of names) db.exec(fs.readFileSync(path.join(migDir, n), "utf8"));
    const proto = new DocumentPersistenceProtocol(db);
    proto.applyCandidateDdl(candidate);
    db.prepare(
      "INSERT INTO study_materials (id,title,material_type,topic,file_path,created_at,updated_at) VALUES ('m1','T','handbook','x','/t.pdf','x','x')"
    ).run();
    proto.saveContentIdentity("m1", SHA_A, 50);
    proto.addBookmark({ id: "b1", materialId: "m1", pageIndex: 42, originatingContentSha256: SHA_A, title: "t" });
    proto.saveReadingState("m1", 42, { contentSha256: SHA_A });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length;
    return {
      migrations: names.length,
      lastMigration: names[names.length - 1],
      tables,
      bookmarkStatus: db.prepare("SELECT status FROM material_bookmarks WHERE id='b1'").get().status,
      readingStatus: db.prepare("SELECT status FROM material_reading_state WHERE material_id='m1'").get().status,
      candidateNumberClash: names.some((n) => n.startsWith("0015")),
    };
  } finally {
    db.close();
  }
}

const submissionPremise = runThrough(13);
const acceptedMain = runThrough(ceiling);
console.log(
  JSON.stringify(
    {
      repoHead: process.env.REVIEW_HEAD ?? "",
      migrationsOnAcceptedMain: all,
      submissionPremise: { filter: "<= 13 (as delivered in databaseLifecycle.test.mjs)", ...submissionPremise },
      acceptedMain: { filter: `<= ${ceiling} (includes M3 migration 0014)`, ...acceptedMain },
      candidateCoexistsWithAcceptedMain: acceptedMain.tables > submissionPremise.tables && !acceptedMain.candidateNumberClash,
      submittedSuiteWouldAssertThirteen: "assert.equal(names.length, 13) — passes on a stale base, silently skips 0014 on current main",
    },
    null,
    2
  )
);
