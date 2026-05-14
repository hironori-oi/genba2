"use client";

import { useMemo, useState, useTransition } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { FormModal } from "@/components/admin/FormModal";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { isErr } from "@/lib/admin/shared/result";
import {
  deleteCustomFieldDefinitionAction,
  saveCustomFieldDefinitionAction,
} from "./custom-fields-actions";

/**
 * Phase 5c CustomFieldDefinitions detail editor (architect §3.2.3).
 *
 * Phase 5b shipped the minimum CRUD; this Phase 5c upgrade adds:
 *   * Slot overview grid showing all 20 possible custom_* columns and
 *     whether they are already mapped, so admins can see what's free.
 *   * Multi-line description textarea (architect §3.2.3 "意味付け" — label,
 *     data_type, sort_order, description for downstream records forms).
 *   * Larger sort-order hint band so the records-form display order is
 *     predictable when Phase 7 wires this into movement/inventory/
 *     manufacturing record forms.
 *
 * Schema compat: custom_field_definitions Phase 2 DDL has no `purpose`
 * column — the architect doc's "purpose mapping for records forms" is
 * deferred to work_input_field_settings (Phase 5c work-settings page),
 * which is the table that already carries (business_code, field_code,
 * required, sort_order). The CustomFieldsForm itself does NOT introduce a
 * new column; it only fills the existing schema with richer UX.
 */

export type CustomFieldRow = {
  id: string;
  columnName: string;
  label: string;
  dataType: "text" | "numeric" | "date";
  description: string | null;
  enabled: boolean;
  sortOrder: number;
};

const COLUMN_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  ...Array.from({ length: 10 }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    return { value: `custom_text_${n}`, label: `テキスト${n} (custom_text_${n})` };
  }),
  ...Array.from({ length: 5 }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    return { value: `custom_number_${n}`, label: `数値${n} (custom_number_${n})` };
  }),
  ...Array.from({ length: 5 }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    return { value: `custom_date_${n}`, label: `日付${n} (custom_date_${n})` };
  }),
];

const SLOT_SECTIONS: ReadonlyArray<{
  key: "text" | "number" | "date";
  heading: string;
  prefix: string;
  count: number;
}> = [
  { key: "text", heading: "テキスト (10 スロット)", prefix: "custom_text_", count: 10 },
  { key: "number", heading: "数値 (5 スロット)", prefix: "custom_number_", count: 5 },
  { key: "date", heading: "日付 (5 スロット)", prefix: "custom_date_", count: 5 },
];

function newId(): string {
  return `new-${Math.random().toString(36).slice(2, 10)}`;
}

function blankRow(): CustomFieldRow {
  return {
    id: newId(),
    columnName: "custom_text_01",
    label: "",
    dataType: "text",
    description: null,
    enabled: true,
    sortOrder: 0,
  };
}

function inferDataType(columnName: string): CustomFieldRow["dataType"] {
  if (columnName.startsWith("custom_number_")) return "numeric";
  if (columnName.startsWith("custom_date_")) return "date";
  return "text";
}

export function CustomFieldsForm({
  initial,
  liveMode,
}: {
  initial: CustomFieldRow[];
  liveMode: boolean;
}) {
  const [rows, setRows] = useState<CustomFieldRow[]>(initial);
  const [draft, setDraft] = useState<CustomFieldRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomFieldRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, startTransition] = useTransition();

  const usedColumns = useMemo(() => new Set(rows.map((r) => r.columnName)), [rows]);

  const columns = useMemo<DataTableColumn<CustomFieldRow>[]>(
    () => [
      {
        key: "columnName",
        header: "対象列",
        render: (r) => <span className="font-mono text-xs">{r.columnName}</span>,
        width: "200px",
      },
      { key: "label", header: "ラベル", render: (r) => r.label },
      {
        key: "dataType",
        header: "型",
        render: (r) => r.dataType,
        width: "80px",
      },
      {
        key: "sortOrder",
        header: "並び順",
        render: (r) => <span className="tabular-nums">{r.sortOrder}</span>,
        align: "end",
        width: "96px",
      },
      {
        key: "enabled",
        header: "有効",
        render: (r) => (
          <span
            className={
              "inline-flex items-center rounded-full border px-2 py-0.5 text-xs " +
              (r.enabled
                ? "border-[var(--color-ok)] text-[var(--color-ok)]"
                : "border-[var(--color-bad)] text-[var(--color-bad)]")
            }
          >
            {r.enabled ? "有効" : "無効"}
          </span>
        ),
        width: "88px",
      },
    ],
    [],
  );

  function openCreate() {
    setDraft(blankRow());
    setError(null);
    setNotice(null);
    setFieldErrors({});
  }

  function openEdit(row: CustomFieldRow) {
    setDraft(structuredClone(row));
    setError(null);
    setNotice(null);
    setFieldErrors({});
  }

  function closeForm() {
    setDraft(null);
    setFieldErrors({});
  }

  function handleSubmit() {
    if (!draft) return;
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await saveCustomFieldDefinitionAction({
        id: draft.id,
        columnName: draft.columnName,
        label: draft.label,
        dataType: draft.dataType,
        description: draft.description,
        enabled: draft.enabled,
        sortOrder: draft.sortOrder,
      });
      if (isErr(result)) {
        setError(result.message);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        return;
      }
      const persistedId = result.data.id;
      setRows((prev) => {
        const idx = prev.findIndex((r) => r.id === draft.id);
        const saved = { ...draft, id: persistedId };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [...prev, saved];
      });
      setNotice("保存しました。");
      closeForm();
    });
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    startTransition(async () => {
      const result = await deleteCustomFieldDefinitionAction(target.id);
      if (isErr(result)) {
        setError(result.message);
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== target.id));
      setNotice("削除しました。");
    });
  }

  return (
    <section className="flex flex-col gap-3" data-component="custom-fields-form">
      <div
        className="flex flex-col gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3"
        aria-label="カスタム列 スロット使用状況"
        data-testid="custom-field-slot-grid"
      >
        {SLOT_SECTIONS.map((section) => (
          <section key={section.key} aria-labelledby={`slot-section-${section.key}`}>
            <h3
              id={`slot-section-${section.key}`}
              className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]"
            >
              {section.heading}
            </h3>
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
              {Array.from({ length: section.count }, (_, i) => {
                const n = String(i + 1).padStart(2, "0");
                const columnName = `${section.prefix}${n}`;
                const inUse = usedColumns.has(columnName);
                const label =
                  COLUMN_OPTIONS.find((c) => c.value === columnName)?.label ?? columnName;
                return (
                  <span
                    key={columnName}
                    className={
                      "inline-flex items-center justify-between gap-1 border px-2 py-1 font-mono text-[11px] " +
                      (inUse
                        ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10 text-[var(--ink)]"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]")
                    }
                    title={label}
                    data-testid={`slot-${columnName}`}
                  >
                    <span>{n}</span>
                    <span aria-hidden>{inUse ? "●" : "○"}</span>
                  </span>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <p className="text-xs text-[var(--muted)]">
        ● は意味付け済、○ は未使用。使用済の列を他の意味で再利用したい場合は、まず削除 (論理) してから追加します。
      </p>

      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--muted)]">{rows.length} 件</p>
        <Button
          type="button"
          size="lg"
          onClick={openCreate}
          data-testid="custom-field-create"
        >
          カスタム項目を追加
        </Button>
      </div>

      {error ? (
        <Alert tone="error" title="エラー">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="ok" title="完了">
          {notice}
        </Alert>
      ) : null}

      {!liveMode ? (
        <Alert tone="info" title="プレビューモード">
          Supabase 接続情報が未設定のため、登録は保存されません。
        </Alert>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onEdit={openEdit}
        onDelete={(r) => setDeleteTarget(r)}
        emptyMessage="まだカスタム項目が定義されていません。"
        caption="カスタム項目一覧"
      />

      <FormModal
        open={draft !== null}
        onClose={closeForm}
        title={draft && rows.some((r) => r.id === draft.id) ? "カスタム項目編集" : "カスタム項目 追加"}
        onSubmit={() => handleSubmit()}
        submitting={submitting}
      >
        {draft ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--ink)]">対象列</label>
              <select
                value={draft.columnName}
                onChange={(e) => {
                  const col = e.target.value;
                  setDraft({ ...draft, columnName: col, dataType: inferDataType(col) });
                }}
                disabled={!draft.id.startsWith("new-")}
                className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)] disabled:opacity-60"
                aria-describedby="custom-column-hint"
              >
                {COLUMN_OPTIONS.map((c) => (
                  <option
                    key={c.value}
                    value={c.value}
                    disabled={usedColumns.has(c.value) && c.value !== draft.columnName}
                  >
                    {c.label} {usedColumns.has(c.value) && c.value !== draft.columnName ? "(使用中)" : ""}
                  </option>
                ))}
              </select>
              {fieldErrors.columnName ? (
                <p className="text-xs font-medium text-[var(--color-bad)]" role="alert">
                  {fieldErrors.columnName}
                </p>
              ) : null}
              <p id="custom-column-hint" className="text-xs text-[var(--muted)]">
                同じ列を複数のカスタム項目で使うことはできません。編集モードでは列の付け替えはできません。
              </p>
            </div>
            <Field
              label="ラベル"
              required
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              error={fieldErrors.label}
              data-testid="custom-field-label"
              hint="記録画面・履歴・CSV ヘッダに使われる、現場用語の見出しです。"
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--ink)]">
                データ型
              </label>
              <select
                value={draft.dataType}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    dataType: e.target.value as CustomFieldRow["dataType"],
                  })
                }
                className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
                data-testid="custom-field-data-type"
              >
                <option value="text">テキスト</option>
                <option value="numeric">数値</option>
                <option value="date">日付</option>
              </select>
              <p className="text-xs text-[var(--muted)]">
                対象列の接頭辞から推奨型を選んでいます。custom_text_* は通常テキストのみです。
              </p>
            </div>
            <Field
              label="並び順"
              type="number"
              value={String(draft.sortOrder)}
              onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
              error={fieldErrors.sortOrder}
              min={0}
              max={10000}
              step={10}
              hint="記録フォーム / 履歴詳細での表示順。同じ業務内の標準項目と並びます。"
            />
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="custom-field-description"
                className="text-sm font-medium text-[var(--ink)]"
              >
                説明
              </label>
              <textarea
                id="custom-field-description"
                value={draft.description ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value || null })
                }
                rows={3}
                maxLength={1000}
                aria-invalid={fieldErrors.description ? true : undefined}
                className="min-h-[6rem] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                placeholder="例: 出荷区分 (A=通常 / B=緊急)。記録フォームのツールチップにも表示されます。"
                data-testid="custom-field-description"
              />
              {fieldErrors.description ? (
                <p
                  className="text-xs font-medium text-[var(--color-bad)]"
                  role="alert"
                >
                  {fieldErrors.description}
                </p>
              ) : null}
            </div>
            <label className="inline-flex h-12 cursor-pointer items-center gap-2 text-sm text-[var(--ink)]">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                className="h-5 w-5 accent-[var(--color-brand)]"
              />
              有効にする (無効化すると記録フォームの候補から外れます)
            </label>
          </div>
        ) : null}
      </FormModal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="カスタム項目の削除"
        message={`列「${deleteTarget?.columnName}」の意味付けを削除します。続行しますか？`}
        confirmLabel="削除"
        danger
        busy={submitting}
      />
    </section>
  );
}
