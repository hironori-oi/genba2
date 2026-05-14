import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { isErr } from "@/lib/admin/shared/result";
import {
  getDailyKpi,
  getMonthlyScanUsage,
  getMonthlySummary,
  getRangeLabels,
  getWeeklyDefectBreakdown,
  getWeeklySeries,
} from "@/lib/reports/aggregate";
import { LineChart } from "@/components/reports/LineChart";
import { BarChart } from "@/components/reports/BarChart";
import { PieChart } from "@/components/reports/PieChart";

export const metadata: Metadata = { title: "報告書 / 集計ダッシュボード" };

type Tab = "daily" | "weekly" | "monthly";

const TABS: { key: Tab; label: string; testId: string }[] = [
  { key: "daily", label: "日次", testId: "report-tab-daily" },
  { key: "weekly", label: "週次", testId: "report-tab-weekly" },
  { key: "monthly", label: "月次", testId: "report-tab-monthly" },
];

function parseTab(value: string | string[] | undefined): Tab {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "weekly" || v === "monthly") return v;
  return "daily";
}

function KpiCard({
  label,
  value,
  unit,
  testId,
}: {
  label: string;
  value: string | number;
  unit?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-1 border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
    >
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
        {label}
      </p>
      <p className="text-2xl font-semibold tabular-nums text-[var(--ink)]">
        {value}
        {unit ? (
          <span className="ml-1 text-sm font-normal text-[var(--muted)]">{unit}</span>
        ) : null}
      </p>
    </div>
  );
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const tab = parseTab(params.tab);
  const gate = await ensureTenantAdmin();
  if (isErr(gate)) {
    return (
      <section className="flex flex-col gap-4" data-testid="reports-error">
        <header className="flex flex-col gap-1">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            Phase 6d
          </p>
          <h2 className="text-xl font-semibold text-[var(--ink)]">報告書</h2>
        </header>
        <Alert tone="error" title="表示できません">
          {gate.message}
        </Alert>
      </section>
    );
  }
  const { supabase, tenantId } = gate.data;
  const labels = getRangeLabels();

  // Fetch only what the active tab needs, with a small parallel hop where
  // tabs share aggregate calls (Promise.all keeps the request fast).
  let body: React.ReactNode = null;
  if (tab === "daily") {
    const daily = await getDailyKpi(supabase, tenantId);
    body = (
      <div className="flex flex-col gap-4" data-testid="report-pane-daily">
        <p className="text-sm text-[var(--muted)]">
          対象期間: <strong className="text-[var(--ink)]">{daily.date}</strong>
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            label="製造実績 (完成数)"
            value={daily.manufacturingActualQty.toLocaleString()}
            testId="daily-kpi-manufacturing"
          />
          <KpiCard
            label="良品数"
            value={daily.manufacturingGoodQty.toLocaleString()}
            testId="daily-kpi-good"
          />
          <KpiCard
            label="不適合数"
            value={daily.manufacturingDefectQty.toLocaleString()}
            testId="daily-kpi-defect"
          />
          <KpiCard
            label="訂正件数"
            value={daily.correctionsCount.toLocaleString()}
            testId="daily-kpi-corrections"
          />
          <KpiCard
            label="入庫件数"
            value={daily.receivingCount.toLocaleString()}
            testId="daily-kpi-receiving"
          />
          <KpiCard
            label="ピッキング件数"
            value={daily.pickingCount.toLocaleString()}
            testId="daily-kpi-picking"
          />
          <KpiCard
            label="棚卸件数"
            value={daily.inventoryCount.toLocaleString()}
            testId="daily-kpi-inventory"
          />
        </div>
        <BarChart
          ariaLabel="本日の業務別件数"
          testId="report-chart-daily-bar"
          data={[
            {
              category: "本日",
              入庫: daily.receivingCount,
              ピッキング: daily.pickingCount,
              棚卸: daily.inventoryCount,
              訂正: daily.correctionsCount,
            },
          ]}
          xKey="category"
          series={[
            { dataKey: "入庫", name: "入庫", color: "var(--color-func-receive)" },
            { dataKey: "ピッキング", name: "ピッキング", color: "var(--color-func-pick)" },
            { dataKey: "棚卸", name: "棚卸", color: "var(--color-func-inventory)" },
            { dataKey: "訂正", name: "訂正", color: "var(--color-warn)" },
          ]}
        />
      </div>
    );
  } else if (tab === "weekly") {
    const [series, defects] = await Promise.all([
      getWeeklySeries(supabase, tenantId),
      getWeeklyDefectBreakdown(supabase, tenantId),
    ]);
    body = (
      <div className="flex flex-col gap-4" data-testid="report-pane-weekly">
        <p className="text-sm text-[var(--muted)]">
          対象期間: <strong className="text-[var(--ink)]">{labels.weekly}</strong>
        </p>
        <LineChart
          ariaLabel="過去 7 日の業務別件数推移"
          testId="report-chart-weekly-line"
          data={series}
          xKey="date"
          series={[
            { dataKey: "receiving", name: "入庫", color: "var(--color-func-receive)" },
            { dataKey: "picking", name: "ピッキング", color: "var(--color-func-pick)" },
            { dataKey: "inventory", name: "棚卸", color: "var(--color-func-inventory)" },
            { dataKey: "manufacturing", name: "製造", color: "var(--color-func-manufact)" },
          ]}
        />
        <h3 className="text-sm font-semibold text-[var(--ink)]">
          不適合 top 5 (週間)
        </h3>
        <PieChart
          ariaLabel="週間不適合内訳"
          testId="report-chart-weekly-pie"
          data={defects.map((d) => ({ name: d.defectName, value: d.count }))}
          nameKey="name"
          valueKey="value"
        />
      </div>
    );
  } else {
    const [summary, scanUsage] = await Promise.all([
      getMonthlySummary(supabase, tenantId),
      getMonthlyScanUsage(supabase, tenantId),
    ]);
    const usageChart = scanUsage
      .slice()
      .reverse()
      .reduce<Record<string, Record<string, number | string>>>((acc, row) => {
        const key = row.periodStart;
        if (!acc[key]) acc[key] = { period: key };
        acc[key][row.businessCode] = row.scanCount;
        return acc;
      }, {});
    const usageData = Object.values(usageChart);
    body = (
      <div className="flex flex-col gap-4" data-testid="report-pane-monthly">
        <p className="text-sm text-[var(--muted)]">
          対象期間: <strong className="text-[var(--ink)]">{summary.periodStart}</strong>
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            label="製造実績 (件)"
            value={summary.manufacturingTotal.toLocaleString()}
            testId="monthly-kpi-manufacturing"
          />
          <KpiCard
            label="入出庫件数"
            value={summary.movementTotal.toLocaleString()}
            testId="monthly-kpi-movement"
          />
          <KpiCard
            label="訂正件数"
            value={summary.correctionsTotal.toLocaleString()}
            testId="monthly-kpi-corrections"
          />
          <KpiCard
            label="QR スキャン"
            value={summary.scanTotal.toLocaleString()}
            unit={
              summary.scanCap && summary.scanUsagePct !== null
                ? `/ ${summary.scanCap.toLocaleString()} (${summary.scanUsagePct}%)`
                : undefined
            }
            testId="monthly-kpi-scans"
          />
        </div>
        <BarChart
          ariaLabel="月別 QR スキャン件数 (業務別)"
          testId="report-chart-monthly-bar"
          data={usageData}
          xKey="period"
          stacked
          series={[
            { dataKey: "receiving", name: "入庫", color: "var(--color-func-receive)" },
            { dataKey: "picking", name: "ピッキング", color: "var(--color-func-pick)" },
            { dataKey: "inventory", name: "棚卸", color: "var(--color-func-inventory)" },
            { dataKey: "manufacturing", name: "製造", color: "var(--color-func-manufact)" },
          ]}
        />
      </div>
    );
  }

  return (
    <section
      className="flex flex-col gap-5"
      data-testid="reports-dashboard"
      aria-label="報告書ダッシュボード"
    >
      <header className="flex flex-col gap-1">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          Phase 6d
        </p>
        <h2 className="text-xl font-semibold text-[var(--ink)]">報告書 / 集計</h2>
        <p className="text-sm text-[var(--muted)]">
          日次 / 週次 / 月次の業務サマリと KPI を確認できます。
          CSV ダウンロードで詳細データを別途取得できます。
        </p>
      </header>

      <nav
        aria-label="集計期間タブ"
        className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-2"
      >
        {TABS.map((t) => {
          const isActive = t.key === tab;
          return (
            <Link
              key={t.key}
              href={`/app/admin/reports?tab=${t.key}`}
              data-testid={t.testId}
              aria-current={isActive ? "page" : undefined}
              className={`inline-flex h-14 min-w-14 items-center justify-center border px-4 text-sm font-medium ${
                isActive
                  ? "border-[var(--color-brand)] bg-[var(--surface-2)] text-[var(--ink)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--color-brand)]"
              } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-wrap gap-2">
        <a
          href={`/api/reports/${tab}/csv`}
          data-testid={`report-csv-${tab}`}
          className="inline-flex h-14 min-w-14 items-center justify-center border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--ink)] hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          CSV ダウンロード ({TABS.find((t) => t.key === tab)?.label})
        </a>
      </div>

      {body}
    </section>
  );
}
