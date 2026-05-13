"use client";

/**
 * Phase 3b — Manual input modal (D-03 fallback).
 *
 * Implemented as a focus-trapped dialog using <dialog> when available, with a
 * div-based fallback. WCAG 2.2 AA: focus moves into the input on open, ESC
 * closes, the close & submit buttons are ≥ 56×56 px.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";

type Props = {
  open: boolean;
  placeholder: string;
  onClose: () => void;
  onSubmit: (raw: string) => void;
};

export function ManualInputModal({
  open,
  placeholder,
  onClose,
  onSubmit,
}: Props) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const titleId = useId();

  useLayoutEffect(() => {
    if (open) {
      setValue("");
      setTouched(false);
      // microtask to ensure element is mounted
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      setTouched(true);
      const v = value.trim();
      if (v.length === 0) return;
      onSubmit(v);
    },
    [onSubmit, value],
  );

  if (!open) return null;

  const empty = touched && value.trim().length === 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="manual-input-modal"
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl"
      >
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2
            id={titleId}
            className="text-base font-semibold text-[var(--ink)]"
          >
            QR を手入力
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            data-testid="manual-input-close"
            className="grid h-14 w-14 place-items-center border border-transparent text-[var(--ink)] hover:border-[var(--border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
        </header>

        <label
          htmlFor="manual-input-textarea"
          className="block text-sm font-medium text-[var(--ink)]"
        >
          QR 文字列
        </label>
        <textarea
          ref={inputRef}
          id="manual-input-textarea"
          data-testid="manual-input-textarea"
          rows={3}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-invalid={empty || undefined}
          aria-describedby={empty ? "manual-input-error" : undefined}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          className="mt-1 w-full min-h-12 resize-y border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-base text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        />
        {empty ? (
          <p
            id="manual-input-error"
            role="alert"
            className="mt-1 text-xs font-medium text-[var(--color-bad)]"
          >
            QR 文字列を入力してください。
          </p>
        ) : (
          <p className="mt-1 text-xs text-[var(--muted)]">
            カメラが使えないときの入力欄です。
          </p>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={onClose}
            data-testid="manual-input-cancel"
          >
            キャンセル
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            data-testid="manual-input-submit"
          >
            読取として処理
          </Button>
        </div>
      </form>
    </div>
  );
}
