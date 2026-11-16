/** 14 CFR 91.213(d) walk-through: small airplane, no MEL, VFR training. A study aid, no saved state. */
export const INOP_TITLE = "Something inoperative? (14 CFR 91.213(d))";
export const INOP_DISCLAIMER = "A study aid, not an airworthiness decision.";

export const INOP_MEL_QUESTION = "Does this airplane have an approved Minimum Equipment List (MEL)?";
export const INOP_MEL_END = "Follow the MEL procedures and go through it with your instructor.";

/** 91.213(d)(2)(i)-(iv). */
export const INOP_CHECKS: readonly string[] = [
  "Is it part of the VFR-day equipment the airplane was type-certificated with?",
  "Is it on the airplane's equipment list or kinds of operations equipment list (KOEL) as required for this kind of flight?",
  "Is it required by 91.205 or another rule for this flight (e.g. night or IFR equipment)?",
  "Is it required by an Airworthiness Directive (AD)?",
];

export const INOP_REQUIRED_END =
  "This equipment is required for this flight. Don't fly with it inoperative — talk to your instructor or a mechanic.";
export const INOP_ALL_NO_END =
  "Before flight it must be either removed (placard the cockpit control and record it per 14 CFR 43.9) or deactivated and placarded \"Inoperative\". A certificated pilot or mechanic must decide it isn't a hazard. Go through this with your instructor before you fly.";

export type InopState =
  | { kind: "mel" }
  | { kind: "check"; index: number }
  | { kind: "end"; result: "mel" | "required" | "allNo"; text: string };

export const INOP_START: InopState = { kind: "mel" };

export function inopAnswer(state: InopState, yes: boolean): InopState {
  if (state.kind === "mel") {
    return yes
      ? { kind: "end", result: "mel", text: INOP_MEL_END }
      : { kind: "check", index: 0 };
  }
  if (state.kind === "check") {
    if (yes) return { kind: "end", result: "required", text: INOP_REQUIRED_END };
    return state.index + 1 >= INOP_CHECKS.length
      ? { kind: "end", result: "allNo", text: INOP_ALL_NO_END }
      : { kind: "check", index: state.index + 1 };
  }
  return state;
}
