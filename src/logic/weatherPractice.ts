/** Made-up METAR/TAF reports for reading practice. All airports and times are examples. */

export interface WeatherPracticeQuestion {
  question: string;
  answer: string;
}

export interface WeatherPracticeScenario {
  id: string;
  kind: "metar" | "taf";
  raw: string;
  /** Lowest broken, overcast or vertical-visibility layer; absent when there is no ceiling. */
  ceilingFt?: number;
  visibilitySm?: number;
  /** Gust speed when gusts are reported, otherwise the steady wind. */
  windKt?: number;
  questions: WeatherPracticeQuestion[];
}

export const WEATHER_PRACTICE: WeatherPracticeScenario[] = [
  {
    id: "vfr-clear-ish",
    kind: "metar",
    raw: "METAR KDEM 171753Z 18008KT 10SM FEW050 SCT090 22/10 A3002",
    visibilitySm: 10,
    windKt: 8,
    questions: [
      { question: "What is the visibility?", answer: "10 statute miles" },
      { question: "Is there a ceiling?", answer: "No. Few and scattered clouds are not a ceiling." },
    ],
  },
  {
    id: "mvfr-mist",
    kind: "metar",
    raw: "METAR KDEM 171853Z 16010KT 5SM BR BKN025 18/16 A2995",
    ceilingFt: 2500,
    visibilitySm: 5,
    windKt: 10,
    questions: [
      { question: "What is the ceiling?", answer: "2,500 ft broken" },
      { question: "What is the visibility, and why is it reduced?", answer: "5 statute miles, in mist (BR)" },
    ],
  },
  {
    id: "ifr-rain",
    kind: "metar",
    raw: "METAR KDEM 172053Z 09006KT 2SM -RA BR OVC008 12/11 A2988",
    ceilingFt: 800,
    visibilitySm: 2,
    windKt: 6,
    questions: [
      { question: "What is the ceiling?", answer: "800 ft overcast" },
      { question: "What weather is reported?", answer: "Light rain and mist" },
    ],
  },
  {
    id: "gusty-wind",
    kind: "metar",
    raw: "METAR KDEM 171953Z 27018G28KT 10SM SCT060 BKN110 15/03 A2975",
    ceilingFt: 11000,
    visibilitySm: 10,
    windKt: 28,
    questions: [
      { question: "What is the wind?", answer: "From 270 degrees at 18 knots, gusting 28 knots" },
      { question: "What is the ceiling?", answer: "11,000 ft broken (the scattered layer at 6,000 ft is not a ceiling)" },
    ],
  },
  {
    id: "haze-gusts",
    kind: "metar",
    raw: "METAR KDEM 172153Z 33012G22KT 6SM HZ FEW030 BKN040 20/09 A3010",
    ceilingFt: 4000,
    visibilitySm: 6,
    windKt: 22,
    questions: [
      { question: "What is the lowest ceiling?", answer: "4,000 ft broken" },
      { question: "How strong are the gusts?", answer: "22 knots" },
    ],
  },
  {
    id: "fog-vv",
    kind: "metar",
    raw: "METAR KDEM 171153Z 00000KT 1/2SM FG VV002 09/09 A3011",
    ceilingFt: 200,
    visibilitySm: 0.5,
    windKt: 0,
    questions: [
      { question: "What is the visibility?", answer: "One half statute mile, in fog" },
      { question: "What does VV002 mean?", answer: "Sky obscured, vertical visibility 200 ft. It counts as a ceiling." },
    ],
  },
  {
    id: "mvfr-variable",
    kind: "metar",
    raw: "METAR KDEM 171653Z VRB04KT 3SM BR OVC015 14/13 A3004",
    ceilingFt: 1500,
    visibilitySm: 3,
    windKt: 4,
    questions: [
      { question: "What is the ceiling?", answer: "1,500 ft overcast" },
      { question: "What is the wind?", answer: "Variable in direction at 4 knots" },
    ],
  },
  {
    id: "taf-start",
    kind: "taf",
    raw: "TAF KDEM 171720Z 1718/1824 18010KT 6SM SCT050 TEMPO 1720/1724 3SM -SHRA BKN030 FM180600 VRB03KT 3SM BR OVC012",
    visibilitySm: 6,
    windKt: 10,
    questions: [
      { question: "What are the starting conditions (the first period)?", answer: "Wind from 180 degrees at 10 knots, 6 SM, scattered clouds at 5,000 ft" },
      { question: "What does the TEMPO group say?", answer: "Short-lived: 3 SM in light showers with a broken ceiling at 3,000 ft" },
    ],
  },
];
