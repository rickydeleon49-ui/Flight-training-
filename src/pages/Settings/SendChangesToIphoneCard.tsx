import { useState } from "react";

import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import { backupErrorMessage, formatBytes } from "@/services/backups";
import { SyncRow } from "./SyncRow";
import { macChangesCounts, sendChangesToIphone, type SentMacChanges } from "@/services/iphone";

/** The sentence after a send: what is in the file, and where it is. */
export function sentChangesSentence(sent: SentMacChanges, viaICloud: boolean): string {
  if (sent.nothingNew) return "Nothing new to send since last time.";
  const list = macChangesCounts(sent.counts);
  const where = viaICloud
    ? `On your iPhone, open Files → iCloud Drive → Her Flight Deck and tap ${sent.fileName}.`
    : `AirDrop ${sent.fileName} to your iPhone.`;
  return `Saved${list ? `: ${list}` : ""} · ${formatBytes(sent.fileBytes)}. ${where}`;
}

/** After the first full copy: one button that saves only what changed on this Mac since. */
export function SendChangesToIphoneCard({ variant = "card" }: { variant?: "card" | "row" } = {}) {
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const send = async () => {
    setProblem(null);
    setBusy(true);
    try {
      const result = await sendChangesToIphone();
      if (!result) return;
      setLine(sentChangesSentence(result.sent, result.viaICloud));
    } catch (error) {
      setLine(null);
      setProblem(backupErrorMessage(error, "Your changes couldn't be saved. Nothing on this Mac was changed."));
    } finally {
      setBusy(false);
    }
  };

  if (variant === "row") {
    return (
      <SyncRow
        title="Send changes to my iPhone"
        headingId="send-changes-to-iphone"
        meta="Only what changed on this Mac since your last full copy."
        action={<Button variant="ghost" onClick={send} disabled={busy}>{busy ? "Saving…" : "Send changes to my iPhone"}</Button>}
      >
        {line ? <p className="small" role="status">{line}</p> : null}
        {problem ? <p className="small" role="alert">{problem}</p> : null}
      </SyncRow>
    );
  }

  return (
    <Card variant="grouped">
      <CardHeader
        title="Send changes to my iPhone"
        headingId="send-changes-to-iphone"
        eyebrow="After the first full copy"
        action={
          <Button size="small" variant="primary" onClick={send} disabled={busy}>
            {busy ? "Saving…" : "Send changes to my iPhone"}
          </Button>
        }
      />
      <CardBody>
        <div className="stack stack--4">
          <p className="small">
            Saves only what you changed on this Mac since your last full copy. On your iPhone, open Settings → Get changes from my Mac.
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
