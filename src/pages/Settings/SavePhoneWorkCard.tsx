import { useCallback, useEffect, useState } from "react";

import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import {
  backupErrorMessage, savedPhoneWorkSentence, savePhoneWork, unsavedPhoneWork,
  unsavedPhoneWorkCounts, unsavedPhoneWorkTotal, type UnsavedPhoneWork,
} from "@/services/backups";

export function SavePhoneWorkCard() {
  const [work, setWork] = useState<UnsavedPhoneWork | null>(null);
  const [checkProblem, setCheckProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedLine, setSavedLine] = useState<string | null>(null);
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

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setSavedLine(null);
    try {
      const saved = await savePhoneWork();
      setSavedLine(savedPhoneWorkSentence(saved));
      await check();
    } catch (error) {
      setProblem(backupErrorMessage(error, "Your phone work could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  const counts = work ? unsavedPhoneWorkCounts(work) : null;
  return (
    <Card>
      <CardHeader title="Save my phone work" eyebrow="A copy of what you did on this phone" />
      <CardBody>
        {checkProblem ? <p role="alert">{checkProblem}</p>
          : work ? <p>{unsavedPhoneWorkTotal(work) > 0 && counts
            ? `This phone has ${counts} that ${unsavedPhoneWorkTotal(work) === 1 ? "isn't" : "aren't"} saved anywhere else yet.`
            : "Everything you did on this phone is saved."}</p> : null}
        <Button variant="primary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save my phone work"}
        </Button>
        {savedLine ? <p role="status">{savedLine}</p> : null}
        {problem ? <p role="alert">{problem}</p> : null}
      </CardBody>
    </Card>
  );
}
