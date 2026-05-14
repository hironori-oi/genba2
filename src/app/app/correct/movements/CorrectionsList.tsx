"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { TextArea } from "@/components/ui/TextArea";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { isErr } from "@/lib/admin/shared/result";
import {
  submitMovementCorrectionAction,
  type SubmitMovementCorrectionInput,
} from "./actions";

export type MovementRow = {
  id: string;
  businessCode: "receiving" | "picking";
  itemCode: string;
  quantity: number;
  lot: string | null;
  locationCode: string | null;
  notes: string | null;
  recordedAt: string;
  previousRecordId: string | null;
};

const BUSINESS_LABEL: Record<"receiving" | "picking", string> = {
  receiving: "入庫",
  picking: "ピッキング",
};

type DraftPayload = SubmitMovementCorrectionInput["payload"];

function rowToDraft(row: MovementRow): DraftPayload {
  return {
    business_code: row.businessCode,
    item_code: row.itemCode,
    quantity: row.quantity,
    lot: row.lot,
    location_code: row.locationCode,
    notes: row.notes,
  };
}

export function MovementsCorrectionsList({
  rows,
  prefillId,
}: {
  rows: MovementRow[];
  prefillId?: string | null;
}) {
  const [target, setTarget] = useState<MovementRow | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const [draft, setDraft] = useState<DraftPayload | null>(null);
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, startTransition] = useTransition();
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  function openCorrection(row: MovementRow) {
    setTarget(row);
    setDraft(rowToDraft(row));
    setReason("");
    setFieldErrors({});
    setError(null);
    setNotice(null);
    setShowConfirm(false);
  }

  function closeCorrection() {
    setTarget(null);
    setDraft(null);
    setReason("");
    setFieldErrors({});
    setShowConfirm(false);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setShowConfirm(true);
  }

  function performSubmit() {
    if (!target || !draft) return;
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await submitMovementCorrectionAction({
        previousRecordId: target.id,
        reason,
        payload: draft,
      });
      if (isErr(result)) {
        setError(result.message);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        setShowConfirm(false);
        return;
      }
      setHiddenIds((prev) => new Set(prev).add(target.id));
      setNotice("訂正を保存しました。");
      closeCorrection();
    });
  }

  const visibleRows = rows.filter((r) => !hiddenIds.has(r.id));

  useEffect(() => {
    if (!prefillId) return;
    const match = rows.find((r) => r.id === prefillId);
    if (!match || hiddenIds.has(match.id)) return;
    if (target?.id === match.id) return;
    openCorrection(match);
    const el = rowRefs.current.get(match.id);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillId, rows]);

  return (
    <section className="flex flex-col gap-4" data-testid="movements-corrections">
      {notice ? (
        <Alert tone="info" title="保存完了">
          {notice}
        </Alert>
      ) : null}

      {visibleRows.length === 0 ? (
        <Alert tone="info" title="対象がありません">
          自分が登録した未訂正の入庫 / ピッキング記録は見つかりませんでした。
        </Alert>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="movements-list">
          {visibleRows.map((row) => (
            <li
              key={row.id}
              ref={(el) => {
                if (el) rowRefs.current.set(row.id, el);
                else rowRefs.current.delete(row.id);
              }}
              data-testid={`movements-row-${row.id}`}
              aria-current={prefillId === row.id ? "true" : undefined}
              className={
                "flex flex-col gap-2 border bg-[var(--surface)] p-3 sm:flex-row sm:items-center sm:justify-between " +
                (prefillId === row.id
                  ? "border-[var(--color-brand)] ring-1 ring-[var(--color-brand)]"
                  : "border-[var(--border)]")
              }
            >
              <div className="flex flex-col gap-1 text-sm">
                <span className="font-mono text-xs uppercase tracking-wide text-[var(--muted)]">
                  {BUSINESS_LABEL[row.businessCode]} ·{" "}
                  {new Date(row.recordedAt).toLocaleString("ja-JP")}
                </span>
                <span className="text-[var(--ink)]">
                  {row.itemCode} × {row.quantity}
                  {row.lot ? ` / ロット ${row.lot}` : ""}
                  {row.locationCode ? ` @ ${row.locationCode}` : ""}
                </span>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                data-testid={`movements-correct-${row.id}`}
                onClick={() => openCorrection(row)}
              >
                訂正する
              </Button>
            </li>
          ))}
        </ul>
      )}

      {target && draft ? (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 border border-[var(--color-brand)] bg-[var(--surface)] p-4"
          data-testid="movements-correction-form"
        >
          <header className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-[var(--ink)]">
              {BUSINESS_LABEL[target.businessCode]} の訂正
            </h2>
            <p className="text-xs text-[var(--muted)]">
              旧: {target.itemCode} × {target.quantity}
              {target.lot ? ` / ロット ${target.lot}` : ""}
              {target.locationCode ? ` @ ${target.locationCode}` : ""}
            </p>
          </header>

          <Field
            label="品目コード"
            value={draft.item_code}
            onChange={(e) =>
              setDraft({ ...draft, item_code: e.target.value })
            }
            data-testid="movements-correction-item-code"
            error={fieldErrors["payload.item_code"]}
            required
          />
          <Field
            label="数量"
            type="number"
            step="any"
            value={String(draft.quantity)}
            onChange={(e) =>
              setDraft({ ...draft, quantity: Number(e.target.value) })
            }
            data-testid="movements-correction-quantity"
            error={fieldErrors["payload.quantity"]}
            required
          />
          <Field
            label="ロット"
            value={draft.lot ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                lot: e.target.value.length > 0 ? e.target.value : null,
              })
            }
            data-testid="movements-correction-lot"
            error={fieldErrors["payload.lot"]}
          />
          <Field
            label="ロケーション"
            value={draft.location_code ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                location_code:
                  e.target.value.length > 0 ? e.target.value : null,
              })
            }
            data-testid="movements-correction-location"
            error={fieldErrors["payload.location_code"]}
          />
          <TextArea
            label="備考"
            value={draft.notes ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                notes: e.target.value.length > 0 ? e.target.value : null,
              })
            }
            data-testid="movements-correction-notes"
            error={fieldErrors["payload.notes"]}
            rows={2}
            maxLength={1000}
          />
          <TextArea
            label="訂正の理由"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-testid="movements-correction-reason"
            error={fieldErrors["reason"]}
            hint="1〜256 文字。corrections_audit に保存され、後から確認できます。"
            rows={3}
            maxLength={256}
            required
          />

          {error ? (
            <Alert tone="error" title="保存できませんでした">
              {error}
            </Alert>
          ) : null}

          <footer className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={closeCorrection}
              disabled={submitting}
            >
              キャンセル
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              data-testid="movements-correction-submit"
              disabled={submitting}
            >
              {submitting ? "送信中…" : "訂正を送信"}
            </Button>
          </footer>
        </form>
      ) : null}

      <ConfirmDialog
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={performSubmit}
        title="この内容で訂正しますか?"
        message="送信すると旧レコードは論理削除され、新レコードが registered_by = あなたとして保存されます。"
        confirmLabel="訂正する"
        danger
        busy={submitting}
      />
    </section>
  );
}
