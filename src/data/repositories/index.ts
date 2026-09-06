/**
 * Repository set. Everything the application persists goes through here.
 *
 * Screens receive these through the app data context, so no component ever
 * imports a database driver directly.
 */
import type { SqlDatabase } from "../db";
import { actionRepository } from "./actionRepository";
import { appRepository } from "./appRepository";
import { documentRepository } from "./documentRepository";
import { financeRepository } from "./financeRepository";
import { goalRepository, milestoneRepository } from "./flightPathRepository";
import { journalRepository } from "./journalRepository";
import { profileRepository } from "./profileRepository";
import { questionRepository } from "./questionRepository";
import { scheduleRepository } from "./scheduleRepository";
import { toolkitRepository } from "./toolkitRepository";

export interface Repositories {
  app: ReturnType<typeof appRepository>;
  profile: ReturnType<typeof profileRepository>;
  milestones: ReturnType<typeof milestoneRepository>;
  goals: ReturnType<typeof goalRepository>;
  actions: ReturnType<typeof actionRepository>;
  documents: ReturnType<typeof documentRepository>;
  schedule: ReturnType<typeof scheduleRepository>;
  journal: ReturnType<typeof journalRepository>;
  questions: ReturnType<typeof questionRepository>;
  finance: ReturnType<typeof financeRepository>;
  toolkit: ReturnType<typeof toolkitRepository>;
}

export function createRepositories(db: SqlDatabase): Repositories {
  return {
    app: appRepository(db),
    profile: profileRepository(db),
    milestones: milestoneRepository(db),
    goals: goalRepository(db),
    actions: actionRepository(db),
    documents: documentRepository(db),
    schedule: scheduleRepository(db),
    journal: journalRepository(db),
    questions: questionRepository(db),
    finance: financeRepository(db),
    toolkit: toolkitRepository(db),
  };
}

export { DuplicateLessonCostError } from "./financeRepository";
