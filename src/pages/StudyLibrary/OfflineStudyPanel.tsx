import { useCallback, useEffect, useRef, useState } from "react";

import { Badge, Button, Card, CardBody, CardHeader } from "@/components/ui";
import type { StudyMaterial } from "@/domain/types";
import { describeReadiness, MAX_OFFLINE_INPUT_BYTES } from "@/logic/offlineReadiness";
import {
  fileIdentity,
  offlineContentReadiness,
  offlineStudyEnabled,
  prepareOfflineContent,
  type OfflineReadiness,
} from "@/services/offlineContent";

/** How often a settling state (checking, preparing) is looked at again. */
export const RECHECK_MS = 1500;

/**
 * Reading a document's text on this Mac so it can be searched offline; nothing
 * is sent anywhere. Renders nothing unless this build opted in.
 */
export function OfflineStudyPanel({ material, focusRequested = false }: { material: StudyMaterial; focusRequested?: boolean }) {
  const [readiness, setReadiness] = useState<OfflineReadiness | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const enabled = offlineStudyEnabled() && Boolean(material.filePath);
  const identity = fileIdentity(material);
  const tooLarge = (material.fileSize ?? 0) > MAX_OFFLINE_INPUT_BYTES;
  // The file the panel is showing, or null once unmounted. An answer is used
  // only if it was asked about this same file: restoring or reattaching a
  // file keeps the material's id, and the old file's answer must not stick.
  const current = useRef<string | null>(identity);
  const last = useRef<OfflineReadiness["state"] | null>(null);

  // Apply a new state. A run that stopped short (a timeout, or the worker
  // failing for a reason worth retrying) isn't remembered by the cache, so it
  // shows up as "reading" turning back into "not read yet": say so.
  const apply = useCallback((next: OfflineReadiness) => {
    if (last.current === "preparing" && next.state === "notPrepared") {
      setProblem("Reading didn't finish this time. You can try again.");
    }
    last.current = next.state;
    setReadiness(next);
  }, []);

  const refresh = useCallback(async () => {
    const asked = identity;
    try {
      const [row] = await offlineContentReadiness([material.id]);
      if (current.current === asked && row) apply(row.readiness);
    } catch {
      if (current.current === asked) setProblem("Reading status couldn't be checked just now.");
    }
  }, [identity, material.id, apply]);

  // A different file (or the first look): start from nothing, then ask.
  useEffect(() => {
    current.current = identity;
    last.current = null;
    setReadiness(null);
    setProblem(null);
    setAsking(false);
    if (enabled) void refresh();
    return () => {
      current.current = null;
    };
  }, [enabled, identity, refresh]);

  const panel = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  const wording = readiness ? describeReadiness(readiness) : null;

  // While a state is still settling, look again shortly.
  useEffect(() => {
    if (!enabled || !wording?.settling) return;
    const timer = window.setTimeout(() => void refresh(), RECHECK_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, wording?.settling, readiness, refresh]);

  // Wait for the async status before moving to the actual reading control.
  // Polling and rerenders must not keep taking focus from her.
  useEffect(() => {
    if (!focusRequested) focused.current = false;
    if (!focusRequested || focused.current || readiness?.state === "checking" || !panel.current) return;
    const target = panel.current.querySelector<HTMLButtonElement>("button") ?? panel.current;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: "center" });
    focused.current = true;
  }, [focusRequested, readiness]);

  if (!enabled || !readiness || !wording || readiness.state === "unsupported") return null;

  const prepare = async () => {
    const asked = identity;
    setAsking(true);
    setProblem(null);
    try {
      const row = await prepareOfflineContent(material.id);
      if (current.current === asked) apply(row.readiness);
    } catch {
      if (current.current === asked) setProblem("Reading this PDF's text couldn't start. Please try again.");
    } finally {
      if (current.current === asked) setAsking(false);
    }
  };

  return (
    <div ref={panel} id="read-pdf-text" tabIndex={-1}>
      <Card>
        <CardHeader
          title="Read this PDF's text"
          eyebrow="On this Mac"
          action={<Badge tone={wording.tone}>{wording.label}</Badge>}
        />
        <CardBody>
          <div className="stack stack--3">
            <p className="small" role="status">
              {wording.detail}
            </p>
            {problem ? <p className="small muted">{problem}</p> : null}
            {tooLarge ? (
              <p className="small">
                This PDF is too large to read in one piece on this Mac. Split it into parts at the top of this page, then use a part.
              </p>
            ) : wording.canPrepare ? (
              <div className="row row--wrap">
                <Button size="small" variant="primary" disabled={asking} onClick={() => void prepare()}>
                  Read this PDF's text
                </Button>
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
