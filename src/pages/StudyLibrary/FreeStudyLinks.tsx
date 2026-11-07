import { useState } from "react";
import { Card, CardBody } from "@/components/ui";
import { ChevronRightIcon } from "@/components/ui/Icons";
import { openExternalLink } from "./openExternalLink";

export const FREE_STUDY_LINKS = [
  { title: "Free Pilot Training (YouTube)", why: "Free video lessons for the private pilot checkride.", url: "https://www.youtube.com/channel/UCRgBfZ1wb8K7vX949qtWIlQ" },
  { title: "Cyndy Hollman (YouTube)", why: "A flight instructor explaining topics in plain words.", url: "https://www.youtube.com/channel/UCQMrUsKrhTIx94S9JgkFM2w" },
  { title: "FlightInsight", why: "Short pilot lessons and explainers.", url: "https://www.flight-insight.com/" },
  { title: "Sporty's free FAA practice tests", why: "Free practice questions for the FAA knowledge test.", url: "https://www.sportys.com/learn-to-fly/faa-private-pilot-test-prep.html" },
  { title: "MIT Private Pilot Ground School", why: "A full ground school course from MIT, free.", url: "https://ocw.mit.edu/courses/16-687-private-pilot-ground-school-january-iap-2019/pages/lecture-notes/" },
  { title: "CFI Notebook", why: "Clear notes on many flight training topics.", url: "https://www.cfinotebook.net/" },
  { title: "The Finer Points podcast", why: "Listen and learn about flying on the go.", url: "https://www.learnthefinerpoints.com/podcast" },
  { title: "FAA From the Flight Deck", why: "Official FAA safety videos for pilots.", url: "https://www.faa.gov/flight_deck" },
  { title: "NOAA JetStream weather school", why: "Free weather lessons from the weather service.", url: "https://www.noaa.gov/jetstream" },
  { title: "FAASTeam / WINGS safety courses", why: "Free FAA safety courses for pilots.", url: "https://www.faasafety.gov/" },
] as const;

export function FreeStudyLinks() {
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  return <div style={{ marginBottom: "var(--space-4)" }}><Card>
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="card__header" aria-expanded={open} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <h2 className="card__title" style={{ display: "inline" }}>More free study help</h2>{" "}
        <span className="small muted">optional</span>
        <ChevronRightIcon size={16} aria-hidden="true" data-testid="free-links-chevron"
          style={{ marginLeft: "auto", transition: "transform 0.15s", transform: open ? "rotate(-90deg)" : "rotate(90deg)" }} />
      </summary>
      <CardBody><div className="stack stack--3">
        <ul className="stack stack--3">{FREE_STUDY_LINKS.map((link) => <li key={link.url}>
          <a href={link.url} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: "anywhere" }}
            onClick={(event) => { event.preventDefault(); setError(""); openExternalLink(link.url).catch(() => setError("That link couldn't be opened. Please try again.")); }}>{link.title}</a>
          <span className="small muted"> {link.why}</span>
        </li>)}</ul>
        {error ? <p role="alert" className="field__error">{error}</p> : null}
      </div></CardBody>
    </details>
  </Card></div>;
}
