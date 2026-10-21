/**
 * Repository set. Everything the application persists goes through here.
 *
 * Screens receive these through the app data context, so no component ever
 * imports a database driver directly.
 */
import type { SqlDatabase } from "../db";
import { homeworkRepository } from "./homeworkRepository";
import { actionRepository } from "./actionRepository";
import { appRepository } from "./appRepository";
import { documentRepository } from "./documentRepository";
import { financeRepository } from "./financeRepository";
import { goalRepository, milestoneRepository } from "./flightPathRepository";
import { journalRepository } from "./journalRepository";
import { noteRepository } from "./noteRepository";
import { profileRepository } from "./profileRepository";
import { questionRepository } from "./questionRepository";
import { scheduleRepository } from "./scheduleRepository";
import { toolkitRepository } from "./toolkitRepository";
import { practiceSessionRepository } from "./practiceSessionRepository";
import { cardReviewRepository } from "./cardReviewRepository";
import { cardLibraryRepository } from "./cardLibraryRepository";
import { skillEvidenceRepository } from "./skillEvidenceRepository";
import { navigationRepository } from "./navigationRepository";

export interface Repositories {
  homework: ReturnType<typeof homeworkRepository>;
  app: ReturnType<typeof appRepository>;
  profile: ReturnType<typeof profileRepository>;
  milestones: ReturnType<typeof milestoneRepository>;
  goals: ReturnType<typeof goalRepository>;
  actions: ReturnType<typeof actionRepository>;
  documents: ReturnType<typeof documentRepository>;
  schedule: ReturnType<typeof scheduleRepository>;
  journal: ReturnType<typeof journalRepository>;
  questions: ReturnType<typeof questionRepository>;
  notes: ReturnType<typeof noteRepository>;
  finance: ReturnType<typeof financeRepository>;
  toolkit: ReturnType<typeof toolkitRepository>;
  practiceSessions: ReturnType<typeof practiceSessionRepository>;
  cardReviews: ReturnType<typeof cardReviewRepository>;
  cardLibrary: ReturnType<typeof cardLibraryRepository>;
  skillEvidence: ReturnType<typeof skillEvidenceRepository>;
  navigation: ReturnType<typeof navigationRepository>;
}

export function createRepositories(db: SqlDatabase): Repositories {
  return {
    homework: homeworkRepository(db),
    app: appRepository(db),
    profile: profileRepository(db),
    milestones: milestoneRepository(db),
    goals: goalRepository(db),
    actions: actionRepository(db),
    documents: documentRepository(db),
    schedule: scheduleRepository(db),
    journal: journalRepository(db),
    questions: questionRepository(db),
    notes: noteRepository(db),
    finance: financeRepository(db),
    toolkit: toolkitRepository(db),
    practiceSessions: practiceSessionRepository(db),
    cardReviews: cardReviewRepository(db),
    cardLibrary: cardLibraryRepository(db),
    skillEvidence: skillEvidenceRepository(db),
    navigation: navigationRepository(db),
  };
}

export { practiceSessionRepository } from "./practiceSessionRepository";
export { cardReviewRepository } from "./cardReviewRepository";
export { cardLibraryRepository } from "./cardLibraryRepository";
export { DuplicateLessonCostError } from "./financeRepository";
