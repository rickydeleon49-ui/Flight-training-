import { useState } from "react";

import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import { backupErrorMessage } from "@/services/backups";
import { choosePhoneProgressFile, importPhoneProgress, phoneProgressSentence } from "@/services/phoneProgress";
import { useAppData } from "@/state/AppDataContext";

/** One button that brings in work done on the iPhone, from the file the phone saved. */
export function GetPhoneProgressCard() {
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { refresh } = useAppData();

  const bringIn = async () => {
    setProblem(null);
    setBusy(true);
    try {
      const path = await choosePhoneProgressFile();
      if (!path) return;
      const progress = await importPhoneProgress(path);
      setLine(phoneProgressSentence(progress));
      if (progress.outcome === "added") {
        // The lists on screen still hold the old ratings. A failed reload must
        // not hide the "Brought in" line or claim the import failed.
        try {
          await refresh();
        } catch {
          /* the import itself worked */
        }
      }
    } catch (error) {
      setLine(null);
      setProblem(backupErrorMessage(error, "That file couldn't be brought in. Nothing on this Mac was changed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Get progress from my iPhone"
        headingId="get-phone-progress"
        eyebrow="What you did on your phone"
        action={
          <Button size="small" variant="primary" onClick={bringIn} disabled={busy}>
            {busy ? "Bringing in…" : "Choose the file from my iPhone"}
          </Button>
        }
      />
      <CardBody>
        <div className="stack stack--4">
          <p className="small">
            On your iPhone, open Settings → Send my progress to the Mac, then share that file to this Mac and choose it here. A full copy made with “Save a full copy instead” works too.
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
