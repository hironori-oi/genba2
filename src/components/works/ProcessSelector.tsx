"use client";

/**
 * Phase 4c — ProcessSelector.
 *
 * `mfg_processes` の中から作業対象 1 行を選ぶ。Phase 4c では:
 *
 *   1. server 側 (page.tsx) が anon-JWT で `fetchManufacturingHistory` の隣で
 *      `mfg_processes` を最小 SELECT して渡す。供給がない場合 (demo / 認可
 *      切れ) は free-form UUID 入力に degrade する。
 *   2. ラジオリスト + 自由入力 UUID は同じ `value` ステートを共有し、選択時
 *      は片方をクリアする。
 *   3. 56×56 のタップ対象を担保するため radio はカード化する (Phase 3b
 *      tap-target ガイドラインを再利用)。
 */

import { useId } from "react";
import { Field } from "@/components/ui/Field";

export type ProcessOption = {
  id: string;
  /** Human-readable label (例: "ORD-1042 / 1: 切削 / 設備 A-3"). */
  label: string;
  /** Secondary line (任意 — 工程備考や予定数量など). */
  helper?: string;
};

type Props = {
  value: string;
  onChange: (id: string) => void;
  /** server 側で fetch 済みの mfg_processes (empty = 入力モードのみ). */
  options?: ReadonlyArray<ProcessOption>;
  disabled?: boolean;
};

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function ProcessSelector({
  value,
  onChange,
  options = [],
  disabled = false,
}: Props) {
  const radioName = useId();

  return (
    <div className="flex flex-col gap-3" data-testid="process-selector">
      {options.length > 0 ? (
        <fieldset
          aria-label="工程一覧"
          className="flex flex-col gap-2"
          data-testid="process-options"
        >
          <legend className="text-xs uppercase tracking-wide text-[var(--muted)]">
            工程候補 ({options.length} 件)
          </legend>
          {options.map((o) => (
            <label
              key={o.id}
              className={
                "flex min-h-14 cursor-pointer items-start gap-3 border bg-[var(--surface)] p-3 transition-colors " +
                (value === o.id
                  ? "border-[var(--color-brand)]"
                  : "border-[var(--border)] hover:border-[var(--color-brand)]")
              }
              data-testid={`process-option-${o.id}`}
            >
              <input
                type="radio"
                name={radioName}
                value={o.id}
                checked={value === o.id}
                onChange={() => onChange(o.id)}
                disabled={disabled}
                className="mt-1 h-5 w-5 accent-[var(--color-brand)]"
              />
              <div className="flex flex-col text-sm">
                <span className="font-medium text-[var(--ink)]">{o.label}</span>
                {o.helper ? (
                  <span className="font-mono text-xs text-[var(--muted)]">
                    {o.helper}
                  </span>
                ) : null}
              </div>
            </label>
          ))}
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-1">
        <Field
          label={options.length > 0 ? "工程 ID を直接入力 (UUID)" : "工程 ID (UUID)"}
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          disabled={disabled}
          placeholder="00000000-0000-0000-0000-000000000000"
          hint={
            options.length === 0
              ? "対象工程の UUID を入力します。CSV 取込で登録済みの mfg_processes.id を参照してください。"
              : "候補に無い工程を扱う場合のみ直接入力します。"
          }
          data-testid="process-id-input"
          aria-invalid={value.length > 0 && !UUID_RE.test(value) ? true : undefined}
        />
        {value.length > 0 && !UUID_RE.test(value) ? (
          <p
            role="alert"
            className="text-xs text-[var(--color-bad)]"
            data-testid="process-id-error"
          >
            UUID 形式 (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) で入力してください。
          </p>
        ) : null}
      </div>
    </div>
  );
}
