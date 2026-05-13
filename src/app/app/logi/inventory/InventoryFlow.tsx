"use client";

/**
 * Phase 3b — 棚卸 (Inventory) flow.
 *
 * UC-3: select plan → CSV import → location QR → label QR → 実数量 → submit.
 * After registering records, the worker can download the variance CSV
 * (差異 CSV) via serializeCsv.
 */

import { useCallback, useMemo, useReducer, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StepHeader } from "@/components/scanner/StepHeader";
import { Scanner } from "@/components/scanner/Scanner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { CsvUploadButton } from "@/components/csv/CsvUploadButton";
import { parseQr } from "@/lib/qr/parser";
import { validateLocationScan } from "@/lib/qr/location-validate";
import type { QrFormatDefinition } from "@/lib/qr/types";
import {
  initialScannerState,
  scannerReducer,
} from "@/components/scanner/scanner-state";
import { insertInventoryRecord } from "@/lib/logi/actions";
import { serializeCsv } from "@/lib/csv/sanitize";

const STEPS = [
  { id: "plan", label: "棚卸計画" },
  { id: "csv", label: "CSV 取込" },
  { id: "location", label: "ロケ QR" },
  { id: "label", label: "ラベル QR" },
  { id: "count", label: "実数量" },
  { id: "submit", label: "登録" },
];

type Props = {
  labelFormats: QrFormatDefinition[];
  locationFormats?: QrFormatDefinition[];
};

type CountedRow = {
  itemCode: string;
  locationCode: string | null;
  countedQuantity: number;
  expectedQuantity: number | null;
};

export function InventoryFlow({ labelFormats, locationFormats }: Props) {
  const router = useRouter();
  const [planCode, setPlanCode] = useState<string>("");
  const [csvUploaded, setCsvUploaded] = useState<boolean>(false);
  const [locationCode, setLocationCode] = useState<string>("");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [counted, setCounted] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rows, setRows] = useState<CountedRow[]>([]);

  const [state, dispatch] = useReducer(
    scannerReducer,
    "block" as const,
    initialScannerState,
  );

  const handleScanLocation = useCallback(
    (raw: string) => {
      const result = validateLocationScan(raw, locationFormats);
      if (!result.ok) {
        if (result.reason === "pattern_mismatch") {
          setLocationError("ロケ QR 形式が一致しません");
        }
        return;
      }
      setLocationError(null);
      setLocationCode(result.code);
    },
    [locationFormats],
  );

  const handleScanLabel = useCallback(
    (raw: string) => {
      const p = parseQr(raw, "label", labelFormats);
      if (!p.ok) {
        dispatch({ type: "fail", error: `ラベル読取失敗: ${p.reason}` });
        return;
      }
      dispatch({ type: "scan_label", parsed: p.parsedValues });
      if (typeof p.parsedValues.quantity === "number") {
        setCounted(String(p.parsedValues.quantity));
      }
    },
    [labelFormats],
  );

  const activeStepId = !planCode
    ? "plan"
    : !csvUploaded
      ? "csv"
      : !locationCode
        ? "location"
        : !state.label
          ? "label"
          : !counted
            ? "count"
            : "submit";

  const canSubmit =
    !!state.label &&
    !!locationCode &&
    Number(counted) >= 0 &&
    Number.isFinite(Number(counted));

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
    const qty = Number(counted);
    if (!Number.isFinite(qty) || qty < 0) {
      setError("実数量を正しく入力してください (0 以上)");
      return;
    }

    startTransition(async () => {
      const result = await insertInventoryRecord({
        inventory_plan_line_id: null,
        item_code: itemCode,
        counted_quantity: qty,
        location_code: locationCode || null,
        lot:
          typeof state.label?.lot === "string"
            ? (state.label?.lot as string)
            : null,
        match_result: "ok",
        match_detail: [],
        notes: null,
      });
      if (result.error) {
        setError(`${result.error.code}: ${result.error.message}`);
        return;
      }
      setSuccess(
        `棚卸記録を登録しました (id=${result.data?.id?.slice(0, 8) ?? "?"})`,
      );
      // Track the row in-memory for the variance CSV.
      const expectedRaw = state.label?.quantity;
      const expectedQuantity =
        typeof expectedRaw === "number" ? expectedRaw : null;
      setRows((prev) => [
        ...prev,
        {
          itemCode,
          locationCode: locationCode || null,
          countedQuantity: qty,
          expectedQuantity,
        },
      ]);
      // Reset for the next item but keep the plan + CSV state.
      dispatch({ type: "submit_success" });
      setCounted("");
    });
  };

  const handleAbort = useCallback(() => {
    dispatch({ type: "reset" });
    router.push("/app/logi");
  }, [router]);

  const varianceCsv = useMemo(() => {
    const header = [
      "item_code",
      "location_code",
      "expected_quantity",
      "counted_quantity",
      "diff",
    ];
    const body = rows
      .filter(
        (r) =>
          r.expectedQuantity !== null &&
          r.countedQuantity !== r.expectedQuantity,
      )
      .map((r) => [
        r.itemCode,
        r.locationCode ?? "",
        r.expectedQuantity ?? "",
        r.countedQuantity,
        (r.expectedQuantity ?? 0) - r.countedQuantity,
      ]);
    return serializeCsv([header, ...body]);
  }, [rows]);

  const downloadVarianceCsv = useCallback(() => {
    const blob = new Blob([varianceCsv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-variance-${planCode || "draft"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [planCode, varianceCsv]);

  return (
    <div className="flex flex-col gap-4">
      <StepHeader
        steps={STEPS}
        activeStepId={activeStepId}
        title="棚卸"
        onAbort={handleAbort}
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

      <section
        aria-labelledby="inv-plan"
        className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <h2
          id="inv-plan"
          className="text-base font-semibold text-[var(--ink)]"
        >
          1. 棚卸計画
        </h2>
        <Field
          label="棚卸計画コード"
          placeholder="例: INV-2026-05"
          value={planCode}
          onChange={(e) => setPlanCode(e.target.value)}
          data-testid="inv-plan-code"
        />
      </section>

      <section
        aria-labelledby="inv-csv"
        className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <h2
          id="inv-csv"
          className="text-base font-semibold text-[var(--ink)]"
        >
          2. 棚卸明細 CSV 取込
        </h2>
        <CsvUploadButton
          kind="inventory-plan-line"
          demoMode
          onUploaded={() => setCsvUploaded(true)}
        />
        {csvUploaded ? (
          <p
            data-testid="inv-csv-uploaded"
            className="text-xs text-[var(--color-ok)]"
          >
            CSV 取込が完了しました。
          </p>
        ) : null}
      </section>

      <section
        aria-labelledby="inv-loc"
        className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <h2
          id="inv-loc"
          className="text-base font-semibold text-[var(--ink)]"
        >
          3. ロケーション QR
        </h2>
        {locationCode ? (
          <p className="font-mono text-sm">
            {locationCode}{" "}
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => {
                setLocationCode("");
                setLocationError(null);
              }}
              className="ml-2"
            >
              変更
            </Button>
          </p>
        ) : (
          <>
            <Scanner
              onResult={handleScanLocation}
              cancelLabel="中止"
              manualPlaceholder="例: A-03-15"
            />
            {locationError ? (
              <p
                role="alert"
                data-testid="inv-location-error"
                className="text-xs text-[var(--color-bad)]"
              >
                {locationError}
              </p>
            ) : null}
          </>
        )}
      </section>

      <section
        aria-labelledby="inv-label"
        className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <h2
          id="inv-label"
          className="text-base font-semibold text-[var(--ink)]"
        >
          4. ラベル QR
        </h2>
        {state.label ? (
          <div className="text-xs">
            <p className="font-mono text-[var(--muted)]">読取済み</p>
            <dl className="mt-1 grid grid-cols-2 gap-1">
              {Object.entries(state.label).map(([k, v]) => (
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
              className="mt-2"
              onClick={() => dispatch({ type: "reset" })}
            >
              再スキャン
            </Button>
          </div>
        ) : (
          <Scanner
            onResult={handleScanLabel}
            cancelLabel="中止"
            manualPlaceholder="例: V1|ITEM-2048|12|A-03-15|ORD-1"
          />
        )}
      </section>

      <section
        aria-labelledby="inv-count"
        className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <h2
          id="inv-count"
          className="text-base font-semibold text-[var(--ink)]"
        >
          5. 実数量
        </h2>
        <Field
          label="実数量"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={counted}
          onChange={(e) => setCounted(e.target.value)}
          data-testid="inv-counted"
        />
      </section>

      <section
        aria-labelledby="inv-submit"
        className="flex flex-wrap items-center gap-3"
      >
        <h2 id="inv-submit" className="sr-only">
          登録
        </h2>
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={submit}
          disabled={!canSubmit || pending}
          data-testid="inv-submit"
        >
          {pending ? "登録中…" : "登録"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={downloadVarianceCsv}
          disabled={rows.length === 0}
          data-testid="inv-diff-csv"
        >
          差異 CSV を出力
        </Button>
      </section>

      {rows.length > 0 ? (
        <section
          aria-labelledby="inv-counted-list"
          className="border border-[var(--border)] bg-[var(--surface)] p-4"
        >
          <h2
            id="inv-counted-list"
            className="text-base font-semibold text-[var(--ink)]"
          >
            登録済み ({rows.length})
          </h2>
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {rows.map((r, idx) => {
              const diff =
                r.expectedQuantity === null
                  ? null
                  : r.expectedQuantity - r.countedQuantity;
              return (
                <li
                  key={`${r.itemCode}-${idx}`}
                  className="flex flex-wrap items-baseline gap-2 border-b border-[var(--border)] py-1 font-mono"
                >
                  <span className="text-[var(--ink)]">{r.itemCode}</span>
                  <span className="text-[var(--muted)]">
                    @ {r.locationCode ?? "-"}
                  </span>
                  <span className="ml-auto text-[var(--ink)]">
                    実: {r.countedQuantity}
                    {r.expectedQuantity !== null
                      ? ` / 計画: ${r.expectedQuantity}`
                      : ""}
                  </span>
                  {diff !== null && diff !== 0 ? (
                    <span className="text-[var(--color-warn)]">
                      差異 {diff > 0 ? `+${diff}` : diff}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
