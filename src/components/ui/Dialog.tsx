import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

import { Button, IconButton } from "./Button";
import { CloseIcon } from "./Icons";
import { useModalDialog } from "./useModalDialog";

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
 * subtly wrong. WebKit before macOS 12.3 has no modal <dialog>; there
 * useModalDialog supplies the same behavior on the same element.
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
  // Escape and the backdrop only ask; the owner closes by setting `open`.
  const requestClose = () => {
    if (dismissible) onClose();
  };
  const modal = useModalDialog(ref, open, { onEscape: requestClose });

  const presentation = (
    <>
      {modal.showBackdrop ? (
        <div
          className="modal-fallback-backdrop"
          data-modal-backdrop=""
          aria-hidden="true"
          style={{ zIndex: modal.zIndex - 1 }}
          onClick={requestClose}
        />
      ) : null}
      <dialog
        ref={ref}
        className={`dialog${narrow ? " dialog--narrow" : ""}${modal.fallback ? " modal-fallback" : ""}`}
        aria-labelledby={titleId}
        role={modal.fallback ? "dialog" : undefined}
        aria-modal={modal.showBackdrop ? true : undefined}
        tabIndex={modal.fallback ? -1 : undefined}
        style={modal.fallback ? { zIndex: modal.zIndex } : undefined}
        onCancel={(event) => {
          // Keep the native dialog visible until the owner confirms the close.
          // An async cleanup can fail, in which case the error remains visible.
          event.preventDefault();
          requestClose();
        }}
        // Natively, a backdrop click targets the dialog element itself. In the
        // fallback the element is the visible box, and the backdrop is separate.
        onClick={(event) => {
          if (!modal.fallback && event.target === ref.current) requestClose();
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
    </>
  );
  // In the fallback the dialog lives at <body> level; see useModalDialog.
  return modal.portalTarget ? createPortal(presentation, modal.portalTarget) : presentation;
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
