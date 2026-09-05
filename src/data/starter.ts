/**
 * The useful, non-personal content that ships with Her Flight Deck.
 *
 * It is installed once on a fresh database. Records become ordinary editable
 * data after that: deleting one does not make it reappear on the next launch.
 * Settings offers an explicit restore action for anything she wants back.
 */
import type { MaterialType, Priority, ReviewStatus, Topic } from "@/domain/types";
import type { Repositories } from "./repositories";

const STARTER_STATE_KEY = "airline_starter_pack";
const STARTER_VERSION = "1";
const STARTER_TAG = "Airline Starter Pack";

interface StarterMilestone {
  title: string;
  description: string;
  goal: {
    title: string;
    description: string;
    priority: Priority;
    checklist: string[];
  };
}

const MILESTONES: StarterMilestone[] = [
  {
    title: "Build Your Training Foundation",
    description: "Choose a training route, protect your long-term options, and make a sustainable plan.",
    goal: {
      title: "Create an airline-career training plan",
      description: "Turn the long journey into a route that fits your school, budget, schedule, and life.",
      priority: "next_up",
      checklist: [
        "Compare flight schools and Part 61 / Part 141 training routes",
        "Discuss long-term medical certification with an Aviation Medical Examiner",
        "Choose a realistic lesson schedule and training budget",
        "Review the plan with a flight instructor or trusted aviation mentor",
      ],
    },
  },
  {
    title: "Private Pilot Certificate",
    description: "Build the knowledge, judgment, and flying foundation for every stage that follows.",
    goal: {
      title: "Earn the Private Pilot Certificate",
      description: "Train to proficiency and meet the current knowledge, experience, endorsement, and practical-test requirements.",
      priority: "important",
      checklist: [
        "Create a ground-school study plan",
        "Track instructor endorsements and required experience",
        "Use the current Private Pilot Airman Certification Standards",
        "Complete instructor-recommended checkride preparation",
      ],
    },
  },
  {
    title: "Instrument Rating",
    description: "Develop instrument procedures, weather judgment, and precise aircraft control.",
    goal: {
      title: "Add the Instrument-Airplane Rating",
      description: "Follow the current FAA requirements and an instructor-approved training plan.",
      priority: "important",
      checklist: [
        "Plan instrument ground study",
        "Track instrument training and experience",
        "Use the current Instrument Rating Airman Certification Standards",
        "Complete instructor-recommended checkride preparation",
      ],
    },
  },
  {
    title: "Commercial Pilot Certificate",
    description: "Raise knowledge, judgment, and aircraft control to commercial-pilot standards.",
    goal: {
      title: "Earn the Commercial Pilot Certificate",
      description: "Build the required experience and prepare with the current Commercial Pilot ACS.",
      priority: "important",
      checklist: [
        "Review the current commercial eligibility and experience requirements",
        "Create an efficient experience-building plan with an instructor",
        "Track commercial maneuvers and areas of operation",
        "Complete instructor-recommended checkride preparation",
      ],
    },
  },
  {
    title: "Multi-Engine Training",
    description: "Add multiengine knowledge and privileges appropriate to the planned career route.",
    goal: {
      title: "Complete the planned Multi-Engine training",
      description: "Choose timing and course structure with a qualified instructor and career mentor.",
      priority: "important",
      checklist: [
        "Choose when multiengine training fits the overall plan",
        "Review aircraft systems and performance with an instructor",
        "Track multiengine experience carefully",
        "Complete the applicable practical-test preparation",
      ],
    },
  },
  {
    title: "Choose a Time-Building Path",
    description: "Flight instructing is common, but it is not the only route; choose deliberately.",
    goal: {
      title: "Select and prepare for a professional flying path",
      description: "Compare instructor certificates and other lawful experience-building opportunities.",
      priority: "important",
      checklist: [
        "Compare CFI, CFII, and MEI training with other experience-building routes",
        "Talk with pilots currently doing the work",
        "Estimate training cost, pay, schedule, and experience quality",
        "Choose the next certificate, rating, or job target",
      ],
    },
  },
  {
    title: "Build Airline-Qualifying Experience",
    description: "Build quality experience while keeping accurate records and strong professional habits.",
    goal: {
      title: "Track progress toward ATP eligibility",
      description: "Use current regulations and trusted mentors to verify which experience applies to the intended ATP route.",
      priority: "important",
      checklist: [
        "Keep a complete and accurate pilot logbook",
        "Review ATP eligibility progress at regular intervals",
        "Maintain medical, certificate, and endorsement records",
        "Keep a clean record of employment, training, and checkride history",
      ],
    },
  },
  {
    title: "ATP-CTP and ATP Certificate",
    description: "Prepare for the certification stage used for airline transport operations.",
    goal: {
      title: "Complete the applicable ATP pathway",
      description: "Confirm eligibility, ATP-CTP applicability, testing, and practical-test steps from current FAA sources.",
      priority: "important",
      checklist: [
        "Confirm standard or restricted-privileges ATP eligibility",
        "Verify current ATP-CTP and knowledge-test requirements",
        "Organize logbooks and qualification records for review",
        "Complete the applicable ATP or airline training event",
      ],
    },
  },
  {
    title: "Airline Applications and Type Rating",
    description: "Prepare a professional application, interview record, and airline-training mindset.",
    goal: {
      title: "Become ready for an airline hiring process",
      description: "Research each employer's current qualifications; airline hiring minimums are not all the same.",
      priority: "later",
      checklist: [
        "Build a master résumé and complete application history",
        "Audit logbooks, certificates, medical records, and training records",
        "Prepare technical, human-resources, and scenario interview practice",
        "Research each airline's current published qualifications",
      ],
    },
  },
];

interface StarterMaterial {
  title: string;
  materialType: MaterialType;
  topic: Topic;
  reviewStatus: ReviewStatus;
  priority: Priority;
  notes: string;
  tags: string[];
}

const MATERIALS: StarterMaterial[] = [
  {
    title: "Airline Pilot Pathway Overview",
    materialType: "study_guide",
    topic: "general",
    reviewStatus: "reference_only",
    priority: "next_up",
    notes:
      "A common U.S. pathway is: training foundation → Private Pilot → Instrument Rating → Commercial Pilot → multiengine training → a lawful time-building route → ATP eligibility and ATP-CTP when applicable → airline selection and type-specific training. This is a planning map, not a promise that every pilot follows the same route. Review it with instructors and mentors, and verify current FAA and employer requirements before making decisions.",
    tags: [STARTER_TAG, "career roadmap"],
  },
  {
    title: "Official FAA Certification Resources",
    materialType: "reference",
    topic: "regulations",
    reviewStatus: "reference_only",
    priority: "next_up",
    notes:
      "Use official sources for requirements and current editions:\n\nBecome a Pilot — https://www.faa.gov/pilots/become\nAirman Certification Standards — https://www.faa.gov/training_testing/testing/acs\nATP training and certification resources — https://www.faa.gov/pilots/training/atp\nCurrent 14 CFR Part 61 — https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61\nFAA handbooks and manuals — https://www.faa.gov/regulations_policies/handbooks_manuals/aviation\n\nRequirements and publications change. Her instructor, examiner, school, FAA sources, and aircraft documents take priority over this app.",
    tags: [STARTER_TAG, "FAA", "official sources"],
  },
  {
    title: "Before Each Lesson",
    materialType: "checklist",
    topic: "general",
    reviewStatus: "reference_only",
    priority: "important",
    notes:
      "Personal preparation prompt:\n• Confirm the lesson time, location, instructor, and school instructions.\n• Review the assigned material and write down questions.\n• Bring the documents and equipment your instructor requires.\n• Check sleep, food, hydration, medication, stress, and readiness honestly.\n• Review weather and aircraft information only within your current training and instructor guidance.\n• Know the lesson objective and what success should look like.\n\nThis does not replace an instructor, school checklist, preflight inspection, POH/AFM, or regulation.",
    tags: [STARTER_TAG, "lesson prep"],
  },
  {
    title: "After Each Flight — Debrief Prompts",
    materialType: "worksheet",
    topic: "general",
    reviewStatus: "reference_only",
    priority: "important",
    notes:
      "Capture the lesson while it is fresh:\n• What was today's mission?\n• What did we practice?\n• What went well, and why?\n• What was difficult, and when did it begin?\n• What exact feedback did the instructor give?\n• What should I review before the next lesson?\n• What question should I ask next time?\n• What is the single best next action?\n\nUse the Flight Journal for the personal answers.",
    tags: [STARTER_TAG, "debrief"],
  },
  {
    title: "Training Records Organizer",
    materialType: "admin_document",
    topic: "general",
    reviewStatus: "reference_only",
    priority: "important",
    notes:
      "Keep authoritative originals in their proper place and maintain secure copies where appropriate:\n• Pilot and medical certificates\n• Government identification and eligibility documents\n• Logbooks and digital-logbook exports\n• Instructor endorsements\n• Knowledge-test and practical-test records\n• School graduation or course records\n• Employment and training history\n• Résumé and application history\n\nThis app is an organizer, not an FAA-compliant substitute for required certificates, records, endorsements, or logbooks.",
    tags: [STARTER_TAG, "records"],
  },
  {
    title: "Questions for a Flight School",
    materialType: "worksheet",
    topic: "general",
    reviewStatus: "needs_review",
    priority: "next_up",
    notes:
      "Useful interview prompts:\n• Who will be the primary instructor, and how consistent is scheduling?\n• What is included in the quoted price, and what commonly costs extra?\n• How are weather cancellations, maintenance, and instructor changes handled?\n• What aircraft availability and maintenance history should a student understand?\n• How does the school track syllabus progress and stage checks?\n• Which training route fits an airline-career goal, and why?\n• Can current students and recent graduates describe their experience?\n\nRecord answers and compare schools on the same criteria.",
    tags: [STARTER_TAG, "school selection"],
  },
  {
    title: "Career Mentor Check-In",
    materialType: "worksheet",
    topic: "general",
    reviewStatus: "reference_only",
    priority: "later",
    notes:
      "Revisit every few months:\n• Is the current training pace sustainable?\n• Which next certificate, rating, or job best supports the long-term goal?\n• Are there gaps in knowledge, judgment, professionalism, or recordkeeping?\n• Is the medical and financial plan still realistic?\n• What hiring assumptions need to be checked against current employer information?\n• Which decisions are reversible, and which deserve a second opinion?",
    tags: [STARTER_TAG, "career planning"],
  },
];

async function hasTrainingData(repositories: Repositories): Promise<boolean> {
  const groups = await Promise.all([
    repositories.milestones.list(),
    repositories.goals.list(),
    repositories.actions.list(),
    repositories.documents.list(),
    repositories.schedule.list(),
    repositories.journal.list(),
    repositories.questions.list(),
    repositories.finance.list(),
    repositories.finance.listFundGoals(),
  ]);
  return groups.some((items) => items.length > 0);
}

/** Add every missing starter record without overwriting records she changed. */
export async function restoreAirlineStarterPack(
  repositories: Repositories,
  personalizeEmptyProfile = false,
): Promise<{ milestones: number; goals: number; checklistItems: number; materials: number }> {
  let milestoneCount = 0;
  let goalCount = 0;
  let checklistCount = 0;
  let materialCount = 0;

  const milestones = await repositories.milestones.list();
  const goals = await repositories.goals.list();
  const checklistItems = await repositories.goals.listChecklistItems();

  for (const [position, starter] of MILESTONES.entries()) {
    let milestone = milestones.find((item) => item.title === starter.title);
    if (!milestone) {
      milestone = await repositories.milestones.create({
        title: starter.title,
        description: starter.description,
        position,
        status: position === 0 && personalizeEmptyProfile ? "in_progress" : "not_started",
      });
      milestones.push(milestone);
      milestoneCount += 1;
    }

    let goal = goals.find((item) => item.title === starter.goal.title);
    if (!goal) {
      goal = await repositories.goals.create({
        milestoneId: milestone.id,
        title: starter.goal.title,
        description: starter.goal.description,
        priority: starter.goal.priority,
        status: position === 0 && personalizeEmptyProfile ? "working_on" : "not_started",
      });
      goals.push(goal);
      goalCount += 1;
    }

    const existingChecklist = checklistItems.filter((item) => item.goalId === goal.id);
    for (const [itemPosition, title] of starter.goal.checklist.entries()) {
      if (existingChecklist.some((item) => item.title === title)) continue;
      const item = await repositories.goals.addChecklistItem(goal.id, title, itemPosition);
      checklistItems.push(item);
      checklistCount += 1;
    }
  }

  const materials = await repositories.documents.list();
  for (const starter of MATERIALS) {
    if (materials.some((item) => item.title === starter.title)) continue;
    const material = await repositories.documents.create(starter);
    materials.push(material);
    materialCount += 1;
  }

  if (personalizeEmptyProfile) {
    const first = milestones.find((item) => item.title === MILESTONES[0]?.title);
    await repositories.profile.update({
      certificateGoal: "Airline Pilot",
      currentFocus: "Build a strong training foundation",
      currentMilestoneId: first?.id ?? null,
    });
  }

  await repositories.app.set(STARTER_STATE_KEY, STARTER_VERSION);
  return {
    milestones: milestoneCount,
    goals: goalCount,
    checklistItems: checklistCount,
    materials: materialCount,
  };
}

const initializations = new WeakMap<Repositories, Promise<boolean>>();

/** Install automatically only when this is a genuinely empty first run. */
export function initializeAirlineStarterPack(repositories: Repositories): Promise<boolean> {
  const running = initializations.get(repositories);
  if (running) return running;

  const initialization = (async () => {
    if (await repositories.app.get(STARTER_STATE_KEY)) return false;

    if (await hasTrainingData(repositories)) {
      // Existing users choose explicitly whether to merge the starter roadmap.
      await repositories.app.set(STARTER_STATE_KEY, "skipped-existing-data");
      return false;
    }

    await restoreAirlineStarterPack(repositories, true);
    return true;
  })();
  initializations.set(repositories, initialization);
  return initialization;
}
