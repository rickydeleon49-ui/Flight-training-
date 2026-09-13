import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

import { Button, IconButton } from "./Button";
import { CloseIcon } from "./Icons";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  narrow?: boolean;
  dismissible?: boolean;
}

/**
 * Modal built on the native <dialog> element.
 *
 * The platform gives us focus trapping, Escape-to-close, initial focus and
 * inertness of the page behind — all things a hand-rolled modal usually gets
 * subtly wrong.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  narrow = false,
  dismissible = true,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog${narrow ? " dialog--narrow" : ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Keep the native dialog visible until the owner confirms the close.
        // An async cleanup can fail, in which case the error remains visible.
        event.preventDefault();
        if (dismissible) onClose();
      }}
      // Clicking the backdrop (the dialog element itself) dismisses.
      onClick={(event) => {
        if (dismissible && event.target === ref.current) onClose();
      }}
    >
      <div className="dialog__header">
        <div>
          <h2 className="dialog__title" id={titleId}>
            {title}
          </h2>
          {description ? <p className="dialog__description">{description}</p> : null}
        </div>
        <IconButton label="Close" onClick={onClose} disabled={!dismissible}>
          <CloseIcon />
        </IconButton>
      </div>
      <div className="dialog__body">{children}</div>
      {footer ? <div className="dialog__footer">{footer}</div> : null}
    </dialog>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Every destructive action goes through this; nothing deletes on one click. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  destructive = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      narrow
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="muted">{message}</p>
    </Dialog>
  );
}
