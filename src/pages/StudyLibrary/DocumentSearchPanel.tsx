import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import { MATERIAL_TYPE_LABELS, type MaterialType, type StudyMaterial } from "@/domain/types";
import { coverageSentence, destinationProblem, pagePlace, searchProblem, snippetPieces } from "@/logic/offlineSearch";
import {
  OfflineSearchError,
  offlineStudyEnabled,
  searchOfflineContent,
  verifyOfflineDestination,
  type SearchGroup,
  type SearchResponse,
} from "@/services/offlineContent";
import { navigationMessage, useNavigationController } from "@/state/navigation/useDocumentNavigation";

/** Wait after typing before searching. */
export const TYPING_PAUSE_MS = 400;
/** How often to look again while the search index is being checked. */
export const SETUP_RETRY_MS = 1000;
const SETUP_RETRIES = 30;

interface Results {
  query: string;
  groups: SearchGroup[];
  coverage: SearchResponse["coverage"];
  nextOffset: number | null;
  moreBeyondCap: boolean;
}

type Phase =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "preparing" }
  | { kind: "problem"; message: string }
  | { kind: "done" };

/**
 * Search inside the text of prepared PDFs (OFFLINE-02b). Shows grouped
 * matches with highlighted snippets, says exactly what was and wasn't
 * searched, and opens a match only after re-checking its file. Renders
 * nothing unless this build opted in.
 */
export function DocumentSearchPanel(props: { query: string; materials: StudyMaterial[] }) {
  // Whether the build opted in never changes while the app runs, so a
  // dormant build does no work here at all: no hooks, no requests.
  return offlineStudyEnabled() ? <DocumentSearch {...props} /> : null;
}

function DocumentSearch({ query, materials }: { query: string; materials: StudyMaterial[] }) {
  const trimmed = query.trim();
  const ids = materials.filter((m) => m.filePath).map((m) => m.id);
  const scope = ids.join("\n");
  const [results, setResults] = useState<Results | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [notes, setNotes] = useState<Record<string, { text: string; error: boolean }>>({});
  // Only the newest request's answer is used.
  const generation = useRef(0);
  const { controller } = useNavigationController();
  const byId = new Map(materials.map((m) => [m.id, m]));

  const run = useCallback(
    async (text: string, materialIds: string[], offset: number, mine: number, attempt = 0): Promise<void> => {
      try {
        const response = await searchOfflineContent(text, materialIds, offset);
        if (generation.current !== mine) return;
        setResults((previous) => ({
          query: text,
          groups: offset > 0 && previous?.query === text ? [...previous.groups, ...response.groups] : response.groups,
          coverage: response.coverage,
          nextOffset: response.nextOffset,
          moreBeyondCap: response.moreBeyondCap,
        }));
        setPhase({ kind: "done" });
      } catch (error) {
        if (generation.current !== mine) return;
        const code = error instanceof OfflineSearchError ? error.code : "search_failed";
        if (code === "index_preparing" && attempt < SETUP_RETRIES) {
          setPhase({ kind: "preparing" });
          window.setTimeout(() => {
            if (generation.current === mine) void run(text, materialIds, offset, mine, attempt + 1);
          }, SETUP_RETRY_MS);
          return;
        }
        const message = searchProblem(code === "index_preparing" ? "index_unavailable" : code);
        setPhase(message ? { kind: "problem", message } : { kind: "idle" });
      }
    },
    [],
  );

  // Search after a pause in typing, and again whenever the filters change.
  useEffect(() => {
    const mine = ++generation.current;
    setNotes({});
    if (!trimmed) {
      setResults(null);
      setPhase({ kind: "idle" });
      return;
    }
    setPhase({ kind: "searching" });
    const timer = window.setTimeout(() => void run(trimmed, scope ? scope.split("\n") : [], 0, mine), TYPING_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [trimmed, scope, run]);

  // Stop listening for answers once the panel goes away.
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  if (!trimmed) return null;

  const showMore = () => {
    if (!results || results.nextOffset === null) return;
    const mine = ++generation.current;
    setPhase({ kind: "searching" });
    void run(results.query, ids, results.nextOffset, mine);
  };

  const open = async (materialId: string, sha: string, page: number) => {
    const key = `${materialId}:${page}`;
    setNotes((n) => ({ ...n, [key]: { text: "Checking the file…", error: false } }));
    try {
      const check = await verifyOfflineDestination(materialId, sha);
      if (check !== "ok") {
        setNotes((n) => ({ ...n, [key]: { text: destinationProblem(check), error: true } }));
        return;
      }
      if (!controller) {
        setNotes((n) => ({ ...n, [key]: { text: "Opening documents works in the desktop app.", error: true } }));
        return;
      }
      const status = await controller.request({ materialId, reference: page, provenance: "physical_index" });
      if (!status) return;
      const text =
        status.kind === "saved"
          ? `Opened in your PDF reader. Go to PDF page ${page} there; your reader may not jump to it by itself.`
          : status.kind === "opened_unsaved"
            ? `${status.message} Go to PDF page ${page} in your reader.`
            : "message" in status
              ? status.message
              : "";
      if (text) {
        setNotes((n) => ({ ...n, [key]: { text, error: status.kind === "failed" || status.kind === "refused" || status.kind === "opened_unsaved" } }));
      }
    } catch (error) {
      setNotes((n) => ({
        ...n,
        [key]: { text: error instanceof OfflineSearchError ? destinationProblem("missing") : navigationMessage(error), error: true },
      }));
    }
  };

  // Arrow keys move between results; Home and End jump to the ends.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-search-result]"));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const target =
      event.key === "ArrowDown" ? at + 1 : event.key === "ArrowUp" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null;
    if (target === null || buttons.length === 0) return;
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, target))]?.focus();
  };

  const found = results?.groups.length ?? 0;

  return (
    <Card>
      <CardHeader title="In your documents" eyebrow="Offline search" />
      <CardBody>
        <div className="stack stack--3">
          <p className="small muted" role="status">
            {phase.kind === "searching"
              ? "Searching your documents on this Mac…"
              : phase.kind === "preparing"
                ? "Getting offline search ready…"
                : phase.kind === "problem"
                  ? phase.message
                  : results
                    ? coverageSentence(results.coverage, found)
                    : ""}
          </p>
          {results && found > 0 ? (
            <div className="stack stack--3" role="list" aria-label="Matches in your documents" onKeyDown={onKeyDown}>
              {results.groups.map((group) => {
                const material = byId.get(group.materialId);
                const type = MATERIAL_TYPE_LABELS[group.materialType as MaterialType] ?? group.materialType;
                return (
                  <div role="listitem" key={group.materialId} className="stack stack--2">
                    <div>
                      <strong className="wrap-anywhere">{group.title}</strong>
                      <span className="tiny dim" style={{ display: "block" }}>
                        {type}
                        {group.originalFileName ? ` · ${group.originalFileName}` : ""}
                      </span>
                    </div>
                    {group.passages.map((passage) => {
                      const key = `${group.materialId}:${passage.pageIndex}`;
                      const note = notes[key];
                      const place = pagePlace(passage.pageIndex, material?.lineage);
                      return (
                        <div key={key} className="stack stack--1">
                          <button
                            type="button"
                            className="button button--secondary button--small"
                            data-search-result=""
                            style={{ textAlign: "left", justifyContent: "flex-start", whiteSpace: "normal" }}
                            aria-label={`${group.title}, ${place}: open the document`}
                            onClick={() => void open(group.materialId, passage.contentSha256, passage.pageIndex)}
                          >
                            <span className="stack stack--1">
                              <span className="tiny">{place}</span>
                              <span className="small wrap-anywhere">
                                {snippetPieces(passage.snippet).map((piece, i) =>
                                  piece.mark ? <mark key={i}>{piece.text}</mark> : <span key={i}>{piece.text}</span>,
                                )}
                              </span>
                            </span>
                          </button>
                          {note ? (
                            <span className={`tiny${note.error ? " field__error" : " muted"}`} role="status">
                              {note.text}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ) : null}
          {results && results.nextOffset !== null && phase.kind === "done" ? (
            <div className="row row--wrap">
              <Button size="small" onClick={showMore}>
                Show more matches
              </Button>
            </div>
          ) : null}
          {results && results.nextOffset === null && results.moreBeyondCap && phase.kind === "done" ? (
            <p className="tiny muted">Showing the best matches. Narrow your search to see more.</p>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
