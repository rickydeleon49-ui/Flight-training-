import { useEffect, useState } from "react";
import { getGeminiStatus } from "@/services/gemini";
import { Card, CardBody, CardHeader } from "@/components/ui";

/**
 * STUDY-HOWTO-01: the general "how to study a PDF" steps and a short tour of
 * the Study Library. Generic on purpose: no per-material status and no
 * buttons that need a material. Each tour line names a real control; the
 * test checks every `label` against the rendered Study Library.
 */

const PDF_STEPS: Array<{ title: string; text: string }> = [
  {
    title: "Choose a study-size PDF",
    text: "Choose a chapter to focus on, or study a PDF as it is. Gemini reads up to 50 MB or 1,000 pages, whichever comes first. A bigger PDF can be split into parts on its page.",
  },
  {
    title: "Create a study guide",
    text: "Her Flight Deck sends the file to Google after you confirm. It builds your guide section by section; the completed draft waits for you to save it.",
  },
  {
    title: "Create flashcards",
    text: "Create key flashcards to practice recall. You choose how many cards you want, then check the front and back.",
  },
  {
    title: "Try a practice test (optional)",
    text: "Ask Gemini for multiple-choice questions from the PDF, then check the answers and explanations against your source.",
  },
  {
    title: "Review and save",
    text: "Check the draft before saving it. Your saved study guide stays on that material's page in Study Library. AI material is a study aid to check against FAA guidance and your instructor.",
  },
];

/** How a tour line's control is found on the Library tab. */
export type HowToControl = "tab" | "link" | "button" | "field" | "heading" | "disclosure";

export interface HowToItem { label: string; control: HowToControl; text: string }

export const STUDY_LIBRARY_TOUR: Array<{ title: string; items: HowToItem[] }> = [
  {
    title: "Tabs",
    items: [
      { label: "Library", control: "tab", text: "all your materials." },
      { label: "Review due", control: "tab", text: "flashcards that are ready to review today." },
      { label: "History", control: "tab", text: "the flashcard reviews you've done, with a link to your practice test scores." },
      { label: "How to", control: "tab", text: "this page." },
    ],
  },
  {
    title: "Buttons at the top",
    items: [
      { label: "Homework", control: "link", text: "your homework activities, at your pace." },
      { label: "Add material", control: "button", text: "add a PDF, note or handout to your library." },
      { label: "More", control: "disclosure", text: "opens two less-used choices: Import study packet… and Export handout…." },
      { label: "Import study packet…", control: "button", text: "in More: bring in a study packet file someone made for you." },
      { label: "Export handout…", control: "button", text: "in More: save study material as a handout to print or share." },
    ],
  },
  {
    title: "Finding things",
    items: [
      { label: "Search your library", control: "field", text: "type a word to find materials." },
      { label: "Filter by topic", control: "field", text: "show one topic, like weather." },
      { label: "Filter by material type", control: "field", text: "show one kind of material." },
      { label: "Sort materials", control: "field", text: "order by recently added, priority or title." },
    ],
  },
  {
    title: "Status chips",
    items: [
      { label: "Everything", control: "button", text: "every material." },
      { label: "Next Up", control: "button", text: "materials you gave Next Up priority." },
      { label: "Studying", control: "button", text: "what you're working on now." },
      { label: "Review again", control: "button", text: "worth another look. Studying and Review again can be suggested in Today's Flight Plan." },
      { label: "Confident", control: "button", text: "material you know well." },
      { label: "Reference Only", control: "button", text: "kept to look things up, not to study." },
    ],
  },
  {
    title: "Below your materials",
    items: [
      { label: "References and ACS lookup", control: "disclosure", text: "a folded shelf under your materials; open it for the two tools below." },
      { label: "FAA references", control: "heading", text: "in the shelf: optional FAA books; add your own PDFs to study them without internet." },
      { label: "Find study materials for missed topics", control: "heading", text: "in the shelf: enter the ACS codes from your knowledge-test report to find materials tagged with them." },
    ],
  },
];

export function StudyHowTo() {
  const [model, setModel] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getGeminiStatus().then(status => { if (active) setModel(status.model); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const claude = model?.startsWith("claude-");
  const steps = PDF_STEPS.map((step, index) => {
    if (!claude) return step;
    const text = index === 0
      ? "Choose a chapter to focus on, or study a PDF as it is. Claude reads up to 300 pages or 32 MB per request, whichever comes first. A bigger PDF can be split into parts on its page."
      : index === 1
        ? "Her Flight Deck sends the file to Anthropic after you confirm. It builds your guide section by section; the completed draft waits for you to save it."
        : index === 3
          ? "Ask Claude for multiple-choice questions from the PDF, then check the answers and explanations against your source."
          : step.text;
    return { ...step, text };
  });
  return (
    <div className="stack stack--5 study-howto">
      <Card>
        <CardHeader title="Study a PDF, one step at a time" />
        <CardBody><div className="stack stack--4">
          <p className="small muted">Start with a chapter you want to study. You can come back to any step.</p>
          <ol className="stack stack--4 material-start-steps" aria-label="PDF study steps">
            {steps.map(step => (
              <li key={step.title}>
                <p className="small strong">{step.title}</p>
                <p className="tiny muted">{step.text}</p>
              </li>
            ))}
          </ol>
          <p className="tiny muted">No internet? Every PDF's page has an on-Mac study kit at the bottom, under On this Mac (backup).</p>
          <p className="tiny muted">Want to search a PDF without internet? On its page, choose Read this PDF's text once. Nothing is sent anywhere.</p>
        </div></CardBody>
      </Card>

      <Card>
        <CardHeader title="Getting around the Study Library" />
        <CardBody><div className="stack stack--3">
          {STUDY_LIBRARY_TOUR.map(group => (
            <details key={group.title} className="study-howto__group">
              <summary className="small strong">{group.title}</summary>
              <ul className="tiny muted study-howto__list" aria-label={group.title}>
                {group.items.map(item => (
                  <li key={item.label}><span className="strong">{item.label}</span> — {item.text}</li>
                ))}
              </ul>
            </details>
          ))}
        </div></CardBody>
      </Card>
    </div>
  );
}
