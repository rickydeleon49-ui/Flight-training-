import type { PracticeAuthoringQuestion, PracticeRetirementRecord, PracticeSaveOperation, PracticeSnapshot } from "@/domain/types";
import { appendPracticeRetirements, practiceRetirementRecord } from "./practiceAuthoring";

export interface PracticeDraftQuestion {
  identity: string | null;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  sourcePage: number | null;
  instructor: boolean;
}

export function draftFromSnapshot(snapshot: PracticeSnapshot): PracticeDraftQuestion[] {
  return snapshot.questions.map(({ identity, question, options, correctIndex, explanation, sourcePage, origin }) => ({
    identity, question, options: [...options], correctIndex, explanation, sourcePage, instructor: origin === "instructor",
  }));
}

export async function buildPracticeEditOperation(args: {
  operationId: string;
  materialId: string;
  expected: PracticeSnapshot | null;
  title: string;
  draft: PracticeDraftQuestion[];
}): Promise<PracticeSaveOperation> {
  const { expected, draft } = args;
  const records: PracticeRetirementRecord[] = [];
  let correction = false;
  const questions: PracticeAuthoringQuestion[] = [];
  for (const item of draft) {
    const before = expected?.questions.find((question) => question.identity === item.identity);
    const fields = {
      question: item.question, options: [...item.options], correctIndex: item.correctIndex,
      explanation: item.explanation, sourcePage: item.sourcePage,
    };
    const sameFields = before && before.question === item.question &&
      JSON.stringify(before.options) === JSON.stringify(item.options) && before.correctIndex === item.correctIndex &&
      before.explanation === item.explanation && before.sourcePage === item.sourcePage;
    if (before && sameFields && (before.origin === "instructor") === item.instructor) {
      questions.push({ ...before, options: [...before.options] });
      continue;
    }
    const origin = item.instructor || before?.origin === "instructor" ? "instructor" : "user";
    if (origin === "instructor") correction = true;
    questions.push({ ...before, ...fields, identity: before?.identity ?? crypto.randomUUID(), origin });
    // validateProtection requires exact records for rewritten generated items too.
    if (before && (before.origin !== undefined || !sameFields)) {
      records.push(await practiceRetirementRecord(before, "corrected"));
    }
  }
  for (const before of expected?.questions ?? []) {
    if (!questions.some((question) => question.identity === before.identity)) {
      records.push(await practiceRetirementRecord(before, "deleted"));
    }
  }
  return {
    operationId: args.operationId, sourceMaterialId: args.materialId,
    reason: expected ? correction ? "correct" : "edit" : "create", expected,
    next: {
      title: args.title, provider: expected?.provider ?? "manual", model: expected?.model ?? "",
      questions, retired: appendPracticeRetirements(expected?.retired ?? [], records),
    },
  };
}
