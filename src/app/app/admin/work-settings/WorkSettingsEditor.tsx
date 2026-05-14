"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { FormModal } from "@/components/admin/FormModal";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { isErr } from "@/lib/admin/shared/result";
import {
  deleteWorkInputFieldSettingAction,
  saveWorkInputFieldSettingAction,
  saveWorkSettingsAction,
} from "./actions";

/**
 * Phase 5c work_settings + work_input_field_settings client editor
 * (architect §3.2.5).
 *
 * `work_settings` は (tenant_id, business_code) UNIQUE のため 4 業務 × 1 行。
 * 業務を tab で切り替え、上段に「業務フロー (work_settings)」のフォーム、
 * 下段に「入力対象項目 (work_input_field_settings)」の DataTable + Modal。
 */

export type BusinessCode = "receiving" | "picking" | "inventory" | "manufacturing";

const BUSINESSES: ReadonlyArray<{ code: BusinessCode; label: string }> = [
  { code: "receiving", label: "入庫" },
  { code: "picking", label: "ピッキング" },
  { code: "inventory", label: "棚卸" },
  { code: "manufacturing", label: "製造" },
];

export type QrFormatOption = {
  id: string;
  qrType: "header" | "line" | "label";
  formatCode: string;
  formatName: string;
  version: number;
};

export type MatchRuleOption = {
  id: string;
  businessCode: BusinessCode;
  ruleCode: string;
  ruleName: string;
};

export type FieldOption = {
  fieldCode: string;
  label: string;
};

export type WorkSettingsRow = {
  id: string;
  businessCode: BusinessCode;
  workMode: "ticket" | "free";
  matchMode: "double" | "none";
  ngFlow: "block" | "warn" | "approve";
  correctionApproval: boolean;
  headerFormatId: string | null;
  lineFormatId: string | null;
  labelFormatId: string | null;
  matchRuleId: string | null;
  enabled: boolean;
};

export type WorkInputFieldRow = {
  id: string;
  businessCode: BusinessCode;
  fieldCode: string;
  enabled: boolean;
  required: boolean;
  sortOrder: number;
};

const WORK_MODES = [
  { value: "ticket", label: "伝票指示" },
  { value: "free", label: "フリー" },
] as const;

const MATCH_MODES = [
  { value: "double", label: "2 点照合" },
  { value: "none", label: "照合なし" },
] as const;

const NG_FLOWS = [
  { value: "block", label: "ブロック (登録不可)" },
  { value: "warn", label: "警告のみ" },
  { value: "approve", label: "承認後に登録" },
] as const;

function newId(): string {
  return `new-${Math.random().toString(36).slice(2, 10)}`;
}

function blankSettings(businessCode: BusinessCode): WorkSettingsRow {
  return {
    id: newId(),
    businessCode,
    workMode: "ticket",
    matchMode: "double",
    ngFlow: "warn",
    correctionApproval: false,
    headerFormatId: null,
    lineFormatId: null,
    labelFormatId: null,
    matchRuleId: null,
    enabled: true,
  };
}

function blankInputField(businessCode: BusinessCode): WorkInputFieldRow {
  return {
    id: newId(),
    businessCode,
    fieldCode: "",
    enabled: true,
    required: false,
    sortOrder: 10,
  };
}

export type WorkSettingsEditorProps = {
  activeBusiness: BusinessCode;
  settings: WorkSettingsRow[];
  inputFields: WorkInputFieldRow[];
  qrFormatOptions: QrFormatOption[];
  matchRuleOptions: MatchRuleOption[];
  fieldOptions: FieldOption[];
  liveMode: boolean;
};

export function WorkSettingsEditor({
  activeBusiness,
  settings,
  inputFields,
  qrFormatOptions,
  matchRuleOptions,
  fieldOptions,
  liveMode,
}: WorkSettingsEditorProps) {
  const [allSettings, setAllSettings] = useState<WorkSettingsRow[]>(settings);
  const [allFields, setAllFields] = useState<WorkInputFieldRow[]>(inputFields);
  const [draft, setDraft] = useState<WorkSettingsRow | null>(null);
  const [fieldDraft, setFieldDraft] = useState<WorkInputFieldRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkInputFieldRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, startTransition] = useTransition();

  const current = useMemo<WorkSettingsRow>(
    () =>
      allSettings.find((s) => s.businessCode === activeBusiness) ??
      blankSettings(activeBusiness),
    [allSettings, activeBusiness],
  );

  const fieldsForBusiness = useMemo(
    () => allFields.filter((f) => f.businessCode === activeBusiness),
    [allFields, activeBusiness],
  );

  const headerFormatOptions = qrFormatOptions.filter((q) => q.qrType === "header");
  const lineFormatOptions = qrFormatOptions.filter((q) => q.qrType === "line");
  const labelFormatOptions = qrFormatOptions.filter((q) => q.qrType === "label");
  const matchRulesForBusiness = matchRuleOptions.filter(
    (r) => r.businessCode === activeBusiness,
  );

  function openEditSettings() {
    setError(null);
    setNotice(null);
    setFieldErrors({});
    setDraft(structuredClone(current));
  }

  function closeSettings() {
    setDraft(null);
    setFieldErrors({});
  }

  function handleSettingsSubmit() {
    if (!draft) return;
    setError(null);
    setFieldErrors({});
    const submitDraft = draft;
    startTransition(async () => {
      const result = await saveWorkSettingsAction(submitDraft);
      if (isErr(result)) {
        setError(result.message);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        return;
      }
      const persistedId = result.data.id;
      setAllSettings((prev) => {
        const idx = prev.findIndex((s) => s.businessCode === submitDraft.businessCode);
        const saved: WorkSettingsRow = { ...submitDraft, id: persistedId };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [...prev, saved];
      });
      setNotice("業務設定を保存しました。");
      closeSettings();
    });
  }

  function openCreateField() {
    setError(null);
    setNotice(null);
    setFieldErrors({});
    setFieldDraft(blankInputField(activeBusiness));
  }

  function openEditField(row: WorkInputFieldRow) {
    setError(null);
    setNotice(null);
    setFieldErrors({});
    setFieldDraft(structuredClone(row));
  }

  function closeFieldModal() {
    setFieldDraft(null);
    setFieldErrors({});
  }

  function handleFieldSubmit() {
    if (!fieldDraft) return;
    setError(null);
    setFieldErrors({});
    const submitDraft = fieldDraft;
    startTransition(async () => {
      const result = await saveWorkInputFieldSettingAction(submitDraft);
      if (isErr(result)) {
        setError(result.message);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        return;
      }
      const persistedId = result.data.id;
      setAllFields((prev) => {
        const idx = prev.findIndex((f) => f.id === submitDraft.id);
        const saved: WorkInputFieldRow = { ...submitDraft, id: persistedId };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [...prev, saved];
      });
      setNotice("入力項目を保存しました。");
      closeFieldModal();
    });
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    startTransition(async () => {
      const result = await deleteWorkInputFieldSettingAction(target.id);
      if (isErr(result)) {
        setError(result.message);
        return;
      }
      setAllFields((prev) => prev.filter((f) => f.id !== target.id));
      setNotice("入力項目を削除しました。");
    });
  }

  const fieldColumns = useMemo<DataTableColumn<WorkInputFieldRow>[]>(
    () => [
      {
        key: "fieldCode",
        header: "項目コード",
        render: (r) => <span className="font-mono">{r.fieldCode}</span>,
      },
      {
        key: "enabled",
        header: "有効",
        render: (r) => (r.enabled ? "○" : "—"),
        width: "80px",
      },
      {
        key: "required",
        header: "必須",
        render: (r) => (r.required ? "○" : "—"),
        width: "80px",
      },
      {
        key: "sortOrder",
        header: "並び順",
        render: (r) => <span className="tabular-nums">{r.sortOrder}</span>,
        align: "end",
        width: "96px",
      },
    ],
    [],
  );

  const findFormatLabel = (id: string | null) => {
    if (!id) return "(未設定)";
    const f = qrFormatOptions.find((q) => q.id === id);
    return f ? `${f.formatCode} V${f.version}` : "(不明)";
  };
  const findMatchRuleLabel = (id: string | null) => {
    if (!id) return "(未設定)";
    const r = matchRuleOptions.find((m) => m.id === id);
    return r ? `${r.ruleCode} / ${r.ruleName}` : "(不明)";
  };

  return (
    <section className="flex flex-col gap-6" data-component="work-settings-editor">
      <nav
        aria-label="業務"
        className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-2"
      >
        {BUSINESSES.map((b) => (
          <Link
            key={b.code}
            href={`/app/admin/work-settings?business=${b.code}`}
            aria-current={activeBusiness === b.code ? "page" : undefined}
            data-testid={`work-settings-tab-${b.code}`}
            className={
              "inline-flex h-12 items-center border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] " +
              (activeBusiness === b.code
                ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-brand-foreground)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--color-brand)]")
            }
          >
            {b.label}
          </Link>
        ))}
      </nav>

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

      <section
        aria-labelledby="flow-heading"
        className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <header className="flex items-center justify-between">
          <h3 id="flow-heading" className="text-base font-semibold text-[var(--ink)]">
            業務フロー / 紐付フォーマット
          </h3>
          <Button
            type="button"
            size="lg"
            onClick={openEditSettings}
            data-testid="work-settings-edit"
          >
            編集
          </Button>
        </header>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <Definition label="作業モード" value={WORK_MODES.find((m) => m.value === current.workMode)?.label ?? current.workMode} />
          <Definition label="照合モード" value={MATCH_MODES.find((m) => m.value === current.matchMode)?.label ?? current.matchMode} />
          <Definition label="NG フロー" value={NG_FLOWS.find((m) => m.value === current.ngFlow)?.label ?? current.ngFlow} />
          <Definition label="訂正承認" value={current.correctionApproval ? "必要" : "不要"} />
          <Definition label="ヘッダ QR" value={findFormatLabel(current.headerFormatId)} />
          <Definition label="明細 QR" value={findFormatLabel(current.lineFormatId)} />
          <Definition label="現品 QR" value={findFormatLabel(current.labelFormatId)} />
          <Definition label="照合ルール" value={findMatchRuleLabel(current.matchRuleId)} />
          <Definition label="有効" value={current.enabled ? "有効" : "無効"} />
        </dl>
        {current.ngFlow === "block" ? (
          <Alert tone="info" title="NG ブロックの影響">
            この業務で「NG=ブロック」を選んでいる場合、スキャナで照合 NG が出た際の登録ボタンは無効化されます (`src/lib/scanner/scanner-state.ts` 参照)。
          </Alert>
        ) : null}
      </section>

      <section
        aria-labelledby="input-fields-heading"
        className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <header className="flex items-center justify-between">
          <h3
            id="input-fields-heading"
            className="text-base font-semibold text-[var(--ink)]"
          >
            入力対象項目 ({BUSINESSES.find((b) => b.code === activeBusiness)?.label})
          </h3>
          <Button
            type="button"
            size="lg"
            onClick={openCreateField}
            data-testid="work-input-field-create"
          >
            入力項目を追加
          </Button>
        </header>
        <DataTable
          rows={fieldsForBusiness}
          columns={fieldColumns}
          rowKey={(r) => r.id}
          onEdit={openEditField}
          onDelete={(r) => setDeleteTarget(r)}
          caption={`${activeBusiness} の入力対象項目`}
          emptyMessage="まだ入力対象項目が定義されていません。"
        />
      </section>

      <FormModal
        open={draft !== null}
        onClose={closeSettings}
        title={`${BUSINESSES.find((b) => b.code === activeBusiness)?.label} の業務設定`}
        onSubmit={() => handleSettingsSubmit()}
        submitting={submitting}
      >
        {draft ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--ink)]">作業モード</label>
              <select
                value={draft.workMode}
                onChange={(e) =>
                  setDraft({ ...draft, workMode: e.target.value as WorkSettingsRow["workMode"] })
                }
                className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
              >
                {WORK_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--ink)]">照合モード</label>
              <select
                value={draft.matchMode}
                onChange={(e) =>
                  setDraft({ ...draft, matchMode: e.target.value as WorkSettingsRow["matchMode"] })
                }
                className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
              >
                {MATCH_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--ink)]">NG フロー</label>
              <select
                value={draft.ngFlow}
                onChange={(e) =>
                  setDraft({ ...draft, ngFlow: e.target.value as WorkSettingsRow["ngFlow"] })
                }
                className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
              >
                {NG_FLOWS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="inline-flex h-12 cursor-pointer items-center gap-2 text-sm text-[var(--ink)]">
              <input
                type="checkbox"
                checked={draft.correctionApproval}
                onChange={(e) =>
                  setDraft({ ...draft, correctionApproval: e.target.checked })
                }
                className="h-5 w-5 accent-[var(--color-brand)]"
              />
              訂正に承認を必要とする
            </label>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--ink)]">ヘッダ QR フォーマット</label>
              <select
                value={draft.headerFormatId ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, headerFormatId: e.target.value || null })
                }
                className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
              >
                <option value="">(未設定)</option>
                {headerFormatOptions.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.formatCode} V{q.version} / {q.formatName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--ink)]">明細 QR フォーマット</label>
              <select
                value={draft.lineFormatId ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, lineFormatId: e.target.value || null })
                }
                className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
              >
                <option value="">(未設定)</option>
                {lineFormatOptions.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.formatCode} V{q.version} / {q.formatName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--ink)]">現品 QR フォーマット</label>
              <select
                value={draft.labelFormatId ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, labelFormatId: e.target.value || null })
                }
                className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
              >
                <option value="">(未設定)</option>
                {labelFormatOptions.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.formatCode} V{q.version} / {q.formatName}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[var(--muted)]">読取不可 (readable=false) のフォーマットは選択肢に出ません。</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--ink)]">照合ルール</label>
              <select
                value={draft.matchRuleId ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, matchRuleId: e.target.value || null })
                }
                className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
              >
                <option value="">(未設定)</option>
                {matchRulesForBusiness.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.ruleCode} / {r.ruleName}
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
              この業務設定を有効にする
            </label>
          </div>
        ) : null}
      </FormModal>

      <FormModal
        open={fieldDraft !== null}
        onClose={closeFieldModal}
        title={
          fieldDraft && allFields.some((f) => f.id === fieldDraft.id)
            ? "入力項目 編集"
            : "入力項目 追加"
        }
        onSubmit={() => handleFieldSubmit()}
        submitting={submitting}
      >
        {fieldDraft ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--ink)]">項目コード</label>
              <select
                value={fieldDraft.fieldCode}
                onChange={(e) =>
                  setFieldDraft({ ...fieldDraft, fieldCode: e.target.value })
                }
                className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
                data-testid="work-input-field-code"
              >
                <option value="">(選択してください)</option>
                {fieldOptions.map((f) => (
                  <option key={f.fieldCode} value={f.fieldCode}>
                    {f.fieldCode} / {f.label}
                  </option>
                ))}
              </select>
              {fieldErrors.fieldCode ? (
                <p className="text-xs font-medium text-[var(--color-bad)]" role="alert">
                  {fieldErrors.fieldCode}
                </p>
              ) : null}
              <p className="text-xs text-[var(--muted)]">
                tenant_field_settings で「利用 ON」になっている項目のみ候補に表示されます。
              </p>
            </div>
            <Field
              label="並び順"
              type="number"
              value={String(fieldDraft.sortOrder)}
              onChange={(e) =>
                setFieldDraft({ ...fieldDraft, sortOrder: Number(e.target.value) })
              }
              error={fieldErrors.sortOrder}
              min={0}
              max={10000}
              step={10}
            />
            <label className="inline-flex h-12 cursor-pointer items-center gap-2 text-sm text-[var(--ink)]">
              <input
                type="checkbox"
                checked={fieldDraft.enabled}
                onChange={(e) =>
                  setFieldDraft({ ...fieldDraft, enabled: e.target.checked })
                }
                className="h-5 w-5 accent-[var(--color-brand)]"
              />
              この項目を入力対象にする
            </label>
            <label className="inline-flex h-12 cursor-pointer items-center gap-2 text-sm text-[var(--ink)]">
              <input
                type="checkbox"
                checked={fieldDraft.required}
                onChange={(e) =>
                  setFieldDraft({ ...fieldDraft, required: e.target.checked })
                }
                className="h-5 w-5 accent-[var(--color-brand)]"
              />
              必須入力にする
            </label>
          </div>
        ) : null}
      </FormModal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="入力項目の削除"
        message={`項目「${deleteTarget?.fieldCode}」をこの業務から削除します。`}
        confirmLabel="削除"
        danger
        busy={submitting}
      />
    </section>
  );
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--border)] pb-2 last:border-b-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
      <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</dt>
      <dd className="text-sm font-medium text-[var(--ink)]">{value}</dd>
    </div>
  );
}
