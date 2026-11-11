import { useCallback, useEffect, useState } from "react";

import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import {
  backupErrorMessage, savedPhoneWorkSentence, savePhoneWork, unsavedPhoneWork,
  unsavedPhoneWorkCounts, unsavedPhoneWorkTotal, type UnsavedPhoneWork,
} from "@/services/backups";
import { sendPhoneProgress, sentPhoneProgressSentence } from "@/services/phoneProgress";

export function PhoneProgressCard() {
  const [work, setWork] = useState<UnsavedPhoneWork | null>(null);
  const [checkProblem, setCheckProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "send" | "save">(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      setWork(await unsavedPhoneWork());
      setCheckProblem(null);
    } catch (error) {
      setCheckProblem(backupErrorMessage(error, "This phone couldn't check its work.", false));
    }
  }, []);

  useEffect(() => { void check(); }, [check]);

  const run = async (kind: "send" | "save", action: () => Promise<string>, fallback: string) => {
    if (busy) return;
    setBusy(kind);
    setProblem(null);
    setStatusLine(null);
    try {
      setStatusLine(await action());
      await check();
    } catch (error) {
      setProblem(backupErrorMessage(error, fallback));
    } finally {
      setBusy(null);
    }
  };

  const send = () => run(
    "send",
    async () => sentPhoneProgressSentence(await sendPhoneProgress()),
    "Your progress couldn't be sent. Nothing on this phone was changed.",
  );
  const saveCopy = () => run(
    "save",
    async () => savedPhoneWorkSentence(await savePhoneWork()),
    "Your phone work could not be saved.",
  );

  const counts = work ? unsavedPhoneWorkCounts(work) : null;
  return (
    <Card variant="grouped">
      <CardHeader title="Send my progress to the Mac" eyebrow="What you did on this phone" headingId="phone-progress" />
      <CardBody>
        {checkProblem ? <p role="alert">{checkProblem}</p>
          : work ? <p>{unsavedPhoneWorkTotal(work) > 0 && counts
            ? `This phone has ${counts} that ${unsavedPhoneWorkTotal(work) === 1 ? "isn't" : "aren't"} saved anywhere else yet.`
            : "Everything you did on this phone is saved."}</p> : null}
        <Button variant="primary" disabled={busy !== null} onClick={send}>
          {busy === "send" ? "Sending…" : "Send my progress to the Mac"}
        </Button>
        <p role="status" className="live-region">{statusLine}</p>
        {problem ? <p role="alert">{problem}</p> : null}
        <Button disabled={busy !== null} onClick={saveCopy}>{busy === "save" ? "Saving…" : "Save a full copy instead"}</Button>
        <p>Everything on this phone, for safekeeping.</p>
      </CardBody>
    </Card>
  );
}
