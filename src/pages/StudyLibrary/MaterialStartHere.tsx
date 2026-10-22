import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";

import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import { isTauri } from "@/data";
import type { AiStudySet, StudyMaterial } from "@/domain/types";
import { MAX_PDF_BYTES } from "@/logic/aiLimits";
import { immediateSource } from "@/logic/splitLineage";
import { formatFileSize, listPdfStudyKitJobs } from "@/services/documents";
import { fileIdentity, offlineContentReadiness, offlineStudyEnabled, type OfflineReadiness } from "@/services/offlineContent";
import { useMaterialNavigation, useNavigationController } from "@/state/navigation/useDocumentNavigation";

const TIPS_KEY = "hfd:material-start-here:hidden";
type KitJob = Awaited<ReturnType<typeof listPdfStudyKitJobs>>[number];

export function useMaterialTips() {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(TIPS_KEY) === "1"; } catch { return false; }
  });
  const changeHidden = (next: boolean) => {
    setHidden(next);
    try { localStorage.setItem(TIPS_KEY, next ? "1" : "0"); } catch { /* Tips still work without storage. */ }
  };
  return { hidden, setHidden: changeHidden };
}

interface Props {
  material: StudyMaterial;
  materials: readonly StudyMaterial[];
  studySet?: AiStudySet;
  geminiDraftWaiting: boolean;
  fileMissing: boolean;
  practiceTestSaved?: boolean;
  tipsHidden?: boolean;
  onTipsHiddenChange?: (hidden: boolean) => void;
}

/** Only the existing status APIs; never starts text preparation or generation. */
export function MaterialStartHere(props: Props) {
  const pdf = (props.material.originalFileName ?? props.material.filePath ?? "").toLowerCase().endsWith(".pdf");
  return pdf ? <PdfStartHere key={fileIdentity(props.material)} {...props} /> : null;
}

function PdfStartHere({ material, materials, studySet, geminiDraftWaiting, fileMissing, practiceTestSaved = false, tipsHidden, onTipsHiddenChange }: Props) {
  const tips = useMaterialTips();
  const hidden = tipsHidden ?? tips.hidden;
  const setHidden = onTipsHiddenChange ?? tips.setHidden;
  const contentId = useId();
  const [readiness, setReadiness] = useState<OfflineReadiness | null>(null);
  const [kit, setKit] = useState<KitJob | null>(null);
  const { repo, status } = useNavigationController();
  const nav = useMaterialNavigation(material.id, repo, status);
  const desktop = isTauri();
  const extraction = offlineStudyEnabled();

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    // Sequential polls also notice work done in the panels below. Never overlap
    // requests, and never let an old file's late answer describe a replacement.
    const refresh = async () => {
      const [text, jobs] = await Promise.allSettled([
        extraction ? offlineContentReadiness([material.id]) : Promise.resolve([]),
        listPdfStudyKitJobs(),
      ]);
      if (!live) return;
      setReadiness(text.status === "fulfilled" ? text.value.find(row => row.materialId === material.id)?.readiness ?? null : null);
      setKit(jobs.status === "fulfilled" ? jobs.value.filter(job => job.materialId === material.id && job.stage !== "cancelled").sort((a, b) => b.createdAt - a.createdAt)[0] ?? null : null);
      timer = setTimeout(() => void refresh(), 1500);
    };
    if (desktop && material.filePath) void refresh();
    return () => { live = false; clearTimeout(timer); };
  }, [desktop, extraction, material.id, material.filePath]);

  const parts = materials.filter(item => item.lineage && immediateSource(item.lineage).materialId === material.id)
    .sort((a, b) => immediateSource(a.lineage!).firstPage - immediateSource(b.lineage!).firstPage || a.id.localeCompare(b.id));
  const pages = nav.state?.identity?.totalPages ?? (readiness && "pages" in readiness ? readiness.pages : null) ?? material.lineage?.childPageCount;
  const large = (material.fileSize ?? 0) > MAX_PDF_BYTES || (pages ?? 0) > 1000;
  const textRead = readiness?.state === "searchable";
  const partial = readiness?.state === "partial";
  const kitWaiting = kit?.stage === "received";
  const waiting = kitWaiting || geminiDraftWaiting;
  const unavailable = !desktop ? "Works in the desktop app" : !material.filePath ? "Attach a PDF file first" : fileMissing ? "Restore this PDF's file first" : null;
  const hasGuide = Boolean(studySet && (studySet.summary || studySet.sections.length > 0));
  const hasCards = Boolean(studySet && studySet.flashcards.length > 0);
  const guideState = geminiDraftWaiting || studySet?.provider === "gemini" || hasGuide ? "Done" : unavailable ?? (large ? "Open a study-size part first" : "Do this next");
  const cardsState = hasCards ? "Done" : unavailable ?? "When you're ready";
  const practiceState = practiceTestSaved ? "Done" : unavailable ?? "When you're ready";
  const reviewState = waiting ? "Do this next" : studySet ? "Done" : "Ask for a guide first";
  const jump = (id: string) => {
    const target = document.getElementById(id);
    target?.scrollIntoView?.({ block: "start" });
    target?.focus({ preventScroll: true });
  };
  const history = [
    parts.length ? `${parts.length} saved ${parts.length === 1 ? "part" : "parts"} made from this PDF.` : null,
    material.lineage ? "This PDF is a saved part of a larger document." : null,
    textRead ? `Text read on this Mac: ${readiness.pages} pages.` : partial ? `Text read on this Mac: ${readiness.searchable} of ${readiness.pages} pages.` : null,
    kitWaiting ? "A study kit is waiting for review." : null,
    geminiDraftWaiting ? "A Gemini draft is waiting for review." : null,
    studySet ? studySet.provider === "gemini" ? "Gemini guide saved." : "Study guide saved." : null,
    practiceTestSaved ? "Practice test saved." : null,
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader title="Start here" eyebrow="Your PDF, one step at a time" action={
        <Button size="small" variant="ghost" aria-expanded={!hidden} aria-controls={contentId} onClick={() => {
          const next = !hidden;
          setHidden(next);
        }}>{hidden ? "Show tips" : "Hide tips"}</Button>
      } />
      {!hidden ? <CardBody><div id={contentId} className="stack stack--4">
        <p className="small muted">Start with a chapter you want to study. You can come back to any step.</p>
        <ol className="stack stack--4 material-start-steps" aria-label="PDF study steps">
          <li>
            <p className="small strong">Choose a study-size PDF <span className="tiny muted">— {unavailable ?? (parts.length || !large ? "Done" : "Do this next")}</span></p>
            <p className="tiny muted">{parts.length ? "You already have parts in your library. Open one to study it; they may be from an earlier copy of this file." : large ? `This PDF is large (${[material.fileSize !== null ? formatFileSize(material.fileSize) : null, pages ? `${pages.toLocaleString()} pages` : null].filter(Boolean).join(", ")}). Split it into study-size parts or take out one chapter, then study the parts.` : "Choose a chapter to focus on, or study this PDF as it is."} Gemini reads up to 50 MB or 1,000 pages, whichever comes first.</p>
            {parts[0] ? <Link className="button button--secondary button--small" to={`/study/${encodeURIComponent(parts[0].id)}`}>Open first part: {parts[0].title}</Link> : <Button size="small" variant="secondary" onClick={() => jump("material-file-actions")} disabled={Boolean(unavailable)}>See split and open options</Button>}
          </li>
          <li>
            <p className="small strong">Create a study guide <span className="tiny muted">— {guideState}</span></p>
            <p className="tiny muted">Her Flight Deck sends this file to Google after you confirm. It builds your guide section by section; the completed draft waits for you to save it.</p>
            <Button size="small" variant="secondary" disabled={Boolean(unavailable)} onClick={() => jump("material-study-guide")}>Go to study guide</Button>
          </li>
          <li>
            <p className="small strong">Create flashcards <span className="tiny muted">— {cardsState}</span></p>
            <p className="tiny muted">Create key flashcards to practice recall. You choose how many cards you want, then check the front and back.</p>
            <Button size="small" variant="secondary" disabled={Boolean(unavailable)} onClick={() => jump("material-flashcards")}>Go to flashcards</Button>
          </li>
          <li>
            <p className="small strong">Try a practice test (optional) <span className="tiny muted">— {practiceState}</span></p>
            <p className="tiny muted">Ask Gemini for multiple-choice questions from this PDF, then check the answers and explanations against your source.</p>
            <Button size="small" variant="secondary" disabled={Boolean(unavailable)} onClick={() => jump("material-practice-test")}>Go to practice test</Button>
          </li>
          <li>
            <p className="small strong">Review and save <span className="tiny muted">— {reviewState}</span></p>
            <p className="tiny muted">Check the draft before saving it. Your saved study guide stays on this material's page in Study Library. AI material is a study aid to check against FAA guidance and your instructor.</p>
            <Button size="small" variant="secondary" disabled={!waiting && !studySet && !practiceTestSaved} onClick={() => jump(geminiDraftWaiting ? "material-study-guide" : kitWaiting ? "material-pdf-kit" : "material-study-guide")}>{waiting ? "Go to draft review" : "Go to saved study guide"}</Button>
          </li>
        </ol>
        <p className="tiny muted">No internet? <a href="#material-mac-backup" onClick={event => { event.preventDefault(); jump("material-mac-backup"); }}>Use the on-Mac study kit at the bottom of this page.</a></p>
        {history.length ? <div className="stack stack--2"><p className="small strong">What's been done with this PDF</p><ul className="tiny muted">{history.map(line => <li key={line}>{line}</li>)}</ul></div> : null}
      </div></CardBody> : null}
    </Card>
  );
}
