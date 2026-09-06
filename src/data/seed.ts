/**
 * Clearly fictional demo data.
 *
 * This exists so the interface can be evaluated with realistic content
 * during development. It is never loaded automatically and nothing in the
 * application is built around these particular records. Every name here is
 * invented; no real training material is included.
 *
 * Dates are derived from today so the demo always looks current.
 */
import { addDays, todayIso } from "@/lib/dates";
import type { Repositories } from "./repositories";

/** The next occurrence of a weekday (0 = Sunday), at least one day out. */
function nextWeekday(weekday: number, from: string = todayIso()): string {
  const start = new Date(`${from}T00:00:00`);
  const delta = (weekday - start.getDay() + 7) % 7 || 7;
  return addDays(from, delta);
}

export async function loadDemoData(repositories: Repositories): Promise<void> {
  const today = todayIso();
  const saturday = nextWeekday(6);

  /* ----------------------------- Flight Path ---------------------------- */

  const milestoneTitles: Array<[string, "completed" | "in_progress" | "not_started", string]> = [
    ["Explore Flight Training", "completed", "Discovery flight and choosing a school."],
    ["Begin Ground School", "completed", "Working through the written material."],
    ["Start Flight Lessons", "completed", "Regular lessons with an instructor."],
    ["Build Landing Confidence", "in_progress", "Normal, crosswind and short-field landings."],
    ["Prepare for Written Exam", "not_started", "Practice questions and weak-topic review."],
    ["Prepare for Practical Test", "not_started", "Checkride preparation."],
  ];

  // Target dates on the last two stages, so the dashboard has dates to count
  // down to without inventing any.
  const milestoneTargets: Record<string, string> = {
    "Prepare for Written Exam": addDays(today, 68),
    "Prepare for Practical Test": addDays(today, 152),
  };

  const milestones = [];
  for (const [index, [title, status, description]] of milestoneTitles.entries()) {
    milestones.push(
      await repositories.milestones.create({
        title,
        status,
        description,
        position: index,
        targetDate: milestoneTargets[title] ?? null,
      }),
    );
  }
  const landingMilestone = milestones[3];
  if (!landingMilestone) throw new Error("Demo data could not be prepared.");

  await repositories.profile.update({
    pilotName: "Ava",
    certificateGoal: "Private Pilot",
    currentFocus: "Landings",
    currentMilestoneId: landingMilestone.id,
    flightSchool: "Cedar Field Aviation",
    instructorName: "Dana Whitfield",
    homeAirport: "Cedar Field",
    aircraftType: "Cessna 172",
    trainingStartedOn: addDays(today, -158),
    medicalExpiry: addDays(today, 47),
    whyNote:
      "My grandfather flew, and I grew up hearing about it. I want to see the coast " +
      "from the air the way he described it — and to know I got myself there.",
  });

  const crosswindGoal = await repositories.goals.create({
    milestoneId: landingMilestone.id,
    title: "Crosswind landings",
    description: "Stay comfortable landing in a steady crosswind.",
    status: "working_on",
    priority: "next_up",
    confidence: 3,
    notes: "Rudder timing is the part that still feels rushed.",
  });

  const flareGoal = await repositories.goals.create({
    milestoneId: landingMilestone.id,
    title: "Flare timing",
    status: "working_on",
    priority: "important",
    confidence: 2,
  });

  await repositories.goals.create({
    milestoneId: landingMilestone.id,
    title: "Normal approaches",
    status: "comfortable",
    confidence: 4,
  });

  await repositories.goals.create({
    milestoneId: landingMilestone.id,
    title: "Traffic pattern procedures",
    status: "completed",
    confidence: 4,
  });

  for (const [index, title] of [
    "Fly a stabilised approach in gusty wind",
    "Hold centreline through the flare",
    "Go around without hesitating",
  ].entries()) {
    await repositories.goals.addChecklistItem(crosswindGoal.id, title, index);
  }

  /* --------------------------- Study Library ---------------------------- */

  const crosswindNotes = await repositories.documents.create({
    title: "Crosswind Landing Notes",
    materialType: "lesson_notes",
    topic: "landings",
    reviewStatus: "studying",
    priority: "next_up",
    goalId: crosswindGoal.id,
    notes: "Sections 3–5 cover the sideslip method.",
    tags: ["landings", "technique"],
  });

  const weatherGuide = await repositories.documents.create({
    title: "Weather Patterns Study Guide",
    materialType: "study_guide",
    topic: "weather",
    reviewStatus: "studying",
    priority: "important",
    tags: ["written exam"],
  });

  const windWorksheet = await repositories.documents.create({
    title: "Wind Components Worksheet",
    materialType: "worksheet",
    topic: "performance",
    reviewStatus: "needs_review",
    priority: "important",
    goalId: crosswindGoal.id,
    tags: ["landings"],
  });

  await repositories.documents.create({
    title: "Airport Signs and Markings",
    materialType: "reference",
    topic: "airports",
    reviewStatus: "reference_only",
    priority: "later",
  });

  /* ------------------------------ Schedule ------------------------------ */

  const earlierLesson = await repositories.schedule.create({
    title: "Approaches and Go-Arounds",
    eventType: "flight_lesson",
    date: addDays(today, -19),
    startTime: "09:00",
    endTime: "10:30",
    location: "Cedar Field",
    instructor: "Dana Whitfield",
    goalId: flareGoal.id,
    estimatedCost: 275_00,
    actualCost: 275_00,
    status: "completed",
  });

  const lastLesson = await repositories.schedule.create({
    title: "Traffic Pattern Practice",
    eventType: "flight_lesson",
    date: addDays(today, -5),
    startTime: "09:00",
    endTime: "10:30",
    location: "Cedar Field",
    instructor: "Dana Whitfield",
    goalId: flareGoal.id,
    estimatedCost: 275_00,
    actualCost: 265_00,
    status: "completed",
  });

  const nextLesson = await repositories.schedule.create({
    title: "Crosswind Landings",
    eventType: "flight_lesson",
    date: saturday,
    startTime: "10:30",
    endTime: "12:00",
    location: "Cedar Field",
    instructor: "Dana Whitfield",
    goalId: crosswindGoal.id,
    estimatedCost: 275_00,
    notes: "Winds forecast 12 knots, mostly across the runway.",
    materialIds: [crosswindNotes.id, windWorksheet.id],
  });

  for (const [index, [title, done]] of (
    [
      ["Weather review", true],
      ["Review landing notes", false],
      ["Write one instructor question", false],
      ["Equipment check", true],
    ] as Array<[string, boolean]>
  ).entries()) {
    const item = await repositories.schedule.addPrepItem(nextLesson.id, title, index);
    if (done) await repositories.schedule.setPrepItemDone(item.id, true);
  }

  await repositories.schedule.create({
    title: "Ground School — Weather",
    eventType: "ground_school",
    date: addDays(today, 3),
    startTime: "18:00",
    endTime: "20:00",
    location: "Cedar Field classroom",
    estimatedCost: 150_00,
  });

  await repositories.schedule.create({
    title: "Medical Exam",
    eventType: "medical",
    date: addDays(today, 24),
    startTime: "14:00",
    estimatedCost: 175_00,
  });

  /* --------------------------- Next Actions ----------------------------- */

  await repositories.actions.create({
    title: "Complete weather study session",
    description: "Fronts and pressure systems.",
    category: "non_negotiable",
    priority: "next_up",
    dueDate: today,
    estimatedMinutes: 30,
    relatedType: "material",
    relatedId: weatherGuide.id,
  });

  await repositories.actions.create({
    title: "Review crosswind landing notes",
    description: "Pages 4–8 before Saturday.",
    category: "prepare",
    priority: "next_up",
    dueDate: addDays(saturday, -1),
    estimatedMinutes: 25,
    relatedType: "event",
    relatedId: nextLesson.id,
  });

  await repositories.actions.create({
    title: "Confirm this week's lesson time",
    category: "life_admin",
    priority: "important",
    dueDate: today,
    estimatedMinutes: 5,
    relatedType: "event",
    relatedId: nextLesson.id,
  });

  await repositories.actions.create({
    title: "Add one question for your instructor",
    category: "stretch",
    priority: "later",
    estimatedMinutes: 10,
  });

  // One overdue item, so the Needs Attention treatment is visible.
  await repositories.actions.create({
    title: "Finish the wind components worksheet",
    category: "prepare",
    priority: "important",
    dueDate: addDays(today, -2),
    estimatedMinutes: 20,
    relatedType: "material",
    relatedId: windWorksheet.id,
  });

  const doneAction = await repositories.actions.create({
    title: "Read the weather chapter summary",
    category: "prepare",
    priority: "important",
    dueDate: addDays(today, -1),
  });
  await repositories.actions.update(doneAction.id, {
    status: "completed",
    completedAt: new Date().toISOString(),
  });

  /* ---------------------------- Flight Journal -------------------------- */

  const entry = await repositories.journal.create({
    eventId: lastLesson.id,
    date: lastLesson.date,
    title: "Traffic Pattern Practice",
    mission: "Fly consistent traffic patterns and work on the flare.",
    practiced: "Six circuits, two with a light crosswind.",
    wentWell: "Pattern spacing was steady and radio calls felt natural.",
    wasDifficult: "Flaring slightly high on three of the landings.",
    instructorFeedback: "Look further down the runway in the flare rather than just ahead.",
    questionsForNextTime: "How much rudder is normal in a 12-knot crosswind?",
    confidence: 3,
    goalId: flareGoal.id,
    materialIds: [crosswindNotes.id],
  });

  // An earlier debrief, so the feedback view shows a note recurring rather
  // than a single remark.
  await repositories.journal.create({
    eventId: earlierLesson.id,
    date: earlierLesson.date,
    title: "Approaches and Go-Arounds",
    mission: "Fly stable approaches and practise going around.",
    practiced: "Four approaches, two go-arounds from low altitude.",
    wentWell: "Go-around decisions were quick and the callouts were clear.",
    wasDifficult: "Holding the centreline once the nose came up.",
    instructorFeedback: "Keep your eyes at the far end of the runway, not over the nose.",
    questionsForNextTime: "How early should I commit to a go-around?",
    confidence: 2,
    goalId: flareGoal.id,
  });

  /* ------------------------------ Questions ----------------------------- */

  await repositories.questions.create({
    text: "How much rudder is normal in a 12-knot crosswind?",
    topic: "landings",
    eventId: nextLesson.id,
    journalId: entry.id,
    status: "to_ask",
  });

  await repositories.questions.create({
    text: "When should I choose a forward slip over a crab approach?",
    topic: "landings",
    materialId: crosswindNotes.id,
    status: "to_ask",
  });

  await repositories.questions.create({
    text: "What cloud clearance applies in Class E below 10,000 feet?",
    topic: "regulations",
    status: "answered",
    answer: "Confirmed with the instructor: 500 below, 1,000 above, 2,000 horizontal.",
  });

  /* ------------------------------ Finances ------------------------------ */

  const contributions: Array<[string, number, string]> = [
    [addDays(today, -120), 2_500_00, "Opening the training fund"],
    [addDays(today, -75), 1_800_00, "Saved paycheck money"],
    [addDays(today, -40), 1_200_00, "Birthday gift toward training"],
    [addDays(today, -12), 770_00, "Saved paycheck money"],
  ];
  for (const [date, amount, description] of contributions) {
    await repositories.finance.create({ type: "contribution", amount, date, description });
  }

  const expenses: Array<[string, number, string, Parameters<typeof repositories.finance.create>[0]["category"]]> = [
    [addDays(today, -110), 1_200_00, "Ground school course", "ground_school"],
    [addDays(today, -95), 620_00, "Headset", "headset"],
    [addDays(today, -88), 142_00, "Books and charts", "books"],
    [addDays(today, -60), 280_00, "Flight lesson", "flight_lesson"],
    [addDays(today, -33), 280_00, "Flight lesson", "flight_lesson"],
    [addDays(today, -19), 275_00, "Flight lesson", "flight_lesson"],
    [addDays(today, -8), 42_00, "Study materials", "study_materials"],
    [addDays(today, -6), 316_00, "Flight lesson", "flight_lesson"],
  ];
  for (const [date, amount, description, category] of expenses) {
    await repositories.finance.create({ type: "expense", amount, date, description, category });
  }

  // The completed lesson's cost, recorded through the lesson flow.
  await repositories.finance.recordLessonCost({
    eventId: lastLesson.id,
    amount: 265_00,
    date: lastLesson.date,
    description: lastLesson.title,
  });

  await repositories.finance.saveFundGoal({ title: "Next phase of training", target: 5_000_00 });
}

/** Remove everything. Used by the demo controls in Settings. */
export async function clearAllData(repositories: Repositories): Promise<void> {
  const [actions, questions, journal, materials, events, goals, milestones, transactions, fundGoals] =
    await Promise.all([
      repositories.actions.list(),
      repositories.questions.list(),
      repositories.journal.list(),
      repositories.documents.list(),
      repositories.schedule.list(),
      repositories.goals.list(),
      repositories.milestones.list(),
      repositories.finance.list(),
      repositories.finance.listFundGoals(),
    ]);

  // Ordered so foreign keys never block a delete.
  for (const item of actions) await repositories.actions.remove(item.id);
  for (const item of questions) await repositories.questions.remove(item.id);
  for (const item of journal) await repositories.journal.remove(item.id);
  for (const item of transactions) await repositories.finance.remove(item.id);
  for (const item of fundGoals) await repositories.finance.removeFundGoal(item.id);
  for (const item of materials) await repositories.documents.remove(item.id);
  for (const item of events) await repositories.schedule.remove(item.id);
  for (const item of goals) await repositories.goals.remove(item.id);
  for (const item of milestones) await repositories.milestones.remove(item.id);
  await repositories.toolkit.clear();

  await repositories.profile.update({
    pilotName: "",
    currentFocus: "",
    currentMilestoneId: null,
  });
}
