"use client";

/**
 * Phase 6b — Receiving scan-first StepShell wrapper.
 *
 * Drives the receiving flow through the §B.1.3 StepShell primitive:
 *   1. scan label QR  (kind="scan")     → parsed payload
 *   2. input quantity (kind="input")    → numeric string
 *   3. input location (kind="input")    → free-form code (optional)
 * onComplete calls `insertMovementRecord` server action.
 *
 * Triggered by `?mode=scan` on /app/logi/receiving. When the URL lacks the
 * query param the page renders the legacy `ReceivingFlow` instead.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import {
  StepShell,
  type StepDef,
} from "@/components/scanner/StepShell";
import { parseQr } from "@/lib/qr/parser";
import type { ParsedValues, QrFormatDefinition } from "@/lib/qr/types";
import { insertMovementRecord } from "@/lib/logi/actions";

type LabelPayload = { kind: "label"; parsed: ParsedValues };
type QtyPayload = { kind: "qty"; value: number };
type LocPayload = { kind: "loc"; value: string | null };
type ReceivingPayload = LabelPayload | QtyPayload | LocPayload;

type Props = {
  labelFormats: QrFormatDefinition[];
  startMode: "scan" | "form";
};

export function ReceivingScanShell({ labelFormats, startMode }: Props) {
  const router = useRouter();
  const [submitted, setSubmitted] = useState<{ id: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const steps: StepDef<ReceivingPayload>[] = [
    {
      id: "label",
      title: "現品ラベル QR を読取",
      helper: "例: V1|ITEM-2048|12|A-03-15|ORD-1",
      kind: "scan",
      validate: async (raw) => {
        if (typeof raw !== "string") {
          return { error: "ラベル QR の文字列を読取できません" };
        }
        const parsed = parseQr(raw, "label", labelFormats);
        if (!parsed.ok) {
          return { error: `読取失敗: ${parsed.reason}` };
        }
        return { kind: "label", parsed: parsed.parsedValues } as LabelPayload;
      },
    },
    {
      id: "qty",
      title: "実数量を入力",
      helper: "0 以上の数値を半角で入力してください",
      kind: "input",
      validate: async (raw) => {
        const text = typeof raw === "string" ? raw : "";
        const value = Number(text);
        if (!Number.isFinite(value) || value < 0) {
          return { error: "数量は 0 以上の数値で入力してください" };
        }
        return { kind: "qty", value } as QtyPayload;
      },
    },
    {
      id: "loc",
      title: "ロケーション (任意)",
      helper: "空欄のままで登録できます",
      kind: "input",
      validate: async (raw) => {
        const text = typeof raw === "string" ? raw.trim() : "";
        return { kind: "loc", value: text.length === 0 ? null : text } as LocPayload;
      },
    },
  ];

  const onComplete = useCallback(
    async (collected: ReceivingPayload[]) => {
      const label = collected.find((c): c is LabelPayload => c.kind === "label");
      const qty = collected.find((c): c is QtyPayload => c.kind === "qty");
      const loc = collected.find((c): c is LocPayload => c.kind === "loc");
      if (!label) {
        throw new Error("ラベル QR が取得できませんでした");
      }
      const itemCode = label.parsed.item_code;
      if (typeof itemCode !== "string" || itemCode.length === 0) {
        throw new Error("ラベルから品目コードを取得できませんでした");
      }
      const result = await insertMovementRecord({
        business_code: "receiving",
        movement_plan_line_id: null,
        item_code: itemCode,
        quantity: qty?.value ?? 0,
        lot:
          typeof label.parsed.lot === "string"
            ? (label.parsed.lot as string)
            : null,
        location_code: loc?.value ?? null,
        match_result: "ok",
        match_detail: [],
        notes: null,
      });
      if (result.error) {
        setSubmitError(`${result.error.code}: ${result.error.message}`);
        throw new Error(result.error.message);
      }
      setSubmitted({ id: result.data?.id?.slice(0, 8) ?? "?" });
    },
    [],
  );

  if (submitted) {
    return (
      <div className="flex flex-col gap-4" data-testid="receiving-scan-completed">
        <Alert tone="ok" title="入庫を登録しました">
          ID: {submitted.id}
        </Alert>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={() => router.refresh()}
            data-testid="receiving-scan-again"
          >
            続けて登録
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => router.push("/app/logi")}
          >
            業務トップへ戻る
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="receiving-scan-shell">
      {submitError ? (
        <Alert tone="error" title="登録エラー">
          {submitError}
        </Alert>
      ) : null}
      <StepShell<ReceivingPayload>
        steps={steps}
        business="receiving"
        title="入庫 (Scan-first)"
        startMode={startMode}
        onComplete={onComplete}
      />
    </div>
  );
}
