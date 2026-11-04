import { useEffect, useRef, useState } from "react";

import { Button, Card, CardBody, CardHeader, Dialog, WorkStatus, useElapsed } from "@/components/ui";
import {
  backupErrorMessage, chooseCompleteBackup, discardIncomingBackup, exitForRestore,
  formatBackupDate, formatBytes, importPickedBackup, phoneActivitySummary, savedPhoneWorkSentence, savePhoneWork, stageCompleteRestore,
  unsavedPhoneWork, unsavedPhoneWorkSentence, unsavedPhoneWorkTotal,
  type ActivitySummary, type CompleteBackupInfo, type UnsavedPhoneWork,
} from "@/services/backups";

import { isIOS } from "@/services/platform";

function activitySentence(activity: ActivitySummary): string {
  const { latestReviewAt, reviewsLast7Days, attemptsLast7Days } = activity;
  if (!latestReviewAt && reviewsLast7Days === 0 && attemptsLast7Days === 0) {
    return "Nothing changes on this phone until you tap Replace.";
  }
  const date = latestReviewAt ? new Date(latestReviewAt) : null;
  const last = date && !Number.isNaN(date.getTime())
    ? `Your last card review on this phone was ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)}`
    : "Your study activity on this phone will be replaced";
  return `${last}; ${reviewsLast7Days} reviews and ${attemptsLast7Days} tests this week will be replaced.`;
}

export function GetStudyMaterialCard() {
  const [preview, setPreview] = useState<{ info: CompleteBackupInfo; activity: ActivitySummary; unsaved: UnsavedPhoneWork | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<"opening" | "copying" | null>(null);
  const elapsed = useElapsed(progress !== null);
  const locked = useRef(false);
  const ios = isIOS();
  const [staged, setStaged] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [savedLine, setSavedLine] = useState<string | null>(null);

  const run = async (action: () => Promise<void>, phase: "opening" | "copying" | null = null) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setProgress(phase);
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(backupErrorMessage(error, "That material could not be opened. Please try again.", false));
    } finally {
      locked.current = false;
      setBusy(false);
      setProgress(null);
    }
  };

  useEffect(() => {
    if (!staged || ios) return;
    const timer = window.setTimeout(() => {
      void exitForRestore().catch((error: unknown) => {
        setProblem(backupErrorMessage(error, "Please close Your Flight Deck and open it again.", false));
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [staged, ios]);

  const pick = () => run(async () => {
    const path = await chooseCompleteBackup();
    if (!path) return;
    const info = await importPickedBackup(path);
    const activity = await phoneActivitySummary();
    // On a phone, a failed check counts as blocked: never offer Replace without an answer.
    let unsaved: UnsavedPhoneWork | null = null;
    if (ios) {
      try {
        unsaved = await unsavedPhoneWork();
      } catch (error) {
        setProblem(backupErrorMessage(error, "We couldn't check what's saved on this phone. Please try again.", false));
        setPreview({ info, activity, unsaved: null });
        return;
      }
    }
    setPreview({ info, activity, unsaved });
  }, "opening");
  const cancel = () => run(async () => {
    await discardIncomingBackup();
    setPreview(null);
    setSavedLine(null);
  });
  const saveFirst = () => run(async () => {
    const saved = await savePhoneWork();
    const unsaved = await unsavedPhoneWork();
    setPreview((p) => p && { ...p, unsaved });
    setSavedLine(savedPhoneWorkSentence(saved));
  });
  const blockedSentence = ios && preview
    ? (preview.unsaved ? unsavedPhoneWorkSentence(preview.unsaved) : null)
    : null;
  const blocked = ios && preview !== null && (preview.unsaved === null || unsavedPhoneWorkTotal(preview.unsaved) > 0);
  const confirm = () => run(async () => {
    if (!preview || blocked) return;
    await stageCompleteRestore(preview.info.path);
    setPreview(null);
    setStaged(true);
  }, "copying");

  return (
    <>
      <Card>
        <CardHeader title={staged ? "All set" : "Get my study material"} eyebrow="Study on the go" />
        <CardBody>
          {staged ? (
            <p role="status">{ios
              ? "Close Your Flight Deck (swipe it away) and open it again to see your study material."
              : "All set. Your Flight Deck will close now; open it again and your study material is there."}</p>
          ) : (
            <Button variant="primary" disabled={busy || preview !== null} onClick={pick}>
              {busy ? "Opening…" : "Get my study material"}
            </Button>
          )}
          {progress === "opening" ? <WorkStatus className="" phase="Opening your file…" elapsed={elapsed} /> : null}
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
          {blocked ? <Button variant="primary" disabled={busy} onClick={saveFirst}>Save my phone work first</Button> : null}
          {blocked ? null : <Button variant="danger" disabled={busy} onClick={confirm}>Replace what's on this phone</Button>}
        </>}
      >
        {preview ? <>
          <p>From your Mac · {formatBackupDate(preview.info.createdAt)} · {formatBytes(preview.info.fileBytes)} · {preview.info.files} files</p>
          {savedLine ? <p role="status">{savedLine}</p> : null}
          {blocked
            ? (blockedSentence ? <p>{blockedSentence}</p> : null)
            : <p>{activitySentence(preview.activity)}</p>}
        </> : null}
        {progress === "copying" ? <WorkStatus className="" phase="Copying your study material… this can take a minute." elapsed={elapsed} /> : null}
        {problem ? <p role="alert">{problem}</p> : null}
      </Dialog>
    </>
  );
}
