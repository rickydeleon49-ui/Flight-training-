import { useEffect, useState, type ReactNode } from "react";
import { getGeminiStatus } from "@/services/gemini";
import { Card, CardBody, CardHeader } from "@/components/ui";

/**
 * STUDY-HOWTO-01/02: the general "how to study a PDF" steps, a short tour of
 * the Study Library and of a PDF's page, and folded help on reviewing,
 * problems, privacy and cost. Generic on purpose: no per-material status and
 * no buttons that need a material. Each tour line names a real control; the
 * tests check every checkable `label` against the rendered screens.
 *
 * Text may hold `{ai}` (Gemini or Claude) and `{company}` (Google or
 * Anthropic); a `claude` variant replaces the whole line where the two
 * providers really differ.
 */

interface Ai { ai: "Gemini" | "Claude"; company: "Google" | "Anthropic"; claude: boolean }
const fill = (text: string, ai: Ai) => text.replaceAll("{ai}", ai.ai).replaceAll("{company}", ai.company);
const say = (line: { text: string; claude?: string }, ai: Ai) => fill(ai.claude && line.claude ? line.claude : line.text, ai);

export const PDF_STEPS: Array<{ title: string; text: string; claude?: string }> = [
  {
    title: "Choose a study-size PDF",
    text: "Open a PDF from your library. A chapter is easier to study than a whole book. Gemini reads a PDF up to 50 MB or 1,000 pages, whichever comes first. A bigger PDF can be split into parts from File on its page.",
    claude: "Open a PDF from your library. A chapter is easier to study than a whole book. Claude reads up to 300 pages and about 23 MB per request. A bigger PDF can be split into parts from File on its page.",
  },
  {
    title: "Make my study kit",
    text: "On the PDF's Study tab, choose Make my study kit. One request makes a basic study guide, about 20 flashcards and about 10 practice questions. Her Flight Deck sends the PDF to {company} only after you confirm.",
  },
  {
    title: "Wait a few minutes",
    text: "It can take a few minutes. You can see how long it has been going. Cancel stops it, and nothing is saved.",
  },
  {
    title: "Check each part, then save it",
    text: "The guide, the flashcards and the questions each wait for you. Read each one, then save it or discard it. Nothing is saved until you choose.",
  },
  {
    title: "Longer PDFs",
    text: "The study kit takes up to 150 pages at a time. For a longer PDF it asks you to choose fewer pages first. Create study guide can read a longer PDF; it makes the guide in a few parts of up to 150 pages.",
  },
  {
    title: "Redo one part if you need to",
    text: "Create study guide, Make new cards with {ai} and Create practice test each make just one part. Use them when one part didn't come out right.",
  },
];

/** How a tour line's control is found. `situational` lines appear only after something is saved or in a certain state, so they aren't checked on a fresh page. */
export type HowToControl = "tab" | "link" | "button" | "field" | "heading" | "disclosure" | "situational";

export interface HowToItem { label: string; control: HowToControl; text: string; claude?: string }
export interface HowToGroup { title: string; items: HowToItem[]; tab?: "Study" | "Notes" | "More"; menu?: "File" }

export const STUDY_LIBRARY_TOUR: HowToGroup[] = [
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

/** Every card and button on a PDF's page, by where it sits. */
export const PDF_PAGE_TOUR: HowToGroup[] = [
  {
    title: "Top of the page",
    items: [
      { label: "Ask about this PDF", control: "button", text: "ask {ai} a question. It answers from the PDF's pages and shows which pages it used." },
      { label: "File", control: "disclosure", text: "a small menu for the file itself (see below)." },
      { label: "Study", control: "tab", text: "your study kit, study guide, flashcards and practice test." },
      { label: "Notes", control: "tab", text: "your own notes, questions and next steps." },
      { label: "More", control: "tab", text: "less-used tools, like studying without internet." },
    ],
  },
  {
    title: "In the File menu",
    menu: "File",
    items: [
      { label: "Edit", control: "button", text: "change the title, topic, type or priority." },
      { label: "Split automatically", control: "button", text: "cut a long PDF into study-size parts. The original stays as it is." },
      { label: "Take out a chapter", control: "button", text: "choose a first and last page and save them as a new PDF in your library." },
      { label: "Open", control: "button", text: "open the PDF in your usual PDF app." },
      { label: "Hide section tips", control: "button", text: "hide the small help lines on this page. Choose Show section tips to bring them back." },
      { label: "Delete", control: "button", text: "remove this material. It asks you first." },
    ],
  },
  {
    title: "Study tab",
    tab: "Study",
    items: [
      { label: "Make my study kit", control: "button", text: "the easiest start: a basic study guide, flashcards and practice questions from one request. You check each part before it's saved." },
      { label: "Create study guide", control: "button", text: "make only the study guide. Once you have one, this button says Regenerate." },
      { label: "Edit study guide", control: "situational", text: "after a guide is saved: change, add or remove sections in your own words." },
      { label: "Share or print", control: "situational", text: "after something is saved: print it or save it as a file." },
      { label: "Target cards", control: "field", text: "how many flashcards to ask for." },
      { label: "Make new cards with {ai}", control: "button", text: "make only the flashcards." },
      { label: "Create practice test", control: "button", text: "make only the multiple-choice questions." },
      { label: "or make a kit on this Mac", control: "button", text: "jumps to a study kit made on your Mac, without internet." },
    ],
  },
  {
    title: "Notes tab",
    tab: "Notes",
    items: [
      { label: "Personal notes", control: "heading", text: "write what you want to remember. Notes save as you type; watch for Saved." },
      { label: "Questions for my instructor", control: "heading", text: "keep questions to ask later. They also appear on your Questions page." },
      { label: "Next steps for this material", control: "heading", text: "give this material a small next step, with a date if you like." },
    ],
  },
  {
    title: "More tab",
    tab: "More",
    items: [
      { label: "Export or print", control: "situational", text: "after something is saved: the same printing and sharing as Share or print." },
      { label: "On this Mac (backup)", control: "heading", text: "tools that work without internet. Nothing is sent anywhere." },
      { label: "Read this PDF's text", control: "heading", text: "choose Read it now once. Then you can search this PDF without internet." },
      { label: "A study kit from your PDF", control: "heading", text: "choose Make a study kit from this PDF to pull key terms and an outline from the PDF's text on your Mac." },
      { label: "Related study", control: "disclosure", text: "other study items linked to this material." },
      { label: "File details", control: "heading", text: "the file's name and size, and where a part came from." },
      { label: "Details and review status", control: "heading", text: "where you are with this material." },
      { label: "Review status", control: "field", text: "choose Studying, Review again, Confident and so on." },
      { label: "Mark as reviewed today", control: "button", text: "records today as your last review." },
    ],
  },
];

export interface HowToNote { lead: string; text: string; claude?: string }

export const REVIEW_HELP: Array<{ title: string; notes: HowToNote[] }> = [
  {
    title: "Flashcards",
    notes: [
      { lead: "Review cards", text: "on a PDF's Study tab, after cards are saved. Think of the answer, then choose Show answer." },
      { lead: "Again", text: "you didn't know it. The card comes back in about 10 minutes." },
      { lead: "Hard, Good, Easy", text: "you knew it. The card comes back in a day or more; the easier it felt, the longer it waits. Each button shows its wait." },
      { lead: "Ratings aren't scores", text: "they only decide when a card comes back." },
      { lead: "Explain this", text: "after the answer shows, ask {ai} why that is the answer." },
    ],
  },
  {
    title: "Review due and History",
    notes: [
      { lead: "Review due", text: "the materials with cards ready now, most urgent first. Open one to review its cards." },
      { lead: "History", text: "every card rating, newest first, with a link to your practice test history." },
    ],
  },
  {
    title: "Practice tests",
    notes: [
      { lead: "Start practice test", text: "answer one question at a time. Not sure? Choose I don't know." },
      { lead: "After each answer", text: "you see Correct or Not quite, with an explanation." },
      { lead: "Why? Ask {ai}", text: "under a question you've answered: ask why that answer is right." },
      { lead: "See score", text: "at the end you see how many were correct. Your scores stay in practice history." },
      { lead: "Retake this test", text: "try the same questions again." },
      { lead: "View practice history", text: "your past attempts and scores for this material." },
    ],
  },
  {
    title: "Homework",
    notes: [
      { lead: "Homework", text: "the button at the top of Study Library. Add homework, then add activities: reading, cards, a quiz, a reflection, questions or a checklist. Work through them at your pace." },
    ],
  },
];

export const TROUBLE_HELP: Array<{ title: string; notes: HowToNote[] }> = [
  {
    title: "{ai} is busy",
    notes: [
      {
        lead: "It tries again by itself",
        text: "you'll see Gemini is busy — trying again. If it still can't, wait a few minutes and try again, or choose Cancel and come back later. With Most capable, it tries Gemini 3.5 Flash instead.",
        claude: "Her Flight Deck tries again briefly. If Claude is still busy, wait a little and try again, or choose Cancel and come back later.",
      },
    ],
  },
  {
    title: "The answer was cut off",
    notes: [
      { lead: "Study kit or guide", text: "nothing was saved. Choose fewer pages and try again." },
      { lead: "Ask", text: "ask a shorter or more specific question." },
    ],
  },
  {
    title: "The PDF is too big",
    notes: [
      { lead: "Split it first", text: "open File and choose Take out a chapter for the pages you're studying, or Split automatically. Then use the new part." },
    ],
  },
  {
    title: "No internet",
    notes: [
      { lead: "Saved work still opens", text: "saved guides, flashcards and practice tests work without internet." },
      { lead: "On this Mac (backup)", text: "on the More tab: Read this PDF's text once to search it, or make a study kit on your Mac. Nothing is sent anywhere." },
      { lead: "Ask", text: "your question stays. Press Ask again when you're back online." },
    ],
  },
  {
    title: "The app won't open",
    notes: [
      { lead: "Already open on this Mac", text: "Her Flight Deck is already running. Use the window that's open." },
      { lead: "Used by a newer version", text: "your study library was last opened by a newer Her Flight Deck. Install that version or newer." },
    ],
  },
];

export const PRIVACY_HELP: Array<{ title: string; notes: HowToNote[] }> = [
  {
    title: "What is sent, and when",
    notes: [
      { lead: "Only after you confirm", text: "nothing leaves this Mac until you confirm in the box that asks. Then only that PDF is sent to {company}. To send fewer pages, take out a chapter first." },
      { lead: "Ask", text: "when you press Ask, your question, the PDF and the recent conversation are sent." },
      { lead: "Never sent", text: "your personal notes, flight logs, profile and other library files." },
      {
        lead: "What {company} keeps",
        text: "Google keeps a copy of the PDF for up to 48 hours, so it doesn't have to be sent again. On the free tier Google may use it to improve its products, so send study material only.",
        claude: "Anthropic says your files are not used for training and are deleted within 30 days. Send study material only.",
      },
    ],
  },
  {
    title: "Nothing is saved until you save",
    notes: [
      { lead: "Drafts wait for you", text: "a new guide, cards or questions wait until you save or discard them." },
      { lead: "Your PDF stays the same", text: "your copy on this Mac is never changed." },
    ],
  },
  {
    title: "Standard or Most capable",
    notes: [
      {
        lead: "Settings › AI provider",
        text: "Standard (Gemini 3.5 Flash) is fast and inexpensive and works with a free Google AI Studio key. Most capable (Gemini 3.8 Flash) is a little more thorough and may use slightly more of your Google credits.",
        claude: "Claude has one choice, Claude Haiku 5.5. You can also choose Use a different provider there.",
      },
      { lead: "Fewer requests", text: "Make my study kit reads the PDF once, instead of three separate requests." },
    ],
  },
  {
    title: "A study aid, not a final word",
    notes: [
      { lead: "Check it", text: "everything AI makes is a study aid. Check it against FAA material and your instructor." },
    ],
  },
];

function Folded({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="study-howto__group">
      <summary className="small strong">{title}</summary>
      {children}
    </details>
  );
}

function TourCard({ title, groups, ai }: { title: string; groups: HowToGroup[]; ai: Ai }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody><div className="stack stack--3">
        {groups.map(group => (
          <Folded key={group.title} title={group.title}>
            <ul className="tiny muted study-howto__list" aria-label={group.title}>
              {group.items.map(item => (
                <li key={item.label}><span className="strong">{fill(item.label, ai)}</span> — {say(item, ai)}</li>
              ))}
            </ul>
          </Folded>
        ))}
      </div></CardBody>
    </Card>
  );
}

function NotesCard({ title, groups, ai }: { title: string; groups: Array<{ title: string; notes: HowToNote[] }>; ai: Ai }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody><div className="stack stack--3">
        {groups.map(group => (
          <Folded key={group.title} title={fill(group.title, ai)}>
            <ul className="tiny muted study-howto__list" aria-label={fill(group.title, ai)}>
              {group.notes.map(note => (
                <li key={note.lead}><span className="strong">{fill(note.lead, ai)}</span> — {say(note, ai)}</li>
              ))}
            </ul>
          </Folded>
        ))}
      </div></CardBody>
    </Card>
  );
}

export function StudyHowTo() {
  const [model, setModel] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getGeminiStatus().then(status => { if (active) setModel(status.model); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const claude = Boolean(model?.startsWith("claude-"));
  const ai: Ai = claude ? { ai: "Claude", company: "Anthropic", claude } : { ai: "Gemini", company: "Google", claude };
  return (
    <div className="stack stack--5 study-howto">
      <Card>
        <CardHeader title="Study a PDF, one step at a time" />
        <CardBody><div className="stack stack--4">
          <p className="small muted">Start with a chapter you want to study. You can come back to any step.</p>
          <ol className="stack stack--4 material-start-steps" aria-label="PDF study steps">
            {PDF_STEPS.map(step => (
              <li key={step.title}>
                <p className="small strong">{step.title}</p>
                <p className="tiny muted">{say(step, ai)}</p>
              </li>
            ))}
          </ol>
          <p className="tiny muted">Everything AI makes is a study aid. Check it against FAA material and your instructor.</p>
          <p className="tiny muted">No internet? Every PDF's page has an on-Mac study kit on its More tab, under On this Mac (backup).</p>
          <p className="tiny muted">Want to search a PDF without internet? On its More tab, choose Read it now under Read this PDF's text, once. Nothing is sent anywhere.</p>
        </div></CardBody>
      </Card>

      <TourCard title="Getting around the Study Library" groups={STUDY_LIBRARY_TOUR} ai={ai} />
      <TourCard title="On a PDF's page" groups={PDF_PAGE_TOUR} ai={ai} />
      <NotesCard title="Reviewing and practicing" groups={REVIEW_HELP} ai={ai} />
      <NotesCard title="When something goes wrong" groups={TROUBLE_HELP} ai={ai} />
      <NotesCard title="Privacy and cost" groups={PRIVACY_HELP} ai={ai} />
    </div>
  );
}
