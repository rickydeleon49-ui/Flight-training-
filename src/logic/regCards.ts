/** Paraphrased regulation recall cards. Plain words, not quotes; the rules can change. */
export interface RegCard {
  id: string;
  reg: string;
  prompt: string;
  answer: string;
  whyItMatters?: string;
  /** Situation card (shown under the "Scenarios" filter). Optional so older data and cards are unchanged. */
  scenario?: boolean;
  /** Id of a shipped diagram to show with the answer (see src/logic/diagrams.ts). */
  diagramId?: string;
}

export const VFR_MINIMUMS_DIAGRAM_ID = "flight-rules/05-basic-vfr-weather-minimums";

export const REG_CARDS_CHECKED = "14 Nov 2026";
export const REG_CARDS_NOTE =
  "Paraphrased study cards, checked 14 Nov 2026. Rules change: check the current regulation (eCFR) and ask your instructor.";

export const REG_CARDS: readonly RegCard[] = [
  {
    id: "carry-documents",
    reg: "14 CFR 61.3",
    prompt: "What must you carry when you fly as pilot in command?",
    answer: "Your pilot certificate, a current medical certificate (when one is required) and a photo ID.",
    whyItMatters: "A ramp check or a missing document can ground the flight.",
  },
  {
    id: "medical-third-class",
    reg: "14 CFR 61.23",
    prompt: "How long does a third-class medical last for privileges at the private pilot level?",
    answer: "60 months if you are under 40 when it is issued, 24 months if you are 40 or older. BasicMed is a separate option.",
  },
  {
    id: "passenger-day-currency",
    reg: "14 CFR 61.57(a)",
    prompt: "What do you need to carry passengers in the day?",
    answer: "Three takeoffs and three landings in the last 90 days, in the same category, class and (if a type rating is needed) type.",
  },
  {
    id: "tailwheel-currency",
    reg: "14 CFR 61.57(a)",
    prompt: "What is different about passenger currency in a tailwheel airplane?",
    answer: "The three landings must each be to a full stop.",
  },
  {
    id: "passenger-night-currency",
    reg: "14 CFR 61.57(b)",
    prompt: "What do you need to carry passengers at night?",
    answer:
      "Three takeoffs and three full-stop landings in the last 90 days, done between one hour after sunset and one hour before sunrise, in the same category and class.",
  },
  {
    id: "flight-review",
    reg: "14 CFR 61.56",
    prompt: "How often is a flight review needed?",
    answer: "Within the previous 24 calendar months, with an instructor: at least one hour of ground training and one hour of flight training.",
  },
  {
    id: "student-passengers",
    reg: "14 CFR 61.89(a)",
    prompt: "Can a student pilot carry passengers or fly for hire?",
    answer: "No. A student pilot may not carry passengers, and may not fly for compensation or hire.",
  },
  {
    id: "student-visibility",
    reg: "14 CFR 61.89(a)",
    prompt: "What weather limits apply to a student pilot flying alone?",
    answer: "Not less than 3 statute miles flight visibility by day or 5 at night, and always with visual reference to the surface.",
  },
  {
    id: "private-compensation",
    reg: "14 CFR 61.113",
    prompt: "Can a private pilot be paid to fly? What cost sharing is allowed?",
    answer: "Not paid to fly. You may share the flight's operating costs with passengers as long as you pay at least your own pro-rata share.",
  },
  {
    id: "pic-authority",
    reg: "14 CFR 91.3",
    prompt: "Who is responsible for the airplane and has final authority?",
    answer: "The pilot in command. In an emergency you may deviate from the rules as needed to keep the flight safe.",
  },
  {
    id: "preflight-action",
    reg: "14 CFR 91.103",
    prompt: "What must you know before every flight?",
    answer:
      "All available information: weather, fuel needs, alternatives if the plan fails, runway lengths at your airports, and takeoff and landing distances.",
  },
  {
    id: "vfr-fuel",
    reg: "14 CFR 91.151",
    prompt: "How much fuel must you have for VFR flight in an airplane?",
    answer: "Enough to reach your first landing point plus 30 minutes by day or 45 minutes at night, at normal cruise speed.",
  },
  {
    id: "vfr-class-b",
    reg: "14 CFR 91.155",
    prompt: "What are the basic VFR weather minimums in Class B airspace?",
    answer: "3 statute miles visibility and clear of clouds.",
  },
  {
    id: "vfr-class-cd",
    reg: "14 CFR 91.155",
    prompt: "What are the basic VFR weather minimums in Class C and D airspace?",
    answer: "3 statute miles visibility; stay 500 feet below, 1,000 above and 2,000 horizontally from clouds.",
  },
  {
    id: "vfr-class-e",
    reg: "14 CFR 91.155",
    prompt: "What are the basic VFR minimums in Class E airspace below 10,000 feet MSL?",
    answer: "3 statute miles visibility; 500 feet below, 1,000 above and 2,000 horizontally from clouds.",
  },
  {
    id: "vfr-class-g-day",
    reg: "14 CFR 91.155",
    prompt: "What are the day VFR minimums in Class G airspace at 1,200 feet AGL or lower?",
    answer: "1 statute mile visibility and clear of clouds.",
  },
  {
    id: "day-vfr-equipment",
    reg: "14 CFR 91.205",
    prompt: "What instruments and equipment does day VFR require? (a memory aid)",
    answer:
      "ATOMATOFLAMES is a memory aid for day VFR. Instruments: airspeed indicator, tachometer, oil pressure gauge, manifold pressure gauge (if the engine has one), altimeter, temperature gauge, oil temperature gauge, fuel gauge, landing gear position indicator (if retractable), magnetic compass. Also: anti-collision lights, ELT and safety belts. Check the rule for what your airplane needs.",
  },
  {
    id: "elt",
    reg: "14 CFR 91.207",
    prompt: "How often must an emergency locator transmitter (ELT) be inspected?",
    answer: "Every 12 calendar months, with the battery replaced when it has been used over an hour or reached half its life.",
  },
  {
    id: "oxygen",
    reg: "14 CFR 91.211",
    prompt: "When must the crew use supplemental oxygen, and when must passengers be offered it?",
    answer:
      "These heights are cabin pressure altitude. Crew: more than 30 minutes above 12,500 feet up to 14,000, and always above 14,000. Passengers must be offered oxygen above 15,000 feet.",
  },
  {
    id: "alcohol",
    reg: "14 CFR 91.17",
    prompt: "What are the alcohol rules for flying?",
    answer: "No flying within 8 hours of drinking, while under the influence, or with a blood alcohol level of 0.04 or more.",
  },
  {
    id: "min-altitudes",
    reg: "14 CFR 91.119",
    prompt: "What are the minimum safe altitudes?",
    answer:
      "Over a congested area: 1,000 feet above the highest obstacle within 2,000 feet horizontally. Elsewhere: 500 feet above the ground, and not closer than 500 feet to people, vehicles or structures over open water or sparse areas.",
  },
  {
    id: "annual-100hr",
    reg: "14 CFR 91.409",
    prompt: "What inspections does an airplane need?",
    answer: "An annual inspection within the previous 12 calendar months, and also a 100-hour inspection if it is used for hire (including flight instruction for hire).",
  },
  {
    id: "sc-class-b",
    reg: "14 CFR 91.155(a)",
    prompt: "You plan a VFR flight in Class B airspace. What visibility and cloud clearance do you need?",
    answer: "3 statute miles flight visibility and clear of clouds.",
    scenario: true,
    diagramId: VFR_MINIMUMS_DIAGRAM_ID,
  },
  {
    id: "sc-class-c",
    reg: "14 CFR 91.155(a)",
    prompt: "You are VFR in Class C airspace. What visibility and cloud clearance do you need?",
    answer: "3 statute miles flight visibility; 500 feet below, 1,000 feet above and 2,000 feet horizontally from clouds.",
    scenario: true,
    diagramId: VFR_MINIMUMS_DIAGRAM_ID,
  },
  {
    id: "sc-class-d",
    reg: "14 CFR 91.155(a)",
    prompt: "You are VFR in Class D airspace at the traffic pattern altitude. What visibility and cloud clearance do you need?",
    answer: "3 statute miles flight visibility; 500 feet below, 1,000 feet above and 2,000 feet horizontally from clouds.",
    scenario: true,
    diagramId: VFR_MINIMUMS_DIAGRAM_ID,
  },
  {
    id: "sc-class-e-below",
    reg: "14 CFR 91.155(a)",
    prompt: "Day, Class E airspace below 10,000 ft MSL. What visibility and cloud clearance do you need?",
    answer: "3 statute miles flight visibility; 500 feet below, 1,000 feet above and 2,000 feet horizontally from clouds.",
    scenario: true,
    diagramId: VFR_MINIMUMS_DIAGRAM_ID,
  },
  {
    id: "sc-class-e-above",
    reg: "14 CFR 91.155(a)",
    prompt: "You climb through 10,500 ft MSL in Class E airspace. What visibility and cloud clearance do you need?",
    answer: "5 statute miles flight visibility; 1,000 feet below, 1,000 feet above and 1 statute mile horizontally from clouds.",
    scenario: true,
    diagramId: VFR_MINIMUMS_DIAGRAM_ID,
  },
  {
    id: "sc-class-g-low-day",
    reg: "14 CFR 91.155(a)",
    prompt: "Day, Class G airspace, 800 ft AGL. What visibility and cloud clearance do you need?",
    answer: "1 statute mile flight visibility and clear of clouds.",
    scenario: true,
    diagramId: VFR_MINIMUMS_DIAGRAM_ID,
  },
  {
    id: "sc-class-g-low-night",
    reg: "14 CFR 91.155(a)",
    prompt: "Night, Class G airspace, 800 ft AGL, not in a traffic pattern. What visibility and cloud clearance do you need?",
    answer: "3 statute miles flight visibility; 500 feet below, 1,000 feet above and 2,000 feet horizontally from clouds.",
    scenario: true,
    diagramId: VFR_MINIMUMS_DIAGRAM_ID,
  },
  {
    id: "sc-class-g-pattern-night",
    reg: "14 CFR 91.155(b)(2)",
    prompt: "Night, Class G airspace, flying an airplane in the traffic pattern within half a mile of the runway, visibility 1 mile. Is that legal VFR?",
    answer: "Yes, as an exception: flight visibility of at least 1 statute mile and clear of clouds, when the airplane stays in the airport traffic pattern within 1/2 mile of the runway.",
    scenario: true,
    diagramId: VFR_MINIMUMS_DIAGRAM_ID,
  },
  {
    id: "sc-class-g-mid-day",
    reg: "14 CFR 91.155(a)",
    prompt: "Day, Class G airspace, 2,500 ft AGL and below 10,000 ft MSL. What visibility and cloud clearance do you need?",
    answer: "1 statute mile flight visibility; 500 feet below, 1,000 feet above and 2,000 feet horizontally from clouds.",
    scenario: true,
    diagramId: VFR_MINIMUMS_DIAGRAM_ID,
  },
  {
    id: "sc-class-g-mid-night",
    reg: "14 CFR 91.155(a)",
    prompt: "Night, Class G airspace, 2,500 ft AGL and below 10,000 ft MSL. What visibility and cloud clearance do you need?",
    answer: "3 statute miles flight visibility; 500 feet below, 1,000 feet above and 2,000 feet horizontally from clouds.",
    scenario: true,
    diagramId: VFR_MINIMUMS_DIAGRAM_ID,
  },
  {
    id: "sc-class-g-high",
    reg: "14 CFR 91.155(a)",
    prompt: "Class G airspace, more than 1,200 ft AGL and at or above 10,000 ft MSL. What visibility and cloud clearance do you need?",
    answer: "5 statute miles flight visibility; 1,000 feet below, 1,000 feet above and 1 statute mile horizontally from clouds.",
    scenario: true,
    diagramId: VFR_MINIMUMS_DIAGRAM_ID,
  },
  {
    id: "sc-ceiling-1000",
    reg: "14 CFR 91.155(c)",
    prompt: "The ceiling is 800 feet at an airport with controlled airspace down to the surface. Can you fly VFR beneath the ceiling in that airspace?",
    answer: "No. Without a special VFR clearance, you may not operate VFR beneath the ceiling within the lateral boundaries of controlled airspace designated to the surface for an airport when the ceiling is less than 1,000 feet.",
    scenario: true,
    diagramId: VFR_MINIMUMS_DIAGRAM_ID,
  },
  {
    id: "sc-ground-vis",
    reg: "14 CFR 91.155(d)",
    prompt: "The airport is in a Class D surface area and the reported ground visibility is 2 miles. Can you take off or land VFR?",
    answer: "No. Without a special VFR clearance, you may not take off, land or enter the traffic pattern VFR in a surface area unless ground visibility at the airport is at least 3 statute miles. If none is reported, flight visibility must be at least 3.",
    scenario: true,
    diagramId: VFR_MINIMUMS_DIAGRAM_ID,
  },
  {
    id: "sc-special-vfr",
    reg: "14 CFR 91.157",
    prompt: "What are the special VFR minimums in a surface area, and what else do you need?",
    answer: "1 statute mile flight visibility and clear of clouds, with an ATC clearance. At night you also need an instrument rating and an IFR-equipped airplane.",
    scenario: true,
    diagramId: VFR_MINIMUMS_DIAGRAM_ID,
  },
  {
    id: "inop-equipment",
    reg: "14 CFR 91.213(d)",
    prompt: "No MEL: when can you fly with inoperative equipment?",
    answer:
      "Only if the item is NOT part of the VFR-day type-certificated equipment, NOT required by the equipment list or KOEL for this flight, NOT required by 91.205 or another rule, and NOT required by an AD. It must be removed (cockpit control placarded, recorded per 43.9) or deactivated and placarded \"Inoperative\", and a certificated pilot or mechanic must determine it is not a hazard. This is the no-MEL path for non-turbine airplanes like most trainers; talk it through with your instructor.",
  },
];
