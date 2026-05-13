"use client";

/**
 * Phase 3b — ピッキング (Picking) flow.
 *
 * UC-1: header QR → line QR → label QR → 2 点照合 → quantity → submit.
 * runMatch from @/lib/qr/match drives the OK/NG decision; ng_flow toggle
 * lets QA switch between block (登録 disabled on NG) and warn (confirmation
 * required before submit).
 */

import { useCallback, useReducer, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StepHeader } from "@/components/scanner/StepHeader";
import { Scanner } from "@/components/scanner/Scanner";
import { ResultOverlay } from "@/components/scanner/ResultOverlay";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { parseQr } from "@/lib/qr/parser";
import { runMatch } from "@/lib/qr/match";
import type { MatchRuleLine, QrFormatDefinition } from "@/lib/qr/types";
import {
  decideCanSubmit,
  initialScannerState,
  scannerReducer,
  type NgFlow,
} from "@/components/scanner/scanner-state";
import { insertMovementRecord } from "@/lib/logi/actions";

const STEPS = [
  { id: "header", label: "ヘッダ" },
  { id: "line", label: "明細" },
  { id: "label", label: "ラベル" },
  { id: "quantity", label: "数量" },
  { id: "submit", label: "登録" },
];

type Props = {
  headerFormats: QrFormatDefinition[];
  lineFormats: QrFormatDefinition[];
  labelFormats: QrFormatDefinition[];
  matchRuleLines: ReadonlyArray<MatchRuleLine>;
};

export function PickingFlow({
  headerFormats,
  lineFormats,
  labelFormats,
  matchRuleLines,
}: Props) {
  const router = useRouter();
  const [ngFlow, setNgFlow] = useState<NgFlow>("block");
  const [state, dispatch] = useReducer(
    scannerReducer,
    ngFlow,
    initialScannerState,
  );
  const [quantity, setQuantity] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [confirmingWarn, setConfirmingWarn] = useState<boolean>(false);
  const [pending, startTransition] = useTransition();
  const [success, setSuccess] = useState<string | null>(null);

  const activeStepId =
    !state.header
      ? "header"
      : !state.line
        ? "line"
        : !state.label
          ? "label"
          : !quantity
            ? "quantity"
            : "submit";

  const handleScan = useCallback(
    (raw: string) => {
      // Decide which qr_type we are expecting from the current step.
      if (!state.header) {
        const p = parseQr(raw, "header", headerFormats);
        if (!p.ok) {
          dispatch({ type: "fail", error: `ヘッダ読取失敗: ${p.reason}` });
          return;
        }
        dispatch({ type: "scan_header", parsed: p.parsedValues });
        return;
      }
      if (!state.line) {
        const p = parseQr(raw, "line", lineFormats);
        if (!p.ok) {
          dispatch({ type: "fail", error: `明細読取失敗: ${p.reason}` });
          return;
        }
        dispatch({ type: "scan_line", parsed: p.parsedValues });
        return;
      }
      if (!state.label) {
        const p = parseQr(raw, "label", labelFormats);
        if (!p.ok) {
          dispatch({ type: "fail", error: `ラベル読取失敗: ${p.reason}` });
          return;
        }
        dispatch({ type: "scan_label", parsed: p.parsedValues });
        const outcome = runMatch({
          source: state.line ?? {},
          label: p.parsedValues,
          lines: matchRuleLines,
        });
        dispatch({ type: "set_match", outcome });
        if (typeof p.parsedValues.quantity === "number") {
          setQuantity(String(p.parsedValues.quantity));
        }
        return;
      }
    },
    [headerFormats, labelFormats, lineFormats, matchRuleLines, state.header, state.label, state.line],
  );

  const handleAbort = useCallback(() => {
    dispatch({ type: "reset" });
    setQuantity("");
    setError(null);
    router.push("/app/logi");
  }, [router]);

  const canSubmit =
    decideCanSubmit(state.match, ngFlow) &&
    Number(quantity) >= 0 &&
    state.label != null;

  const submit = () => {
    setError(null);
    if (!state.label) {
      setError("ラベルが未読取です");
      return;
    }
    const itemCode = state.label.item_code;
    if (typeof itemCode !== "string" || itemCode.length === 0) {
      setError("ラベルから品目コードを取得できませんでした");
      return;
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty < 0) {
      setError("数量を正しく入力してください (0 以上)");
      return;
    }

    if (
      state.match?.matchResult === "ng" &&
      ngFlow === "warn" &&
      !confirmingWarn
    ) {
      setConfirmingWarn(true);
      return;
    }

    startTransition(async () => {
      const result = await insertMovementRecord({
        business_code: "picking",
        movement_plan_line_id:
          (typeof state.line?.line_id === "string"
            ? (state.line?.line_id as string)
            : null) ?? null,
        item_code: itemCode,
        quantity: qty,
        lot:
          typeof state.label?.lot === "string"
            ? (state.label?.lot as string)
            : null,
        location_code:
          typeof state.label?.location_code === "string"
            ? (state.label?.location_code as string)
            : null,
        match_result: state.match?.matchResult ?? "ok",
        match_detail: state.match?.detail ?? [],
        notes: null,
      });
      if (result.error) {
        setError(`${result.error.code}: ${result.error.message}`);
        return;
      }
      setSuccess(
        `ピッキングを登録しました (id=${result.data?.id?.slice(0, 8) ?? "?"})`,
      );
      dispatch({ type: "submit_success" });
      setQuantity("");
      setConfirmingWarn(false);
    });
  };

  // Determine which scanner phase to render (header/line/label) or "all read".
  const currentScannerStep =
    !state.header ? "header" : !state.line ? "line" : !state.label ? "label" : null;

  return (
    <div className="flex flex-col gap-4">
      <StepHeader
        steps={STEPS}
        activeStepId={activeStepId}
        title="ピッキング"
        onAbort={handleAbort}
      />

      <NgFlowToggle
        ngFlow={ngFlow}
        onChange={(v) => {
          setNgFlow(v);
          dispatch({ type: "reset" });
          setQuantity("");
        }}
      />

      {success ? (
        <Alert tone="ok" title="登録しました">
          {success}
        </Alert>
      ) : null}
      {state.error ? (
        <Alert tone="error" title="読取エラー">
          {state.error}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="error" title="登録エラー">
          {error}
        </Alert>
      ) : null}

      <section aria-labelledby="pick-scan" className="flex flex-col gap-3">
        <h2
          id="pick-scan"
          className="text-base font-semibold text-[var(--ink)]"
        >
          QR を順番に読取
        </h2>
        <ScanProgress state={state} />
        {/* 3-layer stack per scanner-overlay.md §Solution:
              Layer 2 = camera + viewfinder (Scanner)
              Layer 3 = bottom-sheet ResultOverlay (slotted into Scanner)
            When scanning is complete we replace the Scanner viewport with a
            "ready to submit" Alert and keep ResultOverlay nested as a sheet
            in the same visual stack so the user's eye stays in one place. */}
        {currentScannerStep ? (
          <Scanner
            key={currentScannerStep}
            onResult={handleScan}
            cancelLabel="中止"
            manualPlaceholder={
              currentScannerStep === "header"
                ? "例: V1|SHIP-018|2026-05-09|CUST-001"
                : currentScannerStep === "line"
                  ? "例: V1|SHIP-018|3|ITEM-1102|4|LOT-A"
                  : "例: V1|ITEM-2048|12|A-03-15|ORD-1"
            }
            bottomOverlay={
              <ResultOverlay
                outcome={state.match}
                ngFlow={ngFlow}
                onRescan={() => {
                  dispatch({ type: "reset" });
                  setQuantity("");
                }}
                onAcceptWarning={() => setConfirmingWarn(true)}
              />
            }
          />
        ) : (
          <div
            data-testid="pick-scan-complete"
            className="relative flex aspect-[4/3] w-full flex-col items-stretch justify-center overflow-hidden border-2 border-[var(--color-ok)] bg-[color-mix(in_oklch,var(--color-good)_10%,var(--surface))] p-4"
          >
            <Alert tone="info" title="3 件の読取が完了しました">
              照合結果を確認のうえ、数量を入力して登録してください。
            </Alert>
            <div
              data-testid="scanner-bottom-overlay"
              className="pointer-events-none absolute inset-x-0 bottom-0 z-30"
            >
              <div className="pointer-events-auto">
                <ResultOverlay
                  outcome={state.match}
                  ngFlow={ngFlow}
                  onRescan={() => {
                    dispatch({ type: "reset" });
                    setQuantity("");
                  }}
                  onAcceptWarning={() => setConfirmingWarn(true)}
                />
              </div>
            </div>
          </div>
        )}
      </section>

      <section
        aria-labelledby="pick-input"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <h2
          id="pick-input"
          className="col-span-full text-base font-semibold text-[var(--ink)]"
        >
          数量
        </h2>
        <Field
          label="実数量"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          data-testid="pick-quantity"
        />
      </section>

      <section
        aria-labelledby="pick-submit"
        className="flex flex-wrap items-center gap-3"
      >
        <h2 id="pick-submit" className="sr-only">
          登録
        </h2>
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={submit}
          disabled={!canSubmit || pending}
          data-testid="pick-submit"
        >
          {pending ? "登録中…" : "登録"}
        </Button>
        {confirmingWarn ? (
          <span
            role="status"
            className="text-sm font-medium text-[var(--color-warn)]"
          >
            NG 警告を確認しました。もう一度「登録」を押すと送信します。
          </span>
        ) : null}
      </section>
    </div>
  );
}

function ScanProgress({
  state,
}: {
  state: ReturnType<typeof initialScannerState>;
}) {
  return (
    <ol className="grid grid-cols-3 gap-2 text-xs">
      {(
        [
          { id: "header", label: "ヘッダ", value: state.header },
          { id: "line", label: "明細", value: state.line },
          { id: "label", label: "ラベル", value: state.label },
        ] as const
      ).map((row) => (
        <li
          key={row.id}
          data-testid={`pick-progress-${row.id}`}
          className={
            "flex flex-col gap-1 border p-2 " +
            (row.value
              ? "border-[var(--color-ok)] bg-[oklch(95%_.04_150)]"
              : "border-[var(--border)] bg-[var(--surface)]")
          }
        >
          <span className="font-mono text-[var(--muted)]">{row.label}</span>
          <span className="text-[var(--ink)]">
            {row.value ? "✓ 読取済" : "未読取"}
          </span>
        </li>
      ))}
    </ol>
  );
}

function NgFlowToggle({
  ngFlow,
  onChange,
}: {
  ngFlow: NgFlow;
  onChange: (v: NgFlow) => void;
}) {
  return (
    <fieldset
      data-testid="ngflow-toggle"
      className="flex flex-col gap-2 border-2 border-dashed border-[var(--color-bad)] bg-[var(--surface-2)] p-3"
    >
      <legend className="px-1 font-mono text-xs uppercase tracking-wide text-[var(--color-bad)]">
        [DEV プレビュー] ng_flow
      </legend>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="ng_flow"
            value="block"
            checked={ngFlow === "block"}
            onChange={() => onChange("block")}
            className="h-5 w-5 accent-[var(--color-brand)]"
          />
          <span>block — NG 時は登録不可</span>
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="ng_flow"
            value="warn"
            checked={ngFlow === "warn"}
            onChange={() => onChange("warn")}
            className="h-5 w-5 accent-[var(--color-brand)]"
          />
          <span>warn — NG 警告で続行可能</span>
        </label>
        <span
          data-testid="ngflow-label"
          className="font-mono text-xs text-[var(--ink)]"
        >
          現在: {ngFlow}
        </span>
      </div>
      <p className="text-xs text-[var(--muted)]">
        開発用プレビュー — 本番では tenant の work_settings から取得します (Phase 4+)。
      </p>
    </fieldset>
  );
}
