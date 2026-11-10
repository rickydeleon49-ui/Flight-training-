import { TOPIC_LABELS, type Topic } from "@/domain/types";

/**
 * DIAGRAMS-01: the study diagrams shipped with the app. The SVG files live in
 * `src/assets/diagrams/<set>/` and are loaded one at a time (see
 * `pages/StudyLibrary/DiagramArt.tsx`); this file is only the list. Each SVG
 * carries its own title and description, which are its text alternative.
 */
export interface Diagram {
  /** `<set>/<file without .svg>`, stable. */
  id: string;
  set: string;
  /** File name inside the set folder. */
  file: string;
  title: string;
  topic: Topic;
  /** "PHAK ch. 5" for the Pilot's Handbook; otherwise the book's name. */
  source: string;
}

function d(set: string, file: string, title: string, topic: Topic, source: string): Diagram {
  return { id: `${set}/${file.replace(/\.svg$/, "")}`, set, file, title, topic, source };
}

export const DIAGRAMS: readonly Diagram[] = [
  d("airspace", "01-airspace-layers.svg", "Airspace layers, side view", "regulations", "PHAK ch. 15"),
  d("airspace", "02-class-b-cake.svg", "Class B: upside-down wedding cake", "regulations", "PHAK ch. 15"),
  d("airspace", "03-class-c-rings.svg", "Class C: two rings", "regulations", "PHAK ch. 15"),
  d("airspace", "04-class-d-cylinder.svg", "Class D: tower airspace", "regulations", "PHAK ch. 15"),
  d("airspace", "05-chart-boundaries.svg", "Sectional chart boundary styles", "regulations", "PHAK ch. 15"),
  d("airspace", "06-special-use.svg", "Special use airspace", "regulations", "PHAK ch. 15"),
  d("adm", "01-hazardous-attitudes.svg", "The five hazardous attitudes", "flight_planning", "PHAK ch. 2"),
  d("adm", "02-pave-3p.svg", "PAVE and the 3P model", "flight_planning", "PHAK ch. 2"),
  d("adm", "03-decide-model.svg", "The DECIDE model", "flight_planning", "PHAK ch. 2"),
  d("adm", "04-risk-matrix.svg", "Risk assessment: the likelihood and severity matrix", "flight_planning", "PHAK ch. 2"),
  d("adm", "05-srm-5ps.svg", "Single-pilot resource management: the 5 Ps", "flight_planning", "PHAK ch. 2"),
  d("aero", "01-four-forces.svg", "Four forces in straight-and-level flight", "aerodynamics", "PHAK ch. 5"),
  d("aero", "02-airfoil-terms.svg", "Airfoil terms", "aerodynamics", "PHAK ch. 4"),
  d("aero", "03-aoa-vs-pitch.svg", "Angle of attack versus pitch attitude", "aerodynamics", "PHAK ch. 5"),
  d("aero", "04-forces-in-turn.svg", "Forces in a turn", "aerodynamics", "PHAK ch. 5"),
  d("aero", "05-load-factor-bank.svg", "Load factor in a banked turn", "aerodynamics", "PHAK ch. 5"),
  d("controls", "01-major-parts.svg", "Major airplane parts", "aircraft_systems", "PHAK ch. 3"),
  d("controls", "02-axes-primary-controls.svg", "Three axes and the primary controls", "aerodynamics", "PHAK ch. 6"),
  d("controls", "03-secondary-controls.svg", "Secondary controls: flaps and tabs", "aerodynamics", "PHAK ch. 6"),
  d("stability", "01-static-dynamic-response.svg", "Static and dynamic stability: how a disturbed airplane responds", "aerodynamics", "PHAK ch. 5"),
  d("stability", "02-longitudinal-tail-force-speed.svg", "Longitudinal stability: tail force, speed and pitch oscillation", "aerodynamics", "PHAK ch. 5"),
  d("stability", "03-lateral-directional-stability.svg", "Lateral and directional stability: what makes the airplane self-righting", "aerodynamics", "PHAK ch. 5"),
  d("stability", "04-left-turning-tendencies.svg", "Left-turning tendencies: four elements of torque", "aerodynamics", "PHAK ch. 5"),
  d("stability", "05-adverse-yaw-rudder.svg", "Adverse yaw and how the rudder corrects it", "aerodynamics", "PHAK ch. 6"),
  d("stalls", "01-critical-angle-stall.svg", "Critical angle of attack: airflow separation and the stall", "aerodynamics", "PHAK ch. 5"),
  d("stalls", "02-stall-speed-load-factor.svg", "Stall speed rises with load factor", "aerodynamics", "PHAK ch. 5"),
  d("stalls", "03-spin.svg", "Spin: an aggravated stall with rotation", "aerodynamics", "PHAK ch. 5"),
  d("stalls", "04-ground-effect.svg", "Ground effect: wingtip vortices and induced drag near the surface", "aerodynamics", "PHAK ch. 5"),
  d("stalls", "05-wing-design-stall-progression.svg", "Wing design and how a stall progresses", "aerodynamics", "PHAK ch. 5"),
  d("drag-prop", "01-types-of-drag.svg", "Types of drag: parasite and induced", "aerodynamics", "PHAK ch. 5"),
  d("drag-prop", "02-total-drag-curve.svg", "Total drag against airspeed", "aerodynamics", "PHAK ch. 5"),
  d("drag-prop", "03-l-d-max-best-glide.svg", "L/DMAX: best range and best glide speed", "aerodynamics", "PHAK ch. 5"),
  d("drag-prop", "04-propeller-blade-twist.svg", "The propeller: blade angle and twist", "aircraft_systems", "PHAK ch. 7"),
  d("drag-prop", "05-fixed-vs-constant-speed-prop.svg", "Fixed-pitch and constant-speed propellers", "aircraft_systems", "PHAK ch. 7"),
  d("systems", "01-four-stroke-cycle.svg", "Four-stroke cycle", "aircraft_systems", "PHAK ch. 7"),
  d("systems", "02-carburetor-icing.svg", "Carburetor icing and carburetor heat", "aircraft_systems", "PHAK ch. 7"),
  d("systems", "03-ignition-magnetos.svg", "Ignition system with dual magnetos", "aircraft_systems", "PHAK ch. 7"),
  d("systems", "04-fuel-system.svg", "Gravity-feed fuel system", "aircraft_systems", "PHAK ch. 7"),
  d("systems", "05-electrical-system.svg", "Aircraft electrical system", "aircraft_systems", "PHAK ch. 7"),
  d("instruments", "01-asi-color-arcs.svg", "Airspeed indicator color arcs", "aircraft_systems", "PHAK ch. 8"),
  d("instruments", "02-pitot-static.svg", "Pitot-static system: what uses what", "aircraft_systems", "PHAK ch. 8"),
  d("instruments", "03-attitude-indicator.svg", "Attitude indicator read-out", "aircraft_systems", "PHAK ch. 8"),
  d("instruments", "04-six-pack-pfd.svg", "Six-pack on a glass panel", "aircraft_systems", "PHAK ch. 8"),
  d("instruments", "05-turn-indicators.svg", "Turn coordinator versus turn-and-slip", "aircraft_systems", "PHAK ch. 8"),
  d("compass", "01-gyro-principles.svg", "Gyroscopic principles: rigidity in space and precession", "aircraft_systems", "PHAK ch. 8"),
  d("compass", "02-compass-variation-deviation.svg", "Magnetic compass: parts, variation, and deviation", "aircraft_systems", "PHAK ch. 8"),
  d("compass", "03-compass-turning-errors.svg", "Compass turning errors: northerly and southerly", "aircraft_systems", "PHAK ch. 8"),
  d("compass", "04-compass-acceleration-oscillation.svg", "Acceleration and oscillation errors", "aircraft_systems", "PHAK ch. 8"),
  d("compass", "05-heading-indicator-drift-reset.svg", "Heading indicator: why it drifts and how you reset it", "aircraft_systems", "PHAK ch. 8"),
  d("navigation", "01-lat-long.svg", "Latitude and longitude", "navigation", "PHAK ch. 16"),
  d("navigation", "02-true-to-compass.svg", "True heading to compass heading", "navigation", "PHAK ch. 16"),
  d("navigation", "03-wind-triangle.svg", "Wind triangle", "navigation", "PHAK ch. 16"),
  d("navigation", "04-vor-radials.svg", "VOR radials and the CDI", "navigation", "PHAK ch. 16"),
  d("navigation", "05-pilotage-dead-reckoning.svg", "Pilotage and dead reckoning", "navigation", "PHAK ch. 16"),
  d("sectional", "01-airport-symbols.svg", "Sectional airport symbols", "navigation", "Aeronautical Chart User's Guide"),
  d("sectional", "02-airport-data-block.svg", "Airport data block", "navigation", "Aeronautical Chart User's Guide"),
  d("sectional", "03-airspace-boundaries.svg", "Airspace boundaries on a sectional", "navigation", "Aeronautical Chart User's Guide"),
  d("sectional", "04-obstructions-and-elevation.svg", "Obstructions and elevation figures", "navigation", "Aeronautical Chart User's Guide"),
  d("sectional", "05-navaids-and-routes.svg", "Navaids and routes", "navigation", "Aeronautical Chart User's Guide"),
  d("weather", "01-atmosphere-layers.svg", "Atmosphere layers", "weather", "PHAK ch. 12"),
  d("weather", "02-pressure-systems.svg", "High and low pressure systems", "weather", "PHAK ch. 12"),
  d("weather", "03-cold-front.svg", "Cold front cross-section", "weather", "PHAK ch. 12"),
  d("weather", "04-warm-front.svg", "Warm front cross-section", "weather", "PHAK ch. 12"),
  d("weather", "05-thunderstorm-stages.svg", "Thunderstorm life cycle", "weather", "PHAK ch. 12"),
  d("wx-hazards", "01-atmospheric-stability.svg", "Atmospheric stability: stable and unstable air", "weather", "PHAK ch. 12"),
  d("wx-hazards", "02-fog-types.svg", "Fog types and the conditions that form each", "weather", "PHAK ch. 12"),
  d("wx-hazards", "03-microburst-wind-shear.svg", "Microburst: low-level wind shear on approach", "weather", "PHAK ch. 12"),
  d("wx-hazards", "04-dew-point-spread-cloud-base.svg", "Temperature, dew point and the height of the cloud base", "weather", "PHAK ch. 12"),
  d("wx-hazards", "05-icing-and-frost.svg", "Structural icing and frost on the wing", "weather", "PHAK ch. 12"),
  d("wx-reports", "01-metar-decoded.svg", "METAR decoded field by field", "weather", "PHAK ch. 13"),
  d("wx-reports", "02-taf-decoded.svg", "TAF decoded with change groups", "weather", "PHAK ch. 13"),
  d("wx-reports", "03-pirep-format.svg", "PIREP format decoded", "weather", "PHAK ch. 13"),
  d("wx-reports", "04-station-model.svg", "Surface analysis station model", "weather", "PHAK ch. 13"),
  d("wx-reports", "05-weather-charts.svg", "Weather charts and flight categories", "weather", "PHAK ch. 13"),
  d("airport", "01-traffic-pattern.svg", "Left-hand traffic pattern", "airports", "PHAK ch. 14"),
  d("airport", "02-runway-markings.svg", "Runway markings", "airports", "PHAK ch. 14"),
  d("airport", "03-hold-short.svg", "Runway holding position", "airports", "PHAK ch. 14"),
  d("airport", "04-airport-signs.svg", "Airport signs", "airports", "PHAK ch. 14"),
  d("airport", "05-vasi.svg", "Two-bar VASI", "airports", "PHAK ch. 14"),
  d("performance", "01-arm-moment.svg", "Arm and moment", "performance", "PHAK ch. 10"),
  d("performance", "02-cg-envelope.svg", "CG limits envelope", "performance", "PHAK ch. 10"),
  d("performance", "03-cg-effects.svg", "Effects of forward and aft CG", "performance", "PHAK ch. 5"),
  d("performance", "04-density-altitude.svg", "Density altitude", "performance", "PHAK ch. 11"),
  d("performance", "05-takeoff-landing-factors.svg", "Takeoff and landing distance factors", "performance", "PHAK ch. 11"),
  d("weight-balance", "01-datum-arm-moment-cg.svg", "Weight and balance terms: datum, arm, moment, CG", "performance", "PHAK ch. 10"),
  d("weight-balance", "02-computing-cg.svg", "Computing the loaded weight and CG", "performance", "PHAK ch. 10"),
  d("weight-balance", "03-cg-limits-forward-aft.svg", "CG limits: forward, aft, and what happens outside", "performance", "PHAK ch. 10"),
  d("weight-balance", "04-weight-terms.svg", "Weight terms: empty weight, useful load, payload, ramp, takeoff, landing", "performance", "PHAK ch. 10"),
  d("weight-balance", "05-shift-add-remove-weight.svg", "Shifting, adding and removing weight", "performance", "PHAK ch. 10"),
  d("climb-speeds", "01-vx-vs-vy.svg", "Best angle and best rate of climb: Vx and Vy", "performance", "PHAK ch. 11"),
  d("climb-speeds", "02-vx-vy-with-altitude.svg", "Vx and Vy as altitude increases", "performance", "PHAK ch. 11"),
  d("climb-speeds", "03-power-thrust-excess.svg", "Power available, power required and excess power", "performance", "PHAK ch. 11"),
  d("climb-speeds", "04-key-v-speeds.svg", "Key V-speeds, as PHAK defines them", "performance", "PHAK ch. 11"),
  d("climb-speeds", "05-reading-takeoff-distance-chart.svg", "Reading a takeoff distance table", "performance", "PHAK ch. 11"),
  d("aeromed", "01-hypoxia-types.svg", "Four types of hypoxia", "general", "PHAK ch. 17"),
  d("aeromed", "02-spatial-disorientation.svg", "Spatial disorientation and vestibular illusions", "general", "PHAK ch. 17"),
  d("aeromed", "03-optical-illusions.svg", "Optical illusions on approach", "general", "PHAK ch. 17"),
  d("aeromed", "04-co-hyperventilation.svg", "Carbon monoxide and hyperventilation versus hypoxia", "general", "PHAK ch. 17"),
  d("aeromed", "05-fit-to-fly.svg", "Fit to fly: IMSAFE, alcohol, drugs and scuba diving", "general", "PHAK ch. 17"),
  d("vision", "01-ear-pressure.svg", "Ears and pressure: climb versus descent", "general", "PHAK ch. 17"),
  d("vision", "02-sinus-block.svg", "Sinus block", "general", "PHAK ch. 17"),
  d("vision", "03-eye-rods-cones.svg", "The eye: rods, cones and the blind spot", "general", "PHAK ch. 17"),
  d("vision", "04-night-vision.svg", "Night vision: dark adaptation and protection", "general", "PHAK ch. 17"),
  d("vision", "05-scanning-off-center.svg", "Night scanning, off-center viewing, empty-field myopia", "general", "PHAK ch. 17"),
  d("documents", "01-documents-on-board.svg", "Aircraft documents: what PHAK says about the paperwork", "regulations", "PHAK ch. 9"),
  d("documents", "02-inspections.svg", "Required inspections: annual, 100-hour and the other checks", "regulations", "PHAK ch. 9"),
  d("documents", "03-airworthiness-directives.svg", "Airworthiness Directives (ADs): what they are and how compliance is recorded", "regulations", "PHAK ch. 9"),
  d("documents", "04-maintenance-repairs.svg", "Preventive maintenance, repairs and alterations: who may do what", "regulations", "PHAK ch. 9"),
  d("documents", "05-inoperative-equipment.svg", "Inoperative equipment: the decision flow without an MEL, and MEL basics", "regulations", "PHAK ch. 9"),
  d("traffic", "01-vortex-formation-behavior.svg", "Wingtip vortices: how they form and where they go", "airports", "PHAK ch. 14"),
  d("traffic", "02-vortex-strength.svg", "Which aircraft make the strongest wake", "airports", "PHAK ch. 14"),
  d("traffic", "03-wake-avoidance-landing-takeoff.svg", "Avoiding wake behind a larger aircraft", "airports", "PHAK ch. 14"),
  d("traffic", "04-day-traffic-scanning.svg", "Scanning for traffic by day", "general", "PHAK ch. 14"),
  d("traffic", "05-clearing-procedures.svg", "Clearing procedures", "general", "PHAK ch. 14"),
  d("radio-atc", "01-radio-license-equipment.svg", "Radio license and VHF radio equipment: what PHAK says", "communications", "PHAK ch. 14"),
  d("radio-atc", "02-lost-communication.svg", "Lost communication: what to do when the radio fails", "communications", "PHAK ch. 14"),
  d("radio-atc", "03-atis-before-contact.svg", "ATIS: listen before you call the tower", "communications", "PHAK ch. 14"),
  d("radio-atc", "04-radar-traffic-advisories.svg", "Radar traffic advisories: how traffic is called by clock position", "communications", "PHAK ch. 14"),
  d("radio-atc", "05-transponder-radar.svg", "Radar, transponder and ADS-B: what ATC sees", "communications", "PHAK ch. 14"),
  d("certificates", "01-certificate-types.svg", "Pilot certificates: what each one allows", "regulations", "PHAK ch. 1"),
  d("certificates", "02-student-pilot-steps.svg", "From student pilot to the practical test", "regulations", "PHAK ch. 1"),
  d("certificates", "03-faa-organisation.svg", "The FAA: rules, places and who you deal with", "regulations", "PHAK ch. 1"),
  d("certificates", "04-aircraft-categories.svg", "Aircraft types and groupings as PHAK describes them", "general", "PHAK ch. 1"),
  d("certificates", "05-flight-school-cfi.svg", "Finding a flight school and a CFI", "general", "PHAK ch. 1"),
];

const TOPIC_ORDER = Object.keys(TOPIC_LABELS) as Topic[];

export function diagramsForTopic(topic: Topic): Diagram[] {
  return DIAGRAMS.filter((diagram) => diagram.topic === topic);
}

/** Topics that have diagrams, in the app's topic order. */
export function diagramsByTopic(): Array<{ topic: Topic; label: string; diagrams: Diagram[] }> {
  return TOPIC_ORDER.map((topic) => ({ topic, label: TOPIC_LABELS[topic], diagrams: diagramsForTopic(topic) }))
    .filter((group) => group.diagrams.length > 0);
}

/** The line shown under a diagram. */
export function diagramSourceLine(diagram: Diagram): string {
  const from = diagram.source.startsWith("PHAK ")
    ? `the FAA Pilot's Handbook (PHAK), ${diagram.source.slice(5)}`
    : `the FAA ${diagram.source}`;
  return `Drawn from ${from}. Study aid: check with your instructor.`;
}

/**
 * Make one inline copy of a diagram safe to sit beside others on a page: ids
 * (and what points at them) get `prefix`, and the file's own style rules only
 * apply inside `.${prefix without the dash}`. Visible text is untouched.
 */
export function scopeDiagramSvg(svg: string, prefix: string): string {
  const scope = prefix.replace(/-$/, "");
  return svg
    .replace(/<\?xml[^>]*\?>\s*/, "")
    .replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (_all, attrs: string, css: string) =>
      `<style${attrs}>${css.replace(/([^{}]+)\{/g, (_rule, selectors: string) =>
        selectors.split(",").map((s) => `.${scope} ${s.trim()}`).join(",") + "{")}</style>`)
    .replace(/\bid="([^"]+)"/g, (_m, id: string) => `id="${prefix}${id}"`)
    .replace(/\baria-(labelledby|describedby)="([^"]+)"/g, (_m, name: string, ids: string) =>
      `aria-${name}="${ids.split(/\s+/).map((id) => prefix + id).join(" ")}"`)
    .replace(/\b((?:xlink:)?href)="#([^"]+)"/g, (_m, name: string, id: string) => `${name}="#${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_m, id: string) => `url(#${prefix}${id})`);
}
