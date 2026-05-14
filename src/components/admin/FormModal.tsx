"use client";

import {
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

/**
 * FormModal — Phase 5 master CRUD shared primitive (architect §3.1 / §3.2.0).
 *
 * Uses the browser-native <dialog showModal()> path so we inherit focus trap,
 * Escape-to-close, and the inert-backdrop a11y contract without pulling in
 * a new dependency (architect §7.3 "FormModal は <dialog> 要素ベースで focus
 * trap (DialogJS 不使用、ブラウザ native)").
 *
 * onSubmit receives the native FormEvent so server actions can be attached
 * via the children's <form action={...}> pattern; the modal does not run
 * the action itself.
 */

export type FormModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  submitLabel?: ReactNode;
  cancelLabel?: ReactNode;
  submitting?: boolean;
  description?: ReactNode;
};

export function FormModal({
  open,
  onClose,
  title,
  children,
  onSubmit,
  submitLabel = "保存",
  cancelLabel = "キャンセル",
  submitting = false,
  description,
}: FormModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

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
      aria-describedby={description ? descId : undefined}
      className={cn(
        "w-[min(560px,calc(100vw-2rem))] rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--ink)] shadow-xl",
        "backdrop:bg-black/40",
      )}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          if (!onSubmit) return;
          e.preventDefault();
          void onSubmit(e);
        }}
        className="flex flex-col"
      >
        <header className="border-b border-[var(--border)] px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {description ? (
            <p id={descId} className="mt-1 text-sm text-[var(--muted)]">
              {description}
            </p>
          ) : null}
        </header>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">{children}</div>
        <footer className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={onClose}
            disabled={submitting}
          >
            {cancelLabel}
          </Button>
          {onSubmit ? (
            <Button type="submit" variant="primary" size="lg" disabled={submitting}>
              {submitting ? "保存中…" : submitLabel}
            </Button>
          ) : null}
        </footer>
      </form>
    </dialog>
  );
}
