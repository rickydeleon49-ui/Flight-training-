/**
 * Schema migrations.
 *
 * The SQL is imported from the same files the Rust side compiles in, so the
 * desktop database and the development fallback are always the same shape.
 * Add a new file and a new entry here; never edit an applied migration.
 */
import initialSchema from "../../src-tauri/migrations/0001_initial_schema.sql?raw";
import profileDetails from "../../src-tauri/migrations/0002_profile_details.sql?raw";
import personalNote from "../../src-tauri/migrations/0003_personal_note.sql?raw";
import appMetadata from "../../src-tauri/migrations/0004_app_metadata.sql?raw";
import flightLog from "../../src-tauri/migrations/0005_flight_log.sql?raw";
import pilotToolkit from "../../src-tauri/migrations/0006_pilot_toolkit.sql?raw";
import aiStudy from "../../src-tauri/migrations/0007_ai_study.sql?raw";
import notes from "../../src-tauri/migrations/0008_notes.sql?raw";
import practiceTests from "../../src-tauri/migrations/0009_practice_tests.sql?raw";
import debriefLinks from "../../src-tauri/migrations/0010_debrief_links.sql?raw";
import practiceSessions from "../../src-tauri/migrations/0011_practice_sessions.sql?raw";
import cardReviews from "../../src-tauri/migrations/0012_card_reviews.sql?raw";
import splitSourceLineage from "../../src-tauri/migrations/0013_split_source_lineage.sql?raw";
import skillsEvidence from "../../src-tauri/migrations/0014_skills_evidence.sql?raw";
import documentNavigation from "../../src-tauri/migrations/0015_document_navigation.sql?raw";
import manualStudy from "../../src-tauri/migrations/0016_manual_study.sql?raw";
import practiceAuthoring from "../../src-tauri/migrations/0017_practice_authoring.sql?raw";

import studySetSaveReceipts from "../../src-tauri/migrations/0019_study_set_save_receipts.sql?raw";
import pdfKitProvenance from "../../src-tauri/migrations/0018_pdf_kit_provenance.sql?raw";

import homework from "../../src-tauri/migrations/0020_homework.sql?raw";
import flightSchools from "../../src-tauri/migrations/0021_flight_schools.sql?raw";
import journalSchool from "../../src-tauri/migrations/0022_journal_school.sql?raw";

import studyPageSources from "../../src-tauri/migrations/0024_study_page_sources.sql?raw";
import homeworkAnswers from "../../src-tauri/migrations/0023_homework_answers.sql?raw";
import oralScenarios from "../../src-tauri/migrations/0025_oral_scenarios.sql?raw";

import visualCardRegions from "../../src-tauri/migrations/0026_visual_card_regions.sql?raw";

import faaReferenceCopies from "../../src-tauri/migrations/0027_faa_reference_copies.sql?raw";

import practiceItemAcsTasks from "../../src-tauri/migrations/0028_practice_item_acs_tasks.sql?raw";

export interface Migration {
  version: number;
  description: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  { version: 1, description: "initial_schema", sql: initialSchema },
  { version: 2, description: "profile_details", sql: profileDetails },
  { version: 3, description: "personal_note", sql: personalNote },
  { version: 4, description: "app_metadata", sql: appMetadata },
  { version: 5, description: "flight_log", sql: flightLog },
  { version: 6, description: "pilot_toolkit", sql: pilotToolkit },
  { version: 7, description: "ai_study", sql: aiStudy },
  { version: 8, description: "notes", sql: notes },
  { version: 9, description: "practice_tests", sql: practiceTests },
  { version: 10, description: "debrief_links", sql: debriefLinks },
  { version: 11, description: "practice_sessions", sql: practiceSessions },
  { version: 12, description: "card_reviews", sql: cardReviews },
  { version: 13, description: "split_source_lineage", sql: splitSourceLineage },
  { version: 14, description: "skills_evidence", sql: skillsEvidence },
  { version: 15, description: "document_navigation", sql: documentNavigation },
  { version: 16, description: "manual_study", sql: manualStudy },
  { version: 17, description: "practice_authoring", sql: practiceAuthoring },
  { version: 18, description: "pdf_kit_provenance", sql: pdfKitProvenance },
  { version: 19, description: "study_set_save_receipts", sql: studySetSaveReceipts },
  { version: 20, description: "homework", sql: homework },
  { version: 21, description: "flight_schools", sql: flightSchools },
  { version: 22, description: "journal_school", sql: journalSchool },
  { version: 23, description: "homework_answers", sql: homeworkAnswers },
  { version: 24, description: "study_page_sources", sql: studyPageSources },
  { version: 25, description: "oral_scenarios", sql: oralScenarios },
  { version: 26, description: "visual_card_regions", sql: visualCardRegions },
  { version: 27, description: "faa_reference_copies", sql: faaReferenceCopies },
  { version: 28, description: "practice_item_acs_tasks", sql: practiceItemAcsTasks },
];

/**
 * Apply any migrations the database has not yet seen.
 *
 * Only used by the fallback drivers — in the desktop app the Rust SQL plugin
 * runs the identical SQL through its own migration table.
 */
export async function applyMigrations(
  exec: (sql: string) => void,
  appliedVersions: Set<number>,
): Promise<void> {
  exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       description TEXT NOT NULL,
       applied_at TEXT NOT NULL
     )`,
  );

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;
    exec(migration.sql);
    exec(
      `INSERT INTO schema_migrations (version, description, applied_at)
       VALUES (${migration.version}, '${migration.description}', '${new Date().toISOString()}')`,
    );
  }
}
