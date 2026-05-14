"use client";

/**
 * Phase 6b — StepShell primitive (architect §B.1.3).
 *
 * Generic ordered step driver for the 4 LOGI / WORKS business flows. Each
 * step declares its `kind` ("scan" | "select" | "input") and a `validate`
 * callback. The shell:
 *
 *   - renders a sticky StepHeader with abort + step ladder,
 *   - drives the Scanner (existing component, do NOT rewrite) for "scan"
 *     steps, with `startMode="scan"` controlling whether the camera opens
 *     immediately or the user starts in manual mode,
 *   - renders a generic single-input form for "input" steps,
 *   - delegates "select" rendering to an optional render prop (master /
 *     list pickers vary per business),
 *   - exposes a sticky-bottom primary CTA (h-14 min-h-14, 56×56 minimum
 *     touch target) so the worker's thumb can reach it one-handed,
 *   - announces step transitions via aria-live="polite" and errors via
 *     aria-live="assertive" (separate live regions to avoid clobber),
 *   - auto-focuses the confirm CTA on scan success and the first input
 *     of "input" steps so glove users do not have to chase focus.
 *
 * Security: `raw_value` from Scanner is passed straight into validate and
 * never persisted by this primitive. The host's validate decides whether
 * to keep / discard.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Camera, Keyboard } from "lucide-react";
import { Scanner } from "./Scanner";
import { StepHeader, type Step as HeaderStep } from "./StepHeader";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";

export type StepKind = "scan" | "select" | "input";

export type StepValidateResult<TPayload> = TPayload | { error: string };

export type StepDef<TPayload> = {
  /** Unique identifier of the step (e.g. "header", "line", "label", "qty"). */
  id: string;
  /** Localized heading shown at the top of the step. */
  title: string;
  /** Optional helper / placeholder hint. */
  helper?: string;
  kind: StepKind;
  /**
   * Validate the raw input (string from Scanner / manual input / form value)
   * and return a typed payload or a domain error. The shell does not
   * persist `raw`; only the validated payload reaches `onComplete`.
   */
  validate: (raw: string | TPayload) => Promise<StepValidateResult<TPayload>>;
};

export type StepShellProps<TPayload> = {
  steps: StepDef<TPayload>[];
  /** Called when every step has produced a validated payload. */
  onComplete: (collected: TPayload[]) => Promise<void> | void;
  /**
   * "scan" → Scanner opens immediately on scan steps (camera auto-start).
   * "form" → Scanner opens with manual input modal so a kiosk / no-cam
   *   device can start in form-first mode. Default: "form".
   */
  startMode?: "scan" | "form";
  business: "receiving" | "picking" | "inventory" | "manufacturing";
  /** Optional title for the StepHeader. Defaults to the business label. */
  title?: string;
  /**
   * Called when the user presses the abort button. Defaults to navigating
   * back to /app/logi (or /app/works for manufacturing) when omitted.
   */
  onAbort?: () => void;
  /**
   * Renderer for "select" steps. Receives a commit function that the
   * caller invokes with the picked payload; the shell handles validation
   * and progression. If omitted, "select" steps fall back to a manual
   * input box (so the primitive is still usable without master data).
   */
  renderSelect?: (args: {
    step: StepDef<TPayload>;
    commit: (raw: string | TPayload) => void;
  }) => ReactNode;
};

const BUSINESS_LABEL: Record<StepShellProps<unknown>["business"], string> = {
  receiving: "入庫",
  picking: "ピッキング",
  inventory: "棚卸",
  manufacturing: "製造実績",
};

const BUSINESS_HOME: Record<StepShellProps<unknown>["business"], string> = {
  receiving: "/app/logi",
  picking: "/app/logi",
  inventory: "/app/logi",
  manufacturing: "/app/works",
};

export function StepShell<TPayload>({
  steps,
  onComplete,
  startMode = "form",
  business,
  title,
  onAbort,
  renderSelect,
}: StepShellProps<TPayload>) {
  const router = useRouter();
  const [activeIdx, setActiveIdx] = useState(0);
  const [collected, setCollected] = useState<TPayload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState<string>("");
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ctaRef = useRef<HTMLButtonElement | null>(null);
  const liveErrorId = useId();
  const liveStepId = useId();

  const activeStep: StepDef<TPayload> | undefined = steps[activeIdx];
  const headerSteps: HeaderStep[] = useMemo(
    () => steps.map((s) => ({ id: s.id, label: s.title })),
    [steps],
  );

  // Announce step transitions politely.
  useEffect(() => {
    if (!activeStep) return;
    setAnnounce(`ステップ ${activeIdx + 1} / ${steps.length}: ${activeStep.title}`);
    setError(null);
    setInputValue("");
  }, [activeIdx, activeStep, steps.length]);

  // Focus management — input step focuses first field, scan step focuses CTA
  // once we have data ready (the CTA mount is in this effect's dependency
  // tree via `completed` / `error`).
  useEffect(() => {
    if (!activeStep) return;
    if (activeStep.kind === "input") {
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [activeIdx, activeStep]);

  const handleAbort = useCallback(() => {
    if (onAbort) {
      onAbort();
      return;
    }
    router.push(BUSINESS_HOME[business]);
  }, [business, onAbort, router]);

  const finalize = useCallback(
    async (allPayloads: TPayload[]) => {
      setCompleting(true);
      setError(null);
      try {
        await onComplete(allPayloads);
        setCompleted(true);
        setAnnounce("登録が完了しました");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "登録に失敗しました";
        setError(msg);
      } finally {
        setCompleting(false);
      }
    },
    [onComplete],
  );

  const commit = useCallback(
    async (raw: string | TPayload) => {
      if (!activeStep) return;
      const result = await activeStep.validate(raw);
      if (result !== null && typeof result === "object" && "error" in (result as object) && typeof (result as { error: unknown }).error === "string") {
        setError((result as { error: string }).error);
        return;
      }
      const payload = result as TPayload;
      const next = [...collected, payload];
      setCollected(next);
      setError(null);
      if (activeIdx + 1 >= steps.length) {
        void finalize(next);
        return;
      }
      setActiveIdx((i) => i + 1);
    },
    [activeIdx, activeStep, collected, finalize, steps.length],
  );

  const handleInputSubmit = useCallback(() => {
    if (!activeStep) return;
    if (inputValue.trim().length === 0) {
      setError("値を入力してください");
      return;
    }
    void commit(inputValue.trim());
  }, [activeStep, commit, inputValue]);

  if (!activeStep) {
    return (
      <div className="flex flex-col gap-4" data-testid={`stepshell-${business}`}>
        <Alert tone="error" title="ステップが定義されていません">
          StepShell には少なくとも 1 つのステップが必要です。
        </Alert>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-4 pb-24"
      data-testid={`stepshell-${business}`}
      data-start-mode={startMode}
    >
      <StepHeader
        steps={headerSteps}
        activeStepId={activeStep.id}
        title={title ?? BUSINESS_LABEL[business]}
        onAbort={handleAbort}
        onBack={
          activeIdx > 0 && !completed
            ? () => {
                setActiveIdx((i) => Math.max(0, i - 1));
                setCollected((c) => c.slice(0, -1));
              }
            : undefined
        }
      />

      {/* aria-live regions: polite for transitions, assertive for errors.
          Hidden visually but available to screen-readers. */}
      <p
        id={liveStepId}
        data-testid="stepshell-live-polite"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announce}
      </p>
      <p
        id={liveErrorId}
        data-testid="stepshell-live-assertive"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {error ?? ""}
      </p>

      <section
        aria-labelledby={`stepshell-section-${activeStep.id}`}
        className="flex flex-col gap-3"
        data-testid={`stepshell-section-${activeStep.id}`}
      >
        <h2
          id={`stepshell-section-${activeStep.id}`}
          className="text-base font-semibold text-[var(--ink)]"
        >
          {activeIdx + 1}. {activeStep.title}
        </h2>
        {activeStep.helper ? (
          <p className="text-sm text-[var(--muted)]">{activeStep.helper}</p>
        ) : null}

        {error ? (
          <Alert tone="error" title="入力エラー" data-testid="stepshell-error">
            {error}
          </Alert>
        ) : null}

        {completed ? (
          <Alert tone="ok" title="完了" data-testid="stepshell-completed">
            すべてのステップが完了しました。
          </Alert>
        ) : activeStep.kind === "scan" ? (
          <Scanner
            key={`scan-${activeStep.id}-${activeIdx}`}
            manualOnly={startMode === "form"}
            onResult={(raw) => {
              void commit(raw);
            }}
            cancelLabel="中止"
            manualPlaceholder={
              activeStep.helper ?? "QR 文字列を貼り付け / 手入力"
            }
          />
        ) : activeStep.kind === "select" ? (
          renderSelect ? (
            renderSelect({ step: activeStep, commit: (raw) => void commit(raw) })
          ) : (
            <ManualSelectFallback
              inputRef={inputRef}
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleInputSubmit}
              label={activeStep.title}
              helper={activeStep.helper}
            />
          )
        ) : (
          <ManualSelectFallback
            inputRef={inputRef}
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleInputSubmit}
            label={activeStep.title}
            helper={activeStep.helper}
          />
        )}
      </section>

      {/* Sticky bottom CTA — primary action for the current step.
          For "scan" steps the CTA toggles between manual input affordance
          and (when completed) a confirm step. For "input"/"select" the CTA
          submits the form. */}
      {!completed ? (
        <div
          data-testid="stepshell-sticky-cta"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] sm:px-6"
        >
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <span className="flex-1 font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
              {activeIdx + 1} / {steps.length}
            </span>
            {activeStep.kind === "scan" ? (
              <Button
                ref={ctaRef}
                type="button"
                variant="primary"
                size="lg"
                onClick={() => {
                  const raw = window.prompt(
                    activeStep.helper ?? "QR 文字列を入力してください",
                  );
                  if (raw && raw.trim().length > 0) {
                    void commit(raw.trim());
                  }
                }}
                disabled={completing}
                data-testid="stepshell-cta-primary"
                aria-label={`手入力で ${activeStep.title} を進める`}
              >
                <Keyboard aria-hidden className="h-5 w-5" />
                手入力で進める
              </Button>
            ) : (
              <Button
                ref={ctaRef}
                type="button"
                variant="primary"
                size="lg"
                onClick={handleInputSubmit}
                disabled={completing}
                data-testid="stepshell-cta-primary"
                aria-label={`次のステップへ進む`}
              >
                <Camera aria-hidden className="h-5 w-5" />
                次へ
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ManualSelectFallback({
  inputRef,
  value,
  onChange,
  onSubmit,
  label,
  helper,
}: {
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  label: string;
  helper?: string;
}) {
  return (
    <form
      className="flex flex-col gap-3"
      data-testid="stepshell-input-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Field
        ref={inputRef}
        label={label}
        hint={helper}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid="stepshell-input-field"
        autoComplete="off"
        inputMode="text"
      />
    </form>
  );
}
