"use client";

/**
 * Phase 4c — ProduceInflowToggle.
 *
 * 製造実績の登録と同じトランザクションで 製造入庫 (movement_records 1 件)
 * を作るかどうかをトグルする (UC-4 任意ステップ)。
 *
 * デフォルト OFF。ON にすると `produceInflowInsertSchema` (validators.ts)
 * の最小 5 フィールドを入力する。R-P4-04 で UNIQUE 制約があるため、submit
 * 直後に再 submit しても server 側で重複は拒否される — UI 側は冪等性は
 * 担保しない (Phase 4b の `submit_manufacturing_record` RPC が一括処理)。
 */

import { Field } from "@/components/ui/Field";

export type ProduceInflowValue = {
  enabled: boolean;
  item_code: string;
  quantity: number;
  location_code: string | null;
  lot: string | null;
  notes: string | null;
};

export const initialProduceInflow: ProduceInflowValue = {
  enabled: false,
  item_code: "",
  quantity: 0,
  location_code: null,
  lot: null,
  notes: null,
};

type Props = {
  value: ProduceInflowValue;
  onChange: (next: ProduceInflowValue) => void;
  /** 親工程 / ラベルから推定された品目コード (任意). */
  defaultItemCode?: string;
  disabled?: boolean;
};

export function ProduceInflowToggle({
  value,
  onChange,
  defaultItemCode,
  disabled = false,
}: Props) {
  const setEnabled = (enabled: boolean) => {
    onChange({
      ...value,
      enabled,
      // ON 時、item_code が空なら default を埋める。OFF にしても入力値は
      // 残す (再 ON 時に再入力させない UX) ※ submit 直前に enabled で
      // 弁別する。
      item_code:
        enabled && value.item_code.length === 0 && defaultItemCode
          ? defaultItemCode
          : value.item_code,
    });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="produce-inflow">
      <div
        role="radiogroup"
        aria-label="製造入庫を同時記録するか"
        className="flex flex-wrap gap-2"
      >
        {[
          { id: "off", enabled: false, label: "記録しない (既定)" },
          { id: "on", enabled: true, label: "記録する" },
        ].map((opt) => (
          <label
            key={opt.id}
            className={
              "inline-flex min-h-14 cursor-pointer items-center gap-2 border bg-[var(--surface)] px-4 text-sm font-medium transition-colors " +
              (value.enabled === opt.enabled
                ? "border-[var(--color-brand)] text-[var(--color-brand)]"
                : "border-[var(--border)] text-[var(--ink)] hover:border-[var(--color-brand)]")
            }
            data-testid={`inflow-toggle-${opt.id}`}
          >
            <input
              type="radio"
              name="produce-inflow-enabled"
              value={opt.id}
              checked={value.enabled === opt.enabled}
              onChange={() => setEnabled(opt.enabled)}
              disabled={disabled}
              className="h-5 w-5 accent-[var(--color-brand)]"
            />
            {opt.label}
          </label>
        ))}
      </div>

      {value.enabled ? (
        <div
          data-testid="inflow-fields"
          className="grid grid-cols-1 gap-2 border border-[var(--border)] bg-[var(--surface-2)] p-3 sm:grid-cols-2"
        >
          <Field
            label="品目コード"
            value={value.item_code}
            onChange={(e) =>
              onChange({ ...value, item_code: e.target.value.trim() })
            }
            disabled={disabled}
            required
            data-testid="inflow-item-code"
          />
          <Field
            label="数量"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={String(value.quantity)}
            onChange={(e) =>
              onChange({ ...value, quantity: Number(e.target.value) })
            }
            disabled={disabled}
            required
            data-testid="inflow-quantity"
          />
          <Field
            label="ロケーション"
            value={value.location_code ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                location_code:
                  e.target.value.length > 0 ? e.target.value : null,
              })
            }
            disabled={disabled}
            placeholder="任意 (例: A-03-15)"
            data-testid="inflow-location"
          />
          <Field
            label="ロット"
            value={value.lot ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                lot: e.target.value.length > 0 ? e.target.value : null,
              })
            }
            disabled={disabled}
            placeholder="任意"
            data-testid="inflow-lot"
          />
          <Field
            label="備考"
            value={value.notes ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                notes: e.target.value.length > 0 ? e.target.value : null,
              })
            }
            disabled={disabled}
            placeholder="任意"
            className="sm:col-span-2"
            data-testid="inflow-notes"
          />
        </div>
      ) : null}
    </div>
  );
}
