"use client";

/**
 * Phase 4c — DefectListInput.
 *
 * 不適合 N 件 (defect rows) を可変長で入力する。R-P4-15 に従い UI 想定上限は
 * 20 件、DoS-defence cap は 32 件 (`MANUFACTURING_DEFECT_MAX`)。
 *
 * 各 row は `manufacturing_record_defects` テーブル INSERT 用の最小フィールド
 * (defect_id / defect_quantity / notes)。tenant_id / worker_id は client 側で
 * は持たない (RPC が pin する) ため、本 component の責務は zod 型 (zod schema
 * は `src/lib/works/validators.ts`) と 1:1 対応する。
 */

import { Plus, Trash2 } from "lucide-react";
import { useCallback, useId } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { MANUFACTURING_DEFECT_MAX } from "@/lib/works/validators";

export type DefectRow = {
  defect_id: string;
  defect_quantity: number;
  notes: string | null;
};

type Props = {
  value: DefectRow[];
  onChange: (next: DefectRow[]) => void;
  /** 不適合マスタが提供されていれば <select> で表示する。空 = 自由入力。 */
  defectOptions?: ReadonlyArray<{ id: string; label: string }>;
  /** Phase 5 で訂正 UI が出るまで read-only にするためのフラグ。 */
  disabled?: boolean;
};

export function DefectListInput({
  value,
  onChange,
  defectOptions,
  disabled = false,
}: Props) {
  const listId = useId();
  const canAdd = !disabled && value.length < MANUFACTURING_DEFECT_MAX;

  const addRow = useCallback(() => {
    if (!canAdd) return;
    onChange([
      ...value,
      { defect_id: "", defect_quantity: 0, notes: null },
    ]);
  }, [canAdd, onChange, value]);

  const updateRow = useCallback(
    (idx: number, patch: Partial<DefectRow>) => {
      const next = value.map((row, i) =>
        i === idx ? { ...row, ...patch } : row,
      );
      onChange(next);
    },
    [onChange, value],
  );

  const removeRow = useCallback(
    (idx: number) => {
      onChange(value.filter((_, i) => i !== idx));
    },
    [onChange, value],
  );

  return (
    <div className="flex flex-col gap-3" data-testid="defect-list">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--muted)]">
          不適合 (N) — 上限 {MANUFACTURING_DEFECT_MAX} 件 / 現在{" "}
          <span data-testid="defect-list-count" className="font-mono">
            {value.length}
          </span>{" "}
          件
        </p>
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={addRow}
          disabled={!canAdd}
          aria-controls={listId}
          data-testid="defect-add"
        >
          <Plus aria-hidden className="h-4 w-4" />
          不適合追加
        </Button>
      </div>

      <ul
        id={listId}
        aria-label="不適合一覧"
        aria-live="polite"
        className="flex flex-col gap-3"
      >
        {value.length === 0 ? (
          <li
            data-testid="defect-empty"
            className="border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-3 text-center text-xs text-[var(--muted)]"
          >
            不適合なし (N=0)。良品のみで登録します。
          </li>
        ) : (
          value.map((row, idx) => (
            <li
              key={idx}
              data-testid={`defect-row-${idx}`}
              className="grid grid-cols-1 gap-2 border border-[var(--border)] bg-[var(--surface)] p-3 sm:grid-cols-[2fr_1fr_2fr_auto]"
            >
              {defectOptions && defectOptions.length > 0 ? (
                <label className="flex flex-col gap-1 text-xs">
                  不適合コード
                  <select
                    value={row.defect_id}
                    onChange={(e) =>
                      updateRow(idx, { defect_id: e.target.value })
                    }
                    disabled={disabled}
                    data-testid={`defect-id-${idx}`}
                    className="h-12 border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                  >
                    <option value="">選択してください</option>
                    {defectOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <Field
                  label="不適合 ID (UUID)"
                  value={row.defect_id}
                  onChange={(e) =>
                    updateRow(idx, { defect_id: e.target.value })
                  }
                  disabled={disabled}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  data-testid={`defect-id-${idx}`}
                />
              )}
              <Field
                label="数量"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={String(row.defect_quantity)}
                onChange={(e) =>
                  updateRow(idx, {
                    defect_quantity: Number(e.target.value),
                  })
                }
                disabled={disabled}
                data-testid={`defect-qty-${idx}`}
              />
              <Field
                label="メモ"
                value={row.notes ?? ""}
                onChange={(e) =>
                  updateRow(idx, {
                    notes: e.target.value.length > 0 ? e.target.value : null,
                  })
                }
                disabled={disabled}
                placeholder="任意"
                data-testid={`defect-notes-${idx}`}
              />
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  onClick={() => removeRow(idx)}
                  disabled={disabled}
                  aria-label={`不適合 ${idx + 1} を削除`}
                  data-testid={`defect-remove-${idx}`}
                >
                  <Trash2 aria-hidden className="h-5 w-5" />
                </Button>
              </div>
            </li>
          ))
        )}
      </ul>

      {!canAdd && value.length >= MANUFACTURING_DEFECT_MAX ? (
        <p
          role="status"
          className="text-xs text-[var(--color-warn)]"
          data-testid="defect-cap-reached"
        >
          上限 {MANUFACTURING_DEFECT_MAX} 件に達しました。
        </p>
      ) : null}
    </div>
  );
}
