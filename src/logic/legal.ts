/**
 * Safety and legal wording for the About & legal screen and the first-launch
 * notice. One place, so every screen says the same short thing.
 */

/** app_metadata key set once you accept the first-launch notice. */
export const LEGAL_ACK_KEY = "legal_notice_accepted_v1";

export const LICENSE_NAME = "MIT License";
export const LICENSE_URL = "https://github.com/rickydeleon49-ui/Flight-training-/blob/main/LICENSE";
/** Served from public/ and bundled into the app. */
export const NOTICES_PATH = "THIRD_PARTY_NOTICES.txt";

/** The plain-language safety points, shown in full only in Settings. */
export const LEGAL_POINTS = [
  "This app is a study aid. It is not flight instruction and doesn't replace your instructor (CFI).",
  "Check what you learn here against FAA sources and your instructor.",
  "Airport weather is for study only. It is not an official weather briefing.",
  "AI study aids can be wrong. Check them before you rely on them.",
  "Checklists and progress here are your own notes. They don't certify you or show you are eligible for a checkride.",
  "The app is provided “as is”, without warranty of any kind. You use it at your own risk.",
] as const;

export const AGE_NOTE = "You need to be 13 or older to use this app, and 18 or older to use the AI features with your own key.";
export const AFFILIATION_NOTE = "This app is not affiliated with or endorsed by the FAA, Google or Anthropic. ACS and FAA handbook text shown here is FAA public-domain material.";

/** The one short disclaimer line, shown in the sidebar/More note, Add study pack and the README. */
export const DISCLAIMER_LINE = "Independent study aid. Not FAA-approved or endorsed. AI-assisted content can contain errors — check current FAA publications and your instructor.";

/** Where students report a mistake or send beta feedback. */
export const ISSUES_URL = "https://github.com/rickydeleon49-ui/Flight-training-/issues/new/choose";

/** One line under live METAR/TAF. */
export const WEATHER_BRIEFING_NOTE = "Not an official weather briefing.";

export const ACK_TITLE = "Before you start";
export const ACK_BODY =
  "This app is a study aid, not flight instruction or an official weather briefing. AI study aids can be wrong. Check with FAA sources and your instructor. It comes with no warranty.";
export const ACK_MORE = "You can read this again in Settings › About & legal.";
export const ACK_BUTTON = "I understand";

export const NOTICES_MISSING = "The license list isn't included in this build.";
