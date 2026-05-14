"use client";

import { useState, useTransition, type ReactNode, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { FormModal } from "@/components/admin/FormModal";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { isErr, type AdminActionResult } from "@/lib/admin/shared/result";

/**
 * MasterCrudTable — Phase 5b shared client wrapper (architect §3.2.0 +
 * §3.2.6). Composes DataTable + FormModal + ConfirmDialog and adds:
 *
 *   * Stateful row list with optimistic insert / update / soft-delete.
 *   * `formRender` callback so each master (work_types / processes /
 *     equipment / defect_groups / defects) supplies its own form fields.
 *   * Field-level error surface from AdminActionResult.fieldErrors so zod
 *     parse failures map back to the correct input.
 *
 * The wrapper is intentionally generic over the row shape so the manufact-
 * uring master CRUD page can render five tabs from one component. QR /
 * match-rule editors keep their bespoke layout because their nested-child
 * (qr_items / match_rule_lines) shape doesn't fit a flat table.
 */

export type MasterCrudActionResult = AdminActionResult<{ id: string }>;

export type MasterCrudTableProps<TRow extends { id: string }> = {
  caption: string;
  rows: ReadonlyArray<TRow>;
  columns: ReadonlyArray<DataTableColumn<TRow>>;
  /**
   * Build a blank row for the "new" form. Receives no args and must return
   * a row shape that satisfies the form's expectations (commonly with an
   * `id` like `new-…` so the action can detect "create vs update").
   */
  buildBlank: () => TRow;
  /** Form fields. Caller controls the inputs and calls `onChange(next)` to update. */
  formRender: (row: TRow, onChange: (next: TRow) => void, fieldErrors: Record<string, string>) => ReactNode;
  /** Persist a row (create or update). Resolves with `{id}` on success. */
  onSave: (row: TRow) => Promise<MasterCrudActionResult>;
  /** Soft-delete the row by id. */
  onDelete: (id: string) => Promise<AdminActionResult<void>>;
  /** Visible action labels — caller can override for clarity ("品種を追加" etc). */
  createLabel?: string;
  emptyMessage?: ReactNode;
};

export function MasterCrudTable<TRow extends { id: string }>(
  props: MasterCrudTableProps<TRow>,
) {
  const {
    caption,
    rows: initialRows,
    columns,
    buildBlank,
    formRender,
    onSave,
    onDelete,
    createLabel = "新規追加",
    emptyMessage,
  } = props;

  const [rows, setRows] = useState<TRow[]>([...initialRows]);
  const [draft, setDraft] = useState<TRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, startTransition] = useTransition();

  function openCreate() {
    setDraft(buildBlank());
    setFieldErrors({});
    setError(null);
    setNotice(null);
  }

  function openEdit(row: TRow) {
    setDraft(structuredClone(row));
    setFieldErrors({});
    setError(null);
    setNotice(null);
  }

  function closeForm() {
    setDraft(null);
    setFieldErrors({});
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft) return;
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await onSave(draft);
      if (isErr(result)) {
        setError(result.message);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        return;
      }
      const persistedId = result.data.id;
      setRows((prev) => {
        const existingIdx = prev.findIndex((r) => r.id === draft.id);
        if (existingIdx >= 0) {
          const next = [...prev];
          next[existingIdx] = { ...draft, id: persistedId };
          return next;
        }
        return [...prev, { ...draft, id: persistedId }];
      });
      setNotice("保存しました。");
      closeForm();
    });
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setError(null);
    startTransition(async () => {
      const result = await onDelete(target.id);
      if (isErr(result)) {
        setError(result.message);
        setDeleteTarget(null);
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== target.id));
      setNotice(`削除しました: ${target.id}`);
      setDeleteTarget(null);
    });
  }

  return (
    <section className="flex flex-col gap-3" data-component="master-crud-table">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--muted)]">{rows.length} 件</p>
        <Button
          type="button"
          size="lg"
          onClick={openCreate}
          data-testid="master-crud-create"
        >
          {createLabel}
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

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onEdit={openEdit}
        onDelete={(r) => setDeleteTarget(r)}
        caption={caption}
        emptyMessage={emptyMessage}
      />

      <FormModal
        open={draft !== null}
        onClose={closeForm}
        title={draft && rows.some((r) => r.id === draft.id) ? "編集" : "新規追加"}
        onSubmit={handleSubmit}
        submitting={submitting}
      >
        {draft ? formRender(draft, setDraft, fieldErrors) : null}
      </FormModal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="削除"
        message={
          <>
            この行を削除します。削除後は復元できません。続行しますか？
          </>
        }
        confirmLabel="削除"
        danger
        busy={submitting}
      />
    </section>
  );
}
