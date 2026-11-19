/** "Radio words": plain-words ATC phrases a student pilot meets. Not FAA text. */

export const RADIO_WORDS_NOTE =
  "Plain-words study aid; the FAA Pilot/Controller Glossary is the official source.";

export const RADIO_WORD_MAX_WORDS = 25;

export type RadioWord = {
  term: string;
  meaning: string;
  /** Optional one-line "you'd say / hear" example. */
  example?: string;
};

export const RADIO_WORDS: readonly RadioWord[] = [
  { term: "Wilco", meaning: "\"Will comply.\" You got the message, understand it, and will do it.", example: "Hear: \"Turn left heading 270.\" Say: \"Left 270, wilco.\"" },
  { term: "Roger", meaning: "\"I received your last transmission.\" It does not mean yes, and it does not promise you will comply.", example: "Hear: \"Traffic is a Cessna, two o'clock.\" Say: \"Roger, looking.\"" },
  { term: "Affirmative", meaning: "Yes. Use it instead of a bare \"yes\", which is easy to miss over the radio.", example: "Say: \"Affirmative, I have the ATIS.\"" },
  { term: "Negative", meaning: "No, or \"that is not correct\" or \"permission not granted.\"", example: "Say: \"Negative, I'm not able to hold short of that runway.\"" },
  { term: "Unable", meaning: "I cannot do what you asked. Say it early, and add a reason if you can.", example: "Say: \"Unable, I'm VFR and the cloud is too low.\"" },
  { term: "Say again", meaning: "Repeat what you just said. Use it when you missed part of a call.", example: "Say: \"Say again the altimeter.\"" },
  { term: "Stand by", meaning: "Wait. The controller or pilot will get back to you; it is not a yes or a no.", example: "Hear: \"Cessna 123AB, stand by.\"" },
  { term: "Squawk", meaning: "Set the transponder to the code given.", example: "Hear: \"Squawk 4521.\" Say: \"Squawk 4521.\"" },
  { term: "Ident", meaning: "Press the transponder IDENT button so the controller can pick out your radar target.", example: "Hear: \"Ident.\" Say: \"Wilco\", then press the button." },
  { term: "Squawk VFR", meaning: "Set the transponder to 1200, the usual VFR code in the U.S.", example: "Hear: \"Squawk VFR.\" Say: \"Squawk VFR, 123AB.\"" },
  { term: "Squawk standby", meaning: "Switch the transponder to standby so it stops transmitting.", example: "Hear: \"Squawk standby.\"" },
  { term: "Traffic in sight", meaning: "You see the traffic the controller called out. Say it once you really do.", example: "Say: \"Traffic in sight.\"" },
  { term: "Negative contact", meaning: "You do not see the traffic called out. Use it when you have looked and cannot find it.", example: "Say: \"Negative contact, looking.\"" },
  { term: "Cleared for the option", meaning: "You may make a touch-and-go, stop-and-go, low approach, missed approach, or full-stop landing. Your choice.", example: "Hear: \"Runway 27, cleared for the option.\"" },
  { term: "Line up and wait", meaning: "Taxi onto the runway and hold in position. It is not a takeoff clearance. Do not roll.", example: "Hear: \"Runway 27, line up and wait.\"" },
  { term: "Cleared for takeoff", meaning: "You may take off on the named runway. At a towered airport, wait for it before you start the takeoff roll.", example: "Hear: \"Runway 27, cleared for takeoff.\"" },
  { term: "Cleared to land", meaning: "You may land on the named runway. Without it, you are not cleared to land.", example: "Hear: \"Runway 27, cleared to land.\"" },
  { term: "Hold short", meaning: "Stop before the named runway, taxiway, or point. Do not cross it. Always read this back.", example: "Hear: \"Hold short of runway 27.\"" },
  { term: "Cross runway", meaning: "You may cross the named runway. Crossing a runway needs a clearance for each runway.", example: "Hear: \"Cross runway 27 at Alpha.\"" },
  { term: "Taxi via", meaning: "Follow the listed taxiways in order to the destination. Do not use others.", example: "Hear: \"Taxi to runway 27 via Alpha, Bravo.\"" },
  { term: "Progressive taxi", meaning: "Step-by-step taxi directions, given turn by turn, when you are unsure of the airport.", example: "Say: \"Request progressive taxi, unfamiliar.\"" },
  { term: "Immediately", meaning: "Do it right now. Used when a delay could cause danger, such as clearing a runway.", example: "Hear: \"Turn left immediately.\"" },
  { term: "Expedite", meaning: "Comply as fast as you can. Less sudden than \"immediately\": speed matters, but it is not a drop-everything order.", example: "Hear: \"Expedite your climb.\"" },
  { term: "Report", meaning: "Call back with the named information, when you reach it or when it is true.", example: "Hear: \"Report midfield downwind.\"" },
  { term: "Make straight-in", meaning: "Fly a straight-in final to the runway instead of entering the traffic pattern.", example: "Hear: \"Make straight-in runway 27.\"" },
  { term: "Make left traffic", meaning: "Fly the pattern with left turns, instead of the pattern normally used on that runway.", example: "Hear: \"Make left traffic runway 9.\"" },
  { term: "Extend downwind", meaning: "Fly farther along the downwind leg before turning base. Often used to space you behind other traffic.", example: "Hear: \"Extend your downwind, I'll call your base.\"" },
  { term: "Number two", meaning: "You are second in the landing or takeoff sequence. Follow the traffic ahead of you.", example: "Hear: \"Number two, follow the Skyhawk on base.\"" },
  { term: "Follow", meaning: "Fly behind the named aircraft and keep it in sight. You are responsible for spacing.", example: "Hear: \"Follow the Cessna on a left base.\"" },
  { term: "Go around", meaning: "Stop the approach or landing, climb, and fly the pattern again. A pilot or controller may call it.", example: "Hear: \"Go around.\" Say: \"Going around.\"" },
  { term: "Cleared for the approach", meaning: "You may fly the named instrument approach, using the published procedure.", example: "Hear: \"Cleared RNAV runway 27 approach.\"" },
  { term: "Radar contact", meaning: "The controller sees your radar target and has identified it as you.", example: "Hear: \"Cessna 123AB, radar contact.\"" },
  { term: "Radar service terminated", meaning: "The controller will no longer provide radar service. You are on your own for traffic watch.", example: "Hear: \"Radar service terminated, squawk VFR.\"" },
  { term: "Resume own navigation", meaning: "Radar vectors are over. Navigate yourself again, by your own means.", example: "Hear: \"Resume own navigation.\"" },
  { term: "Frequency change approved", meaning: "You may leave this controller's frequency and change to another one, such as the CTAF.", example: "Hear: \"Frequency change approved.\"" },
  { term: "Contact", meaning: "Call that facility or controller on the frequency given, and start talking to them.", example: "Hear: \"Contact tower on 118.7.\"" },
  { term: "Monitor", meaning: "Listen on that frequency only. Do not call unless told to.", example: "Hear: \"Monitor tower on 118.7.\"" },
  { term: "Maintain VFR", meaning: "Stay in VFR weather conditions. Do not go into the clouds.", example: "Hear: \"Maintain VFR.\"" },
  { term: "Maintain (altitude)", meaning: "Stay at the altitude given. If you are still climbing or descending, level off at it.", example: "Hear: \"Maintain 3,000.\"" },
  { term: "Mayday", meaning: "Distress call, said three times: you face grave, imminent danger and need immediate help.", example: "Say: \"Mayday, mayday, mayday, Cessna 123AB, engine failure.\"" },
  { term: "Pan-pan", meaning: "Urgency call, said three times: a problem exists but not grave, immediate danger.", example: "Say: \"Pan-pan, pan-pan, pan-pan, Cessna 123AB, low on fuel.\"" },
  { term: "Minimum fuel", meaning: "Fuel is low enough that any more delay may become an emergency. It is a notice, not an emergency declaration.", example: "Say: \"Cessna 123AB, minimum fuel.\"" },
  { term: "Read back", meaning: "Repeat the key parts of the clearance back, word for word, so the controller can check them.", example: "Hear: \"Read back hold short instructions.\"" },
  { term: "Readback correct", meaning: "The controller confirms you repeated the instruction right.", example: "Hear: \"Readback correct.\"" },
  { term: "I say again", meaning: "The controller is repeating something for clarity or emphasis.", example: "Hear: \"Hold short, I say again, hold short.\"" },
  { term: "ATIS / information letter", meaning: "A recorded airport report that repeats continuously. Each update gets a new letter; tell ATC the letter you have.", example: "Say: \"Information Bravo.\"" },
  { term: "Clearance void if not off by", meaning: "A departure clearance expires at the time given if you have not taken off.", example: "Hear: \"Clearance void if not off by 1430.\"" },
  { term: "Position report", meaning: "A short call giving your location, altitude, and next intentions, so others can plan around you.", example: "Say: \"Three miles north, inbound for landing.\"" },
  { term: "Say altitude", meaning: "Tell the controller your current altitude.", example: "Hear: \"Say altitude.\"" },
  { term: "Say intentions", meaning: "Tell the controller what you plan to do next.", example: "Hear: \"Say intentions.\"" },
  { term: "Request", meaning: "Ask the controller for something. Say what you want clearly, then wait for the answer.", example: "Say: \"Request flight following to Ontario.\"" },
  { term: "Flight following", meaning: "Radar traffic advisories given as workload permits. It is not a clearance and does not give separation.", example: "Say: \"Request VFR flight following.\"" },
  { term: "Traffic advisory", meaning: "Controller calls out nearby traffic, usually by clock position, distance, and altitude.", example: "Hear: \"Traffic, 12 o'clock, 3 miles, 3,500.\"" },
  { term: "Clock position", meaning: "Directions from your ground track (path over the ground), not your nose. In a crosswind, traffic may be off from where you point (AIM 4-1-15).", example: "Hear: \"Traffic, 2 o'clock.\"" },
  { term: "Winds / altimeter", meaning: "Wind direction and speed, and the pressure setting to set on your altimeter.", example: "Hear: \"Wind 270 at 8, altimeter 29.92.\"" },
  { term: "Departure frequency", meaning: "The radar controller you call after takeoff, if told to. It is a different frequency than tower.", example: "Hear: \"Contact departure on 124.3.\"" },
  { term: "Cleared into the Class Bravo", meaning: "Only Class B needs these exact words. For Class C or D, ATC answering with your call sign lets you enter.", example: "Hear: \"Cleared into the Class Bravo.\"" },
  { term: "Remain clear", meaning: "Stay out of the airspace named. It is not a clearance to enter.", example: "Hear: \"Remain clear of Class Charlie.\"" },
  { term: "Remain outside Class B", meaning: "You are not cleared into that airspace. Stay outside the boundary until told otherwise.", example: "Hear: \"Remain outside the Bravo.\"" },
  { term: "Say heading", meaning: "Tell the controller the heading you are flying now.", example: "Hear: \"Say heading.\"" },
  { term: "Fly heading", meaning: "Turn to and hold the magnetic heading given.", example: "Hear: \"Fly heading 090.\"" },
  { term: "Turn left/right heading", meaning: "Turn in the direction named to the new heading, even if the other way is shorter.", example: "Hear: \"Turn right heading 180.\"" },
  { term: "Descend and maintain", meaning: "Leave your altitude, go down, and level off at the one given.", example: "Hear: \"Descend and maintain 2,500.\"" },
  { term: "Pilot's discretion", meaning: "You may start the altitude change when you choose, and move at the rate you choose.", example: "Hear: \"Descend at pilot's discretion, maintain 4,000.\"" },
  { term: "Wake turbulence", meaning: "Every aircraft makes it in flight. Strongest behind heavy, slow, clean aircraft; it can upset smaller ones (AIM 7-4-1).", example: "Hear: \"Caution, wake turbulence.\"" },
  { term: "Cleared as filed", meaning: "You may fly the route in your flight plan exactly as filed. Do not change it.", example: "Hear: \"Cleared to Ontario as filed.\"" },
  { term: "Go ahead", meaning: "Say your message. It does not mean yes.", example: "Hear: \"Cessna 123AB, go ahead.\"" },
  { term: "Disregard", meaning: "Ignore what was last said. Do not use the earlier instruction.", example: "Hear: \"Disregard.\"" },
  { term: "How do you hear me?", meaning: "Radio check: asking how clear your transmission is.", example: "Say: \"Radio check, how do you hear me?\"" },
  { term: "Loud and clear", meaning: "Your transmission is received well.", example: "Hear: \"Reading you loud and clear.\"" },
  { term: "Verify", meaning: "Check and confirm it with the other party. Used for something that may be wrong.", example: "Hear: \"Verify you are level at 3,000.\"" },
  { term: "Advise", meaning: "Tell me. Used to ask you to give information or a decision.", example: "Hear: \"Advise when ready to copy.\"" },
  { term: "Unicom", meaning: "A non-government ground station that gives airport advice. It is not an air traffic control station.", example: "Say: \"Ontario Unicom, Skyhawk 123AB, request advisory.\"" },
  { term: "CTAF", meaning: "Common Traffic Advisory Frequency: the frequency pilots use to announce positions at airports with no tower.", example: "Say: \"Ontario traffic, Skyhawk, 5 miles west.\"" },
  { term: "Steady green (light gun)", meaning: "On the ground: cleared for takeoff. In the air: cleared to land.", example: "See: steady green from the tower." },
  { term: "Flashing green (light gun)", meaning: "On the ground: cleared to taxi. In the air: return for landing, then steady green.", example: "See: flashing green from the tower." },
  { term: "Steady red (light gun)", meaning: "On the ground: stop. In the air: give way and keep circling.", example: "See: steady red from the tower." },
  { term: "Flashing red (light gun)", meaning: "On the ground: taxi clear of the runway in use. In the air: airport unsafe, do not land.", example: "See: flashing red from the tower." },
  { term: "Flashing white (light gun)", meaning: "On the ground: return to your starting point on the airport. Not used in the air.", example: "See: flashing white from the tower." },
  { term: "Alternating red and green (light gun)", meaning: "Exercise extreme caution, on the ground or in the air.", example: "See: alternating red and green from the tower." },
] as const;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function filterRadioWords(query: string, words: readonly RadioWord[] = RADIO_WORDS): RadioWord[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...words];
  return words.filter((w) =>
    `${w.term} ${w.meaning} ${w.example ?? ""}`.toLowerCase().includes(q),
  );
}
