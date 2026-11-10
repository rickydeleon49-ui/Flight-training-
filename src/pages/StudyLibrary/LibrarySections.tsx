import type { DragEvent, ReactNode } from "react";

import { Button } from "@/components/ui";
import type { StudyMaterial } from "@/domain/types";
import type { LibrarySection } from "@/logic/libraryFolders";

export const SECTION_PAGE_SIZE = 100;

/** A header id that is safe in a selector. */
export function sectionDomId(viewKey: string): string {
  return `library-section-${viewKey.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/**
 * The sectioned views (By folder, By topic, By type). Sections are built by
 * the caller from logic/libraryFolders; this only draws them. The caller
 * passes `renderBook` so a card and its chapter toggle look exactly as in
 * the Everything view.
 */
export function LibrarySections({
  view,
  sections,
  closed,
  onToggle,
  limits,
  onShowMore,
  hideEmpty,
  renderBook,
  gridClass = "material-grid",
  headerActions,
  flashKey,
  headDrop,
}: {
  view: string;
  sections: LibrarySection[];
  closed: ReadonlySet<string>;
  onToggle: (viewKey: string) => void;
  limits: Record<string, number>;
  onShowMore: (viewKey: string, next: number) => void;
  hideEmpty: boolean;
  renderBook: (material: StudyMaterial) => ReactNode;
  gridClass?: string;
  /** Extra controls beside a section header, such as a folder's actions menu. */
  headerActions?: (section: LibrarySection, index: number) => ReactNode;
  /** A section whose header is highlighted for a moment (where a move went). */
  flashKey?: string | null;
  /** Mac drag in Arrange: headers take drops (move to the end of that section). */
  headDrop?: {
    overKey: string | null;
    onDragOver: (event: DragEvent<HTMLElement>, section: LibrarySection, viewKey: string) => void;
    onDragLeave: (event: DragEvent<HTMLElement>) => void;
    onDrop: (event: DragEvent<HTMLElement>, section: LibrarySection) => void;
  };
}) {
  return (
    <div className="library__sections">
      {sections.map((section, sectionIndex) => {
        const viewKey = `${view}:${section.key}`;
        if (hideEmpty && section.items.length === 0) return null;
        const open = !closed.has(viewKey);
        const limit = limits[viewKey] ?? SECTION_PAGE_SIZE;
        const shown = section.items.slice(0, limit);
        const id = sectionDomId(viewKey);
        return (
          <section key={viewKey} className="library__section" aria-labelledby={id}>
            <div
              className={`library__section-head${flashKey === viewKey ? " library__section-head--flash" : ""}${headDrop?.overKey === viewKey ? " library__section-head--drop" : ""}`}
              onDragOver={headDrop ? (e) => headDrop.onDragOver(e, section, viewKey) : undefined}
              onDragLeave={headDrop ? headDrop.onDragLeave : undefined}
              onDrop={headDrop ? (e) => headDrop.onDrop(e, section) : undefined}
            >
            <h2 className="library__section-title">
              <button
                type="button"
                id={id}
                className="library__section-header"
                aria-expanded={open}
                onClick={() => onToggle(viewKey)}
              >
                <span aria-hidden="true">{open ? "▾" : "▸"}</span>{" "}
                {section.title} ({section.items.length.toLocaleString()})
              </button>
            </h2>
            {headerActions?.(section, sectionIndex)}
            </div>
            {open ? (
              section.items.length === 0 ? (
                <p className="small muted">Empty folder</p>
              ) : (
                <>
                  <div className={gridClass}>{shown.map(renderBook)}</div>
                  {section.items.length > limit ? (
                    <div className="library__more">
                      <Button onClick={() => onShowMore(viewKey, limit + SECTION_PAGE_SIZE)}>
                        Show {SECTION_PAGE_SIZE} more in {section.title}
                      </Button>
                    </div>
                  ) : null}
                </>
              )
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
