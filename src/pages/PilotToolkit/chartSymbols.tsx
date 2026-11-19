import type { ReactNode } from "react";

/**
 * Chart-symbol practice set. Every drawing is our own simplified SVG, not FAA
 * artwork. Blue and magenta are the only fixed colours: on a sectional they ARE
 * the meaning (blue = towered / Class B, D; magenta = non-towered / Class C, E),
 * so they cannot follow the theme. Everything else uses currentColor.
 */
export const CHART_BLUE = "#2F7FD0";
export const CHART_MAGENTA = "#C2379B";
export const CHART_SOURCE_NOTE =
  "Simplified drawing; see the FAA Aeronautical Chart User's Guide";

export interface ChartSymbol {
  id: string;
  name: string;
  /** What the symbol means (shown on the back). */
  meaning: string;
  /** One-line study tip (shown on the back). */
  tip: string;
  /** Accessible description of the drawing (the SVG <desc>). */
  desc: string;
  drawing: ReactNode;
}

const B = CHART_BLUE;
const M = CHART_MAGENTA;
const line = { fill: "none", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const txt = { fill: "currentColor", fontFamily: "system-ui, sans-serif", textAnchor: "middle" } as const;

/** Airport circle with a runway cross, centred at 80,50. */
function airport(color: string, extra?: ReactNode) {
  return (
    <g stroke={color} {...line}>
      <circle cx="80" cy="50" r="22" />
      <path d="M64 50H96M80 34V66" />
      {extra}
    </g>
  );
}

function hexagon(cx: number, cy: number, r: number) {
  const pts = [0, 1, 2, 3, 4, 5]
    .map((i) => {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    })
    .join(" ");
  return <polygon points={pts} stroke={B} {...line} />;
}

/** Peaked obstruction mark: a small triangle with a dot on its apex. */
function peak(x: number, base: number, h: number, color = "currentColor") {
  return (
    <g stroke={color} {...line} strokeWidth={2.5}>
      <path d={`M${x - h / 3} ${base}L${x} ${base - h}L${x + h / 3} ${base}`} />
      <circle cx={x} cy={base - h} r="2" fill={color} />
    </g>
  );
}

export const CHART_SYMBOLS: ChartSymbol[] = [
  {
    id: "airport-towered",
    name: "Towered airport",
    meaning: "An airport with an operating control tower. Drawn in blue.",
    tip: "Blue means a tower: expect to talk to the tower and think Class B, C or D.",
    desc: "A blue circle with crossed runway lines.",
    drawing: airport(B),
  },
  {
    id: "airport-nontowered",
    name: "Non-towered airport",
    meaning: "A public-use airport with no control tower. Drawn in magenta.",
    tip: "Magenta means no tower: use CTAF and keep a sharp lookout.",
    desc: "A magenta circle with crossed runway lines.",
    drawing: airport(M),
  },
  {
    id: "airport-private",
    name: "Private airport",
    meaning: "A private-use airport, shown with an R inside the circle and (Pvt) below it. Not open to the public.",
    tip: "(Pvt) means you need permission before landing.",
    desc: "A small magenta circle with an R inside, labelled (Pvt).",
    drawing: (
      <g>
        <circle cx="80" cy="46" r="14" stroke={M} {...line} />
        <text x="80" y="52" fontSize="16" fontWeight="600" {...txt}>R</text>
        <text x="80" y="82" fontSize="16" fontWeight="600" {...txt}>(Pvt)</text>
      </g>
    ),
  },
  {
    id: "airport-services",
    name: "Airport with services",
    meaning: "Tick marks around the airport circle: fuel is available (and repairs may be).",
    tip: "Ticks mean fuel, but check the Chart Supplement for hours and fuel grade.",
    desc: "A magenta airport circle with short tick marks around it.",
    drawing: airport(
      M,
      <path d="M80 22V16M80 78V84M52 50H46M108 50H114M60 30L56 26M100 30L104 26M60 70L56 74M100 70L104 74" />,
    ),
  },
  {
    id: "airport-data",
    name: "Airport data block",
    meaning: "Name, CTAF/tower frequency, elevation, longest runway and lighting for an airport.",
    tip: "Elevation is in feet MSL; runway length is in hundreds of feet.",
    desc: "A small box of blue text lines: airport name, frequency, elevation and runway length.",
    drawing: (
      <g fill={B} fontFamily="system-ui, sans-serif" fontSize="13" fontWeight="600">
        <text x="34" y="30">EXAMPLE FLD</text>
        <text x="34" y="48">CT - 118.7</text>
        <text x="34" y="66">* 452 L 32</text>
        <text x="34" y="84" fontSize="11" fontWeight="400" fill="currentColor">(name  freq  elev  rwy  lights)</text>
      </g>
    ),
  },
  {
    id: "class-b",
    name: "Class B airspace",
    meaning: "Solid blue line: the lateral edge of Class B. Numbers give floor and ceiling in hundreds of feet MSL.",
    tip: "Class B needs an ATC clearance before you enter, plus a Mode C transponder and ADS-B Out.",
    desc: "A solid thick blue curved boundary with a floor and ceiling number pair.",
    drawing: (
      <g>
        <path d="M24 78Q24 22 80 22Q136 22 136 78" stroke={B} {...line} strokeWidth={5} />
        <text x="80" y="62" fontSize="16" fontWeight="600" {...txt}>100</text>
        <path d="M66 66H94" stroke="currentColor" strokeWidth="2" />
        <text x="80" y="82" fontSize="16" fontWeight="600" {...txt}>SFC</text>
      </g>
    ),
  },
  {
    id: "class-c",
    name: "Class C airspace",
    meaning: "Solid magenta line: the lateral edge of Class C, with floor and ceiling numbers.",
    tip: "Two-way radio contact before entering, plus a Mode C transponder and ADS-B Out. No clearance needed.",
    desc: "A solid magenta curved boundary with a floor and ceiling number pair.",
    drawing: (
      <g>
        <path d="M24 78Q24 22 80 22Q136 22 136 78" stroke={M} {...line} strokeWidth={4} />
        <text x="80" y="62" fontSize="16" fontWeight="600" {...txt}>40</text>
        <path d="M70 66H90" stroke="currentColor" strokeWidth="2" />
        <text x="80" y="82" fontSize="16" fontWeight="600" {...txt}>SFC</text>
      </g>
    ),
  },
  {
    id: "class-d",
    name: "Class D airspace",
    meaning: "Dashed blue line: the edge of Class D around a towered airport. A number in a dashed box is the ceiling in hundreds of feet MSL.",
    tip: "Class D: contact the tower before you enter. Blue dashes, towered field.",
    desc: "A dashed blue circle with a small ceiling number in a dashed box.",
    drawing: (
      <g>
        <circle cx="80" cy="50" r="34" stroke={B} {...line} strokeDasharray="7 6" />
        <rect x="64" y="40" width="32" height="20" stroke={B} strokeWidth="2" strokeDasharray="4 3" fill="none" />
        <text x="80" y="55" fontSize="14" fontWeight="600" {...txt}>25</text>
      </g>
    ),
  },
  {
    id: "class-e-surface",
    name: "Class E to the surface",
    meaning: "Dashed magenta line: Class E begins at the surface, usually around a non-towered airport with an instrument approach.",
    tip: "Dashed magenta circle: weather minimums for VFR apply right down to the ground.",
    desc: "A dashed magenta circle drawn around a small magenta airport.",
    drawing: (
      <g>
        <circle cx="80" cy="50" r="34" stroke={M} {...line} strokeDasharray="7 6" />
        <circle cx="80" cy="50" r="8" stroke={M} {...line} />
      </g>
    ),
  },
  {
    id: "class-e-700",
    name: "Class E starting at 700 ft AGL",
    meaning: "A faded (vignette) magenta band: controlled airspace begins 700 ft above the ground inside the shading.",
    tip: "Magenta fade = 700 ft AGL. Outside the fade, E usually starts at 1,200 ft AGL.",
    desc: "A shape whose magenta edge fades softly inward, marking the 700 foot Class E floor.",
    drawing: (
      <g>
        <defs>
          <radialGradient id="cs-e700" cx="50%" cy="50%" r="50%">
            <stop offset="55%" stopColor={M} stopOpacity="0" />
            <stop offset="100%" stopColor={M} stopOpacity="0.85" />
          </radialGradient>
        </defs>
        <circle cx="80" cy="50" r="38" fill="url(#cs-e700)" />
        <text x="80" y="55" fontSize="13" {...txt}>inside</text>
      </g>
    ),
  },
  {
    id: "class-e-1200",
    name: "Class E starting at 1,200 ft AGL",
    meaning: "A faded (vignette) blue band: on the shaded side, Class E begins 1,200 ft above the ground; on the other side it starts much higher.",
    tip: "Blue fade = 1,200 ft AGL. Magenta fade = 700 ft AGL.",
    desc: "A shape whose blue edge fades softly inward, marking the 1200 foot Class E floor.",
    drawing: (
      <g>
        <defs>
          <radialGradient id="cs-e1200" cx="50%" cy="50%" r="50%">
            <stop offset="55%" stopColor={B} stopOpacity="0" />
            <stop offset="100%" stopColor={B} stopOpacity="0.85" />
          </radialGradient>
        </defs>
        <circle cx="80" cy="50" r="38" fill="url(#cs-e1200)" />
        <text x="80" y="55" fontSize="13" {...txt}>inside</text>
      </g>
    ),
  },
  {
    id: "moa",
    name: "Military operations area (MOA)",
    meaning: "A magenta boundary with short inward hash marks: military training airspace, with the name and altitudes printed nearby.",
    tip: "MOAs are not off-limits, but check if it is active and stay alert.",
    desc: "A magenta outline with small hash marks along the inside edge.",
    drawing: (
      <g stroke={M} {...line} strokeWidth={2.5}>
        <rect x="30" y="20" width="100" height="60" rx="4" />
        <path d="M44 20V28M58 20V28M72 20V28M86 20V28M100 20V28M114 20V28M44 80V72M58 80V72M72 80V72M86 80V72M100 80V72M114 80V72" />
      </g>
    ),
  },
  {
    id: "restricted",
    name: "Restricted / prohibited area",
    meaning: "A blue boundary with inward hash marks: R-xxxx restricted, P-xxx prohibited. Often named and numbered.",
    tip: "Prohibited: never enter. Restricted: when it is active, enter only with permission from the controlling agency.",
    desc: "A blue outline with small hash marks along the inside edge and an R-number label.",
    drawing: (
      <g>
        <g stroke={B} {...line} strokeWidth={2.5}>
          <rect x="30" y="20" width="100" height="60" rx="4" />
          <path d="M44 20V28M58 20V28M72 20V28M86 20V28M100 20V28M114 20V28M44 80V72M58 80V72M72 80V72M86 80V72M100 80V72M114 80V72" />
        </g>
        <text x="80" y="56" fontSize="15" fontWeight="600" {...txt}>R-1234</text>
      </g>
    ),
  },
  {
    id: "vor",
    name: "VOR",
    meaning: "A blue hexagon with a centre dot: a VHF omnidirectional range station.",
    tip: "Hexagon only = VOR; no extras.",
    desc: "A blue hexagon with a dot at its centre.",
    drawing: (
      <g>
        {hexagon(80, 50, 24)}
        <circle cx="80" cy="50" r="3" fill={B} />
      </g>
    ),
  },
  {
    id: "vor-dme",
    name: "VOR-DME",
    meaning: "A VOR hexagon with a square around it: it also gives distance (DME).",
    tip: "Hexagon plus a square: bearing AND distance.",
    desc: "A blue hexagon with a blue square outline, and a centre dot.",
    drawing: (
      <g>
        <rect x="52" y="22" width="56" height="56" stroke={B} {...line} strokeWidth={2.5} />
        {hexagon(80, 50, 20)}
        <circle cx="80" cy="50" r="3" fill={B} />
      </g>
    ),
  },
  {
    id: "vortac",
    name: "VORTAC",
    meaning: "A VOR hexagon with three solid tabs: VOR plus military TACAN, giving bearing and distance.",
    tip: "Three little tabs on the hexagon = VORTAC.",
    desc: "A blue hexagon with three solid blue tabs and a centre dot.",
    drawing: (
      <g>
        {hexagon(80, 50, 20)}
        <g fill={B}>
          <rect x="76" y="18" width="8" height="10" />
          <path d="M60 68L66 58L72 64Z" />
          <path d="M100 68L94 58L88 64Z" />
        </g>
        <circle cx="80" cy="50" r="3" fill={B} />
      </g>
    ),
  },
  {
    id: "ndb",
    name: "NDB",
    meaning: "A magenta ring of dots around a centre dot: a non-directional radio beacon.",
    tip: "Dotted magenta circle: you need an ADF (or GPS) to use it.",
    desc: "A magenta dotted circle with a centre dot.",
    drawing: (
      <g>
        <circle cx="80" cy="50" r="24" stroke={M} fill="none" strokeWidth="4" strokeDasharray="1 6" strokeLinecap="round" />
        <circle cx="80" cy="50" r="4" fill={M} />
      </g>
    ),
  },
  {
    id: "victor-airway",
    name: "Victor airway",
    meaning: "A blue line labelled with a V and a number: a low-altitude airway between navaids, 8 nm wide.",
    tip: "Victor airways run below 18,000 ft MSL; V12 is airway number 12.",
    desc: "A blue line between two hexagon navaids, labelled V12.",
    drawing: (
      <g>
        <path d="M30 70L130 30" stroke={B} {...line} />
        <rect x="64" y="38" width="32" height="18" rx="3" fill="var(--surface-card, #fff)" stroke="none" />
        <text x="80" y="52" fontSize="14" fontWeight="600" fill={B} fontFamily="system-ui, sans-serif" textAnchor="middle">V12</text>
      </g>
    ),
  },
  {
    id: "obstruction-low",
    name: "Obstruction under 1,000 ft AGL",
    meaning: "A single small spike with a dot: a tower or similar structure below 1,000 ft above ground.",
    tip: "Numbers: top MSL, then (height AGL) in brackets.",
    desc: "A small narrow peak with a dot at its tip, with elevation labels.",
    drawing: (
      <g>
        {peak(80, 74, 36)}
        <text x="80" y="22" fontSize="12" {...txt}>850 (400)</text>
      </g>
    ),
  },
  {
    id: "obstruction-high",
    name: "Obstruction 1,000 ft AGL or higher",
    meaning: "A taller spike (drawn bigger) with a dot: a structure 1,000 ft or more above ground.",
    tip: "Bigger symbol = 1,000 ft AGL or higher.",
    desc: "A tall, wide peak with a dot at its tip, with elevation labels.",
    drawing: (
      <g>
        {peak(80, 80, 60)}
        <text x="80" y="14" fontSize="12" {...txt}>2400 (1100)</text>
      </g>
    ),
  },
  {
    id: "obstruction-group",
    name: "Group obstruction",
    meaning: "Several close spikes drawn together: a cluster of obstructions, with the tallest height labelled.",
    tip: "Elevation shown is for the tallest one in the group.",
    desc: "Three peaks drawn side by side as a cluster.",
    drawing: (
      <g>
        {peak(56, 76, 30)}
        {peak(80, 76, 44)}
        {peak(104, 76, 34)}
      </g>
    ),
  },
  {
    id: "obstruction-lighted",
    name: "Lighted obstruction",
    meaning: "An obstruction symbol with short rays above it: the structure has obstruction lights.",
    tip: "Rays mean lights. Lightning-bolt marks instead mean high-intensity lights, which may run part-time.",
    desc: "A peak with short rays radiating from its tip.",
    drawing: (
      <g>
        {peak(80, 78, 40)}
        <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M80 30V22M70 34L64 28M90 34L96 28M64 42H56M96 42H104" />
        </g>
      </g>
    ),
  },
  {
    id: "max-elevation",
    name: "Maximum elevation figure (MEF)",
    meaning: "A large and a small number per chart quadrangle: the highest terrain or obstacle, rounded up. The large number is thousands of feet, the small one hundreds, so 4 and 5 means 4,500 ft MSL.",
    tip: "The MEF already includes a safety margin for obstacles; use it for terrain planning.",
    desc: "A large blue number with a smaller one beside it.",
    drawing: (
      <g fill={B} fontFamily="system-ui, sans-serif" fontWeight="700">
        <text x="68" y="70" fontSize="48" textAnchor="middle">4</text>
        <text x="98" y="52" fontSize="24" textAnchor="middle">5</text>
      </g>
    ),
  },
  {
    id: "isogonic",
    name: "Isogonic line",
    meaning: "A dashed magenta line of equal magnetic variation, labelled in degrees east or west.",
    tip: "East is least, west is best: subtract east variation, add west, when going true to magnetic.",
    desc: "A long dashed magenta line with a label such as 10 degrees east.",
    drawing: (
      <g>
        <path d="M30 88L130 12" stroke={M} {...line} strokeDasharray="10 6" />
        <rect x="56" y="38" width="48" height="22" rx="3" fill="var(--surface-card, #fff)" />
        <text x="80" y="54" fontSize="14" fontWeight="600" fill={M} fontFamily="system-ui, sans-serif" textAnchor="middle">10°E</text>
      </g>
    ),
  },
  {
    id: "parachute",
    name: "Parachute jumping area",
    meaning: "A small parachute shape: skydiving takes place here, often to a stated altitude.",
    tip: "Expect jumpers near the field; the Chart Supplement lists times and altitudes.",
    desc: "A canopy dome with lines down to a small person.",
    drawing: (
      <g stroke="currentColor" {...line} strokeWidth={2.5}>
        <path d="M46 46Q80 6 114 46Q97 38 80 46Q63 38 46 46Z" />
        <path d="M46 46L76 76M114 46L84 76M80 46V74" />
        <circle cx="80" cy="80" r="4" fill="currentColor" />
      </g>
    ),
  },
  {
    id: "glider",
    name: "Glider operations",
    meaning: "A small glider shape: glider flying takes place here, usually near the airport or a ridge.",
    tip: "Gliders have no engine to go around, so give them right of way and room.",
    desc: "A glider seen from above, with long straight wings.",
    drawing: (
      <g stroke="currentColor" {...line} strokeWidth={2.5}>
        <path d="M26 46H134" />
        <path d="M80 28V70M68 70H92" />
      </g>
    ),
  },
  {
    id: "visual-checkpoint",
    name: "Visual checkpoint flag",
    meaning: "A small flag: a suggested visual reporting point or landmark, named beside it.",
    tip: "Used for position reports in busy areas, such as around Class B and C.",
    desc: "A small flag on a pole with a name label.",
    drawing: (
      <g stroke={M} {...line} strokeWidth={2.5}>
        <path d="M64 22V80" />
        <path d="M64 24H100L90 36L100 48H64" fill={M} fillOpacity="0.3" />
      </g>
    ),
  },
  {
    id: "seaplane-base",
    name: "Seaplane base",
    meaning: "An anchor shape: a water landing area where seaplanes can dock or moor. Magenta, or blue when the base has a control tower, like other airports.",
    tip: "The anchor is the only mark: look for water, not runways.",
    desc: "A magenta anchor shape: ring on top, shank, crossbar and curved flukes.",
    drawing: (
      <g stroke={M} {...line}>
        <circle cx="80" cy="24" r="6" />
        <path d="M80 30V78M68 42H92M50 56Q52 78 80 78Q108 78 110 56" />
      </g>
    ),
  },
];
