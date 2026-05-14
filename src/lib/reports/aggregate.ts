import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 6d reports aggregate helpers (architect §B.3 / §C.6d).
 *
 * Single server-only entry point that the daily / weekly / monthly
 * dashboard panes and the CSV export endpoint share. Each function
 * accepts an authed Supabase client (anon JWT, the one returned by
 * ensureTenantAdmin) plus the resolved tenantId, and runs straight
 * SELECTs against RLS-gated tables / views.
 *
 * Tenant_id is included in the .eq() filter even though RLS already
 * pins it — defence in depth, and it matches the index path on every
 * table.
 */

export type ReportKind = "daily" | "weekly" | "monthly";

export type DailyKpi = {
  date: string;                       // YYYY-MM-DD (JST today by default)
  manufacturingActualQty: number;
  manufacturingGoodQty: number;
  manufacturingDefectQty: number;
  receivingCount: number;
  pickingCount: number;
  inventoryCount: number;
  correctionsCount: number;
};

export type WeeklyPoint = {
  date: string;
  receiving: number;
  picking: number;
  inventory: number;
  manufacturing: number;
};

export type DefectBreakdown = {
  defectName: string;
  count: number;
};

export type MonthlyScanUsage = {
  periodStart: string;
  businessCode: string;
  scanCount: number;
};

export type MonthlySummary = {
  periodStart: string;
  manufacturingTotal: number;
  movementTotal: number;
  correctionsTotal: number;
  scanTotal: number;
  scanCap: number | null;
  scanUsagePct: number | null;
};

const TZ_OFFSET_HOURS = 9; // JST. Matches Phase 6c print reports.

function startOfJstDay(d: Date): Date {
  const utc = new Date(d.getTime() + TZ_OFFSET_HOURS * 3_600_000);
  utc.setUTCHours(0, 0, 0, 0);
  return new Date(utc.getTime() - TZ_OFFSET_HOURS * 3_600_000);
}

function isoDateJst(d: Date): string {
  const j = new Date(d.getTime() + TZ_OFFSET_HOURS * 3_600_000);
  return j.toISOString().slice(0, 10);
}

function rangeStartEnd(kind: ReportKind, now = new Date()): { start: Date; end: Date; label: string } {
  const todayStart = startOfJstDay(now);
  const tomorrowStart = new Date(todayStart.getTime() + 86_400_000);
  if (kind === "daily") {
    return { start: todayStart, end: tomorrowStart, label: isoDateJst(todayStart) };
  }
  if (kind === "weekly") {
    const start = new Date(todayStart.getTime() - 6 * 86_400_000);
    return { start, end: tomorrowStart, label: `${isoDateJst(start)} 〜 ${isoDateJst(todayStart)}` };
  }
  const start = new Date(todayStart.getTime() - 29 * 86_400_000);
  return { start, end: tomorrowStart, label: `${isoDateJst(start)} 〜 ${isoDateJst(todayStart)}` };
}

function isoZ(d: Date): string {
  return d.toISOString();
}

async function safeCount(
  supabase: SupabaseClient,
  table: string,
  tenantId: string,
  start: Date,
  end: Date,
  extra?: { column?: string; eq?: { col: string; value: string } },
): Promise<number> {
  const column = extra?.column ?? "recorded_at";
  let q = supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .gte(column, isoZ(start))
    .lt(column, isoZ(end));
  if (extra?.eq) q = q.eq(extra.eq.col, extra.eq.value);
  const { count, error } = await q;
  if (error) {
    // Surface a clear 0 + leave decision to caller; do not throw to keep
    // the dashboard rendering even if a single KPI fails. Server logs
    // remain authoritative.
    console.warn(`[reports/aggregate] count(${table}) failed`, error.message);
    return 0;
  }
  return count ?? 0;
}

async function sumManufacturingQty(
  supabase: SupabaseClient,
  tenantId: string,
  start: Date,
  end: Date,
): Promise<{ actual: number; good: number; defect: number }> {
  const { data, error } = await supabase
    .from("manufacturing_records")
    .select("actual_quantity, good_quantity, defect_quantity")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .gte("recorded_at", isoZ(start))
    .lt("recorded_at", isoZ(end));
  if (error || !data) {
    console.warn(`[reports/aggregate] manufacturing sum failed`, error?.message);
    return { actual: 0, good: 0, defect: 0 };
  }
  let actual = 0, good = 0, defect = 0;
  for (const row of data) {
    actual += Number(row.actual_quantity ?? 0);
    good += Number(row.good_quantity ?? 0);
    defect += Number(row.defect_quantity ?? 0);
  }
  return { actual, good, defect };
}

export async function getDailyKpi(
  supabase: SupabaseClient,
  tenantId: string,
  now = new Date(),
): Promise<DailyKpi> {
  const { start, end, label } = rangeStartEnd("daily", now);
  const [mfg, receiving, picking, inventory, corrections] = await Promise.all([
    sumManufacturingQty(supabase, tenantId, start, end),
    safeCount(supabase, "movement_records", tenantId, start, end, {
      eq: { col: "business_code", value: "receiving" },
    }),
    safeCount(supabase, "movement_records", tenantId, start, end, {
      eq: { col: "business_code", value: "picking" },
    }),
    safeCount(supabase, "inventory_records", tenantId, start, end),
    safeCount(supabase, "corrections_audit", tenantId, start, end, {
      column: "created_at",
    }),
  ]);
  return {
    date: label,
    manufacturingActualQty: mfg.actual,
    manufacturingGoodQty: mfg.good,
    manufacturingDefectQty: mfg.defect,
    receivingCount: receiving,
    pickingCount: picking,
    inventoryCount: inventory,
    correctionsCount: corrections,
  };
}

export async function getWeeklySeries(
  supabase: SupabaseClient,
  tenantId: string,
  now = new Date(),
): Promise<WeeklyPoint[]> {
  const { start, end } = rangeStartEnd("weekly", now);
  const [movements, inventoryRows, manufacturingRows] = await Promise.all([
    supabase
      .from("movement_records")
      .select("business_code, recorded_at")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .gte("recorded_at", isoZ(start))
      .lt("recorded_at", isoZ(end)),
    supabase
      .from("inventory_records")
      .select("recorded_at")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .gte("recorded_at", isoZ(start))
      .lt("recorded_at", isoZ(end)),
    supabase
      .from("manufacturing_records")
      .select("recorded_at")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .gte("recorded_at", isoZ(start))
      .lt("recorded_at", isoZ(end)),
  ]);

  const points = new Map<string, WeeklyPoint>();
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const key = isoDateJst(d);
    points.set(key, {
      date: key,
      receiving: 0,
      picking: 0,
      inventory: 0,
      manufacturing: 0,
    });
  }

  const bump = (
    rows: { recorded_at?: string | null; business_code?: string | null }[] | null | undefined,
    field: "receiving" | "picking" | "inventory" | "manufacturing",
  ) => {
    if (!rows) return;
    for (const row of rows) {
      if (!row.recorded_at) continue;
      const key = isoDateJst(new Date(row.recorded_at));
      const p = points.get(key);
      if (!p) continue;
      p[field] += 1;
    }
  };

  if (!movements.error && movements.data) {
    for (const row of movements.data) {
      const code = row.business_code;
      if (code !== "receiving" && code !== "picking") continue;
      const key = isoDateJst(new Date(row.recorded_at));
      const p = points.get(key);
      if (!p) continue;
      p[code as "receiving" | "picking"] += 1;
    }
  }
  bump(inventoryRows.data, "inventory");
  bump(manufacturingRows.data, "manufacturing");

  return Array.from(points.values());
}

export async function getWeeklyDefectBreakdown(
  supabase: SupabaseClient,
  tenantId: string,
  now = new Date(),
  limit = 5,
): Promise<DefectBreakdown[]> {
  const { start, end } = rangeStartEnd("weekly", now);
  const { data, error } = await supabase
    .from("manufacturing_record_defects")
    .select("defect_id, defect_quantity, defects(name)")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .gte("recorded_at", isoZ(start))
    .lt("recorded_at", isoZ(end));
  if (error || !data) {
    console.warn(`[reports/aggregate] defect breakdown failed`, error?.message);
    return [];
  }
  const totals = new Map<string, { name: string; count: number }>();
  for (const row of data as Array<{
    defect_id: string;
    defect_quantity: number | null;
    defects: { name: string } | { name: string }[] | null;
  }>) {
    const name = Array.isArray(row.defects)
      ? row.defects[0]?.name
      : row.defects?.name;
    const key = row.defect_id;
    const prev = totals.get(key) ?? { name: name ?? "(不明)", count: 0 };
    prev.count += Number(row.defect_quantity ?? 0);
    if (!totals.has(key)) totals.set(key, prev);
    else totals.set(key, prev);
  }
  return Array.from(totals.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((t) => ({ defectName: t.name, count: t.count }));
}

export async function getMonthlyScanUsage(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<MonthlyScanUsage[]> {
  const { data, error } = await supabase
    .from("monthly_scan_usage")
    .select("period_start, business_code, scan_count")
    .eq("tenant_id", tenantId)
    .order("period_start", { ascending: false })
    .limit(36);
  if (error || !data) {
    console.warn(`[reports/aggregate] monthly_scan_usage failed`, error?.message);
    return [];
  }
  return data.map((r: { period_start: string; business_code: string; scan_count: number }) => ({
    periodStart: r.period_start,
    businessCode: r.business_code,
    scanCount: Number(r.scan_count),
  }));
}

export async function getMonthlySummary(
  supabase: SupabaseClient,
  tenantId: string,
  now = new Date(),
): Promise<MonthlySummary> {
  const { start, end, label } = rangeStartEnd("monthly", now);
  const [
    manufacturing,
    movements,
    corrections,
    scanRows,
    subscription,
  ] = await Promise.all([
    safeCount(supabase, "manufacturing_records", tenantId, start, end),
    safeCount(supabase, "movement_records", tenantId, start, end),
    safeCount(supabase, "corrections_audit", tenantId, start, end, {
      column: "created_at",
    }),
    supabase
      .from("monthly_scan_usage")
      .select("scan_count, period_start")
      .eq("tenant_id", tenantId)
      .gte("period_start", label.split(" ")[0]),
    supabase
      .from("tenant_subscriptions")
      .select("max_scans_per_month")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);

  let scanTotal = 0;
  if (!scanRows.error && scanRows.data) {
    for (const row of scanRows.data as Array<{ scan_count: number }>) {
      scanTotal += Number(row.scan_count ?? 0);
    }
  }
  const scanCap = subscription.data
    ? Number((subscription.data as { max_scans_per_month: number }).max_scans_per_month)
    : null;
  const scanUsagePct =
    scanCap && scanCap > 0 ? Math.round((scanTotal / scanCap) * 1000) / 10 : null;

  return {
    periodStart: label,
    manufacturingTotal: manufacturing,
    movementTotal: movements,
    correctionsTotal: corrections,
    scanTotal,
    scanCap,
    scanUsagePct,
  };
}

export type ReportRangeLabels = {
  daily: string;
  weekly: string;
  monthly: string;
};

export function getRangeLabels(now = new Date()): ReportRangeLabels {
  return {
    daily: rangeStartEnd("daily", now).label,
    weekly: rangeStartEnd("weekly", now).label,
    monthly: rangeStartEnd("monthly", now).label,
  };
}
