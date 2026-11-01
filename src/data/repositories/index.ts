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
import { flightSchoolRepository } from "./flightSchoolRepository";
import { oralScenarioRepository } from "./oralScenarioRepository";

import { materialVideoLinkRepository } from "./materialVideoLinkRepository";
import { studentPilotStepRepository } from "./studentPilotStepRepository";
import { faaDownloadRepository } from "./faaDownloadRepository";

export interface Repositories {
  materialVideoLinks: ReturnType<typeof materialVideoLinkRepository>;
  studentPilotSteps: ReturnType<typeof studentPilotStepRepository>;
  faaDownloads: ReturnType<typeof faaDownloadRepository>;
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
  flightSchools: ReturnType<typeof flightSchoolRepository>;
  oralScenarios: ReturnType<typeof oralScenarioRepository>;
}

export function createRepositories(db: SqlDatabase): Repositories {
  const documents = documentRepository(db);
  return {
    faaDownloads: faaDownloadRepository(db, documents),
    materialVideoLinks: materialVideoLinkRepository(db),
    studentPilotSteps: studentPilotStepRepository(db),
    homework: homeworkRepository(db),
    app: appRepository(db),
    profile: profileRepository(db),
    milestones: milestoneRepository(db),
    goals: goalRepository(db),
    actions: actionRepository(db),
    documents,
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
    flightSchools: flightSchoolRepository(db),
    oralScenarios: oralScenarioRepository(db),
  };
}

export { practiceSessionRepository } from "./practiceSessionRepository";
export { cardReviewRepository } from "./cardReviewRepository";
export { cardLibraryRepository } from "./cardLibraryRepository";
export { DuplicateLessonCostError } from "./financeRepository";
export { flightSchoolRepository } from "./flightSchoolRepository";
