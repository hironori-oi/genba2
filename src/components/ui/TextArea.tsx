import { forwardRef, type TextareaHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: ReactNode;
  error?: string;
};

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { id, label, hint, error, className, required, rows = 3, ...props },
  ref,
) {
  const inputId = id ?? `textarea-${label.replace(/\s+/g, "-").toLowerCase()}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-sm font-medium text-[var(--ink)]"
      >
        {label}
        {required ? <span className="ml-1 text-[var(--color-bad)]">*</span> : null}
      </label>
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        required={required}
        className={cn(
          // min-h-24 (6rem / 96px) gives reason + notes textareas room to
          // breathe; rows={...} still controls the *visible* row count but
          // the floor prevents collapsed single-line fields that masquerade
          // as an <input>. Callers can override via className via cn merge.
          "min-h-24 px-3 py-2",
          "bg-[var(--surface)] text-[var(--ink)] border",
          error ? "border-[var(--color-bad)]" : "border-[var(--border)]",
          "rounded-[6px]",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]",
          "placeholder:text-[var(--muted)]",
          "resize-y",
          className,
        )}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-[var(--muted)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-xs font-medium text-[var(--color-bad)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
});
