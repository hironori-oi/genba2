"use client";

/**
 * Phase 3b — 入庫 (Receiving) flow.
 *
 * UC-2 free-read pattern: label QR → quantity/location confirmation → submit.
 * `movement_plan_line_id` is intentionally null (free read).
 *
 * For Phase 3b we operate on the demo QR formats (passed in from the server
 * component). ng_flow is exposed as a UI toggle so QA can demonstrate the
 * block vs warn behaviour without a tenant-level setting fetch.
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
import type { QrFormatDefinition } from "@/lib/qr/types";
import type { MatchOutcome } from "@/lib/qr/match";
import {
  decideCanSubmit,
  initialScannerState,
  scannerReducer,
  type NgFlow,
} from "@/components/scanner/scanner-state";
import { insertMovementRecord } from "@/lib/logi/actions";

const STEPS = [
  { id: "label", label: "ラベル" },
  { id: "quantity", label: "数量" },
  { id: "location", label: "ロケ確認" },
  { id: "submit", label: "登録" },
];

type Props = {
  labelFormats: QrFormatDefinition[];
};

export function ReceivingFlow({ labelFormats }: Props) {
  const router = useRouter();
  const [ngFlow, setNgFlow] = useState<NgFlow>("block");
  const [state, dispatch] = useReducer(
    scannerReducer,
    ngFlow,
    initialScannerState,
  );
  const [quantity, setQuantity] = useState<string>("");
  const [locationCode, setLocationCode] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [confirmingWarn, setConfirmingWarn] = useState<boolean>(false);
  const [pending, startTransition] = useTransition();
  const [success, setSuccess] = useState<string | null>(null);

  const handleScan = useCallback(
    (raw: string) => {
      const parse = parseQr(raw, "label", labelFormats);
      if (!parse.ok) {
        dispatch({
          type: "fail",
          error: `読取失敗: ${parse.reason}`,
        });
        return;
      }
      // UC-2 free read: label-only. Build a permissive "always ok" match so
      // the rest of the state machine has the same shape as picking.
      const outcome: MatchOutcome = {
        matchResult: "ok",
        withWarnings: false,
        detail: [],
      };
      dispatch({ type: "scan_label", parsed: parse.parsedValues });
      dispatch({ type: "set_match", outcome });
      // Pre-fill quantity/location if the label QR carried them.
      if (typeof parse.parsedValues.quantity === "number") {
        setQuantity(String(parse.parsedValues.quantity));
      }
      if (typeof parse.parsedValues.location_code === "string") {
        setLocationCode(parse.parsedValues.location_code);
      }
    },
    [labelFormats],
  );

  const handleAbort = useCallback(() => {
    dispatch({ type: "reset" });
    setQuantity("");
    setLocationCode("");
    setError(null);
    router.push("/app/logi");
  }, [router]);

  const activeStepId = !state.label
    ? "label"
    : !quantity
      ? "quantity"
      : "location";

  const canSubmit =
    decideCanSubmit(state.match, ngFlow) && Number(quantity) >= 0 && state.label;

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
        business_code: "receiving",
        movement_plan_line_id: null,
        item_code: itemCode,
        quantity: qty,
        lot:
          typeof state.label?.lot === "string"
            ? (state.label?.lot as string)
            : null,
        location_code: locationCode || null,
        match_result: state.match?.matchResult ?? "ok",
        match_detail: state.match?.detail ?? [],
        notes: null,
      });
      if (result.error) {
        setError(`${result.error.code}: ${result.error.message}`);
        return;
      }
      setSuccess(
        `入庫を登録しました (id=${result.data?.id?.slice(0, 8) ?? "?"})`,
      );
      dispatch({ type: "submit_success" });
      setQuantity("");
      setLocationCode("");
      setConfirmingWarn(false);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <StepHeader
        steps={STEPS}
        activeStepId={activeStepId}
        title="入庫"
        onAbort={handleAbort}
      />

      <NgFlowToggle
        ngFlow={ngFlow}
        onChange={(v) => {
          setNgFlow(v);
          dispatch({ type: "reset" });
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

      <section aria-labelledby="receive-scan" className="flex flex-col gap-3">
        <h2
          id="receive-scan"
          className="text-base font-semibold text-[var(--ink)]"
        >
          1. 現品ラベル QR を読取
        </h2>
        {/* 3-layer stack per scanner-overlay.md §Solution.
            Scanner viewport + nested ResultOverlay bottom-sheet keep the
            user's eye on the camera surface while the OK/NG verdict fades
            in below. When the label has been read we swap the Scanner for
            the parsed-values readout but keep ResultOverlay floating at
            the bottom of the same visual stack. */}
        {state.step === "submitted" || state.label ? (
          <div
            data-testid="receive-read-stack"
            className="relative flex aspect-[4/3] w-full flex-col overflow-hidden border-2 border-[var(--color-ok)] bg-[var(--surface)] p-3 text-sm"
          >
            <p className="font-mono text-xs text-[var(--muted)]">読取済み</p>
            <dl className="mt-2 grid grid-cols-2 gap-1 overflow-auto text-xs">
              {Object.entries(state.label ?? {}).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-[var(--muted)]">{k}</dt>
                  <dd className="font-mono text-[var(--ink)]">
                    {v === null ? "(空)" : String(v)}
                  </dd>
                </div>
              ))}
            </dl>
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="mt-2 self-start"
              onClick={() => dispatch({ type: "reset" })}
            >
              再スキャン
            </Button>
            <div
              data-testid="scanner-bottom-overlay"
              className="pointer-events-none absolute inset-x-0 bottom-0 z-30"
            >
              <div className="pointer-events-auto">
                <ResultOverlay
                  outcome={state.match}
                  ngFlow={ngFlow}
                  onRescan={() => dispatch({ type: "reset" })}
                />
              </div>
            </div>
          </div>
        ) : (
          <Scanner
            onResult={handleScan}
            cancelLabel="中止"
            bottomOverlay={
              <ResultOverlay
                outcome={state.match}
                ngFlow={ngFlow}
                onRescan={() => dispatch({ type: "reset" })}
              />
            }
          />
        )}
      </section>

      <section
        aria-labelledby="receive-input"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <h2
          id="receive-input"
          className="col-span-full text-base font-semibold text-[var(--ink)]"
        >
          3. 数量とロケーション
        </h2>
        <Field
          label="実数量"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          data-testid="receive-quantity"
        />
        <Field
          label="ロケーション (任意)"
          value={locationCode}
          onChange={(e) => setLocationCode(e.target.value)}
          data-testid="receive-location"
        />
      </section>

      <section
        aria-labelledby="receive-submit"
        className="flex flex-wrap items-center gap-3"
      >
        <h2 id="receive-submit" className="sr-only">
          登録
        </h2>
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={submit}
          disabled={!canSubmit || pending}
          data-testid="receive-submit"
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
