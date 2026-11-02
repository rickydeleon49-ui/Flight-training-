/** One active viewer; closing also invalidates an IPC read still in flight. */
export interface PdfViewerState { title: string; url?: string; error?: string }
let state: PdfViewerState | null = null;
let generation = 0;
const listeners = new Set<() => void>();
export const pdfViewerSnapshot = () => state;
export const subscribePdfViewer = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
function publish(next: PdfViewerState | null) {
  state = next;
  listeners.forEach(listener => listener());
}
export function closePdfViewer() {
  generation++;
  if (state?.url) URL.revokeObjectURL(state.url);
  publish(null);
}
export async function openInAppViewer(title: string, load: () => Promise<string>): Promise<void> {
  closePdfViewer();
  const current = generation;
  publish({ title });
  try {
    const url = await load();
    if (generation !== current) URL.revokeObjectURL(url);
    else publish({ title, url });
  } catch {
    if (generation === current) publish({ title, error: "That PDF could not be opened. Please try again." });
  }
}
