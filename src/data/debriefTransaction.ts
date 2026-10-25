import { validateSchoolName } from "@/domain/journalSchool";
import type { DebriefSaveOperation, SqlValue } from "./db";

/**
 * One debrief save as a single-connection immediate transaction.
 *
 * Used by node:sqlite (tests) and sql.js (plain browser). It must behave
 * exactly like the native `save_debrief_operation` in `src-tauri/src/debrief.rs`;
 * the shared contract fixtures in `src-tauri/fixtures/debrief-contract/` are run
 * through both and compared against the same expected rows. See
 * `DebriefSaveOperation` in `db.ts` for the retry and deliberate-edit rules.
 */
export async function executeDebriefSave(
  exec: (sql: string) => Promise<void> | void,
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  queryExists: (sql: string, params: SqlValue[]) => Promise<boolean> | boolean,
  operation: DebriefSaveOperation,
  timestamp: string = new Date().toISOString(),
): Promise<void> {
  const exists = async (sql: string, params: SqlValue[]) => Boolean(await queryExists(sql, params));
  /** A referenced record that no longer exists degrades to no link. */
  const liveOrNull = async (table: string, id: string | null | undefined) =>
    id && (await exists(`SELECT 1 FROM ${table} WHERE id = ?`, [id])) ? id : null;

  await exec("BEGIN IMMEDIATE");
  try {
    const { operationId, targetId: journalId, journal, action, question } = operation;
    const { withdrawActionId, withdrawQuestionId } = operation;

    // 0. An operation that already committed is a retry: change nothing.
    if (await exists("SELECT 1 FROM debrief_operations WHERE id = ?", [operationId])) {
      await exec("COMMIT");
      return;
    }

    // 1. Journal entry, written as shown in the form.
    const hasSchoolName = journal.schoolName !== undefined;
    const validatedSchoolName = hasSchoolName ? validateSchoolName(journal.schoolName) : null;
    const eventId = await liveOrNull("schedule_events", journal.eventId);
    const goalId = await liveOrNull("goals", journal.goalId);
    const materialIds: string[] = [];
    for (const id of journal.materialIds ?? []) {
      if (await liveOrNull("study_materials", id)) materialIds.push(id);
    }
    const fields: SqlValue[] = [
      eventId,
      journal.date,
      journal.title ?? "",
      journal.aircraftType ?? "",
      journal.aircraftId ?? "",
      journal.departureAirport ?? "",
      journal.arrivalAirport ?? "",
      journal.instructorName ?? "",
      journal.totalTime ?? null,
      journal.dualReceived ?? null,
      journal.soloTime ?? null,
      journal.picTime ?? null,
      journal.crossCountryTime ?? null,
      journal.nightTime ?? null,
      journal.actualInstrumentTime ?? null,
      journal.simulatedInstrumentTime ?? null,
      journal.dayLandings ?? null,
      journal.nightLandings ?? null,
      journal.mission ?? "",
      journal.practiced ?? "",
      journal.wentWell ?? "",
      journal.wasDifficult ?? "",
      journal.instructorFeedback ?? "",
      journal.questionsForNextTime ?? "",
      journal.confidence ?? null,
    ];
    if (await exists("SELECT 1 FROM journal_entries WHERE id = ?", [journalId])) {
      await run(
        `UPDATE journal_entries SET
            event_id = ?, date = ?, title = ?, aircraft_type = ?, aircraft_id = ?,
            departure_airport = ?, arrival_airport = ?, instructor_name = ?,
            total_time = ?, dual_received = ?, solo_time = ?, pic_time = ?,
            cross_country_time = ?, night_time = ?, actual_instrument_time = ?,
            simulated_instrument_time = ?, day_landings = ?, night_landings = ?,
            mission = ?, practiced = ?, went_well = ?, was_difficult = ?,
            instructor_feedback = ?, questions_for_next_time = ?, confidence = ?,
            school_name = CASE WHEN ? THEN ? ELSE school_name END,
            goal_id = ?, updated_at = ?
         WHERE id = ?`,
        [...fields, hasSchoolName ? 1 : 0, validatedSchoolName, goalId, timestamp, journalId],
      );
    } else {
      await run(
        `INSERT INTO journal_entries (
            id, event_id, date, title, aircraft_type, aircraft_id,
            departure_airport, arrival_airport, instructor_name,
            total_time, dual_received, solo_time, pic_time,
            cross_country_time, night_time, actual_instrument_time,
            simulated_instrument_time, day_landings, night_landings,
            mission, practiced, went_well, was_difficult,
            instructor_feedback, questions_for_next_time,
            confidence, school_name, goal_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [journalId, ...fields, validatedSchoolName, goalId, timestamp, timestamp],
      );
    }
    await run("DELETE FROM journal_materials WHERE journal_id = ?", [journalId]);
    for (const id of materialIds) {
      await run("INSERT INTO journal_materials (journal_id, material_id) VALUES (?, ?)", [journalId, id]);
    }

    // 2. Action: create, update only the debrief-managed fields, or withdraw.
    if (action) {
      const materialId = await liveOrNull("study_materials", action.materialId);
      if (await exists("SELECT 1 FROM next_actions WHERE id = ?", [action.id])) {
        if (
          !(await exists(
            "SELECT 1 FROM next_actions WHERE id = ? AND related_type = 'journal' AND related_id = ?",
            [action.id, journalId],
          ))
        ) {
          throw new Error(`Action ${action.id} is not owned by journal ${journalId}`);
        }
        await run(
          `UPDATE next_actions SET
              title = ?,
              source_material_id = CASE WHEN material_id IS ? THEN source_material_id ELSE NULL END,
              material_id = ?,
              updated_at = ?
           WHERE id = ? AND related_type = 'journal' AND related_id = ?`,
          [action.title, materialId, materialId, timestamp, action.id, journalId],
        );
      } else {
        await run(
          `INSERT INTO next_actions (
              id, title, description, category, priority, status,
              due_date, estimated_minutes, related_type, related_id,
              material_id, created_at, updated_at
           ) VALUES (?, ?, '', 'prepare', 'next_up', 'open', NULL, NULL, 'journal', ?, ?, ?, ?)`,
          [action.id, action.title, journalId, materialId, timestamp, timestamp],
        );
      }
    } else if (withdrawActionId) {
      if (
        await exists(
          "SELECT 1 FROM next_actions WHERE id = ? AND NOT (related_type IS 'journal' AND related_id IS ?)",
          [withdrawActionId, journalId],
        )
      ) {
        throw new Error(`Action ${withdrawActionId} is not owned by journal ${journalId}`);
      }
      await run("DELETE FROM next_actions WHERE id = ? AND related_type = 'journal' AND related_id = ?", [
        withdrawActionId,
        journalId,
      ]);
    }

    // 3. Question: create, update only the debrief-managed fields, or withdraw.
    if (question) {
      const eventIdQ = await liveOrNull("schedule_events", question.eventId);
      const materialIdQ = await liveOrNull("study_materials", question.materialId);
      if (await exists("SELECT 1 FROM questions WHERE id = ?", [question.id])) {
        if (!(await exists("SELECT 1 FROM questions WHERE id = ? AND journal_id IS ?", [question.id, journalId]))) {
          throw new Error(`Question ${question.id} is not owned by journal ${journalId}`);
        }
        await run(
          `UPDATE questions SET
              text = ?,
              source_event_id = CASE WHEN event_id IS ? THEN source_event_id ELSE NULL END,
              event_id = ?,
              source_material_id = CASE WHEN material_id IS ? THEN source_material_id ELSE NULL END,
              material_id = ?,
              updated_at = ?
           WHERE id = ? AND journal_id = ?`,
          [question.text, eventIdQ, eventIdQ, materialIdQ, materialIdQ, timestamp, question.id, journalId],
        );
      } else {
        await run(
          `INSERT INTO questions (
              id, text, topic, event_id, material_id, journal_id,
              status, answer, created_at, updated_at
           ) VALUES (?, ?, 'general', ?, ?, ?, 'to_ask', '', ?, ?)`,
          [question.id, question.text, eventIdQ, materialIdQ, journalId, timestamp, timestamp],
        );
      }
    } else if (withdrawQuestionId) {
      if (
        await exists("SELECT 1 FROM questions WHERE id = ? AND journal_id IS NOT ?", [
          withdrawQuestionId,
          journalId,
        ])
      ) {
        throw new Error(`Question ${withdrawQuestionId} is not owned by journal ${journalId}`);
      }
      await run("DELETE FROM questions WHERE id = ? AND journal_id = ?", [withdrawQuestionId, journalId]);
    }

    // 4. Record the operation so a replay of it is a no-op.
    await run("INSERT INTO debrief_operations (id, journal_id, applied_at) VALUES (?, ?, ?)", [
      operationId,
      journalId,
      timestamp,
    ]);

    await exec("COMMIT");
  } catch (error) {
    try {
      await exec("ROLLBACK");
    } catch {
      // The original error is the one worth reporting.
    }
    throw error;
  }
}
