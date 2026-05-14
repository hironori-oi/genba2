import type { Metadata } from "next";
import { Alert } from "@/components/ui/Alert";
import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { isErr } from "@/lib/admin/shared/result";
import {
  selectAuditEntries,
  type AuditEntry,
} from "@/lib/admin/audit-logs/select";

export const metadata: Metadata = { title: "監査ログ" };

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const OP_LABEL: Record<string, string> = {
  INSERT: "追加",
  UPDATE: "更新",
  DELETE: "削除",
  CORRECT: "訂正申請",
  APPROVE: "訂正承認",
};

function getStr(sp: SearchParams, key: string): string | null {
  const v = sp[key];
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

export default async function AdminAuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const guard = await ensureTenantAdmin();
  if (isErr(guard)) {
    return (
      <Alert tone="error" title="アクセスできません">
        {guard.message}
      </Alert>
    );
  }
  const { supabase, tenantId } = guard.data;
  const sp = await searchParams;

  const filter = {
    table: getStr(sp, "table"),
    op: getStr(sp, "op"),
    limit: 100,
  };

  const { rows, error } = await selectAuditEntries(supabase, tenantId, filter);

  return (
    <section className="flex flex-col gap-4" data-page="admin-audit-logs">
      <header className="flex flex-col gap-1">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          Phase 6f
        </p>
        <h2 className="text-xl font-semibold text-[var(--ink)]">監査ログ</h2>
        <p className="text-sm text-[var(--muted)]">
          設定変更 (work_settings / match_rules / qr_format_definitions / profiles など)
          と訂正履歴 (corrections_audit) を新しい順に表示します。
          自テナント分のみ閲覧でき、行は不変です。
        </p>
      </header>

      {error ? (
        <Alert tone="error" title="読込エラー">
          {error}
        </Alert>
      ) : null}

      <FilterBar current={filter} />
      <ExportLink current={filter} />
      <AuditTable rows={rows} />
    </section>
  );
}

function FilterBar({ current }: { current: { table: string | null; op: string | null } }) {
  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-3 border border-[var(--border)] bg-[var(--surface)] p-3"
      data-component="audit-logs-filter"
    >
      <label className="flex flex-col text-xs text-[var(--muted)]">
        対象テーブル
        <input
          type="text"
          name="table"
          defaultValue={current.table ?? ""}
          placeholder="例: work_settings"
          className="mt-1 h-10 min-w-[200px] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--ink)]"
          data-testid="audit-logs-filter-table"
        />
      </label>
      <label className="flex flex-col text-xs text-[var(--muted)]">
        操作
        <select
          name="op"
          defaultValue={current.op ?? ""}
          className="mt-1 h-10 min-w-[140px] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--ink)]"
          data-testid="audit-logs-filter-op"
        >
          <option value="">(すべて)</option>
          <option value="INSERT">INSERT</option>
          <option value="UPDATE">UPDATE</option>
          <option value="DELETE">DELETE</option>
        </select>
      </label>
      <button
        type="submit"
        className="h-14 min-h-14 border border-[var(--color-brand)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-brand-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        data-testid="audit-logs-filter-apply"
      >
        絞り込み
      </button>
    </form>
  );
}

function ExportLink({ current }: { current: { table: string | null; op: string | null } }) {
  const params = new URLSearchParams();
  if (current.table) params.set("table", current.table);
  if (current.op) params.set("op", current.op);
  const href = `/api/admin/audit-logs/export${params.toString() ? `?${params.toString()}` : ""}`;
  return (
    <a
      href={href}
      className="inline-flex h-12 w-fit items-center gap-2 border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--ink)] hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
      data-testid="audit-logs-csv-export"
    >
      CSV 出力 (現在の絞り込み)
    </a>
  );
}

function AuditTable({ rows }: { rows: AuditEntry[] }) {
  if (rows.length === 0) {
    return (
      <p className="border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--muted)]">
        条件に一致するログはありません。
      </p>
    );
  }
  return (
    <div
      className="w-full overflow-x-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface)]"
      data-component="audit-logs-table"
    >
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">監査ログ {rows.length} 件</caption>
        <thead className="bg-[var(--surface-2)] text-[var(--muted)]">
          <tr>
            <th scope="col" className="px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide">
              日時
            </th>
            <th scope="col" className="px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide">
              ソース
            </th>
            <th scope="col" className="px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide">
              対象テーブル
            </th>
            <th scope="col" className="px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide">
              操作
            </th>
            <th scope="col" className="px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide">
              要約
            </th>
            <th scope="col" className="px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide">
              申請者 id
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.source}:${r.id}`}
              className="border-t border-[var(--border)]"
              data-testid={`audit-row-${r.source}`}
            >
              <td className="px-3 py-3 align-middle font-mono text-xs text-[var(--ink)]">
                {new Date(r.createdAt).toLocaleString("ja-JP")}
              </td>
              <td className="px-3 py-3 align-middle text-[var(--ink)]">
                <span className="font-mono text-xs">{r.source}</span>
              </td>
              <td className="px-3 py-3 align-middle text-[var(--ink)]">
                <span className="font-mono text-xs">{r.tableName}</span>
              </td>
              <td className="px-3 py-3 align-middle text-[var(--ink)]">
                {OP_LABEL[r.op] ?? r.op}
              </td>
              <td className="px-3 py-3 align-middle text-[var(--ink)]">
                <span className="block max-w-[40ch] whitespace-pre-wrap break-words text-sm">
                  {r.summary}
                  {r.reason ? <span className="block text-xs text-[var(--muted)]">理由: {r.reason}</span> : null}
                </span>
              </td>
              <td className="px-3 py-3 align-middle font-mono text-[11px] text-[var(--muted)]">
                {r.actorId ? `${r.actorId.slice(0, 8)}…` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
