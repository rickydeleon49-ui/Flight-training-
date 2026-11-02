import { useEffect, useSyncExternalStore } from "react";
import { Dialog } from "./ui/Dialog";
import { closePdfViewer, pdfViewerSnapshot, subscribePdfViewer } from "@/services/pdfViewer";
import "./pdfViewer.css";

/** Dialog uses useModalDialog, including the older WebKit fallback. */
export function PdfViewerDialog() {
  const viewer = useSyncExternalStore(subscribePdfViewer, pdfViewerSnapshot, () => null);
  useEffect(() => () => closePdfViewer(), []);
  if (!viewer) return null;
  return <Dialog open title={viewer.title} onClose={closePdfViewer} className="pdf-viewer-dialog">
    {viewer.url ? <iframe title={viewer.title} src={viewer.url} />
      : <p role={viewer.error ? "alert" : "status"}>{viewer.error ?? "Opening…"}</p>}
  </Dialog>;
}
