import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";

import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import { isTauri } from "@/data";
import type { AiStudySet, StudyMaterial } from "@/domain/types";
import { MAX_PDF_BYTES } from "@/logic/aiLimits";
import { describeReadiness } from "@/logic/offlineReadiness";
import { immediateSource } from "@/logic/splitLineage";
import { formatFileSize, listPdfStudyKitJobs } from "@/services/documents";
import { fileIdentity, offlineContentReadiness, offlineStudyEnabled, type OfflineReadiness } from "@/services/offlineContent";
import { useMaterialNavigation, useNavigationController } from "@/state/navigation/useDocumentNavigation";

// Mirrors extraction/worker.rs. This is the text reader's limit, not Google's.
const MAX_TEXT_INPUT_BYTES = 128 * 1024 * 1024;
const TIPS_KEY = "hfd:material-start-here:hidden";
type KitJob = Awaited<ReturnType<typeof listPdfStudyKitJobs>>[number];

interface Props {
  material: StudyMaterial;
  materials: readonly StudyMaterial[];
  studySet?: AiStudySet;
  geminiDraftWaiting: boolean;
  fileMissing: boolean;
}

/** Only the existing status APIs; never starts text preparation or generation. */
export function MaterialStartHere(props: Props) {
  const pdf = (props.material.originalFileName ?? props.material.filePath ?? "").toLowerCase().endsWith(".pdf");
  return pdf ? <PdfStartHere key={fileIdentity(props.material)} {...props} /> : null;
}

function PdfStartHere({ material, materials, studySet, geminiDraftWaiting, fileMissing }: Props) {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(TIPS_KEY) === "1"; } catch { return false; }
  });
  const contentId = useId();
  const [readiness, setReadiness] = useState<OfflineReadiness | null>(null);
  const [kit, setKit] = useState<KitJob | null>(null);
  const [kitChecked, setKitChecked] = useState(false);
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
      setKitChecked(jobs.status === "fulfilled");
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
  const tooLargeForText = (material.fileSize ?? 0) > MAX_TEXT_INPUT_BYTES;
  const textRead = readiness?.state === "searchable";
  const partial = readiness?.state === "partial";
  const kitWaiting = kit?.stage === "received";
  const waiting = kitWaiting || geminiDraftWaiting;
  const unavailable = !desktop ? "Works in the desktop app" : !material.filePath ? "Attach a PDF file first" : fileMissing ? "Restore this PDF's file first" : null;
  const textState = textRead ? "Done" : unavailable ?? (tooLargeForText ? "Too large to read in one piece" : !extraction ? "Text reading isn't available in this version" : readiness?.state === "notPrepared" ? "Do this next" : readiness ? describeReadiness(readiness).label : "Text status couldn't be checked yet");
  const makeState = waiting || studySet ? "Done" : unavailable ?? (kit ? "Check your earlier kit below" : large ? "Open a study-size part first" : !kitChecked ? "Kit status couldn't be checked yet" : "Do this next");
  const reviewState = waiting ? "Do this next" : studySet ? "Done" : "Make a kit or guide first";
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
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader title="Start here" eyebrow="Your PDF, one step at a time" action={
        <Button size="small" variant="ghost" aria-expanded={!hidden} aria-controls={contentId} onClick={() => {
          const next = !hidden;
          setHidden(next);
          try { localStorage.setItem(TIPS_KEY, next ? "1" : "0"); } catch { /* Tips still work without storage. */ }
        }}>{hidden ? "Show tips" : "Hide tips"}</Button>
      } />
      {!hidden ? <CardBody><div id={contentId} className="stack stack--4">
        <p className="small muted">Start with a chapter you want to study. You can come back to any step.</p>
        <ol className="stack stack--4 material-start-steps" aria-label="PDF study steps">
          <li>
            <p className="small strong">Choose a study-size PDF <span className="tiny muted">— {parts.length || !large ? "Done" : unavailable ?? "Do this next"}</span></p>
            <p className="tiny muted">{parts.length ? "You already have parts in your library. Open one to study it; they may be from an earlier copy of this file." : large ? `This PDF is large (${[material.fileSize !== null ? formatFileSize(material.fileSize) : null, pages ? `${pages.toLocaleString()} pages` : null].filter(Boolean).join(", ")}). Split it into study-size parts or take out one chapter, then study the parts.` : "Choose a chapter to focus on, or study this PDF as it is."} Google reads up to 50 MB or 1,000 pages; on-Mac text reading accepts up to 128 MB.</p>
            {parts[0] ? <Link className="button button--secondary button--small" to={`/study/${encodeURIComponent(parts[0].id)}`}>Open first part: {parts[0].title}</Link> : <Button size="small" variant="secondary" onClick={() => jump("material-file-actions")} disabled={Boolean(unavailable)}>See split and open options</Button>}
          </li>
          <li>
            <p className="small strong">Read this PDF's text on this Mac <span className="tiny muted">— {textState}</span></p>
            <p className="tiny muted">Reading the text enables offline search and supplies the study kit. Nothing is sent anywhere.{tooLargeForText ? " Split this PDF first, then read a part's text." : partial ? ` Only ${readiness.searchable} of ${readiness.pages} pages could be read.` : ""}</p>
            <Button size="small" variant="secondary" disabled={Boolean(unavailable) || !extraction || tooLargeForText} onClick={() => jump("material-offline-study")}>See text reading status</Button>
          </li>
          <li>
            <p className="small strong">Make a study kit or guide <span className="tiny muted">— {makeState}</span></p>
            <p className="tiny muted">The study kit uses readable PDF text on this Mac, with no internet. Gemini creates an AI guide and sends this file to Google after you confirm.</p>
            <div className="row row--wrap">
              <Button size="small" variant="secondary" disabled={Boolean(unavailable)} onClick={() => jump("material-pdf-kit")}>Go to study kit</Button>
              <Button size="small" variant="secondary" disabled={Boolean(unavailable)} onClick={() => jump("material-study-guide")}>Go to Gemini guide</Button>
            </div>
          </li>
          <li>
            <p className="small strong">Review and save what you want to keep <span className="tiny muted">— {reviewState}</span></p>
            <p className="tiny muted">Check the draft, then save your choices. Find your guide and flashcards below on this material's page in Study Library, and questions under Practice test. AI material is a study aid to check against FAA guidance and your instructor.</p>
            <Button size="small" variant="secondary" disabled={!waiting && !studySet} onClick={() => jump(kitWaiting ? "material-pdf-kit" : "material-study-guide")}>{waiting ? "Go to draft review" : "Go to saved study guide"}</Button>
          </li>
        </ol>
        {history.length ? <div className="stack stack--2"><p className="small strong">What's been done with this PDF</p><ul className="tiny muted">{history.map(line => <li key={line}>{line}</li>)}</ul></div> : null}
      </div></CardBody> : null}
    </Card>
  );
}
