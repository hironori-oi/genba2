"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { FIELD_PURPOSES, type FieldSetting, type FieldSettingPurpose } from "@/lib/admin/fixtures";
import { saveFieldSettingsAction } from "./actions";

export function FieldSettingsForm({ settings }: { settings: FieldSetting[] }) {
  const [state, setState] = useState<FieldSetting[]>(settings);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function update<K extends keyof FieldSetting>(
    fieldCode: string,
    key: K,
    value: FieldSetting[K],
  ) {
    setState((prev) =>
      prev.map((row) => (row.fieldCode === fieldCode ? { ...row, [key]: value } : row)),
    );
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveFieldSettingsAction(state);
      if (result.status === "ok") {
        setSavedAt(new Date().toLocaleTimeString("ja-JP"));
      } else {
        setError(result.message ?? "保存に失敗しました。");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-describedby="field-settings-help">
      <p id="field-settings-help" className="sr-only">
        各行のチェックボックスで利用 ON/OFF を切り替え、セレクトボックスで 5 用途を割当てます。
      </p>

      <div className="overflow-x-auto border border-[var(--border)]">
        <table className="min-w-full divide-y divide-[var(--border)] text-sm">
          <thead className="bg-[var(--surface-2)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th scope="col" className="px-3 py-2">利用</th>
              <th scope="col" className="px-3 py-2">項目コード</th>
              <th scope="col" className="px-3 py-2">項目名</th>
              <th scope="col" className="px-3 py-2">データ型</th>
              <th scope="col" className="px-3 py-2">表示名</th>
              <th scope="col" className="px-3 py-2">用途</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
            {state.map((row) => {
              const checkboxId = `field-enabled-${row.fieldCode}`;
              const purposeId = `field-purpose-${row.fieldCode}`;
              const labelId = `field-label-${row.fieldCode}`;
              return (
                <tr key={row.fieldCode}>
                  <td className="px-3 py-2 align-middle">
                    <label
                      className="inline-flex h-12 w-12 cursor-pointer items-center justify-center"
                      htmlFor={checkboxId}
                    >
                      <span className="sr-only">{row.label} を使用する</span>
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={row.enabled}
                        onChange={(e) => update(row.fieldCode, "enabled", e.target.checked)}
                        className="h-5 w-5 accent-[var(--color-brand)]"
                      />
                    </label>
                  </td>
                  <td className="px-3 py-2 align-middle font-mono text-xs text-[var(--ink)]">
                    {row.fieldCode}
                  </td>
                  <td className="px-3 py-2 align-middle text-[var(--ink)]">{row.label}</td>
                  <td className="px-3 py-2 align-middle font-mono text-xs text-[var(--muted)]">
                    {row.dataType}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <label className="sr-only" htmlFor={labelId}>
                      {row.label} の表示名
                    </label>
                    <input
                      id={labelId}
                      type="text"
                      value={row.displayLabel ?? ""}
                      onChange={(e) =>
                        update(row.fieldCode, "displayLabel", e.target.value || null)
                      }
                      disabled={!row.enabled}
                      className="h-10 w-full min-w-32 border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--ink)] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                    />
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <label className="sr-only" htmlFor={purposeId}>
                      {row.label} の用途
                    </label>
                    <select
                      id={purposeId}
                      value={row.purpose}
                      onChange={(e) =>
                        update(row.fieldCode, "purpose", e.target.value as FieldSettingPurpose)
                      }
                      disabled={!row.enabled}
                      className="h-10 w-full min-w-40 border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--ink)] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                    >
                      {FIELD_PURPOSES.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} size="lg">
          {pending ? "保存中…" : "設定を保存"}
        </Button>
        {savedAt ? (
          <span role="status" className="text-sm text-[var(--color-ok)]">
            保存しました ({savedAt})
          </span>
        ) : null}
      </div>

      {error ? (
        <Alert tone="error" title="保存エラー">
          {error}
        </Alert>
      ) : null}
    </form>
  );
}
