"use client";

/**
 * Phase 3b — StepHeader.
 *
 * Sticky progress header for the multi-step LOGI flows. Each interactive
 * control is ≥ 56×56 px per AC-A11Y-01.
 */

import { ChevronLeft, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type Step = {
  id: string;
  label: string;
};

type Props = {
  steps: Step[];
  activeStepId: string;
  onBack?: () => void;
  onAbort: () => void;
  title: string;
};

export function StepHeader({
  steps,
  activeStepId,
  onBack,
  onAbort,
  title,
}: Props) {
  const activeIdx = Math.max(
    0,
    steps.findIndex((s) => s.id === activeStepId),
  );
  const activeNo = activeIdx + 1;
  const total = steps.length;
  const activeLabel = steps[activeIdx]?.label ?? "";

  return (
    <header
      data-testid="step-header"
      className="sticky top-0 z-10 flex flex-col gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 lg:px-6"
    >
      <div className="flex items-center gap-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="前のステップに戻る"
            data-testid="step-header-back"
            className="inline-flex h-14 w-14 items-center justify-center border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            <ChevronLeft aria-hidden className="h-5 w-5" />
          </button>
        ) : null}
        <div className="flex flex-1 flex-col">
          <p className="font-mono text-xs uppercase tracking-[0.18em] tabular-nums text-[var(--muted)]">
            ステップ {activeNo} / {total}
          </p>
          <h1 className="text-base font-semibold text-[var(--ink)]">
            {title} — {activeLabel}
          </h1>
        </div>
        <button
          type="button"
          onClick={onAbort}
          aria-label="作業を中止"
          data-testid="step-header-abort"
          className="inline-flex h-14 w-14 items-center justify-center border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--color-bad)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          <X aria-hidden className="h-5 w-5 text-[var(--ink)]" />
        </button>
      </div>

      <ol
        aria-label="進捗ステップ"
        className="flex flex-wrap items-center gap-1 text-xs"
      >
        {steps.map((step, idx) => {
          const done = idx < activeIdx;
          const current = idx === activeIdx;
          return (
            <li
              key={step.id}
              data-testid={`step-${step.id}`}
              data-state={done ? "done" : current ? "current" : "pending"}
              aria-current={current ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 border px-2 py-1 font-mono tabular-nums",
                // semantic step-state tokens — see tokens/genba-2026-05-12-polish.md
                done && "border-[var(--color-step-done)] text-[var(--color-step-done)]",
                current &&
                  "border-[var(--color-step-active)] bg-[var(--color-step-active)] text-[var(--color-brand-foreground)]",
                !done &&
                  !current &&
                  "border-[var(--color-step-pending)] text-[var(--muted)]",
              )}
            >
              <span aria-hidden className="tabular-nums">
                {idx + 1}
              </span>
              <span>{step.label}</span>
            </li>
          );
        })}
      </ol>
    </header>
  );
}
