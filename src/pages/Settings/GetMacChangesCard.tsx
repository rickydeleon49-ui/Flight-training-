import { useState } from "react";

import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import { backupErrorMessage } from "@/services/backups";
import { macChangesCounts } from "@/services/iphone";
import { useAppData } from "@/state/AppDataContext";
import { SyncRow } from "./SyncRow";
import { chooseMacChangesFile, getMacChanges, macChangesSentence } from "@/services/macChanges";

/** One button that brings in the file of changes the Mac saved. */
export function GetMacChangesCard({ variant = "card" }: { variant?: "card" | "row" } = {}) {
  const { refresh } = useAppData();
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const bringIn = async () => {
    setProblem(null);
    setBusy(true);
    try {
      const path = await chooseMacChangesFile();
      if (!path) return;
      const got = await getMacChanges(path);
      setLine(macChangesSentence(got, macChangesCounts(got)));
      if (got.outcome !== "alreadyIn") {
        // The lists on screen still hold the old wording. A failed reload must
        // not hide the "Brought in" line or claim the import failed.
        try {
          await refresh();
        } catch {
          /* the import itself worked */
        }
      }
    } catch (error) {
      setLine(null);
      setProblem(backupErrorMessage(error, "That file couldn't be brought in. Nothing on this phone was changed."));
    } finally {
      setBusy(false);
    }
  };

  if (variant === "row") {
    return (
      <SyncRow
        title="Get changes from my Mac"
        headingId="get-mac-changes"
        meta="On your Mac, open Settings → Send changes to my iPhone, then choose that file."
        action={<Button variant="ghost" onClick={bringIn} disabled={busy}>{busy ? "Bringing in…" : "Choose the file from my Mac"}</Button>}
      >
        {line ? <p className="small" role="status">{line}</p> : null}
        {problem ? <p className="small" role="alert">{problem}</p> : null}
      </SyncRow>
    );
  }

  return (
    <Card variant="grouped">
      <CardHeader
        title="Get changes from my Mac"
        headingId="get-mac-changes"
        eyebrow="What you changed on your Mac"
        action={
          <Button size="small" variant="primary" onClick={bringIn} disabled={busy}>
            {busy ? "Bringing in…" : "Choose the file from my Mac"}
          </Button>
        }
      />
      <CardBody>
        <div className="stack stack--4">
          <p className="small">
            On your Mac, open Settings → Send changes to my iPhone. Then choose that file here. Your work on this phone stays.
          </p>
          {line ? (
            <p className="small" role="status">
              {line}
            </p>
          ) : null}
          {problem ? (
            <p className="small" role="alert">
              {problem}
            </p>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
