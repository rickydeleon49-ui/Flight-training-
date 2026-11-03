import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "@/data";
import { Button, Dialog } from "@/components/ui";
import { useAppData } from "@/state/AppDataContext";
import {
  ACK_BODY,
  ACK_BUTTON,
  ACK_MORE,
  ACK_TITLE,
  AFFILIATION_NOTE,
  AGE_NOTE,
  LEGAL_ACK_KEY,
  LEGAL_POINTS,
  LICENSE_NAME,
  LICENSE_URL,
  NOTICES_MISSING,
  NOTICES_PATH,
} from "@/logic/legal";

/** Reads the bundled third-party notices; null when the file is missing. */
export async function loadNotices(fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetcher(`${import.meta.env.BASE_URL ?? "/"}${NOTICES_PATH}`);
    if (!response.ok) return null;
    const text = await response.text();
    // A dev server answers unknown paths with the app page; that is not the file.
    return text.trim() && !/^\s*<!doctype html/i.test(text) ? text : null;
  } catch {
    return null;
  }
}

function Licenses() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!open || text !== undefined) return;
    let live = true;
    void loadNotices().then((value) => { if (live) setText(value); });
    return () => { live = false; };
  }, [open, text]);
  return (
    <div className="stack stack--3">
      <div>
        <Button variant="secondary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "Hide third-party licenses" : "Show third-party licenses"}
        </Button>
      </div>
      {open ? (
        text === undefined ? (
          <p className="small muted" role="status">Loading licenses…</p>
        ) : text === null ? (
          <p className="small muted" role="status">{NOTICES_MISSING}</p>
        ) : (
          <pre
            aria-label="Third-party licenses"
            tabIndex={0}
            className="tiny"
            style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "24rem", overflow: "auto", maxWidth: "100%" }}
          >
            {text}
          </pre>
        )
      ) : null}
    </div>
  );
}

/** Settings › About & legal: version, license, licenses and the safety text. */
export function AboutLegal({ version }: { version: string }) {
  return (
    <div className="stack stack--4">
      <p className="small">Her Flight Deck{version ? ` · Version ${version}` : ""}</p>
      <ul className="stack stack--2 small" aria-label="Safety and legal">
        {LEGAL_POINTS.map((point) => <li key={point}>{point}</li>)}
      </ul>
      <p className="small muted">{AGE_NOTE}</p>
      <p className="small muted">{AFFILIATION_NOTE}</p>
      <p className="small">
        Released under the{" "}
        <a
          href={LICENSE_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            if (isTauri()) { event.preventDefault(); void openUrl(LICENSE_URL).catch(() => undefined); }
          }}
        >
          {LICENSE_NAME}
        </a>.
      </p>
      <Licenses />
    </div>
  );
}

/** Shown once, at first launch, until you accept it. Stored in app settings. */
export function LegalAcknowledgement() {
  const { repositories } = useAppData();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!repositories) return;
    let live = true;
    void repositories.app.get(LEGAL_ACK_KEY).then((value) => { if (live && !value) setShow(true); }).catch(() => undefined);
    return () => { live = false; };
  }, [repositories]);
  const accept = () => {
    setShow(false);
    void repositories?.app.set(LEGAL_ACK_KEY, new Date().toISOString()).catch(() => undefined);
  };
  return (
    <Dialog open={show} onClose={accept} title={ACK_TITLE} narrow dismissible={false} footer={<Button variant="primary" onClick={accept}>{ACK_BUTTON}</Button>}>
      <p>{ACK_BODY}</p>
      <p className="small muted">{ACK_MORE}</p>
    </Dialog>
  );
}
