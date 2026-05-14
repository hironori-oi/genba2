"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { isErr } from "@/lib/admin/shared/result";
import { updateSubscriptionAction } from "./actions";

export type TenantRow = {
  tenantId: string;
  name: string;
  slug: string;
  plan: "logi" | "works" | "both";
  maxUsers: number;
  maxScansPerMonth: number;
  planStartedAt: string | null;
  planEndedAt: string | null;
};

export function TenantsEditor({ rows: initial }: { rows: TenantRow[] }) {
  const [rows, setRows] = useState<TenantRow[]>(initial);
  const [editing, setEditing] = useState<TenantRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, startTransition] = useTransition();

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const target = editing;
    setError(null);
    setNotice(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await updateSubscriptionAction({
        tenantId: target.tenantId,
        plan: target.plan,
        maxUsers: target.maxUsers,
        maxScansPerMonth: target.maxScansPerMonth,
        planStartedAt: target.planStartedAt,
        planEndedAt: target.planEndedAt,
      });
      if (isErr(result)) {
        setError(result.message);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        return;
      }
      setRows((prev) =>
        prev.map((r) => (r.tenantId === target.tenantId ? target : r)),
      );
      setNotice(`テナント ${target.slug} のサブスクリプションを保存しました。`);
      setEditing(null);
    });
  }

  return (
    <section className="flex flex-col gap-3" data-component="tenants-editor">
      {error ? (
        <Alert tone="error" title="保存エラー">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="ok" title="完了">
          {notice}
        </Alert>
      ) : null}

      <div className="w-full overflow-x-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">テナント一覧</caption>
          <thead className="bg-[var(--surface-2)] text-[var(--muted)]">
            <tr>
              <th scope="col" className="px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide">
                テナント名
              </th>
              <th scope="col" className="px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide">
                slug
              </th>
              <th scope="col" className="px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide">
                プラン
              </th>
              <th scope="col" className="px-3 py-3 text-end text-xs font-semibold uppercase tracking-wide">
                ユーザー上限
              </th>
              <th scope="col" className="px-3 py-3 text-end text-xs font-semibold uppercase tracking-wide">
                月間スキャン上限
              </th>
              <th scope="col" className="px-3 py-3 text-end text-xs font-semibold uppercase tracking-wide">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-[var(--muted)]">
                  テナントがありません。
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.tenantId} className="border-t border-[var(--border)]" data-testid={`tenants-row-${r.slug}`}>
                  <td className="px-3 py-3 align-middle text-[var(--ink)]">{r.name}</td>
                  <td className="px-3 py-3 align-middle font-mono text-xs text-[var(--muted)]">{r.slug}</td>
                  <td className="px-3 py-3 align-middle text-[var(--ink)]">{r.plan}</td>
                  <td className="px-3 py-3 align-middle text-end font-mono text-xs text-[var(--ink)]">
                    {r.maxUsers.toLocaleString("ja-JP")}
                  </td>
                  <td className="px-3 py-3 align-middle text-end font-mono text-xs text-[var(--ink)]">
                    {r.maxScansPerMonth.toLocaleString("ja-JP")}
                  </td>
                  <td className="px-3 py-3 align-middle text-end">
                    <Button
                      type="button"
                      variant="secondary"
                      size="lg"
                      onClick={() => setEditing(r)}
                      data-testid={`tenants-edit-${r.slug}`}
                    >
                      編集
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing ? (
        <form
          onSubmit={handleSave}
          className="flex flex-col gap-3 border border-[var(--color-brand)] bg-[var(--surface)] p-4"
          data-component="tenants-edit-form"
        >
          <header className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              編集中: {editing.name} ({editing.slug})
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => setEditing(null)}
            >
              閉じる
            </Button>
          </header>

          <label className="flex flex-col gap-1 text-sm text-[var(--ink)]">
            <span className="text-sm font-medium">プラン</span>
            <select
              value={editing.plan}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  plan: e.target.value as "logi" | "works" | "both",
                })
              }
              className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
              data-testid="tenants-plan-select"
            >
              <option value="logi">logi</option>
              <option value="works">works</option>
              <option value="both">both</option>
            </select>
          </label>

          <Field
            label="ユーザー上限"
            inputMode="numeric"
            value={String(editing.maxUsers)}
            onChange={(e) =>
              setEditing({ ...editing, maxUsers: Number(e.target.value) || 0 })
            }
            error={fieldErrors.maxUsers}
            data-testid="tenants-max-users"
          />
          <Field
            label="月間スキャン上限"
            inputMode="numeric"
            value={String(editing.maxScansPerMonth)}
            onChange={(e) =>
              setEditing({
                ...editing,
                maxScansPerMonth: Number(e.target.value) || 0,
              })
            }
            error={fieldErrors.maxScansPerMonth}
            data-testid="tenants-max-scans"
          />
          <Field
            label="プラン開始日 (YYYY-MM-DD)"
            type="date"
            value={editing.planStartedAt?.slice(0, 10) ?? ""}
            onChange={(e) =>
              setEditing({
                ...editing,
                planStartedAt: e.target.value || null,
              })
            }
            data-testid="tenants-plan-started"
          />
          <Field
            label="プラン終了日 (YYYY-MM-DD, 空欄=継続中)"
            type="date"
            value={editing.planEndedAt?.slice(0, 10) ?? ""}
            onChange={(e) =>
              setEditing({ ...editing, planEndedAt: e.target.value || null })
            }
            data-testid="tenants-plan-ended"
          />

          <div className="flex justify-end gap-2">
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={submitting}
              data-testid="tenants-save"
            >
              {submitting ? "保存中…" : "保存"}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
