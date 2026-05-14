"use client";

import {
  Bar,
  BarChart as RcBarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type BarSeries = {
  dataKey: string;
  name: string;
  color: string;
};

export function BarChart({
  data,
  series,
  xKey = "date",
  height = 280,
  ariaLabel,
  testId = "report-chart-bar",
  stacked = false,
}: {
  data: Array<Record<string, unknown>>;
  series: BarSeries[];
  xKey?: string;
  height?: number;
  ariaLabel: string;
  testId?: string;
  stacked?: boolean;
}) {
  if (data.length === 0) {
    return (
      <div
        data-testid={testId}
        role="img"
        aria-label={`${ariaLabel} (データなし)`}
        className="grid place-items-center border border-dashed border-[var(--border)] bg-[var(--surface)] py-12 text-sm text-[var(--muted)]"
        style={{ minHeight: height }}
      >
        この期間のデータはありません。
      </div>
    );
  }
  return (
    <div data-testid={testId} role="img" aria-label={ariaLabel} style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RcBarChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey={xKey} stroke="var(--ink)" fontSize={12} tickMargin={6} />
          <YAxis stroke="var(--ink)" fontSize={12} allowDecimals={false} width={36} />
          <Tooltip
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--ink)",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--ink)" }} />
          {series.map((s) => (
            <Bar
              key={s.dataKey}
              dataKey={s.dataKey}
              name={s.name}
              fill={s.color}
              stackId={stacked ? "all" : undefined}
              isAnimationActive={false}
            />
          ))}
        </RcBarChart>
      </ResponsiveContainer>
    </div>
  );
}
