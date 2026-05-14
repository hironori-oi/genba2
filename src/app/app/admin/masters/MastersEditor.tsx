"use client";

import { useMemo } from "react";
import { Field } from "@/components/ui/Field";
import {
  MasterCrudTable,
  type MasterCrudActionResult,
} from "@/components/admin/MasterCrudTable";
import type { DataTableColumn } from "@/components/admin/DataTable";
import { ok, type AdminActionResult } from "@/lib/admin/shared/result";
import type { MasterKind } from "@/lib/admin/shared/validation";
import { deleteMasterRowAction, saveMasterRowAction, type MasterRow } from "./actions";

/**
 * MastersEditor — Phase 5b 製造系 master CRUD client (architect §3.2.6).
 *
 * One component handles all five masters via the `kind` discriminator.
 * Each master picks a column list + form field set; the heavy lifting
 * (state, modal lifecycle, optimistic update) lives in MasterCrudTable.
 */

export type MastersEditorData = {
  rows: MasterRow[];
  processOptions: Array<{ id: string; code: string; name: string }>;
  defectGroupOptions: Array<{ id: string; code: string; name: string }>;
};

export type MastersEditorProps = {
  kind: MasterKind;
} & MastersEditorData;

type DraftRow = MasterRow;

function newId(): string {
  return `new-${Math.random().toString(36).slice(2, 10)}`;
}

const BUSINESS_OPTIONS = [
  { value: "", label: "(未指定)" },
  { value: "receiving", label: "入庫" },
  { value: "picking", label: "ピッキング" },
  { value: "inventory", label: "棚卸" },
  { value: "manufacturing", label: "製造" },
] as const;

const SEVERITY_OPTIONS = [
  { value: "minor", label: "軽微" },
  { value: "major", label: "重大" },
  { value: "critical", label: "致命的" },
] as const;

export function MastersEditor({
  kind,
  rows,
  processOptions,
  defectGroupOptions,
}: MastersEditorProps) {
  const columns = useMemo<DataTableColumn<DraftRow>[]>(() => {
    const base: DataTableColumn<DraftRow>[] = [
      { key: "code", header: "コード", render: (r) => <span className="font-mono">{r.code}</span>, width: "160px" },
      { key: "name", header: "名称", render: (r) => r.name },
      {
        key: "sort_order",
        header: "並び順",
        render: (r) => <span className="tabular-nums">{r.sort_order}</span>,
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
    ];
    if (kind === "work_types") {
      base.push({
        key: "business",
        header: "対象業務",
        render: (r) =>
          BUSINESS_OPTIONS.find((b) => b.value === (r.business_code ?? ""))?.label ?? "(未指定)",
        width: "120px",
      });
    } else if (kind === "equipment") {
      base.push({
        key: "process",
        header: "工程",
        render: (r) => {
          const found = processOptions.find((p) => p.id === r.process_id);
          return found ? `${found.code} / ${found.name}` : "(未指定)";
        },
        width: "200px",
      });
    } else if (kind === "defects") {
      base.push({
        key: "group",
        header: "グループ",
        render: (r) => {
          const found = defectGroupOptions.find((g) => g.id === r.defect_group_id);
          return found ? `${found.code} / ${found.name}` : "(未指定)";
        },
        width: "200px",
      });
      base.push({
        key: "severity",
        header: "重大度",
        render: (r) =>
          SEVERITY_OPTIONS.find((s) => s.value === (r.severity ?? "minor"))?.label,
        width: "96px",
      });
    }
    return base;
  }, [kind, processOptions, defectGroupOptions]);

  function buildBlank(): DraftRow {
    return {
      id: newId(),
      code: "",
      name: "",
      sort_order: rows.length * 10 + 10,
      enabled: true,
      business_code: kind === "work_types" ? null : undefined,
      process_id: kind === "equipment" ? null : undefined,
      defect_group_id: kind === "defects" ? null : undefined,
      severity: kind === "defects" ? "minor" : undefined,
    };
  }

  async function onSave(row: DraftRow): Promise<MasterCrudActionResult> {
    const business = row.business_code;
    const businessCode =
      kind === "work_types" && business
        ? (business as "receiving" | "picking" | "inventory" | "manufacturing")
        : null;
    return await saveMasterRowAction({
      kind,
      id: row.id,
      row: {
        code: row.code,
        name: row.name,
        sortOrder: Number(row.sort_order),
        enabled: row.enabled,
        businessCode,
        processId: kind === "equipment" ? (row.process_id || null) : null,
        defectGroupId: kind === "defects" ? (row.defect_group_id || null) : null,
        severity:
          kind === "defects"
            ? ((row.severity as "minor" | "major" | "critical" | null) ?? "minor")
            : null,
      },
    });
  }

  async function onDelete(id: string): Promise<AdminActionResult<void>> {
    if (id.startsWith("new-")) return ok();
    return await deleteMasterRowAction({ kind, id });
  }

  return (
    <MasterCrudTable<DraftRow>
      caption={`${kind} の一覧`}
      rows={rows}
      columns={columns}
      buildBlank={buildBlank}
      onSave={onSave}
      onDelete={onDelete}
      emptyMessage="まだ登録されていません。「新規追加」から作成してください。"
      formRender={(draft, onChange, fieldErrors) => (
        <div className="flex flex-col gap-4">
          <Field
            label="コード"
            required
            value={draft.code}
            onChange={(e) => onChange({ ...draft, code: e.target.value })}
            error={fieldErrors.code}
            data-testid="master-form-code"
            hint="英数字 / - / _ のみ、1〜64 文字"
          />
          <Field
            label="名称"
            required
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            error={fieldErrors.name}
            data-testid="master-form-name"
          />
          <Field
            label="並び順"
            type="number"
            value={String(draft.sort_order)}
            onChange={(e) => onChange({ ...draft, sort_order: Number(e.target.value) })}
            error={fieldErrors.sortOrder}
            min={0}
            max={10000}
            step={10}
          />
          <label className="inline-flex h-12 cursor-pointer items-center gap-2 text-sm text-[var(--ink)]">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => onChange({ ...draft, enabled: e.target.checked })}
              className="h-5 w-5 accent-[var(--color-brand)]"
            />
            有効にする
          </label>

          {kind === "work_types" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--ink)]">対象業務</label>
              <select
                value={draft.business_code ?? ""}
                onChange={(e) => onChange({ ...draft, business_code: e.target.value || null })}
                className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
              >
                {BUSINESS_OPTIONS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {kind === "equipment" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--ink)]">関連工程</label>
              <select
                value={draft.process_id ?? ""}
                onChange={(e) => onChange({ ...draft, process_id: e.target.value || null })}
                className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
              >
                <option value="">(未指定)</option>
                {processOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} / {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {kind === "defects" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-[var(--ink)]">グループ</label>
                <select
                  value={draft.defect_group_id ?? ""}
                  onChange={(e) =>
                    onChange({ ...draft, defect_group_id: e.target.value || null })
                  }
                  className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
                >
                  <option value="">(未指定)</option>
                  {defectGroupOptions.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.code} / {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-[var(--ink)]">重大度</label>
                <select
                  value={draft.severity ?? "minor"}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      severity: e.target.value as "minor" | "major" | "critical",
                    })
                  }
                  className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
                >
                  {SEVERITY_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : null}
        </div>
      )}
    />
  );
}
