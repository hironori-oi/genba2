"use client";

import { useMemo, useState, useTransition } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { FormModal } from "@/components/admin/FormModal";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { RowActionsMenu } from "@/components/admin/RowActionsMenu";
import { isErr } from "@/lib/admin/shared/result";
import type {
  QrFormatDefinition,
  QrItemDefinition,
  QrType,
} from "@/lib/qr/types";
import {
  cloneAsNewVersionAction,
  deleteQrFormatAction,
  saveQrFormatAction,
  setFormatReadableBulkAction,
} from "./actions";

/**
 * Phase 5b QR formats editor (architect §3.2.1 + §9 R-P5-05).
 *
 * Surfaces:
 *   - format list with readable/issuable chips
 *   - "新規追加" → FormModal with format header + items grid
 *   - "新バージョン" → cloneAsNewVersionAction (R-P5-04 parallel)
 *   - "全フォーマットを読取不可" → bulk update guarded by a *two-step*
 *     ConfirmDialog with requireExplicit=true (R-P5-05)
 */

const DELIMITERS = [
  { value: "comma", label: "カンマ ," },
  { value: "tab", label: "タブ" },
  { value: "pipe", label: "パイプ |" },
  { value: "other", label: "その他" },
] as const;

const ENCODINGS = [
  { value: "utf8", label: "UTF-8" },
  { value: "shift_jis", label: "Shift_JIS" },
] as const;

const DATA_TYPES = [
  { value: "text", label: "テキスト" },
  { value: "numeric", label: "数値" },
  { value: "date", label: "日付" },
] as const;

const MISSING_ACTIONS = [
  { value: "error", label: "エラー" },
  { value: "allow_blank", label: "空欄許容" },
] as const;

function newId(): string {
  return `new-${Math.random().toString(36).slice(2, 10)}`;
}

function blankFormat(qrType: QrType, version: number): QrFormatDefinition {
  return {
    id: newId(),
    tenantId: "",
    qrType,
    version,
    formatCode: "",
    formatName: "",
    delimiter: "pipe",
    delimiterChar: null,
    encoding: "utf8",
    readable: true,
    issuable: false,
    validFrom: new Date().toISOString().slice(0, 10),
    items: [
      {
        position: 1,
        qrItemName: "",
        targetColumn: "",
        required: true,
        dataType: "text",
        dateFormat: null,
        missingValueAction: "error",
      },
    ],
  };
}

export type QrFormatsEditorProps = {
  qrType: QrType;
  initial: QrFormatDefinition[];
};

export function QrFormatsEditor({ qrType, initial }: QrFormatsEditorProps) {
  const [formats, setFormats] = useState<QrFormatDefinition[]>(initial);
  const [draft, setDraft] = useState<QrFormatDefinition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QrFormatDefinition | null>(null);
  const [bulkUnreadableStep, setBulkUnreadableStep] = useState<0 | 1 | 2>(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, startTransition] = useTransition();

  const nextVersion = useMemo(
    () => Math.max(0, ...formats.map((f) => f.version)) + 1,
    [formats],
  );

  const columns = useMemo<DataTableColumn<QrFormatDefinition>[]>(
    () => [
      {
        key: "version",
        header: "バージョン",
        render: (r) => <span className="font-mono">V{r.version}</span>,
        width: "96px",
      },
      {
        key: "formatName",
        header: "フォーマット名",
        render: (r) => r.formatName,
      },
      {
        key: "delimiter",
        header: "区切り",
        render: (r) => <span className="font-mono text-xs">{r.delimiter}</span>,
        width: "100px",
      },
      {
        key: "readable",
        header: "readable",
        render: (r) => (
          <span
            className={
              "inline-flex items-center rounded-full border px-2 py-0.5 text-xs " +
              (r.readable
                ? "border-[var(--color-ok)] text-[var(--color-ok)]"
                : "border-[var(--color-bad)] text-[var(--color-bad)]")
            }
          >
            {r.readable ? "可" : "不可"}
          </span>
        ),
        width: "90px",
      },
      {
        key: "issuable",
        header: "issuable",
        render: (r) => (
          <span
            className={
              "inline-flex items-center rounded-full border px-2 py-0.5 text-xs " +
              (r.issuable
                ? "border-[var(--color-ok)] text-[var(--color-ok)]"
                : "border-[var(--border)] text-[var(--muted)]")
            }
          >
            {r.issuable ? "発行候補" : "対象外"}
          </span>
        ),
        width: "100px",
      },
      {
        key: "items",
        header: "項目数",
        render: (r) => <span className="tabular-nums">{r.items.length}</span>,
        align: "end",
        width: "80px",
      },
    ],
    [],
  );

  function openCreate() {
    setDraft(blankFormat(qrType, nextVersion));
    setError(null);
    setNotice(null);
    setFieldErrors({});
  }

  function openEdit(row: QrFormatDefinition) {
    setDraft(structuredClone(row));
    setError(null);
    setNotice(null);
    setFieldErrors({});
  }

  function closeForm() {
    setDraft(null);
    setFieldErrors({});
  }

  function updateDraft(patch: Partial<QrFormatDefinition>) {
    if (!draft) return;
    setDraft({ ...draft, ...patch });
  }

  function updateItem(idx: number, patch: Partial<QrItemDefinition>) {
    if (!draft) return;
    setDraft({
      ...draft,
      items: draft.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    });
  }

  function addItem() {
    if (!draft) return;
    const nextPos = (draft.items[draft.items.length - 1]?.position ?? 0) + 1;
    setDraft({
      ...draft,
      items: [
        ...draft.items,
        {
          position: nextPos,
          qrItemName: "",
          targetColumn: "",
          required: false,
          dataType: "text",
          dateFormat: null,
          missingValueAction: "allow_blank",
        },
      ],
    });
  }

  function removeItem(idx: number) {
    if (!draft) return;
    setDraft({
      ...draft,
      items: draft.items
        .filter((_, i) => i !== idx)
        .map((it, i) => ({ ...it, position: i + 1 })),
    });
  }

  function handleSubmit() {
    if (!draft) return;
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await saveQrFormatAction(draft);
      if (isErr(result)) {
        setError(result.message);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        return;
      }
      const persistedId = result.data.id;
      setFormats((prev) => {
        const idx = prev.findIndex((f) => f.id === draft.id);
        const next = { ...draft, id: persistedId };
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = next;
          return copy;
        }
        return [...prev, next];
      });
      setNotice("保存しました。");
      closeForm();
    });
  }

  function handleClone(row: QrFormatDefinition) {
    if (row.id.startsWith("new-")) {
      setError("先に保存してから複製してください。");
      return;
    }
    startTransition(async () => {
      const result = await cloneAsNewVersionAction(row.id);
      if (isErr(result)) {
        setError(result.message);
        return;
      }
      setNotice(`V${result.data.version} を作成しました。`);
      const newFmt = blankFormat(row.qrType, result.data.version);
      newFmt.id = result.data.id;
      newFmt.formatCode = row.formatCode;
      newFmt.formatName = `${row.formatName} (V${result.data.version})`;
      newFmt.items = row.items.map((it) => ({ ...it }));
      setFormats((prev) => [...prev, newFmt]);
    });
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    startTransition(async () => {
      const result = await deleteQrFormatAction(target.id);
      if (isErr(result)) {
        setError(result.message);
        return;
      }
      setFormats((prev) => prev.filter((f) => f.id !== target.id));
      setNotice("削除しました。");
    });
  }

  function startBulkUnreadable() {
    setBulkUnreadableStep(1);
  }

  function handleBulkUnreadableConfirm() {
    if (bulkUnreadableStep === 1) {
      setBulkUnreadableStep(2);
      return;
    }
    const ids = formats.filter((f) => !f.id.startsWith("new-")).map((f) => f.id);
    setBulkUnreadableStep(0);
    startTransition(async () => {
      const result = await setFormatReadableBulkAction({
        ids,
        readable: false,
        acknowledged: true,
      });
      if (isErr(result)) {
        setError(result.message);
        return;
      }
      setFormats((prev) => prev.map((f) => (ids.includes(f.id) ? { ...f, readable: false } : f)));
      setNotice(`${result.data.updated} 件のフォーマットを読取不可に更新しました。`);
    });
  }

  return (
    <section className="flex flex-col gap-3" data-component="qr-formats-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--muted)]">{formats.length} 件</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="danger"
            size="lg"
            onClick={startBulkUnreadable}
            disabled={formats.length === 0}
            data-testid="qr-bulk-unreadable"
          >
            すべて読取不可
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={openCreate}
            data-testid="qr-format-create"
          >
            新規追加
          </Button>
        </div>
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

      <DataTable
        rows={formats}
        columns={columns}
        rowKey={(r) => r.id}
        renderActions={(row) => (
          <div className="flex justify-end">
            <RowActionsMenu
              label={`V${row.version} ${row.formatName || row.formatCode} の操作`}
              buttonTestId={`qr-row-actions-${row.version}`}
              actions={[
                {
                  label: "編集",
                  testId: `qr-row-edit-${row.version}`,
                  onSelect: () => openEdit(row),
                },
                {
                  label: "新バージョンへ複製",
                  hint: `V${row.version} を元に V${
                    Math.max(0, ...formats.map((f) => f.version)) + 1
                  } を作成`,
                  testId: `qr-clone-${row.version}`,
                  disabled: row.id.startsWith("new-"),
                  onSelect: () => handleClone(row),
                },
                {
                  label: "削除",
                  variant: "danger",
                  testId: `qr-row-delete-${row.version}`,
                  onSelect: () => setDeleteTarget(row),
                },
              ]}
            />
          </div>
        )}
        emptyMessage="まだフォーマットが登録されていません。"
        caption="QR フォーマット一覧"
        actionsWidth="120px"
      />
      <p className="text-xs text-[var(--muted)]">
        各行の「操作 ▾」から編集 / 新バージョン複製 / 削除を実行できます。
      </p>

      <FormModal
        open={draft !== null}
        onClose={closeForm}
        title={draft && formats.some((f) => f.id === draft.id) ? "QR フォーマット編集" : "QR フォーマット 新規追加"}
        onSubmit={() => handleSubmit()}
        submitting={submitting}
      >
        {draft ? (
          <div className="flex flex-col gap-4">
            <Field
              label="フォーマットコード"
              required
              value={draft.formatCode}
              onChange={(e) => updateDraft({ formatCode: e.target.value })}
              error={fieldErrors.formatCode}
              data-testid="qr-form-code"
              hint="英数字 / - / _ のみ"
            />
            <Field
              label="フォーマット名"
              required
              value={draft.formatName}
              onChange={(e) => updateDraft({ formatName: e.target.value })}
              error={fieldErrors.formatName}
            />
            <Field
              label="バージョン"
              required
              type="number"
              value={String(draft.version)}
              onChange={(e) => updateDraft({ version: Number(e.target.value) })}
              error={fieldErrors.version}
              min={1}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-[var(--ink)]">区切り</label>
                <select
                  value={draft.delimiter}
                  onChange={(e) =>
                    updateDraft({ delimiter: e.target.value as QrFormatDefinition["delimiter"] })
                  }
                  className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
                >
                  {DELIMITERS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-[var(--ink)]">エンコード</label>
                <select
                  value={draft.encoding}
                  onChange={(e) =>
                    updateDraft({ encoding: e.target.value as QrFormatDefinition["encoding"] })
                  }
                  className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
                >
                  {ENCODINGS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Field
              label="有効開始日"
              type="date"
              required
              value={draft.validFrom}
              onChange={(e) => updateDraft({ validFrom: e.target.value })}
              error={fieldErrors.validFrom}
            />
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex h-12 cursor-pointer items-center gap-2 text-sm text-[var(--ink)]">
                <input
                  type="checkbox"
                  checked={draft.readable}
                  onChange={(e) => updateDraft({ readable: e.target.checked })}
                  className="h-5 w-5 accent-[var(--color-brand)]"
                />
                読取可 (readable)
              </label>
              <label className="inline-flex h-12 cursor-pointer items-center gap-2 text-sm text-[var(--ink)]">
                <input
                  type="checkbox"
                  checked={draft.issuable}
                  onChange={(e) => updateDraft({ issuable: e.target.checked })}
                  className="h-5 w-5 accent-[var(--color-brand)]"
                />
                発行候補 (issuable)
              </label>
            </div>

            <section aria-labelledby="qr-items-heading" className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 id="qr-items-heading" className="text-sm font-semibold text-[var(--ink)]">
                  QR 項目 (position 順)
                </h3>
                <Button type="button" size="md" variant="ghost" onClick={addItem}>
                  + 項目を追加
                </Button>
              </div>
              {draft.items.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">項目が未登録です。</p>
              ) : (
                <div className="overflow-x-auto border border-[var(--border)]">
                  <table className="min-w-full divide-y divide-[var(--border)] text-sm">
                    <thead className="bg-[var(--surface-2)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                      <tr>
                        <th scope="col" className="px-2 py-2">位置</th>
                        <th scope="col" className="px-2 py-2">項目名</th>
                        <th scope="col" className="px-2 py-2">対象列</th>
                        <th scope="col" className="px-2 py-2">型</th>
                        <th scope="col" className="px-2 py-2">必須</th>
                        <th scope="col" className="px-2 py-2">欠落時</th>
                        <th scope="col" className="px-2 py-2">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
                      {draft.items.map((it, idx) => (
                        <tr key={idx}>
                          <td className="px-2 py-2 font-mono text-xs">{it.position}</td>
                          <td className="px-2 py-2">
                            <input
                              aria-label={`項目名 ${idx + 1}`}
                              value={it.qrItemName}
                              onChange={(e) => updateItem(idx, { qrItemName: e.target.value })}
                              className="h-10 w-full min-w-32 border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              aria-label={`対象列 ${idx + 1}`}
                              value={it.targetColumn}
                              onChange={(e) => updateItem(idx, { targetColumn: e.target.value })}
                              className="h-10 w-full min-w-32 border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <select
                              aria-label={`型 ${idx + 1}`}
                              value={it.dataType}
                              onChange={(e) =>
                                updateItem(idx, {
                                  dataType: e.target.value as QrItemDefinition["dataType"],
                                })
                              }
                              className="h-10 w-full min-w-24 border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                            >
                              {DATA_TYPES.map((d) => (
                                <option key={d.value} value={d.value}>
                                  {d.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <label className="inline-flex h-10 cursor-pointer items-center justify-center">
                              <span className="sr-only">{`項目 ${idx + 1} 必須`}</span>
                              <input
                                type="checkbox"
                                checked={it.required}
                                onChange={(e) => updateItem(idx, { required: e.target.checked })}
                                className="h-5 w-5 accent-[var(--color-brand)]"
                              />
                            </label>
                          </td>
                          <td className="px-2 py-2">
                            <select
                              aria-label={`欠落時 ${idx + 1}`}
                              value={it.missingValueAction}
                              onChange={(e) =>
                                updateItem(idx, {
                                  missingValueAction:
                                    e.target.value as QrItemDefinition["missingValueAction"],
                                })
                              }
                              className="h-10 w-full min-w-24 border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                            >
                              {MISSING_ACTIONS.map((m) => (
                                <option key={m.value} value={m.value}>
                                  {m.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <Button
                              type="button"
                              size="md"
                              variant="ghost"
                              onClick={() => removeItem(idx)}
                            >
                              削除
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        ) : null}
      </FormModal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="QR フォーマット削除"
        message={`このフォーマット (V${deleteTarget?.version}) を削除します。続行しますか？`}
        confirmLabel="削除"
        danger
        busy={submitting}
      />

      <ConfirmDialog
        open={bulkUnreadableStep === 1}
        onClose={() => setBulkUnreadableStep(0)}
        onConfirm={handleBulkUnreadableConfirm}
        title="全フォーマットを読取不可にする (1/2)"
        message={
          <>
            この QR タイプの全フォーマット (V1〜V{nextVersion - 1}) を「読取不可」に変更します。
            実行すると業務画面でのスキャンが拒否されます。続行しますか？
          </>
        }
        confirmLabel="次へ進む"
        danger
      />
      <ConfirmDialog
        open={bulkUnreadableStep === 2}
        onClose={() => setBulkUnreadableStep(0)}
        onConfirm={handleBulkUnreadableConfirm}
        title="全フォーマットを読取不可にする (2/2)"
        message="本当に実行しますか？業務継続に重大な影響があります。"
        confirmLabel="実行"
        danger
        requireExplicit
        busy={submitting}
      />
    </section>
  );
}
