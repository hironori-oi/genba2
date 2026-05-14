import type { Metadata } from "next";
import { Alert } from "@/components/ui/Alert";
import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { isErr } from "@/lib/admin/shared/result";
import { selectMonthlyUsage } from "@/lib/admin/usage/select";

export const metadata: Metadata = { title: "利用状況" };
export const dynamic = "force-dynamic";

const BUSINESS_LABEL: Record<string, string> = {
  receiving: "入庫",
  picking: "ピッキング",
  inventory: "棚卸",
  manufacturing: "製造",
};

export default async function AdminUsagePage() {
  const guard = await ensureTenantAdmin();
  if (isErr(guard)) {
    return (
      <Alert tone="error" title="アクセスできません">
        {guard.message}
      </Alert>
    );
  }
  const { supabase, tenantId } = guard.data;
  const { summary, error } = await selectMonthlyUsage(supabase, tenantId);

  if (error) {
    return (
      <Alert tone="error" title="読込エラー">
        {error}
      </Alert>
    );
  }
  if (!summary) {
    return (
      <Alert tone="info" title="データなし">
        当月の利用データはまだありません。
      </Alert>
    );
  }

  const barTone =
    summary.warning === "exceeded"
      ? "bg-[var(--color-bad)]"
      : summary.warning === "warn"
      ? "bg-[var(--color-warn)]"
      : "bg-[var(--color-brand)]";

  return (
    <section className="flex flex-col gap-4" data-page="admin-usage">
      <header className="flex flex-col gap-1">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          Phase 6f
        </p>
        <h2 className="text-xl font-semibold text-[var(--ink)]">利用状況</h2>
        <p className="text-sm text-[var(--muted)]">
          当月のスキャン件数とテナント上限 (tenant_subscriptions.max_scans_per_month) の達成率。
          80% を超えるとバナーで注意喚起、上限到達後は新規スキャンの停止が必要です。
        </p>
      </header>

      {summary.warning === "warn" ? (
        <Alert tone="warn" title="月間上限の 80% に達しました">
          当月 {summary.totalScans.toLocaleString("ja-JP")} 件 / 上限{" "}
          {(summary.cap ?? 0).toLocaleString("ja-JP")} 件。テナントプランの見直しを検討してください。
        </Alert>
      ) : null}
      {summary.warning === "exceeded" ? (
        <Alert tone="error" title="月間上限を超過しました">
          当月 {summary.totalScans.toLocaleString("ja-JP")} 件 / 上限{" "}
          {(summary.cap ?? 0).toLocaleString("ja-JP")} 件。
        </Alert>
      ) : null}

      <article
        className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
        data-component="usage-summary"
      >
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-[var(--muted)]">{summary.monthLabel}</span>
          <span className="font-mono text-xs text-[var(--muted)]">
            {summary.totalScans.toLocaleString("ja-JP")} /{" "}
            {summary.cap ? summary.cap.toLocaleString("ja-JP") : "無制限"}
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={summary.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="月間スキャン上限達成率"
          className="h-3 w-full overflow-hidden bg-[var(--surface-2)]"
          data-testid="usage-progressbar"
        >
          <div
            className={`h-full ${barTone}`}
            style={{ width: `${Math.min(100, summary.percent)}%` }}
          />
        </div>
        <p className="text-end text-xs text-[var(--muted)]">{summary.percent}%</p>
      </article>

      <section
        className="flex flex-col gap-2"
        aria-labelledby="usage-by-business"
        data-component="usage-by-business"
      >
        <h3 id="usage-by-business" className="text-sm font-semibold text-[var(--ink)]">
          業務別内訳
        </h3>
        {summary.byBusiness.length === 0 ? (
          <p className="border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
            当月の業務別データはありません。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {summary.byBusiness.map((row) => (
              <li
                key={row.businessCode}
                className="flex items-center justify-between border border-[var(--border)] bg-[var(--surface)] p-3"
              >
                <span className="text-sm text-[var(--ink)]">
                  {BUSINESS_LABEL[row.businessCode] ?? row.businessCode}
                </span>
                <span className="font-mono text-xs text-[var(--muted)]">
                  {row.scanCount.toLocaleString("ja-JP")} 件
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
