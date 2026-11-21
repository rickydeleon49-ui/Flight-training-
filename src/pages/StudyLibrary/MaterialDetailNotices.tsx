import { Link } from "react-router-dom";
import { deviceCan } from "@/services/platform";
import { AlertIcon, Button } from "@/components/ui";
import { geminiModelName, type GeminiStatus } from "@/services/gemini";

/**
 * Said before Gemini replaces imported content. Each names only what that
 * button replaces: regenerating the guide leaves an imported test alone.
 */
/** Which model will read the file, added to the "Send this file to Google?" message. */
export function geminiModelSentence(status: GeminiStatus | null): string {
  if (!status || typeof status.model !== "string" || !status.model) return "";
  const name = geminiModelName(status.model);
  return status.choice === "most-capable" && !status.model.startsWith("claude-")
    ? ` It will be read by ${name}, which may use slightly more of your Google credits.`
    : ` It will be read by ${name}.`;
}

export const IMPORT_GUIDE_REGENERATE_WARNING =
  "This will replace your imported study guide and flashcards with AI-generated content.";
export const IMPORT_CARDS_REGENERATE_WARNING =
  "This will replace your imported flashcards with AI-generated cards.";
export const IMPORT_TEST_REGENERATE_WARNING =
  "This will replace your imported practice test with AI-generated content.";

/** Why a new or replacement Gemini study aid cannot be requested right now. */
export interface GenerationNotice {
  text: string;
  /** Offer splitting a PDF that is too large to send whole. */
  split?: boolean;
  /** Link to Settings, where Gemini is connected. */
  settings?: boolean;
  /** Offer queueing a study guide for later when offline. */
  queueLater?: boolean;
}

export function GenerationNoticeView({
  notice,
  onSplit,
  onQueueLater,
}: {
  notice: GenerationNotice;
  onSplit: () => void;
  onQueueLater?: () => void;
}) {
  // The phone has no AI settings, so "Connect ... in Settings" would be a dead end.
  if (notice.settings && !deviceCan().generate) return null;
  return (
    <div className="stack stack--3 material-detail__mb-4">
      <div className="ai-disclaimer" role="note">
        <AlertIcon size={16} />
        <p className="tiny">{notice.text}</p>
      </div>
      {notice.split ? (
        <div>
          <Button variant="secondary" onClick={onSplit}>
            Create study-size parts
          </Button>
        </div>
      ) : null}
      {notice.queueLater && onQueueLater ? (
        <div>
          <Button variant="secondary" onClick={onQueueLater}>
            Generate later
          </Button>
        </div>
      ) : null}
      {notice.settings ? (
        <div>
          <Link className="button button--secondary" to="/settings#ai-provider">Open Settings</Link>
        </div>
      ) : null}
    </div>
  );
}
