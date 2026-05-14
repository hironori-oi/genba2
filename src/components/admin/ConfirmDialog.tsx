"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

/**
 * ConfirmDialog — Phase 5 master CRUD shared primitive (architect §3.1 / §3.2.0).
 *
 * Used by destructive admin operations (delete, role change, refresh-token
 * revoke). Architect §9 R-P5-05 requires a *two-step* confirmation when an
 * action would set qr_format_definitions.readable=false on a format that has
 * scan history — callers wire that by chaining two ConfirmDialog instances
 * (first warning, then explicit "本当に実行する" with `requireExplicit`).
 *
 * `danger=true` (or legacy `variant="danger"`) routes the primary button to
 * the red token. Color is one of three a11y channels (architect §7.3): the
 * primary label and an icon-free explicit "削除" / "実行" wording carry the
 * meaning even when color is unavailable.
 */

export type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  danger?: boolean;
  busy?: boolean;
  requireExplicit?: boolean;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "実行",
  cancelLabel = "キャンセル",
  danger = false,
  busy = false,
  requireExplicit = false,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    const handleClose = () => {
      if (open) onClose();
    };
    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
    };
  }, [onClose, open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      role={danger ? "alertdialog" : "dialog"}
      className={cn(
        "w-[min(440px,calc(100vw-2rem))] rounded-[10px] border bg-[var(--surface)] p-0 text-[var(--ink)] shadow-xl",
        danger ? "border-[var(--color-bad)]" : "border-[var(--border)]",
        "backdrop:bg-black/40",
      )}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="flex flex-col">
        <header className="border-b border-[var(--border)] px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
        </header>
        <div id={messageId} className="px-5 py-4 text-sm">
          {message}
          {requireExplicit ? (
            <p className="mt-3 text-xs font-medium text-[var(--color-bad)]">
              この操作は取り消せません。続行するには「{confirmLabel}」を押してください。
            </p>
          ) : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={danger ? "danger" : "primary"}
            size="lg"
            disabled={busy}
            onClick={() => {
              void onConfirm();
            }}
          >
            {busy ? "処理中…" : confirmLabel}
          </Button>
        </footer>
      </div>
    </dialog>
  );
}
