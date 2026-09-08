export interface PageRange {
  firstPage: number;
  lastPage: number;
}

export function pdfPartTitle(sourceTitle: string, index: number, total: number): string {
  return `${sourceTitle} — Part ${index + 1} of ${total}`;
}

export function pdfPartNotes(sourceTitle: string, range: PageRange): string {
  return `Pages ${range.firstPage}–${range.lastPage} of ${sourceTitle}.`;
}
