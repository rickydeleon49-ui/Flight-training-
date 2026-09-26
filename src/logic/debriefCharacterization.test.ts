/**
 * D1 — Characterize existing debrief behavior.
 *
 * Traces src/logic/dashboard, actions, and preparation, plus the journal,
 * action, and question repositories against real SQLite persistence.
 *
 * Documents:
 * 1. Debrief creation workflow (journal entry + action + question)
 * 2. Normal edits to journal, action, and question maintain links
 * 3. Closing and reopening the database (reloads) preserves all records and links
 * 4. Interactions with actions.ts, preparation.ts, and dashboard.ts
 * 5. Current links, missing links, and unavailable source behavior
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeSqliteDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import type { JournalEntry, NextAction, Question, ScheduleEvent } from "@/domain/types";
import { actionsFor, isOverdue, planActions } from "./actions";
import { buildDashboard, type DashboardSources } from "./dashboard";
import { lessonPreparation } from "./preparation";
import { makeEvent, makeProfile } from "@/testing/factories";

const TODAY = "2026-09-05";

describe("D1: debrief persistence across normal edits and reloads", () => {
  let tempDir: string;
  let dbFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "flight-deck-d1-"));
    dbFile = join(tempDir, "debrief-test.db");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup best effort
    }
  });

  it("creates debrief action and question and preserves links across normal user edits", async () => {
    const db = await createNodeSqliteDatabase(dbFile);
    try {
      const repos = createRepositories(db);

      // 1. A flight lesson exists on the schedule
      const lesson = await repos.schedule.create({
        title: "Crosswind Landings",
        eventType: "flight_lesson",
        date: "2026-09-04",
        instructor: "Captain Morgan",
        status: "completed",
      });

      // 2. Debrief journal entry created from that lesson
      const journalEntry = await repos.journal.create({
        eventId: lesson.id,
        date: "2026-09-04",
        title: "Crosswind Landings Debrief",
        aircraftType: "C172S",
        instructorName: "Captain Morgan",
        totalTime: 1.4,
        dualReceived: 1.4,
        dayLandings: 5,
        mission: "Crosswind technique and pattern work",
        wentWell: "Good airspeed control on final",
        wasDifficult: "Rudder coordination during flare in gusts",
        instructorFeedback: "Maintain crosswind correction all the way through rollout",
        questionsForNextTime: "How to handle sudden wind shifts on short final?",
        confidence: 3,
      });

      // 3. Debrief-created action (matching JournalForm.tsx lines 239-246)
      const debriefAction = await repos.actions.create({
        title: "Practice crosswind rudder coordination",
        category: "prepare",
        priority: "next_up",
        relatedType: "journal",
        relatedId: journalEntry.id,
      });

      // 4. Debrief-created question (matching JournalForm.tsx lines 250-256)
      const debriefQuestion = await repos.questions.create({
        text: "How to handle sudden wind shifts on short final?",
        journalId: journalEntry.id,
        status: "to_ask",
        // Note: eventId is null in JournalForm.tsx when created from debrief
      });

      expect(debriefAction.relatedType).toBe("journal");
      expect(debriefAction.relatedId).toBe(journalEntry.id);
      expect(debriefQuestion.journalId).toBe(journalEntry.id);
      expect(debriefQuestion.eventId).toBeNull();

      // Normal user edits to journal, action, and question
      await repos.journal.update(journalEntry.id, {
        confidence: 4,
        instructorFeedback: "Maintain crosswind correction all the way through rollout. Great progress.",
      });

      await repos.actions.update(debriefAction.id, {
        estimatedMinutes: 20,
        priority: "important",
        dueDate: TODAY,
      });

      await repos.questions.update(debriefQuestion.id, {
        answer: "Transition smoothly to slip, align nose with centerline.",
        status: "answered",
      });

      // Verify state after edits
      const updatedJournal = (await repos.journal.list()).find((j) => j.id === journalEntry.id)!;
      expect(updatedJournal.confidence).toBe(4);

      const updatedAction = (await repos.actions.list()).find((a) => a.id === debriefAction.id)!;
      expect(updatedAction.relatedType).toBe("journal");
      expect(updatedAction.relatedId).toBe(journalEntry.id);
      expect(updatedAction.estimatedMinutes).toBe(20);
      expect(updatedAction.dueDate).toBe(TODAY);

      const updatedQuestion = (await repos.questions.list()).find((q) => q.id === debriefQuestion.id)!;
      expect(updatedQuestion.journalId).toBe(journalEntry.id);
      expect(updatedQuestion.status).toBe("answered");
      expect(updatedQuestion.answeredAt).not.toBeNull();
    } finally {
      db.close();
    }
  });

  it("reloads from persistent SQLite database on disk and verifies all IDs, fields, user edits, and links survive", async () => {
    let db1: Awaited<ReturnType<typeof createNodeSqliteDatabase>> | undefined;
    let db2: Awaited<ReturnType<typeof createNodeSqliteDatabase>> | undefined;

    try {
      // 1. Initial app launch / connection: populate on-disk database
      db1 = await createNodeSqliteDatabase(dbFile);
      const repos1 = createRepositories(db1);

      const journal = await repos1.journal.create({
        date: "2026-09-04",
        title: "Night Cross-Country Debrief",
        confidence: 3,
        instructorFeedback: "Good altitude management on final.",
      });

      const action = await repos1.actions.create({
        title: "Review night illusions",
        category: "prepare",
        priority: "next_up",
        relatedType: "journal",
        relatedId: journal.id,
        estimatedMinutes: 15,
        dueDate: null,
      });

      const question = await repos1.questions.create({
        text: "How to identify black hole approach?",
        journalId: journal.id,
        status: "to_ask",
      });

      // 2. Perform meaningful user edits through the actual repositories before restart
      await repos1.journal.update(journal.id, {
        confidence: 5,
        instructorFeedback: "Good altitude management on final. Excellent scan during rollout.",
      });

      await repos1.actions.update(action.id, {
        title: "Review night visual illusions in AIM Chapter 8",
        priority: "important",
        estimatedMinutes: 25,
        dueDate: TODAY,
      });

      await repos1.questions.update(question.id, {
        answer: "Maintain cross-check with altimeter and VSI; avoid relying purely on peripheral visual cues.",
        status: "answered",
      });

      // 3. Close the database connection (simulates app exit, ensuring disk sync)
      db1.close();
      db1 = undefined;

      // 4. Second launch: reopen the exact same persistent file from disk
      db2 = await createNodeSqliteDatabase(dbFile);
      const repos2 = createRepositories(db2);

      const reloadedJournals = await repos2.journal.list();
      const reloadedActions = await repos2.actions.list();
      const reloadedQuestions = await repos2.questions.list();

      // Assert survival of original IDs, user-edited values, and linkages across persistent reload
      expect(reloadedJournals).toHaveLength(1);
      expect(reloadedJournals[0]!.id).toBe(journal.id);
      expect(reloadedJournals[0]!.title).toBe("Night Cross-Country Debrief");
      expect(reloadedJournals[0]!.confidence).toBe(5);
      expect(reloadedJournals[0]!.instructorFeedback).toContain("Excellent scan during rollout");

      expect(reloadedActions).toHaveLength(1);
      expect(reloadedActions[0]!.id).toBe(action.id);
      expect(reloadedActions[0]!.relatedType).toBe("journal");
      expect(reloadedActions[0]!.relatedId).toBe(journal.id);
      expect(reloadedActions[0]!.title).toBe("Review night visual illusions in AIM Chapter 8");
      expect(reloadedActions[0]!.priority).toBe("important");
      expect(reloadedActions[0]!.estimatedMinutes).toBe(25);
      expect(reloadedActions[0]!.dueDate).toBe(TODAY);

      expect(reloadedQuestions).toHaveLength(1);
      expect(reloadedQuestions[0]!.id).toBe(question.id);
      expect(reloadedQuestions[0]!.journalId).toBe(journal.id);
      expect(reloadedQuestions[0]!.text).toBe("How to identify black hole approach?");
      expect(reloadedQuestions[0]!.status).toBe("answered");
      expect(reloadedQuestions[0]!.answer).toContain("Maintain cross-check with altimeter");
      expect(reloadedQuestions[0]!.answeredAt).not.toBeNull();
    } finally {
      if (db1) {
        try { db1.close(); } catch { /* ignore */ }
      }
      if (db2) {
        try { db2.close(); } catch { /* ignore */ }
      }
    }
  });

  it("characterizes deletion: demonstrates foreign key ON DELETE SET NULL on question and dangling reference on action", async () => {
    const db = await createNodeSqliteDatabase(dbFile);
    try {
      const repos = createRepositories(db);

      const entry = await repos.journal.create({
        date: "2026-09-01",
        title: "Solo flight",
      });

      const action = await repos.actions.create({
        title: "Review solo debrief",
        category: "prepare",
        relatedType: "journal",
        relatedId: entry.id,
      });

      const question = await repos.questions.create({
        text: "Was flare too high?",
        journalId: entry.id,
        status: "to_ask",
      });

      // Delete the journal entry
      await repos.journal.remove(entry.id);

      const actions = await repos.actions.list();
      const questions = await repos.questions.list();

      // Action survives with relatedId still set.
      // Important: In next_actions table, related_id is a plain TEXT column without foreign key
      // enforcement. When the parent journal entry is deleted, related_id survives as a
      // dangling reference (a stored identifier pointing to a non-existent record).
      const survivedAction = actions.find((a) => a.id === action.id);
      expect(survivedAction).toBeDefined();
      expect(survivedAction?.relatedType).toBe("journal");
      expect(survivedAction?.relatedId).toBe(entry.id);

      // Question survives, but SQLite schema enforces REFERENCES journal_entries(id) ON DELETE SET NULL,
      // so journal_id is set to NULL automatically by SQLite.
      const survivedQuestion = questions.find((q) => q.id === question.id);
      expect(survivedQuestion).toBeDefined();
      expect(survivedQuestion?.journalId).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("D1: debrief interactions with dashboard, actions, and preparation", () => {
  it("traces how debrief actions and questions interact with actions.ts, preparation.ts, and dashboard.ts", () => {
    const journalEntry: JournalEntry = {
      id: "j-100",
      eventId: "e-past",
      date: "2026-09-03",
      title: "Steep Turns Debrief",
      aircraftType: "C172S",
      aircraftId: "N12345",
      departureAirport: "KPAE",
      arrivalAirport: "KPAE",
      instructorName: "Captain Morgan",
      totalTime: 1.2,
      dualReceived: 1.2,
      soloTime: null,
      picTime: null,
      crossCountryTime: null,
      nightTime: null,
      actualInstrumentTime: null,
      simulatedInstrumentTime: null,
      dayLandings: 3,
      nightLandings: null,
      mission: "Steep turns",
      practiced: "45 degree bank turns",
      wentWell: "Altitude held within 50 ft",
      wasDifficult: "Looking outside rather than staring at instruments",
      instructorFeedback: "Keep your scan moving outside",
      questionsForNextTime: "How to maintain pitch when rolling in fast?",
      confidence: 3,
      goalId: null,
      createdAt: "2026-09-03T18:00:00.000Z",
      updatedAt: "2026-09-03T18:00:00.000Z",
      materialIds: [],
    };

    const debriefAction: NextAction = {
      id: "a-100",
      title: "Chair-fly outside scan during 45-degree rolls",
      description: "",
      category: "prepare",
      priority: "next_up",
      status: "open",
      dueDate: null, // default for debrief actions
      estimatedMinutes: null,
      relatedType: "journal",
      relatedId: journalEntry.id,
      createdAt: "2026-09-03T18:05:00.000Z",
      updatedAt: "2026-09-03T18:05:00.000Z",
      completedAt: null,
    };

    const debriefQuestion: Question = {
      id: "q-100",
      text: "How to maintain pitch when rolling in fast?",
      topic: "general",
      eventId: null, // Debrief questions leave eventId null
      materialId: null,
      journalId: journalEntry.id,
      status: "to_ask",
      answer: "",
      createdAt: "2026-09-03T18:05:00.000Z",
      updatedAt: "2026-09-03T18:05:00.000Z",
      answeredAt: null,
    };

    const upcomingLesson: ScheduleEvent = makeEvent({
      id: "e-next",
      title: "Commercial Maneuvers",
      eventType: "flight_lesson",
      date: "2026-09-10",
      status: "scheduled",
    });

    // 1. actions.ts tracing
    // actionsFor correctly connects action to journal
    expect(actionsFor([debriefAction], "journal", journalEntry.id)).toEqual([debriefAction]);
    // Undated debrief action appears on Today's Plan
    expect(planActions([debriefAction], TODAY)).toEqual([debriefAction]);
    // Undated action is not overdue
    expect(isOverdue(debriefAction, TODAY)).toBe(false);

    // 2. preparation.ts tracing
    // MISSING LINK: lessonPreparation only includes questions where q.eventId === event.id.
    // Because debriefQuestion.eventId is null, it is NOT included in nextFlight preparation lines!
    const prep = lessonPreparation(upcomingLesson, {
      prepItems: [],
      questions: [debriefQuestion],
    });
    expect(prep.lines).toHaveLength(0); // Characterizes current behavior

    // If the question had its eventId explicitly pointed to the upcoming lesson:
    const linkedQuestion = { ...debriefQuestion, eventId: upcomingLesson.id };
    const prepWithLinked = lessonPreparation(upcomingLesson, {
      prepItems: [],
      questions: [linkedQuestion],
    });
    expect(prepWithLinked.lines).toHaveLength(1);
    expect(prepWithLinked.lines[0]!.label).toContain("How to maintain pitch");

    // 3. dashboard.ts tracing
    const sources: DashboardSources = {
      profile: makeProfile(),
      actions: [debriefAction],
      events: [upcomingLesson],
      prepItems: [],
      materials: [],
      milestones: [],
      goals: [],
      checklistItems: [],
      journalEntries: [journalEntry],
      questions: [debriefQuestion],
      transactions: [],
      today: TODAY,
    };

    const dashboard = buildDashboard(sources);

    // Action appears under planGroups ("prepare" category)
    expect(dashboard.planGroups).toHaveLength(1);
    expect(dashboard.planGroups[0]!.category).toBe("prepare");
    expect(dashboard.planGroups[0]!.actions[0]!.id).toBe(debriefAction.id);

    // Debrief question appears in unansweredBeforeLesson because (q.eventId === upcoming.id || q.eventId === null)
    expect(dashboard.unansweredBeforeLesson).toHaveLength(1);
    expect(dashboard.unansweredBeforeLesson[0]!.id).toBe(debriefQuestion.id);

    // MISSING LINK: dashboard.ts does NOT link debrief actions to nextFlight or currentMilestone or studyFocus
    // relatedAction only looks up "goal" and "material", never "journal".
  });
});
