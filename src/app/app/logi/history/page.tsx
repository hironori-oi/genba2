import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { Alert } from "@/components/ui/Alert";
import {
  fetchScanHistoryForAdmin,
  fetchScanHistoryForWorker,
  type ScanHistoryFilters,
} from "@/lib/logi/history";
import { supabaseConfigured } from "@/lib/env";
import type { AnyBusinessCode } from "@/lib/logi/types";
import { HistoryCsvButton } from "./HistoryCsvButton";

export const metadata: Metadata = { title: "スキャン履歴" };

const BUSINESS_OPTIONS: Array<{
  value: AnyBusinessCode | "";
  label: string;
}> = [
  { value: "", label: "すべて" },
  { value: "receiving", label: "入庫" },
  { value: "picking", label: "ピッキング" },
  { value: "inventory", label: "棚卸" },
  { value: "manufacturing", label: "製造" },
];

function readFilter(
  sp: Record<string, string | string[] | undefined>,
): ScanHistoryFilters {
  const bc = typeof sp.business === "string" ? sp.business : "";
  const businessCode: AnyBusinessCode | undefined =
    bc === "receiving" ||
    bc === "picking" ||
    bc === "inventory" ||
    bc === "manufacturing"
      ? bc
      : undefined;
  const from = typeof sp.from === "string" && sp.from.length > 0 ? sp.from : undefined;
  const to = typeof sp.to === "string" && sp.to.length > 0 ? sp.to : undefined;
  const limitRaw = typeof sp.limit === "string" ? Number(sp.limit) : 50;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, limitRaw) : 50;
  return {
    businessCode,
    from,
    to,
    limit,
  };
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAppSession();
  if (session.kind === "unauthenticated") {
    redirect("/login?next=/app/logi/history");
  }

  const sp = (await searchParams) ?? {};
  const filters = readFilter(sp);

  const isAdmin =
    session.kind === "ok" &&
    (session.session.role === "tenant_admin" ||
      session.session.role === "system_admin");

  // Demo / unconfigured mode → render an Alert and empty state.
  const configured = supabaseConfigured();
  let rows: Array<{
    id: string;
    createdAt: string;
    businessCode: string | null;
    qrType: string;
    matchResult: string;
    targetTable: string | null;
    targetId: string | null;
    parsedSummary: string;
  }> = [];
  let fetchError: string | null = null;

  if (configured) {
    if (isAdmin) {
      const { data, error } = await fetchScanHistoryForAdmin(filters);
      if (error) fetchError = error.message;
      else
        rows = data.map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          businessCode: r.businessCode,
          qrType: r.qrType,
          matchResult: r.matchResult,
          targetTable: r.targetTable,
          targetId: r.targetId,
          parsedSummary: summarise(r.parsedValues),
        }));
    } else {
      const { data, error } = await fetchScanHistoryForWorker(filters);
      if (error) fetchError = error.message;
      else
        rows = data.map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          businessCode: r.businessCode,
          qrType: r.qrType,
          matchResult: r.matchResult,
          targetTable: r.targetTable,
          targetId: r.targetId,
          parsedSummary: summarise(r.parsedValues),
        }));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          履歴
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl">
          スキャン履歴
        </h1>
        <p className="text-sm text-[var(--muted)]">
          4 業務 (入庫 / ピッキング / 棚卸 / 製造) を統合表示。業務 / 期間 / 件数で絞込めます。CSV 出力は絞込結果のままダウンロードします。
          {isAdmin ? "" : " 作業者向け表示では raw_value は含まれません (QR_SPEC §7)。"}
        </p>
      </header>

      {!configured ? (
        <Alert tone="info" title="プレビューモード">
          Supabase 接続情報が未設定のため、履歴は空表示です。実値を `.env.enc` に登録後、ライブ DB の値が表示されます。
        </Alert>
      ) : null}
      {fetchError ? (
        <Alert tone="error" title="読込エラー">
          {fetchError}
        </Alert>
      ) : null}

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 border border-[var(--border)] bg-[var(--surface)] p-3"
        aria-label="履歴フィルタ"
      >
        <label className="flex flex-col gap-1 text-xs">
          業務
          <select
            name="business"
            defaultValue={filters.businessCode ?? ""}
            data-testid="history-filter-business"
            className="h-12 border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            {BUSINESS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          From
          <input
            type="date"
            name="from"
            defaultValue={filters.from?.slice(0, 10) ?? ""}
            data-testid="history-filter-from"
            className="h-12 border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--ink)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          To
          <input
            type="date"
            name="to"
            defaultValue={filters.to?.slice(0, 10) ?? ""}
            data-testid="history-filter-to"
            className="h-12 border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--ink)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          件数
          <input
            type="number"
            name="limit"
            min={1}
            max={200}
            defaultValue={filters.limit ?? 50}
            data-testid="history-filter-limit"
            className="h-12 w-24 border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--ink)]"
          />
        </label>
        <button
          type="submit"
          className="inline-flex h-14 items-center bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-brand-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          絞込
        </button>
        <HistoryCsvButton rows={rows} />
      </form>

      <section
        aria-labelledby="history-results"
        className="overflow-x-auto border border-[var(--border)] bg-[var(--surface)]"
      >
        <h2 id="history-results" className="sr-only">
          検索結果
        </h2>
        <table
          className="min-w-full divide-y divide-[var(--border)] text-sm"
          data-testid="history-table"
        >
          <thead className="bg-[var(--surface-2)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th scope="col" className="px-3 py-2">日時</th>
              <th scope="col" className="px-3 py-2">業務</th>
              <th scope="col" className="px-3 py-2">QR 種別</th>
              <th scope="col" className="px-3 py-2">照合</th>
              <th scope="col" className="px-3 py-2">対象</th>
              <th scope="col" className="px-3 py-2">解析値</th>
              <th scope="col" className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-[var(--muted)]"
                  data-testid="history-empty"
                >
                  該当する履歴がありません。
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--ink)]">
                    {new Date(r.createdAt).toLocaleString("ja-JP")}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--ink)]">
                    {r.businessCode ?? "-"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--ink)]">
                    {r.qrType}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <span
                      className={
                        r.matchResult === "ok"
                          ? "text-[var(--color-ok)]"
                          : r.matchResult === "ng"
                            ? "text-[var(--color-bad)]"
                            : r.matchResult === "warning"
                              ? "text-[var(--color-warn)]"
                              : "text-[var(--muted)]"
                      }
                    >
                      {r.matchResult}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--muted)]">
                    {r.targetTable
                      ? `${r.targetTable}#${(r.targetId ?? "").slice(0, 8)}`
                      : "-"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--ink)]">
                    {r.parsedSummary}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/app/logi/history/${r.id}`}
                      data-testid={`history-detail-${r.id}`}
                      aria-label={`履歴 ${r.id.slice(0, 8)} の詳細を表示`}
                      className="inline-flex h-14 w-14 items-center justify-center border border-[var(--border)] bg-[var(--surface)] font-mono text-xs text-[var(--ink)] hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                    >
                      詳細
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function summarise(parsed: Record<string, string | number | null>): string {
  const entries = Object.entries(parsed).slice(0, 3);
  if (entries.length === 0) return "—";
  return entries
    .map(([k, v]) => `${k}=${v === null ? "" : String(v)}`)
    .join(" / ");
}
