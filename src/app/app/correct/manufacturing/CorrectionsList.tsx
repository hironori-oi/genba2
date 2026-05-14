"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { TextArea } from "@/components/ui/TextArea";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { isErr } from "@/lib/admin/shared/result";
import {
  submitManufacturingCorrectionAction,
  type SubmitManufacturingCorrectionInput,
} from "./actions";

export type ManufacturingRow = {
  id: string;
  workDate: string;
  actualQuantity: number;
  goodQuantity: number | null;
  defectQuantity: number;
  lot: string | null;
  startedAt: string | null;
  endedAt: string | null;
  notes: string | null;
  recordedAt: string;
  previousRecordId: string | null;
};

type DraftPayload = SubmitManufacturingCorrectionInput["payload"];

function rowToDraft(row: ManufacturingRow): DraftPayload {
  return {
    work_date: row.workDate,
    actual_quantity: row.actualQuantity,
    good_quantity: row.goodQuantity,
    defect_quantity: row.defectQuantity,
    lot: row.lot,
    started_at: row.startedAt,
    ended_at: row.endedAt,
    notes: row.notes,
    rollback_inflow: false,
  };
}

export function ManufacturingCorrectionsList({
  rows,
  prefillId,
}: {
  rows: ManufacturingRow[];
  prefillId?: string | null;
}) {
  const [target, setTarget] = useState<ManufacturingRow | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const [draft, setDraft] = useState<DraftPayload | null>(null);
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, startTransition] = useTransition();
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  function openCorrection(row: ManufacturingRow) {
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
      const result = await submitManufacturingCorrectionAction({
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
      setNotice(
        result.data.rolledBackInflow
          ? "訂正を保存しました。製造入庫もロールバックしました。"
          : "訂正を保存しました。製造入庫はそのまま残しています。",
      );
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
    <section
      className="flex flex-col gap-4"
      data-testid="manufacturing-corrections"
    >
      {notice ? (
        <Alert tone="info" title="保存完了">
          {notice}
        </Alert>
      ) : null}

      {visibleRows.length === 0 ? (
        <Alert tone="info" title="対象がありません">
          自分が登録した未訂正の製造実績は見つかりませんでした。
        </Alert>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="manufacturing-list">
          {visibleRows.map((row) => (
            <li
              key={row.id}
              ref={(el) => {
                if (el) rowRefs.current.set(row.id, el);
                else rowRefs.current.delete(row.id);
              }}
              data-testid={`manufacturing-row-${row.id}`}
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
                  製造 · {row.workDate}
                </span>
                <span className="text-[var(--ink)]">
                  実 {row.actualQuantity} / 良{" "}
                  {row.goodQuantity ?? "—"} / 不適 {row.defectQuantity}
                  {row.lot ? ` / ロット ${row.lot}` : ""}
                </span>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                data-testid={`manufacturing-correct-${row.id}`}
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
          data-testid="manufacturing-correction-form"
        >
          <header className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-[var(--ink)]">
              製造実績の訂正
            </h2>
            <p className="text-xs text-[var(--muted)]">
              旧: 実 {target.actualQuantity} / 良{" "}
              {target.goodQuantity ?? "—"} / 不適 {target.defectQuantity}
              {target.lot ? ` / ロット ${target.lot}` : ""}
            </p>
          </header>

          <Field
            label="作業日"
            type="date"
            value={draft.work_date}
            onChange={(e) =>
              setDraft({ ...draft, work_date: e.target.value })
            }
            data-testid="manufacturing-correction-work-date"
            error={fieldErrors["payload.work_date"]}
            required
          />
          <Field
            label="実数量"
            type="number"
            step="any"
            value={String(draft.actual_quantity)}
            onChange={(e) =>
              setDraft({ ...draft, actual_quantity: Number(e.target.value) })
            }
            data-testid="manufacturing-correction-actual-quantity"
            error={fieldErrors["payload.actual_quantity"]}
            required
          />
          <Field
            label="良品数量 (省略可)"
            type="number"
            step="any"
            value={draft.good_quantity === null ? "" : String(draft.good_quantity)}
            onChange={(e) =>
              setDraft({
                ...draft,
                good_quantity:
                  e.target.value.length === 0 ? null : Number(e.target.value),
              })
            }
            data-testid="manufacturing-correction-good-quantity"
            error={fieldErrors["payload.good_quantity"]}
          />
          <Field
            label="不適合数量"
            type="number"
            step="any"
            value={String(draft.defect_quantity)}
            onChange={(e) =>
              setDraft({ ...draft, defect_quantity: Number(e.target.value) })
            }
            data-testid="manufacturing-correction-defect-quantity"
            error={fieldErrors["payload.defect_quantity"]}
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
            data-testid="manufacturing-correction-lot"
            error={fieldErrors["payload.lot"]}
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
            data-testid="manufacturing-correction-notes"
            error={fieldErrors["payload.notes"]}
            rows={2}
            maxLength={1000}
          />

          <label className="flex items-start gap-2 text-sm text-[var(--ink)]">
            <input
              type="checkbox"
              checked={draft.rollback_inflow}
              onChange={(e) =>
                setDraft({ ...draft, rollback_inflow: e.target.checked })
              }
              data-testid="manufacturing-correction-rollback-inflow"
              className="mt-1 h-5 w-5 border border-[var(--border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
            />
            <span>
              <span className="font-medium">紐付く製造入庫も同時に取り消す</span>
              <br />
              <span className="text-xs text-[var(--muted)]">
                既定は残します。意図せず在庫を動かさないため、必要なときだけ ON にしてください (R-P4-17 / 安全側 B 経路)。
              </span>
            </span>
          </label>

          <TextArea
            label="訂正の理由"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-testid="manufacturing-correction-reason"
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
              data-testid="manufacturing-correction-submit"
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
        title={
          draft?.rollback_inflow
            ? "製造入庫を取り消して訂正しますか?"
            : "この内容で訂正しますか?"
        }
        message={
          draft?.rollback_inflow
            ? "送信すると旧製造実績と紐付く製造入庫が同時に論理削除されます。在庫数が動くため、本当に必要か確認してください。"
            : "送信すると旧レコードは論理削除され、新レコードが登録されます。製造入庫はそのまま残ります。"
        }
        confirmLabel="訂正する"
        danger={Boolean(draft?.rollback_inflow)}
        busy={submitting}
        requireExplicit={Boolean(draft?.rollback_inflow)}
      />
    </section>
  );
}
