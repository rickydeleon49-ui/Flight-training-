/** Short summaries, in our own words, of public NTSB reports on light piston airplane accidents. */
export interface AccidentCase {
  ntsbNumber: string;
  year: number;
  aircraft: string;
  phase: string;
  whatHappened: string;
  probableCause: string;
  lesson: string;
  question: string;
}

export const ACCIDENT_CASES_NOTE =
  "Short summaries in our own words of public NTSB reports. Look up the case number at the NTSB (CAROL) for the full report. Study aid only; ask your instructor.";

const Q = "What would you have done?";

export const ACCIDENT_CASES: readonly AccidentCase[] = [
  {
    ntsbNumber: "ERA11FA118", year: 2011, aircraft: "Cessna 172S", phase: "Missed approach in cloud",
    whatHappened: "A pilot with modest experience flew an approach in low cloud and visibility. During the missed approach the airplane descended steeply and struck the ground.",
    probableCause: "Loss of airplane control during the missed approach due to spatial disorientation.",
    lesson: "Without solid instrument skills, your inner ear will lie to you in cloud, so do not press on toward weather you cannot handle.",
    question: Q,
  },
  {
    ntsbNumber: "ERA10FA091", year: 2009, aircraft: "Cessna 172S", phase: "Climb after night departure",
    whatHappened: "A young, low-time pilot took off at night with a special VFR clearance while the weather was in instrument conditions. Soon after departure the airplane lost control in cloud.",
    probableCause: "The decision to depart under special VFR at night in instrument conditions and continue VFR flight into those conditions.",
    lesson: "Legal is not the same as safe: a low-time pilot should treat night plus poor weather as a firm no-go.",
    question: Q,
  },
  {
    ntsbNumber: "WPR15FA070", year: 2014, aircraft: "Cessna 172", phase: "Maneuvering",
    whatHappened: "A pilot without an instrument rating flew into cloud while maneuvering at low altitude in hilly terrain. The airplane lost control and hit the ground.",
    probableCause: "A non-instrument-rated pilot's encounter with instrument conditions while maneuvering, leading to loss of control from spatial disorientation.",
    lesson: "Turning back early, while you can still see, beats trying to find a hole in the cloud.",
    question: Q,
  },
  {
    ntsbNumber: "ERA23FA001", year: 2022, aircraft: "Cessna 172S", phase: "Initial climb at night",
    whatHappened: "On a dark night with low cloud, an airplane took off and began its climb. It lost control soon after and descended into terrain.",
    probableCause: "Loss of control due to spatial disorientation during the initial climb in dark night and low instrument conditions.",
    lesson: "A night takeoff into low cloud needs instrument-level skill and a real go/no-go decision before you start the engine.",
    question: Q,
  },
  {
    ntsbNumber: "ERA24FA096", year: 2024, aircraft: "Cessna 172", phase: "Cruise at night",
    whatHappened: "On a dark night over unlit, swampy ground, the airplane slowly lost altitude without the pilots noticing. It flew into the ground.",
    probableCause: "The pilots' spatial disorientation in dark night visual conditions, leading to failure to maintain altitude.",
    lesson: "With no visible horizon, even clear weather can act like cloud, so trust and cross-check your instruments.",
    question: Q,
  },
  {
    ntsbNumber: "CEN18FA384", year: 2018, aircraft: "Cessna 150", phase: "Night flight, engine failure",
    whatHappened: "A small airplane ran out of fuel at night. After the engine quit, the pilot let the nose rise too high and the wing stalled.",
    probableCause: "Total loss of engine power from fuel exhaustion, then exceeding the critical angle of attack, causing a stall.",
    lesson: "After an engine failure, fly the airplane first: lower the nose and keep your airspeed.",
    question: Q,
  },
  {
    ntsbNumber: "CEN16FA083", year: 2016, aircraft: "Cessna 172N", phase: "Approach at night",
    whatHappened: "An airplane lost all engine power on approach to an airport at night. The tanks did not have enough fuel for the trip.",
    probableCause: "Inadequate preflight planning and inspection, resulting in total power loss from fuel exhaustion.",
    lesson: "Look into the tanks yourself and plan fuel with a real reserve; do not rely on memory or the gauges alone.",
    question: Q,
  },
  {
    ntsbNumber: "ERA10FA502", year: 2010, aircraft: "Cessna 172", phase: "Cruise, engine failure",
    whatHappened: "A night flight went on longer than the fuel allowed, and the engine stopped. The pilot had to land off airport.",
    probableCause: "Inadequate flight planning and in-flight fuel management, resulting in total power loss from fuel exhaustion.",
    lesson: "Keep checking fuel against time in flight, and divert early while you still have options.",
    question: Q,
  },
  {
    ntsbNumber: "ANC14FA002", year: 2013, aircraft: "Cessna 172C", phase: "Emergency descent",
    whatHappened: "The engine stopped because the tanks were empty. The airplane came down and struck the ground.",
    probableCause: "The pilot's failure to ensure adequate fuel was on board, resulting in fuel exhaustion.",
    lesson: "Fuel is the one thing you must confirm yourself before every flight.",
    question: Q,
  },
  {
    ntsbNumber: "WPR23FA247", year: 2023, aircraft: "Cessna 172N", phase: "Takeoff",
    whatHappened: "A newer pilot took off and, early in the climb, pulled the flaps up suddenly. The airplane stalled just above the ground.",
    probableCause: "Exceeding the critical angle of attack on takeoff, causing a stall; sudden flap retraction contributed.",
    lesson: "Change flaps in stages, with enough height and speed, and keep the nose where it belongs.",
    question: Q,
  },
  {
    ntsbNumber: "CEN22FA214", year: 2022, aircraft: "Cessna 152", phase: "Takeoff",
    whatHappened: "A student pilot flying alone let the airplane climb too steeply after takeoff. The wing stalled at low height and the student could not recover.",
    probableCause: "The student pilot's exceedance of the critical angle of attack, causing a stall from which recovery was not made.",
    lesson: "Pitch for the speed you want, not the climb you imagine; a low stall has no room for recovery.",
    question: Q,
  },
  {
    ntsbNumber: "ERA23FA008", year: 2022, aircraft: "Cessna 172", phase: "Initial climb, instruction",
    whatHappened: "During a lesson the student let the nose get too high after takeoff. The instructor was slow to step in and the airplane stalled close to the ground.",
    probableCause: "The instructor's failure to monitor the student on takeoff and delayed action to stop the excessive angle of attack.",
    lesson: "Whoever is flying, someone must watch airspeed and pitch on every takeoff, and step in early.",
    question: Q,
  },
  {
    ntsbNumber: "ERA19FA107", year: 2019, aircraft: "Cessna 172", phase: "Climb after touch-and-go",
    whatHappened: "On a training flight the airplane began climbing after a touch-and-go landing. It was allowed to get too slow and stalled.",
    probableCause: "The instructor's failure to maintain control during the initial climb, exceeding the critical angle of attack.",
    lesson: "The first seconds after liftoff are the most dangerous for slow flight; fly pitch and airspeed.",
    question: Q,
  },
  {
    ntsbNumber: "WPR21FA298", year: 2021, aircraft: "Cessna 150", phase: "Maneuvering in the traffic pattern",
    whatHappened: "While maneuvering in the traffic pattern, a low-time pilot let the airspeed drop. The wing stalled and the airplane lost control at low height.",
    probableCause: "Exceeding the critical angle of attack while maneuvering in the pattern, resulting in a stall and loss of control.",
    lesson: "Tight turns near the ground need extra airspeed; never let the pattern drag you into a slow, steep turn.",
    question: Q,
  },
  {
    ntsbNumber: "WPR22FA227", year: 2022, aircraft: "Cessna 152", phase: "Training maneuver",
    whatHappened: "On a training flight a spin was entered lower than the operator's minimum altitude. The spin developed and recovery was not completed before reaching the ground.",
    probableCause: "Failure to recover from a developed spin; entering the maneuver below the operator's altitude limit contributed.",
    lesson: "Respect minimum altitudes for stalls and spins; they are the margin for your recovery.",
    question: Q,
  },
  {
    ntsbNumber: "CEN24FA188", year: 2024, aircraft: "Cessna 150L", phase: "Practicing a power-on stall",
    whatHappened: "A student practiced a power-on stall alone. The airplane entered a spin and there was not enough height to recover.",
    probableCause: "The student pilot's failure to maintain control while practicing a power-on stall, resulting in an inadvertent spin.",
    lesson: "Practice stalls high, with an instructor until you can recover every time.",
    question: Q,
  },
  {
    ntsbNumber: "WPR19FA244", year: 2019, aircraft: "Cessna 172", phase: "Takeoff from a mountain airport",
    whatHappened: "A pilot new to high mountain airports took off, climbed slowly and misjudged how much runway was needed to clear trees at the far end.",
    probableCause: "Delayed climb and misjudged performance and runway needed to clear obstacles; limited mountain-airport experience contributed.",
    lesson: "High and hot air cuts performance a lot: calculate it, and abort or wait for cooler air if the numbers are thin.",
    question: Q,
  },
  {
    ntsbNumber: "ERA10FA020", year: 2009, aircraft: "Piper PA-28-181", phase: "Landing roll on turf",
    whatHappened: "A pilot landed on a wet grass runway. The airplane veered during the landing roll, left the runway and hit a tree.",
    probableCause: "Loss of directional control while landing on a wet turf runway, resulting in a runway excursion.",
    lesson: "Wet grass lengthens the roll and weakens braking and steering, so plan for it or choose another runway.",
    question: Q,
  },
  {
    ntsbNumber: "WPR23FA258", year: 2023, aircraft: "Cessna 172N", phase: "Descent for landing at night",
    whatHappened: "During a descent toward the airport the engine lost power. Conditions favored carburetor ice and heat was not applied soon enough.",
    probableCause: "Total power loss from carburetor icing due to failure to apply carburetor heat in time during descent.",
    lesson: "In a carbureted airplane, apply carb heat early in the descent and whenever conditions are damp.",
    question: Q,
  },
  {
    ntsbNumber: "ERA22FA226", year: 2022, aircraft: "Cessna 172H", phase: "Emergency descent",
    whatHappened: "The engine lost all power in conditions that favor carburetor ice, and the pilot made an off-airport landing attempt.",
    probableCause: "Total power loss from carburetor ice due to ineffective use of carburetor heat in conducive conditions.",
    lesson: "Use carb heat as a habit, not a last resort, and know the temperature range where ice forms.",
    question: Q,
  },
  {
    ntsbNumber: "CEN18FA011", year: 2017, aircraft: "Cessna 172M", phase: "Low flying along a river",
    whatHappened: "A pilot flew low along a river near a bend. Power lines crossed the river and, with the sun's position, were hard to see.",
    probableCause: "The decision to fly low along the river, contrary to regulations and safety; sun and the river bend hid the wires.",
    lesson: "Wires are very hard to see; stay at a safe height and do not fly low just to enjoy the view.",
    question: Q,
  },
  {
    ntsbNumber: "CEN18FA227", year: 2018, aircraft: "Cessna 172N", phase: "Low flying over a canyon",
    whatHappened: "A pilot chose to fly at very low level over a canyon. The airplane hit power lines and then the ground.",
    probableCause: "The pilot's reckless decision to conduct low-level flight over a canyon.",
    lesson: "Low-level flying leaves no room for surprises; keep legal height above terrain and obstacles.",
    question: Q,
  },
  {
    ntsbNumber: "ERA23FA380", year: 2023, aircraft: "Piper PA-28", phase: "Cruise at night",
    whatHappened: "At night a flight continued into an area of known thunderstorms. The airplane broke up in flight from the forces involved.",
    probableCause: "The instructor's improper decision to continue flight into a known area of thunderstorms, resulting in an in-flight breakup.",
    lesson: "Stay well away from thunderstorms; a small airplane cannot survive them, and at night you cannot see them coming.",
    question: Q,
  },
  {
    ntsbNumber: "WPR21FA211", year: 2021, aircraft: "Cessna 172S", phase: "Cruise over mountains",
    whatHappened: "A flight crossed mountainous terrain at low altitude and met a strong downdraft. Control was lost and the airplane struck the ground.",
    probableCause: "Improper decision-making that led to a low-altitude downdraft encounter in mountains, resulting in loss of control.",
    lesson: "In the mountains, give yourself height and an escape route, and expect strong winds to push you down.",
    question: Q,
  },
];
