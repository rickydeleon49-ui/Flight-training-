import { useEffect, useState } from "react";
import { inspectPdf } from "@/services/pdf";

export const SCANNED_PDF_LINE =
  "This PDF is pictures of pages, not text. Search, the study kit and Ask can’t read it. A text version from the FAA site works.";

/** One plain line, shown only when the PDF is flagged as pictures of pages. */
export function ScannedPdfLine({ flagged }: { flagged: boolean }) {
  return flagged ? <p role="status">{SCANNED_PDF_LINE}</p> : null;
}

// One check per file per app session: opening a material must not reload a large PDF every time.
const checked = new Map<string, Promise<boolean>>();
export function resetScannedPdfCache(): void { checked.clear(); }
function isMostlyPictures(filePath: string): Promise<boolean> {
  let result = checked.get(filePath);
  if (!result) {
    result = inspectPdf(filePath).then((outline) => outline.mostlyPictures === true);
    result.catch(() => checked.delete(filePath));
    checked.set(filePath, result);
  }
  return result;
}

/** Looks at a stored PDF once per session and says so if it is only pictures. */
export function ScannedPdfNote({ filePath }: { filePath: string }) {
  const [flagged, setFlagged] = useState(false);
  useEffect(() => {
    let live = true;
    setFlagged(false);
    isMostlyPictures(filePath).then(
      (value) => { if (live) setFlagged(value); },
      () => { /* browser mode or unreadable file: say nothing */ },
    );
    return () => { live = false; };
  }, [filePath]);
  return <ScannedPdfLine flagged={flagged} />;
}
