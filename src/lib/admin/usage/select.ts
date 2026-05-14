import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type UsageBusinessRow = {
  businessCode: string;
  periodStart: string;
  scanCount: number;
};

export type UsageSummary = {
  tenantId: string;
  monthLabel: string;
  totalScans: number;
  cap: number | null;
  percent: number;
  byBusiness: UsageBusinessRow[];
  warning: "ok" | "warn" | "exceeded";
};

function startOfMonthIso(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return d.toISOString().slice(0, 10);
}

export async function selectMonthlyUsage(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ summary: UsageSummary | null; error: string | null }> {
  const monthStart = startOfMonthIso();

  const [usageRes, subRes] = await Promise.all([
    supabase
      .from("monthly_scan_usage")
      .select("business_code, period_start, scan_count")
      .eq("tenant_id", tenantId)
      .eq("period_start", monthStart),
    supabase
      .from("tenant_subscriptions")
      .select("max_scans_per_month")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (usageRes.error) return { summary: null, error: usageRes.error.message };
  if (subRes.error) return { summary: null, error: subRes.error.message };

  const rows: UsageBusinessRow[] = (usageRes.data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      businessCode: String(row.business_code ?? ""),
      periodStart: String(row.period_start ?? monthStart),
      scanCount: Number(row.scan_count ?? 0),
    };
  });

  // Treat cap=null (subscription row missing) as "unlimited"; cap=0 is a
  // valid hard-stop ("no scans allowed this month") and must NOT collapse
  // into the unlimited bucket — hence the explicit null check rather than
  // truthy fallback.
  const capRaw = subRes.data
    ? (subRes.data as { max_scans_per_month?: number | null }).max_scans_per_month
    : null;
  const cap = capRaw === null || capRaw === undefined ? null : Number(capRaw);
  const totalScans = rows.reduce((acc, r) => acc + r.scanCount, 0);
  const percent = cap && cap > 0 ? Math.min(999, Math.round((totalScans / cap) * 100)) : 0;
  const warning: UsageSummary["warning"] =
    cap && cap > 0
      ? totalScans >= cap
        ? "exceeded"
        : totalScans / cap >= 0.8
        ? "warn"
        : "ok"
      : "ok";

  const monthLabel = `${monthStart.slice(0, 4)}年${Number(monthStart.slice(5, 7))}月`;

  return {
    summary: {
      tenantId,
      monthLabel,
      totalScans,
      cap,
      percent,
      byBusiness: rows.sort((a, b) => b.scanCount - a.scanCount),
      warning,
    },
    error: null,
  };
}
