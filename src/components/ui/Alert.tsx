import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "info" | "warn" | "error" | "ok";

const TONE: Record<Tone, { bg: string; ink: string; bar: string; label: string }> = {
  info: {
    bg: "bg-[oklch(95%_.02_240)]",
    ink: "text-[var(--ink)]",
    bar: "bg-[var(--color-func-inventory)]",
    label: "情報",
  },
  warn: {
    bg: "bg-[oklch(96%_.04_70)]",
    ink: "text-[var(--ink)]",
    bar: "bg-[var(--color-warn)]",
    label: "警告",
  },
  error: {
    bg: "bg-[oklch(94%_.04_25)]",
    ink: "text-[var(--ink)]",
    bar: "bg-[var(--color-bad)]",
    label: "エラー",
  },
  ok: {
    bg: "bg-[oklch(95%_.04_150)]",
    ink: "text-[var(--ink)]",
    bar: "bg-[var(--color-ok)]",
    label: "OK",
  },
};

export function Alert({
  tone = "info",
  title,
  children,
  role,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  role?: "status" | "alert";
}) {
  const t = TONE[tone];
  return (
    <div
      role={role ?? (tone === "error" ? "alert" : "status")}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={cn(
        "relative grid grid-cols-[4px_1fr] gap-3 overflow-hidden border border-[var(--border)]",
        t.bg,
      )}
    >
      <span aria-hidden className={cn("h-full w-1", t.bar)} />
      <div className={cn("py-3 pr-4", t.ink)}>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          {title ?? t.label}
        </p>
        <div className="mt-1 text-sm">{children}</div>
      </div>
    </div>
  );
}
