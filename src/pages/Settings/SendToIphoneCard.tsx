import { useEffect, useState } from "react";

import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import type { LastIphoneSend } from "@/data/repositories/appRepository";
import type { Repositories } from "@/data/repositories";
import { backupErrorMessage, formatBytes } from "@/services/backups";
import { revealIphoneBackup, sendToIphone } from "@/services/iphone";

const formatSentDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

/** One button that saves a copy her iPhone can open from the Files app. */
export function SendToIphoneCard({ repositories }: { repositories: Repositories | null }) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<LastIphoneSend | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!repositories) return;
    void repositories.app.lastIphoneSend().then(setLast).catch(() => setLast(null));
  }, [repositories]);

  const send = async () => {
    setProblem(null);
    setBusy(true);
    try {
      if (!repositories) throw new Error("The database is still starting. Try again in a moment.");
      const result = await sendToIphone();
      if (!result) return;
      const record = { at: new Date().toISOString(), bytes: result.info.bytes, path: result.info.path };
      setLast(record);
      try {
        await repositories.app.recordIphoneSend(record);
      } catch {
        // The file is saved; a failed reminder must not say otherwise.
      }
    } catch (error) {
      setProblem(backupErrorMessage(error, "That copy could not be saved. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const viaICloud = last ? last.path.includes("com~apple~CloudDocs") : true;

  const showInFinder = async () => {
    if (!last) return;
    try {
      await revealIphoneBackup(last.path);
    } catch (error) {
      setProblem(backupErrorMessage(error, "Finder could not show that file."));
    }
  };

  return (
    <Card>
      <CardHeader
        title="Send to my iPhone"
        eyebrow="Study on the go"
        action={
          <Button size="small" variant="primary" onClick={send} disabled={busy}>
            {busy ? "Saving…" : "Send to my iPhone"}
          </Button>
        }
      />
      <CardBody>
        <div className="stack stack--4">
          {last ? (
            <p className="small">
              Saved for your iPhone · {formatBytes(last.bytes)} · {formatSentDate(last.at)}
            </p>
          ) : null}
          {last && viaICloud ? (
            <p className="small">
              On your iPhone, open Files → iCloud Drive → Her Flight Deck and tap the newest file.
              Her Flight Deck opens it and asks before replacing anything. It should be there within
              a minute or two on Wi-Fi.
            </p>
          ) : null}
          {last && !viaICloud ? (
            <p className="small">
              iCloud Drive isn't on for this Mac, so the file was saved where you chose. AirDrop it
              to your iPhone from Finder.
            </p>
          ) : null}
          {last && viaICloud ? (
            <p className="small">
              <Button size="small" onClick={showInFinder}>
                Show in Finder
              </Button>
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
