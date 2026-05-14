"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart as RcPieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

const FALLBACK_PALETTE = [
  "var(--color-func-receive)",
  "var(--color-func-pick)",
  "var(--color-func-inventory)",
  "var(--color-func-manufact)",
  "var(--color-warn)",
  "var(--color-bad)",
];

export function PieChart({
  data,
  nameKey,
  valueKey,
  height = 280,
  ariaLabel,
  testId = "report-chart-pie",
}: {
  data: Array<Record<string, unknown>>;
  nameKey: string;
  valueKey: string;
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
        <RcPieChart>
          <Pie
            data={data}
            nameKey={nameKey}
            dataKey={valueKey}
            outerRadius={Math.min(100, height / 3)}
            label
            isAnimationActive={false}
          >
            {data.map((_, i) => (
              <Cell key={`cell-${i}`} fill={FALLBACK_PALETTE[i % FALLBACK_PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--ink)",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--ink)" }} />
        </RcPieChart>
      </ResponsiveContainer>
    </div>
  );
}
