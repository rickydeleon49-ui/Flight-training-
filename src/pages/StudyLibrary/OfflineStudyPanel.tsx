import { useCallback, useEffect, useRef, useState } from "react";

import { Badge, Button, Card, CardBody, CardHeader } from "@/components/ui";
import type { StudyMaterial } from "@/domain/types";
import { describeReadiness } from "@/logic/offlineReadiness";
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
 * Offline study readiness for one document (OFFLINE-01b). Preparing reads
 * the document's text on this Mac so it can be searched offline; nothing is
 * sent anywhere. Renders nothing unless this build opted in.
 */
export function OfflineStudyPanel({ material }: { material: StudyMaterial }) {
  const [readiness, setReadiness] = useState<OfflineReadiness | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const enabled = offlineStudyEnabled() && Boolean(material.filePath);
  const identity = fileIdentity(material);
  // The file the panel is showing, or null once unmounted. An answer is used
  // only if it was asked about this same file: restoring or reattaching a
  // file keeps the material's id, and the old file's answer must not stick.
  const current = useRef<string | null>(identity);
  const last = useRef<OfflineReadiness["state"] | null>(null);

  // Apply a new state. A run that stopped short (a timeout, or the worker
  // failing for a reason worth retrying) isn't remembered by the cache, so it
  // shows up as "preparing" turning back into "not prepared": say so.
  const apply = useCallback((next: OfflineReadiness) => {
    if (last.current === "preparing" && next.state === "notPrepared") {
      setProblem("Preparing didn't finish this time. You can try again.");
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
      if (current.current === asked) setProblem("Offline study status couldn't be checked just now.");
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

  const wording = readiness ? describeReadiness(readiness) : null;

  // While a state is still settling, look again shortly.
  useEffect(() => {
    if (!enabled || !wording?.settling) return;
    const timer = window.setTimeout(() => void refresh(), RECHECK_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, wording?.settling, readiness, refresh]);

  if (!enabled || !readiness || !wording || readiness.state === "unsupported") return null;

  const prepare = async () => {
    const asked = identity;
    setAsking(true);
    setProblem(null);
    try {
      const row = await prepareOfflineContent(material.id);
      if (current.current === asked) apply(row.readiness);
    } catch {
      if (current.current === asked) setProblem("Preparing for offline study couldn't start. Please try again.");
    } finally {
      if (current.current === asked) setAsking(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Offline study"
        eyebrow="On this Mac"
        action={<Badge tone={wording.tone}>{wording.label}</Badge>}
      />
      <CardBody>
        <div className="stack stack--3">
          <p className="small" role="status">
            {wording.detail}
          </p>
          {problem ? <p className="small muted">{problem}</p> : null}
          {wording.canPrepare ? (
            <div className="row row--wrap">
              <Button size="small" variant="primary" disabled={asking} onClick={() => void prepare()}>
                Prepare for offline study
              </Button>
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
