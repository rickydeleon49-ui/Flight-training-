/**
 * Confirmation for resetting one material's card reviews (C-D4).
 *
 * Focus starts on Cancel. While the reset is in flight the dialog is locked.
 * If its outcome is unknown, the only choices are Try again (the same reset
 * request, which cannot reset twice) and read-only Check again; a second, new
 * reset is never sent automatically.
 */
import { useId } from "react";

import { Button, Dialog } from "@/components/ui";

import type { PendingWrite } from "./useCardReview";

interface ResetCardReviewsDialogProps {
  open: boolean;
  materialTitle: string;
  pending: PendingWrite | null;
  checking: "idle" | "checking" | "not-confirmed";
  onConfirm: () => void;
  onCancel: () => void;
  onTryAgain: () => void;
  onCheckAgain: () => void;
}

export function ResetCardReviewsDialog({
  open,
  materialTitle,
  pending,
  checking,
  onConfirm,
  onCancel,
  onTryAgain,
  onCheckAgain,
}: ResetCardReviewsDialogProps) {
  const cancelId = useId();
  const sending = pending?.status === "sending";
  const unknown = pending?.status === "unknown";
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={`Reset card reviews for “${materialTitle}”?`}
      narrow
      dismissible={!pending}
      initialFocus={() => document.getElementById(cancelId)}
      footer={
        unknown ? (
          <>
            <Button onClick={onCheckAgain} disabled={checking === "checking"}>
              {checking === "checking" ? "Checking…" : "Check again"}
            </Button>
            <Button variant="danger" onClick={onTryAgain} disabled={checking === "checking"}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <Button id={cancelId} onClick={onCancel} disabled={sending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={onConfirm} disabled={sending}>
              {sending ? "Resetting…" : "Reset reviews"}
            </Button>
          </>
        )
      }
    >
      <p className="muted">
        This removes the review schedule and rating history for this material&rsquo;s cards. Your saved cards, study
        guide and practice tests stay. Backups you&rsquo;ve already made are not changed.
      </p>
      {sending ? (
        <p className="tiny muted" role="status">
          Resetting card reviews…
        </p>
      ) : null}
      {unknown ? (
        <p className="small" role="alert">
          We couldn&rsquo;t confirm the reset. <strong>Try again</strong> resends the same reset request and can&rsquo;t
          reset twice. <strong>Check again</strong> only looks.
          {checking === "not-confirmed" ? " The reset isn't confirmed yet." : ""}
        </p>
      ) : null}
    </Dialog>
  );
}
