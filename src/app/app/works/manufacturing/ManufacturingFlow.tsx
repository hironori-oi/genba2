"use client";

/**
 * Phase 4c — 製造実績 (Manufacturing) flow.
 *
 * UC-4 の作業者向けエントリ。Phase 3b LOGI flow (Inventory) と同じ構造で
 * StepHeader + 縦 Section + 登録 Button で組む。
 *
 *   1. 工程 (ProcessSelector) — mfg_processes.id を選択 / 入力
 *   2. 実績 (work_date / actual_quantity / lot / equipment_id / started_at / ended_at)
 *   3. 不適合 (DefectListInput) — 任意の defects[]
 *   4. 入庫 (ProduceInflowToggle) — 製造入庫 movement_records 1 件を同 tx で
 *   5. 登録 — submitManufacturingRecord 呼び出し
 *
 * tenant_id / worker_id は本コンポーネントから *絶対に* 送らない。Phase 4a
 * 移行 + Phase 4b RPC が `app.current_tenant_id()` / `auth.uid()` で pin する。
 */

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StepHeader } from "@/components/scanner/StepHeader";
import { Scanner } from "@/components/scanner/Scanner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import {
  DefectListInput,
  type DefectRow,
} from "@/components/works/DefectListInput";
import {
  ProcessSelector,
  type ProcessOption,
} from "@/components/works/ProcessSelector";
import {
  ProduceInflowToggle,
  initialProduceInflow,
  type ProduceInflowValue,
} from "@/components/works/ProduceInflowToggle";
import { submitManufacturingRecord } from "@/lib/works/actions";

const STEPS = [
  { id: "process", label: "工程" },
  { id: "record", label: "実績" },
  { id: "defects", label: "不適合" },
  { id: "inflow", label: "入庫" },
  { id: "submit", label: "登録" },
];

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type Props = {
  /** mfg_processes 候補 (server fetch 済み). 未供給 / 空配列なら手入力モード. */
  processOptions?: ReadonlyArray<ProcessOption>;
  /** 不適合マスタ候補 (server fetch 済み). 未供給なら UUID 直入力. */
  defectOptions?: ReadonlyArray<{ id: string; label: string }>;
};

/**
 * Pure derivation of "登録 を有効化してよいか" (decideCanSubmit と同方針).
 * 入力欠落・型不整合・defect 内訳不一致を Phase 4b zod 検証より手前で UI に
 * 伝える。zod 側はサーバ着 後の最後の砦として残す。
 */
export function decideCanSubmitManufacturing(input: {
  mfgProcessId: string;
  actualQuantity: number | null;
  goodQuantity: number | null;
  defectQuantity: number | null;
  defects: DefectRow[];
  inflow: ProduceInflowValue;
  startedAt: string | null;
  endedAt: string | null;
}): boolean {
  if (!UUID_RE.test(input.mfgProcessId)) return false;
  if (
    input.actualQuantity === null ||
    !Number.isFinite(input.actualQuantity) ||
    input.actualQuantity < 0
  )
    return false;
  if (
    input.defectQuantity !== null &&
    (!Number.isFinite(input.defectQuantity) || input.defectQuantity < 0)
  )
    return false;
  if (
    input.goodQuantity !== null &&
    (!Number.isFinite(input.goodQuantity) || input.goodQuantity < 0)
  )
    return false;
  if (input.startedAt && input.endedAt) {
    const s = Date.parse(input.startedAt);
    const e = Date.parse(input.endedAt);
    if (Number.isFinite(s) && Number.isFinite(e) && e < s) return false;
  }
  for (const d of input.defects) {
    if (!UUID_RE.test(d.defect_id)) return false;
    if (
      d.defect_quantity === null ||
      !Number.isFinite(d.defect_quantity) ||
      d.defect_quantity < 0
    )
      return false;
  }
  if (input.inflow.enabled) {
    if (input.inflow.item_code.length === 0) return false;
    if (
      input.inflow.quantity === null ||
      !Number.isFinite(input.inflow.quantity) ||
      input.inflow.quantity < 0
    )
      return false;
  }
  return true;
}

function toLocalIsoString(value: string): string | null {
  // <input type="datetime-local"> は "YYYY-MM-DDTHH:MM" を返す。秒 + UTC suffix
  // を足して ISO-8601 datetime にする。空文字は null へ畳む。
  if (value.length === 0) return null;
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  // tz 情報がない場合はローカル時刻として解釈→ ISO へ変換する。
  const date = new Date(withSeconds);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function ManufacturingFlow({
  processOptions = [],
  defectOptions = [],
}: Props) {
  const router = useRouter();
  const [mfgProcessId, setMfgProcessId] = useState<string>("");
  const today = new Date().toISOString().slice(0, 10);
  const [workDate, setWorkDate] = useState<string>(today);
  const [actualQuantity, setActualQuantity] = useState<string>("");
  const [goodQuantity, setGoodQuantity] = useState<string>("");
  const [defectQuantity, setDefectQuantity] = useState<string>("0");
  const [lot, setLot] = useState<string>("");
  const [equipmentId, setEquipmentId] = useState<string>("");
  const [startedAt, setStartedAt] = useState<string>("");
  const [endedAt, setEndedAt] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [defects, setDefects] = useState<DefectRow[]>([]);
  const [inflow, setInflow] = useState<ProduceInflowValue>(initialProduceInflow);
  const [scanOpen, setScanOpen] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const activeStepId = !mfgProcessId
    ? "process"
    : !actualQuantity
      ? "record"
      : defects.length === 0 && !inflow.enabled
        ? "defects"
        : !success
          ? "submit"
          : "submit";

  const actualQuantityNum = actualQuantity.length > 0 ? Number(actualQuantity) : null;
  const goodQuantityNum =
    goodQuantity.length > 0 ? Number(goodQuantity) : null;
  const defectQuantityNum =
    defectQuantity.length > 0 ? Number(defectQuantity) : null;

  const canSubmit = decideCanSubmitManufacturing({
    mfgProcessId,
    actualQuantity: actualQuantityNum,
    goodQuantity: goodQuantityNum,
    defectQuantity: defectQuantityNum,
    defects,
    inflow,
    startedAt: startedAt.length > 0 ? toLocalIsoString(startedAt) : null,
    endedAt: endedAt.length > 0 ? toLocalIsoString(endedAt) : null,
  });

  const handleAbort = useCallback(() => {
    router.push("/app/logi");
  }, [router]);

  const handleProcessScan = useCallback((raw: string) => {
    // 工程 QR は UUID のみを期待する simplest 解釈。専用 QR フォーマット
    // (例: header) は Phase 5 で導入する。
    const trimmed = raw.trim();
    if (UUID_RE.test(trimmed)) {
      setMfgProcessId(trimmed);
      setScanError(null);
      setScanOpen(false);
      return;
    }
    setScanError(
      "工程 ID として認識できませんでした。UUID 形式を期待します (手入力に切替可能)。",
    );
  }, []);

  const submit = () => {
    setSubmitError(null);
    setSuccess(null);
    if (!canSubmit) {
      setSubmitError("入力に不備があります (工程 ID / 数量 / 不適合 を確認してください)。");
      return;
    }

    startTransition(async () => {
      const payload = {
        mfg_process_id: mfgProcessId,
        work_date: workDate || undefined,
        actual_quantity: actualQuantityNum ?? 0,
        good_quantity: goodQuantityNum,
        defect_quantity: defectQuantityNum ?? 0,
        lot: lot.length > 0 ? lot : null,
        equipment_id: equipmentId.length > 0 ? equipmentId : null,
        started_at: startedAt.length > 0 ? toLocalIsoString(startedAt) : null,
        ended_at: endedAt.length > 0 ? toLocalIsoString(endedAt) : null,
        match_result: "ok" as const,
        match_detail: [],
        notes: notes.length > 0 ? notes : null,
        defects: defects.map((d) => ({
          defect_id: d.defect_id,
          defect_quantity: d.defect_quantity,
          notes: d.notes,
        })),
        produce_inflow: inflow.enabled
          ? {
              item_code: inflow.item_code,
              quantity: inflow.quantity,
              location_code: inflow.location_code,
              lot: inflow.lot,
              notes: inflow.notes,
            }
          : null,
      };

      const result = await submitManufacturingRecord(payload);
      if (result.error) {
        setSubmitError(`${result.error.code}: ${result.error.message}`);
        return;
      }
      setSuccess(
        `製造実績を登録しました (id=${result.data?.manufacturingRecordId.slice(0, 8) ?? "?"}, defects=${result.data?.defectIds.length ?? 0}, inflow=${result.data?.movementRecordId ? "あり" : "なし"})`,
      );
    });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="manufacturing-flow">
      <StepHeader
        steps={STEPS}
        activeStepId={activeStepId}
        title="製造実績"
        onAbort={handleAbort}
      />

      {success ? (
        <Alert tone="ok" title="登録しました">
          {success}
        </Alert>
      ) : null}
      {submitError ? (
        <Alert tone="error" title="登録エラー">
          {submitError}
        </Alert>
      ) : null}

      <section
        aria-labelledby="mfg-process"
        className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <h2
          id="mfg-process"
          className="text-base font-semibold text-[var(--ink)]"
        >
          1. 工程
        </h2>
        <p className="text-xs text-[var(--muted)]">
          製造予定 (mfg_processes) のうち、これから記録する工程を選択します。
          帳票明細 QR があればカメラで読取れます。
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={scanOpen ? "ghost" : "secondary"}
            size="md"
            onClick={() => {
              setScanOpen((s) => !s);
              setScanError(null);
            }}
            data-testid="process-scan-toggle"
          >
            {scanOpen ? "QR 読取を閉じる" : "QR で工程を選ぶ"}
          </Button>
        </div>

        {scanOpen ? (
          <div data-testid="process-scanner">
            <Scanner
              onResult={handleProcessScan}
              onCancel={() => setScanOpen(false)}
              cancelLabel="QR 読取を閉じる"
              manualPlaceholder="例: 00000000-0000-0000-0000-000000000000"
            />
          </div>
        ) : null}

        {scanError ? (
          <Alert tone="warn" title="QR 読取エラー">
            {scanError}
          </Alert>
        ) : null}

        <ProcessSelector
          value={mfgProcessId}
          onChange={setMfgProcessId}
          options={processOptions}
        />
      </section>

      <section
        aria-labelledby="mfg-record"
        className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <h2
          id="mfg-record"
          className="text-base font-semibold text-[var(--ink)]"
        >
          2. 実績
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="作業日"
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
            data-testid="mfg-work-date"
          />
          <Field
            label="実数量"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            required
            value={actualQuantity}
            onChange={(e) => setActualQuantity(e.target.value)}
            data-testid="mfg-actual-quantity"
          />
          <Field
            label="良品数 (任意)"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={goodQuantity}
            onChange={(e) => setGoodQuantity(e.target.value)}
            hint="未入力なら server 側で実数量から推定"
            data-testid="mfg-good-quantity"
          />
          <Field
            label="不適合数 (defect_quantity 合計)"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={defectQuantity}
            onChange={(e) => setDefectQuantity(e.target.value)}
            data-testid="mfg-defect-quantity"
          />
          <Field
            label="ロット"
            value={lot}
            onChange={(e) => setLot(e.target.value)}
            placeholder="任意"
            data-testid="mfg-lot"
          />
          <Field
            label="設備 ID (UUID, 任意)"
            value={equipmentId}
            onChange={(e) => setEquipmentId(e.target.value.trim())}
            placeholder="任意"
            data-testid="mfg-equipment-id"
          />
          <Field
            label="開始時刻 (任意)"
            type="datetime-local"
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
            data-testid="mfg-started-at"
          />
          <Field
            label="終了時刻 (任意)"
            type="datetime-local"
            value={endedAt}
            onChange={(e) => setEndedAt(e.target.value)}
            data-testid="mfg-ended-at"
            hint={
              startedAt && endedAt && Date.parse(endedAt) < Date.parse(startedAt)
                ? "終了は開始以降にしてください"
                : undefined
            }
          />
          <Field
            label="備考 (任意)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="sm:col-span-2"
            data-testid="mfg-notes"
          />
        </div>
      </section>

      <section
        aria-labelledby="mfg-defects"
        className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <h2
          id="mfg-defects"
          className="text-base font-semibold text-[var(--ink)]"
        >
          3. 不適合 (N)
        </h2>
        <DefectListInput
          value={defects}
          onChange={setDefects}
          defectOptions={defectOptions}
        />
      </section>

      <section
        aria-labelledby="mfg-inflow"
        className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <h2
          id="mfg-inflow"
          className="text-base font-semibold text-[var(--ink)]"
        >
          4. 製造入庫 (同時記録)
        </h2>
        <p className="text-xs text-[var(--muted)]">
          良品を製造入庫として movement_records に同 transaction で書き込みます (任意)。
          UNIQUE index により二重記録は server 側で拒否されます (R-P4-04)。
        </p>
        <ProduceInflowToggle value={inflow} onChange={setInflow} />
      </section>

      <section
        aria-labelledby="mfg-submit"
        className="flex flex-wrap items-center gap-3"
      >
        <h2 id="mfg-submit" className="sr-only">
          登録
        </h2>
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={submit}
          disabled={!canSubmit || pending}
          data-testid="mfg-submit"
        >
          {pending ? "登録中…" : "製造実績を登録"}
        </Button>
        {!canSubmit ? (
          <span
            className="text-xs text-[var(--muted)]"
            data-testid="mfg-submit-hint"
          >
            工程 ID と実数量を入力すると登録できます。
          </span>
        ) : null}
      </section>
    </div>
  );
}
