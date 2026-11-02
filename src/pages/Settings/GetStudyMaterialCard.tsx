import { useEffect, useRef, useState } from "react";

import { Button, Card, CardBody, CardHeader, Dialog } from "@/components/ui";
import {
  backupErrorMessage, chooseCompleteBackup, discardIncomingBackup, exitForRestore,
  formatBackupDate, formatBytes, importPickedBackup, phoneActivitySummary, stageCompleteRestore,
  type ActivitySummary, type CompleteBackupInfo,
} from "@/services/backups";

function activitySentence(activity: ActivitySummary): string {
  const { latestReviewAt, reviewsLast7Days, attemptsLast7Days } = activity;
  if (!latestReviewAt && reviewsLast7Days === 0 && attemptsLast7Days === 0) {
    return "Nothing on this phone will be lost yet.";
  }
  const date = latestReviewAt ? new Date(latestReviewAt) : null;
  const last = date && !Number.isNaN(date.getTime())
    ? `Your last card review on this phone was ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)}`
    : "Your study activity on this phone will be replaced";
  return `${last}; ${reviewsLast7Days} reviews and ${attemptsLast7Days} tests this week will be replaced.`;
}

export function GetStudyMaterialCard() {
  const [preview, setPreview] = useState<{ info: CompleteBackupInfo; activity: ActivitySummary } | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [staged, setStaged] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(backupErrorMessage(error, "That material could not be opened. Please try again.", false));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!staged) return;
    const timer = window.setTimeout(() => {
      void exitForRestore().catch((error: unknown) => {
        setProblem(backupErrorMessage(error, "Please close Her Flight Deck and open it again.", false));
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [staged]);

  const pick = () => run(async () => {
    const path = await chooseCompleteBackup();
    if (!path) return;
    const info = await importPickedBackup(path);
    const activity = await phoneActivitySummary();
    setPreview({ info, activity });
  });
  const cancel = () => run(async () => {
    await discardIncomingBackup();
    setPreview(null);
  });
  const confirm = () => run(async () => {
    if (!preview) return;
    await stageCompleteRestore(preview.info.path);
    setPreview(null);
    setStaged(true);
  });

  return (
    <>
      <Card>
        <CardHeader title="Get my study material" eyebrow="Study on the go" />
        <CardBody>
          {staged ? (
            <p role="status">All set. Her Flight Deck will close now; open it again and your study material is there.</p>
          ) : (
            <Button variant="primary" disabled={busy || preview !== null} onClick={pick}>
              {busy ? "Opening…" : "Get my study material"}
            </Button>
          )}
          {!preview && problem ? <p role="alert">{problem}</p> : null}
        </CardBody>
      </Card>
      <Dialog
        open={preview !== null}
        title="Replace what's on this phone?"
        onClose={() => { void cancel(); }}
        dismissible={!busy}
        narrow
        footer={<>
          <Button disabled={busy} onClick={cancel}>Not now</Button>
          <Button variant="danger" disabled={busy} onClick={confirm}>Replace what's on this phone</Button>
        </>}
      >
        {preview ? <>
          <p>From your Mac · {formatBackupDate(preview.info.createdAt)} · {formatBytes(preview.info.bytes)} · {preview.info.files} files</p>
          <p>{activitySentence(preview.activity)}</p>
        </> : null}
        {problem ? <p role="alert">{problem}</p> : null}
      </Dialog>
    </>
  );
}
