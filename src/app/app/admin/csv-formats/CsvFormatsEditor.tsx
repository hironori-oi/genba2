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
  deleteCsvDefinitionAction,
  saveCsvExportDefinitionAction,
  saveCsvImportDefinitionAction,
} from "./actions";

/**
 * Phase 5c CSV format CRUD editor (architect §3.2.4).
 *
 * Surface:
 *   * import / export を切替 (tab) — 同画面の 2 表
 *   * 行クリックで FormModal: 定義ヘッダ + column_mapping/column_selection 行配列
 *   * 列数は 50 上限 (server zod の上限と一致)
 */

export type BusinessCode = "receiving" | "picking" | "inventory" | "manufacturing";

export type CsvImportRow = {
  id: string;
  businessCode: BusinessCode;
  targetTable: string;
  definitionCode: string;
  definitionName: string;
  encoding: "utf8" | "shift_jis";
  delimiter: "comma" | "tab" | "pipe";
  startRow: number;
  duplicateAction: "skip" | "update" | "error";
  enabled: boolean;
  columnMapping: Array<{
    csvColumnIndex: number;
    targetColumn: string;
    required: boolean;
    defaultValue: string | null;
  }>;
};

export type CsvExportRow = {
  id: string;
  businessCode: BusinessCode;
  sourceTable: string;
  definitionCode: string;
  definitionName: string;
  encoding: "utf8" | "shift_jis";
  delimiter: "comma" | "tab" | "pipe";
  includeHeader: boolean;
  enabled: boolean;
  columnSelection: Array<{
    sourceColumn: string;
    headerLabel: string;
    sortOrder: number;
  }>;
};

const BUSINESS_OPTIONS: ReadonlyArray<{ value: BusinessCode | ""; label: string }> = [
  { value: "", label: "すべて" },
  { value: "receiving", label: "入庫" },
  { value: "picking", label: "ピッキング" },
  { value: "inventory", label: "棚卸" },
  { value: "manufacturing", label: "製造" },
];

const ENCODING_OPTIONS = [
  { value: "utf8", label: "UTF-8" },
  { value: "shift_jis", label: "Shift_JIS" },
] as const;

const DELIMITER_OPTIONS = [
  { value: "comma", label: "カンマ ," },
  { value: "tab", label: "タブ" },
  { value: "pipe", label: "パイプ |" },
] as const;

const DUP_ACTION_OPTIONS = [
  { value: "skip", label: "スキップ" },
  { value: "update", label: "上書き" },
  { value: "error", label: "エラー" },
] as const;

function newId(): string {
  return `new-${Math.random().toString(36).slice(2, 10)}`;
}

function blankImport(): CsvImportRow {
  return {
    id: newId(),
    businessCode: "receiving",
    targetTable: "movement_records",
    definitionCode: "",
    definitionName: "",
    encoding: "utf8",
    delimiter: "comma",
    startRow: 2,
    duplicateAction: "error",
    enabled: true,
    columnMapping: [
      { csvColumnIndex: 1, targetColumn: "item_code", required: true, defaultValue: null },
    ],
  };
}

function blankExport(): CsvExportRow {
  return {
    id: newId(),
    businessCode: "receiving",
    sourceTable: "movement_records",
    definitionCode: "",
    definitionName: "",
    encoding: "utf8",
    delimiter: "comma",
    includeHeader: true,
    enabled: true,
    columnSelection: [
      { sourceColumn: "item_code", headerLabel: "品目コード", sortOrder: 10 },
    ],
  };
}

export type CsvFormatsEditorProps = {
  initialImports: CsvImportRow[];
  initialExports: CsvExportRow[];
  liveMode: boolean;
};

type Tab = "import" | "export";

export function CsvFormatsEditor({
  initialImports,
  initialExports,
  liveMode,
}: CsvFormatsEditorProps) {
  const [tab, setTab] = useState<Tab>("import");
  const [businessFilter, setBusinessFilter] = useState<BusinessCode | "">("");
  const [imports, setImports] = useState<CsvImportRow[]>(initialImports);
  const [exports_, setExports] = useState<CsvExportRow[]>(initialExports);
  const [importDraft, setImportDraft] = useState<CsvImportRow | null>(null);
  const [exportDraft, setExportDraft] = useState<CsvExportRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: Tab; id: string; code: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, startTransition] = useTransition();

  const filteredImports = useMemo(
    () =>
      businessFilter
        ? imports.filter((r) => r.businessCode === businessFilter)
        : imports,
    [imports, businessFilter],
  );
  const filteredExports = useMemo(
    () =>
      businessFilter
        ? exports_.filter((r) => r.businessCode === businessFilter)
        : exports_,
    [exports_, businessFilter],
  );

  const importColumns = useMemo<DataTableColumn<CsvImportRow>[]>(
    () => [
      {
        key: "definitionCode",
        header: "コード",
        render: (r) => <span className="font-mono">{r.definitionCode}</span>,
        width: "140px",
      },
      { key: "definitionName", header: "名称", render: (r) => r.definitionName },
      {
        key: "businessCode",
        header: "業務",
        render: (r) =>
          BUSINESS_OPTIONS.find((b) => b.value === r.businessCode)?.label ?? r.businessCode,
        width: "100px",
      },
      {
        key: "targetTable",
        header: "対象テーブル",
        render: (r) => <span className="font-mono text-xs">{r.targetTable}</span>,
        width: "180px",
      },
      {
        key: "encoding",
        header: "エンコード",
        render: (r) => r.encoding,
        width: "100px",
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
        width: "80px",
      },
    ],
    [],
  );

  const exportColumns = useMemo<DataTableColumn<CsvExportRow>[]>(
    () => [
      {
        key: "definitionCode",
        header: "コード",
        render: (r) => <span className="font-mono">{r.definitionCode}</span>,
        width: "140px",
      },
      { key: "definitionName", header: "名称", render: (r) => r.definitionName },
      {
        key: "businessCode",
        header: "業務",
        render: (r) =>
          BUSINESS_OPTIONS.find((b) => b.value === r.businessCode)?.label ?? r.businessCode,
        width: "100px",
      },
      {
        key: "sourceTable",
        header: "出力元テーブル",
        render: (r) => <span className="font-mono text-xs">{r.sourceTable}</span>,
        width: "180px",
      },
      {
        key: "encoding",
        header: "エンコード",
        render: (r) => r.encoding,
        width: "100px",
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
        width: "80px",
      },
    ],
    [],
  );

  function clearMessages() {
    setError(null);
    setFieldErrors({});
  }

  function openCreate() {
    clearMessages();
    setNotice(null);
    if (tab === "import") setImportDraft(blankImport());
    else setExportDraft(blankExport());
  }

  function openEditImport(row: CsvImportRow) {
    clearMessages();
    setNotice(null);
    setImportDraft(structuredClone(row));
  }

  function openEditExport(row: CsvExportRow) {
    clearMessages();
    setNotice(null);
    setExportDraft(structuredClone(row));
  }

  function closeImport() {
    setImportDraft(null);
    setFieldErrors({});
  }

  function closeExport() {
    setExportDraft(null);
    setFieldErrors({});
  }

  function handleImportSubmit() {
    if (!importDraft) return;
    clearMessages();
    const draft = importDraft;
    startTransition(async () => {
      const result = await saveCsvImportDefinitionAction({
        id: draft.id,
        businessCode: draft.businessCode,
        targetTable: draft.targetTable,
        definitionCode: draft.definitionCode,
        definitionName: draft.definitionName,
        encoding: draft.encoding,
        delimiter: draft.delimiter,
        startRow: draft.startRow,
        duplicateAction: draft.duplicateAction,
        enabled: draft.enabled,
        columnMapping: draft.columnMapping,
      });
      if (isErr(result)) {
        setError(result.message);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        return;
      }
      const persistedId = result.data.id;
      setImports((prev) => {
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
      closeImport();
    });
  }

  function handleExportSubmit() {
    if (!exportDraft) return;
    clearMessages();
    const draft = exportDraft;
    startTransition(async () => {
      const result = await saveCsvExportDefinitionAction({
        id: draft.id,
        businessCode: draft.businessCode,
        sourceTable: draft.sourceTable,
        definitionCode: draft.definitionCode,
        definitionName: draft.definitionName,
        encoding: draft.encoding,
        delimiter: draft.delimiter,
        includeHeader: draft.includeHeader,
        enabled: draft.enabled,
        columnSelection: draft.columnSelection,
      });
      if (isErr(result)) {
        setError(result.message);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        return;
      }
      const persistedId = result.data.id;
      setExports((prev) => {
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
      closeExport();
    });
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    clearMessages();
    startTransition(async () => {
      const result = await deleteCsvDefinitionAction({
        kind: target.kind,
        id: target.id,
      });
      if (isErr(result)) {
        setError(result.message);
        return;
      }
      if (target.kind === "import") {
        setImports((prev) => prev.filter((r) => r.id !== target.id));
      } else {
        setExports((prev) => prev.filter((r) => r.id !== target.id));
      }
      setNotice("削除しました。");
    });
  }

  return (
    <section
      className="flex flex-col gap-4"
      data-component="csv-formats-editor"
    >
      <nav
        aria-label="CSV 種別"
        className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-2"
      >
        {(["import", "export"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? "page" : undefined}
            data-testid={`csv-tab-${t}`}
            className={
              "inline-flex h-12 items-center border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] " +
              (tab === t
                ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-brand-foreground)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--color-brand)]")
            }
          >
            {t === "import" ? "インポート" : "エクスポート"}
          </button>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-[var(--ink)]" htmlFor="csv-business-filter">
          業務で絞り込み:
        </label>
        <select
          id="csv-business-filter"
          data-testid="csv-business-filter"
          value={businessFilter}
          onChange={(e) => setBusinessFilter(e.target.value as BusinessCode | "")}
          className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
        >
          {BUSINESS_OPTIONS.map((b) => (
            <option key={b.value || "all"} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
        <div className="ml-auto">
          <Button
            type="button"
            size="lg"
            onClick={openCreate}
            data-testid="csv-format-create"
          >
            {tab === "import" ? "インポート定義を追加" : "エクスポート定義を追加"}
          </Button>
        </div>
      </div>

      {!liveMode ? (
        <Alert tone="info" title="プレビューモード">
          Supabase 接続情報が未設定のため、登録は保存されません。
        </Alert>
      ) : null}

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

      {tab === "import" ? (
        <DataTable
          rows={filteredImports}
          columns={importColumns}
          rowKey={(r) => r.id}
          onEdit={openEditImport}
          onDelete={(r) =>
            setDeleteTarget({ kind: "import", id: r.id, code: r.definitionCode })
          }
          caption="CSV インポート定義一覧"
          emptyMessage="まだインポート定義がありません。「インポート定義を追加」から作成してください。"
        />
      ) : (
        <DataTable
          rows={filteredExports}
          columns={exportColumns}
          rowKey={(r) => r.id}
          onEdit={openEditExport}
          onDelete={(r) =>
            setDeleteTarget({ kind: "export", id: r.id, code: r.definitionCode })
          }
          caption="CSV エクスポート定義一覧"
          emptyMessage="まだエクスポート定義がありません。「エクスポート定義を追加」から作成してください。"
        />
      )}

      <FormModal
        open={importDraft !== null}
        onClose={closeImport}
        title={
          importDraft && imports.some((r) => r.id === importDraft.id)
            ? "インポート定義 編集"
            : "インポート定義 追加"
        }
        onSubmit={() => handleImportSubmit()}
        submitting={submitting}
      >
        {importDraft ? (
          <ImportForm
            draft={importDraft}
            setDraft={setImportDraft}
            fieldErrors={fieldErrors}
          />
        ) : null}
      </FormModal>

      <FormModal
        open={exportDraft !== null}
        onClose={closeExport}
        title={
          exportDraft && exports_.some((r) => r.id === exportDraft.id)
            ? "エクスポート定義 編集"
            : "エクスポート定義 追加"
        }
        onSubmit={() => handleExportSubmit()}
        submitting={submitting}
      >
        {exportDraft ? (
          <ExportForm
            draft={exportDraft}
            setDraft={setExportDraft}
            fieldErrors={fieldErrors}
          />
        ) : null}
      </FormModal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="CSV 定義の削除"
        message={`定義「${deleteTarget?.code}」を削除します。続行しますか？`}
        confirmLabel="削除"
        danger
        busy={submitting}
      />
    </section>
  );
}

function ImportForm({
  draft,
  setDraft,
  fieldErrors,
}: {
  draft: CsvImportRow;
  setDraft: (next: CsvImportRow | null) => void;
  fieldErrors: Record<string, string>;
}) {
  function addRow() {
    if (draft.columnMapping.length >= 50) return;
    const next = [
      ...draft.columnMapping,
      {
        csvColumnIndex: draft.columnMapping.length + 1,
        targetColumn: "",
        required: false,
        defaultValue: null,
      },
    ];
    setDraft({ ...draft, columnMapping: next });
  }
  function removeRow(idx: number) {
    const next = draft.columnMapping.filter((_, i) => i !== idx);
    setDraft({ ...draft, columnMapping: next });
  }

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="定義コード"
        required
        value={draft.definitionCode}
        onChange={(e) => setDraft({ ...draft, definitionCode: e.target.value })}
        error={fieldErrors.definitionCode}
        hint="英数字 / - / _ のみ、1〜64 文字"
        data-testid="csv-import-form-code"
      />
      <Field
        label="名称"
        required
        value={draft.definitionName}
        onChange={(e) => setDraft({ ...draft, definitionName: e.target.value })}
        error={fieldErrors.definitionName}
        data-testid="csv-import-form-name"
      />
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--ink)]">対象業務</label>
          <select
            value={draft.businessCode}
            onChange={(e) =>
              setDraft({ ...draft, businessCode: e.target.value as BusinessCode })
            }
            className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
          >
            {BUSINESS_OPTIONS.filter((b) => b.value !== "").map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <Field
          label="対象テーブル"
          required
          value={draft.targetTable}
          onChange={(e) => setDraft({ ...draft, targetTable: e.target.value })}
          error={fieldErrors.targetTable}
          hint="例: movement_records / inventory_records"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--ink)]">エンコード</label>
          <select
            value={draft.encoding}
            onChange={(e) =>
              setDraft({ ...draft, encoding: e.target.value as "utf8" | "shift_jis" })
            }
            className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
          >
            {ENCODING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--ink)]">区切り文字</label>
          <select
            value={draft.delimiter}
            onChange={(e) =>
              setDraft({
                ...draft,
                delimiter: e.target.value as "comma" | "tab" | "pipe",
              })
            }
            className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
          >
            {DELIMITER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <Field
          label="開始行"
          type="number"
          value={String(draft.startRow)}
          onChange={(e) => setDraft({ ...draft, startRow: Number(e.target.value) })}
          error={fieldErrors.startRow}
          min={1}
          max={100}
          step={1}
          hint="ヘッダ行を除く先頭"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-[var(--ink)]">重複時の挙動</label>
        <select
          value={draft.duplicateAction}
          onChange={(e) =>
            setDraft({
              ...draft,
              duplicateAction: e.target.value as "skip" | "update" | "error",
            })
          }
          className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
        >
          {DUP_ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <label className="inline-flex h-12 cursor-pointer items-center gap-2 text-sm text-[var(--ink)]">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          className="h-5 w-5 accent-[var(--color-brand)]"
        />
        有効にする
      </label>

      <fieldset className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-3">
        <legend className="px-1 text-sm font-medium text-[var(--ink)]">列マッピング</legend>
        <p className="text-xs text-[var(--muted)]">
          CSV の N 列目をどの DB カラムに入れるかを定義します (最大 50 行)。
        </p>
        {draft.columnMapping.map((row, idx) => (
          <div
            key={idx}
            className="grid grid-cols-4 items-center gap-2 md:grid-cols-12"
            data-testid="csv-import-mapping-row"
          >
            <input
              aria-label={`列番号 ${idx + 1}`}
              type="number"
              min={1}
              max={200}
              value={row.csvColumnIndex}
              onChange={(e) => {
                const next = [...draft.columnMapping];
                next[idx] = {
                  ...row,
                  csvColumnIndex: Number(e.target.value),
                };
                setDraft({ ...draft, columnMapping: next });
              }}
              className="col-span-1 h-12 min-h-12 border border-[var(--border)] bg-[var(--surface)] px-2 text-base text-[var(--ink)] md:col-span-2"
            />
            <input
              aria-label={`対象列 ${idx + 1}`}
              type="text"
              value={row.targetColumn}
              onChange={(e) => {
                const next = [...draft.columnMapping];
                next[idx] = { ...row, targetColumn: e.target.value };
                setDraft({ ...draft, columnMapping: next });
              }}
              className="col-span-3 h-12 min-h-12 border border-[var(--border)] bg-[var(--surface)] px-2 text-base text-[var(--ink)] md:col-span-4"
              placeholder="item_code"
            />
            <input
              aria-label={`既定値 ${idx + 1}`}
              type="text"
              value={row.defaultValue ?? ""}
              onChange={(e) => {
                const next = [...draft.columnMapping];
                next[idx] = {
                  ...row,
                  defaultValue: e.target.value === "" ? null : e.target.value,
                };
                setDraft({ ...draft, columnMapping: next });
              }}
              className="col-span-2 h-12 min-h-12 border border-[var(--border)] bg-[var(--surface)] px-2 text-base text-[var(--ink)] md:col-span-3"
              placeholder="既定値"
            />
            <label className="col-span-1 inline-flex h-12 min-h-12 items-center gap-1 text-xs text-[var(--ink)] md:col-span-2">
              <input
                type="checkbox"
                checked={row.required}
                onChange={(e) => {
                  const next = [...draft.columnMapping];
                  next[idx] = { ...row, required: e.target.checked };
                  setDraft({ ...draft, columnMapping: next });
                }}
                className="h-5 w-5 accent-[var(--color-brand)]"
              />
              必須
            </label>
            <button
              type="button"
              aria-label={`列マッピング ${idx + 1} を削除`}
              onClick={() => removeRow(idx)}
              className="col-span-1 inline-flex h-12 min-h-12 items-center justify-center border border-[var(--color-bad)] text-sm font-medium text-[var(--color-bad)]"
            >
              削除
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          disabled={draft.columnMapping.length >= 50}
          className="inline-flex h-12 items-center justify-center border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm font-medium text-[var(--ink)] disabled:opacity-50"
          data-testid="csv-import-add-row"
        >
          列を追加
        </button>
        {fieldErrors.columnMapping ? (
          <p className="text-xs font-medium text-[var(--color-bad)]" role="alert">
            {fieldErrors.columnMapping}
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}

function ExportForm({
  draft,
  setDraft,
  fieldErrors,
}: {
  draft: CsvExportRow;
  setDraft: (next: CsvExportRow | null) => void;
  fieldErrors: Record<string, string>;
}) {
  function addRow() {
    if (draft.columnSelection.length >= 50) return;
    const next = [
      ...draft.columnSelection,
      {
        sourceColumn: "",
        headerLabel: "",
        sortOrder: (draft.columnSelection.length + 1) * 10,
      },
    ];
    setDraft({ ...draft, columnSelection: next });
  }
  function removeRow(idx: number) {
    const next = draft.columnSelection.filter((_, i) => i !== idx);
    setDraft({ ...draft, columnSelection: next });
  }

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="定義コード"
        required
        value={draft.definitionCode}
        onChange={(e) => setDraft({ ...draft, definitionCode: e.target.value })}
        error={fieldErrors.definitionCode}
        hint="英数字 / - / _ のみ、1〜64 文字"
        data-testid="csv-export-form-code"
      />
      <Field
        label="名称"
        required
        value={draft.definitionName}
        onChange={(e) => setDraft({ ...draft, definitionName: e.target.value })}
        error={fieldErrors.definitionName}
        data-testid="csv-export-form-name"
      />
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--ink)]">対象業務</label>
          <select
            value={draft.businessCode}
            onChange={(e) =>
              setDraft({ ...draft, businessCode: e.target.value as BusinessCode })
            }
            className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
          >
            {BUSINESS_OPTIONS.filter((b) => b.value !== "").map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <Field
          label="出力元テーブル"
          required
          value={draft.sourceTable}
          onChange={(e) => setDraft({ ...draft, sourceTable: e.target.value })}
          error={fieldErrors.sourceTable}
          hint="例: movement_records / inventory_records"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--ink)]">エンコード</label>
          <select
            value={draft.encoding}
            onChange={(e) =>
              setDraft({ ...draft, encoding: e.target.value as "utf8" | "shift_jis" })
            }
            className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
          >
            {ENCODING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--ink)]">区切り文字</label>
          <select
            value={draft.delimiter}
            onChange={(e) =>
              setDraft({
                ...draft,
                delimiter: e.target.value as "comma" | "tab" | "pipe",
              })
            }
            className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
          >
            {DELIMITER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="inline-flex h-12 cursor-pointer items-center gap-2 text-sm text-[var(--ink)]">
          <input
            type="checkbox"
            checked={draft.includeHeader}
            onChange={(e) => setDraft({ ...draft, includeHeader: e.target.checked })}
            className="h-5 w-5 accent-[var(--color-brand)]"
          />
          ヘッダ行を出力する
        </label>
        <label className="inline-flex h-12 cursor-pointer items-center gap-2 text-sm text-[var(--ink)]">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            className="h-5 w-5 accent-[var(--color-brand)]"
          />
          有効にする
        </label>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-3">
        <legend className="px-1 text-sm font-medium text-[var(--ink)]">出力列</legend>
        <p className="text-xs text-[var(--muted)]">
          出力元テーブルのカラムと、CSV のヘッダ見出しを並べます (最大 50 行)。
        </p>
        {draft.columnSelection.map((row, idx) => (
          <div
            key={idx}
            className="grid grid-cols-4 items-center gap-2 md:grid-cols-12"
            data-testid="csv-export-selection-row"
          >
            <input
              aria-label={`出力元列 ${idx + 1}`}
              type="text"
              value={row.sourceColumn}
              onChange={(e) => {
                const next = [...draft.columnSelection];
                next[idx] = { ...row, sourceColumn: e.target.value };
                setDraft({ ...draft, columnSelection: next });
              }}
              className="col-span-2 h-12 min-h-12 border border-[var(--border)] bg-[var(--surface)] px-2 text-base text-[var(--ink)] md:col-span-4"
              placeholder="item_code"
            />
            <input
              aria-label={`見出し ${idx + 1}`}
              type="text"
              value={row.headerLabel}
              onChange={(e) => {
                const next = [...draft.columnSelection];
                next[idx] = { ...row, headerLabel: e.target.value };
                setDraft({ ...draft, columnSelection: next });
              }}
              className="col-span-4 h-12 min-h-12 border border-[var(--border)] bg-[var(--surface)] px-2 text-base text-[var(--ink)] md:col-span-5"
              placeholder="品目コード"
            />
            <input
              aria-label={`並び順 ${idx + 1}`}
              type="number"
              min={0}
              max={10000}
              value={row.sortOrder}
              onChange={(e) => {
                const next = [...draft.columnSelection];
                next[idx] = { ...row, sortOrder: Number(e.target.value) };
                setDraft({ ...draft, columnSelection: next });
              }}
              className="col-span-3 h-12 min-h-12 border border-[var(--border)] bg-[var(--surface)] px-2 text-base text-[var(--ink)] md:col-span-2"
            />
            <button
              type="button"
              aria-label={`出力列 ${idx + 1} を削除`}
              onClick={() => removeRow(idx)}
              className="col-span-1 inline-flex h-12 min-h-12 items-center justify-center border border-[var(--color-bad)] text-sm font-medium text-[var(--color-bad)]"
            >
              削除
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          disabled={draft.columnSelection.length >= 50}
          className="inline-flex h-12 items-center justify-center border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm font-medium text-[var(--ink)] disabled:opacity-50"
          data-testid="csv-export-add-row"
        >
          列を追加
        </button>
        {fieldErrors.columnSelection ? (
          <p className="text-xs font-medium text-[var(--color-bad)]" role="alert">
            {fieldErrors.columnSelection}
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}
