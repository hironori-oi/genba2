"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { TextArea } from "@/components/ui/TextArea";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { isErr } from "@/lib/admin/shared/result";
import {
  submitInventoryCorrectionAction,
  type SubmitInventoryCorrectionInput,
} from "./actions";

export type InventoryRow = {
  id: string;
  itemCode: string;
  countedQuantity: number;
  lot: string | null;
  locationCode: string | null;
  notes: string | null;
  recordedAt: string;
  previousRecordId: string | null;
};

type DraftPayload = SubmitInventoryCorrectionInput["payload"];

function rowToDraft(row: InventoryRow): DraftPayload {
  return {
    item_code: row.itemCode,
    counted_quantity: row.countedQuantity,
    lot: row.lot,
    location_code: row.locationCode,
    notes: row.notes,
  };
}

export function InventoryCorrectionsList({
  rows,
  prefillId,
}: {
  rows: InventoryRow[];
  prefillId?: string | null;
}) {
  const [target, setTarget] = useState<InventoryRow | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const [draft, setDraft] = useState<DraftPayload | null>(null);
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, startTransition] = useTransition();
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  function openCorrection(row: InventoryRow) {
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
      const result = await submitInventoryCorrectionAction({
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
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillId, rows]);

  return (
    <section className="flex flex-col gap-4" data-testid="inventory-corrections">
      {notice ? (
        <Alert tone="info" title="保存完了">
          {notice}
        </Alert>
      ) : null}

      {visibleRows.length === 0 ? (
        <Alert tone="info" title="対象がありません">
          自分が登録した未訂正の棚卸記録は見つかりませんでした。
        </Alert>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="inventory-list">
          {visibleRows.map((row) => (
            <li
              key={row.id}
              ref={(el) => {
                if (el) rowRefs.current.set(row.id, el);
                else rowRefs.current.delete(row.id);
              }}
              data-testid={`inventory-row-${row.id}`}
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
                  棚卸 · {new Date(row.recordedAt).toLocaleString("ja-JP")}
                </span>
                <span className="text-[var(--ink)]">
                  {row.itemCode} × {row.countedQuantity}
                  {row.lot ? ` / ロット ${row.lot}` : ""}
                  {row.locationCode ? ` @ ${row.locationCode}` : ""}
                </span>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                data-testid={`inventory-correct-${row.id}`}
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
          data-testid="inventory-correction-form"
        >
          <header className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-[var(--ink)]">棚卸の訂正</h2>
            <p className="text-xs text-[var(--muted)]">
              旧: {target.itemCode} × {target.countedQuantity}
              {target.lot ? ` / ロット ${target.lot}` : ""}
              {target.locationCode ? ` @ ${target.locationCode}` : ""}
            </p>
          </header>

          <Field
            label="品目コード"
            value={draft.item_code}
            onChange={(e) => setDraft({ ...draft, item_code: e.target.value })}
            data-testid="inventory-correction-item-code"
            error={fieldErrors["payload.item_code"]}
            required
          />
          <Field
            label="実数量"
            type="number"
            step="any"
            value={String(draft.counted_quantity)}
            onChange={(e) =>
              setDraft({ ...draft, counted_quantity: Number(e.target.value) })
            }
            data-testid="inventory-correction-counted-quantity"
            error={fieldErrors["payload.counted_quantity"]}
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
            data-testid="inventory-correction-lot"
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
            data-testid="inventory-correction-location"
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
            data-testid="inventory-correction-notes"
            error={fieldErrors["payload.notes"]}
            rows={2}
            maxLength={1000}
          />
          <TextArea
            label="訂正の理由"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-testid="inventory-correction-reason"
            error={fieldErrors["reason"]}
            hint="1〜256 文字。corrections_audit に保存されます。"
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
              data-testid="inventory-correction-submit"
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
