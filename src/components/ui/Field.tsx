import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: ReactNode;
  error?: string;
};

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { id, label, hint, error, className, required, ...props },
  ref,
) {
  const inputId = id ?? `field-${label.replace(/\s+/g, "-").toLowerCase()}`;
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
      <input
        ref={ref}
        id={inputId}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        required={required}
        className={cn(
          "h-12 px-3",
          "bg-[var(--surface)] text-[var(--ink)] border",
          error ? "border-[var(--color-bad)]" : "border-[var(--border)]",
          "rounded-[6px]",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]",
          "placeholder:text-[var(--muted)]",
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
