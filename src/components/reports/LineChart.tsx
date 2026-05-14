"use client";

import {
  CartesianGrid,
  Line,
  LineChart as RcLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";

export type LineSeries = {
  dataKey: string;
  name: string;
  color: string;
};

export function LineChart({
  data,
  series,
  xKey = "date",
  height = 280,
  ariaLabel,
  testId = "report-chart-line",
}: {
  data: Array<Record<string, unknown>>;
  series: LineSeries[];
  xKey?: string;
  height?: number;
  ariaLabel: string;
  testId?: string;
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
        <RcLineChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
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
            <Line
              key={s.dataKey}
              type="monotone"
              dataKey={s.dataKey}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
        </RcLineChart>
      </ResponsiveContainer>
    </div>
  );
}
